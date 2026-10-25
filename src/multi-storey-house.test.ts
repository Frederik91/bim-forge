import assert from 'node:assert/strict';
import test from 'node:test';
import { createMultiStoreyProject, multiStoreySnapshot } from './multi-storey-house.ts';
import { entityElevation } from './building-levels.ts';
import { diffSnapshots, previewFurnishings, previewRoomFurnishings, RoomRepository, validateSnapshot } from './room-model.ts';
import type { Furniture, ModelSnapshot } from './room-model.ts';

function furnishingInput(item: Furniture) {
  const { id, type, name, kind, position, width, depth, height, rotationDeg, supportId } = item;
  return { id, type, name, kind, position, width, depth, height, rotationDeg, supportId };
}
function furnishings(snapshot: ModelSnapshot) { return snapshot.entities.filter((item): item is Furniture => item.type === 'Furniture').map(furnishingInput); }

test('browser-safe three-level fixture restores exactly within existing graph and storage limits', async () => {
  const repo = await createMultiStoreyProject('Basement, ground and attic');
  const text = repo.serialize(); const snapshot = repo.view(repo.head('main')).snapshot;
  assert.ok(snapshot.entities.length < 100); assert.ok(snapshot.relationships.length < 100);
  assert.ok(Buffer.byteLength(text) < 256 * 1024);
  const restored = await RoomRepository.restore(text);
  assert.equal(restored.serialize(), text); assert.equal(restored.head('main'), repo.head('main'));
});

test('historical root hash and exact bytes survive, and chair moves retain legacy format', async () => {
  const repo = await RoomRepository.create('Legacy'); const text = repo.serialize();
  assert.equal(repo.head('main'), 'c050c7bdaebb75d7115659ee44495d8a884f7a68034ebc3f72820020e98c9b78');
  assert.equal((await RoomRepository.restore(text)).serialize(), text);
  const chair = { id: 'legacy-chair', type: 'Furniture', name: 'Chair', kind: 'chair', position: [1, 2],
    width: .5, depth: .5, height: 1, rotationDeg: 0, supportId: null };
  const added = previewFurnishings(repo.view(repo.head('main')).snapshot, { furnishings: [chair] });
  const moved = previewFurnishings(added, { furnishings: [{ ...chair, position: [1.5, 2] }] });
  assert.equal(Object.hasOwn(moved, 'version'), false);
  assert.ok(moved.entities.every((item) => !Object.hasOwn(item, 'levelId')));
});

test('building ownership is required while openings reject duplicate ownership fields', () => {
  const base = multiStoreySnapshot();
  assert.throws(() => validateSnapshot({ ...base, version: 3 }), /version/);
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.map((item) => item.type === 'Wall'
    ? { ...item, levelId: 'missing' } : item) }), /valid level owner/);
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.map((item) => item.type === 'Wall'
    ? { id: item.id, type: item.type, name: item.name, start: item.start, end: item.end, height: item.height, thickness: item.thickness } : item) }), /identifier/);
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.map((item) => item.type === 'Door'
    ? { ...item, levelId: 'level-ground' } : item) }), /fields/);
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.map((item) => item.type === 'Level'
    ? { ...item, elevation: 0 } : item) }), /distinct elevations/);
});

test('stairs supply real reachability and must connect adjacent levels with contained axis-aligned footprints', () => {
  const base = multiStoreySnapshot();
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.filter((item) => item.type !== 'Stair') }), /path to the exterior/);
  for (const change of [
    { toLevelId: 'level-attic' }, { start: [1, 1], end: [3, 2] }, { start: [1, 1], end: [1, 1] },
    { start: [3, 1.5], end: [5, 1.5] }, { steps: 0 }, { steps: 2.5 },
  ]) assert.throws(() => validateSnapshot({ ...base, entities: base.entities.map((item) => item.id === 'stair-basement-ground' ? { ...item, ...change } : item) }));
  // A basement perimeter door is not a ground exit.
  const noGroundExit = { ...base, entities: base.entities.filter((item) => item.id !== 'door-entry'),
    relationships: base.relationships.filter((link) => link.source !== 'door-entry') };
  assert.throws(() => validateSnapshot(noGroundExit), /path to the exterior/);
});

test('incident stairs cannot obstruct exterior or internal door clearance at either endpoint', () => {
  const base = multiStoreySnapshot(); const before = JSON.stringify(base);
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.map((item) => item.id === 'stair-basement-ground'
    ? { ...item, start: [1, .5], end: [3, .5] } : item) }), /Stair.*door clearance/);
  // The east flight ends in the attic and starts on the ground floor beside an internal door.
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.map((item) => item.id === 'stair-ground-attic'
    ? { ...item, start: [4.5, 3.4], end: [6.5, 3.4] } : item) }), /Stair.*door clearance/);
  assert.equal(JSON.stringify(base), before);
});

