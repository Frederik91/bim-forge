import assert from 'node:assert/strict';
import test from 'node:test';
import { entityLevel, levelView } from './building-levels.ts';
import { doorClearanceBounds, doorConnections, entitySpace } from './floor-plan.ts';
import { compileFloorLayout } from './floor-layout.ts';
import { residentialFloor } from './residential-floor.ts';
import { multiStoreySnapshot } from './multi-storey-house.ts';
import { diffSnapshots, validateSnapshot } from './room-model.ts';
import type { ModelSnapshot, Point } from './room-model.ts';
import { previewWallShift } from './wall-dependencies.ts';

function openingPoints(snapshot: ModelSnapshot, id: string): { start: Point; end: Point } {
  const opening = snapshot.entities.find((item) => item.id === id);
  const host = snapshot.relationships.find((item) => item.source === id);
  const wall = snapshot.entities.find((item) => item.id === host?.target);
  assert.ok((opening?.type === 'Door' || opening?.type === 'Window') && host && wall?.type === 'Wall');
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  // Compare evaluated world points on the native millimetre grid.
  const point = (offset: number): Point => [Math.round((wall.start[0] + (wall.end[0] - wall.start[0]) * offset / length) * 1000) / 1000,
    Math.round((wall.start[1] + (wall.end[1] - wall.start[1]) * offset / length) * 1000) / 1000];
  return { start: point(host.offset), end: point(host.offset + opening.width) };
}

function hostedPartition(): ModelSnapshot {
  const base = residentialFloor();
  return validateSnapshot({ ...base, entities: [...base.entities,
    { id: 'door-shared', type: 'Door', name: 'Shared partition door', width: .8, height: 2.1 },
    { id: 'window-shared', type: 'Window', name: 'Partition borrowed light', width: .6, height: .5, sillHeight: 1.3 }],
  relationships: [...base.relationships,
    { id: 'host-shared', type: 'hosted-by', source: 'door-shared', target: 'wall-living-kitchen', offset: 1.2 },
    { id: 'host-light', type: 'hosted-by', source: 'window-shared', target: 'wall-living-kitchen', offset: 2.5 }] });
}

function twoRooms(split = 2): ModelSnapshot {
  return validateSnapshot({ units: 'm', ...compileFloorLayout({ level: { id: 'level-test', name: 'Synthetic two-room floor' },
    heightMm: 2700, wallThicknessMm: 150,
    rooms: [
      { id: 'room-a', name: 'Room A', boundsMm: { minX: 0, minY: 0, maxX: split * 1000, maxY: 4000 } },
      { id: 'room-b', name: 'Room B', boundsMm: { minX: split * 1000, minY: 0, maxX: 6000, maxY: 4000 } },
    ], openings: [
      { id: 'door-exit', name: 'Exit', type: 'Door', roomId: 'room-b', side: 'east', offsetMm: 1000, widthMm: 900, heightMm: 2100 },
      { id: 'door-between', name: 'Connecting door', type: 'Door', roomId: 'room-a', side: 'east', offsetMm: 1000, widthMm: 900, heightMm: 2100 },
    ] }, { kind: 'legacy' }) });
}

function partitionId(snapshot: ModelSnapshot): string {
  const host = snapshot.relationships.find((link) => link.source === 'door-between');
  assert.ok(host);
  return host.target;
}

function fourRooms(): ModelSnapshot {
  const shell = compileFloorLayout({ level: { id: 'level-grid', name: 'Crossing partition fixture' }, heightMm: 2700, wallThicknessMm: 150,
    rooms: [
      { id: 'room-sw', name: 'South west', boundsMm: { minX: 0, minY: 0, maxX: 3000, maxY: 2000 } },
      { id: 'room-se', name: 'South east', boundsMm: { minX: 3000, minY: 0, maxX: 6000, maxY: 2000 } },
      { id: 'room-nw', name: 'North west', boundsMm: { minX: 0, minY: 2000, maxX: 3000, maxY: 4000 } },
      { id: 'room-ne', name: 'North east', boundsMm: { minX: 3000, minY: 2000, maxX: 6000, maxY: 4000 } },
    ], openings: [
      { id: 'door-grid-exit', name: 'Exit', type: 'Door', roomId: 'room-se', side: 'east', offsetMm: 500, widthMm: 800, heightMm: 2100 },
      { id: 'door-grid-west', name: 'West connection', type: 'Door', roomId: 'room-sw', side: 'east', offsetMm: 500, widthMm: 800, heightMm: 2100 },
      { id: 'door-grid-nw', name: 'North west connection', type: 'Door', roomId: 'room-nw', side: 'south', offsetMm: 500, widthMm: 800, heightMm: 2100 },
      { id: 'door-grid-ne', name: 'North east connection', type: 'Door', roomId: 'room-ne', side: 'south', offsetMm: 500, widthMm: 800, heightMm: 2100 },
    ] }, { kind: 'legacy' });
  return validateSnapshot({ units: 'm', ...shell });
}

