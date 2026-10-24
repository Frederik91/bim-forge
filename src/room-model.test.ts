import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RoomRepository, diffSnapshots, rectangleLayout, previewRectangle } from './room-model.ts';
import { MODEL_PROPOSAL_TOOLS, prepareModelProposal } from './model-proposal.ts';
import type { Door, Entity, HostingRelationship, ModelSnapshot, Point, RoomLayout, Wall } from './room-model.ts';
import type { ModelWorker, ModelWorkerSession } from './model-proposal.ts';

interface DoorShape { id: string; type: 'Door'; name: string; width: number; height: number }
interface WallShape { id: string; type: 'Wall'; name: string; start: Point; end: Point; thickness: number; height: number }
type EntityShape = DoorShape | WallShape;
interface RelationshipShape { id: string; type: 'hosted-by'; source: string; target: string; offset: number }
interface SnapshotShape { units: string; entities: EntityShape[]; relationships: RelationshipShape[] }
type ModelItem = Entity | HostingRelationship;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseRecord(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error('Expected a JSON object.');
  return value;
}
function recordArray(record: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = record[key];
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error(`Expected ${key} records.`);
  return value;
}
function first<T>(values: readonly T[], label: string): T {
  const value = values[0];
  if (value === undefined) throw new Error(`Missing ${label}.`);
  return value;
}
function doorEntity(value: ModelItem | EntityShape | undefined | null): Door | DoorShape {
  if (!value || value.type !== 'Door') throw new Error('Expected a door.');
  return value;
}
function wallEntity(value: Entity | EntityShape | undefined): Wall | WallShape {
  if (!value || value.type !== 'Wall') throw new Error('Expected a wall.');
  return value;
}
const door = (repo: RoomRepository, branch = 'main'): Door | DoorShape => doorEntity(repo.view(repo.head(branch)).snapshot.entities.find((item) => item.id === 'door-entry'));
const proposal = (repo: RoomRepository, name = 'wider-entry', doorWidthM: unknown = 1.2, from: unknown = repo.head('main')) => repo.propose({ name, from, doorWidthM });
const snapshot = (repo: RoomRepository): SnapshotShape => {
  const value = structuredClone(repo.view(repo.head('main')).snapshot);
  const entities = value.entities.map((entity): EntityShape => {
    if (entity.type === 'Wall' || entity.type === 'Door') return entity;
    throw new Error('Expected the default room fixture.');
  });
  return { units: value.units, entities, relationships: value.relationships };
};

test('sample project contains four walls, one hosted door and metre units', async () => {
  const repo = await RoomRepository.create('My first room');
  const initial = repo.view(repo.head('main'));
  assert.equal(repo.name, 'My first room');
  assert.equal(initial.parentId, null);
  assert.equal(initial.snapshot.units, 'm');
  assert.equal(initial.snapshot.entities.filter((item) => item.type === 'Wall').length, 4);
  assert.equal(door(repo).width, 0.9);
  assert.deepEqual(initial.snapshot.relationships, [{ id: 'host-entry', type: 'hosted-by', source: 'door-entry', target: 'wall-south', offset: 2.4 }]);
});

test('a separate proposal preserves original bytes, stable ids and parent revision', async () => {
  const original = await RoomRepository.create(); const before = original.serialize();
  const repo = await proposal(original);
  assert.equal(original.serialize(), before);
  assert.equal(repo.head('main'), original.head('main'));
  assert.equal(repo.view(repo.head('wider-entry')).parentId, original.head('main'));
  assert.equal(door(repo).width, 0.9); assert.equal(door(repo, 'wider-entry').width, 1.2);
  const delta = repo.compare(repo.head('main'), repo.head('wider-entry'));
  assert.equal(delta.entities.modified.length, 1);
  const modifiedDoor = first(delta.entities.modified, 'modified door');
  assert.equal(modifiedDoor.id, 'door-entry');
  assert.equal(doorEntity(modifiedDoor.before).width, 0.9);
  assert.equal(doorEntity(modifiedDoor.after).width, 1.2);
  assert.deepEqual(delta.relationships, { added: [], removed: [], modified: [] });
  assert.deepEqual(repo.view(repo.head('main')).snapshot.entities.map((item) => item.id), repo.view(repo.head('wider-entry')).snapshot.entities.map((item) => item.id));
});

test('all returned history and deltas are deeply immutable', async () => {
  const repo = await proposal(await RoomRepository.create());
  assert.throws(() => Object.defineProperty(door(repo), 'width', { value: 3 }), TypeError);
  assert.throws(() => Object.defineProperty(first(repo.branches(), 'branch'), 'revisionId', { value: 'changed' }), TypeError);
  const delta = repo.compare(repo.head('main'), repo.head('wider-entry'));
  assert.throws(() => Object.defineProperty(doorEntity(first(delta.entities.modified, 'modified door').after), 'width', { value: 5 }), TypeError);
  assert.equal(repo.head('main'), first(repo.branches(), 'branch').revisionId);
});

test('same content has deterministic revision hashes across projects and restores', async () => {
  const a = await RoomRepository.create('A'); const b = await RoomRepository.create('B');
  assert.equal(a.head('main'), b.head('main'));
  const next = await proposal(a); const restored = await RoomRepository.restore(next.serialize());
  assert.equal(restored.serialize(), next.serialize());
  assert.equal(restored.head('wider-entry'), (await proposal(b)).head('wider-entry'));
});

test('repeated exact proposals are idempotent and unchanged widths create no history', async () => {
  const original = await RoomRepository.create();
  assert.equal(await proposal(original, 'unchanged', 0.9), original);
  assert.equal(original.branches().length, 1);
  const repo = await proposal(original);
  assert.equal(await proposal(repo), repo);
  await assert.rejects(proposal(repo, 'wider-entry', 1.1), /already uses/);
});

