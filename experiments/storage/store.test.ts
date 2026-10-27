import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { Type } from 'typebox';
import { RoomRepository, previewRectangle } from '../../src/room-model.ts';
import { Storage } from './store.ts';
import { canonical, command, entity, EntitySchema, hash, HashSchema, JsonSchema, parse } from './contract.ts';
import type { StoredEntity } from './contract.ts';
import { fromArray, fixtureEnvelopes } from './fixture.ts';
import { Fingerprint, inspectBranch, load } from './load.ts';
import { nativeDeltaIds, nativeEnvelopes, saveSnapshot, snapshotAt } from './baseline.ts';
import { decodeCopyCell, w4Record } from './w4.ts';
import { PreparedEntity } from './prepared.ts';
import { runWorkload } from './workload.ts';

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

function importRecords(prefix: string, count: number, padding = ''): StoredEntity[] {
  const id = (index: number) => `${prefix}:row:${String(index).padStart(5, '0')}`;
  return Array.from({ length: count }, (_, index) => {
    const original = object(id(index), index);
    return entity({ ...original, kind: index === count - 1 ? 'space' : index % 2 === 0 ? 'wall' : 'equipment',
      containerId: index === count - 1 ? null : id(count - 1),
      document: { ...original.document, payload: { padding, text: 'æøå\t\n\\N', flags: [true, false, null] },
        source: { fixture: 'issue156', ordinal: index } } });
  });
}

function assertVersionedBodies(rows: Awaited<ReturnType<Storage['page']>>, records: StoredEntity[]): void {
  const expected = new Map(records.map((record) => [record.entityId, record]));
  assert.equal(rows.length, records.length);
  for (const row of rows) {
    const original = expected.get(row.entity.entityId);
    assert.ok(original, `Unexpected or duplicate stored identity ${row.entity.entityId}`);
    assert.equal(row.versionId, hash(original));
    assert.equal(hash(row.entity), row.versionId);
    assert.deepEqual(row.entity, original);
    expected.delete(row.entity.entityId);
  }
  assert.equal(expected.size, 0);
}

async function assertStoredVersions(store: Storage, records: StoredEntity[]): Promise<void> {
  const rows = await store.rows(Type.Object({ body: EntitySchema, version_id: HashSchema }),
    'SELECT body,version_id FROM qvm_storage.versions WHERE entity_id=ANY($1::text[])', [records.map((record) => record.entityId)]);
  assertVersionedBodies(rows.map((row) => ({ entity: row.body, versionId: row.version_id })), records);
}

async function assertAbsentVersions(store: Storage, records: StoredEntity[]): Promise<void> {
  const rows = await store.rows(Type.Object({ version_id: HashSchema }),
    'SELECT version_id FROM qvm_storage.versions WHERE version_id=ANY($1::text[])', [records.map(hash)]);
  assert.deepEqual(rows, []);
}

async function assertUnpublished(store: Storage, branch: string): Promise<void> {
  await assert.rejects(store.head(branch), /Unknown branch/);
  assert.deepEqual(await store.page({ branch, after: '', limit: 10 }), []);
  const revisions = await store.rows(Type.Object({ revision_id: HashSchema }),
    "SELECT revision_id FROM qvm_storage.revisions WHERE payload->>'branch'=$1", [branch]);
  assert.deepEqual(revisions, []);
  const receipts = await store.rows(Type.Object({ revision_id: HashSchema }), `SELECT p.revision_id FROM qvm_storage.receipts p
    JOIN qvm_storage.revisions r ON r.revision_id=p.revision_id WHERE r.payload->>'branch'=$1`, [branch]);
  assert.deepEqual(receipts, []);
}

async function assertImported(store: Storage, branch: string, records: StoredEntity[], imported: Awaited<ReturnType<typeof load>>): Promise<void> {
  const expected = new Fingerprint();
  const countsByKind: Record<string, number> = {};
  let canonicalBytes = 0;
  for (const record of records) {
    expected.add(record); canonicalBytes += Buffer.byteLength(canonical(record));
    countsByKind[record.kind] = (countsByKind[record.kind] ?? 0) + 1;
  }
  assert.deepEqual(imported.fingerprint, expected.value());
  assert.deepEqual({ ...imported.countsByKind }, countsByKind);
  assert.equal(imported.canonicalBytes, canonicalBytes);
  const inspected = await inspectBranch(store, branch);
  assert.deepEqual(inspected.fingerprint, expected.value());
  assert.deepEqual({ ...inspected.countsByKind }, countsByKind);
  assert.equal(await store.head(branch), imported.revisionId);
  assertVersionedBodies(await store.page({ branch, after: '', limit: 10000 }), records);
  assertVersionedBodies(await store.historical({ revisionId: imported.revisionId, after: '', limit: 10000 }), records);
  await assertStoredVersions(store, records);
  const tail = records.at(-1); assert.ok(tail);
  assert.deepEqual(await store.detail({ branch, entityId: tail.entityId }), { entity: tail, versionId: hash(tail) });
  await store.validateReferences(branch);
}

