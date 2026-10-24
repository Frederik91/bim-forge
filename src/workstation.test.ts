import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRepository, previewFurnishings, diffSnapshots, rectangleLayout } from './room-model.ts';
import { discoverWorkstation, workstationIntent, parseWorkstationIntent, workstationGhost, previewWorkstationMove } from './workstation.ts';
import { prepareModelProposal } from './model-proposal.ts';

async function office() {
  const shell = await RoomRepository.create('Workstation test');
  const snapshot = previewFurnishings(shell.view(shell.head('main')).snapshot, { furnishings: [
    { id: 'desk', type: 'Furniture', kind: 'desk', name: 'Desk', position: [3, 3.3], width: 1.8, depth: .8, height: .75, rotationDeg: 0, supportId: null },
    { id: 'chair', type: 'Furniture', kind: 'chair', name: 'Chair', position: [3, 2.25], width: .6, depth: .6, height: 1, rotationDeg: 0, supportId: null },
    { id: 'monitor', type: 'Furniture', kind: 'monitor', name: 'Monitor', position: [2.75, 3.5], width: .6, depth: .2, height: .45, rotationDeg: 180, supportId: 'desk' },
    { id: 'laptop', type: 'Furniture', kind: 'laptop', name: 'Laptop', position: [3.4, 3.25], width: .35, depth: .25, height: .24, rotationDeg: 180, supportId: 'desk' },
    { id: 'table', type: 'Furniture', kind: 'table', name: 'Corner table', position: [.65, 3.35], width: .6, depth: .6, height: .55, rotationDeg: 0, supportId: null },
    { id: 'plant', type: 'Furniture', kind: 'plant', name: 'Plant', position: [5.35, 3.35], width: .5, depth: .5, height: 1.1, rotationDeg: 0, supportId: null },
  ] });
  return RoomRepository.createProject({ projectId: crypto.randomUUID(), name: 'Furnished office', snapshot });
}

test('visual workstation move rotates the desk, chair and supported devices together, leaving unrelated objects fixed', async () => {
  const repo = await office(); const before = repo.view(repo.head('main')).snapshot;
  const saved = repo.serialize();
  const intent = workstationIntent(before, 'desk', 'wall-west', 2000);
  assert.deepEqual(intent.memberIds, ['chair', 'desk', 'laptop', 'monitor']);
  const ghost = workstationGhost(before, intent);
  assert.equal(repo.serialize(), saved, 'a ghost cannot change saved history');
  const after = previewWorkstationMove(before, intent, { alongWallMm: 2000, wallGapMm: 150 });
  assert.deepEqual(after, ghost);
  const delta = diffSnapshots(before, after);
  assert.deepEqual(delta.entities.modified.map((item) => item.id), ['chair', 'desk', 'laptop', 'monitor']);
  assert.equal(delta.entities.added.length + delta.entities.removed.length + delta.relationships.modified.length, 0);
  assert.deepEqual(rectangleLayout(after), rectangleLayout(before));
  const desk = after.entities.find((item) => item.id === 'desk');
  const chair = after.entities.find((item) => item.id === 'chair');
  assert.ok(desk?.type === 'Furniture' && chair?.type === 'Furniture');
  assert.deepEqual(desk.position, [.65, 2]); assert.equal(desk.rotationDeg, 90);
  assert.deepEqual(chair.position, [1.7, 2]); assert.equal(chair.rotationDeg, 90);
  assert.equal(after.entities.find((item) => item.id === 'monitor')?.type, 'Furniture');
  assert.deepEqual(parseWorkstationIntent(before, intent), intent);
  assert.throws(() => parseWorkstationIntent(before, { ...intent, memberIds: ['desk'] }), /membership/);
  assert.throws(() => workstationIntent(before, 'desk', 'door-entry', 2000), /destination/);
  assert.throws(() => workstationIntent(before, 'desk', 'wall-west', -1), /within/);
  assert.throws(() => previewWorkstationMove(before, intent, { alongWallMm: 3900, wallGapMm: 150 }), /inside|overlap/);
  assert.throws(() => previewWorkstationMove(before, workstationIntent(before, 'desk', 'wall-south', 2800), { alongWallMm: 2800, wallGapMm: 150 }), /door clearance/);
});

