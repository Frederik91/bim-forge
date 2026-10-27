import test from 'node:test';
import assert from 'node:assert/strict';
import { entity, canonical, hash, parse, EntitySchema } from './contract.ts';
import { PreparedEntity, versionBatch } from './prepared.ts';
import { Fingerprint } from './load.ts';
import { Type } from 'typebox';

test('prepared bytes preserve canonical identity, Unicode, arrays and unknown property states', () => {
  const input = entity({ entityId: 'desk', kind: 'desk', typeId: null, containerId: null, systemId: null,
    fromId: null, toId: null, document: { z: [true, false, null, -0, 1e-8, 'æøå\t\n\\N'],
      properties: { unset: { state: 'unknown' }, explicit: { state: 'cleared', value: null },
        length: { value: 1.23, unit: 'm' }, external: { unfamiliar: ['kept', 1] } } } });
  const record = PreparedEntity.from(input);
  const rows = parse(Type.Array(Type.Object({ body: EntitySchema })), JSON.parse(versionBatch([record])), 'prepared body');
  assert.equal(record.versionId, hash(input));
  assert.equal(record.canonicalBytes, Buffer.byteLength(canonical(input)));
  assert.equal(record.propertyCount, 4);
  assert.deepEqual(rows[0]?.body, JSON.parse(JSON.stringify(input)));
  const raw = new Fingerprint(); raw.add(input);
  const prepared = new Fingerprint(); prepared.addPrepared(record);
  assert.deepEqual(prepared.value(), raw.value());
});

test('preparing a record owns its content even when the producer reuses the object', () => {
  const document = { properties: { length: 1 } };
  const input = entity({ entityId: 'desk', kind: 'desk', typeId: null, containerId: null, systemId: null,
    fromId: null, toId: null, document });
  const prepared = PreparedEntity.from(input);
  const version = prepared.versionId;
  const wire = prepared.wire;
  document.properties.length = 9;
  input.entityId = 'chair';
  assert.equal(prepared.entityId, 'desk');
  assert.equal(prepared.versionId, version);
  assert.equal(prepared.wire, wire);
  assert.notEqual(hash(input), version);
  assert.equal(Object.isFrozen(prepared), true);
});

test('preparation rejects malformed source envelopes before any SQL transport is built', () => {
  assert.throws(() => PreparedEntity.from({ entityId: 'desk' }), /Invalid storage entity/);
  assert.throws(() => PreparedEntity.from({ entityId: 'edge', kind: 'edge', typeId: null, containerId: null,
    systemId: null, fromId: 'desk', toId: null, document: {} }), /Both relationship endpoints/);
});
