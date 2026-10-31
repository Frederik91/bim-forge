import assert from 'node:assert/strict';
import test from 'node:test';
import { assetFixtureEdit, personFamily, personInstance } from './asset-fixture.ts';
import { entityElevation, entityLevel, levelView } from './building-levels.ts';
import { entitySpace } from './floor-plan.ts';
import { multiStoreySnapshot, multiStoreyLayout } from './multi-storey-house.ts';
import { previewBuilding } from './building-layout.ts';
import { previewFloor } from './floor-layout.ts';
import { diffSnapshots, identifier, previewAssets, previewFurnishings, previewRectangle, previewRoomFurnishings, rectangleLayout, RoomRepository, validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';

async function singleRoom(): Promise<ModelSnapshot> { const repo = await RoomRepository.create(); return repo.view(repo.head('main')).snapshot; }

test('atomic asset authoring retains the legacy format and produces only native definition/instance deltas', async () => {
  const before = await singleRoom(); const bytes = JSON.stringify(before); const edit = assetFixtureEdit();
  const after = previewAssets(before, edit);
  assert.equal(Object.hasOwn(after, 'version'), false);
  assert.equal(diffSnapshots(before, after).entities.added.length, 5);
  assert.equal(diffSnapshots(before, after).entities.modified.length, 0);
  assert.deepEqual(after.relationships, before.relationships);
  assert.equal(JSON.stringify(before), bytes);
  assert.deepEqual(previewAssets(after, edit), after);
  const removed = previewAssets(after, { families: [], instances: [], removeInstanceIds: [edit.instances[0].id] });
  assert.equal(removed.entities.filter((item) => item.type === 'AssetFamily').length, 2);
  assert.equal(removed.entities.filter((item) => item.type === 'AssetInstance').length, 2);
});

test('upserts cannot mutate recipes, overwrite shell entities, use dangling IDs or run accessors', async () => {
  const single = await singleRoom(); const before = previewAssets(single, assetFixtureEdit()); const bytes = JSON.stringify(before);
  assert.throws(() => previewAssets(before, { families: [{ ...personFamily(), description: 'Changed definition' }], instances: [], removeInstanceIds: [] }), /immutable/);
  assert.throws(() => previewAssets(before, { families: [], instances: [{ ...personInstance(), id: 'door-entry' }], removeInstanceIds: [] }), /protected/);
  for (const familyId of ['missing-family', 'wall-south']) {
    assert.throws(() => previewAssets(before, { families: [], instances: [{ ...personInstance(), familyId }], removeInstanceIds: [] }), /existing family/);
    assert.throws(() => validateSnapshot({ ...single, entities: [...single.entities, { ...personInstance(), familyId }] }), /existing family/);
  }
  assert.throws(() => previewAssets(before, { families: [], instances: [], removeInstanceIds: ['standing-person'] }), /Only existing asset instances/);
  assert.throws(() => previewAssets(before, { families: [], instances: [personInstance()], removeInstanceIds: ['person-187'] }), /removed and upserted/);
  assert.throws(() => previewAssets(before, { families: [], instances: [personInstance(), personInstance()], removeInstanceIds: [] }), /unique/);
  let called = false;
  const hostile = Object.defineProperty({}, 'families', { enumerable: true, get() { called = true; return []; } });
  assert.throws(() => previewAssets(before, hostile), /plain data/); assert.equal(called, false);
  assert.equal(JSON.stringify(before), bytes);
});

test('native asset bindings derive their level and room while definitions stay nonspatial dependencies', () => {
  const base = multiStoreySnapshot();
  const a = personInstance('attic-person', 1.87, { kind: 'room', roomId: identifier('level-attic-west') });
  a.position = [2, 4.5];
  const b = { ...a, id: 'basement-person', placement: { kind: 'room', roomId: 'level-basement-west' } };
  const after = previewAssets(base, { families: [personFamily()], instances: [a, b], removeInstanceIds: [] });
  assert.equal(entityElevation(after, 'attic-person'), 3); assert.equal(entityElevation(after, 'basement-person'), -3);
  const instance = after.entities.find((item) => item.id === a.id); assert.ok(instance);
  assert.equal(entitySpace(after, instance)?.id, 'level-attic-west');
  assert.equal(entityLevel(after, 'standing-person'), null);
  const view = levelView(after, 'level-attic');
  assert.ok(view.entities.some((item) => item.id === 'standing-person'));
  assert.ok(view.entities.some((item) => item.id === a.id));
  assert.ok(!view.entities.some((item) => item.id === 'basement-person'));
});

test('room, shell, ceiling, door, stair, roof and upper-slab constraints apply to asset instances', async () => {
  const before = await singleRoom();
  for (const change of [
    { position: [0, 2] }, { position: [2.7, .5] }, { size: { width: .5, depth: .3, height: 3.1 } },
    { placement: { kind: 'room', roomId: 'missing-room' } },
  ]) assert.throws(() => previewAssets(before, { families: [personFamily()], instances: [{ ...personInstance(), ...change }], removeInstanceIds: [] }));
  const building = multiStoreySnapshot();
  const bound = { ...personInstance(), placement: { kind: 'room', roomId: 'level-attic-west' }, position: [2, 4.5] };
  assert.throws(() => previewAssets(building, { families: [personFamily()], instances: [personInstance()], removeInstanceIds: [] }), /valid level owner|Single-room/);
  assert.throws(() => previewAssets(building, { families: [personFamily()], instances: [{ ...bound, placement: { kind: 'room', roomId: 'level-ground-east' }, position: [6, 1.5] }], removeInstanceIds: [] }), /stairs and slab voids/);
  assert.throws(() => previewAssets(building, { families: [personFamily()], instances: [{ ...bound, position: [2, .3], size: { width: .5, depth: .3, height: 2.7 } }], removeInstanceIds: [] }), /roof underside/);
  const highWalls = validateSnapshot({ ...building, entities: building.entities.filter((item) => item.type !== 'Roof') });
  assert.throws(() => previewAssets(highWalls, { families: [personFamily()], instances: [{ ...bound, placement: { kind: 'room', roomId: 'level-basement-west' }, size: { width: .5, depth: .3, height: 2.9 } }], removeInstanceIds: [] }), /ceiling|upper slabs/);
});

test('occupancy is shared across ordinary furniture/assets and across equipment vertical offsets', async () => {
  const before = await singleRoom();
  const asset = previewAssets(before, { families: [personFamily()], instances: [personInstance()], removeInstanceIds: [] });
  assert.throws(() => previewAssets(asset, { families: [], instances: [{ ...personInstance(), id: 'overlap-person' }], removeInstanceIds: [] }), /instances overlap/);
  assert.throws(() => previewFurnishings(asset, { furnishings: [{ id: 'chair', type: 'Furniture', name: 'Chair', kind: 'chair',
    position: [1, 2], width: .5, depth: .5, height: .8, rotationDeg: 0, supportId: null }] }), /overlaps existing furniture/);
  assert.throws(() => validateSnapshot({ ...asset, entities: [...asset.entities, { id: 'low-equipment', type: 'Equipment', name: 'Equipment',
    category: 'mechanical', position: [1, 2], elevation: .2, width: .3, depth: .3, height: .4 }] }), /overlaps existing equipment/);
  assert.doesNotThrow(() => validateSnapshot({ ...asset, entities: [...asset.entities, { id: 'high-equipment', type: 'Equipment', name: 'Equipment',
    category: 'mechanical', position: [1, 2], elevation: 2, width: .3, depth: .3, height: .4 }] }));
});

test('shell and furnishing edits preserve assets or fail atomically with explicit rebinding guidance', async () => {
  const before = previewAssets(await singleRoom(), assetFixtureEdit()); const bytes = JSON.stringify(before);
  assert.deepEqual(previewFurnishings(before, { furnishings: [] }), before);
  const room = rectangleLayout(before);
  const enlarged = previewRectangle(before, { ...room, boundsMm: { ...room.boundsMm, maxX: 7000 } });
  assert.deepEqual(enlarged.entities.filter((item) => item.type === 'AssetInstance' || item.type === 'AssetFamily'),
    before.entities.filter((item) => item.type === 'AssetInstance' || item.type === 'AssetFamily'));
  assert.throws(() => previewRectangle(before, { ...room, boundsMm: { ...room.boundsMm, maxX: 4500 } }), /bound room/);
  const floor = multiStoreyLayout().levels[1]; assert.ok(floor);
  const layout = { level: { id: floor.level.id, name: floor.level.name }, rooms: floor.rooms,
    openings: floor.openings, wallThicknessMm: floor.wallThicknessMm, heightMm: floor.heightMm };
  assert.throws(() => previewFloor(before, layout), /Explicitly remove and rebind/);
  assert.throws(() => previewBuilding(before, multiStoreyLayout()), /remove\/rebind/);
  assert.equal(JSON.stringify(before), bytes);
  const building = previewBuilding(multiStoreySnapshot(), multiStoreyLayout());
  const placed = previewAssets(building, { families: [personFamily()], instances: [{ ...personInstance(), position: [2, 4.5], placement: { kind: 'room', roomId: 'level-ground-west' } }], removeInstanceIds: [] });
  assert.deepEqual(previewFloor(placed, layout), placed);
  assert.deepEqual(previewBuilding(placed, multiStoreyLayout()), placed);
  assert.deepEqual(previewRoomFurnishings(placed, { roomId: 'level-ground-west', furnishings: [] }).entities.filter((item) => item.type === 'AssetInstance' || item.type === 'AssetFamily'),
    placed.entities.filter((item) => item.type === 'AssetInstance' || item.type === 'AssetFamily'));
});

test('budgets bound families, parts and combined furnishings without changing graph limits', async () => {
  const before = await singleRoom(); const family = personFamily();
  assert.throws(() => previewAssets(before, { families: Array.from({ length: 33 }, (_, i) => ({ ...family, id: 'family-' + i })), instances: [], removeInstanceIds: [] }), /exact bounded/);
  const instances = Array.from({ length: 32 }, (_, i) => ({ ...personInstance('person-' + i, .02), position: [.2 + i * .1, 2], size: { width: .05, depth: .05, height: .02 } }));
  const full = previewAssets(before, { families: [family], instances, removeInstanceIds: [] });
  assert.equal(full.entities.filter((item) => item.type === 'AssetInstance').length, 32);
  assert.throws(() => previewFurnishings(full, { furnishings: [{ id: 'one-too-many', type: 'Furniture', name: 'Plant', kind: 'plant',
    position: [5, 3], width: .1, depth: .1, height: .1, rotationDeg: 0, supportId: null }] }), /32 combined/);
});