test('conflicting proposals are visible without applying either one', async () => {
  let repo = await RoomRepository.create();
  repo = await proposal(repo, 'accessibility-study', 1.2);
  repo = await proposal(repo, 'alternate-study', 1.0);
  const before = repo.serialize();
  const conflicts = repo.conflicts(repo.head('main'), repo.head('accessibility-study'), repo.head('alternate-study'));
  assert.equal(conflicts.length, 1);
  const conflict = first(conflicts, 'door conflict');
  assert.equal(conflict.id, 'door-entry');
  assert.equal(doorEntity(conflict.base).width, 0.9); assert.equal(doorEntity(conflict.left).width, 1.2); assert.equal(doorEntity(conflict.right).width, 1);
  assert.equal(repo.serialize(), before); assert.equal(door(repo).width, 0.9);
  assert.deepEqual(repo.conflicts(repo.head('main'), repo.head('accessibility-study'), repo.head('accessibility-study')), []);
  assert.deepEqual(repo.conflicts(repo.head('main'), repo.head('main'), repo.head('alternate-study')), []);
  assert.throws(() => repo.conflicts(repo.head('accessibility-study'), repo.head('main'), repo.head('alternate-study')), /ancestor/);
});

test('multiple generations retain all original ancestor snapshots', async () => {
  let repo = await RoomRepository.create(); repo = await proposal(repo);
  repo = await proposal(repo, 'second-proposal', 1.3, repo.head('wider-entry'));
  assert.equal(repo.view(repo.head('second-proposal')).parentId, repo.head('wider-entry'));
  assert.equal(door(repo, 'wider-entry').width, 1.2);
  assert.equal(door(repo, 'second-proposal').width, 1.3);
  assert.equal((await RoomRepository.restore(repo.serialize())).serialize(), repo.serialize());
});

test('proposal validates units, fit, identity and source before changing history', async () => {
  const repo = await RoomRepository.create(); const before = repo.serialize();
  for (const width of [undefined, null, true, '1.2', NaN, Infinity, -1, 0, 0.9001, 4, 101]) {
    await assert.rejects(repo.propose({ name: 'invalid', from: repo.head('main'), doorWidthM: width }));
  }
  for (const name of ['main', '', '../wall', '__proto__', 'Upper Case', 'study2', 'study--wide', 'study-', 'a'.repeat(65)]) await assert.rejects(proposal(repo, name));
  await assert.rejects(proposal(repo, 'valid', 1.2, 'unknown'), /Unknown revision/);
  await assert.rejects(repo.propose({ name: 'extra', from: repo.head('main'), doorWidthM: 1.2, command: 'ignored' }));
  assert.equal(repo.serialize(), before);
});

test('semantic comparison includes added, removed, changed entities and relationships', async () => {
  const repo = await RoomRepository.create(); const before = snapshot(repo); const after = structuredClone(before);
  after.entities.push({ id: 'door-other', type: 'Door', name: 'Another door', width: 0.8, height: 2 });
  after.relationships.push({ id: 'host-other', type: 'hosted-by', source: 'door-other', target: 'wall-east', offset: 1 });
  const added = diffSnapshots(before, after);
  assert.equal(added.entities.added[0].id, 'door-other'); assert.equal(added.relationships.added[0].id, 'host-other');
  const removed = diffSnapshots(after, before);
  assert.equal(removed.entities.removed[0].id, 'door-other'); assert.equal(removed.relationships.removed[0].id, 'host-other');
  const moved = structuredClone(before); moved.relationships[0].target = 'wall-north';
  assert.equal(diffSnapshots(before, moved).relationships.modified[0].id, 'host-entry');
});

test('graph validator refuses duplicates, missing hosts, bad geometry and unknown fields', async () => {
  const repo = await RoomRepository.create(); const original = snapshot(repo);
  const wall = wallEntity(original.entities.find((entity) => entity.type === 'Wall'));
  const relationship = first(original.relationships, 'host relationship');
  const invalid: unknown[] = [
    { ...original, units: 'mm' },
    { ...original, entities: [...original.entities, first(original.entities, 'entity')] },
    { ...original, relationships: original.relationships.map((item) => item.id === relationship.id ? { ...item, target: 'missing' } : item) },
    { ...original, relationships: [] },
    { ...original, entities: original.entities.map((item) => item.id === wall.id ? { ...wall, end: wall.start } : item) },
    { ...original, entities: original.entities.map((item) => item.type === 'Door' ? { ...item, height: 4 } : item) },
    { ...original, relationships: original.relationships.map((item) => ({ ...item, offset: 6 })) },
    { ...original, metadata: 'not permitted' },
  ];
  for (const value of invalid) assert.throws(() => diffSnapshots(original, value));
});

test('corrupt saves cannot replace a valid repository', async () => {
  const repo = await proposal(await RoomRepository.create()); const text = repo.serialize();
  const corrupt: string[] = [];
  const mutate = (fn: (state: Record<string, unknown>) => void): void => {
    const value = parseRecord(text); fn(value); corrupt.push(JSON.stringify(value));
  };
  mutate((s) => { s.version = 3; });
  mutate((s) => {
    const revision = recordArray(s, 'revisions')[1];
    if (!revision || !isRecord(revision.snapshot)) throw new Error('Missing proposal revision.');
    const entity = recordArray(revision.snapshot, 'entities').find((item) => item.type === 'Door');
    if (!entity) throw new Error('Missing proposal door.');
    entity.width = 1.4;
  });
  mutate((s) => { first(recordArray(s, 'branches'), 'branch').name = 'renamed-main'; });
  mutate((s) => { const branches = recordArray(s, 'branches'); branches.push(first(branches, 'branch')); });
  mutate((s) => { const branch = recordArray(s, 'branches')[1]; if (!branch) throw new Error('Missing proposal branch.'); branch.revisionId = '0'.repeat(64); });
  mutate((s) => { const revisions = recordArray(s, 'revisions'); revisions.splice(0, 1); });
  mutate((s) => { s.unknown = true; });
  for (const value of [...corrupt, '', '{', 'null', '[]', ' '.repeat(262145)]) await assert.rejects(RoomRepository.restore(value));
  assert.equal(repo.serialize(), text);
});

test('JSON input limits use encoded bytes and constructor cannot forge valid history', async () => {
  await assert.rejects(RoomRepository.restore('é'.repeat(131073)), /256 KiB/);
  assert.throws(() => Reflect.construct(RoomRepository, [null, {}]), /create or restore/);
  await assert.rejects(RoomRepository.create(''));
  await assert.rejects(RoomRepository.create('x'.repeat(81)));
});

