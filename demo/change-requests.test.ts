import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChangeRequests, BacklogConflict } from './change-requests.ts';
import { RoomRepository, rectangleLayout, previewFurnishings, previewRectangle } from '../src/room-model.ts';
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
  const output = await session.executeTool('run_model_script', { language: 'javascript', source: `
    await model.inspect();
    await model.previewRectangle(${JSON.stringify(visual.layout)});
    return { kind: 'propose', review: {
      intent: {interpretation:'Widen the entry.',assumptions:[],certainty:90,basis:'The fixture request specifies the width.'},
      summary: 'Widen the entry.', rationale: 'Requested width fits the host.',
      constraints: 'Keep the room shell and hosting.', uncertainty: 'Concept model, not construction approval.'
    } };
  ` });
  assert.equal(output.done, true);
} };

function pause(signal: AbortSignal, capture: (release: () => void) => void): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = (): void => { signal.removeEventListener('abort', finish); resolve(); };
    capture(finish);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

function inspect(session: ModelWorkerSession): Promise<Record<string, unknown>> {
  return session.executeTool('run_model_script', { language: 'javascript',
    source: "return { kind: 'observe', observation: await model.inspect() };" });
}

test('optional names derive from intent and stable identity; concurrent unnamed requests, retries and revisions remain distinct', async (t) => {
  const queue = await ChangeRequests.open(':memory:', () => worker); t.after(() => queue.close());
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
  for (let attempt = 0; attempt < 4000; attempt += 1) {
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
  let queue = await ChangeRequests.open(file, () => null);
  const input = request(repo, 'durable', 'durable-entry');
  assert.equal((await queue.submit(repo.serialize(), input)).state, 'queued');
  assert.equal((await queue.submit(repo.serialize(), input)).id, 'durable');
  await assert.rejects(() => queue.submit(repo.serialize(), { ...input, instruction: 'Another outcome.' }), BacklogConflict);
  await queue.close();
  queue = await ChangeRequests.open(file, () => worker);
  t.after(() => queue.close());
  await waitFor(queue, 'durable');
  assert.equal(queue.get('durable').state, 'ready');
  assert.equal(queue.list(repo.projectId).length, 1);
  assert.equal((await RoomRepository.restore(queue.project(repo.projectId))).head('main'), repo.head('main'));
  assert.equal(queue.list(crypto.randomUUID()).length, 0, 'other projects cannot see this backlog');
});

test('multiple tickets queue immediately; only two agents run and cancellation cannot publish late results', async (t) => {
  const releases: Array<() => void> = [];
  const signals: AbortSignal[] = [];
  let running = 0; let maximum = 0;
  const slow: ModelWorker = { identity: worker.identity, async run(session) {
    running += 1; maximum = Math.max(maximum, running);
    signals.push(session.signal);
    await pause(session.signal, (resolve) => releases.push(resolve));
    running -= 1; await worker.run(session);
  } };
  const queue = await ChangeRequests.open(':memory:', () => slow); t.after(() => queue.close());
  const repo = await RoomRepository.create();
  for (const [id, name] of [['first', 'first-entry'], ['second', 'second-entry'], ['third', 'third-entry']] satisfies [string, string][]) {
    await queue.submit(repo.serialize(), request(repo, id, name));
  }
  await waitFor(queue, 'first', ['working']);
  for (let i = 0; signals.length < 2 && i < 4000; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.equal(queue.get('third').state, 'queued');
  assert.equal(maximum, 2);
  await decide(queue, 'first', { action: 'cancel', decisionId: 'cancel-first' });
  assert.equal(signals[0]?.aborted, true);
  assert.equal(signals[1]?.aborted, false);
  assert.notEqual(signals[0], signals[1]);
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
  const queue = await ChangeRequests.open(':memory:', () => worker); t.after(() => queue.close());
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
  await assert.rejects(() => decide(queue, 'two', { action: 'accept', decisionId: 'decision-two' }), /Conflicting changes to door-entry/);
  assert.equal(queue.project(repo.projectId), accepted.project);
  assert.equal(queue.get('two').state, 'needs-input');
  assert.match(queue.get('two').error ?? '', /Conflicting changes to door-entry/);
  await assert.rejects(() => queue.submit(repo.serialize(), request(repo, 'old-client', 'old-client-entry')), /server model changed/);
  const revised = await queue.revise('two', current.serialize(), request(current, 'two-revised', 'revised-entry', 1300));
  assert.equal(revised.id, 'two'); assert.equal(revised.history.length, 1);
  await waitFor(queue, 'two');
  const second = await decide(queue, 'two', { action: 'accept', decisionId: 'decision-two-revised' });
  const final = await RoomRepository.restore(second.project);
  assert.equal(final.head('main'), final.head('revised-entry'));
  assert.ok(final.view(current.head('main')), 'accepted predecessor remains in history');
});

for (const finishesLate of [false, true]) test(`two independent chair proposals remain accept-ready after the first is accepted (${finishesLate ? 'second finishes later' : 'both finished'})`, async (t) => {
  const shell = await RoomRepository.create();
  const snapshot = previewFurnishings(shell.view(shell.head('main')).snapshot, { furnishings: [
    { id: 'chair-one', type: 'Furniture', kind: 'chair', name: 'Chair one', position: [1, 2], width: .6, depth: .6, height: 1, rotationDeg: 0, supportId: null },
    { id: 'chair-two', type: 'Furniture', kind: 'chair', name: 'Chair two', position: [4, 2], width: .6, depth: .6, height: 1, rotationDeg: 0, supportId: null },
  ] });
  const repo = await RoomRepository.createProject({ projectId: shell.projectId, name: 'Concurrent chair review', snapshot });
  let releaseSecond: (() => void) | undefined;
  const rotate: ModelWorker = { identity: worker.identity, async run(session) {
    const input = session.input;
    assert.ok(input && typeof input === 'object' && 'request' in input && input.request && typeof input.request === 'object' && 'selectedObjectIds' in input.request);
    const ids = input.request.selectedObjectIds;
    assert.ok(Array.isArray(ids) && typeof ids[0] === 'string');
    if (finishesLate && ids[0] === 'chair-two') await pause(session.signal, release => { releaseSecond = release; });
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: `
      await model.inspect();
      await model.previewFurnishings(${JSON.stringify({ furnishings: snapshot.entities.filter(item => item.type === 'Furniture').map(item => item.id === ids[0] ? { ...item, rotationDeg: 180 } : item) })});
      return { kind: 'propose', review: { intent:{interpretation:'Rotate one chair.',assumptions:[],certainty:95,basis:'The fixture specifies the chair and rotation.'}, summary: 'Rotate one chair.', rationale: 'Rotate the selected chair in place.', constraints: 'Preserve every other object.', uncertainty: 'Concept review only.' } };
    ` });
    assert.equal(output.ok, true);
  } };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-independent-chairs-'));
  const file = path.join(directory, 'requests.sqlite');
  const queue = await ChangeRequests.open(file, () => rotate);
  t.after(async () => { await queue.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  for (const [id, chair] of [['first-chair', 'chair-one'], ['second-chair', 'chair-two']] satisfies [string, string][]) {
    await queue.submit(repo.serialize(), { ...request(repo, id, id), selectedObjectIds: [chair], instruction: 'Rotate the selected chair 180 degrees in place.' });
  }
  await waitFor(queue, 'first-chair');
  await waitFor(queue, 'second-chair', finishesLate ? ['working'] : ['ready']);
  assert.equal(queue.get('first-chair').state, 'ready');
  const originalReview = queue.get('second-chair').result;
  await decide(queue, 'first-chair', { action: 'accept', decisionId: 'accept-first-chair' });
  if (finishesLate) { assert.ok(releaseSecond); releaseSecond(); await waitFor(queue, 'second-chair'); }
  assert.equal(queue.get('second-chair').state, 'ready', 'an unrelated accepted chair change must not require a request revision');
  const staleDatabase = new DatabaseSync(file);
  const stale = { ...queue.get('second-chair'), state: 'needs-input', error: 'The accepted model changed. Revise this request against the current model before accepting.' };
  staleDatabase.prepare("UPDATE requests SET state=?, body=json_set(body, '$.state', ?, '$.error', ?) WHERE id=?").run(stale.state, stale.state, stale.error, stale.id);
  staleDatabase.close();
  await queue.refreshProject(repo.projectId);
  assert.equal(queue.get('second-chair').state, 'ready', 'recover compatible tickets marked stale by older versions without rerunning the agent');
  const accepted = await decide(queue, 'second-chair', { action: 'accept', decisionId: 'accept-second-chair' });
  const final = await RoomRepository.restore(accepted.project);
  assert.deepEqual(final.view(final.head('main')).snapshot.entities.filter(item => item.type === 'Furniture').map(item => item.rotationDeg), [180, 180]);
  assert.equal(accepted.ticket.state, 'completed');
  if (!finishesLate) assert.deepEqual(queue.get('second-chair').result, originalReview, 'retain the original immutable reviewed proposal');
  assert.equal((await decide(queue, 'second-chair', { action: 'accept', decisionId: 'accept-second-chair' })).project, accepted.project);
});

test('server restart recovers interrupted work without trusting a stale working marker', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-backlog-restart-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite');
  let signal: AbortSignal | undefined;
  const stopped: ModelWorker = { identity: worker.identity, async run(session) {
    signal = session.signal; await pause(session.signal, () => {});
  } };
  const queue = await ChangeRequests.open(file, () => stopped);
  const repo = await RoomRepository.create();
  await queue.submit(repo.serialize(), request(repo, 'interrupted', 'recovered-entry'));
  await waitFor(queue, 'interrupted', ['working']);
  for (let i = 0; !signal && i < 4000; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5));
  await queue.close();
  assert.equal(signal?.aborted, true);
  const resumed = await ChangeRequests.open(file, () => worker); t.after(() => resumed.close());
  await waitFor(resumed, 'interrupted');
  assert.equal(resumed.get('interrupted').state, 'ready');
  assert.equal(resumed.get('interrupted').attempts, 2);
  assert.equal((await RoomRepository.restore(resumed.project(repo.projectId))).head('main'), repo.head('main'));
});

