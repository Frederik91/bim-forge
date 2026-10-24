import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChangeRequests, BacklogConflict } from './change-requests.ts';
import { RoomRepository, rectangleLayout } from '../src/room-model.ts';
import type { ModelWorker, ModelWorkerSession } from '../src/model-proposal.ts';
import { DatabaseSync } from 'node:sqlite';
import { parseRequestActivity } from '../src/request-activity.ts';

function request(repo: RoomRepository, id: string, name: string, width = 1200) {
  const layout = structuredClone(rectangleLayout(repo.view(repo.head('main')).snapshot));
  layout.door.widthMm = width;
  return { requestId: id, proposalName: name, baseRevisionId: repo.head('main'), selectedObjectIds: ['door-entry'],
    instruction: 'Widen the door to match the sketch.', visualIntent: { kind: 'rectangle-layout-sketch', layout } };
}
const worker: ModelWorker = { identity: { provider: 'test', model: 'backlog-agent' }, async run(session: ModelWorkerSession) {
  const input = session.input;
  if (!input || typeof input !== 'object' || !('request' in input) || !input.request || typeof input.request !== 'object' || !('visualIntent' in input.request)) throw new Error('Missing request.');
  const visual = input.request.visualIntent;
  if (!visual || typeof visual !== 'object' || !('layout' in visual)) throw new Error('Missing sketch.');
  await session.executeTool('inspect_model', {});
  assert.equal((await session.executeTool('preview_rectangle', visual.layout)).ok, true);
  assert.equal((await session.executeTool('submit_proposal', { summary: 'Widen the entry.', rationale: 'Requested width fits the host.',
    constraints: 'Keep the room shell and hosting.', uncertainty: 'Concept model, not construction approval.' })).ok, true);
} };

