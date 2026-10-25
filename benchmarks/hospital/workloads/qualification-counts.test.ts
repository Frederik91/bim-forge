import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestKindCounts } from './qualification.ts';

test('empty catalog categories match an observed inventory with no rows in those categories', () => {
  const actual = { wall: 1, hostedBy: 1, 'parameter:dimension': 1 };
  assert.deepEqual(manifestKindCounts({ countsByKind: { wall: 1, unusedAsset: 0 },
    relationshipCounts: { hostedBy: 1, unusedRelation: 0 }, parameterForms: { dimension: 1, unusedInput: 0 } }), actual);
});

test('a missing nonempty catalog category still differs from the observed inventory', () => {
  const expected = manifestKindCounts({ countsByKind: { wall: 1 },
    relationshipCounts: { hostedBy: 2 }, parameterForms: { dimension: 3 } });
  assert.deepEqual(expected, { wall: 1, hostedBy: 2, 'parameter:dimension': 3 });
  assert.notDeepEqual(expected, { wall: 1, 'parameter:dimension': 3 });
});
