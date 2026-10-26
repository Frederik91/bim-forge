import assert from 'node:assert/strict';
import test from 'node:test';
import { modelScopeFixture } from './model-scope-fixture.ts';
import { parseModelScopeQuery } from './model-scope-contract.ts';
import type { ModelScopePredicate, ModelScopeQuery } from './model-scope-contract.ts';
import { assertModelScopeFresh, assertModelScopeWrites, createModelScopeIndex, freezeModelScope,
  parseModelScopeIndex, resolveIndexedModelScope, resolveModelScope } from './model-scope.ts';
import { applyModelParameterEdits } from './model-parameters.ts';
import { diffSnapshots, validateSnapshot } from './room-model.ts';
import type { ModelGraph, ModelSnapshot } from './room-model.ts';
import { multiStoreySnapshot } from './multi-storey-house.ts';

const baseRevisionId = 'a'.repeat(64);
const query = (...allOf: ModelScopePredicate[]): ModelScopeQuery => ({ version: 1, allOf, anyOf: [], excludeIds: [] });
const ids = (...ids: string[]): ModelScopeQuery => query({ kind: 'ids', ids });
const deskQuery = (): ModelScopeQuery => query({ kind: 'furniture-kind', furnitureKind: 'desk' });
const changedName = (graph: ModelSnapshot, id: string, name: string): ModelSnapshot => validateSnapshot({ ...graph,
  entities: graph.entities.map((entity) => entity.id === id ? { ...entity, name } : entity) });

test('room and overlapping named group scopes compose AND, OR and exclusions deterministically', () => {
  const graph = modelScopeFixture();
  const selection = parseModelScopeQuery({ version: 1,
    allOf: [{ kind: 'entity-type', entityType: 'Furniture' }, { kind: 'on-levels', levelIds: ['level-ground'] }],
    anyOf: [{ kind: 'in-spaces', spaceIds: ['room-office'] }, { kind: 'in-spaces', spaceIds: ['room-living'] }], excludeIds: ['office-plant'] });
  const scope = resolveModelScope({ graph, query: selection });
  assert.deepEqual(scope.targetIds, ['living-plant', 'living-sofa', 'living-table', 'office-chair', 'office-desk', 'office-laptop', 'office-monitor']);
  assert.ok(!scope.writableIds.includes('dining-table'));
  const reverse: ModelGraph = { ...graph, entities: [...graph.entities].reverse(), relationships: [...graph.relationships].reverse() };
  assert.deepEqual(resolveModelScope({ graph: reverse, query: selection }), scope);
  assert.equal(JSON.stringify(graph), JSON.stringify(modelScopeFixture()));
});

test('room edit has an inspectable validated furniture delta and leaves other rooms unchanged', () => {
  const before = modelScopeFixture();
  const selection = query({ kind: 'in-spaces', spaceIds: ['room-office'] }, { kind: 'entity-type', entityType: 'Furniture' });
  const binding = freezeModelScope({ graph: before, query: selection, baseRevisionId });
  const after = changedName(before, 'office-plant', 'Reviewed office plant');
  assertModelScopeWrites({ before, after, binding });
  assert.deepEqual(diffSnapshots(before, after).entities.modified.map((entry) => ({ id: entry.id, before: entry.before.name, after: entry.after.name })),
    [{ id: 'office-plant', before: 'Office plant', after: 'Reviewed office plant' }]);
  assert.deepEqual(before.entities.find((entity) => entity.id === 'living-sofa'), after.entities.find((entity) => entity.id === 'living-sofa'));
});