test('restoration normalizes main-first branch order and rejects invalid proposal names', async () => {
  const repo = await proposal(await RoomRepository.create());
  const data = JSON.parse(repo.serialize()); data.branches.reverse();
  const restored = await RoomRepository.restore(JSON.stringify(data));
  assert.equal(restored.branches()[0].name, 'main'); assert.equal(restored.serialize(), repo.serialize());
  for (const name of ['study2', 'study--wide', 'study-']) {
    const invalid = JSON.parse(repo.serialize()); invalid.branches[1].name = name;
    await assert.rejects(RoomRepository.restore(JSON.stringify(invalid)), /lowercase words/);
  }
});

test('a caller-supplied iterator cannot bypass graph validation and accessors never run', async () => {
  const repo = await RoomRepository.create(); const value = { ...snapshot(repo), entities: [null] };
  Object.defineProperty(value.entities, Symbol.iterator, { value: function* () {} });
  assert.throws(() => diffSnapshots(snapshot(repo), value));
  let calls = 0;
  const input = { name: 'proposal', from: repo.head('main') };
  Object.defineProperty(input, 'doorWidthM', { enumerable: true, get() { calls += 1; return 1.2; } });
  await assert.rejects(repo.propose(input)); assert.equal(calls, 0);
});

function assertFrozen(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertFrozen);
}

function assertRectangleJoins(value: SnapshotShape | ModelSnapshot): void {
  const corners = new Map<string, number>();
  for (const wall of value.entities) {
    if (wall.type !== 'Wall') continue;
    assert.notDeepEqual(wall.start, wall.end);
    assert.equal(wall.start[0] === wall.end[0] || wall.start[1] === wall.end[1], true);
    for (const point of [wall.start, wall.end]) {
      const key = JSON.stringify(point);
      corners.set(key, (corners.get(key) ?? 0) + 1);
    }
  }
  assert.equal(corners.size, 4);
  assert.deepEqual([...corners.values()], [2, 2, 2, 2]);
}

const canonicalJSON = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

function legacyRevisionText(repo: RoomRepository, changed: SnapshotShape): string {
  const state = parseRecord(repo.serialize());
  state.version = 1;
  delete state.reviews;
  const parentId = repo.head('main');
  changed.entities.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  changed.relationships.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const id = createHash('sha256').update(canonicalJSON({ version: 1, parentId, snapshot: changed })).digest('hex');
  recordArray(state, 'revisions').push({ id, parentId, snapshot: changed });
  recordArray(state, 'branches').push({ name: 'legacy-shape', revisionId: id });
  return canonicalJSON(state);
}

test('rectangle layout is an exact deeply frozen millimetre projection and preview round-trips', async () => {
  const repo = await RoomRepository.create();
  const base = repo.view(repo.head('main')).snapshot;
  const before = repo.serialize();
  const layout = rectangleLayout(base);
  assert.deepEqual(layout, {
    boundsMm: { minX: 0, minY: 0, maxX: 6000, maxY: 4000 },
    door: { widthMm: 900, offsetMm: 2400 },
  });
  assertFrozen(layout);
  assert.throws(() => { layout.door.widthMm = 1000; }, TypeError);
  const preview = previewRectangle(base, layout);
  assert.deepEqual(preview, base);
  assert.deepEqual(Object.keys(preview).sort(), ['entities', 'relationships', 'units']);
  assertFrozen(preview);
  const previewWall = wallEntity(preview.entities.find((entity) => entity.type === 'Wall'));
  assert.throws(() => Object.defineProperty(previewWall.start, '0', { value: 1 }), TypeError);
  assert.equal(repo.serialize(), before);
});

test('moving each side updates both adjoining corners without moving the opposite wall', async () => {
  const base = snapshot(await RoomRepository.create());
  const cases: Array<[string, keyof RoomLayout['boundsMm'], number, Record<string, [Point, Point]>]> = [
    ['east', 'maxX', 7000, { south: [[0, 0], [7, 0]], east: [[7, 0], [7, 4]], north: [[7, 4], [0, 4]], west: [[0, 4], [0, 0]] }],
    ['west', 'minX', -1000, { south: [[-1, 0], [6, 0]], east: [[6, 0], [6, 4]], north: [[6, 4], [-1, 4]], west: [[-1, 4], [-1, 0]] }],
    ['north', 'maxY', 5000, { south: [[0, 0], [6, 0]], east: [[6, 0], [6, 5]], north: [[6, 5], [0, 5]], west: [[0, 5], [0, 0]] }],
    ['south', 'minY', -1000, { south: [[0, -1], [6, -1]], east: [[6, -1], [6, 4]], north: [[6, 4], [0, 4]], west: [[0, 4], [0, -1]] }],
  ];
  for (const [side, coordinate, position, expected] of cases) {
    const layout = structuredClone(rectangleLayout(base));
    layout.boundsMm[coordinate] = position;
    const preview = previewRectangle(base, layout);
    for (const [name, endpoints] of Object.entries(expected)) {
      const wall = wallEntity(preview.entities.find((entity) => entity.id === `wall-${name}`));
      assert.deepEqual([wall.start, wall.end], endpoints, `${side} move: ${name}`);
    }
    assertRectangleJoins(preview);
    assert.equal(first(preview.relationships, 'host relationship').offset, 2.4);
    assert.equal(doorEntity(preview.entities.find((entity) => entity.id === 'door-entry')).width, 0.9);
  }
  assert.deepEqual(rectangleLayout(base).boundsMm, { minX: 0, minY: 0, maxX: 6000, maxY: 4000 });
});