test('shared wall shift retains identity and exposes a deterministic before/after delta', () => {
  const base = residentialFloor(); const bytes = JSON.stringify(base);
  const request = { wallId: 'wall-living-kitchen', offsetMetres: .3 };
  const result = previewWallShift(base, request);
  assert.deepEqual(result, previewWallShift(base, request));
  assert.deepEqual(validateSnapshot(result.snapshot), result.snapshot);
  assert.deepEqual(result.delta, diffSnapshots(base, result.snapshot));
  assert.deepEqual(result.delta.entities.modified.map((item) => item.id), ['room-kitchen', 'room-living', 'wall-living-kitchen']);
  assert.deepEqual(result.delta.relationships, { added: [], removed: [], modified: [] });
  assert.deepEqual(result.delta.entities.added, []); assert.deepEqual(result.delta.entities.removed, []);
  const wall = result.delta.entities.modified.find((item) => item.id === request.wallId);
  assert.ok(wall?.before.type === 'Wall' && wall.after.type === 'Wall');
  assert.deepEqual(wall.before.start, [5, 0]); assert.deepEqual(wall.after.start, [5.3, 0]);
  assert.equal(JSON.stringify(base), bytes);
  for (const before of base.entities) {
    if (result.delta.entities.modified.some((item) => item.id === before.id)) continue;
    assert.equal(JSON.stringify(result.snapshot.entities.find((item) => item.id === before.id)), JSON.stringify(before));
  }
  assert.deepEqual(previewWallShift(result.snapshot, { ...request, offsetMetres: -.3 }).snapshot, base);
});

test('named hosted door and window follow translated host even when stored bodies and links are unchanged', () => {
  const base = hostedPartition();
  const result = previewWallShift(base, { wallId: 'wall-living-kitchen', offsetMetres: .3 });
  for (const id of ['door-shared', 'window-shared']) {
    assert.deepEqual(result.snapshot.entities.find((item) => item.id === id), base.entities.find((item) => item.id === id));
    const before = openingPoints(base, id); const after = openingPoints(result.snapshot, id);
    assert.equal(after.start[0], before.start[0] + .3); assert.equal(after.end[0], before.end[0] + .3);
    assert.equal(after.start[1], before.start[1]); assert.equal(after.end[1], before.end[1]);
    assert.deepEqual(result.impacts.find((item) => item.id === id), { kind: 'entity', id,
      reasons: ['hosted-opening'], changed: false });
  }
  assert.deepEqual(result.snapshot.relationships, base.relationships);
  const door = result.snapshot.entities.find((item) => item.id === 'door-shared'); assert.ok(door?.type === 'Door');
  const clearance = doorClearanceBounds(result.snapshot, door);
  assert.ok(Math.abs(clearance.minX - 4.4) < 1e-9); assert.ok(Math.abs(clearance.maxX - 6.2) < 1e-9);
  assert.equal(clearance.minY, 1.2); assert.equal(clearance.maxY, 2);
  assert.deepEqual(doorConnections(result.snapshot).find((item) => item.door.id === door.id)?.roomIds, ['room-kitchen', 'room-living']);
});

test('long shared partition updates multiple rectangular rooms and terminating T-junctions', () => {
  const base = residentialFloor();
  const result = previewWallShift(base, { wallId: 'wall-south-hall', offsetMetres: .1 });
  assert.deepEqual(result.delta.entities.modified.map((item) => item.id),
    ['room-hall', 'room-kitchen', 'room-living', 'room-office', 'wall-kitchen-office', 'wall-living-kitchen', 'wall-south-hall']);
  for (const id of ['wall-kitchen-office', 'wall-living-kitchen']) {
    const wall = result.snapshot.entities.find((item) => item.id === id); assert.ok(wall?.type === 'Wall');
    assert.equal(wall.end[1], 4.1);
  }
  for (const id of ['wall-east', 'wall-west']) {
    assert.deepEqual(result.snapshot.entities.find((item) => item.id === id), base.entities.find((item) => item.id === id));
    assert.ok(result.impacts.some((item) => item.id === id && item.reasons.includes('wall-junction') && !item.changed));
  }
  assert.ok(result.impacts.some((item) => item.id === 'office-monitor' && !item.changed));
  assert.ok(result.impacts.some((item) => item.id === 'office-desk' && item.reasons.includes('support') && !item.changed));
});