test('desk support closure uses actual support edges and never invents a workstation selection', () => {
  const before = modelScopeFixture();
  const binding = freezeModelScope({ graph: before, query: ids('office-desk'), baseRevisionId });
  assert.deepEqual(binding.targetIds, ['office-desk']);
  assert.deepEqual(binding.dependentIds, ['office-laptop', 'office-monitor']);
  assert.deepEqual(binding.writableIds, ['office-desk', 'office-laptop', 'office-monitor']);
  assert.ok(binding.contextIds.includes('office-chair'));
  assert.ok(binding.contextIds.includes('room-kitchen'));
  assert.ok(!binding.writableIds.includes('room-office'));
  const after = validateSnapshot({ ...before, entities: before.entities.map((entity) => entity.type === 'Furniture' && binding.writableIds.includes(entity.id)
    ? { ...entity, position: [entity.position[0] + .1, entity.position[1] + .1] } : entity) });
  assertModelScopeWrites({ before, after, binding });
  assert.equal(diffSnapshots(before, after).entities.modified.length, 3);
  assert.throws(() => assertModelScopeWrites({ before, after: changedName(before, 'office-chair', 'Unreviewed chair'), binding }), /Out-of-scope entity/);
});

test('selecting a supported device keeps its support read-only', () => {
  const graph = modelScopeFixture(); const scope = resolveModelScope({ graph, query: ids('office-monitor') });
  assert.deepEqual(scope.writableIds, ['office-monitor']);
  assert.ok(scope.contextIds.includes('office-desk'));
  assert.ok(!scope.dependentIds.includes('office-chair'));
});

test('host traversal works in both directions and wall selection permits only hosted dependents', () => {
  const graph = modelScopeFixture();
  assert.deepEqual(resolveModelScope({ graph, query: query({ kind: 'related', relation: 'hosted-by', direction: 'outgoing', fromIds: ['window-office'], depth: 1 }) }).targetIds, ['wall-east']);
  assert.deepEqual(resolveModelScope({ graph, query: query({ kind: 'related', relation: 'hosted-by', direction: 'incoming', fromIds: ['wall-east'], depth: 1 }) }).targetIds, ['window-office']);
  const wall = resolveModelScope({ graph, query: ids('wall-east') });
  assert.deepEqual(wall.writableIds, ['wall-east', 'window-office']);
  const opening = resolveModelScope({ graph, query: ids('window-office') });
  assert.deepEqual(opening.writableIds, ['window-office']);
  assert.ok(opening.contextIds.includes('wall-east'));
  assert.ok(opening.relationshipIds.includes('host-window-office'));
});

test('support, family and containment traversal has forward/inverse and bounded depth semantics', () => {
  const graph = modelScopeFixture();
  const related = (relation: Extract<ModelScopePredicate, { kind: 'related' }>['relation'], direction: 'incoming' | 'outgoing' | 'either', from: string, depth = 1) =>
    resolveModelScope({ graph, query: query({ kind: 'related', relation, direction, fromIds: [from], depth }) }).targetIds;
  assert.deepEqual(related('supported-by', 'incoming', 'office-desk'), ['office-laptop', 'office-monitor']);
  assert.deepEqual(related('supported-by', 'outgoing', 'office-monitor'), ['office-desk']);
  assert.deepEqual(related('instance-of', 'outgoing', 'living-person'), ['standing-person']);
  assert.deepEqual(related('instance-of', 'incoming', 'standing-person'), ['bedroom-person', 'living-person']);
  assert.ok(related('contained-in', 'outgoing', 'office-desk').includes('room-office'));
  assert.ok(related('contained-in', 'incoming', 'room-office').includes('office-desk'));
  assert.ok(related('contained-in', 'either', 'room-office', 2).includes('level-ground'));
  assert.throws(() => parseModelScopeQuery(query({ kind: 'related', relation: 'contained-in', direction: 'outgoing', fromIds: ['office-desk'], depth: 9 })), /scope requires/);
});

test('cyclic indexed relations terminate without selecting the origin through a cycle', () => {
  const graph = modelScopeFixture(); const index = createModelScopeIndex(graph);
  index.edges.push({ id: null, relation: 'supported-by', source: 'office-desk', target: 'office-monitor' });
  const parsed = parseModelScopeIndex(index);
  const scope = resolveIndexedModelScope({ index: parsed, query: query({ kind: 'related', relation: 'supported-by', direction: 'either', fromIds: ['office-desk'], depth: 8 }) });
  assert.deepEqual(scope.targetIds, ['office-laptop', 'office-monitor']);
  assert.ok(scope.contextIds.includes('room-office'));
});

