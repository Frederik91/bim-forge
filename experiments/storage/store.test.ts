import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { RoomRepository, previewRectangle } from '../../src/room-model.ts';
import { Storage } from './store.ts';
import { command, entity, hash } from './contract.ts';
import type { StoredEntity } from './contract.ts';
import { fromArray, fixtureEnvelopes } from './fixture.ts';
import { Fingerprint, inspectBranch, load } from './load.ts';
import { nativeDeltaIds, nativeEnvelopes, saveSnapshot, snapshotAt } from './baseline.ts';
import { decodeCopyCell, w4Record } from './w4.ts';
import { PreparedEntity } from './prepared.ts';

function connection(): Client {
  if (!process.env.DATABASE_URL || !process.env.QVM_EXECUTION_LEASE) throw new Error('Integration tests require coordinator DATABASE_URL and execution lease');
  return new Client({ connectionString: process.env.DATABASE_URL });
}
function object(id: string, value = 1): StoredEntity {
  return entity({ entityId: id, kind: 'wall', typeId: null, containerId: null, systemId: null, fromId: null, toId: null,
    document: { properties: [{ definition: 'length', state: 'known', value, unit: 'm', dictionaryVersion: 'fixture-v1' },
      { definition: 'rating', state: 'unknown' }, { definition: 'clearance', state: 'not-applicable' }] } });
}
async function withStore(work: (store: Storage, branch: string) => Promise<void>): Promise<void> {
  const client = connection(); await client.connect();
  try {
    const store = new Storage(client); await store.initialize();
    const branch = `test-${randomUUID()}`;
    await store.createBranch({ branch, revisionId: null });
    await work(store, branch);
  } finally { await client.end(); }
}

test('full typed documents survive immutable versions, CAS, retry and branch divergence', async () => {
  await withStore(async (store, branch) => {
    const original = object('wall');
    const firstCommand = { branch, commandId: `${branch}:first`, expectedHead: null,
      assumptions: [{ entityId: 'wall', versionId: null }], puts: [original], deletes: [] };
    const first = await store.accept(firstCommand);
    assert.deepEqual((await store.page({ branch, after: '', limit: 10 }))[0]?.entity, original);
    const opened = await store.projectOpen({ branch, limit: 1 });
    assert.equal(opened.head, first.revisionId);
    assert.deepEqual(opened.page.map((row) => row.entity), [original]);
    assert.deepEqual(await store.accept(firstCommand), { revisionId: first.revisionId, replayed: true });
    await assert.rejects(store.accept({ ...firstCommand, puts: [object('wall', 2)] }), /different payload/);
    const fork = `${branch}-fork`;
    await store.createBranch({ branch: fork, revisionId: first.revisionId });
    const updated = object('wall', 3);
    const second = await store.accept({ branch, commandId: `${branch}:second`, expectedHead: first.revisionId,
      assumptions: [{ entityId: 'wall', versionId: hash(original) }], puts: [updated], deletes: [] });
    assert.deepEqual((await store.historical({ revisionId: first.revisionId, after: '', limit: 10 }))[0]?.entity, original);
    assert.deepEqual((await store.page({ branch: fork, after: '', limit: 10 }))[0]?.entity, original);
    assert.deepEqual(await store.delta(second.revisionId), [{ entity_id: 'wall', version_id: hash(updated) }]);
    assert.equal((await store.history('wall')).filter((row) => row !== null).length >= 2, true);
    await assert.rejects(store.accept({ branch, commandId: `${branch}:stale`, expectedHead: first.revisionId,
      assumptions: [{ entityId: 'wall', versionId: hash(original) }], puts: [original], deletes: [] }), /Head CAS/);
    await assert.rejects(store.accept({ branch, commandId: `${branch}:semantic`, expectedHead: second.revisionId,
      assumptions: [{ entityId: 'wall', versionId: hash(original) }], puts: [original], deletes: [] }), /Semantic CAS/);
    assert.equal(await store.head(branch), second.revisionId);
    await assert.rejects(store.client.query('UPDATE qvm_storage.versions SET kind=$1 WHERE version_id=$2', ['mutated', hash(original)]), /immutable/);
  });
});

test('dangling relationships abort all publication, delete tombstones preserve history', async () => {
  await withStore(async (store, branch) => {
    const invalid = entity({ ...object('edge'), fromId: 'absent-a', toId: 'absent-b' });
    await assert.rejects(store.accept({ branch, commandId: `${branch}:invalid`, expectedHead: null,
      assumptions: [{ entityId: 'edge', versionId: null }], puts: [invalid], deletes: [] }), /Dangling/);
    assert.equal(await store.head(branch), null);
    assert.deepEqual(await store.page({ branch, after: '', limit: 10 }), []);
    const original = object('only');
    const first = await store.accept({ branch, commandId: `${branch}:create`, expectedHead: null,
      assumptions: [{ entityId: 'only', versionId: null }], puts: [original], deletes: [] });
    const removed = await store.accept({ branch, commandId: `${branch}:remove`, expectedHead: first.revisionId,
      assumptions: [{ entityId: 'only', versionId: hash(original) }], puts: [], deletes: ['only'] });
    assert.deepEqual(await store.delta(removed.revisionId), [{ entity_id: 'only', version_id: null }]);
    assert.deepEqual(await store.historical({ revisionId: removed.revisionId, after: '', limit: 10 }), []);
    assert.equal((await store.historical({ revisionId: first.revisionId, after: '', limit: 10 })).length, 1);
  });
});

