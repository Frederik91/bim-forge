import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { digestIds, numericId, selectionOracles } from './selections.ts';

function manifest() {
  return { oracles: [
    { caseId: 'entity-count', sql: 'SELECT count(*) FROM entities', expected: 3 },
    ...[
      { caseId: 'hot-space-members', field: 'space_id', id: 4 },
      { caseId: 'shared-type-members', field: 'type_id', id: 18 },
      { caseId: 'system-members-including-ports', field: 'system_id', id: 15 },
    ].map((item) => ({ caseId: item.caseId, sql: `SELECT count(*) FROM entities WHERE ${item.field} = ${item.id}`,
      expected: 3, orderedIdCopySql: `COPY (SELECT id FROM entities WHERE ${item.field} = ${item.id} ORDER BY id) TO STDOUT`,
      orderedIdSha256: createHash('sha256').update('1\n2\n10\n').digest('hex') })),
  ] };
}

test('selection manifest accepts the three exact known predicates and ignores unrelated count oracles', () => {
  const selected = selectionOracles(manifest());
  assert.deepEqual(selected.map((item) => [item.caseId, item.column, item.targetId]), [
    ['hot-space-members', 'container_id', 'entity:0000000000000000004'],
    ['shared-type-members', 'type_id', 'entity:0000000000000000018'],
    ['system-members-including-ports', 'system_id', 'entity:0000000000000000015'],
  ]);
});

test('selection manifest rejects injected SQL, mismatched predicates, unsupported ordered oracles and missing/duplicate cases', () => {
  const input = manifest();
  const first = input.oracles[1];
  if (!first) throw new Error('Missing test oracle');
  const replace = (replacement: object) => ({ oracles: [input.oracles[0], { ...first, ...replacement }, ...input.oracles.slice(2)] });
  assert.throws(() => selectionOracles(replace({ sql: `${first.sql}; DELETE FROM entities` })), /Unexpected selection predicate/);
  assert.throws(() => selectionOracles(replace({ sql: 'SELECT count(*) FROM entities WHERE type_id = 4' })), /Unexpected selection predicate/);
  assert.throws(() => selectionOracles(replace({ orderedIdCopySql: 'COPY (SELECT id FROM entities WHERE space_id = 5 ORDER BY id) TO STDOUT' })), /predicate differs/);
  assert.throws(() => selectionOracles({ oracles: [...input.oracles, { ...first, caseId: 'custom-sql' }] }), /Unsupported ordered-ID oracle/);
  assert.throws(() => selectionOracles({ oracles: [...input.oracles, first] }), /duplicate selection oracle/);
  assert.throws(() => selectionOracles({ oracles: input.oracles.slice(2) }), /Missing/);
  assert.throws(() => selectionOracles(replace({ orderedIdSha256: 'not-a-hash' })), /Invalid/);
});

test('numeric identity normalization preserves exact decimal LF COPY bytes across a paged stream', async () => {
  const pages = [['entity:0000000000000000001', 'entity:0000000000000000002'], ['entity:0000000000000000010']];
  async function* rows() { for (const page of pages) yield* page; }
  assert.deepEqual(await digestIds(rows(), 1000), {
    count: 3, complete: true, sha256: createHash('sha256').update(Buffer.from('1\n2\n10\n', 'utf8')).digest('hex'),
  });
  assert.equal(numericId('entity:9223372036854775807'), '9223372036854775807');
  for (const invalid of ['entity:0', 'entity:0000000000000000000', 'relationship:0000000000000000001', 'entity:9223372036854775808']) {
    assert.throws(() => numericId(invalid));
  }
});

test('selection row bound cannot be mistaken for a complete selection or matching count', async () => {
  async function* rows() { yield 'entity:0000000000000000001'; yield 'entity:0000000000000000002'; yield 'entity:0000000000000000003'; }
  assert.deepEqual(await digestIds(rows(), 2), { count: 2, complete: false, sha256: createHash('sha256').update('1\n2\n').digest('hex') });
  async function* exactly() { yield 'entity:0000000000000000001'; yield 'entity:0000000000000000002'; }
  assert.equal((await digestIds(exactly(), 2)).complete, true);
});

test('selection checksum rejects duplicates and out-of-order IDs instead of silently reordering', async () => {
  async function* duplicate() { yield 'entity:0000000000000000001'; yield 'entity:0000000000000000001'; }
  async function* reversed() { yield 'entity:0000000000000000010'; yield 'entity:0000000000000000002'; }
  await assert.rejects(digestIds(duplicate(), 10), /strictly increasing/);
  await assert.rejects(digestIds(reversed(), 10), /strictly increasing/);
});