test('failed and declined requests remain readable; retries are bounded and rejection preserves the model', async (t) => {
  const broken: ModelWorker = { identity: worker.identity, async run() { throw new Error('Controlled provider failure.'); } };
  const queue = await ChangeRequests.open(':memory:', () => broken); t.after(() => queue.close());
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
  const clarifier = await ChangeRequests.open(':memory:', () => ({ identity: worker.identity, async run(session) {
    await session.executeTool('run_model_script', { language: 'javascript', source: `return { kind: 'decline',
      reason: 'Where should the screen go if only the desk moves?', uncertainty: 'Device destination is unspecified.' };` });
  } })); t.after(() => clarifier.close());
  await clarifier.submit(repo.serialize(), request(repo, 'clarify', 'clarify-entry')); await waitFor(clarifier, 'clarify');
  assert.equal(clarifier.get('clarify').state, 'needs-input'); assert.equal(clarifier.get('clarify').result?.status, 'declined');
  assert.equal(clarifier.executions('clarify')[0]?.evidence.disposition, 'declined');
});

test('concurrent delivery of the same submission, decision and revision converges to one outcome', async (t) => {
  const queue = await ChangeRequests.open(':memory:', () => worker); t.after(() => queue.close());
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
    await session.executeTool('run_model_script', { language: 'javascript', source: `
      await model.inspect();
      try { await model.previewFurnishings({ furnishings: [{ id: 'bad-plant', type: 'Furniture',
        name: 'do-not-persist-tool-arguments', kind: 'plant', position: [10000, 10000],
        width: 0.5, depth: 0.5, height: 1, rotationDeg: 0, supportId: null }] }); } catch {}
      return { kind: 'observe', observation: null };
    ` });
    await pause(session.signal, (resolve) => releases.push(resolve));
    await worker.run(session);
  } };
  let queue = await ChangeRequests.open(file, () => slow);
  const repo = await RoomRepository.create(); const input = request(repo, 'activity-live', 'activity-live');
  await queue.submit(repo.serialize(), input);
  for (let i = 0; releases.length < 1 && i < 4000; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5));
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
  await queue.close(); queue = await ChangeRequests.open(file, () => null); t.after(() => queue.close());
  assert.equal(JSON.stringify(queue.get(input.requestId).activity), cancelled);
  assert.equal(queue.project(repo.projectId), repo.serialize());
});

