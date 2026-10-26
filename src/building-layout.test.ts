import assert from 'node:assert/strict';
import test from 'node:test';
import { previewBuilding, parseBuildingLayout } from './building-layout.ts';
import { levelView } from './building-levels.ts';
import { previewFloor } from './floor-layout.ts';
import { multiStoreyLayout, multiStoreySnapshot } from './multi-storey-house.ts';
import { diffSnapshots, RoomRepository, validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';

async function legacy(): Promise<ModelSnapshot> { const repo = await RoomRepository.create(); return repo.view(repo.head('main')).snapshot; }

test('floor and building reconstruction retain typed parameters on stable shell identities', () => {
  const base = multiStoreySnapshot();
  const tagged = validateSnapshot({ ...base, entities: base.entities.map(item => ({ ...item,
    parameters: [{ definitionId: 'maintainer', name: 'Maintainer', value: { kind: 'text', value: item.id } }] })) });
  const recipe = multiStoreyLayout();
  const floor = recipe.levels[0]; assert.ok(floor);
  const rebuiltFloor = previewFloor(tagged, { level: { id: floor.level.id, name: 'Renamed basement' },
    rooms: floor.rooms, openings: floor.openings, wallThicknessMm: floor.wallThicknessMm, heightMm: floor.heightMm });
  const rebuiltBuilding = previewBuilding(tagged, recipe);
  for (const after of [rebuiltFloor, rebuiltBuilding]) {
    for (const entity of after.entities) assert.deepEqual(entity.parameters, tagged.entities.find(before => before.id === entity.id)?.parameters);
    assert.deepEqual(diffSnapshots(tagged, after).entities.modified.map(item => item.id), after === rebuiltFloor ? [floor.level.id] : []);
  }
  assert.ok(tagged.entities.every(item => item.parameters?.length === 1));
});

test('whole-building authoring compiles three coincident floors with stairs and no false exterior doors', async () => {
  const before = await legacy(); const bytes = JSON.stringify(before);
  const building = previewBuilding(before, multiStoreyLayout());
  assert.equal(building.version, 2);
  assert.equal(building.entities.filter((item) => item.type === 'Level').length, 3);
  assert.equal(building.entities.filter((item) => item.type === 'Slab').length, 3);
  assert.equal(building.entities.filter((item) => item.type === 'Stair').length, 2);
  assert.equal(building.entities.filter((item) => item.type === 'Door').length, 4);
  assert.ok(diffSnapshots(before, building).entities.added.length > 0);
  assert.deepEqual(previewBuilding(building, multiStoreyLayout()), building);
  assert.equal(JSON.stringify(before), bytes);
});

test('one-floor reconstruction preserves other storeys, contents, slabs, roof and incident stairs exactly', async () => {
  const building = previewBuilding(multiStoreySnapshot(), multiStoreyLayout());
  const recipe = multiStoreyLayout().levels.find((floor) => floor.level.id === 'level-attic');
  assert.ok(recipe);
  const input = { level: { id: recipe.level.id, name: 'Reviewed attic' }, rooms: recipe.rooms,
    openings: recipe.openings, wallThicknessMm: recipe.wallThicknessMm, heightMm: recipe.heightMm };
  const after = previewFloor(building, input);
  assert.equal(after.version, 2);
  assert.deepEqual(levelView(after, 'level-basement').entities.filter((item) => item.type !== 'Level'),
    levelView(building, 'level-basement').entities.filter((item) => item.type !== 'Level'));
  // Views retain all level metadata, so compare geometry when the attic name changes.
  assert.deepEqual(after.entities.filter((item) => item.type !== 'Level' && !diffSnapshots(building, after).entities.modified.some((change) => change.id === item.id)),
    building.entities.filter((item) => item.type !== 'Level'));
  assert.deepEqual(diffSnapshots(building, after).entities.modified.map((change) => change.id), ['level-attic']);
  assert.equal(diffSnapshots(building, after).relationships.modified.length, 0);
});

test('a failed level edit preserves the draft when retained stairs or slab no longer fit', () => {
  const base = multiStoreySnapshot(); const before = JSON.stringify(base);
  const recipe = multiStoreyLayout().levels[0]; assert.ok(recipe);
  assert.throws(() => previewFloor(base, { level: { id: recipe.level.id, name: recipe.level.name },
    rooms: recipe.rooms.map((room) => ({ ...room, boundsMm: { ...room.boundsMm, maxY: 5000 } })),
    openings: recipe.openings, wallThicknessMm: 150, heightMm: 2700 }), /slab/);
  assert.equal(JSON.stringify(base), before);
});

test('legacy content moves into a unique zero level, and building contents retain their owner', async () => {
  const base = await legacy();
  const furnished = validateSnapshot({ ...base, entities: [...base.entities, { id: 'kept-plant', type: 'Furniture', name: 'Kept plant',
    kind: 'plant', position: [1, 3], width: .3, depth: .3, height: 1, rotationDeg: 0, supportId: null }] });
  const building = previewBuilding(furnished, multiStoreyLayout());
  const kept = building.entities.find((item) => item.id === 'kept-plant');
  assert.ok(kept && 'levelId' in kept); assert.equal(kept.levelId, 'level-ground');
  assert.deepEqual(previewBuilding(building, multiStoreyLayout()).entities.find((item) => item.id === kept.id), kept);
  const noZero = multiStoreyLayout(); noZero.levels.forEach((floor) => { floor.level.elevationMm += 1000; });
  assert.throws(() => previewBuilding(furnished, noZero), /unique elevation-zero/);
  const removedOwner = multiStoreyLayout(); removedOwner.levels = removedOwner.levels.filter((floor) => floor.level.id !== 'level-ground');
  assert.throws(() => previewBuilding(building, removedOwner), /retain every content owner/);
});

test('authoring rejects unknown fields and accessors before running untrusted getters', () => {
  assert.throws(() => parseBuildingLayout({ ...multiStoreyLayout(), extra: true }), /exact fields/);
  let called = false;
  const hostile = Object.defineProperty({}, 'levels', { enumerable: true, get() { called = true; return []; } });
  assert.throws(() => parseBuildingLayout(hostile), /plain data/); assert.equal(called, false);
});
