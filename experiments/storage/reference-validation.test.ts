import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { entity, hash } from './contract.ts';
import type { StoredEntity } from './contract.ts';
import { Storage } from './store.ts';
import { changedReferencesSql, deletedReferencesSql, validateChangedReferences } from './reference-validation.ts';

type References = Pick<StoredEntity, 'typeId' | 'containerId' | 'systemId' | 'fromId' | 'toId'>;
function item(entityId: string, refs: Partial<References> = {}): StoredEntity {
  return entity({ entityId, kind: 'wall', typeId: null, containerId: null, systemId: null,
    fromId: null, toId: null, ...refs, document: {} });
}
const referenceCases = [
  { column: 'type_id', refs: { typeId: 'target' } },
  { column: 'container_id', refs: { containerId: 'target' } },
  { column: 'system_id', refs: { systemId: 'target' } },
  { column: 'from_id', refs: { fromId: 'target', toId: 'peer' } },
  { column: 'to_id', refs: { fromId: 'peer', toId: 'target' } },
] satisfies { column: string; refs: Partial<References> }[];

async function withStore(work: (store: Storage, branch: string) => Promise<void>): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url || !process.env.QVM_EXECUTION_LEASE) throw new Error('Focused tests require DATABASE_URL and execution lease');
  if (!new URL(url).pathname.startsWith('/qvm_w5_issue141_')) throw new Error('Focused tests require their own issue141 database');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const store = new Storage(client);
    await store.initialize();
    const branch = `ref-${randomUUID()}`;
    await store.createBranch({ branch, revisionId: null });
    await work(store, branch);
  } finally { await client.end(); }
}

async function seed(store: Storage, branch: string, puts: StoredEntity[]): Promise<void> {
  await store.accept({ branch, commandId: `${branch}:seed`, expectedHead: null,
    assumptions: puts.map((row) => ({ entityId: row.entityId, versionId: null })), puts, deletes: [] });
}

// Stages real versions/visibility without depending on the coordinator's bulk insertion API.
async function stage(store: Storage, branch: string, puts: StoredEntity[], deletes: readonly string[]): Promise<void> {
  for (const row of puts) {
    await store.client.query(`INSERT INTO qvm_storage.versions
      (version_id,entity_id,kind,type_id,container_id,system_id,from_id,to_id,body)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT DO NOTHING`,
    [hash(row), row.entityId, row.kind, row.typeId, row.containerId, row.systemId, row.fromId, row.toId, JSON.stringify(row)]);
  }
  await store.client.query(`DELETE FROM qvm_storage.visibility WHERE branch=$1 AND entity_id=ANY($2::text[])`,
    [branch, [...deletes, ...puts.map((row) => row.entityId)]]);
  await store.client.query(`INSERT INTO qvm_storage.visibility
    SELECT $1,v.entity_id,v.version_id,v.kind,v.type_id,v.container_id,v.system_id,v.from_id,v.to_id
    FROM qvm_storage.versions v WHERE v.version_id=ANY($2::text[])`, [branch, puts.map(hash)]);
}

async function apply(store: Storage, branch: string, puts: StoredEntity[], deletes: readonly string[]): Promise<void> {
  await store.transaction(async () => {
    await stage(store, branch, puts, deletes);
    await validateChangedReferences(store.client, branch, puts.map((row) => row.entityId), deletes);
    await store.validateReferences(branch);
  });
}

for (const { column, refs } of referenceCases) {
  test(`changed ${column} rejects a dangling reference and rolls back inserted versions/visibility`, async () => {
    await withStore(async (store, branch) => {
      await seed(store, branch, [item('peer')]);
      const head = await store.head(branch);
      const invalid = item('source', refs);
      await assert.rejects(apply(store, branch, [invalid], []), { message: 'Dangling reference source -> target' });
      assert.equal(await store.detail({ branch, entityId: 'source' }), null);
      assert.equal(await store.head(branch), head);
      assert.deepEqual((await store.client.query<Record<string, unknown>>(
        `SELECT version_id FROM qvm_storage.versions WHERE version_id=$1`, [hash(invalid)])).rows, []);
      await apply(store, branch, [item('target'), invalid], []);
      assert.deepEqual((await store.detail({ branch, entityId: 'source' }))?.entity, invalid);
    });
  });

  test(`deleting a target rejects a surviving incoming ${column} reference`, async () => {
    await withStore(async (store, branch) => {
      await seed(store, branch, [item('peer'), item('target'), item('source', refs)]);
      await assert.rejects(apply(store, branch, [], ['target']), { message: 'Dangling reference source -> target' });
      assert.notEqual(await store.detail({ branch, entityId: 'target' }), null);
      await store.validateReferences(branch);
    });
  });
}

