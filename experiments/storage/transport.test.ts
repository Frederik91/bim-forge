import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { Type } from 'typebox';
import { entity, hash, parse, EntitySchema, HashSchema, IdSchema } from './contract.ts';
import { Storage } from './store.ts';

test('version transport sends complete bodies and SQL columns without an unused outer document', async (t) => {
  const client = new Client();
  const captured: { sql: string; values: unknown[] }[] = [];
  t.mock.method(client, 'query', async (sql: string, values: unknown[]) => {
    captured.push({ sql, values });
    return { rows: [] };
  });
  const store = new Storage(client);
  await store.insertVersions([]);
  assert.equal(captured.length, 0);
  const body = entity({ entityId: 'entity:0000000000000000001', kind: 'wall', typeId: 'type-1',
    containerId: 'space-1', systemId: 'system-1', fromId: 'start-1', toId: 'end-1',
    document: { properties: { length: { state: 'known', value: 3, unit: 'm' },
      unknown: { state: 'unknown' }, absent: { state: 'not-applicable' }, cleared: { state: 'cleared', value: null } },
    payload: { nested: [true, null, 2.5, 'æøå\t\n\\N'] }, source: { file: 'unchanged.ifc', revision: 1 } } });
  const nullableId = Type.Union([IdSchema, Type.Null()]);
  const schema = Type.Array(Type.Object({ versionId: HashSchema, entityId: IdSchema, kind: IdSchema,
    typeId: nullableId, containerId: nullableId, systemId: nullableId, fromId: nullableId, toId: nullableId,
    body: EntitySchema }, { additionalProperties: false }));
  await store.insertVersions([body, entity({ ...body, entityId: 'entity:0000000000000000002',
    typeId: null, containerId: null, systemId: null, fromId: null, toId: null })]);
  assert.equal(captured.length, 1);
  const call = captured[0];
  assert.ok(call);
  assert.match(call.sql, /jsonb_to_recordset/);
  assert.equal(call.values.length, 1);
  const encoded = call.values[0];
  assert.equal(typeof encoded, 'string');
  if (typeof encoded !== 'string') throw new Error('Expected encoded transport');
  const rows = parse(schema, JSON.parse(encoded), 'transport rows');
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.deepEqual(row, { versionId: hash(row.body), entityId: row.body.entityId, kind: row.body.kind,
      typeId: row.body.typeId, containerId: row.body.containerId, systemId: row.body.systemId,
      fromId: row.body.fromId, toId: row.body.toId, body: row.body });
  }
  assert.deepEqual(rows[0]?.body, body);
});
