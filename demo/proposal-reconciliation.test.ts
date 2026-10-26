import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeRequests } from './change-requests.ts';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createResidentialProject } from '../src/residential-floor.ts';
import { diffSnapshots, RoomRepository, previewFurnishings } from '../src/room-model.ts';
import type { ModelWorker } from '../src/model-proposal.ts';

function furnitureWorker(repo: RoomRepository, before: (id: string, signal: AbortSignal) => Promise<void> = async () => {}): ModelWorker {
  const base = repo.view(repo.head('main')).snapshot;
  return { identity: { provider: 'test', model: 'independent-furniture' }, async run(session) {
    const input = session.input;
    if (!input || typeof input !== 'object' || !('request' in input) || !input.request || typeof input.request !== 'object'
        || !('selectedObjectIds' in input.request) || !Array.isArray(input.request.selectedObjectIds)) throw new Error('Missing selection.');
    const target = input.request.selectedObjectIds[0];
    if (typeof target !== 'string') throw new Error('Missing selected identity.');
    await before(target, session.signal);
    const furnishings = base.entities.filter((item) => item.type === 'Furniture').map((item) => item.id === target ? { ...item, width: item.width + .2 } : item);
    const result = await session.executeTool('run_model_script', { language: 'typescript', source: `
      await model.inspect();
      await model.previewFurnishings(${JSON.stringify({ furnishings })});
      return {kind:'propose',review:{intent:{interpretation:'Widen the selected furnishing.',assumptions:[],certainty:95,basis:'The fixture specifies the object and dimension.'},
        summary:'Widen the selected furnishing by 0.2 m.',rationale:'Only the selected furnishing changes.',constraints:'Preserve all other objects.',uncertainty:'Concept model.'}};
    ` });
    assert.equal(result.ok, true);
  } };
}

async function submitPair(queue: ChangeRequests, repo: RoomRepository): Promise<void> {
  for (const id of ['office-desk', 'main-bed']) {
    await queue.submit(repo.serialize(), { requestId: id, proposalName: id, baseRevisionId: repo.head('main'),
      selectedObjectIds: [id], instruction: 'Widen the selected furnishing by 0.2 m.', visualIntent: { kind: 'selection' } });
  }
}