test('same-command deletion of both source and target leaves no dangling reference', async () => {
  await withStore(async (store, branch) => {
    await seed(store, branch, [item('target'), item('source', { typeId: 'target' })]);
    await apply(store, branch, [], ['target', 'source']);
    assert.deepEqual(await store.page({ branch, after: '', limit: 10 }), []);
  });
});

test('same-command retarget and same-ID replacement validate only final visibility', async () => {
  await withStore(async (store, branch) => {
    await seed(store, branch, [item('target'), item('source', { typeId: 'target' })]);
    await apply(store, branch, [item('next'), item('source', { typeId: 'next' })], ['target']);
    assert.equal((await store.detail({ branch, entityId: 'source' }))?.entity.typeId, 'next');
    // Include the replaced identity in deletedIds to prove final presence wins.
    await apply(store, branch, [item('next', { containerId: 'next' })], ['next']);
    assert.equal((await store.detail({ branch, entityId: 'next' }))?.entity.containerId, 'next');
    await assert.rejects(apply(store, branch, [item('next', { typeId: 'missing' })], []),
      { message: 'Dangling reference next -> missing' });
    assert.equal((await store.detail({ branch, entityId: 'next' }))?.entity.containerId, 'next');
  });
});

test('branch isolation excludes foreign targets and foreign incoming sources', async () => {
  await withStore(async (store, branch) => {
    await seed(store, branch, [item('peer'), item('target'), item('source', { typeId: 'target' })]);
    const fork = `${branch}-fork`;
    await store.createBranch({ branch: fork, revisionId: await store.head(branch) });
    await apply(store, branch, [], ['source']);
    await apply(store, branch, [], ['target']);
    await assert.rejects(apply(store, branch, [item('new', { typeId: 'target' })], []),
      { message: 'Dangling reference new -> target' });
    assert.notEqual(await store.detail({ branch: fork, entityId: 'target' }), null);
    await store.validateReferences(fork);
  });
});

test('empty, duplicate and absent IDs are safe, including cyclic references created together', async () => {
  await withStore(async (store, branch) => {
    await apply(store, branch, [item('a', { typeId: 'b' }), item('b', { typeId: 'a' })], []);
    await validateChangedReferences(store.client, branch, [], []);
    await validateChangedReferences(store.client, branch, ['a', 'a', 'absent'], ['absent', 'absent']);
    await apply(store, branch, [], ['a', 'b']);
  });
});

test('scoped checking requires the initial full validation of otherwise unrelated rows', async () => {
  await withStore(async (store, branch) => {
    await seed(store, branch, [item('valid')]);
    await store.transaction(async () => {
      await stage(store, branch, [item('invalid', { systemId: 'missing' })], []);
      await validateChangedReferences(store.client, branch, ['valid'], []);
      await assert.rejects(store.validateReferences(branch), { message: 'Dangling reference invalid -> missing' });
      // The complete changed set still catches this row; imports must keep the full validator.
      await assert.rejects(validateChangedReferences(store.client, branch, ['valid', 'invalid'], []),
        { message: 'Dangling reference invalid -> missing' });
    });
  });
});

test('tiny-data EXPLAIN executes both SQL paths with the existing projection indexes', async (context) => {
  await withStore(async (store, branch) => {
    await seed(store, branch, [item('target'), item('peer'), item('source', { typeId: 'target' })]);
    await store.transaction(async () => {
      await stage(store, branch, [], ['target']);
      for (const sql of [changedReferencesSql, deletedReferencesSql]) {
        const plan = await store.client.query<Record<string, unknown>>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
          [branch, sql === changedReferencesSql ? ['source'] : ['target']]);
        context.diagnostic(JSON.stringify({ mode: 'planner-default', plan: plan.rows }));
      }
      // Tiny tables can prefer sequential scans. This checks index eligibility, not performance.
      await store.client.query('SET LOCAL enable_seqscan=off');
      const indexed = await store.client.query<Record<string, unknown>>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${deletedReferencesSql}`,
        [branch, ['target']]);
      for (const { column } of referenceCases) {
        const text = JSON.stringify(indexed.rows);
        assert.ok(text.includes(`visibility_${column.replace('_id', '')}`));
      }
      context.diagnostic('All five existing partial incoming indexes are eligible; no scale claim.');
    });
  });
});
