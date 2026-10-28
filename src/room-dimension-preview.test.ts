import assert from 'node:assert/strict';
import test from 'node:test';
import { entityLevel } from './building-levels.ts';
import { multiStoreySnapshot } from './multi-storey-house.ts';
import { residentialFloor } from './residential-floor.ts';
import { roomDimensionFixture } from './room-dimension-fixture.ts';
import { previewRoomDimensionChange } from './room-dimension-preview.ts';
import type { RoomDimensionDependency, RoomDimensionRequest } from './room-dimension-preview.ts';
import { diffSnapshots, validateSnapshot } from './room-model.ts';
import type { ModelSnapshot, Point } from './room-model.ts';
import { previewWallShift } from './wall-dependencies.ts';

function request(base: ModelSnapshot = roomDimensionFixture()): RoomDimensionRequest {
  const host = base.relationships.find((link) => link.source === 'door-between');
  assert.ok(host);
  return { roomId: 'room-a', wallId: host.target, axis: 'x',
    measurement: { kind: 'confirmed', metres: 3.3, sourceRef: 'synthetic-measurement:room-a-x' },
    minimumClearSpans: [{ roomId: 'room-b', axis: 'x', metres: 2.5 }] };
}

test('confirmed centreline span drives a bounded move with deterministic room and evaluated opening deltas', () => {
  const base = roomDimensionFixture(); const bytes = JSON.stringify(base); const input = request(base);
  const result = previewRoomDimensionChange(base, input);
  assert.deepEqual(result, previewRoomDimensionChange(base, input));
  assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  assert.equal(result.offsetMetres, .3);
  assert.deepEqual(result.snapshot, previewWallShift(base, { wallId: input.wallId, offsetMetres: .3 }).snapshot);
  assert.deepEqual(result.delta, diffSnapshots(base, result.snapshot));
  assert.deepEqual(validateSnapshot(result.snapshot), result.snapshot);
  assert.deepEqual(result.measurement, input.measurement);
  assert.deepEqual(result.dependencies.map((item) => `${item.kind}:${item.id}`),
    ['opening:door-between', 'opening:window-between', 'room:room-a', 'room:room-b']);
  const room = result.dependencies.find((item) => item.id === 'room-a');
  assert.ok(room?.kind === 'room');
  assert.deepEqual(room.before, { bounds: { minX: 0, minY: 0, maxX: 3, maxY: 4 },
    centrelineSpans: { x: 3, y: 4 }, clearSpans: { x: 2.85, y: 3.85 } });
  assert.deepEqual(room.after, { bounds: { minX: 0, minY: 0, maxX: 3.3, maxY: 4 },
    centrelineSpans: { x: 3.3, y: 4 }, clearSpans: { x: 3.15, y: 3.85 } });
  assert.equal(room.storedChanged, true); assert.equal(room.evaluatedChanged, true);
  assert.deepEqual(result.clearSpanChecks, [{ roomId: 'room-b', axis: 'x', metres: 2.5, beforeMetres: 2.85, afterMetres: 2.55 }]);
  const expectedOpenings: { id: string; start: Point; end: Point }[] = [
    { id: 'door-between', start: [3, 1], end: [3, 1.9] }, { id: 'window-between', start: [3, 2.4], end: [3, 3] },
  ];
  for (const { id, start, end } of expectedOpenings) {
    const opening: RoomDimensionDependency | undefined = result.dependencies.find((item) => item.id === id);
    assert.ok(opening?.kind === 'opening');
    assert.deepEqual(opening.before.start, start); assert.deepEqual(opening.before.end, end);
    assert.equal(opening.after.start[0], 3.3); assert.equal(opening.after.end[0], 3.3);
    assert.equal(opening.storedChanged, false); assert.equal(opening.evaluatedChanged, true);
  }
  assert.equal(JSON.stringify(base), bytes);
  for (const entity of base.entities) {
    if (result.delta.entities.modified.some((item) => item.id === entity.id)) continue;
    assert.deepEqual(result.snapshot.entities.find((item) => item.id === entity.id), entity);
  }
  assert.deepEqual(result.snapshot.relationships, base.relationships);
  assert.deepEqual(result.delta.entities.added, []); assert.deepEqual(result.delta.entities.removed, []);
});