test('stair flights with overlapping XY and positive vertical overlap are rejected', () => {
  const base = multiStoreySnapshot();
  const flight = base.entities.find((item) => item.id === 'stair-basement-ground'); assert.ok(flight?.type === 'Stair');
  assert.throws(() => validateSnapshot({ ...base, entities: [...base.entities, { ...flight, id: 'duplicate-stair' }] }), /Stair flights.*overlap/);
  // A perpendicular flight also intersects, even though it is not an identical geometry record.
  assert.throws(() => validateSnapshot({ ...base, entities: [...base.entities,
    { ...flight, id: 'crossing-stair', start: [2, 1], end: [2, 3] },
  ] }), /Stair flights.*overlap/);
  assert.doesNotThrow(() => validateSnapshot({ ...base, entities: [...base.entities,
    { ...flight, id: 'separate-stair', start: [1, 2.6], end: [3, 2.6] },
  ] }));
});

test('adjacent stair flights may share an elevation boundary and unrelated levels do not block doors', () => {
  const base = multiStoreySnapshot();
  // These flights share XY, but their vertical ranges [-3,0] and [0,3] only touch.
  assert.doesNotThrow(() => validateSnapshot({ ...base, entities: base.entities.map((item) => item.id === 'stair-ground-attic'
    ? { ...item, start: [1, 1.5], end: [3, 1.5] } : item) }));
  // Only the attic door keeps its original clearance; that floor is unrelated to the lower flight.
  assert.doesNotThrow(() => validateSnapshot({ ...base,
    entities: base.entities.map((item) => item.id === 'stair-basement-ground'
      ? { ...item, start: [1.5, 3.4], end: [3.5, 3.4] } : item),
    relationships: base.relationships.map((link) => link.source === 'level-basement-door-inner' || link.source === 'level-ground-door-inner'
      ? { ...link, offset: 4.5 } : link),
  }));
});

test('furnishings require explicit new ownership; retained IDs stay put and transfers are explicit', () => {
  const base = multiStoreySnapshot(); const input = furnishings(base);
  const added = { ...input[0], id: 'new-plant', type: 'Furniture', name: 'New plant', kind: 'plant',
    position: [6, 4.8], width: .3, depth: .3, height: 1, rotationDeg: 0, supportId: null };
  assert.throws(() => previewFurnishings(base, { furnishings: [...input, added] }), /explicit level assignment/);
  const after = previewFurnishings(base, { furnishings: [...input, added], levelAssignments: [{ entityId: added.id, levelId: 'level-attic' }] });
  assert.equal(after.version, 2); assert.equal(entityElevation(after, added.id), 3);
  const moved = previewFurnishings(after, { furnishings: furnishings(after), levelAssignments: [{ entityId: added.id, levelId: 'level-basement' }] });
  assert.equal(entityElevation(moved, added.id), -3);
  const unchanged = previewFurnishings(moved, { furnishings: furnishings(moved) });
  assert.deepEqual(unchanged, moved);
  assert.throws(() => previewFurnishings(base, { furnishings: input, levelAssignments: [{ entityId: 'orphan', levelId: 'level-ground' }] }), /incoming furnishings/);
});

test('room furnishing authoring derives ownership and preserves adjacent levels byte for byte', () => {
  const base = multiStoreySnapshot();
  const after = previewRoomFurnishings(base, { roomId: 'level-attic-west', furnishings: [
    { id: 'attic-chair', type: 'Furniture', name: 'Attic chair', kind: 'chair', position: [1, 4],
      width: .5, depth: .5, height: 1, rotationDeg: 0, supportId: null },
  ] });
  assert.equal(entityElevation(after, 'attic-chair'), 3);
  assert.ok(diffSnapshots(base, after).entities.added.every((item) => item.id === 'attic-chair'));
  assert.ok(diffSnapshots(base, after).entities.removed.every((item) => item.id === 'level-attic-plant'));
  assert.equal(diffSnapshots(base, after).entities.modified.length, 0);
  assert.throws(() => previewRoomFurnishings(base, { roomId: 'level-attic-west', furnishings: [
    { ...furnishings(base)[0], id: 'level-basement-plant' },
  ] }), /transfer objects between levels/);
});

test('same-level overlap, cross-level supports, stair voids and sloping roof clearance are enforced', () => {
  const base = multiStoreySnapshot();
  const plant = furnishings(base).find((item) => item.id === 'level-attic-plant'); assert.ok(plant);
  assert.throws(() => previewFurnishings(base, { furnishings: [...furnishings(base), { ...plant, id: 'overlapping' }],
    levelAssignments: [{ entityId: 'overlapping', levelId: 'level-attic' }] }), /overlap/);
  assert.throws(() => previewFurnishings(base, { furnishings: furnishings(base).map((item) => item.id === plant.id
    ? { ...item, position: [6, 1.5] } : item) }), /stairs and slab voids/);
  assert.throws(() => previewFurnishings(base, { furnishings: furnishings(base).map((item) => item.id === plant.id
    ? { ...item, position: [1, .3], height: 2.65 } : item) }), /roof underside/);
  assert.throws(() => validateSnapshot({ ...base, entities: [...base.entities,
    { id: 'attic-equipment', type: 'Equipment', name: 'Tall equipment', category: 'mechanical', levelId: 'level-attic',
      position: [6, .3], elevation: 2.4, width: .4, depth: .4, height: .3 },
  ] }), /Equipment must fit below the roof underside/);
  assert.throws(() => validateSnapshot({ ...base, entities: [...base.entities,
    { id: 'desk-ground', type: 'Furniture', name: 'Desk', kind: 'desk', levelId: 'level-ground', position: [6, 4.8],
      width: 1.2, depth: .8, height: .75, rotationDeg: 0, supportId: null },
    { id: 'monitor-attic', type: 'Furniture', name: 'Monitor', kind: 'monitor', levelId: 'level-attic', position: [6, 4.8],
      width: .5, depth: .2, height: .4, rotationDeg: 0, supportId: 'desk-ground' },
  ] }), /same level/);
});

