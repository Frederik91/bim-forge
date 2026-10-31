import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChangeRequests } from './change-requests.ts';
import { RoomRepository, diffSnapshots } from '../src/room-model.ts';
import { multiStoreySnapshot } from '../src/multi-storey-house.ts';
import type { ModelWorker } from '../src/model-proposal.ts';

test('queued real ScriptBox centred-door proposal retains accepted head through restart until explicit acceptance', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'centred-door-270-'));
  const file = path.join(directory, 'queue.sqlite');
  const base = multiStoreySnapshot();
  const repo = await RoomRepository.createProject({ projectId: crypto.randomUUID(), name: 'Centred door queue proof', snapshot: base });
  const worker: ModelWorker = { identity: { provider: 'test', model: 'centred-door-proof' }, async run(session) {
    const outcome = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const result = await model.previewHostedDoorWidth({doorId:'level-ground-door-inner',widthMetres:1.1,anchor:'centre'});
      if (JSON.stringify(result.impact.after.centreMetres) !== '[4,3.45,0]') throw new Error('Door moved');
      return {kind:'propose',review:{summary:'Widen the connecting door to 1100 mm, keeping its centre.',
        rationale:'Move the existing host offset from 3.0 m to 2.9 m.',constraints:'Only door width and host offset change.',
        uncertainty:'Synthetic concept geometry requires human review.',intent:{interpretation:'Widen one native door with fixed centre.',
          assumptions:[],certainty:100,basis:'Deterministic multi-room fixture.'}}};` });
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
  } };
  let queue = await ChangeRequests.open(file, () => worker);
  t.after(async () => { await queue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const ticket = await queue.submit(repo.serialize(), { requestId: 'centred-door', proposalName: 'centred-door', baseRevisionId: repo.head('main'),
    selectedObjectIds: ['level-ground-door-inner'], instruction: 'Widen this 900 mm door to 1100 mm, preserving its centre.',
    visualIntent: { kind: 'selection' }, scope: { query: { version: 1,
      allOf: [{ kind: 'ids', ids: ['level-ground-door-inner'] }], anyOf: [], excludeIds: [] } } });
  const deadline = Date.now() + 30000;
  while (queue.get(ticket.id).state !== 'ready') {
    const current = queue.get(ticket.id);
    assert.ok(['queued', 'working'].includes(current.state), JSON.stringify({ state: current.state, error: current.error }));
    assert.ok(Date.now() < deadline, 'Centred door proposal timed out'); await new Promise(resolve => setTimeout(resolve, 10));
  }
  const ready = queue.get(ticket.id); assert.ok(ready.result);
  const proposed = await RoomRepository.restore(ready.result.project);
  assert.equal(proposed.head('main'), repo.head('main'));
  const review = proposed.review('centred-door'); assert.equal(review.decision.status, 'pending');
  assert.deepEqual(review.scope?.writableIds, ['level-ground-door-inner']);
  assert.equal(review.scriptExecutions?.[0]?.validation, 'passed');
  const unpublished = await RoomRepository.restore(queue.project(repo.projectId)); assert.equal(unpublished.head('main'), repo.head('main'));
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  assert.equal(queue.get(ticket.id).state, 'ready');
  const accepted = await queue.decide(ticket.id, { action: 'accept', decisionId: 'accept-centred-door', expectedRequestId: 'centred-door' });
  assert.equal(accepted.ticket.state, 'completed');
  const saved = await RoomRepository.restore(accepted.project); const after = saved.view(saved.head('main')).snapshot;
  const delta = diffSnapshots(base, after);
  assert.deepEqual(delta.entities.modified.map(item => item.id), ['level-ground-door-inner']);
  assert.deepEqual(delta.relationships.modified.map(item => item.id), ['host-level-ground-door-inner']);
  const door = after.entities.find(item => item.id === 'level-ground-door-inner'); assert.ok(door?.type === 'Door');
  const host = after.relationships.find(item => item.source === door.id); assert.ok(host);
  assert.equal(door.width, 1.1); assert.equal(host.offset, 2.9); assert.equal(host.offset + door.width / 2, 3.45);
  assert.equal(host.target, 'level-ground-wall-inner'); assert.equal(saved.review('centred-door').decision.status, 'accepted');
  for (const entity of base.entities.filter(item => item.id !== door.id)) assert.deepEqual(after.entities.find(item => item.id === entity.id), entity);
});