test('server recovery and revisions keep attempt activity bound to the correct request version', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-activity-restart-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite'); let release: (() => void) | undefined;
  const queue = await ChangeRequests.open(file, () => ({ identity: worker.identity, async run(session) {
    await inspect(session); await pause(session.signal, (resolve) => { release = resolve; }); await worker.run(session);
  } }));
  const repo = await RoomRepository.create(); const first = request(repo, 'activity-recovery', 'activity-recovery');
  await queue.submit(repo.serialize(), first);
  for (let i = 0; !release && i < 4000; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5));
  await queue.close();
  const restored = await ChangeRequests.open(file, () => worker); t.after(() => restored.close()); release?.();
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
  const file = path.join(directory, 'requests.sqlite'); const queue = await ChangeRequests.open(file, () => null);
  const repo = await RoomRepository.create(); await queue.submit(repo.serialize(), request(repo, 'old-ticket', 'old-ticket'));
  const { activity } = queue.get('old-ticket'); await queue.close();
  const db = new DatabaseSync(file); const row = db.prepare('SELECT body FROM requests WHERE id=?').get('old-ticket'); assert.ok(row && typeof row.body === 'string'); const saved: unknown = JSON.parse(row.body); assert.ok(saved && typeof saved === 'object' && !Array.isArray(saved)); const old = Object.fromEntries(Object.entries(saved).filter(([key]) => key !== 'activity')); db.prepare('UPDATE requests SET body=? WHERE id=?').run(JSON.stringify(old), 'old-ticket'); db.close();
  const restored = await ChangeRequests.open(file, () => null); t.after(() => restored.close());
  assert.deepEqual(restored.get('old-ticket').activity, []);
  assert.deepEqual(restored.executions('old-ticket'), []);
  assert.throws(() => parseRequestActivity([{ ...activity[0], stage: 'private-reasoning' }]), /Invalid/);
  assert.throws(() => parseRequestActivity([activity[0], activity[0]]), /Invalid/);
  assert.throws(() => parseRequestActivity(Array.from({ length: 97 }, (_, i) => ({ ...activity[0], sequence: i + 1 }))), /Invalid/);
  assert.throws(() => parseRequestActivity([{ ...activity[0], message: 'x'.repeat(301) }]), /Invalid/);
  const corrupt = new DatabaseSync(file); corrupt.prepare('UPDATE requests SET body=? WHERE id=?').run(JSON.stringify({ ...old, activity: activity.map((event) => ({ ...event, requestId: 'another-request' })) }), 'old-ticket'); corrupt.close();
  assert.throws(() => restored.get('old-ticket'), /another request revision/);
});