async function waitFor(queue: ChangeRequests, id: string, state = 'ready'): Promise<void> {
  for (let attempt = 0; attempt < 2000 && queue.get(id).state !== state; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(queue.get(id).state, state, queue.get(id).error ?? 'Request did not finish.');
}

function accept(queue: ChangeRequests, id: string) {
  return queue.decide(id, { action: 'accept', decisionId: `accept-${id}`, expectedRequestId: id });
}

async function assertBothChanges(project: string): Promise<RoomRepository> {
  const restored = await RoomRepository.restore(project);
  const base = restored.view(restored.root()).snapshot;
  const delta = diffSnapshots(base, restored.view(restored.head('main')).snapshot);
  assert.deepEqual(delta.entities.modified.map((item) => item.id).sort(), ['main-bed', 'office-desk']);
  for (const item of restored.view(restored.head('main')).snapshot.entities) {
    if (item.type === 'Furniture' && (item.id === 'office-desk' || item.id === 'main-bed')) assert.equal(item.width, item.id === 'office-desk' ? 1.8 : 2);
  }
  assert.deepEqual(delta.entities.added, []); assert.deepEqual(delta.entities.removed, []);
  assert.deepEqual(delta.relationships, { added: [], modified: [], removed: [] });
  return restored;
}

test('desk and bed requests from the same revision can both be accepted without revising either', async (t) => {
  const repo = await createResidentialProject('Independent desk and bed changes');
  const queue = await ChangeRequests.open(':memory:', () => furnitureWorker(repo)); t.after(() => queue.close());
  await submitPair(queue, repo); await waitFor(queue, 'office-desk'); await waitFor(queue, 'main-bed');
  assert.equal(queue.get('office-desk').state, 'ready'); assert.equal(queue.get('main-bed').state, 'ready');
  const original = queue.get('main-bed').result; assert.ok(original);
  const before = await RoomRepository.restore(original.project);
  const desk = await accept(queue, 'office-desk');
  assert.equal(queue.get('main-bed').state, 'ready'); assert.equal(queue.get('main-bed').error, null);
  const accepted = await accept(queue, 'main-bed');
  const restored = await assertBothChanges(accepted.project);
  const applied = restored.review('main-bed'); const source = before.review('main-bed');
  assert.deepEqual({ ...applied, decision: null }, { ...source, decision: null }, 'Original proposal and AI evidence remain unchanged.');
  assert.notEqual(applied.decision.status, 'pending');
  if (applied.decision.status !== 'pending') {
    assert.equal(applied.decision.appliedRevisionId, restored.head('main'));
    assert.equal(restored.view(restored.head('main')).parentId, (await RoomRepository.restore(desk.project)).head('main'));
  }
  assert.equal(restored.view(source.proposalRevisionId).id, source.proposalRevisionId);
  assert.equal((await accept(queue, 'main-bed')).project, accepted.project, 'Replaying the decision adds no revision.');
  assert.equal(queue.get('office-desk').state, 'completed'); assert.equal(queue.get('main-bed').state, 'completed');
  assert.equal(queue.get('main-bed').attempts, 1); assert.equal(queue.get('main-bed').history.length, 0);
});

test('a request finishing after an unrelated acceptance remains ready for review', async (t) => {
  const repo = await createResidentialProject('Independent work in flight');
  const gate: { release: () => void } = { release: () => {} };
  const worker = furnitureWorker(repo, (id, signal) => id !== 'main-bed' ? Promise.resolve() : new Promise<void>((resolve) => {
    gate.release = resolve; signal.addEventListener('abort', () => resolve(), { once: true });
    if (signal.aborted) resolve();
  }));
  const queue = await ChangeRequests.open(':memory:', () => worker); t.after(() => queue.close());
  await submitPair(queue, repo); await waitFor(queue, 'office-desk');
  assert.equal(queue.get('main-bed').state, 'working');
  await accept(queue, 'office-desk'); gate.release(); await waitFor(queue, 'main-bed');
  await assertBothChanges((await accept(queue, 'main-bed')).project);
});

test('accepting the bed before the desk preserves both independent changes and exposes only accepted ancestry', async (t) => {
  const repo = await createResidentialProject('Reverse independent acceptance');
  const queue = await ChangeRequests.open(':memory:', () => furnitureWorker(repo)); t.after(() => queue.close());
  await submitPair(queue, repo); await waitFor(queue, 'office-desk'); await waitFor(queue, 'main-bed');
  assert.equal(queue.history({ projectId: repo.projectId, before: null, limit: 50 }).entries.length, 1);
  await accept(queue, 'main-bed');
  assert.equal(queue.get('office-desk').state, 'ready');
  await assertBothChanges((await accept(queue, 'office-desk')).project);
  const first = queue.history({ projectId: repo.projectId, before: null, limit: 1 });
  assert.equal(first.entries.length, 1); assert.equal(first.entries[0]?.requestId, 'office-desk'); assert.ok(first.nextCursor);
  const second = queue.history({ projectId: repo.projectId, before: first.nextCursor, limit: 1 });
  assert.equal(second.entries[0]?.requestId, 'main-bed'); assert.ok(second.nextCursor);
  const third = queue.history({ projectId: repo.projectId, before: second.nextCursor, limit: 1 });
  assert.equal(third.entries[0]?.revisionId, repo.root()); assert.equal(third.nextCursor, null);
  assert.throws(() => queue.history({ projectId: repo.projectId, before: 'f'.repeat(64), limit: 1 }), /cursor|revision/i);
  assert.throws(() => queue.history({ projectId: repo.projectId, before: null, limit: 51 }), /limit/i);
  assert.throws(() => queue.history({ projectId: crypto.randomUUID(), before: first.nextCursor, limit: 1 }), /project/i);
});

test('old needs-input tickets recover on opening without revising or rerunning the agent', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-reconcile-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'requests.sqlite');
  const repo = await createResidentialProject('Recover independent proposals');
  const queue = await ChangeRequests.open(file, () => furnitureWorker(repo));
  await submitPair(queue, repo); await waitFor(queue, 'office-desk'); await waitFor(queue, 'main-bed');
  await accept(queue, 'office-desk');
  const legacy = { ...queue.get('main-bed'), state: 'needs-input', error: 'The accepted model changed. Revise this request against the current model before accepting.' };
  await queue.close();
  const db = new DatabaseSync(file);
  db.prepare('UPDATE requests SET state=?,body=json_set(body, ''$.state'', ?, ''$.error'', ?) WHERE id=?').run(legacy.state, legacy.state, legacy.error, legacy.id); db.close();
  const reopened = await ChangeRequests.open(file, () => null); t.after(() => reopened.close());
  assert.equal((await reopened.refreshProposal('main-bed')).state, 'ready');
  await assertBothChanges((await accept(reopened, 'main-bed')).project);
  assert.equal(reopened.get('main-bed').attempts, 1); assert.equal(reopened.get('main-bed').history.length, 0);
});