test('translated rectangles preserve arbitrary wall identities, properties, every direction and every host side', async () => {
  const original = snapshot(await RoomRepository.create());
  const sides = ['south', 'east', 'north', 'west'];
  const expected: Array<[Point, Point]> = [
    [[-2, -3], [6, -3]], [[6, -3], [6, 2]],
    [[6, 2], [-2, 2]], [[-2, 2], [-2, -3]],
  ];
  for (let mask = 0; mask < 16; mask += 1) {
    for (let hostIndex = 0; hostIndex < 4; hostIndex += 1) {
      const base = structuredClone(original);
      for (const [index, side] of sides.entries()) {
        const wall = wallEntity(base.entities.find((entity) => entity.id === `wall-${side}`));
        const segment = first(['a', 'b', 'c', 'd'].slice(index, index + 1), 'segment name');
        wall.id = `segment-${segment}`;
        wall.name = `Custom ${side}`;
        wall.thickness = (150 + index * 10) / 1000;
        wall.height = (3000 + index * 100) / 1000;
        wall.start = [wall.start[0] + 1.125, wall.start[1] - 2.25];
        wall.end = [wall.end[0] + 1.125, wall.end[1] - 2.25];
        if (mask & (1 << index)) [wall.start, wall.end] = [wall.end, wall.start];
      }
      base.entities.reverse();
      const hostSegment = first(['a', 'b', 'c', 'd'].slice(hostIndex, hostIndex + 1), 'host segment');
      base.relationships[0] = { ...first(base.relationships, 'host relationship'), id: 'custom-host', target: `segment-${hostSegment}`, offset: 0.5 };
      const layout = rectangleLayout(base);
      assert.deepEqual(layout.boundsMm, { minX: 1125, minY: -2250, maxX: 7125, maxY: 1750 });
      const normalized = structuredClone(base);
      normalized.entities.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      assert.deepEqual(previewRectangle(base, layout), normalized);
      const preview = previewRectangle(base, {
        boundsMm: { minX: -2000, minY: -3000, maxX: 6000, maxY: 2000 },
        door: { widthMm: 1200, offsetMm: 600 },
      });
      for (const [index, side] of sides.entries()) {
        const before = wallEntity(base.entities.find((entity) => entity.name === `Custom ${side}`));
        const after = wallEntity(preview.entities.find((entity) => entity.id === before.id));
        const expectedEndpoints = first(expected.slice(index, index + 1), 'expected endpoints');
        const endpoints: [Point, Point] = mask & (1 << index) ? [expectedEndpoints[1], expectedEndpoints[0]] : expectedEndpoints;
        assert.deepEqual(after, { ...before, start: endpoints[0], end: endpoints[1] });
      }
      assert.deepEqual(first(preview.relationships, 'preview host'), { ...first(base.relationships, 'base host'), offset: 0.6 });
      assert.deepEqual(preview.entities.find((entity) => entity.id === 'door-entry'), {
        ...base.entities.find((entity) => entity.id === 'door-entry'), width: 1.2,
      });
      assertRectangleJoins(preview);
    }
  }
});

test('door width and offset edits leave walls fixed and enforce exact fit on every host', async () => {
  const original = snapshot(await RoomRepository.create());
  const hostCases: Array<[string, number]> = [['south', 6000], ['north', 6000], ['east', 4000], ['west', 4000]];
  for (const [side, length] of hostCases) {
    const base = structuredClone(original);
    first(base.relationships, 'host relationship').target = `wall-${side}`;
    const layout = structuredClone(rectangleLayout(base));
    layout.door = { widthMm: 1200, offsetMm: length - 1200 };
    const preview = previewRectangle(base, layout);
    assert.deepEqual(preview.entities.filter((entity) => entity.type === 'Wall'),
      base.entities.filter((entity) => entity.type === 'Wall'));
    assert.equal(first(preview.relationships, 'host relationship').offset, (length - 1200) / 1000);
    assert.deepEqual(rectangleLayout(preview), layout);
    assert.throws(() => previewRectangle(base, { ...layout, door: { ...layout.door, offsetMm: length - 1199 } }), /fit/);
    assert.throws(() => previewRectangle(base, { ...layout, door: { ...layout.door, widthMm: 1201 } }), /fit/);
    assert.equal(first(previewRectangle(base, { ...layout, door: { widthMm: length, offsetMm: 0 } }).relationships, 'host relationship').offset, 0);
    const delta = diffSnapshots(base, preview);
    assert.deepEqual(delta.entities.modified.map((item) => item.id), ['door-entry']);
    assert.deepEqual(delta.relationships.modified.map((item) => item.id), ['host-entry']);
  }
});

test('shrinking any host rejects a displaced opening without repairing it', async () => {
  const original = snapshot(await RoomRepository.create());
  const shrinkCases: Array<[string, keyof RoomLayout['boundsMm']]> = [['south', 'maxX'], ['north', 'maxX'], ['east', 'maxY'], ['west', 'maxY']];
  for (const [side, coordinate] of shrinkCases) {
    const base = structuredClone(original);
    first(base.relationships, 'host relationship').target = `wall-${side}`;
    const layout = structuredClone(rectangleLayout(base));
    const before = JSON.stringify(base);
    layout.boundsMm[coordinate] = 3300;
    assert.equal(first(previewRectangle(base, layout).relationships, 'host relationship').offset, 2.4);
    layout.boundsMm[coordinate] = 3299;
    assert.throws(() => previewRectangle(base, layout), /fit/);
    assert.equal(JSON.stringify(base), before);
    layout.door.offsetMm = 0;
    assert.equal(first(previewRectangle(base, layout).relationships, 'host relationship').offset, 0);
  }
});

test('preview accepts inclusive coordinate, span, width and one millimetre boundaries', async () => {
  const base = snapshot(await RoomRepository.create());
  const large = {
    boundsMm: { minX: -1000000, minY: 0, maxX: 0, maxY: 1000000 },
    door: { widthMm: 100000, offsetMm: 900000 },
  };
  assert.deepEqual(rectangleLayout(previewRectangle(base, large)), large);
  const positive = { ...large, boundsMm: { minX: 0, minY: -1000000, maxX: 1000000, maxY: 0 } };
  assert.deepEqual(rectangleLayout(previewRectangle(base, positive)), positive);
  const small = { boundsMm: { minX: -1, minY: -1, maxX: 0, maxY: 0 }, door: { widthMm: 1, offsetMm: 0 } };
  assert.deepEqual(rectangleLayout(previewRectangle(base, small)), small);
  for (const boundsMm of [
    { minX: 999999, minY: 999999, maxX: 1000000, maxY: 1000000 },
    { minX: -1000000, minY: -1000000, maxX: -999999, maxY: -999999 },
  ]) {
    const atLimit = { ...small, boundsMm };
    assert.deepEqual(rectangleLayout(previewRectangle(base, atLimit)), atLimit);
  }
  const negativeZero = { boundsMm: { minX: -0, minY: -0, maxX: 6000, maxY: 4000 }, door: { widthMm: 900, offsetMm: -0 } };
  const normalized = rectangleLayout(previewRectangle(base, negativeZero));
  assert.equal(Object.is(normalized.boundsMm.minX, -0), false);
  assert.equal(Object.is(normalized.door.offsetMm, -0), false);
});