test('reversed wall endpoints retain translation direction and opening host semantics', () => {
  const source = hostedPartition();
  const base = validateSnapshot({ ...source, entities: source.entities.map((item) => item.id === 'wall-living-kitchen' && item.type === 'Wall'
    ? { ...item, start: item.end, end: item.start } : item), relationships: source.relationships.map((link) => {
    const opening = source.entities.find((item) => item.id === link.source);
    return link.target === 'wall-living-kitchen' && (opening?.type === 'Door' || opening?.type === 'Window')
      ? { ...link, offset: Math.round((4 - link.offset - opening.width) * 1000) / 1000 } : link;
  }) });
  const result = previewWallShift(base, { wallId: 'wall-living-kitchen', offsetMetres: -.2 });
  assert.equal(openingPoints(result.snapshot, 'door-shared').start[0], 4.8);
  assert.equal(openingPoints(base, 'door-shared').start[0], 5);
});

test('resizing a reversed perpendicular host preserves named opening world geometry by changing its local offset', () => {
  const source = hostedPartition();
  const base = validateSnapshot({ ...source, entities: source.entities.map((item) => item.id === 'wall-living-kitchen' && item.type === 'Wall'
    ? { ...item, start: item.end, end: item.start } : item), relationships: source.relationships.map((link) => {
    const opening = source.entities.find((item) => item.id === link.source);
    return link.target === 'wall-living-kitchen' && (opening?.type === 'Door' || opening?.type === 'Window')
      ? { ...link, offset: Math.round((4 - link.offset - opening.width) * 1000) / 1000 } : link;
  }) });
  const result = previewWallShift(base, { wallId: 'wall-south-hall', offsetMetres: .1 });
  assert.deepEqual(openingPoints(result.snapshot, 'door-shared'), openingPoints(base, 'door-shared'));
  assert.deepEqual(openingPoints(result.snapshot, 'window-shared'), openingPoints(base, 'window-shared'));
  assert.deepEqual(result.delta.relationships.modified.map((item) => item.id), ['host-light', 'host-shared']);
});

test('rejects invalid target, units, offset bounds and unsupported unlevelled shell', () => {
  const base = residentialFloor();
  for (const offsetMetres of [0, .0005, 1.001, -1.001, NaN, Infinity]) {
    assert.throws(() => previewWallShift(base, { wallId: 'wall-living-kitchen', offsetMetres }), /millimetre-grid offset/);
  }
  for (const wallId of ['room-living', 'missing-wall']) assert.throws(() => previewWallShift(base, { wallId, offsetMetres: .1 }), /existing wall/);
  assert.throws(() => previewWallShift({ ...base, units: 'mm' }, { wallId: 'wall-living-kitchen', offsetMetres: .1 }), /Unsupported model snapshot/);
  assert.throws(() => previewWallShift(base, { wallId: 'wall-west', offsetMetres: .1 }), /Exterior wall/);
  const shell = validateSnapshot({ units: 'm', entities: base.entities.filter((item) => item.type === 'Wall'
    && ['wall-north', 'wall-south', 'wall-east', 'wall-west'].includes(item.id)), relationships: [] });
  assert.throws(() => previewWallShift(shell, { wallId: 'wall-west', offsetMetres: .1 }), /named residential level/);
});

test('narrow clear interior and collapsed/overlapping room edits reject atomically', () => {
  const base = twoRooms(.5); const bytes = JSON.stringify(base); const wallId = partitionId(base);
  assert.throws(() => previewWallShift(base, { wallId, offsetMetres: -.4 }), /no clear interior/);
  assert.throws(() => previewWallShift(base, { wallId, offsetMetres: -.5 }), /collapse room/);
  assert.throws(() => previewWallShift(base, { wallId, offsetMetres: -.6 }), /collapse room/);
  assert.equal(JSON.stringify(base), bytes);
});

test('retained furnishings and supports reject a shift into their occupied room space', () => {
  const base = residentialFloor(); const bytes = JSON.stringify(base);
  assert.throws(() => previewWallShift(base, { wallId: 'wall-kitchen-office', offsetMetres: .9 }), /fit inside one room/);
  assert.throws(() => previewWallShift(base, { wallId: 'wall-living-kitchen', offsetMetres: .6 }), /fit inside one room/);
  assert.equal(JSON.stringify(base), bytes);
});

