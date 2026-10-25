import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { parseFloorLayout, previewFloor } from './floor-layout.ts';
import type { FloorLayout } from './floor-layout.ts';
import { doorConnections, floorBounds, spaces } from './floor-plan.ts';
import { ModelScripts } from './model-script.ts';
import type { ModelScriptBinding } from './model-script.ts';
import { RoomRepository, diffSnapshots, validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';

function twoRooms(): FloorLayout {
  return {
    level: { id: 'level-ground', name: 'Ground floor' },
    rooms: [
      { id: 'room-west', name: 'West room', boundsMm: { minX: 0, minY: 0, maxX: 3000, maxY: 4000 } },
      { id: 'room-east', name: 'East room', boundsMm: { minX: 3000, minY: 0, maxX: 6000, maxY: 4000 } },
    ],
    wallThicknessMm: 150, heightMm: 2700,
    openings: [
      { id: 'door-entry', type: 'Door', name: 'Entry door', roomId: 'room-west', side: 'south', offsetMm: 1000, widthMm: 900, heightMm: 2100 },
      { id: 'door-inner', type: 'Door', name: 'Connecting door', roomId: 'room-west', side: 'east', offsetMm: 1500, widthMm: 900, heightMm: 2100 },
    ],
  };
}

async function original(): Promise<ModelSnapshot> {
  const repo = await RoomRepository.create('Before floor reconstruction');
  return repo.view(repo.head('main')).snapshot;
}

function withPlant(base: ModelSnapshot, x = 1): ModelSnapshot {
  return validateSnapshot({ ...base, entities: [...base.entities,
    { id: 'plant-kept', type: 'Furniture', name: 'Existing plant', kind: 'plant', position: [x, 3],
      width: .3, depth: .3, height: 1, rotationDeg: 0, supportId: null },
  ] });
}

const propose = 'return {kind:"propose",review:{summary:"Reconstruct two connected rooms.",'
  + 'rationale:"The sketch defines a rectangular two-room floor.",constraints:"Retain contents and keep the accepted model unchanged.",'
  + 'uncertainty:"Concept dimensions need human review.",intent:{interpretation:"Reconstruct the floor from the sketch.",'
  + 'assumptions:["Use 150 mm walls."],certainty:80,basis:"The fixture has a 6 by 4 metre envelope and one partition."}}};';
function floorScript(layout = twoRooms()): string {
  return 'await model.previewFloor(' + JSON.stringify(layout) + ');';
}

async function run(t: TestContext, base: ModelSnapshot, source: string, scoped = true) {
  const scripts = new ModelScripts();
  t.after(() => scripts.dispose());
  const binding: ModelScriptBinding = {
    baseRevisionId: 'a'.repeat(64), selectedObjectIds: base.entities.filter((item) => item.type === 'Door').map((item) => item.id),
    visualIntent: { kind: 'selection' },
  };
  if (scoped) binding.authoringScope = 'floor-plan-reconstruction';
  return scripts.run({
    base, binding,
    source, language: 'typescript', signal: new AbortController().signal, remainingHostCalls: 64, onActivity: () => {},
  });
}

test('a 6 by 4 metre sketch produces two connected rooms, five walls, two doors and an inspectable delta', async () => {
  const repo = await RoomRepository.create('Two-room sketch');
  const head = repo.head('main'); const before = repo.view(head).snapshot; const saved = repo.serialize();
  const after = previewFloor(before, twoRooms());
  assert.equal(after.entities.length, 10);
  assert.equal(after.entities.filter((item) => item.type === 'Wall').length, 5);
  assert.equal(after.relationships.length, 2);
  assert.equal(spaces(after).length, 2);
  assert.deepEqual(floorBounds(after), { minX: 0, minY: 0, maxX: 6, maxY: 4 });
  assert.deepEqual(doorConnections(after).map((link) => ({ id: link.door.id, rooms: link.roomIds, exterior: link.exterior })), [
    { id: 'door-entry', rooms: ['room-west'], exterior: true },
    { id: 'door-inner', rooms: ['room-east', 'room-west'], exterior: false },
  ]);
  const delta = diffSnapshots(before, after);
  assert.equal(delta.entities.added.length, 9);
  assert.deepEqual(delta.entities.removed.map((item) => item.id), ['wall-east', 'wall-north', 'wall-south', 'wall-west']);
  assert.deepEqual(delta.entities.modified, []);
  assert.equal(delta.relationships.added.length, 2);
  assert.deepEqual(delta.relationships.removed.map((item) => item.id), ['host-entry']);
  assert.equal(repo.head('main'), head);
  assert.equal(repo.serialize(), saved);
});

test('wall and host identities are deterministic across input order, repeated reconstruction and negative coordinates', async () => {
  const base = await original(); const layout = twoRooms();
  const built = previewFloor(base, layout);
  assert.deepEqual(previewFloor(base, { ...layout, rooms: [...layout.rooms].reverse(), openings: [...layout.openings].reverse() }), built);
  assert.deepEqual(previewFloor(built, layout), built);
  for (const wall of built.entities) if (wall.type === 'Wall') {
    assert.ok(wall.start[0] <= wall.end[0] && wall.start[1] <= wall.end[1]);
  }
  const shifted = { ...layout, rooms: layout.rooms.map((room) => ({ ...room, boundsMm: {
    minX: room.boundsMm.minX - 6000, maxX: room.boundsMm.maxX - 6000,
    minY: room.boundsMm.minY - 4000, maxY: room.boundsMm.maxY - 4000,
  } })) };
  const negative = previewFloor(base, shifted);
  assert.deepEqual(floorBounds(negative), { minX: -6, minY: -4, maxX: 0, maxY: 0 });
  assert.deepEqual(previewFloor(base, shifted), negative);
});

test('opening offsets are room-relative on merged horizontal and vertical walls on all four sides', async () => {
  const base = await original(); const layout = twoRooms();
  const result = previewFloor(base, { ...layout, openings: [...layout.openings,
    { id: 'window-south', type: 'Window', name: 'East south window', roomId: 'room-east', side: 'south', offsetMm: 1000, widthMm: 900, heightMm: 1000, sillHeightMm: 900 },
    { id: 'window-north', type: 'Window', name: 'East north window', roomId: 'room-east', side: 'north', offsetMm: 1000, widthMm: 900, heightMm: 1000, sillHeightMm: 900 },
    { id: 'window-east', type: 'Window', name: 'East window', roomId: 'room-east', side: 'east', offsetMm: 1000, widthMm: 900, heightMm: 1000, sillHeightMm: 900 },
    { id: 'window-west', type: 'Window', name: 'West window', roomId: 'room-west', side: 'west', offsetMm: 1000, widthMm: 900, heightMm: 1000, sillHeightMm: 900 },
  ] });
  for (const [id, offset] of [['window-south', 4], ['window-north', 4], ['window-east', 1], ['window-west', 1]]) {
    assert.equal(result.relationships.find((link) => link.source === id)?.offset, offset);
  }
});

test('inserting an earlier opening preserves existing host links and full-length opening IDs do not collide', async () => {
  const base = await original(); const layout = twoRooms(); const before = previewFloor(base, layout);
  const window = {
    id: 'a-window', type: 'Window', name: 'Added window', roomId: 'room-west', side: 'north',
    offsetMm: 200, widthMm: 500, heightMm: 1000, sillHeightMm: 900,
  };
  const inserted = previewFloor(base, { ...layout, openings: [window, ...layout.openings] });
  for (const link of before.relationships) {
    assert.deepEqual(inserted.relationships.find((item) => item.source === link.source), link);
  }
  const firstId = 'a' + 'b'.repeat(63); const secondId = 'a' + 'b'.repeat(62) + 'c';
  const longIds = previewFloor(base, { ...layout, openings: [...layout.openings,
    { ...window, id: firstId }, { ...window, id: secondId, offsetMm: 1000 },
  ] });
  const first = longIds.relationships.find((item) => item.source === firstId);
  const second = longIds.relationships.find((item) => item.source === secondId);
  assert.ok(first && second);
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^[a-z][a-z0-9-]{0,63}$/);
  assert.match(second.id, /^[a-z][a-z0-9-]{0,63}$/);
});