test('building-wide shared family and typed unit filters select occurrences, never the definition', () => {
  const before = modelScopeFixture();
  const selection = query({ kind: 'asset-family', familyId: 'standing-person' },
    { kind: 'parameter-compare', definitionId: 'geometry-height', operator: 'eq', value: { kind: 'length', value: 1870, unit: 'mm' } });
  const binding = freezeModelScope({ graph: before, query: selection, baseRevisionId });
  assert.deepEqual(binding.targetIds, ['bedroom-person', 'living-person']);
  assert.ok(binding.contextIds.includes('standing-person'));
  assert.ok(!binding.writableIds.includes('standing-person'));
  const after = applyModelParameterEdits({ snapshot: before, targetIds: binding.targetIds,
    edits: [{ definitionId: 'geometry-height', name: 'height', value: { kind: 'length', value: 1650, unit: 'mm' } }] });
  assertModelScopeWrites({ before, after, binding });
  assert.deepEqual(diffSnapshots(before, after).entities.modified.map((entry) => entry.id), ['bedroom-person', 'living-person']);
  assert.deepEqual(before.entities.find((entity) => entity.id === 'standing-person'), after.entities.find((entity) => entity.id === 'standing-person'));
  assert.throws(() => assertModelScopeWrites({ before, after: changedName(before, 'standing-person', 'Unreviewed family'), binding }), /Out-of-scope/);
});

test('family dependencies cannot grant sibling writes to a selected occurrence', () => {
  const graph = modelScopeFixture(); const scope = resolveModelScope({ graph, query: ids('living-person') });
  assert.ok(scope.contextIds.includes('standing-person'));
  assert.deepEqual(scope.writableIds, ['living-person']);
  const selectedFamily = resolveModelScope({ graph, query: ids('standing-person') });
  assert.deepEqual(selectedFamily.dependentIds, ['bedroom-person', 'living-person']);
});

test('length and duration comparison normalize units, text and booleans support only equality', () => {
  const graph = modelScopeFixture();
  const compare = (definitionId: string, value: Extract<ModelScopePredicate, { kind: 'parameter-compare' }>['value'], operator: 'eq' | 'gte' = 'eq') =>
    resolveModelScope({ graph, query: query({ kind: 'parameter-compare', definitionId, operator, value }) }).targetIds;
  assert.deepEqual(compare('service-interval', { kind: 'duration', value: 7200, unit: 's' }), ['office-desk']);
  assert.deepEqual(compare('service-interval', { kind: 'duration', value: 120, unit: 'min' }), ['office-desk']);
  assert.deepEqual(compare('work-group', { kind: 'text', value: 'design' }), ['office-desk']);
  assert.ok(compare('geometry-width', { kind: 'length', value: 350, unit: 'mm' }).includes('office-laptop'));
  assert.deepEqual(compare('service-interval', { kind: 'duration', value: 1, unit: 'h' }, 'gte'), ['office-desk']);
  assert.deepEqual(resolveModelScope({ graph, query: query({ kind: 'parameter-kind', valueKind: 'duration' }) }).targetIds, ['office-desk']);
  assert.deepEqual(resolveModelScope({ graph, query: query({ kind: 'parameter-exists', definitionId: 'work-group' }) }).targetIds, ['office-desk']);
  assert.throws(() => compare('geometry-height', { kind: 'duration', value: 1, unit: 'h' }), /kind or units/);
  assert.throws(() => compare('work-group', { kind: 'text', value: 'design' }, 'gte'), /Ordered/);
  assert.throws(() => compare('approval', { kind: 'boolean', value: true }, 'gte'), /Ordered/);
  assert.throws(() => parseModelScopeQuery({ version: 1, anyOf: [], excludeIds: [], allOf: [{ kind: 'parameter-compare', definitionId: 'geometry-height', operator: 'eq', value: { kind: 'length', value: 1, unit: 'feet' } }] }), /scope requires/);
});