test('unrelated upper stairs do not block basement furnishings or equipment', () => {
  const base = multiStoreySnapshot();
  const after = previewFurnishings(base, { furnishings: furnishings(base).map((item) => item.id === 'level-basement-plant'
    ? { ...item, position: [6, 1.5] } : item) });
  assert.equal(entityElevation(after, 'level-basement-plant'), -3);
  assert.doesNotThrow(() => validateSnapshot({ ...base, entities: [...base.entities,
    { id: 'basement-equipment', type: 'Equipment', name: 'Basement equipment', category: 'mechanical', levelId: 'level-basement',
      position: [6, 1.5], elevation: 0, width: .4, depth: .4, height: .5 },
  ] }));
});

test('lower solids may meet an upper slab underside but cannot cross it or move above their owner', () => {
  const base = multiStoreySnapshot();
  const wallsAtUnderside = { ...base, entities: base.entities.map((item) => item.type === 'Wall' && item.levelId === 'level-basement'
    ? { ...item, height: 2.8 } : item) };
  assert.doesNotThrow(() => validateSnapshot(wallsAtUnderside));
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.map((item) => item.type === 'Wall' && item.levelId === 'level-basement'
    ? { ...item, height: 2.801 } : item) }), /below overlapping upper slabs/);
  for (const elevation of [0, 4]) assert.throws(() => validateSnapshot({ ...base, entities: [...base.entities,
    { id: 'basement-tall-equipment', type: 'Equipment', name: 'Tall basement equipment', category: 'mechanical', levelId: 'level-basement',
      position: [6, 4.8], elevation, width: .4, depth: .4, height: 2.801 },
  ] }), /below overlapping upper slabs/);
  assert.throws(() => previewFurnishings(base, { furnishings: furnishings(base).map((item) => item.id === 'level-basement-plant'
    ? { ...item, height: 2.801 } : item) }), /below overlapping upper slabs/);
});

test('attic nominal walls reach the ridge and are clipped by the roof underside', () => {
  const base = multiStoreySnapshot();
  assert.ok(base.entities.filter((item) => item.type === 'Wall' && item.levelId === 'level-attic').every((wall) => wall.type === 'Wall' && wall.height === 4.2));
  // A tall object under the ridge fits; the same height near the eaves does not.
  const ridge = previewFurnishings(base, { furnishings: furnishings(base).map((item) => item.id === 'level-attic-plant'
    ? { ...item, position: [1, 3], height: 2.9 } : item) });
  assert.equal(entityElevation(ridge, 'level-attic-plant'), 3);
  assert.throws(() => previewFurnishings(base, { furnishings: furnishings(base).map((item) => item.id === 'level-attic-plant'
    ? { ...item, position: [1, .3], height: 2.9 } : item) }), /roof underside/);
});

test('roofs and slabs reject invalid shape, location and thickness', () => {
  const base = multiStoreySnapshot();
  for (const change of [
    { levelId: 'level-ground' }, { thickness: 0 }, { thickness: 3 },
    { bounds: { minX: 0, minY: 0, maxX: 4, maxY: 6 } },
    { profile: { kind: 'gable', ridgeAxis: 'x', eaveHeight: 3, ridgeHeight: 2 } },
  ]) assert.throws(() => validateSnapshot({ ...base, entities: base.entities.map((item) => item.type === 'Roof' ? { ...item, ...change } : item) }));
  assert.throws(() => validateSnapshot({ ...base, entities: base.entities.filter((item) => item.id !== 'level-ground-slab') }), /one slab/);
});

test('changing level elevation changes dependent world bases without rewriting their entity fields', () => {
  const before = multiStoreySnapshot();
  const after = validateSnapshot({ ...before, entities: before.entities.map((item) => item.id === 'level-basement' ? { ...item, elevation: -3.2 } : item) });
  assert.deepEqual(diffSnapshots(before, after).entities.modified.map((item) => item.id), ['level-basement']);
  assert.equal(entityElevation(after, 'level-basement-plant'), -3.2);
  assert.equal(entityElevation(after, 'stair-basement-ground'), -3.2);
  assert.equal(entityElevation(after, 'level-basement-door-inner'), -3.2);
});