test('execution evidence survives provider failure, retries, revisions and reopening without overwriting earlier executions', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-execution-journal-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite');
  let failProvider = true;
  let queue = await ChangeRequests.open(file, () => ({ identity: worker.identity, async run(session) {
    await inspect(session);
    if (failProvider) throw new Error('Provider stopped after inspection.');
    await worker.run(session);
  } }));
  t.after(() => queue.close());
  const repo = await RoomRepository.create(); const first = request(repo, 'journal-first', 'journal-first');
  await queue.submit(repo.serialize(), first); await waitFor(queue, first.requestId);
  assert.equal(queue.get(first.requestId).state, 'failed');
  assert.equal(queue.get(first.requestId).result, null);
  const initial = queue.executions(first.requestId);
  assert.equal(initial.length, 1);
  assert.equal(initial[0]?.evidence.status, 'completed');
  assert.equal(initial[0]?.attempt, 1);
  failProvider = false;
  await decide(queue, first.requestId, { action: 'retry', decisionId: 'journal-retry' });
  await waitFor(queue, first.requestId);
  assert.equal(queue.get(first.requestId).state, 'ready');
  const retried = queue.executions(first.requestId);
  assert.deepEqual(retried.slice(0, initial.length), initial);
  assert.equal(retried.length, 3);
  assert.ok(retried.slice(1).every((entry) => entry.attempt === 2 && entry.requestId === first.requestId));
  assert.equal(new Set(retried.map((entry) => entry.evidence.executionId)).size, retried.length);
  const revision = request(repo, 'journal-revised', 'journal-revised', 1300);
  await queue.revise(first.requestId, repo.serialize(), revision); await waitFor(queue, first.requestId);
  const revised = queue.executions(first.requestId);
  assert.deepEqual(revised.slice(0, retried.length), retried);
  assert.ok(revised.slice(retried.length).every((entry) => entry.requestId === revision.requestId && entry.attempt === 1));
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  assert.deepEqual(queue.executions(first.requestId), revised);
  assert.equal(queue.project(repo.projectId), repo.serialize());
});

test('a failed execution journal write fails the attempt closed', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-execution-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite');
  const queue = await ChangeRequests.open(file, () => worker); t.after(() => queue.close());
  const db = new DatabaseSync(file);
  db.exec("CREATE TRIGGER refuse_evidence BEFORE INSERT ON request_executions BEGIN SELECT RAISE(FAIL, 'execution journal unavailable'); END;");
  db.close();
  const repo = await RoomRepository.create();
  await queue.submit(repo.serialize(), request(repo, 'no-evidence', 'no-evidence'));
  await waitFor(queue, 'no-evidence');
  assert.equal(queue.get('no-evidence').state, 'failed');
  assert.match(queue.get('no-evidence').error ?? '', /execution journal unavailable/);
  assert.equal(queue.get('no-evidence').result, null);
  assert.deepEqual(queue.executions('no-evidence'), []);
  assert.equal(queue.project(repo.projectId), repo.serialize());
});

function legacyCopy(sourceFile: string, legacyFile: string, project: string, tickets: readonly ReturnType<ChangeRequests['get']>[]): void {
  const source = new DatabaseSync(sourceFile, { readOnly: true });
  const legacy = new DatabaseSync(legacyFile);
  try {
    for (const table of ['projects', 'requests', 'submissions', 'request_executions', 'request_source_blobs', 'request_source_identities', 'request_source_bindings', 'request_source_memberships']) {
      const definition = source.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
      assert.ok(definition && typeof definition.sql === 'string');
      legacy.exec(table === 'projects' ? 'CREATE TABLE projects (id TEXT PRIMARY KEY, body TEXT NOT NULL)' : definition.sql);
      for (const row of source.prepare(`SELECT * FROM ${table}`).all()) {
        if (table === 'projects') {
          assert.equal(typeof row.id, 'string');
          legacy.prepare('INSERT INTO projects(id,body) VALUES(?,?)').run(row.id, project);
          continue;
        }
        const columns = Object.keys(row);
        legacy.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(row));
      }
    }
    const repository: unknown = JSON.parse(project);
    assert.ok(repository && typeof repository === 'object' && 'projectId' in repository && typeof repository.projectId === 'string');
    legacy.prepare('UPDATE projects SET body=? WHERE id=?').run(project, repository.projectId);
    for (const ticket of tickets) legacy.prepare('UPDATE requests SET body=? WHERE id=?').run(JSON.stringify(ticket), ticket.id);
  } finally { legacy.close(); source.close(); }
}

test('fresh project namespaces contain only IDs and register new projects after reopening', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-project-namespace-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite');
  const first = await RoomRepository.create('First namespace'); const second = await RoomRepository.create('Second namespace');
  let queue = await ChangeRequests.open(file, () => null); t.after(() => queue.close());
  await queue.importProject(first.serialize()); await queue.submit(first.serialize(), request(first, 'namespace-first', 'namespace-first'));
  await queue.close();
  const initial = new DatabaseSync(file, { readOnly: true });
  assert.deepEqual(initial.prepare('PRAGMA table_info(projects)').all().map((column) => column.name), ['id']);
  assert.deepEqual(initial.prepare('PRAGMA foreign_key_check').all(), []); initial.close();
  queue = await ChangeRequests.open(file, () => null);
  await queue.importProject(second.serialize()); await queue.submit(second.serialize(), request(second, 'namespace-second', 'namespace-second'));
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  assert.equal(queue.project(first.projectId), first.serialize()); assert.equal(queue.project(second.projectId), second.serialize());
  assert.equal(queue.get('namespace-first').state, 'queued'); assert.equal(queue.get('namespace-second').state, 'queued');
});