function threeRooms(): FloorLayout {
  const layout = twoRooms();
  return { ...layout, rooms: [
    layout.rooms[0],
    { id: 'room-east-bottom', name: 'East bottom', boundsMm: { minX: 3000, minY: 0, maxX: 6000, maxY: 2000 } },
    { id: 'room-east-top', name: 'East top', boundsMm: { minX: 3000, minY: 2000, maxX: 6000, maxY: 4000 } },
  ], openings: [
    layout.openings[0],
    { ...layout.openings[1], offsetMm: 500 },
    { id: 'door-top', type: 'Door', name: 'Top door', roomId: 'room-east-top', side: 'west', offsetMm: 500, widthMm: 900, heightMm: 2100 },
  ] };
}

test('T junctions share one continuous partition and a door cannot straddle two neighbouring room sides', async () => {
  const base = await original(); const layout = threeRooms();
  const built = previewFloor(base, layout);
  const partitions = built.entities.filter((item) => item.type === 'Wall' && item.start[0] === 3 && item.end[0] === 3);
  assert.equal(partitions.length, 1);
  assert.equal(built.relationships.find((item) => item.source === 'door-top')?.offset, 2.5);
  assert.equal(doorConnections(built).filter((link) => !link.exterior).length, 2);
  assert.throws(() => previewFloor(base, { ...layout, openings: layout.openings.map((item) => item.id === 'door-inner' ? { ...item, offsetMm: 1500 } : item) }), /connect two rooms/);
});