test('layout validation rejects every invalid numeric boundary atomically', async () => {
  const repo = await RoomRepository.create();
  const base = snapshot(repo); const before = JSON.stringify(base); const saved = repo.serialize();
  const layout = rectangleLayout(base);
  const cases: unknown[] = [];
  const change = (section: 'boundsMm' | 'door', key: string, value: unknown): void => {
    if (section === 'boundsMm') cases.push({ ...layout, boundsMm: { ...layout.boundsMm, [key]: value } });
    else cases.push({ ...layout, door: { ...layout.door, [key]: value } });
  };
  for (const key of ['minX', 'minY', 'maxX', 'maxY']) {
    for (const value of [-1000001, 1000001, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity, '1000', true, null, undefined, 1n]) change('boundsMm', key, value);
  }
  for (const value of [0, -1, 100001, 0.5, NaN, Infinity, '900', null, false, undefined]) change('door', 'widthMm', value);
  for (const value of [-1, 1000001, 0.5, NaN, Infinity, '0', null, false, undefined]) change('door', 'offsetMm', value);
  for (const boundsMm of [
    { minX: 6000, minY: 0, maxX: 6000, maxY: 4000 },
    { minX: 6001, minY: 0, maxX: 6000, maxY: 4000 },
    { minX: 0, minY: 4000, maxX: 6000, maxY: 4000 },
    { minX: 0, minY: 4001, maxX: 6000, maxY: 4000 },
    { minX: -1000000, minY: 0, maxX: 1, maxY: 4000 },
    { minX: 0, minY: -1000000, maxX: 6000, maxY: 1 },
  ]) cases.push({ ...layout, boundsMm });
  for (const invalid of cases) {
    assert.throws(() => previewRectangle(base, invalid));
    await assert.rejects(repo.proposeLayout({ name: 'invalid-layout', from: repo.head('main'), layout: invalid }));
  }
  assert.equal(JSON.stringify(base), before);
  assert.equal(repo.serialize(), saved);
});

test('unsupported topology is rejected geometrically without tightening the graph validator', async () => {
  const original = snapshot(await RoomRepository.create());
  const invalid: SnapshotShape[] = [];
  const mutate = (fn: (value: SnapshotShape) => void): void => { const value = structuredClone(original); fn(value); invalid.push(value); };
  mutate((s) => { s.entities = s.entities.filter((entity) => entity.id !== 'wall-north'); });
  mutate((s) => { s.entities.push({ ...wallEntity(s.entities.find((entity) => entity.id === 'wall-north')), id: 'extra-wall' }); });
  mutate((s) => { const wall = wallEntity(s.entities.find((entity) => entity.id === 'wall-north')); wall.start = [6, 0]; wall.end = [0, 0]; });
  mutate((s) => { wallEntity(s.entities.find((entity) => entity.id === 'wall-north')).start = [5.9, 4]; });
  mutate((s) => { wallEntity(s.entities.find((entity) => entity.id === 'wall-north')).start = [6, 3]; });
  mutate((s) => {
    for (const wall of s.entities.filter((entity): entity is Wall => entity.type === 'Wall')) {
      wall.start = [wall.start[0] - wall.start[1], wall.start[0] + wall.start[1]];
      wall.end = [wall.end[0] - wall.end[1], wall.end[0] + wall.end[1]];
    }
  });
  mutate((s) => { doorEntity(s.entities.find((entity) => entity.type === 'Door')).id = 'other-door'; first(s.relationships, 'host relationship').source = 'other-door'; });
  mutate((s) => {
    s.entities.push({ id: 'other-door', type: 'Door', name: 'Other door', width: 0.8, height: 2 });
    s.relationships.push({ id: 'other-host', type: 'hosted-by', source: 'other-door', target: 'wall-east', offset: 0 });
  });
  for (const value of invalid) {
    assert.doesNotThrow(() => diffSnapshots(value, value));
    assert.throws(() => rectangleLayout(value), /Interactive editing/);
    assert.throws(() => previewRectangle(value, rectangleLayout(original)), /Interactive editing/);
  }
  const missingHost = structuredClone(original); missingHost.relationships = [];
  assert.throws(() => rectangleLayout(missingHost), /host/);
});

test('preview copies caller data and never shares mutable layout or snapshot objects', async () => {
  const base = snapshot(await RoomRepository.create());
  const layout = structuredClone(rectangleLayout(base));
  layout.boundsMm.maxX = 7000;
  const preview = previewRectangle(base, layout);
  const projection = rectangleLayout(base);
  assertFrozen(preview); assertFrozen(projection);
  layout.boundsMm.maxX = 8000;
  layout.door.widthMm = 1500;
  wallEntity(base.entities.find((entity) => entity.id === 'wall-east')).start[0] = 9;
  first(base.relationships, 'host relationship').offset = 0;
  assert.equal(rectangleLayout(preview).boundsMm.maxX, 7000);
  assert.equal(rectangleLayout(preview).door.widthMm, 900);
  assert.equal(projection.boundsMm.maxX, 6000);
  assert.equal(projection.door.offsetMm, 2400);
  assert.throws(() => Object.defineProperty(first(preview.relationships, 'host relationship'), 'offset', { value: 0 }), TypeError);
});

test('layout proposals commit one revision, retain ancestor bases and preserve all earlier bytes', async () => {
  const original = await RoomRepository.create(); const originalText = original.serialize();
  const main = original.head('main'); const layout = structuredClone(rectangleLayout(original.view(main).snapshot));
  layout.boundsMm.maxX = 7000; layout.door.widthMm = 1200; layout.door.offsetMm = 3000;
  const first = await original.proposeLayout({ name: 'larger-room', from: main, layout });
  assert.equal(JSON.parse(first.serialize()).revisions.length, 2);
  assert.equal(first.view(first.head('larger-room')).parentId, main);
  assert.deepEqual(rectangleLayout(first.view(first.head('larger-room')).snapshot), layout);
  const firstText = first.serialize();
  const childLayout = structuredClone(layout); childLayout.boundsMm.maxY = 5000;
  const child = await first.proposeLayout({ name: 'taller-room', from: first.head('larger-room'), layout: childLayout });
  const fromAncestor = await child.proposeLayout({ name: 'another-room', from: first.head('larger-room'), layout: {
    ...layout, door: { ...layout.door, offsetMm: 3500 },
  } });
  assert.equal(fromAncestor.view(fromAncestor.head('another-room')).parentId, first.head('larger-room'));
  assert.equal(fromAncestor.head('main'), main);
  assert.equal(original.serialize(), originalText);
  assert.equal(first.serialize(), firstText);
  for (const revision of recordArray(parseRecord(firstText), 'revisions')) {
    if (typeof revision.id !== 'string') throw new Error('Missing revision id.');
    assert.deepEqual(fromAncestor.view(revision.id), revision);
  }
  assertFrozen(fromAncestor.view(fromAncestor.head('another-room')));
  const restored = await RoomRepository.restore(fromAncestor.serialize());
  assert.equal(restored.serialize(), fromAncestor.serialize());
  assert.deepEqual(rectangleLayout(restored.view(restored.head('taller-room')).snapshot), childLayout);
});