test('unknown kinds and missing or wrong-type IDs fail instead of silently returning an empty scope', () => {
  const graph = modelScopeFixture();
  const invalid: ModelScopePredicate[] = [
    { kind: 'entity-type', entityType: 'Workstation' }, { kind: 'furniture-kind', furnitureKind: 'workstation' },
    { kind: 'ids', ids: ['missing'] }, { kind: 'in-spaces', spaceIds: ['missing'] }, { kind: 'in-spaces', spaceIds: ['office-desk'] },
    { kind: 'on-levels', levelIds: ['missing'] }, { kind: 'on-levels', levelIds: ['room-office'] },
    { kind: 'asset-family', familyId: 'missing' }, { kind: 'asset-family', familyId: 'office-desk' },
    { kind: 'related', relation: 'supported-by', fromIds: ['missing'], direction: 'incoming', depth: 1 },
    { kind: 'bounds', bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mode: 'intersects', levelIds: ['room-office'] },
  ];
  for (const predicate of invalid) assert.throws(() => resolveModelScope({ graph, query: query(predicate) }), /Unknown|wrong-type/);
  assert.throws(() => resolveModelScope({ graph, query: { ...ids('office-desk'), excludeIds: ['missing'] } }), /Unknown/);
  assert.deepEqual(resolveModelScope({ graph, query: query({ kind: 'furniture-kind', furnitureKind: 'plant' }, { kind: 'in-spaces', spaceIds: ['room-office'] }) }).targetIds, ['office-plant']);
});

test('bounds are observed membership, skip nonspatial families and do not constrain reviewed writes', () => {
  const before = modelScopeFixture();
  const selection = query({ kind: 'furniture-kind', furnitureKind: 'plant' },
    { kind: 'bounds', bounds: { minX: 11.2, minY: 3, maxX: 11.8, maxY: 3.6 }, mode: 'contained', levelIds: ['level-ground'] });
  const binding = freezeModelScope({ graph: before, query: selection, baseRevisionId });
  assert.deepEqual(binding.targetIds, ['office-plant']);
  const after = validateSnapshot({ ...before, entities: before.entities.map((entity) => entity.id === 'office-plant' ? { ...entity, position: [11.5, 2.5] } : entity) });
  assertModelScopeWrites({ before, after, binding });
  assert.deepEqual(resolveModelScope({ graph: after, query: selection }).targetIds, []);
  const allBounds = resolveModelScope({ graph: before, query: query({ kind: 'bounds', bounds: { minX: -1, minY: -1, maxX: 20, maxY: 20 }, mode: 'intersects', levelIds: [] }) });
  assert.ok(!allBounds.targetIds.includes('standing-person'));
  assert.ok(!allBounds.targetIds.includes('level-ground'));
});

test('level-aware observations distinguish coincident floors and incident stairs', () => {
  const graph = multiStoreySnapshot();
  const scope = resolveModelScope({ graph, query: query({ kind: 'bounds', bounds: { minX: .5, minY: 4, maxX: 1.5, maxY: 5.5 }, mode: 'intersects', levelIds: ['level-attic'] }, { kind: 'entity-type', entityType: 'Furniture' }) });
  assert.deepEqual(scope.targetIds, ['level-attic-plant']);
  const upstairs = resolveModelScope({ graph, query: query({ kind: 'on-levels', levelIds: ['level-attic'] }) });
  assert.ok(upstairs.targetIds.includes('stair-ground-attic'));
  assert.ok(!upstairs.targetIds.includes('level-basement-plant'));
});

test('freshness preserves unrelated accepted edits on the same level and rejects new matches', () => {
  const base = modelScopeFixture(); const binding = freezeModelScope({ graph: base, query: deskQuery(), baseRevisionId });
  const current = changedName(base, 'living-sofa', 'Accepted independent sofa label');
  assertModelScopeFresh({ base, current, binding });
  const newMatch = validateSnapshot({ ...current, entities: current.entities.map((entity) => entity.id === 'dining-table' ? { ...entity, kind: 'desk' } : entity) });
  assert.throws(() => assertModelScopeFresh({ base, current: newMatch, binding }), /membership/);
});