test('minimum-side room uses global negative translation for a larger span', () => {
  const base = roomDimensionFixture(); const input = request(base);
  const result = previewRoomDimensionChange(base, { ...input, roomId: 'room-b', minimumClearSpans: [] });
  assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  assert.equal(result.offsetMetres, -.3);
  const room = result.dependencies.find((item) => item.id === 'room-b'); assert.ok(room?.kind === 'room');
  assert.equal(room.after.centrelineSpans.x, 3.3); assert.equal(room.after.bounds.minX, 2.7);
});

test('horizontal partition and reversed endpoints retain dimension and host semantics', () => {
  const fixture = roomDimensionFixture();
  const rotated = validateSnapshot({ ...fixture, entities: fixture.entities.map((item) => {
    if (item.type === 'Wall') return { ...item, start: [item.start[1], item.start[0]], end: [item.end[1], item.end[0]] };
    if (item.type !== 'Space') return item;
    const b = item.bounds; return { ...item, bounds: { minX: b.minY, maxX: b.maxY, minY: b.minX, maxY: b.maxX } };
  }) });
  const input = request(rotated);
  const reversed = validateSnapshot({ ...rotated, entities: rotated.entities.map((item) => item.id === input.wallId && item.type === 'Wall'
    ? { ...item, start: item.end, end: item.start } : item), relationships: rotated.relationships.map((link) => {
    if (link.target !== input.wallId) return link;
    const opening = rotated.entities.find((item) => item.id === link.source);
    assert.ok(opening?.type === 'Door' || opening?.type === 'Window');
    return { ...link, offset: Math.round((4 - link.offset - opening.width) * 1000) / 1000 };
  }) });
  const result = previewRoomDimensionChange(reversed, { ...input, axis: 'y', minimumClearSpans: [] });
  assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  assert.equal(result.offsetMetres, .3);
  const room = result.dependencies.find((item) => item.id === 'room-a'); assert.ok(room?.kind === 'room');
  assert.equal(room.after.centrelineSpans.y, 3.3);
  const door = result.dependencies.find((item) => item.id === 'door-between'); assert.ok(door?.kind === 'opening');
  assert.deepEqual(door.before.start, [1.9, 3]); assert.deepEqual(door.after.start, [1.9, 3.3]);
  assert.deepEqual(door.after.end, [1, 3.3]);
});

for (const reason of ['unknown-scale', 'ambiguous-dimension', 'contradictory-evidence'] as const) {
  test(`${reason} yields unresolved evidence with no geometry candidate`, () => {
    const base = roomDimensionFixture(); const bytes = JSON.stringify(base);
    const input: RoomDimensionRequest = { ...request(base), measurement: { kind: 'unresolved', reason, sourceRefs: ['sheet-b', 'sheet-a', 'sheet-b'] } };
    const result = previewRoomDimensionChange(base, input);
    assert.deepEqual(result, { status: 'unresolved', measurement: { kind: 'unresolved', reason, sourceRefs: ['sheet-a', 'sheet-b'] } });
    assert.equal('snapshot' in result, false); assert.equal('delta' in result, false);
    assert.deepEqual(input.measurement, { kind: 'unresolved', reason, sourceRefs: ['sheet-b', 'sheet-a', 'sheet-b'] });
    assert.equal(JSON.stringify(base), bytes);
  });
}

