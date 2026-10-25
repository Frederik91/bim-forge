import assert from 'node:assert/strict';
import test from 'node:test';
import { entityElevation, entityLevel, levels, levelView, roofHeightAt, stairFootprint } from './building-levels.ts';
import { entitySpace, spaceAt, spaceForFootprint } from './floor-plan.ts';
import { multiStoreySnapshot } from './multi-storey-house.ts';
import { validateSnapshot } from './room-model.ts';

test('coincident floor plans resolve ownership and elevations without mutating the building', () => {
  const snapshot = multiStoreySnapshot(); const before = JSON.stringify(snapshot);
  assert.deepEqual(levels(snapshot).map((level) => level.elevation), [-3, 0, 3]);
  for (const level of levels(snapshot)) {
    const view = levelView(snapshot, level.id);
    assert.equal(Object.isFrozen(view.entities), true);
    assert.equal(view.entities.filter((item) => item.type === 'Level').length, 3);
    assert.equal(spaceAt(view, [1, 4])?.levelId, level.id);
    assert.equal(spaceForFootprint(view, { minX: .9, minY: 4, maxX: 1.1, maxY: 4.2 })?.levelId, level.id);
    for (const entity of view.entities) if (entity.type !== 'Level' && entity.type !== 'Stair') assert.equal(entityLevel(snapshot, entity)?.id, level.id);
    assert.equal(entityElevation(snapshot, level.id + '-plant'), level.elevation);
    assert.equal(entityElevation(snapshot, level.id + '-door-inner'), level.elevation);
    const plant = snapshot.entities.find((item) => item.id === level.id + '-plant');
    assert.ok(plant); assert.equal(entitySpace(snapshot, plant)?.levelId, level.id);
  }
  assert.throws(() => spaceAt(snapshot, [1, 4]), /level-scoped/);
  assert.throws(() => spaceForFootprint(snapshot, { minX: .9, minY: 4, maxX: 1.1, maxY: 4.2 }), /level-scoped/);
  assert.throws(() => levelView(snapshot, 'missing'), /Unknown level/);
  assert.equal(entityLevel(snapshot, 'missing'), null);
  assert.equal(JSON.stringify(snapshot), before);
});

test('level projections include incident stairs while their world base remains the lower level', () => {
  const snapshot = multiStoreySnapshot();
  const ground = levelView(snapshot, 'level-ground');
  assert.equal(ground.incidentStairs.length, 2);
  const stair = ground.incidentStairs.find((item) => item.fromLevelId === 'level-basement');
  assert.ok(stair);
  assert.equal(entityElevation(ground, stair), -3);
  assert.deepEqual(stairFootprint(stair), { minX: 1, maxX: 3, minY: 1.1, maxY: 1.9 });
});

test('roof queries return local underside height for either pitch direction or flat roofs', () => {
  const snapshot = multiStoreySnapshot();
  assert.equal(roofHeightAt(snapshot, 'level-ground', [4, 3]), Infinity);
  assert.equal(roofHeightAt(snapshot, 'level-attic', [4, 0]), 2.5);
  assert.equal(roofHeightAt(snapshot, 'level-attic', [4, 3]), 4);
  assert.equal(roofHeightAt(snapshot, 'level-attic', [-1, 0]), Infinity);
  const flat = validateSnapshot({ ...snapshot, entities: snapshot.entities.map((item) => item.type === 'Roof'
    ? { ...item, profile: { kind: 'flat', height: 3 } } : item) });
  assert.equal(roofHeightAt(flat, 'level-attic', [4, 0]), 2.8);
  const rotated = validateSnapshot({ ...snapshot, entities: snapshot.entities.map((item) => item.type === 'Roof'
    ? { ...item, profile: { ...item.profile, ridgeAxis: 'y' } } : item) });
  assert.equal(roofHeightAt(rotated, 'level-attic', [0, 3]), 2.5);
  assert.equal(roofHeightAt(rotated, 'level-attic', [4, 3]), 4);
});