test('normalized V1 sentinel cleanup is atomic, refuses unexpected bodies and supports registration after cleanup', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-normalized-namespace-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite'); const repo = await RoomRepository.create('Normalized namespace');
  let queue = await ChangeRequests.open(file, () => null);
  await queue.submit(repo.serialize(), request(repo, 'normalized-ticket', 'normalized-ticket')); const ticket = queue.get('normalized-ticket');
  await queue.close();
  const db = new DatabaseSync(file);
  db.exec("ALTER TABLE projects ADD COLUMN body TEXT NOT NULL DEFAULT 'versioned'");
  const stored = db.prepare('SELECT body FROM requests WHERE id=?').get(ticket.id); assert.ok(stored && typeof stored.body === 'string');
  db.prepare("UPDATE requests SET state='working',body='invalid working ticket'").run();
  const head = db.prepare('SELECT document_id FROM versioned_projects WHERE project_id=?').get(repo.projectId)?.document_id;
  db.close();
  let workerChecks = 0;
  await assert.rejects(() => ChangeRequests.open(file, () => { workerChecks++; return null; }), /JSON/);
  assert.equal(workerChecks, 0, 'Startup failure cannot start the pump.');
  const rolledBack = new DatabaseSync(file);
  assert.deepEqual(rolledBack.prepare('PRAGMA table_info(projects)').all().map((column) => column.name), ['id', 'body']);
  assert.equal(rolledBack.prepare('SELECT body FROM projects').get()?.body, 'versioned');
  assert.equal(rolledBack.prepare('SELECT document_id FROM versioned_projects WHERE project_id=?').get(repo.projectId)?.document_id, head);
  rolledBack.prepare("UPDATE requests SET state='queued',body=? WHERE id=?").run(stored.body, ticket.id); rolledBack.close();
  for (const body of [' versioned', repo.serialize()]) {
    const unexpected = new DatabaseSync(file); unexpected.prepare('UPDATE projects SET body=?').run(body); unexpected.close();
    await assert.rejects(() => ChangeRequests.open(file, () => { workerChecks++; return null; }), /Unexpected normalized project marker/);
    const retained = new DatabaseSync(file, { readOnly: true });
    assert.equal(retained.prepare('SELECT body FROM projects').get()?.body, body);
    assert.equal(retained.prepare('SELECT body FROM requests WHERE id=?').get(ticket.id)?.body, stored.body); retained.close();
    assert.equal(workerChecks, 0);
  }
  const repaired = new DatabaseSync(file); repaired.exec("UPDATE projects SET body='versioned'"); repaired.close();
  queue = await ChangeRequests.open(file, () => null); t.after(() => queue.close());
  assert.deepEqual(queue.get(ticket.id), ticket); assert.equal(queue.project(repo.projectId), repo.serialize());
  const cleaned = new DatabaseSync(file, { readOnly: true });
  assert.deepEqual(cleaned.prepare('PRAGMA table_info(projects)').all().map((column) => column.name), ['id']);
  assert.deepEqual(cleaned.prepare('PRAGMA foreign_key_check').all(), []); cleaned.close();
  const next = await RoomRepository.create('After normalized cleanup');
  await queue.importProject(next.serialize()); await queue.submit(next.serialize(), request(next, 'after-cleanup', 'after-cleanup'));
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  assert.equal(queue.project(next.projectId), next.serialize()); assert.equal(queue.get('after-cleanup').state, 'queued');
});

test('failure after dropping legacy project bodies restores original bytes and schema until migration can finish', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-namespace-rollback-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, 'source.sqlite'); const file = path.join(directory, 'legacy.sqlite');
  const repo = await RoomRepository.create('Legacy namespace rollback');
  const source = await ChangeRequests.open(sourceFile, () => null);
  await source.submit(repo.serialize(), request(repo, 'legacy-namespace', 'legacy-namespace')); const ticket = source.get('legacy-namespace');
  await source.close(); legacyCopy(sourceFile, file, repo.serialize(), [ticket]);
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE queue_storage_metadata (version INTEGER PRIMARY KEY CHECK(version=1)); CREATE TRIGGER refuse_migration_seal BEFORE INSERT ON queue_storage_metadata BEGIN SELECT RAISE(FAIL, 'migration seal unavailable'); END;"); db.close();
  let workerChecks = 0;
  await assert.rejects(() => ChangeRequests.open(file, () => { workerChecks++; return null; }), /migration seal unavailable/);
  assert.equal(workerChecks, 0);
  const rolledBack = new DatabaseSync(file);
  assert.deepEqual(rolledBack.prepare('PRAGMA table_info(projects)').all().map((column) => column.name), ['id', 'body']);
  assert.equal(rolledBack.prepare('SELECT body FROM projects').get()?.body, repo.serialize());
  assert.equal(rolledBack.prepare('SELECT body FROM requests WHERE id=?').get(ticket.id)?.body, JSON.stringify(ticket));
  assert.equal(rolledBack.prepare('SELECT COUNT(*) AS count FROM queue_storage_metadata').get()?.count, 0);
  assert.equal(rolledBack.prepare("SELECT name FROM sqlite_master WHERE name='versioned_projects'").get(), undefined);
  rolledBack.exec('DROP TRIGGER refuse_migration_seal'); rolledBack.close();
  let queue = await ChangeRequests.open(file, () => null); t.after(() => queue.close());
  assert.deepEqual(queue.get(ticket.id), ticket);
  const next = await RoomRepository.create('After legacy migration');
  await queue.importProject(next.serialize()); await queue.submit(next.serialize(), request(next, 'after-migration', 'after-migration'));
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  assert.equal(queue.project(repo.projectId), repo.serialize()); assert.equal(queue.project(next.projectId), next.serialize());
  const migrated = new DatabaseSync(file, { readOnly: true });
  assert.deepEqual(migrated.prepare('PRAGMA table_info(projects)').all().map((column) => column.name), ['id']);
  assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []); migrated.close();
});

