import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrozenModelScope, parseModelScopeQuery, parseScopedRequest } from './model-scope-contract.ts';

test('combined scope filters preserve unit-bearing parameter identity and copy caller data', () => {
  const input = { version: 1, allOf: [{ kind: 'on-levels', levelIds: ['level-ground'] },
    { kind: 'parameter-compare', definitionId: 'geometry-height', operator: 'gte', value: { kind: 'length', value: 1800, unit: 'mm' } }],
  anyOf: [{ kind: 'furniture-kind', furnitureKind: 'desk' }, { kind: 'asset-family', familyId: 'office-desk-family' }], excludeIds: ['retained-desk'] };
  const query = parseModelScopeQuery(input);
  assert.deepEqual(query, input);
  input.excludeIds.push('another-desk');
  assert.deepEqual(query.excludeIds, ['retained-desk']);
  assert.deepEqual(parseScopedRequest({ query, savedScopeId: 'east-wing' }), { query, savedScopeId: 'east-wing' });
});

test('scope boundaries refuse implicit global access, unknown fields, malformed bounds and units', () => {
  const query = { version: 1, allOf: [{ kind: 'all' }], anyOf: [], excludeIds: [] };
  for (const invalid of [ { ...query, allOf: [] }, { ...query, authority: 'all' },
    { ...query, allOf: [{ kind: 'bounds', bounds: { minX: 3, minY: 0, maxX: 2, maxY: 1 }, levelIds: [], mode: 'contained' }] },
    { ...query, allOf: [{ kind: 'parameter-compare', definitionId: 'geometry-height', operator: 'gt', value: { kind: 'length', value: 2, unit: 'seconds' } }] },
    { ...query, excludeIds: ['one', 'one'] }, { ...query, anyOf: Array.from({length: 17}, () => ({kind: 'all'})) } ]) {
    assert.throws(() => parseModelScopeQuery(invalid));
  }
  assert.throws(() => parseScopedRequest({query, savedScopeId: 'invalid id'}));
});

test('query and frozen evidence parsers never evaluate accessor data', () => {
  let reads = 0;
  const input = { get version() { reads++; return 1; }, allOf: [{kind:'all'}], anyOf: [], excludeIds: [] };
  assert.throws(() => parseModelScopeQuery(input));
  assert.throws(() => parseScopedRequest({query: input}));
  assert.throws(() => parseFrozenModelScope(input));
  assert.equal(reads, 0);
});

test('frozen evidence retains exact revision and distinct target/context/write identities', () => {
  const query = parseModelScopeQuery({version:1,allOf:[{kind:'ids',ids:['desk']}],anyOf:[],excludeIds:[]});
  const input = {version:1,baseRevisionId:'a'.repeat(64),query,targetIds:['desk'],contextIds:['room','family'],
    dependentIds:['monitor'],writableIds:['desk','monitor'],relationshipIds:[]};
  assert.deepEqual(parseFrozenModelScope(input), input);
  assert.throws(() => parseFrozenModelScope({...input, baseRevisionId: 'not-a-revision'}));
});