test('simultaneous acceptance cannot overwrite work and a rejected race can retry the same decision', async (t) => {
  const repo = await createResidentialProject('Concurrent independent decisions');
  const queue = await ChangeRequests.open(':memory:', () => furnitureWorker(repo)); t.after(() => queue.close());
  await submitPair(queue, repo); await waitFor(queue, 'office-desk'); await waitFor(queue, 'main-bed');
  const ids = ['office-desk', 'main-bed'];
  const results = await Promise.allSettled(ids.map((id) => accept(queue, id)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  for (const [index, result] of results.entries()) if (result.status === 'rejected') {
    assert.match(String(result.reason), /changed while reviewing/);
    const id = ids[index]; assert.ok(id); await accept(queue, id);
  }
  const project = queue.project(repo.projectId); assert.ok(project); await assertBothChanges(project);
});

async function reviewed(repo: RoomRepository, name: string, snapshot: unknown): Promise<RoomRepository> {
  return repo.proposeReviewedModel({ name, from: repo.head('main'), snapshot, review: {
    requestId: `request-${name}`, selectedObjectIds: ['door-entry'], instruction: 'Apply the fixture edit.',
    summary: 'Apply the fixture edit.', rationale: 'Deterministic model delta.', constraints: 'Validate the resulting model.', uncertainty: 'Concept only.',
    worker: { provider: 'test', model: 'reconciliation', responseIds: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    toolCalls: [{ name: 'preview_furnishings', status: 'accepted', error: null }], validator: 'room-graph-v1',
  } });
}

test('unrelated additions, removals and relationship edits are retained together', async () => {
  const repo = await createResidentialProject('Mixed independent edits'); const base = repo.view(repo.head('main')).snapshot;
  const removed = await reviewed(repo, 'remove-plant', { ...base, entities: base.entities.filter((item) => item.id !== 'office-plant') });
  const validAdded = await reviewed(repo, 'add-living-plant', { ...base,
    entities: [...base.entities, { id: 'new-plant', type: 'Furniture', name: 'New plant', kind: 'plant', position: [4.5, 3.5], width: .3, depth: .3, height: .7, rotationDeg: 0, supportId: null }],
    relationships: base.relationships.map((item) => item.source === 'window-bedroom-main' ? { ...item, offset: item.offset + .1 } : item) });
  const accepted = await removed.accept('remove-plant', { decisionId: 'remove', actor: 'human' }).acceptFrom(validAdded, 'add-living-plant', { decisionId: 'add', actor: 'human' });
  const delta = accepted.compare(repo.head('main'), accepted.head('main'));
  assert.deepEqual(delta.entities.removed.map((item) => item.id), ['office-plant']);
  assert.deepEqual(delta.entities.added.map((item) => item.id), ['new-plant']);
  assert.deepEqual(delta.relationships.modified.map((item) => item.id), ['host-window-bedroom-main']);
});

test('different object IDs still conflict when their combined geometry overlaps', async () => {
  const empty = await RoomRepository.create();
  const chair = { id: 'first-chair', type: 'Furniture', name: 'First chair', kind: 'chair', position: [1, 2], width: .6, depth: .6, height: 1, rotationDeg: 0, supportId: null };
  const snapshot = previewFurnishings(empty.view(empty.head('main')).snapshot, { furnishings: [chair, { ...chair, id: 'second-chair', name: 'Second chair', position: [5, 2] }] });
  const repo = await RoomRepository.createProject({ projectId: crypto.randomUUID(), name: 'Collision fixture', snapshot });
  const a = await reviewed(repo, 'move-first', { ...snapshot, entities: snapshot.entities.map((item) => item.id === 'first-chair' ? { ...item, position: [3, 2] } : item) });
  const b = await reviewed(repo, 'move-second', { ...snapshot, entities: snapshot.entities.map((item) => item.id === 'second-chair' ? { ...item, position: [3, 2] } : item) });
  const current = a.accept('move-first', { decisionId: 'first', actor: 'human' });
  const before = current.serialize();
  await assert.rejects(() => current.acceptFrom(b, 'move-second', { decisionId: 'second', actor: 'human' }), /combined changes fail model validation.*overlap/);
  assert.equal(current.serialize(), before, 'Failed reconciliation cannot alter either object.');
});

test('a changed hosting relationship and a door edit must validate together', async () => {
  const repo = await RoomRepository.create(); const base = repo.view(repo.head('main')).snapshot;
  const wide = await reviewed(repo, 'wide-door', { ...base, entities: base.entities.map((item) => item.type === 'Door' ? { ...item, width: 1.2 } : item) });
  const shifted = await reviewed(repo, 'shift-door', { ...base, relationships: base.relationships.map((item) => ({ ...item, offset: 4.9 })) });
  const current = wide.accept('wide-door', { decisionId: 'wide', actor: 'human' });
  await assert.rejects(() => current.acceptFrom(shifted, 'shift-door', { decisionId: 'shift', actor: 'human' }), /combined changes fail model validation/);
});

test('restore refuses an applied revision that does not contain the reviewed delta', async () => {
  const repo = await createResidentialProject('Tamper fixture'); const base = repo.view(repo.head('main')).snapshot;
  const a = await reviewed(repo, 'desk', { ...base, entities: base.entities.map((item) => item.id === 'office-desk' && item.type === 'Furniture' ? { ...item, width: item.width + .2 } : item) });
  const b = await reviewed(repo, 'bed', { ...base, entities: base.entities.map((item) => item.id === 'main-bed' && item.type === 'Furniture' ? { ...item, width: item.width + .2 } : item) });
  const first = a.accept('desk', { decisionId: 'desk', actor: 'human' });
  const merged = await first.acceptFrom(b, 'bed', { decisionId: 'bed', actor: 'human' });
  const text = merged.serialize().replace(`"appliedRevisionId":"${merged.head('main')}"`, `"appliedRevisionId":"${first.head('main')}"`);
  assert.notEqual(text, merged.serialize());
  await assert.rejects(() => RoomRepository.restore(text), /does not match the reviewed proposal delta/);
});