test('a ticket publication failure rolls back accepted head, history and decision and can retry after reopening', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-publication-atomic-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite');
  let queue = await ChangeRequests.open(file, () => worker);
  t.after(() => queue.close());
  const repo = await RoomRepository.create(); const input = request(repo, 'atomic', 'atomic');
  await queue.submit(repo.serialize(), input); await waitFor(queue, input.requestId);
  const before = queue.project(repo.projectId); const ticket = queue.get(input.requestId); const executions = queue.executions(input.requestId);
  const history = queue.history({ projectId: repo.projectId, before: null, limit: 50 });
  const db = new DatabaseSync(file);
  db.exec("CREATE TRIGGER refuse_publication BEFORE UPDATE ON requests WHEN NEW.state='completed' BEGIN SELECT RAISE(FAIL, 'ticket receipt unavailable'); END;");
  db.close();
  await assert.rejects(() => decide(queue, input.requestId, { action: 'accept', decisionId: 'atomic-decision' }), /ticket receipt unavailable/);
  assert.equal(queue.project(repo.projectId), before); assert.deepEqual(queue.get(input.requestId), ticket);
  assert.deepEqual(queue.history({ projectId: repo.projectId, before: null, limit: 50 }), history);
  assert.deepEqual(queue.executions(input.requestId), executions);
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  assert.equal(queue.project(repo.projectId), before); assert.deepEqual(queue.get(input.requestId), ticket);
  const repair = new DatabaseSync(file); repair.exec('DROP TRIGGER refuse_publication'); repair.close();
  const accepted = await decide(queue, input.requestId, { action: 'accept', decisionId: 'atomic-decision' });
  assert.equal(accepted.ticket.state, 'completed'); assert.notEqual(accepted.project, before);
  assert.equal(queue.history({ projectId: repo.projectId, before: null, limit: 50 }).entries[0]?.requestId, input.requestId);
});

test('legacy projects, archived results, source bindings, replay and execution evidence migrate once and survive reopening', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-legacy-refs-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'source.sqlite'); const legacy = path.join(directory, 'legacy.sqlite');
  const repo = await RoomRepository.create('Legacy reviewed project');
  let queue = await ChangeRequests.open(file, () => worker);
  const source = await queue.addSource({ projectId: repo.projectId, id: crypto.randomUUID(), name: 'requirements.txt', mediaType: 'text/plain',
    bytes: Buffer.from('Keep the original room shell.'), signal: new AbortController().signal });
  const first = { ...request(repo, 'legacy-first', 'legacy-first'), sources: [source] };
  await queue.submit(repo.serialize(), first); await waitFor(queue, first.requestId);
  assert.equal(queue.get(first.requestId).state, 'ready');
  const second = { ...request(repo, 'legacy-second', 'legacy-second', 1100), sources: [source] };
  await queue.revise(first.requestId, repo.serialize(), second); await waitFor(queue, first.requestId);
  const accepted = await queue.decide(first.requestId, { action: 'accept', decisionId: 'legacy-accept', expectedRequestId: second.requestId });
  const ticket = queue.get(first.requestId); const executions = queue.executions(first.requestId);
  await queue.close(); legacyCopy(file, legacy, accepted.project, [ticket]);
  for (const problem of ['source-bytes', 'execution', 'review', 'root']) {
    const invalidFile = path.join(directory, `${problem}.sqlite`);
    legacyCopy(file, invalidFile, accepted.project, [ticket]);
    const damaged = new DatabaseSync(invalidFile);
    if (problem === 'source-bytes') damaged.prepare('UPDATE request_source_blobs SET bytes=? WHERE id=?').run(Buffer.alloc(source.byteLength, 65), source.id);
    else if (problem === 'execution') damaged.exec('DELETE FROM request_executions');
    else if (problem === 'review') damaged.prepare("UPDATE requests SET body=json_set(body, '$.result.review.rationale', 'Forged review text')").run();
    else {
      const layout = structuredClone(rectangleLayout(repo.view(repo.root()).snapshot)); layout.door.widthMm = 1300;
      const mismatch = await RoomRepository.createProject({ projectId: repo.projectId, name: repo.name, snapshot: previewRectangle(repo.view(repo.root()).snapshot, layout) });
      damaged.prepare('UPDATE projects SET body=?').run(mismatch.serialize());
    }
    const originalProject = damaged.prepare('SELECT body FROM projects').get()?.body;
    const originalTicket = damaged.prepare('SELECT body FROM requests').get()?.body; damaged.close();
    await assert.rejects(() => ChangeRequests.open(invalidFile, () => null), /legacy|Legacy|mismatch/);
    const unchanged = new DatabaseSync(invalidFile, { readOnly: true });
    assert.equal(unchanged.prepare('SELECT body FROM projects').get()?.body, originalProject);
    assert.equal(unchanged.prepare('SELECT body FROM requests').get()?.body, originalTicket);
    assert.equal(unchanged.prepare("SELECT name FROM sqlite_master WHERE name='queue_storage_metadata'").get(), undefined);
    unchanged.close();
  }
  queue = await ChangeRequests.open(legacy, () => null); t.after(() => queue.close());
  assert.equal(queue.project(repo.projectId), accepted.project); assert.deepEqual(queue.get(first.requestId), ticket);
  assert.deepEqual(queue.executions(first.requestId), executions);
  assert.equal(queue.source(repo.projectId, source.id).bytes.toString(), 'Keep the original room shell.');
  assert.equal((await queue.submit(repo.serialize(), first)).request.requestId, second.requestId);
  assert.deepEqual((await queue.decide(first.requestId, { action: 'accept', decisionId: 'legacy-accept', expectedRequestId: second.requestId })).ticket, ticket);
  const db = new DatabaseSync(legacy, { readOnly: true });
  const stored = db.prepare('SELECT body FROM requests').get(); assert.ok(stored && typeof stored.body === 'string');
  assert.equal(stored.body.includes('\\"revisions\\"'), false); assert.equal(stored.body.includes(repo.serialize()), false);
  const value: unknown = JSON.parse(stored.body); assert.ok(value && typeof value === 'object' && 'project' in value);
  assert.equal(typeof value.project, 'object');
  assert.ok('history' in value && Array.isArray(value.history));
  for (const archived of value.history) {
    assert.equal(typeof archived, 'string');
    const record: unknown = JSON.parse(archived);
    assert.ok(record && typeof record === 'object' && 'project' in record && typeof record.project === 'object');
    assert.ok('result' in record && record.result && typeof record.result === 'object' && 'project' in record.result && typeof record.result.project === 'object');
  }
  assert.deepEqual(db.prepare('PRAGMA table_info(projects)').all().map((column) => column.name), ['id']); db.close();
  const history = queue.history({ projectId: repo.projectId, before: null, limit: 50 });
  assert.ok(history.entries.every((entry) => entry.origin === 'imported'));
  await queue.close(); queue = await ChangeRequests.open(legacy, () => null);
  assert.deepEqual(queue.get(first.requestId), ticket); assert.deepEqual(queue.history({ projectId: repo.projectId, before: null, limit: 50 }), history);
  assert.equal(await queue.importProject(repo.serialize()), accepted.project, 'Browser state cannot rewind accepted work.');
});