test('both proposal APIs share no-op, deterministic identity, idempotence and name collision behavior', async () => {
  const original = await RoomRepository.create(); const from = original.head('main');
  const unchanged = rectangleLayout(original.view(from).snapshot);
  assert.equal(await original.proposeLayout({ name: 'unchanged', from, layout: unchanged }), original);
  const layout = { ...unchanged, door: { ...unchanged.door, widthMm: 1200 } };
  const input = { name: 'wider-entry', from, layout };
  const first = await original.proposeLayout(input);
  assert.equal(await first.proposeLayout(input), first);
  assert.equal(await proposal(first), first);
  const legacy = await proposal(original);
  assert.equal(first.serialize(), legacy.serialize());
  assert.equal(await legacy.proposeLayout(input), legacy);
  const alias = await first.proposeLayout({ ...input, name: 'same-shape' });
  assert.equal(alias.head('same-shape'), first.head('wider-entry'));
  assert.equal(JSON.parse(alias.serialize()).revisions.length, 2);
  assert.equal(await first.proposeLayout({ name: 'no-change', from: first.head('wider-entry'), layout }), first);
  await assert.rejects(first.proposeLayout({ ...input, layout: { ...layout, door: { ...layout.door, widthMm: 1300 } } }), /already uses/);
  await assert.rejects(first.proposeLayout({ ...input, layout: unchanged }), /already uses/);
  for (const name of ['main', '', '../wall', '__proto__', 'Upper Case', 'study2', 'study--wide', 'study-', 'a'.repeat(65)]) {
    await assert.rejects(first.proposeLayout({ ...input, name }));
  }
  await assert.rejects(first.proposeLayout({ ...input, from: 'unknown' }), /Unknown revision/);
  const otherProject = await RoomRepository.create('Other project');
  const other = await otherProject.proposeLayout({ ...input, from: otherProject.head('main') });
  assert.equal(other.head('wider-entry'), first.head('wider-entry'));
});

test('version one legacy files restore with identical hashes and non-rectangles stay read-only for the new API', async () => {
  const original = await RoomRepository.create();
  const legacy = await proposal(await proposal(original), 'second-study', 1300 / 1000);
  const legacyState = parseRecord(legacy.serialize());
  legacyState.version = 1;
  delete legacyState.reviews;
  const text = canonicalJSON(legacyState);
  assert.equal(JSON.parse(text).version, 1);
  const restored = await RoomRepository.restore(text);
  assert.equal(restored.serialize(), text);
  const layout = rectangleLayout(restored.view(restored.head('wider-entry')).snapshot);
  assert.equal(layout.door.widthMm, 1200);
  const modified = snapshot(original);
  wallEntity(modified.entities.find((entity) => entity.id === 'wall-north')).start[0] = 5;
  const nonRectangleText = legacyRevisionText(original, modified);
  const nonRectangle = await RoomRepository.restore(nonRectangleText);
  assert.equal(nonRectangle.serialize(), nonRectangleText);
  const from = nonRectangle.head('legacy-shape');
  assert.throws(() => rectangleLayout(nonRectangle.view(from).snapshot), /Interactive editing/);
  await assert.rejects(nonRectangle.proposeLayout({ name: 'cannot-edit', from, layout }), /Interactive editing/);
  assert.equal(nonRectangle.serialize(), nonRectangleText);
  const oldCaller = await nonRectangle.propose({ name: 'legacy-width', from, doorWidthM: 1.1 });
  assert.equal(door(oldCaller, 'legacy-width').width, 1.1);
  assert.equal((await RoomRepository.restore(oldCaller.serialize())).serialize(), oldCaller.serialize());
});