test('gaps, overlaps, invalid bounds, duplicate identities and unreachable rooms fail deterministic validation', async () => {
  const base = await original(); const layout = twoRooms();
  const changedEast = (minX: number) => ({ ...layout, rooms: layout.rooms.map((room) => room.id === 'room-east' ? { ...room, boundsMm: { ...room.boundsMm, minX } } : room) });
  assert.throws(() => previewFloor(base, changedEast(3100)), /gaps/);
  assert.throws(() => previewFloor(base, changedEast(2900)), /overlap/);
  assert.throws(() => previewFloor(base, changedEast(6000)), /positive/);
  assert.throws(() => previewFloor(base, { ...layout, rooms: [layout.rooms[0], layout.rooms[0]] }), /Duplicate room/);
  assert.throws(() => previewFloor(base, { ...layout, level: { ...layout.level, id: 'room-west' } }), /Duplicate entity/);
  assert.throws(() => previewFloor(base, { ...layout, openings: [layout.openings[0]] }), /doorway path/);
});

test('openings must name existing rooms, fit their own side and wall height, and never overlap', async () => {
  const base = await original(); const layout = twoRooms();
  const entry = layout.openings[0];
  const changed = (patch: object) => ({ ...layout, openings: [{ ...entry, ...patch }, layout.openings[1]] });
  assert.throws(() => previewFloor(base, changed({ roomId: 'missing-room' })), /reference a room/);
  assert.throws(() => previewFloor(base, changed({ offsetMm: 2500 })), /named room side/);
  assert.throws(() => previewFloor(base, changed({ heightMm: 2800 })), /fit inside its wall/);
  const window = { id: 'window-one', type: 'Window', name: 'Window', roomId: 'room-west', side: 'north', offsetMm: 500, widthMm: 1000, heightMm: 1200, sillHeightMm: 900 };
  assert.throws(() => previewFloor(base, { ...layout, openings: [...layout.openings, { ...window, sillHeightMm: 2000 }] }), /below the wall top/);
  assert.throws(() => previewFloor(base, { ...layout, openings: [...layout.openings, { ...window, side: 'south', offsetMm: 1000 }] }), /cannot overlap/);
  assert.throws(() => previewFloor(base, { ...layout, openings: [...layout.openings, entry] }), /Duplicate entity/);
});

test('the exact schema rejects unknown fields, unsupported opening variants, fractional and unbounded dimensions', () => {
  const layout = twoRooms();
  for (const invalid of [
    { ...layout, furnishings: [] }, { ...layout, wallThicknessMm: .5 }, { ...layout, heightMm: Infinity },
    { ...layout, level: { ...layout.level, elevation: 1 } }, { ...layout, rooms: [layout.rooms[0]] },
    { ...layout, rooms: Array(13).fill(layout.rooms[0]) },
    { ...layout, rooms: [{ ...layout.rooms[0], boundsMm: { minX: -1000001, minY: 0, maxX: 3000, maxY: 4000 } }, layout.rooms[1]] },
    { ...layout, openings: [{ ...layout.openings[0], side: 'diagonal' }] },
    { ...layout, openings: [{ ...layout.openings[0], sillHeightMm: 0 }] },
    { ...layout, openings: [{ ...layout.openings[0], type: 'Window' }] },
    { ...layout, openings: [{ ...layout.openings[0], offsetMm: -1 }] },
  ]) assert.throws(() => parseFloorLayout(invalid), /Floor layout/);
  const accessor = { ...layout };
  Object.defineProperty(accessor, 'rooms', { get() { assert.fail('An accessor must never run.'); }, enumerable: true });
  assert.throws(() => parseFloorLayout(accessor), /plain data/);
  const sparse = new Array<FloorLayout['rooms'][number]>(2);
  assert.throws(() => parseFloorLayout({ ...layout, rooms: sparse }), /dense/);
  const parsed = parseFloorLayout(layout); layout.rooms[0].boundsMm.minX = 1;
  assert.equal(parsed.rooms[0].boundsMm.minX, 0);
});

