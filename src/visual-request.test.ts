import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRepository, previewFurnishings, diffSnapshots, rectangleLayout } from './room-model.ts';
import { parseVisualRequest } from './visual-request.ts';
import { prepareModelProposal } from './model-proposal.ts';
import type { Furniture } from './room-model.ts';
import type { ModelWorkerSession } from './model-proposal.ts';

async function office() {
  const shell = await RoomRepository.create('Visual request test');
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


test('floor and wall references carry no move, group, or wall-attachment assumption', async () => {
  const repo = await office(); const snapshot = repo.view(repo.head('main')).snapshot;
  const saved = repo.serialize();
  assert.deepEqual(parseVisualRequest(snapshot, { kind: 'selection' }), { kind: 'selection' });
  assert.deepEqual(parseVisualRequest(snapshot, { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [3000, 1800] } }),
    { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [3000, 1800] } });
  for (const wall of snapshot.entities.filter((item) => item.type === 'Wall')) {
    const reference = { kind: 'spatial-reference', destination: { kind: 'wall-point', wallId: wall.id, alongWallMm: 1000 } };
    assert.deepEqual(parseVisualRequest(snapshot, reference), reference);
  }
  assert.equal(repo.serialize(), saved, 'a reference cannot change model geometry or history');
});

test('another desk adds only a desk while the original devices and chair remain unchanged', async () => {
  const repo = await office(); const before = repo.view(repo.head('main')).snapshot;
  const furnishings = before.entities.filter((item) => item.type === 'Furniture');
  const newDesk: Furniture = { ...furnishings[0], id: furnishings[0].id, type: 'Furniture', kind: 'desk', name: 'Another desk', position: [1.5, 1.5], width: 1.2, depth: .6, height: .75, rotationDeg: 0, supportId: null };
  const result = await prepareModelProposal(repo, { requestId: 'create-desk', proposalName: 'another-desk', baseRevisionId: repo.head('main'),
    selectedObjectIds: ['desk'], instruction: 'Create another desk at the floor reference, without a screen, laptop or chair.',
    visualIntent: { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [1500, 1500] } },
  }, { identity: { provider: 'test', model: 'generic-worker' }, async run(session: ModelWorkerSession) {
    assert.ok(!session.tools.map((tool): string => tool.name).includes('preview_workstation_move'));
    assert.equal((await session.executeTool('run_model_script', { language: 'typescript', source: "return {kind:'observe',observation:await model.inspect()};" })).ok, true);
    assert.equal((await session.executeTool('run_model_script', { language: 'typescript', source: `
      await model.previewRectangle(${JSON.stringify(rectangleLayout(before))});
      return {kind:'observe',observation:null};
    ` })).ok, false, 'a location alone cannot authorize shell changes');
    const next = { ...newDesk, id: 'new-desk' };
    assert.equal((await session.executeTool('run_model_script', { language: 'typescript', source: `
      await model.previewFurnishings(${JSON.stringify({ furnishings: [...furnishings, next] })});
      return {kind:'propose',review:{intent:{interpretation:'Create one freestanding desk.',assumptions:[],certainty:90,basis:'The fixture requests another desk without companions.'},summary:'Create one freestanding desk.',rationale:'Selection is a reference, not a move command.',
        constraints:'All original objects retained exactly.',uncertainty:'Concept-only placement.'}};
    ` })).ok, true);
  } });
  assert.equal(result.status, 'ready'); assert.equal(result.repository.head('main'), repo.head('main'));
  const after = result.repository.view(result.repository.head('another-desk')).snapshot;
  const delta = diffSnapshots(before, after);
  assert.deepEqual(delta.entities.added.map((item) => item.id), ['new-desk']);
  assert.equal(delta.entities.modified.length + delta.entities.removed.length, 0);
});

test('freestanding setup relocation resolves explicit supports without requiring an assembly entity', async () => {
  const repo = await office(); const before = repo.view(repo.head('main')).snapshot;
  const furnishings = before.entities.filter((item) => item.type === 'Furniture');
  const moved = furnishings.map((item): Furniture => ['desk', 'monitor', 'laptop', 'chair'].includes(item.id)
    ? { ...item, position: [item.position[0], Math.round((item.position[1] - .7) * 1000) / 1000] } : item);
  const result = await prepareModelProposal(repo, { requestId: 'free-desk', proposalName: 'freestanding-setup', baseRevisionId: repo.head('main'),
    selectedObjectIds: ['desk'], instruction: 'Move this desk setup, including the devices and chair, to the floor reference. Keep it freestanding.',
    visualIntent: { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [3000, 2600] } },
  }, { identity: { provider: 'test', model: 'generic-worker' }, async run(session: ModelWorkerSession) {
    assert.equal((await session.executeTool('run_model_script', { language: 'typescript', source: `
      await model.inspect();
      await model.previewFurnishings(${JSON.stringify({ furnishings: moved })});
      return {kind:'propose',review:{intent:{interpretation:'Relocate the requested items.',assumptions:[],certainty:90,basis:'The fixture explicitly names the companions.'},summary:'Relocate desk, screen, laptop and chair.',rationale:'Explicitly requested setup companions; no assembly is required.',
        constraints:'Shell, corner table, plant and supports preserved.',uncertainty:'Circulation requires design review.'}};
    ` })).ok, true);
  } });
  const after = result.repository.view(result.repository.head('freestanding-setup')).snapshot;
  assert.deepEqual(diffSnapshots(before, after).entities.modified.map((item) => item.id), ['chair', 'desk', 'laptop', 'monitor']);
  assert.deepEqual(rectangleLayout(before), rectangleLayout(after));
  assert.equal(result.repository.head('main'), repo.head('main'));
  assert.throws(() => previewFurnishings(before, { furnishings: furnishings.map((item) => item.id === 'desk' ? { ...item, position: [1.5, 1.5] } : item) }), /support/);
  assert.throws(() => previewFurnishings(before, { furnishings: furnishings.map((item) => item.id === 'chair' ? { ...item, position: [3, 3.3] } : item) }), /overlap/);
});

test('forged, stale and workstation-specific context fails before invoking an agent', async () => {
  const repo = await office(); let runs = 0;
  const request = { requestId: 'invalid-visual', proposalName: 'invalid-request', baseRevisionId: repo.head('main'), selectedObjectIds: ['desk'], instruction: 'Create a desk here.' };
  const worker = { identity: { provider: 'test', model: 'never' }, async run() { runs += 1; } };
  for (const visualIntent of [
    { kind: 'workstation-wall-move', deskId: 'desk', memberIds: ['chair', 'desk'], targetWallId: 'wall-west', alongWallMm: 2000 },
    { kind: 'spatial-reference', destination: { kind: 'wall-point', wallId: 'wall-missing', alongWallMm: 100 } },
    { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [100000, 0] } },
    { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [1.5, 1000] } },
    { kind: 'selection', moveAllNeighbours: true },
  ]) await assert.rejects(() => prepareModelProposal(repo, { ...request, visualIntent }, worker));
  await assert.rejects(() => prepareModelProposal(repo, { ...request, baseRevisionId: '0'.repeat(64), visualIntent: { kind: 'selection' } }, worker), /Unknown revision/);
  assert.equal(runs, 0);
});