test('optional names derive from intent and stable identity; concurrent unnamed requests, retries and revisions remain distinct', async (t) => {
  const queue = new ChangeRequests(':memory:', () => worker); t.after(() => queue.close());
  const repo = await RoomRepository.create('Automatic request names');
  const first = request(repo, 'unnamed-one', '');
  const second = request(repo, 'unnamed-two', '   ');
  const [a, b] = await Promise.all([queue.submit(repo.serialize(), first), queue.submit(repo.serialize(), second)]);
  assert.match(a.request.proposalName, /^widen-the-door-to-match-[a-p]{32}$/);
  assert.notEqual(a.request.proposalName, b.request.proposalName);
  assert.equal((await queue.submit(repo.serialize(), first)).request.proposalName, a.request.proposalName);
  await waitFor(queue, a.id); await waitFor(queue, b.id);
  assert.equal(queue.get(a.id).state, 'ready');
  const revised = request(repo, 'unnamed-revision', '');
  const { proposalName: omitted, ...withoutName } = revised;
  assert.equal(omitted, '');
  const version = await queue.revise(a.id, repo.serialize(), withoutName);
  assert.notEqual(version.request.proposalName, a.request.proposalName);
  await waitFor(queue, a.id); assert.equal(queue.get(a.id).state, 'ready');
  assert.ok(queue.get(a.id).history[0]?.includes(a.request.proposalName));
  assert.equal((await queue.revise(a.id, repo.serialize(), withoutName)).request.proposalName, version.request.proposalName);
  await assert.rejects(() => queue.submit(repo.serialize(), { ...request(repo, 'invalid-name', 'main') }), /lowercase/);
});
function decide(queue: ChangeRequests, id: string, input: { action: string; decisionId: string }) {
  return queue.decide(id, { ...input, expectedRequestId: queue.get(id).request.requestId });
}
async function waitFor(queue: ChangeRequests, id: string, states = ['ready', 'needs-input', 'failed']): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (states.includes(queue.get(id).state)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Request ${id} did not reach ${states.join(', ')}.`);
}

test('submission is durable before acknowledgement, idempotent and independent of worker availability', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-backlog-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite');
  const repo = await RoomRepository.create('Queue test');
  let queue = new ChangeRequests(file, () => null);
  const input = request(repo, 'durable', 'durable-entry');
  assert.equal((await queue.submit(repo.serialize(), input)).state, 'queued');
  assert.equal((await queue.submit(repo.serialize(), input)).id, 'durable');
  await assert.rejects(() => queue.submit(repo.serialize(), { ...input, instruction: 'Another outcome.' }), BacklogConflict);
  queue.close();
  queue = new ChangeRequests(file, () => worker);
  t.after(() => queue.close());
  await waitFor(queue, 'durable');
  assert.equal(queue.get('durable').state, 'ready');
  assert.equal(queue.list(repo.projectId).length, 1);
  assert.equal((await RoomRepository.restore(queue.project(repo.projectId))).head('main'), repo.head('main'));
  assert.equal(queue.list(crypto.randomUUID()).length, 0, 'other projects cannot see this backlog');
});

test('multiple tickets queue immediately; only two agents run and cancellation cannot publish late results', async (t) => {
  const releases: Array<() => void> = [];
  let running = 0; let maximum = 0;
  const slow: ModelWorker = { identity: worker.identity, async run(session) {
    running += 1; maximum = Math.max(maximum, running);
    await new Promise<void>((resolve) => releases.push(resolve));
    running -= 1; await worker.run(session);
  } };
  const queue = new ChangeRequests(':memory:', () => slow); t.after(() => queue.close());
  const repo = await RoomRepository.create();
  for (const [id, name] of [['first', 'first-entry'], ['second', 'second-entry'], ['third', 'third-entry']] satisfies [string, string][]) {
    await queue.submit(repo.serialize(), request(repo, id, name));
  }
  await waitFor(queue, 'first', ['working']);
  assert.equal(queue.get('third').state, 'queued');
  assert.equal(maximum, 2);
  await decide(queue, 'first', { action: 'cancel', decisionId: 'cancel-first' });
  releases[0]?.(); releases[1]?.();
  await waitFor(queue, 'second');
  await waitFor(queue, 'third', ['working']);
  for (let attempt = 0; releases.length < 3 && attempt < 400; attempt += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.equal(releases.length, 3);
  releases[2]?.(); await waitFor(queue, 'third');
  assert.equal(queue.get('first').state, 'cancelled'); assert.equal(queue.get('first').result, null);
  assert.equal(maximum, 2);
});

test('acceptance and its ticket decision are atomic, replay-safe and cannot overwrite intervening work', async (t) => {
  const queue = new ChangeRequests(':memory:', () => worker); t.after(() => queue.close());
  const repo = await RoomRepository.create();
  await queue.submit(repo.serialize(), request(repo, 'one', 'one-entry'));
  await queue.submit(repo.serialize(), request(repo, 'two', 'two-entry', 1300));
  await waitFor(queue, 'one'); await waitFor(queue, 'two');
  const proposal = queue.get('one').result; assert.ok(proposal);
  const accepted = await decide(queue, 'one', { action: 'accept', decisionId: 'decision-one' });
  const current = await RoomRepository.restore(accepted.project);
  assert.equal(current.head('main'), current.head('one-entry'));
  assert.equal(accepted.ticket.state, 'completed');
  assert.equal((await decide(queue, 'one', { action: 'accept', decisionId: 'decision-one' })).project, accepted.project);
  await assert.rejects(() => decide(queue, 'one', { action: 'reject', decisionId: 'decision-one' }), /another action/);
  await assert.rejects(() => decide(queue, 'two', { action: 'accept', decisionId: 'decision-two' }), /older or unaccepted/);
  assert.equal(queue.project(repo.projectId), accepted.project);
  assert.equal(queue.get('two').state, 'needs-input');
  await assert.rejects(() => queue.submit(repo.serialize(), request(repo, 'old-client', 'old-client-entry')), /server model changed/);
  const revised = await queue.revise('two', current.serialize(), request(current, 'two-revised', 'revised-entry', 1300));
  assert.equal(revised.id, 'two'); assert.equal(revised.history.length, 1);
  await waitFor(queue, 'two');
  const second = await decide(queue, 'two', { action: 'accept', decisionId: 'decision-two-revised' });
  const final = await RoomRepository.restore(second.project);
  assert.equal(final.head('main'), final.head('revised-entry'));
  assert.ok(final.view(current.head('main')), 'accepted predecessor remains in history');
});

test('server restart recovers interrupted work without trusting a stale working marker', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-backlog-restart-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite');
  let release: (() => void) | undefined;
  const stopped: ModelWorker = { identity: worker.identity, async run() { await new Promise<void>((resolve) => { release = resolve; }); } };
  const queue = new ChangeRequests(file, () => stopped);
  const repo = await RoomRepository.create();
  await queue.submit(repo.serialize(), request(repo, 'interrupted', 'recovered-entry'));
  await waitFor(queue, 'interrupted', ['working']);
  queue.close();
  const resumed = new ChangeRequests(file, () => worker); t.after(() => resumed.close());
  release?.();
  await waitFor(resumed, 'interrupted');
  assert.equal(resumed.get('interrupted').state, 'ready');
  assert.equal(resumed.get('interrupted').attempts, 2);
  assert.equal((await RoomRepository.restore(resumed.project(repo.projectId))).head('main'), repo.head('main'));
});

test('failed and declined requests remain readable; retries are bounded and rejection preserves the model', async (t) => {
  const broken: ModelWorker = { identity: worker.identity, async run() { throw new Error('Controlled provider failure.'); } };
  const queue = new ChangeRequests(':memory:', () => broken); t.after(() => queue.close());
  const repo = await RoomRepository.create();
  await queue.submit(repo.serialize(), request(repo, 'failed', 'failed-entry'));
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await waitFor(queue, 'failed');
    assert.equal(queue.get('failed').error, 'Controlled provider failure.');
    if (attempt < 3) await decide(queue, 'failed', { action: 'retry', decisionId: `retry-${attempt}` });
  }
  await assert.rejects(() => decide(queue, 'failed', { action: 'retry', decisionId: 'retry-exhausted' }), /three attempts/);
  await decide(queue, 'failed', { action: 'reject', decisionId: 'reject-failed' });
  assert.equal(queue.get('failed').state, 'rejected'); assert.equal(queue.project(repo.projectId), repo.serialize());
  const clarifier = new ChangeRequests(':memory:', () => ({ identity: worker.identity, async run(session) {
    await session.executeTool('decline_request', { reason: 'Where should the screen go if only the desk moves?', uncertainty: 'Device destination is unspecified.' });
  } })); t.after(() => clarifier.close());
  await clarifier.submit(repo.serialize(), request(repo, 'clarify', 'clarify-entry')); await waitFor(clarifier, 'clarify');
  assert.equal(clarifier.get('clarify').state, 'needs-input'); assert.equal(clarifier.get('clarify').result?.status, 'declined');
});

test('concurrent delivery of the same submission, decision and revision converges to one outcome', async (t) => {
  const queue = new ChangeRequests(':memory:', () => worker); t.after(() => queue.close());
  const repo = await RoomRepository.create();
  const initial = request(repo, 'concurrent-first', 'concurrent-first');
  const submitted = await Promise.all([queue.submit(repo.serialize(), initial), queue.submit(repo.serialize(), initial)]);
  assert.equal(submitted[0].id, submitted[1].id); assert.equal(queue.list(repo.projectId).length, 1);
  await waitFor(queue, initial.requestId);
  const decision = { action: 'accept', decisionId: 'concurrent-accept' };
  const accepted = await Promise.all([decide(queue, initial.requestId, decision), decide(queue, initial.requestId, decision)]);
  assert.equal(accepted[0].project, accepted[1].project);
  const current = await RoomRepository.restore(accepted[0].project);
  const second = request(current, 'concurrent-second', 'concurrent-second', 1300);
  const tickets = await Promise.all([queue.submit(current.serialize(), second), queue.submit(current.serialize(), second)]);
  assert.equal(tickets[0].id, tickets[1].id); await waitFor(queue, second.requestId);
  const updated = request(current, 'concurrent-revision', 'concurrent-revision', 1400);
  await Promise.all([queue.revise(second.requestId, current.serialize(), updated), queue.revise(second.requestId, current.serialize(), updated)]);
  assert.equal(queue.get(second.requestId).history.length, 1);
  await waitFor(queue, second.requestId);
  await assert.rejects(() => queue.decide(second.requestId, { action: 'accept', decisionId: 'stale-review',
    expectedRequestId: second.requestId }), /newer revision/);
  assert.equal(queue.list(repo.projectId).length, 2);
});

test('working requests expose real tool progress before completion, persist it, and ignore late activity after cancellation', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-activity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite');
  const releases: Array<() => void> = [];
  const slow: ModelWorker = { identity: worker.identity, async run(session) {
    await session.executeTool('inspect_model', {});
    await session.executeTool('preview_furnishings', { furnishings: [{ secret: 'do-not-persist-tool-arguments' }] });
    await new Promise<void>((resolve) => releases.push(resolve));
    await worker.run(session);
  } };
  let queue = new ChangeRequests(file, () => slow);
  const repo = await RoomRepository.create(); const input = request(repo, 'activity-live', 'activity-live');
  await queue.submit(repo.serialize(), input);
  for (let i = 0; releases.length < 1 && i < 400; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5));
  const working = queue.get(input.requestId); assert.equal(working.state, 'working'); assert.equal(working.result, null);
  assert.ok(working.activity.some((event) => event.stage === 'inspecting'));
  assert.ok(working.activity.some((event) => event.stage === 'validation-failed'));
  assert.equal(JSON.stringify(working.activity).includes('do-not-persist-tool-arguments'), false);
  assert.ok(working.activity.every((event) => event.requestId === input.requestId));
  assert.equal(Object.hasOwn(queue.list(repo.projectId)[0] ?? {}, 'activity'), false, 'backlog summaries do not repeatedly transfer full action journals');
  await decide(queue, input.requestId, { action: 'cancel', decisionId: 'cancel-activity' });
  const cancelled = JSON.stringify(queue.get(input.requestId).activity);
  releases[0]?.(); await new Promise<void>((resolve) => setTimeout(resolve, 30));
  assert.equal(JSON.stringify(queue.get(input.requestId).activity), cancelled);
  queue.close(); queue = new ChangeRequests(file, () => null); t.after(() => queue.close());
  assert.equal(JSON.stringify(queue.get(input.requestId).activity), cancelled);
  assert.equal(queue.project(repo.projectId), repo.serialize());
});

test('server recovery and revisions keep attempt activity bound to the correct request version', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-activity-restart-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite'); let release: (() => void) | undefined;
  const queue = new ChangeRequests(file, () => ({ identity: worker.identity, async run(session) {
    await session.executeTool('inspect_model', {}); await new Promise<void>((resolve) => { release = resolve; }); await worker.run(session);
  } }));
  const repo = await RoomRepository.create(); const first = request(repo, 'activity-recovery', 'activity-recovery');
  await queue.submit(repo.serialize(), first);
  for (let i = 0; !release && i < 400; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5));
  queue.close();
  const restored = new ChangeRequests(file, () => worker); t.after(() => restored.close()); release?.();
  await waitFor(restored, first.requestId); assert.equal(restored.get(first.requestId).state, 'ready');
  const events = restored.get(first.requestId).activity;
  assert.ok(events.some((event) => event.stage === 'recovered'));
  assert.ok(events.some((event) => event.stage === 'ready' && event.attempt === 2));
  assert.ok(events.every((event, i) => i === 0 || event.sequence > events[i - 1].sequence));
  const revision = request(repo, 'activity-revised', 'activity-revised', 1300);
  await restored.revise(first.requestId, repo.serialize(), revision); await waitFor(restored, first.requestId);
  const next = restored.get(first.requestId);
  assert.ok(next.activity.every((event) => event.requestId === revision.requestId));
  assert.ok(next.history[0]?.includes('activity-recovery'));
  assert.equal(next.activity.filter((event) => event.stage === 'ready').length, 1);
});

test('legacy tickets without activity remain readable; malformed or mixed-version activity fails closed', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-old-activity-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite'); const queue = new ChangeRequests(file, () => null);
  const repo = await RoomRepository.create(); await queue.submit(repo.serialize(), request(repo, 'old-ticket', 'old-ticket'));
  const { activity, ...old } = queue.get('old-ticket'); queue.close();
  const db = new DatabaseSync(file); db.prepare('UPDATE requests SET body=? WHERE id=?').run(JSON.stringify(old), 'old-ticket'); db.close();
  const restored = new ChangeRequests(file, () => null); t.after(() => restored.close());
  assert.deepEqual(restored.get('old-ticket').activity, []);
  assert.throws(() => parseRequestActivity([{ ...activity[0], stage: 'private-reasoning' }]), /Invalid/);
  assert.throws(() => parseRequestActivity([activity[0], activity[0]]), /Invalid/);
  assert.throws(() => parseRequestActivity(Array.from({ length: 97 }, (_, i) => ({ ...activity[0], sequence: i + 1 }))), /Invalid/);
  assert.throws(() => parseRequestActivity([{ ...activity[0], message: 'x'.repeat(301) }]), /Invalid/);
  const corrupt = new DatabaseSync(file); corrupt.prepare('UPDATE requests SET body=? WHERE id=?').run(JSON.stringify({ ...old, activity: activity.map((event) => ({ ...event, requestId: 'another-request' })) }), 'old-ticket'); corrupt.close();
  assert.throws(() => restored.get('old-ticket'), /another request revision/);
});