test('a minimum clear span blocks an otherwise valid centreline move atomically', () => {
  const base = roomDimensionFixture(); const bytes = JSON.stringify(base); const input = request(base);
  assert.throws(() => previewRoomDimensionChange(base, { ...input, minimumClearSpans: [{ roomId: 'room-b', axis: 'x', metres: 2.6 }] }),
    /Minimum clear span for room-b on x requires 2.6 m; candidate has 2.55 m/);
  assert.equal(JSON.stringify(base), bytes);
  const result = previewRoomDimensionChange(base, { ...input, minimumClearSpans: [{ roomId: 'room-b', axis: 'x', metres: 2.55 }] });
  assert.equal(result.status, 'ready');
});

test('clear constraints use the unchanged native wall-thickness convention', () => {
  const base = residentialFloor();
  const result = previewRoomDimensionChange(base, { roomId: 'room-living', wallId: 'wall-living-kitchen', axis: 'x',
    measurement: { kind: 'confirmed', metres: 5.2, sourceRef: 'synthetic-plan' },
    minimumClearSpans: [{ roomId: 'room-living', axis: 'x', metres: 5 }] });
  assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  assert.deepEqual(result.clearSpanChecks, [{ roomId: 'room-living', axis: 'x', metres: 5, beforeMetres: 4.8, afterMetres: 5 }]);
  assert.throws(() => previewRoomDimensionChange(base, { roomId: 'room-living', wallId: 'wall-living-kitchen', axis: 'x',
    measurement: { kind: 'confirmed', metres: 5.2, sourceRef: 'synthetic-plan' },
    minimumClearSpans: [{ roomId: 'room-living', axis: 'x', metres: 5.025 }] }), /candidate has 5 m/);
});

test('a named unaffected room is reported as unchanged and can still block the request', () => {
  const base = residentialFloor();
  const input: RoomDimensionRequest = { roomId: 'room-living', wallId: 'wall-living-kitchen', axis: 'x',
    measurement: { kind: 'confirmed', metres: 5.2, sourceRef: 'synthetic-plan' },
    minimumClearSpans: [{ roomId: 'room-office', axis: 'x', metres: 2.8 }] };
  const result = previewRoomDimensionChange(base, input);
  assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  const office = result.dependencies.find((item) => item.id === 'room-office');
  assert.ok(office?.kind === 'room'); assert.equal(office.storedChanged, false); assert.equal(office.evaluatedChanged, false);
  assert.deepEqual(office.before, office.after);
  assert.throws(() => previewRoomDimensionChange(base, { ...input, minimumClearSpans: [{ roomId: 'room-office', axis: 'x', metres: 2.9 }] }), /Minimum clear span/);
});

test('different level room cannot drive a coincident wall and unrelated building entities remain unchanged', () => {
  const base = multiStoreySnapshot();
  const input: RoomDimensionRequest = { roomId: 'level-ground-west', wallId: 'level-ground-wall-inner', axis: 'x',
    measurement: { kind: 'confirmed', metres: 4.2, sourceRef: 'synthetic-plan' }, minimumClearSpans: [] };
  assert.throws(() => previewRoomDimensionChange(base, { ...input, roomId: 'level-attic-west' }), /same level/);
  const result = previewRoomDimensionChange(base, input);
  assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  for (const item of base.entities.filter((entity) => !result.delta.entities.modified.some((change) => change.id === entity.id))) {
    assert.deepEqual(result.snapshot.entities.find((entity) => entity.id === item.id), item);
  }
  assert.deepEqual(result.snapshot.relationships, base.relationships);
  assert.ok(result.dependencies.every((item) => entityLevel(base, item.id)?.id === 'level-ground'));
});

