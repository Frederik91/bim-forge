import test from 'node:test';
import assert from 'node:assert/strict';
import { createResidentialProject, residentialFloor } from './residential-floor.ts';
import { validateSnapshot, previewRoomFurnishings, RoomRepository, previewFurnishings, previewRectangle, diffSnapshots } from './room-model.ts';
import { spaces, floorBounds, doorConnections, entitySpace } from './floor-plan.ts';
import { prepareModelProposal } from './model-proposal.ts';
import type { ModelWorkerSession } from './model-proposal.ts';
import { parseVisualRequest } from './visual-request.ts';
import { furnitureFaces } from './furniture-geometry.ts';

test('one residential level has eight enclosed rooms, shared walls and a doorway path for every room', () => {
  const snapshot = residentialFloor();
  assert.equal(spaces(snapshot).length, 8);
  assert.deepEqual(floorBounds(snapshot), { minX: 0, minY: 0, maxX: 12, maxY: 9 });
  const links = doorConnections(snapshot);
  assert.equal(links.filter((link) => link.exterior).length, 1);
  assert.equal(links.filter((link) => !link.exterior).length, 7);
  assert.ok(links.filter((link) => !link.exterior).every((link) => link.roomIds.length === 2));
  assert.equal(snapshot.entities.filter((item) => item.id === 'wall-south-hall').length, 1);
  assert.equal(snapshot.relationships.filter((link) => link.target === 'wall-south-hall').length, 3);
  for (const item of snapshot.entities) if (item.type === 'Furniture') {
    assert.ok(entitySpace(snapshot, item));
    assert.ok(furnitureFaces(item, snapshot).length >= 10);
  }
});

test('invalid room boundaries, overlapping walls and disconnected rooms are rejected deterministically', () => {
  const base = residentialFloor();
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.map((item) => item.id === 'room-office' && item.type === 'Space' ? { ...item, bounds: { ...item.bounds, minX: 8 } } : item) }), /overlap|interior/);
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.filter((item) => item.id !== 'wall-kitchen-office') }), /enclosed/);
  assert.throws(() => validateSnapshot({ ...base, entities: [...base.entities, { ...base.entities.find((item) => item.id === 'wall-kitchen-office'), id: 'duplicate-wall' }] }), /once|overlap/);
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.filter((item) => item.id !== 'door-office'), relationships: base.relationships.filter((link) => link.source !== 'door-office') }), /doorway path/);
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.map((item) => item.type === 'Space' ? { ...item, levelId: 'missing-level' } : item) }), /level references/);
  assert.throws(() => validateSnapshot({ ...base, relationships: base.relationships.map((link) => link.source === 'door-office' ? { ...link, offset: 8.7 } : link) }), /connect two rooms/);
});

test('furniture cannot cross partitions or block either side of an internal door', () => {
  const base = residentialFloor();
  const furnishings = base.entities.filter((item) => item.type === 'Furniture');
  const plant = furnishings.find((item) => item.id === 'office-plant'); assert.ok(plant);
  const moved = (position: number[]) => ({ furnishings: furnishings.map((item) => item.id === plant.id ? { ...item, position } : item) });
  assert.throws(() => previewFurnishings(base, moved([9, 2.8])), /inside one room/);
  assert.throws(() => previewFurnishings(base, moved([10.5, 3.6])), /door clearance/);
  assert.throws(() => previewFurnishings(base, moved([10.5, 4.5])), /door clearance/);
  assert.throws(() => previewFurnishings(base, moved([12.5, 2.8])), /inside one room/);
  assert.throws(() => previewRectangle(base, { boundsMm: { minX: 0, minY: 0, maxX: 12000, maxY: 9000 }, door: { widthMm: 1000, offsetMm: 4300 } }), /multi-room/);
});