test('workstation AI proposal protects unrelated objects and advances the current model only after acceptance', async () => {
  const repo = await office(); const before = repo.view(repo.head('main')).snapshot;
  const intent = workstationIntent(before, 'desk', 'wall-west', 2000);
  const result = await prepareModelProposal(repo, { requestId: 'visual-drag', proposalName: 'west-wall-workstation',
    baseRevisionId: repo.head('main'), selectedObjectIds: intent.memberIds, instruction: 'Move this workstation to West wall.', visualIntent: intent,
  }, { identity: { provider: 'test', model: 'workstation-worker' }, async run(session: import('./model-proposal.ts').ModelWorkerSession) {
    assert.equal((await session.executeTool('preview_rectangle', rectangleLayout(before))).ok, false);
    assert.equal((await session.executeTool('preview_furnishings', { furnishings: [] })).ok, false);
    assert.equal((await session.executeTool('preview_workstation_move', { alongWallMm: 3900, wallGapMm: 150 })).ok, false);
    assert.equal((await session.executeTool('preview_workstation_move', { alongWallMm: 2000, wallGapMm: 150 })).ok, true);
    assert.equal((await session.executeTool('submit_proposal', { summary: 'Move workstation to West wall.', rationale: 'Desk, chair, monitor and laptop rotate together.', constraints: 'Other objects stay fixed.', uncertainty: 'Concept model only.' })).ok, true);
    session.recordProviderEvent({ responseId: 'visual-drag-turn', inputTokens: 10, outputTokens: 10, totalTokens: 20 });
  } });
  assert.equal(result.status, 'ready');
  assert.equal(result.repository.head('main'), repo.head('main'));
  const accepted = result.repository.accept('west-wall-workstation', { decisionId: 'accept-west-wall', actor: 'tester' });
  const restored = await RoomRepository.restore(accepted.serialize());
  assert.deepEqual(restored.view(restored.head('main')).snapshot, workstationGhost(before, intent));
  assert.deepEqual(restored.view(repo.head('main')).snapshot, before);
  assert.deepEqual(restored.review('west-wall-workstation').selectedObjectIds, intent.memberIds);
});

test('forged or stale move identities fail before the worker starts', async () => {
  const repo = await office(); const snapshot = repo.view(repo.head('main')).snapshot;
  const intent = workstationIntent(snapshot, 'desk', 'wall-west', 2000);
  let runs = 0;
  const worker = { identity: { provider: 'test', model: 'must-not-start' }, async run() { runs += 1; } };
  const request = { requestId: 'invalid-visual', proposalName: 'invalid-move', baseRevisionId: repo.head('main'),
    selectedObjectIds: intent.memberIds, instruction: 'Move workstation.', visualIntent: intent };
  for (const visualIntent of [
    { ...intent, memberIds: ['desk'] }, { ...intent, targetWallId: 'wall-missing' }, { ...intent, unexpected: true },
  ]) await assert.rejects(() => prepareModelProposal(repo, { ...request, visualIntent }, worker), /membership|destination|Unexpected/);
  await assert.rejects(() => prepareModelProposal(repo, { ...request, selectedObjectIds: ['desk'] }, worker), /exact workstation/);
  await assert.rejects(() => prepareModelProposal(repo, { ...request, baseRevisionId: '0'.repeat(64) }, worker), /Unknown revision/);
  assert.equal(runs, 0);
});

test('every destination wall preserves workstation orientation, supports and relative offsets', async () => {
  const repo = await office(); const snapshot = repo.view(repo.head('main')).snapshot;
  for (const [wallId, alongWallMm, position, rotation] of [
    ['wall-west', 2000, [.65, 2], 90], ['wall-east', 2000, [5.35, 2], 270],
    ['wall-north', 3000, [3, 3.35], 0], ['wall-south', 1200, [1.2, .65], 180],
  ] as const) {
    const moved = previewWorkstationMove(snapshot, workstationIntent(snapshot, 'desk', wallId, alongWallMm), { alongWallMm, wallGapMm: 150 });
    const desk = moved.entities.find((item) => item.id === 'desk');
    assert.ok(desk?.type === 'Furniture'); assert.deepEqual(desk.position, position); assert.equal(desk.rotationDeg, rotation);
    for (const id of ['monitor', 'laptop']) {
      const device = moved.entities.find((item) => item.id === id);
      assert.ok(device?.type === 'Furniture'); assert.equal(device.supportId, desk.id);
    }
  }
  const west = previewWorkstationMove(snapshot, workstationIntent(snapshot, 'desk', 'wall-west', 2000), { alongWallMm: 2000, wallGapMm: 150 });
  const north = previewWorkstationMove(west, workstationIntent(west, 'desk', 'wall-north', 3000), { alongWallMm: 3000, wallGapMm: 150 });
  assert.deepEqual(north, previewWorkstationMove(snapshot, workstationIntent(snapshot, 'desk', 'wall-north', 3000), { alongWallMm: 3000, wallGapMm: 150 }));
});

test('ambiguous chair association is explained rather than silently moving a random chair', async () => {
  const repo = await office(); const snapshot = repo.view(repo.head('main')).snapshot;
  const chair = snapshot.entities.find((item) => item.id === 'chair');
  assert.ok(chair?.type === 'Furniture');
  const ambiguous = previewFurnishings(snapshot, { furnishings: snapshot.entities.filter((item) => item.type === 'Furniture').map((item) =>
    item.id === 'table' ? { ...chair, id: item.id, name: 'Guest chair', position: [3.8, 2.4] satisfies [number, number] } : item) });
  assert.equal(discoverWorkstation(ambiguous, 'desk').kind, 'unavailable');
});