async function withImportObserver(work: (store: Storage, observer: Storage, root: string) => Promise<void>): Promise<void> {
  await withStore(async (store, root) => {
    const control = object(`${root}:accepted-control`);
    const accepted = await store.accept({ branch: root, commandId: `${root}:control`, expectedHead: null,
      assumptions: [{ entityId: control.entityId, versionId: null }], puts: [control], deletes: [] });
    const observerClient = connection(); await observerClient.connect();
    try {
      const observer = new Storage(observerClient);
      await work(store, observer, root);
      assert.equal(await observer.head(root), accepted.revisionId);
      assertVersionedBodies(await observer.page({ branch: root, after: '', limit: 10 }), [control]);
    } finally { await observerClient.end(); }
  });
}

for (const count of [4999, 5000, 5001]) {
  test(`bulk import preserves all ${count} compact records, kinds, immutable bodies and final tail`, async () => {
    await withStore(async (store, root) => {
      const branch = `${root}-bulk`;
      const records = importRecords(branch, count);
      assert.ok(records.reduce((bytes, record) => bytes + Buffer.byteLength(canonical(record)), 0) < 4 * 1024 ** 2);
      const imported = await load(store, fromArray(records), branch);
      await assertImported(store, branch, records, imported);
    });
  });
}

test('bulk byte-triggered staging commits bounded larger bodies before the producer tail and publishes only the complete import', async () => {
  await withImportObserver(async (store, observer, root) => {
    const branch = `${root}-bytes`;
    const prefix = importRecords(branch, 4, 'x'.repeat(1024 ** 2));
    const bytes = prefix.map((record) => Buffer.byteLength(canonical(record)));
    assert.ok(bytes.every((size) => size < 4 * 1024 ** 2));
    assert.ok(bytes.reduce((sum, size) => sum + size, 0) > 4 * 1024 ** 2);
    const tail = object(`${branch}:tail`);
    async function* source(): AsyncGenerator<StoredEntity> {
      yield* prefix;
      await assertStoredVersions(observer, prefix);
      await assertUnpublished(observer, branch);
      yield tail;
    }
    const imported = await load(store, source(), branch);
    await assertImported(observer, branch, [...prefix, tail], imported);
  });
});

test('bulk duplicate identity across a committed batch rolls back every tail version without publishing or changing earlier bodies', async () => {
  await withImportObserver(async (store, observer, root) => {
    const branch = `${root}-duplicate`;
    const prefix = importRecords(branch, 5000);
    const original = prefix[0]; assert.ok(original);
    const duplicate = entity({ ...original, document: { replacement: 'must not replace the immutable first body' } });
    const tail = [object(`${branch}:tail-a`), object(`${branch}:tail-b`), duplicate];
    await assert.rejects(load(store, fromArray([...prefix, ...tail]), branch), /duplicate/i);
    await assertUnpublished(observer, branch);
    await assertStoredVersions(observer, prefix);
    await assertAbsentVersions(observer, tail);
    const recovery = [object(`${branch}:recovery`)];
    await assertImported(observer, `${branch}-retry`, recovery, await load(store, fromArray(recovery), `${branch}-retry`));
  });
});

test('bulk late dangling reference retains immutable staged bodies but rolls back branch publication', async () => {
  await withImportObserver(async (store, observer, root) => {
    const branch = `${root}-dangling`;
    const prefix = importRecords(branch, 5000);
    const invalid = entity({ ...object(`${branch}:late-reference`), typeId: `${branch}:missing-target` });
    const records = [...prefix, invalid];
    await assert.rejects(load(store, fromArray(records), branch), /Dangling reference/);
    await assertUnpublished(observer, branch);
    await assertStoredVersions(observer, records);
    const recovery = [object(`${branch}:recovery`)];
    await assertImported(observer, `${branch}-retry`, recovery, await load(store, fromArray(recovery), `${branch}-retry`));
  });
});

test('bulk late producer failure preserves committed immutable versions, discards the unflushed tail and cannot publish a partial branch', async () => {
  await withImportObserver(async (store, observer, root) => {
    const branch = `${root}-producer`;
    const prefix = importRecords(branch, 5000);
    const tail = object(`${branch}:unflushed-tail`);
    async function* source(): AsyncGenerator<StoredEntity> {
      yield* prefix;
      await assertStoredVersions(observer, prefix);
      await assertUnpublished(observer, branch);
      yield tail;
      throw new Error('Fixture source failed after its unflushed tail');
    }
    await assert.rejects(load(store, source(), branch), /Fixture source failed/);
    await assertUnpublished(observer, branch);
    await assertStoredVersions(observer, prefix);
    await assertAbsentVersions(observer, [tail]);
    const recovery = [object(`${branch}:recovery`)];
    await assertImported(observer, `${branch}-retry`, recovery, await load(store, fromArray(recovery), `${branch}-retry`));
  });
});

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