test('invalid bytes in a legacy archive roll back every migration write and leave original bytes available', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-legacy-rollback-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'source.sqlite'); const legacy = path.join(directory, 'legacy.sqlite');
  const repo = await RoomRepository.create(); const queue = await ChangeRequests.open(file, () => worker);
  const input = request(repo, 'legacy-invalid', 'legacy-invalid');
  await queue.submit(repo.serialize(), input); await waitFor(queue, input.requestId);
  await queue.revise(input.requestId, repo.serialize(), request(repo, 'legacy-revision', 'legacy-revision'));
  const ticket = queue.get(input.requestId); const archive: unknown = JSON.parse(ticket.history[0] ?? 'null');
  assert.ok(archive && typeof archive === 'object');
  const invalid = { ...ticket, history: [JSON.stringify({ ...archive, project: '{invalid model bytes' })] };
  await queue.close(); legacyCopy(file, legacy, repo.serialize(), [invalid]);
  await assert.rejects(() => ChangeRequests.open(legacy, () => null), /not valid bounded JSON/);
  const db = new DatabaseSync(legacy);
  assert.equal(db.prepare('SELECT body FROM projects').get()?.body, repo.serialize());
  assert.deepEqual(db.prepare('PRAGMA table_info(projects)').all().map((column) => column.name), ['id', 'body']);
  assert.equal(db.prepare('SELECT body FROM requests').get()?.body, JSON.stringify(invalid));
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='queue_storage_metadata'").get(), undefined);
  db.prepare('UPDATE requests SET body=? WHERE id=?').run(JSON.stringify(ticket), ticket.id); db.close();
  const recovered = await ChangeRequests.open(legacy, () => null); t.after(() => recovered.close());
  assert.equal(recovered.get(input.requestId).history.length, 1);
});

test('a changed hosting constraint refuses acceptance and retains the original head and pending proposal', async (t) => {
  const repo = await RoomRepository.create('Changed hosting constraint');
  const queue = await ChangeRequests.open(':memory:', () => worker); t.after(() => queue.close());
  const wide = request(repo, 'wide-constraint', 'wide-constraint', 1200);
  const shifted = request(repo, 'shift-constraint', 'shift-constraint', 900);
  shifted.visualIntent.layout.door.offsetMm = 4900;
  await queue.submit(repo.serialize(), wide); await queue.submit(repo.serialize(), shifted);
  await waitFor(queue, wide.requestId); await waitFor(queue, shifted.requestId);
  assert.equal(queue.get(wide.requestId).state, 'ready'); assert.equal(queue.get(shifted.requestId).state, 'ready');
  await decide(queue, wide.requestId, { action: 'accept', decisionId: 'accept-wide-constraint' });
  const before = queue.project(repo.projectId); const pending = queue.get(shifted.requestId);
  assert.equal(pending.state, 'needs-input');
  await assert.rejects(() => decide(queue, shifted.requestId, { action: 'accept', decisionId: 'accept-shift-constraint' }), /combined changes fail model validation/);
  assert.equal(queue.project(repo.projectId), before); assert.deepEqual(queue.get(shifted.requestId), pending);
  assert.equal(queue.history({ projectId: repo.projectId, before: null, limit: 50 }).entries.filter((entry) => entry.origin === 'accepted').length, 1);
});