test('two real database connections racing one expected head publish exactly one command', async () => {
  await withStore(async (store, branch) => {
    const otherClient = connection(); await otherClient.connect();
    try {
      const other = new Storage(otherClient);
      const proposal = (id: string) => ({ branch, commandId: `${branch}:${id}`, expectedHead: null,
        assumptions: [{ entityId: id, versionId: null }], puts: [object(id)], deletes: [] });
      const results = await Promise.allSettled([store.accept(proposal('a')), other.accept(proposal('b'))]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
      assert.equal((await store.page({ branch, after: '', limit: 10 })).length, 1);
    } finally { await otherClient.end(); }
  });
});

test('W0 fixture load preserves all source documents/counts/checksums and type projections', async () => {
  const client = connection(); await client.connect();
  try {
    const store = new Storage(client); await store.initialize();
    const fixture: unknown = JSON.parse(await readFile(new URL('../fixtures/tiny-building.json', import.meta.url), 'utf8'));
    const records = fixtureEnvelopes(fixture);
    const expected = new Fingerprint(); records.forEach((record) => expected.add(record));
    const branch = `fixture-${randomUUID()}`;
    const imported = await load(store, fromArray(records), branch);
    assert.deepEqual(imported.fingerprint, expected.value());
    assert.deepEqual((await inspectBranch(store, branch)).fingerprint, expected.value());
    assert.equal((await store.projection({ branch, field: 'type_id', id: 'chair-type', limit: 100 })).length, 2);
    assert.equal((await store.historical({ revisionId: imported.revisionId, after: '', limit: 100 })).length, records.length);
    const brokenBranch = `broken-${randomUUID()}`;
    await assert.rejects(load(store, fromArray([records[0], records[0]].filter((item): item is StoredEntity => item !== undefined)), brokenBranch), /duplicate/);
    await assert.rejects(store.head(brokenBranch), /Unknown branch/);
  } finally { await client.end(); }
});

test('existing product snapshot and delta oracles agree within unchanged native limits', async () => {
  await withStore(async (store, branch) => {
    const repo = await RoomRepository.create('W5 baseline');
    const before = nativeEnvelopes(repo.view(repo.head('main')).snapshot);
    const first = await store.accept({ branch, commandId: `${branch}:native`, expectedHead: null,
      assumptions: before.entities.map((item) => ({ entityId: item.entityId, versionId: null })), puts: before.entities, deletes: [] });
    await saveSnapshot(store, first.revisionId, before.snapshot);
    const proposed = previewRectangle(before.snapshot, { boundsMm: { minX: 0, minY: 0, maxX: 8000, maxY: 6000 }, door: { widthMm: 900, offsetMm: 1000 } });
    const after = nativeEnvelopes(proposed);
    const changed = after.entities.filter((item) => before.entities.find((base) => base.entityId === item.entityId && hash(base) === hash(item)) === undefined);
    const second = await store.accept({ branch, commandId: `${branch}:native-next`, expectedHead: first.revisionId,
      assumptions: changed.map((item) => ({ entityId: item.entityId, versionId: hash(before.entities.find((base) => base.entityId === item.entityId) ?? item) })),
      puts: changed, deletes: [] });
    assert.deepEqual((await store.delta(second.revisionId)).map((row) => row.entity_id).sort(), nativeDeltaIds(before.snapshot, after.snapshot));
    assert.deepEqual(await snapshotAt(store, first.revisionId), before.snapshot);
    const oversized = { units: 'm', entities: Array.from({ length: 101 }, (_, index) => ({ id: `wall-${index}`, type: 'Wall' })), relationships: [] };
    assert.throws(() => nativeEnvelopes(oversized), { name: 'Error', message: 'Model arrays must be dense and bounded.' });
  });
});

test('command boundary rejects silent overwrites, duplicate writes and malformed endpoints', () => {
  assert.throws(() => command({ branch: 'x', commandId: 'x', expectedHead: null, assumptions: [], puts: [object('a')], deletes: [] }), /read assumption/);
  assert.throws(() => command({ branch: 'x', commandId: 'x', expectedHead: null,
    assumptions: [{ entityId: 'a', versionId: null }], puts: [object('a')], deletes: ['a'] }), /Duplicate write/);
  assert.throws(() => entity({ ...object('a'), fromId: 'x', toId: null }), /Both relationship/);
  assert.equal(hash(object('a')), hash({ ...object('a'), document: { ...object('a').document } }));
});

test('duplicate staged identities roll back every version in that batch', async () => {
  await withStore(async (store, branch) => {
    const record = PreparedEntity.from(object(`${branch}:duplicate`));
    await store.client.query('CREATE TEMP TABLE w5_load_stage(entity_id text PRIMARY KEY,version_id text NOT NULL)');
    await assert.rejects(store.stageVersions([record, record]), /duplicate/);
    const versions = await store.client.query('SELECT version_id FROM qvm_storage.versions WHERE version_id=$1', [record.versionId]);
    assert.equal(versions.rows.length, 0);
    const staged = await store.client.query('SELECT entity_id FROM w5_load_stage');
    assert.equal(staged.rows.length, 0);
    assert.equal(await store.head(branch), null);
  });
});

test('accept rejects incoming references on deletion and permits atomic retargeting', async () => {
  await withStore(async (store, branch) => {
    const target = object('target');
    const source = entity({ ...object('source'), containerId: 'target' });
    const first = await store.accept({ branch, commandId: `${branch}:seed`, expectedHead: null,
      assumptions: [target, source].map((item) => ({ entityId: item.entityId, versionId: null })),
      puts: [target, source], deletes: [] });
    await assert.rejects(store.accept({ branch, commandId: `${branch}:bad-delete`, expectedHead: first.revisionId,
      assumptions: [{ entityId: 'target', versionId: hash(target) }], puts: [], deletes: ['target'] }), /Dangling/);
    assert.equal(await store.head(branch), first.revisionId);
    assert.notEqual(await store.detail({ branch, entityId: 'target' }), null);
    const receipts = await store.client.query('SELECT command_id FROM qvm_storage.receipts WHERE command_id=$1', [`${branch}:bad-delete`]);
    assert.equal(receipts.rows.length, 0);
    const next = object('next');
    const moved = entity({ ...source, containerId: 'next' });
    const accepted = await store.accept({ branch, commandId: `${branch}:retarget`, expectedHead: first.revisionId,
      assumptions: [{ entityId: 'target', versionId: hash(target) }, { entityId: 'source', versionId: hash(source) },
        { entityId: 'next', versionId: null }], puts: [next, moved], deletes: ['target'] });
    assert.equal(await store.head(branch), accepted.revisionId);
    assert.equal(await store.detail({ branch, entityId: 'target' }), null);
    assert.deepEqual((await store.detail({ branch, entityId: 'source' }))?.entity, moved);
    await store.validateReferences(branch);
  });
});

test('accept owns the validated command while waiting for the branch lock', async () => {
  await withStore(async (store, branch) => {
    const locker = connection(); await locker.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT head FROM qvm_storage.branches WHERE branch=$1 FOR UPDATE', [branch]);
      const original = object('owned');
      const proposal = { branch, commandId: `${branch}:owned`, expectedHead: null,
        assumptions: [{ entityId: 'owned', versionId: null }], puts: [original], deletes: [] };
      const owned = structuredClone(proposal);
      const accepting = store.accept(proposal);
      original.document.properties = ['changed after submission'];
      proposal.commandId = `${branch}:mutated`;
      await locker.query('COMMIT');
      const result = await accepting;
      assert.equal(result.revisionId, hash(owned));
      assert.deepEqual((await store.detail({ branch, entityId: 'owned' }))?.entity, owned.puts[0]);
      assert.deepEqual(await store.accept(owned), { revisionId: result.revisionId, replayed: true });
    } finally { await locker.query('ROLLBACK'); await locker.end(); }
  });
});