test('hosted opening cannot be clipped by a resized perpendicular wall', () => {
  const source = residentialFloor();
  const base = validateSnapshot({ ...source, entities: [...source.entities,
    { id: 'window-high', type: 'Window', name: 'High partition window', width: .6, height: .4, sillHeight: 1.4 }],
  relationships: [...source.relationships,
    { id: 'host-high', type: 'hosted-by', source: 'window-high', target: 'wall-living-kitchen', offset: 3.3 }] });
  const bytes = JSON.stringify(base);
  assert.throws(() => previewWallShift(base, { wallId: 'wall-south-hall', offsetMetres: -.2 }), /Hosted opening must fit/);
  assert.equal(JSON.stringify(base), bytes);
});

test('moved door clearance rejects retained objects even when they still fit the room', () => {
  const source = hostedPartition();
  const base = validateSnapshot({ ...source, entities: [...source.entities,
    { id: 'floor-marker', type: 'Furniture', name: 'Retained object', kind: 'plant', position: [6.05, 1.6],
      width: .2, depth: .2, height: .5, rotationDeg: 0, supportId: null }] });
  assert.throws(() => previewWallShift(base, { wallId: 'wall-living-kitchen', offsetMetres: .3 }), /door clearance/);
});

test('moved door clearance also rejects fixed equipment', () => {
  const source = hostedPartition();
  const base = validateSnapshot({ ...source, entities: [...source.entities,
    { id: 'fixed-unit', type: 'Equipment', name: 'Fixed ventilation unit', category: 'mechanical', position: [6.05, 1.6],
      width: .2, depth: .2, height: .5, elevation: 0 }] });
  const bytes = JSON.stringify(base);
  assert.throws(() => previewWallShift(base, { wallId: 'wall-living-kitchen', offsetMetres: .3 }), /Equipment fixed-unit blocks a door clearance/);
  assert.equal(JSON.stringify(base), bytes);
});

test('a shift cannot jump a retained object into a different room', () => {
  const source = twoRooms();
  const base = validateSnapshot({ ...source, entities: [...source.entities,
    { id: 'retained-item', type: 'Furniture', name: 'Retained object', kind: 'plant', position: [2.5, 3],
      width: .2, depth: .2, height: .5, rotationDeg: 0, supportId: null }] });
  assert.throws(() => previewWallShift(base, { wallId: partitionId(base), offsetMetres: .8 }), /cannot transfer retained-item/);
});

test('crossing partitions and collinear continuations reject atomically', () => {
  const base = fourRooms(); const bytes = JSON.stringify(base);
  const vertical = base.entities.find((item) => item.type === 'Wall' && item.start[0] === 3 && item.end[0] === 3);
  const horizontal = base.entities.find((item) => item.type === 'Wall' && item.start[1] === 2 && item.end[1] === 2);
  assert.ok(vertical?.type === 'Wall' && horizontal?.type === 'Wall');
  assert.throws(() => previewWallShift(base, { wallId: horizontal.id, offsetMetres: .1 }), /Crossing junction/);
  const split = validateSnapshot({ ...base, entities: [...base.entities.map((item) => item.id === vertical.id
    ? { ...vertical, end: [3, 2] } : item), { ...vertical, id: 'wall-upper-continuation', start: [3, 2] }] });
  assert.throws(() => previewWallShift(split, { wallId: vertical.id, offsetMetres: .1 }), /Collinear continuation/);
  assert.equal(JSON.stringify(base), bytes);
});

test('partial rectangular sides reject without attempting a general topology repair', () => {
  const source = residentialFloor();
  const base = validateSnapshot({ ...source, entities: [...source.entities.map((item) => item.id === 'wall-living-kitchen' && item.type === 'Wall'
    ? { ...item, end: [5, 2] } : item), { id: 'wall-continuation', type: 'Wall', name: 'Continuation',
    start: [5, 2], end: [5, 4], thickness: .15, height: 2.7 }] });
  assert.throws(() => previewWallShift(base, { wallId: 'wall-living-kitchen', offsetMetres: .1 }), /part of a rectangular room side/);
});

test('version two shift retains coincident geometry on a different level', () => {
  const base = multiStoreySnapshot();
  const result = previewWallShift(base, { wallId: 'level-ground-wall-inner', offsetMetres: .3 });
  for (const id of ['level-basement', 'level-attic']) assert.deepEqual(levelView(result.snapshot, id), levelView(base, id));
  assert.ok(result.delta.entities.modified.every((item) => entityLevel(base, item.before)?.id === 'level-ground'));
  assert.ok(result.impacts.every((item) => !item.id.startsWith('level-attic-') && !item.id.startsWith('level-basement-')));
  for (const item of base.entities.filter((item) => item.type === 'Furniture')) {
    assert.equal(entitySpace(base, item)?.id, entitySpace(result.snapshot, item)?.id);
  }
});