test('backlog summaries and compatible pending refresh do not hydrate archived project documents', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-summary-refs-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite');
  const queue = await ChangeRequests.open(file, () => worker); t.after(() => queue.close());
  const repo = await RoomRepository.create(); const first = request(repo, 'summary-first', 'summary-first');
  await queue.submit(repo.serialize(), first); await waitFor(queue, first.requestId);
  await queue.revise(first.requestId, repo.serialize(), request(repo, 'summary-second', 'summary-second', 1100));
  await waitFor(queue, first.requestId); const before = queue.list(repo.projectId);
  const db = new DatabaseSync(file);
  const row = db.prepare('SELECT body FROM requests WHERE id=?').get(first.requestId); assert.ok(row && typeof row.body === 'string');
  const ticket: unknown = JSON.parse(row.body);
  assert.ok(ticket && typeof ticket === 'object' && 'history' in ticket && Array.isArray(ticket.history));
  const archived: unknown = JSON.parse(ticket.history[0]);
  assert.ok(archived && typeof archived === 'object' && 'result' in archived && archived.result && typeof archived.result === 'object'
    && 'project' in archived.result && archived.result.project && typeof archived.result.project === 'object'
    && 'documentId' in archived.result.project && typeof archived.result.project.documentId === 'string');
  db.prepare("UPDATE versioned_documents SET manifest='unreadable archived document' WHERE id=?").run(archived.result.project.documentId); db.close();
  assert.deepEqual(queue.list(repo.projectId), before);
  await queue.refreshProject(repo.projectId);
  assert.deepEqual(queue.list(repo.projectId), before);
  assert.equal(queue.projects().length, 1); assert.equal(queue.project(repo.projectId), repo.serialize());
  assert.throws(() => queue.get(first.requestId), /corruption|JSON|manifest|document/i, 'An explicitly requested full review still fails closed on unreadable archive bytes.');
});

test('failed script executions remain auditable without producing a proposal', async (t) => {
  const queue = await ChangeRequests.open(':memory:', () => ({ identity: worker.identity, async run(session) {
    const output = await session.executeTool('run_model_script', { language: 'javascript', source: "throw new Error('Cannot complete this script.');" });
    assert.equal(output.ok, false);
  } })); t.after(() => queue.close());
  const repo = await RoomRepository.create();
  await queue.submit(repo.serialize(), request(repo, 'script-failure', 'script-failure')); await waitFor(queue, 'script-failure');
  assert.equal(queue.get('script-failure').state, 'failed');
  assert.equal(queue.get('script-failure').result, null);
  const executions = queue.executions('script-failure');
  assert.equal(executions.length, 1);
  assert.equal(executions[0]?.evidence.status, 'failed');
  assert.equal(queue.project(repo.projectId), repo.serialize());
});

test('cancellation retains terminal script evidence and freezes ticket activity', async (t) => {
  let executing = false;
  let signal: AbortSignal | undefined;
  const queue = await ChangeRequests.open(':memory:', () => ({ identity: worker.identity, async run(session) {
    signal = session.signal;
    await inspect(session);
    executing = true;
    await session.executeTool('run_model_script', { language: 'javascript', source: 'while (true) {}' });
  } }));
  t.after(() => queue.close());
  const repo = await RoomRepository.create();
  await queue.submit(repo.serialize(), request(repo, 'cancel-script', 'cancel-script'));
  for (let i = 0; !executing && i < 4000; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.equal(executing, true);
  await decide(queue, 'cancel-script', { action: 'cancel', decisionId: 'cancel-execution' });
  assert.equal(signal?.aborted, true);
  const cancelled = queue.get('cancel-script');
  for (let i = 0; queue.executions('cancel-script').length < 2 && i < 4000; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.ok(queue.executions('cancel-script').some((entry) => entry.evidence.status === 'cancelled'));
  assert.deepEqual(queue.get('cancel-script'), cancelled);
  assert.equal(queue.project(repo.projectId), repo.serialize());
});

test('close aborts all attempts and waits for worker cleanup before closing storage', async (t) => {
  let signal: AbortSignal | undefined;
  let releaseCleanup: (() => void) | undefined;
  const queue = await ChangeRequests.open(':memory:', () => ({ identity: worker.identity, async run(session) {
    signal = session.signal;
    await pause(session.signal, () => {});
    await new Promise<void>((resolve) => { releaseCleanup = resolve; });
  } }));
  t.after(async () => {
    const closing = queue.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseCleanup?.(); await closing;
  });
  const repo = await RoomRepository.create();
  await queue.submit(repo.serialize(), request(repo, 'shutdown', 'shutdown'));
  for (let i = 0; !signal && i < 4000; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.ok(signal);
  let closed = false;
  const closing = queue.close();
  assert.equal(queue.close(), closing);
  void closing.then(() => { closed = true; });
  assert.equal(signal.aborted, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  assert.equal(queue.get('shutdown').state, 'working');
  await assert.rejects(() => queue.submit(repo.serialize(), request(repo, 'after-close', 'after-close')), /closed/);
  assert.ok(releaseCleanup); releaseCleanup(); await closing;
  assert.equal(closed, true);
  assert.throws(() => queue.get('shutdown'), /closed|not open/);
});