test('freshness rejects relevant context, family recipe and relationship body changes exactly', () => {
  const base = modelScopeFixture();
  const deskBinding = freezeModelScope({ graph: base, query: ids('office-desk'), baseRevisionId });
  assert.throws(() => assertModelScopeFresh({ base, current: changedName(base, 'office-chair', 'Changed collision object'), binding: deskBinding }), /relevant entity/);
  const familyBinding = freezeModelScope({ graph: base, query: ids('living-person'), baseRevisionId });
  const recipe = validateSnapshot({ ...base, entities: base.entities.map((entity) => entity.type === 'AssetFamily'
    ? { ...entity, parts: entity.parts.map((part) => ({ ...part, color: '#112233' })) } : entity) });
  assert.throws(() => assertModelScopeFresh({ base, current: recipe, binding: familyBinding }), /relevant entity/);
  const hostBinding = freezeModelScope({ graph: base, query: ids('window-office'), baseRevisionId });
  const shifted = validateSnapshot({ ...base, relationships: base.relationships.map((edge) => edge.id === 'host-window-office' ? { ...edge, offset: edge.offset + .1 } : edge) });
  assert.throws(() => assertModelScopeFresh({ base, current: shifted, binding: hostBinding }), /relevant relationship|dependencies/);
});

test('exact freshness refuses distinct context labels even when their 32-bit hashes collide', () => {
  const hash = (text: string): number => { let result = 2166136261; for (const char of text) result = Math.imul(result ^ char.charCodeAt(0), 16777619); return result >>> 0; };
  assert.equal(hash('costarring'), hash('liquid'));
  const base = changedName(modelScopeFixture(), 'office-chair', 'costarring');
  const binding = freezeModelScope({ graph: base, query: ids('office-desk'), baseRevisionId });
  assert.throws(() => assertModelScopeFresh({ base, current: changedName(base, 'office-chair', 'liquid'), binding }), /relevant entity/);
});

test('membership changes in a parameter query and new collision neighbors invalidate frozen evidence', () => {
  const base = modelScopeFixture();
  const binding = freezeModelScope({ graph: base, query: query({ kind: 'parameter-exists', definitionId: 'work-group' }), baseRevisionId });
  const current = applyModelParameterEdits({ snapshot: base, targetIds: ['living-sofa'], edits: [{ definitionId: 'work-group', name: 'Work group', value: { kind: 'text', value: 'design' } }] });
  assert.throws(() => assertModelScopeFresh({ base, current, binding }), /membership/);
  const added = validateSnapshot({ ...base, entities: [...base.entities, { id: 'office-new-plant', type: 'Furniture', name: 'New collision context', kind: 'plant', position: [11.5, 2.4], width: .3, depth: .3, height: .5, rotationDeg: 0, supportId: null }] });
  assert.throws(() => assertModelScopeFresh({ base, current: added, binding }), /membership|dependencies/);
});

test('forged targets, context authority, stale arrays and unknown relationship writes are rejected', () => {
  const before = modelScopeFixture(); const binding = freezeModelScope({ graph: before, query: ids('office-desk'), baseRevisionId });
  const forged = { ...binding, writableIds: [...binding.writableIds, 'living-sofa'] };
  assert.throws(() => assertModelScopeFresh({ base: before, current: before, binding: forged }), /forged/);
  assert.throws(() => assertModelScopeWrites({ before, after: changedName(before, 'living-sofa', 'Forged write'), binding: forged }), /forged/);
  assert.throws(() => assertModelScopeWrites({ before, after: changedName(before, 'room-office', 'Read context write'), binding }), /Out-of-scope/);
  assert.throws(() => assertModelScopeFresh({ base: before, current: before, binding: { ...binding, targetIds: [] } }), /forged/);
  const hostBinding = freezeModelScope({ graph: before, query: ids('window-office'), baseRevisionId });
  const moved = validateSnapshot({ ...before, relationships: before.relationships.map((edge) => edge.id === 'host-window-office' ? { ...edge, offset: edge.offset + .1 } : edge) });
  assertModelScopeWrites({ before, after: moved, binding: hostBinding });
  assert.throws(() => assertModelScopeWrites({ before, after: moved, binding }), /Out-of-scope relationship/);
  const removed = validateSnapshot({ ...before, entities: before.entities.filter((entity) => entity.id !== 'living-sofa') });
  assert.throws(() => assertModelScopeWrites({ before, after: removed, binding }), /Out-of-scope entity/);
});