test('existing entity limits still apply to the compiled graph', async () => {
  const base = await original(); const layout = twoRooms();
  const windows = Array.from({ length: 94 }, (_, index) => ({
    id: 'window-' + index, type: 'Window', name: 'Window', roomId: 'room-west', side: 'north',
    offsetMm: index * 2, widthMm: 1, heightMm: 1000, sillHeightMm: 900,
  }));
  assert.throws(() => previewFloor(base, { ...layout, openings: [...layout.openings, ...windows] }), /Model arrays must be dense and bounded/);
});

test('furniture and equipment survive exactly and an incompatible floor cannot silently discard either', async () => {
  const shell = await original(); const planted = withPlant(shell);
  const base = validateSnapshot({ ...planted, entities: [...planted.entities,
    { id: 'equipment-kept', type: 'Equipment', name: 'Existing equipment', category: 'electrical',
      position: [5, 3], elevation: 0, width: .3, depth: .3, height: .8 },
  ] });
  const saved = JSON.stringify(base); const after = previewFloor(base, twoRooms());
  const contents = (snapshot: ModelSnapshot) => snapshot.entities.filter((item) => item.type === 'Furniture' || item.type === 'Equipment');
  assert.deepEqual(contents(after), contents(base));
  assert.equal(JSON.stringify(base), saved);
  assert.throws(() => previewFloor(withPlant(shell, 3), twoRooms()), /inside one room/);
  const equipmentOnPartition = validateSnapshot({ ...base, entities: base.entities.map((item) => item.type === 'Equipment' ? { ...item, position: [3, 3] } : item) });
  assert.throws(() => previewFloor(equipmentOnPartition, twoRooms()), /Equipment must fit/);
  const layout = twoRooms();
  assert.throws(() => previewFloor(base, { ...layout, rooms: layout.rooms.map((room) => room.id === 'room-west' ? { ...room, id: 'plant-kept' } : room),
    openings: layout.openings.map((item) => ({ ...item, roomId: 'plant-kept' })) }), /Duplicate entity/);
});

test('only an explicitly scoped script can author a floor, with real execution evidence and unchanged base', async (t) => {
  const base = await original(); const saved = JSON.stringify(base);
  const denied = await run(t, base, floorScript() + propose, false);
  assert.equal(denied.kind, 'failed');
  assert.ok(denied.evidence.calls.some((call) => call.method === 'model.previewFloor' && call.disposition === 'denied'));
  const allowed = await run(t, base, floorScript() + propose);
  assert.equal(allowed.kind, 'proposal', JSON.stringify(allowed));
  if (allowed.kind !== 'proposal') assert.fail('Expected a scoped floor proposal.');
  assert.equal(allowed.snapshot.entities.length, 10);
  assert.equal(allowed.evidence.validation, 'passed');
  assert.ok(allowed.evidence.calls.some((call) => call.method === 'model.previewFloor' && call.disposition === 'completed'));
  assert.equal(JSON.stringify(base), saved);
});

test('a caught invalid floor leaves the draft untouched and can be corrected in the same script', async (t) => {
  const base = await original(); const invalid = twoRooms(); invalid.rooms[1].boundsMm.minX = 3100;
  const result = await run(t, base, [
    'try { ' + floorScript(invalid) + ' }',
    'catch (error) { if (!(error instanceof Error) || error.name !== "ModelValidationError") throw error; }',
    'const untouched = await model.inspect();',
    'if (untouched.placement.rooms.length) throw new Error("Invalid floor leaked into the draft.");',
    floorScript(), propose,
  ].join('\n'));
  assert.equal(result.kind, 'proposal', JSON.stringify(result));
  assert.ok(result.evidence.calls.some((call) => call.method === 'model.previewFloor' && call.disposition === 'app-error'));
});

test('reconstruction retains current draft moves and explicit furnishing removals within one script', async (t) => {
  const base = withPlant(await original(), 3);
  const plant = base.entities.find((item) => item.type === 'Furniture'); assert.ok(plant?.type === 'Furniture');
  for (const furnishings of [[{ ...plant, position: [1, 3] }], []]) {
    const result = await run(t, base, 'await model.previewFurnishings(' + JSON.stringify({ furnishings }) + ');' + floorScript() + propose);
    assert.equal(result.kind, 'proposal', JSON.stringify(result));
    if (result.kind !== 'proposal') assert.fail('Expected a composed floor proposal.');
    assert.deepEqual(result.snapshot.entities.filter((item) => item.type === 'Furniture'), furnishings);
  }
  assert.deepEqual(plant.position, [3, 3]);
});