test('exact field sets and finite plain JSON are enforced at every new API boundary', async () => {
  const repo = await RoomRepository.create(); const base = snapshot(repo);
  const saved = repo.serialize(); const layout = rectangleLayout(base);
  const invalidLayouts: unknown[] = [
    null, undefined, [], 1, 'layout',
    { ...layout, unknown: true }, { boundsMm: layout.boundsMm },
    { ...layout, boundsMm: { ...layout.boundsMm, extra: 0 } },
    { ...layout, boundsMm: { minX: 0, maxX: 6000, maxY: 4000 } },
    { ...layout, boundsMm: { 'minX,minY': 0, maxX: 6000, maxY: 4000 } },
    { ...layout, door: { ...layout.door, id: 'other-door' } },
    { ...layout, door: { widthMm: 900 } },
    { ...layout, boundsMm: [] }, { ...layout, door: [] },
    { ...layout, door: new Date(0) }, { ...layout, door: Object.create({ widthMm: 900, offsetMm: 2400 }) },
    JSON.parse('{"boundsMm":{"minX":0,"minY":0,"maxX":6000,"maxY":4000},"door":{"widthMm":900,"offsetMm":2400,"__proto__":{}}}'),
  ];
  const cycleDoor: Record<string, unknown> = { ...layout.door };
  const cycle = { ...layout, door: cycleDoor }; cycleDoor.loop = cycle;
  invalidLayouts.push(cycle);
  const symbolDoor: Record<PropertyKey, unknown> = { ...layout.door };
  const symbol = { ...layout, door: symbolDoor }; symbolDoor[Symbol('extra')] = 1;
  invalidLayouts.push(symbol);
  const hidden = structuredClone(layout); Object.defineProperty(hidden.boundsMm, 'hidden', { value: 0 });
  invalidLayouts.push(hidden);
  for (const key of ['constructor', 'prototype', 'toJSON']) {
    const valueDoor: Record<string, unknown> = { ...layout.door };
    const value = { ...layout, door: valueDoor }; valueDoor[key] = key === 'toJSON' ? () => ({}) : {};
    invalidLayouts.push(value);
  }
  for (const invalid of invalidLayouts) {
    assert.throws(() => previewRectangle(base, invalid));
    await assert.rejects(repo.proposeLayout({ name: 'invalid-input', from: repo.head('main'), layout: invalid }));
  }
  const input = { name: 'invalid-input', from: repo.head('main'), layout };
  for (const invalid of [null, [], { ...input, extra: true }, { name: input.name, from: input.from }, Object.create(input)]) {
    await assert.rejects(repo.proposeLayout(invalid));
  }
  let calls = 0;
  const accessor = structuredClone(layout);
  Object.defineProperty(accessor.door, 'widthMm', { enumerable: true, get() { calls += 1; return 900; } });
  assert.throws(() => previewRectangle(base, accessor), /accessors/);
  await assert.rejects(repo.proposeLayout({ ...input, layout: accessor }), /accessors/);
  const snapshotAccessor = structuredClone(base);
  Object.defineProperty(snapshotAccessor, 'entities', { enumerable: true, get() { calls += 1; return base.entities; } });
  assert.throws(() => rectangleLayout(snapshotAccessor), /accessors/);
  assert.throws(() => previewRectangle(snapshotAccessor, layout), /accessors/);
  const inputAccessor = { ...input };
  Object.defineProperty(inputAccessor, 'layout', { enumerable: true, get() { calls += 1; return layout; } });
  await assert.rejects(repo.proposeLayout(inputAccessor), /accessors/);
  const iterator = { ...structuredClone(base), entities: [...base.entities] };
  Object.defineProperty(iterator.entities, Symbol.iterator, { value: function* () { calls += 1; } });
  assert.throws(() => rectangleLayout(iterator));
  assert.throws(() => previewRectangle(iterator, layout));
  assert.equal(calls, 0);
  assert.equal(repo.serialize(), saved);
  const nullPrototype = Object.assign(Object.create(null), layout);
  assert.deepEqual(previewRectangle(base, nullPrototype), previewRectangle(base, layout));
});

test('both proposal APIs retain history limits without changing the full repository', async () => {
  let repo = await RoomRepository.create(); const from = repo.head('main');
  const layout = rectangleLayout(repo.view(from).snapshot);
  const suffixes = [...'abcdefghijklmnopqrstuvwxyz', 'aa', 'ab', 'ac', 'ad', 'ae'];
  for (const [index, suffix] of suffixes.entries()) {
    repo = await repo.proposeLayout({ name: `study-${suffix}`, from, layout: {
      ...layout, door: { ...layout.door, widthMm: 1000 + index },
    } });
  }
  const saved = repo.serialize();
  assert.equal(JSON.parse(saved).revisions.length, 32);
  assert.equal(repo.branches().length, 32);
  await assert.rejects(repo.proposeLayout({ name: 'overflow', from, layout: { ...layout, door: { ...layout.door, widthMm: 2000 } } }), /history is full/);
  await assert.rejects(repo.propose({ name: 'legacy-overflow', from, doorWidthM: 2 }), /history is full/);
  assert.equal(await repo.proposeLayout({ name: 'unchanged', from, layout }), repo);
  assert.equal(repo.serialize(), saved);
});

test('accepting an AI proposal advances main while preserving the original and proposal branch', async () => {
  const original = await RoomRepository.create();
  const root = original.root();
  const layout = structuredClone(rectangleLayout(original.view(root).snapshot));
  layout.door.widthMm = 1200;
  const result = await prepareModelProposal(original, visualRequest(original, layout, { proposalName: 'wider-entry' }), {
    identity: { provider: 'test', model: 'scripted-room-worker' },
    async run(session: ModelWorkerSession) {
      await session.executeTool('preview_rectangle', layout);
      await session.executeTool('submit_proposal', {
        summary: 'The entry is widened to 1200 mm.',
        rationale: 'The requested width fits the preserved host wall.',
        constraints: 'Door height, host relationship and all wall geometry remain unchanged.',
        uncertainty: 'Concept-only geometry; no code or coordination checks were run.',
      });
    },
  });
  const proposed = result.repository;
  const decision = { decisionId: 'decision-accept-1', actor: 'local-human' };
  const accepted = proposed.accept('wider-entry', decision);
  assert.equal(accepted.root(), root);
  assert.equal(accepted.head('main'), proposed.head('wider-entry'));
  assert.equal(accepted.head('wider-entry'), proposed.head('wider-entry'));
  assert.equal(accepted.view(root).parentId, null);
  assert.equal(door(accepted).width, 1.2);
  assert.equal(accepted.review('wider-entry').decision.status, 'accepted');
  assert.equal(accepted.review('wider-entry').decision.actor, 'local-human');
  assertFrozen(accepted.review('wider-entry'));
  assert.equal((await RoomRepository.restore(accepted.serialize())).serialize(), accepted.serialize());
  assert.equal(accepted.accept('wider-entry', decision), accepted);
  assert.throws(() => accepted.accept('main', decision), /proposal to accept/);
  assert.throws(() => accepted.accept('missing-proposal', decision), /Unknown proposal/);
  assert.equal(proposed.head('main'), root);
});

function visualRequest(repo: RoomRepository, layout: RoomLayout, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'request-40',
    proposalName: 'ai-room-study',
    baseRevisionId: repo.head('main'),
    selectedObjectIds: ['door-entry'],
    instruction: 'Widen the entrance and extend the east wall to match the visual sketch.',
    visualIntent: { kind: 'rectangle-layout-sketch', layout },
    ...overrides,
  };
}