test('invalid dimensions, unsupported moves, room/wall mismatch and constraint references refuse a candidate', () => {
  const base = roomDimensionFixture(); const input = request(base);
  for (const metres of [NaN, Infinity, 0, -1, 3.3005, 1001]) {
    assert.throws(() => previewRoomDimensionChange(base, { ...input, measurement: { kind: 'confirmed', metres, sourceRef: 'sheet' } }), /positive metre values/);
  }
  for (const metres of [3, 4.001]) {
    assert.throws(() => previewRoomDimensionChange(base, { ...input, measurement: { kind: 'confirmed', metres, sourceRef: 'sheet' } }), /nonzero millimetre-grid offset/);
  }
  assert.throws(() => previewRoomDimensionChange(base, { ...input, axis: 'y' }), /must bound room/);
  assert.throws(() => previewRoomDimensionChange(base, { ...input, wallId: 'door-between' }), /existing wall/);
  assert.throws(() => previewRoomDimensionChange(base, { ...input, roomId: 'room-absent' }), /existing room/);
  assert.throws(() => previewRoomDimensionChange(base, { ...input, minimumClearSpans: [{ roomId: 'room-absent', axis: 'x', metres: 1 }] }), /existing room/);
  assert.throws(() => previewRoomDimensionChange(base, { ...input, minimumClearSpans: [...input.minimumClearSpans, ...input.minimumClearSpans] }), /unique per room and axis/);
  assert.throws(() => previewRoomDimensionChange(base, { ...input, minimumClearSpans: Array.from({ length: 25 }, () => ({ roomId: 'room-b', axis: 'x', metres: 1 })) }), /At most 24/);
  assert.throws(() => previewRoomDimensionChange(base, { ...input, measurement: { kind: 'confirmed', metres: 3.3, sourceRef: ' ' } }), /source reference/);
});

test('existing validators still refuse an opening stranded by a shrinking perpendicular host', () => {
  const source = residentialFloor();
  const base = validateSnapshot({ ...source, entities: [...source.entities,
    { id: 'window-fit', name: 'Synthetic high opening', type: 'Window', width: .4, height: .5, sillHeight: 1.3 }],
  relationships: [...source.relationships,
    { id: 'host-window-fit', type: 'hosted-by', source: 'window-fit', target: 'wall-living-kitchen', offset: 3.5 }] });
  const bytes = JSON.stringify(base);
  assert.throws(() => previewRoomDimensionChange(base, { roomId: 'room-living', wallId: 'wall-south-hall', axis: 'y',
    measurement: { kind: 'confirmed', metres: 3.8, sourceRef: 'synthetic-plan' }, minimumClearSpans: [] }), /Wall shift .* rejected/);
  assert.equal(JSON.stringify(base), bytes);
});

test('perpendicular resized-host links report evaluated geometry separately from stored relationship changes', () => {
  const source = residentialFloor();
  const base = validateSnapshot({ ...source, entities: [...source.entities,
    { id: 'window-follow', name: 'Synthetic light', type: 'Window', width: .4, height: .5, sillHeight: 1.3 }],
  relationships: [...source.relationships,
    { id: 'host-window-follow', type: 'hosted-by', source: 'window-follow', target: 'wall-living-kitchen', offset: 2 }] });
  const reversed = validateSnapshot({ ...base, entities: base.entities.map((item) => item.id === 'wall-living-kitchen' && item.type === 'Wall'
    ? { ...item, start: item.end, end: item.start } : item), relationships: base.relationships.map((link) => link.id === 'host-window-follow' ? { ...link, offset: 1.6 } : link) });
  const result = previewRoomDimensionChange(reversed, { roomId: 'room-living', wallId: 'wall-south-hall', axis: 'y',
    measurement: { kind: 'confirmed', metres: 4.1, sourceRef: 'synthetic-plan' }, minimumClearSpans: [] });
  assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  const opening = result.dependencies.find((item) => item.id === 'window-follow'); assert.ok(opening?.kind === 'opening');
  assert.equal(opening.storedChanged, false); assert.equal(opening.evaluatedChanged, false);
  assert.deepEqual(opening.before, opening.after);
  assert.ok(result.delta.relationships.modified.some((item) => item.id === 'host-window-follow'));
});
