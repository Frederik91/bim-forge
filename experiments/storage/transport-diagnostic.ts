import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mock } from 'node:test';
import { Client } from 'pg';
import { Type } from 'typebox';
import { Storage } from './store.ts';
import { PreparedEntity } from './prepared.ts';
import { boundedLines } from './lines.ts';
import { decodeCopyCell, w4Record } from './w4.ts';
import { hash, parse, EntitySchema, HashSchema, IdSchema, JsonObjectSchema } from './contract.ts';
import type { StoredEntity } from './contract.ts';

// Captures the actual insertVersions query argument; never connects to PostgreSQL.
const filename = process.argv[2];
if (!filename) throw new Error('Expected retained actual W4 entities COPY file');
const sourceHash = createHash('sha256');
for await (const chunk of createReadStream(filename)) sourceHash.update(chunk);
const items: StoredEntity[] = [];
const kinds = new Map<string, number>();
let sourceRows = 0;
for await (const line of boundedLines(createReadStream(filename))) {
  sourceRows += 1;
  const kind = line.split('\t')[1];
  if (!kind) throw new Error('Missing source kind');
  const count = kinds.get(kind) ?? 0;
  if (count < 2) {
    items.push(w4Record('entities', line.split('\t').map(decodeCopyCell)));
    kinds.set(kind, count + 1);
  }
}
assert.ok(items.length > 0);
// Exact pre-fix expression; retain both documents to measure the original bytes.
const before = JSON.stringify(items.map((item) => ({ versionId: hash(item), ...item }))
  .map(({ versionId, ...body }) => ({ ...body, body, versionId })));
const client = new Client();
let after = '';
let queryCount = 0;
const capture = mock.method(client, 'query', async (sql: string, values: unknown[]) => {
  assert.match(sql, /jsonb_to_recordset/);
  assert.equal(values.length, 1);
  const encoded = values[0];
  if (typeof encoded !== 'string') throw new Error('Expected encoded transport');
  after = encoded;
  queryCount += 1;
  return { rows: [] };
});
try { await new Storage(client).insertVersions(items.map((item) => PreparedEntity.from(item))); } finally { capture.mock.restore(); }
assert.equal(queryCount, 1);
const nullableId = Type.Union([IdSchema, Type.Null()]);
const columns = Type.Object({ versionId: HashSchema, entityId: IdSchema, kind: IdSchema,
  typeId: nullableId, containerId: nullableId, systemId: nullableId, fromId: nullableId, toId: nullableId,
  body: EntitySchema });
const oldRows = parse(Type.Array(Type.Object({ ...columns.properties, document: JsonObjectSchema }, { additionalProperties: false })),
  JSON.parse(before), 'original transport');
const newRows = parse(Type.Array(Type.Object(columns.properties, { additionalProperties: false })),
  JSON.parse(after), 'explicit-column transport');
const oldVisible = oldRows.map(({ document, ...row }) => {
  assert.deepEqual(document, row.body.document);
  return row;
});
assert.deepEqual(newRows, oldVisible);
assert.deepEqual(newRows.map((row) => row.body), items);
assert.deepEqual(newRows.map((row) => row.versionId), items.map(hash));
const beforeBytes = Buffer.byteLength(before);
const afterBytes = Buffer.byteLength(after);
const duplicateFieldBytes = items.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item.document))
  + Buffer.byteLength(',"document":'), 0);
assert.equal(beforeBytes - afterBytes, duplicateFieldBytes);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
process.stdout.write(`${JSON.stringify({ sourceHash: sourceHash.digest('hex'), sourceRows, selectedRows: items.length,
  kinds: Object.fromEntries(kinds), beforeBytes, afterBytes, duplicateFieldBytes,
  beforeTransportSha256: sha256(before), afterTransportSha256: sha256(after),
  beforeSqlVisibleHash: hash(oldVisible), afterSqlVisibleHash: hash(newRows),
  beforeBodyHash: hash(oldVisible.map((row) => row.body)), afterBodyHash: hash(newRows.map((row) => row.body)),
  versionIdsHash: hash(items.map(hash)), queryCount, errors: [], node: process.version,
  scope: 'Deterministic UTF-8 query-argument bytes only; transport intercepted, no PostgreSQL execution or throughput claim.' }, null, 2)}\n`);