test('tiny load-only policy fixture retains its remaining load timeout through exact metrics', async () => {
  const root = process.env.QVM152_ARTIFACT_ROOT;
  if (!root) throw new Error('Coordinator QVM152_ARTIFACT_ROOT required for retained policy-fixture evidence');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'load-phase-'));
  const decisionPath = path.join(directory, 'decision.md');
  await writeFile(decisionPath, 'Tiny fixture tests timeout policy only; no full-inventory or capacity claim.\n');
  const client = connection(); await client.connect();
  try {
    const store = new Storage(client); await store.initialize();
    const branch = `phase-${randomUUID()}`;
    const output = path.join(directory, 'load-only');
    const observations = await runWorkload(store, {
      experimentId: 'EX-13', runId: branch, branch, dataset: fileURLToPath(new URL('../fixtures/tiny-building.json', import.meta.url)),
      format: 'w0-fixture', scale: 'fixture', historyRevisions: 1, clients: 1, repeats: 1,
      mixedOperationsPerClient: 2, writeEvery: 2, pageSize: 10, cacheLabel: 'tiny policy fixture',
      leaseMode: 'shared-correctness', statementTimeoutMs: 1000, materializationDiagnostic: false,
      execution: {
        decisionPath, decisionSha256: createHash('sha256').update(await readFile(decisionPath)).digest('hex'),
        mode: { kind: 'load-only' }, purpose: 'initial-inventory', measurement: 'correctness', maxBoundedUpdates: 1,
        loadWallTimeLimitMs: 120000, loadStatementTimeoutMs: 120000,
        space: { dataPath: process.env.QVM152_DATA_PATH ?? '/qualification', hostRootPath: process.env.QVM152_HOST_ROOT_PATH ?? '/host-root',
          dataBudgetBytes: 214748364800, dataReserveBytes: 107374182400, rootReserveBytes: 4294967296, monitorEvidence: 'coordinator-watchdog' },
        exploratoryP95Ms: { detail: 300, page: 1000, oneHop: 1000, boundedDelta: 2000, smallAccept: 4000 },
      },
      environment: { nodeImage: 'tiny-policy-fixture', postgresImage: 'tiny-policy-fixture',
        sourceCommit: process.env.QVM152_SOURCE_COMMIT ?? '0'.repeat(40), nodeCpuLimit: 1, nodeMemoryLimitBytes: 1073741824,
        postgresCpuLimit: 1.5, postgresMemoryLimitBytes: 3221225472, diskBudgetBytes: 214748364800,
        storageDescription: 'Coordinator-owned disposable PG fixture; not a full dataset run' },
    }, output);
    assert.ok(observations.length > 0);
    assert.ok(observations.every((row) => row.passed), JSON.stringify(observations));
    assert.equal(observations.filter((row) => row.caseId === 'initial-inventory' && row.passed).length, 1);
    const metrics = parse(Type.Object({ settings: Type.Object({ statement_timeout: Type.String() }),
      counts: Type.Object({ versions: Type.Integer(), changes: Type.Integer(), visibility: Type.Integer() }) }),
    JSON.parse(await readFile(path.join(output, 'metrics-loaded.json'), 'utf8')), 'load-only metrics');
    const timeout = Number(metrics.settings.statement_timeout);
    assert.ok(Number.isFinite(timeout) && timeout > 1000 && timeout <= 120000, JSON.stringify(metrics.settings));
    assert.ok(metrics.counts.versions > 0 && metrics.counts.changes > 0 && metrics.counts.visibility > 0);
    const oracle = parse(Type.Object({ expected: JsonSchema, actual: JsonSchema }),
      JSON.parse(await readFile(path.join(output, 'oracle.json'), 'utf8')), 'fixture readback oracle');
    assert.deepEqual(oracle.actual, oracle.expected);
    assert.deepEqual(JSON.parse(await readFile(path.join(output, 'errors.json'), 'utf8')), []);
    assert.notEqual(await store.head(branch), null);
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

test('initial imports validate all five reference columns before publishing any branch', async () => {
  await withStore(async (store, root) => {
    const cases = [{ typeId: 'target' }, { containerId: 'target' }, { systemId: 'target' },
      { fromId: 'target', toId: 'peer' }, { fromId: 'peer', toId: 'target' }];
    for (const [index, references] of cases.entries()) {
      const source = entity({ ...object(`source-${index}`), ...references });
      const branch = `${root}-missing-${index}`;
      await assert.rejects(load(store, fromArray([object('peer'), source]), branch), /Dangling reference/);
      await assert.rejects(store.head(branch), /Unknown branch/);
      const valid = await load(store, fromArray([object('peer'), object('target'), source]), `${root}-valid-${index}`);
      assert.equal(valid.fingerprint.count, 3);
      await store.validateReferences(`${root}-valid-${index}`);
    }
    const self = entity({ ...object('self'), typeId: 'self' });
    await load(store, fromArray([self]), `${root}-self`);
    await store.validateReferences(`${root}-self`);
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