test('W4 COPY decoder preserves typed properties, escaped content and independent bigint namespaces', () => {
  assert.equal(decodeCopyCell('\\N'), null);
  assert.equal(decodeCopyCell('\\\\N'), '\\N');
  assert.equal(decodeCopyCell('a\\tb\\nc\\rd\\\\e'), 'a\tb\nc\rd\\e');
  const properties = { length: { state: 'known', value: 2.5, unit: 'm' }, rating: { state: 'unknown' },
    clearance: { state: 'not-applicable' }, cleared: { state: 'cleared', value: null } };
  const source = w4Record('entities', ['1', 'wall', '1', null, null, null, '1', JSON.stringify(properties), '{"padding":"x"}', '{"file":"synthetic"}']);
  assert.deepEqual(source.document.properties, properties);
  assert.equal(source.entityId, 'entity:0000000000000000001');
  const relationship = w4Record('relationships', ['1', 'connectedTo', '1', '2', '1', '{}']);
  assert.equal(relationship.entityId, 'relationship:0000000000000000001');
  assert.equal(relationship.fromId, source.entityId);
  assert.equal(relationship.toId, 'entity:0000000000000000002');
  const parameter = w4Record('parameters', ['1', '2', 'offset', 'dimensional', '0.3', '1', '1', '{}']);
  assert.equal(parameter.containerId, relationship.toId);
  assert.equal(parameter.toId, source.entityId);
  assert.throws(() => w4Record('entities', ['1']), /column count/);
  assert.throws(() => decodeCopyCell('bad\\q'), /escape/);
});
