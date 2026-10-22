import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRepository, diffSnapshots } from './room-model.mjs';

const door = (repo, branch = 'main') => repo.view(repo.head(branch)).snapshot.entities.find((item) => item.id === 'door-entry');
const proposal = (repo, name = 'wider-entry', doorWidthM = 1.2, from = repo.head('main')) => repo.propose({ name, from, doorWidthM });
const snapshot = (repo) => structuredClone(repo.view(repo.head('main')).snapshot);

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
  assert.equal(delta.entities.modified[0].id, 'door-entry');
  assert.equal(delta.entities.modified[0].before.width, 0.9);
  assert.equal(delta.entities.modified[0].after.width, 1.2);
  assert.deepEqual(delta.relationships, { added: [], removed: [], modified: [] });
  assert.deepEqual(repo.view(repo.head('main')).snapshot.entities.map((item) => item.id), repo.view(repo.head('wider-entry')).snapshot.entities.map((item) => item.id));
});

test('all returned history and deltas are deeply immutable', async () => {
  const repo = await proposal(await RoomRepository.create());
  assert.throws(() => { door(repo).width = 3; }, TypeError);
  assert.throws(() => { repo.branches()[0].revisionId = 'changed'; }, TypeError);
  const delta = repo.compare(repo.head('main'), repo.head('wider-entry'));
  assert.throws(() => { delta.entities.modified[0].after.width = 5; }, TypeError);
  assert.equal(repo.head('main'), repo.branches()[0].revisionId);
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
  assert.equal(conflicts.length, 1); assert.equal(conflicts[0].id, 'door-entry');
  assert.equal(conflicts[0].base.width, 0.9); assert.equal(conflicts[0].left.width, 1.2); assert.equal(conflicts[0].right.width, 1);
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
  const invalid = [];
  const mutate = (fn) => { const value = structuredClone(original); fn(value); invalid.push(value); };
  mutate((s) => { s.units = 'mm'; });
  mutate((s) => s.entities.push(s.entities[0]));
  mutate((s) => { s.relationships[0].target = 'missing'; });
  mutate((s) => { s.relationships = []; });
  mutate((s) => { s.entities.find((e) => e.type === 'Wall').end = s.entities.find((e) => e.type === 'Wall').start; });
  mutate((s) => { s.entities.find((e) => e.type === 'Door').height = 4; });
  mutate((s) => { s.relationships[0].offset = 6; });
  mutate((s) => { s.metadata = 'not permitted'; });
  for (const value of invalid) assert.throws(() => diffSnapshots(original, value));
});

test('corrupt saves cannot replace a valid repository', async () => {
  const repo = await proposal(await RoomRepository.create()); const text = repo.serialize();
  const corrupt = [];
  const mutate = (fn) => { const value = JSON.parse(text); fn(value); corrupt.push(JSON.stringify(value)); };
  mutate((s) => { s.version = 2; });
  mutate((s) => { s.revisions[1].snapshot.entities.find((e) => e.type === 'Door').width = 1.4; });
  mutate((s) => { s.branches[0].revisionId = s.branches[1].revisionId; });
  mutate((s) => s.branches.push(s.branches[0]));
  mutate((s) => { s.branches[1].revisionId = '0'.repeat(64); });
  mutate((s) => { s.revisions.splice(0, 1); });
  mutate((s) => { s.unknown = true; });
  for (const value of [...corrupt, '', '{', 'null', '[]', ' '.repeat(262145)]) await assert.rejects(RoomRepository.restore(value));
  assert.equal(repo.serialize(), text);
});

test('JSON input limits use encoded bytes and constructor cannot forge valid history', async () => {
  await assert.rejects(RoomRepository.restore('é'.repeat(131073)), /256 KiB/);
  assert.throws(() => new RoomRepository(null, {}), /create or restore/);
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
  const repo = await RoomRepository.create(); const value = snapshot(repo);
  value.entities = [null]; value.entities[Symbol.iterator] = function* () {};
  assert.throws(() => diffSnapshots(snapshot(repo), value));
  let calls = 0;
  const input = { name: 'proposal', from: repo.head('main') };
  Object.defineProperty(input, 'doorWidthM', { enumerable: true, get() { calls += 1; return 1.2; } });
  await assert.rejects(repo.propose(input)); assert.equal(calls, 0);
});