test('compact index is JSON-safe, contains no source bodies or recipes and shares graph semantics for every selector', () => {
  const graph = modelScopeFixture(); const index = createModelScopeIndex(graph); const bytes = JSON.stringify(index);
  assert.ok(!bytes.includes('torso')); assert.ok(!bytes.includes('description')); assert.ok(!bytes.includes('sourceEntity')); assert.ok(!bytes.includes('"position"'));
  const restored = parseModelScopeIndex(JSON.parse(bytes));
  const predicates: ModelScopePredicate[] = [
    { kind: 'all' }, { kind: 'ids', ids: ['office-desk'] }, { kind: 'in-spaces', spaceIds: ['room-office'] },
    { kind: 'on-levels', levelIds: ['level-ground'] }, { kind: 'entity-type', entityType: 'AssetInstance' },
    { kind: 'furniture-kind', furnitureKind: 'plant' }, { kind: 'asset-family', familyId: 'standing-person' },
    { kind: 'parameter-exists', definitionId: 'work-group' }, { kind: 'parameter-kind', valueKind: 'length' },
    { kind: 'parameter-compare', definitionId: 'geometry-height', operator: 'gte', value: { kind: 'length', value: 1000, unit: 'mm' } },
    { kind: 'bounds', bounds: { minX: 9, minY: 0, maxX: 12, maxY: 4 }, mode: 'intersects', levelIds: [] },
    { kind: 'related', relation: 'supported-by', direction: 'incoming', fromIds: ['office-desk'], depth: 2 },
    { kind: 'related', relation: 'hosted-by', direction: 'outgoing', fromIds: ['window-office'], depth: 1 },
    { kind: 'related', relation: 'instance-of', direction: 'incoming', fromIds: ['standing-person'], depth: 1 },
    { kind: 'related', relation: 'contained-in', direction: 'outgoing', fromIds: ['office-desk'], depth: 2 },
  ];
  for (const predicate of predicates) assert.deepEqual(resolveIndexedModelScope({ index: restored, query: query(predicate) }), resolveModelScope({ graph, query: query(predicate) }));
  assert.equal(bytes, JSON.stringify(index));
});

test('index parser rejects bodies, accessors, unknown kinds, duplicate IDs and malformed references without executing code', () => {
  const index = createModelScopeIndex(modelScopeFixture()); const first = index.entities[0]; assert.ok(first);
  assert.throws(() => parseModelScopeIndex({ ...index, entities: [...index.entities, first] }), /Duplicate/);
  assert.throws(() => parseModelScopeIndex({ ...index, entities: index.entities.map((entity) => ({ ...entity, recipe: 'forbidden' })) }), /Invalid/);
  assert.throws(() => parseModelScopeIndex({ ...index, edges: [...index.edges, { id: null, relation: 'supported-by', source: 'missing', target: 'office-desk' }] }), /dangling/);
  assert.throws(() => parseModelScopeIndex({ ...index, entities: index.entities.map((entity) => entity.type === 'AssetInstance' ? { ...entity, familyId: 'office-desk' } : entity) }), /family reference/);
  assert.throws(() => parseModelScopeIndex({ ...index, entities: index.entities.map((entity) => ({ ...entity, type: 'Unknown' })) }), /Invalid/);
  let called = false;
  const hostileRoot = Object.defineProperty({ version: 1, edges: [] }, 'entities', { enumerable: true, get() { called = true; return []; } });
  assert.throws(() => parseModelScopeIndex(hostileRoot), /accessors/);
  const hostileRecord = Object.defineProperty({ ...first }, 'type', { enumerable: true, get() { called = true; return 'Furniture'; } });
  assert.throws(() => parseModelScopeIndex({ ...index, entities: [hostileRecord] }), /accessors/);
  const hostileArray = Object.defineProperty([], '0', { enumerable: true, get() { called = true; return first; } });
  assert.throws(() => parseModelScopeIndex({ ...index, entities: hostileArray }), /accessors/);
  assert.equal(called, false);
});
