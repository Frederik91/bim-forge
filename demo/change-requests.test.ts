import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChangeRequests, BacklogConflict } from './change-requests.ts';
import { RoomRepository, rectangleLayout } from '../src/room-model.ts';
import type { ModelWorker, ModelWorkerSession } from '../src/model-proposal.ts';

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