test('residential export restores all identities and old single-room snapshots gain no implicit entities', async () => {
  const floor = await createResidentialProject('House level');
  const restored = await RoomRepository.restore(floor.serialize());
  assert.equal(restored.serialize(), floor.serialize());
  const legacy = await RoomRepository.create('Legacy room');
  const text = legacy.serialize(); const root = legacy.head('main');
  assert.equal(root, 'c050c7bdaebb75d7115659ee44495d8a884f7a68034ebc3f72820020e98c9b78', 'pre-floor release single-room revision hash is unchanged');
  assert.equal(spaces(legacy.view(root).snapshot).length, 0);
  assert.equal((await RoomRepository.restore(text)).serialize(), text);
  assert.equal((await RoomRepository.restore(text)).head('main'), root);
  assert.deepEqual(parseVisualRequest(floor.view(floor.head('main')).snapshot, { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [11000, 7500] } }),
    { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [11000, 7500] } });
});

test('room-scoped AI proposal preserves every other room and remains separate until reviewed acceptance', async () => {
  const repo = await createResidentialProject('Room request');
  const root = repo.head('main'); const before = repo.view(root).snapshot;
  const office = before.entities.filter((item) => item.type === 'Furniture' && entitySpace(before, item)?.id === 'room-office');
  const changed = office.map((item) => item.id === 'office-plant' ? { ...item, position: [11.4, 2.8] } : item);
  const result = await prepareModelProposal(repo, {
    requestId: 'house-room-request', proposalName: 'office-plant-change', baseRevisionId: root,
    selectedObjectIds: ['room-office'], instruction: 'Move the office plant slightly south. Leave the rest of the house unchanged.',
    visualIntent: { kind: 'selection' },
  }, { identity: { provider: 'test', model: 'floor-worker' }, async run(session: ModelWorkerSession) {
    const inspection = await session.executeTool('inspect_model', {});
    assert.equal(inspection.ok, true);
    const error = await session.executeTool('preview_room_furnishings', { roomId: 'room-office', furnishings: [{ ...changed[0], position: [1, 3] }] });
    assert.equal(error.ok, false, 'room tool cannot place items into another room');
    assert.equal((await session.executeTool('preview_room_furnishings', { roomId: 'room-office', furnishings: changed })).ok, true);
    assert.equal((await session.executeTool('submit_proposal', { summary: 'Office plant moved south.', rationale: 'Only the requested plant changes.', constraints: 'Other rooms and shared walls preserved.', uncertainty: 'Concept clearance only.' })).ok, true);
  } });
  assert.equal(result.status, 'ready');
  assert.equal(result.repository.head('main'), root);
  const after = result.repository.view(result.repository.head('office-plant-change')).snapshot;
  assert.deepEqual(diffSnapshots(before, after).entities.modified.map((item) => item.id), ['office-plant']);
  assert.deepEqual(diffSnapshots(before, after).relationships, { added: [], removed: [], modified: [] });
  const accepted = result.repository.accept('office-plant-change', { decisionId: 'house-accept', actor: 'test reviewer' });
  assert.notEqual(accepted.head('main'), root);
  assert.equal((await RoomRepository.restore(accepted.serialize())).serialize(), accepted.serialize());
});

test('explicit whole-floor transfer retains stable identity and includes source and destination in the delta', () => {
  const before = residentialFloor();
  const furnishings = before.entities.filter((item) => item.type === 'Furniture').map((item) => item.id === 'office-plant' ? { ...item, position: [4.4, 3.3] } : item);
  const after = previewFurnishings(before, { furnishings });
  const delta = diffSnapshots(before, after);
  assert.deepEqual(delta.entities.modified.map((item) => item.id), ['office-plant']);
  const item = delta.entities.modified[0];
  assert.equal(entitySpace(before, item.before)?.name, 'Home office');
  assert.equal(entitySpace(after, item.after)?.name, 'Living room');
  assert.equal(previewRoomFurnishings(before, { roomId: 'room-office', furnishings: [] }).entities.filter((item) => item.type === 'Furniture').length, 11);
});
