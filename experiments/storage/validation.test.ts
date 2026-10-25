import test from 'node:test';
import assert from 'node:assert/strict';
import { Check } from 'typebox/value';
import { CommandSchema, EntitySchema, JsonSchema, JsonObjectSchema, parse, entity } from './contract.ts';

test('compiled cached boundaries agree with interpreted schemas on valid and rejected inputs', () => {
  const valid = entity({ entityId: 'wall-1', kind: 'wall', typeId: null, containerId: null, systemId: null,
    fromId: null, toId: null, document: { properties: { length: { state: 'known', value: 3, unit: 'm' },
      unknown: { state: 'unknown' }, absent: { state: 'not-applicable' }, cleared: { state: 'cleared', value: null } },
    payload: { bounds: [1, 2, 3, 4], text: '\\N\t\næøå', boolean: true } } });
  const candidates: unknown[] = [valid, { ...valid, extra: true }, { ...valid, kind: 3 }, { ...valid, entityId: '' },
    { ...valid, entityId: 'bad id' }, { ...valid, typeId: 4 }, { ...valid, document: null },
    { ...valid, document: { nested: undefined } }, { ...valid, document: { nested: { x: Number.NaN } } },
    { ...valid, document: { nested: [Number.POSITIVE_INFINITY] } }, { ...valid, document: { nested: () => 1 } },
    { ...valid, document: { nested: 1n } }, { ...valid, document: ['array'] }, null, undefined, 3, 'text', true,
    { state: 'unknown' }, { nested: [null, { deep: [false, 'x', 3] }] }, [1, 2], { properties: {} },
    { branch: 'diagnostic', commandId: 'valid-command', expectedHead: null,
      assumptions: [{ entityId: valid.entityId, versionId: null }], puts: [valid], deletes: [] }];
  for (const schema of [EntitySchema, JsonSchema, JsonObjectSchema, CommandSchema]) {
    for (const value of candidates) {
      const interpreted = Check(schema, value);
      let compiled = true;
      try { parse(schema, value, 'differential input'); } catch { compiled = false; }
      assert.equal(compiled, interpreted);
    }
  }
  assert.deepEqual(parse(EntitySchema, valid, 'entity'), valid);
  assert.equal(parse(EntitySchema, valid, 'entity'), valid);
});