test('model-working AI receives bounded tools and saves only its validated proposal', async () => {
  const original = await RoomRepository.create(); const before = original.serialize();
  const layout = structuredClone(rectangleLayout(original.view(original.head('main')).snapshot));
  layout.boundsMm.maxX = 7000; layout.door.widthMm = 1200;
  const worker: ModelWorker = {
    identity: { provider: 'test', model: 'scripted-room-worker' },
    async run(session: ModelWorkerSession) {
      const input = isRecord(session.input) ? session.input : {};
      const request = isRecord(input.request) ? input.request : {};
      assert.deepEqual(session.tools.map((tool) => tool.name), ['inspect_model', 'preview_rectangle', 'submit_proposal', 'decline_request']);
      assert.equal(request.baseRevisionId, original.head('main'));
      assert.deepEqual(request.selectedObjectIds, ['door-entry']);
      const inspected = await session.executeTool('inspect_model', {});
      const model = isRecord(inspected.model) ? inspected.model : {};
      assert.equal(inspected.ok, true); assert.equal(Array.isArray(model.entities) ? model.entities.length : -1, 5);
      const visualIntent = isRecord(request.visualIntent) ? request.visualIntent : {};
      const previewed = await session.executeTool('preview_rectangle', visualIntent.layout);
      assert.equal(previewed.ok, true);
      const changes = isRecord(previewed.changes) ? previewed.changes : {};
      const entities = isRecord(changes.entities) ? changes.entities : {};
      assert.deepEqual(Array.isArray(entities.modified) ? [...entities.modified].sort() : [], ['door-entry', 'wall-east', 'wall-north', 'wall-south'].sort());
      const submitted = await session.executeTool('submit_proposal', {
        summary: 'The entrance is 1200 mm wide and the room extends one metre east.',
        rationale: 'This follows the selected door and the visual request while preserving connected walls and hosting.',
        constraints: 'The rectangular-room tool preserves identifiers, wall properties and the hosted-by relationship.',
        uncertainty: 'Concept geometry only; no accessibility, structural, code or coordination approval was performed.',
      });
      assert.deepEqual(submitted, { ok: true, done: true, proposalRevisionId: submitted.proposalRevisionId });
    },
  };
  const result = await prepareModelProposal(original, visualRequest(original, layout), worker);
  assert.equal(result.status, 'ready');
  assert.equal(original.serialize(), before);
  assert.equal(result.repository.view(result.repository.head('ai-room-study')).parentId, original.head('main'));
  assert.equal(result.review.baseRevisionId, original.head('main'));
  assert.equal(result.review.proposalRevisionId, result.repository.head('ai-room-study'));
  assert.deepEqual(result.review.selectedObjectIds, ['door-entry']);
  assert.equal(result.review.constraints.includes('preserves identifiers'), true);
  assert.equal(result.review.decision.status, 'pending');
  assert.deepEqual(result.review.worker, {
    provider: 'test', model: 'scripted-room-worker', responseIds: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  });
  assert.equal(result.repository.review('ai-room-study').requestId, result.review.requestId);
  assert.equal(result.repository.review('ai-room-study').constraints, result.review.constraints);
  assert.equal((await RoomRepository.restore(result.repository.serialize())).review('ai-room-study').rationale, result.review.rationale);
  const reviewMutations: Array<(review: Record<string, unknown>) => void> = [
    (review) => { review.baseRevisionId = '0'.repeat(64); },
    (review) => { review.constraints = ''; },
    (review) => { const workerValue = review.worker; if (!isRecord(workerValue) || !isRecord(workerValue.usage)) throw new Error('Missing worker usage.'); workerValue.usage.totalTokens = -1; },
    (review) => { first(recordArray(review, 'toolCalls'), 'tool call').name = 'write_arbitrary_model'; },
    (review) => { review.decision = { status: 'accepted', decisionId: null, actor: null }; },
  ];
  for (const mutateReview of reviewMutations) {
    const damaged = parseRecord(result.repository.serialize());
    mutateReview(first(recordArray(damaged, 'reviews'), 'review'));
    await assert.rejects(RoomRepository.restore(JSON.stringify(damaged)));
  }
  assert.equal(door(result.repository, 'ai-room-study').width, 1.2);
  assert.equal(result.repository.root(), original.root());
});

test('proposal requests reject stale identities before calling AI and let AI recover from invalid geometry', async () => {
  const repo = await RoomRepository.create();
  const layout = structuredClone(rectangleLayout(repo.view(repo.head('main')).snapshot));
  let runs = 0;
  const unused = { identity: { provider: 'test', model: 'unused-worker' }, async run() { runs += 1; } };
  await assert.rejects(prepareModelProposal(repo, visualRequest(repo, layout, { baseRevisionId: '0'.repeat(64) }), unused), /Unknown revision/);
  await assert.rejects(prepareModelProposal(repo, visualRequest(repo, layout, { selectedObjectIds: ['missing-object'] }), unused), /does not exist/);
  await assert.rejects(prepareModelProposal(repo, { ...visualRequest(repo, layout), extra: true }, unused), /Unexpected proposal request fields/);
  assert.equal(runs, 0);

  const worker: ModelWorker = {
    identity: { provider: 'test', model: 'retry-worker' },
    async run(session: ModelWorkerSession) {
      const invalid = structuredClone(layout); invalid.door.offsetMm = 5900; invalid.door.widthMm = 1200;
      const rejected = await session.executeTool('preview_rectangle', invalid);
      assert.equal(rejected.ok, false); assert.match(String(rejected.error), /fit inside/);
      const valid = structuredClone(layout); valid.door.widthMm = 1200;
      assert.equal((await session.executeTool('preview_rectangle', valid)).ok, true);
      assert.equal((await session.executeTool('submit_proposal', {
        summary: 'The entrance is widened to 1200 mm.', rationale: 'The valid retry fits its host wall.',
        constraints: 'The hosted door and rectangular wall topology are preserved.',
        uncertainty: 'Concept-only validation.',
      })).done, true);
    },
  };
  const result = await prepareModelProposal(repo, visualRequest(repo, layout), worker);
  assert.equal(door(result.repository, 'ai-room-study').width, 1.2);
});

test('model worker can decline without changing repository history', async () => {
  const repo = await RoomRepository.create(); const saved = repo.serialize();
  const layout = rectangleLayout(repo.view(repo.head('main')).snapshot);
  const result = await prepareModelProposal(repo, visualRequest(repo, layout), {
    identity: { provider: 'test', model: 'declining-worker' },
    async run(session: ModelWorkerSession) {
      const output = await session.executeTool('decline_request', {
        reason: 'The requested operation is outside the rectangular room tool.',
        uncertainty: 'No geometry was prepared.',
      });
      assert.equal(output.done, true);
    },
  });
  assert.equal(result.status, 'declined'); assert.equal(result.repository, repo);
  assert.equal(result.repository.serialize(), saved); assert.equal(result.review.proposalRevisionId, null);
});
