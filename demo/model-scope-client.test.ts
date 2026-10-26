import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelScopeClient, parameterKinds, parameterUnits, parseParameterValue, parseScopeQuery, renderScopeEvidence, requestScopeContext, reviewScopeContext } from './model-scope-client.ts';
import type { FrozenModelScope, ModelScopeQuery, SavedModelScope } from '../src/model-scope-contract.ts';

const projectId = '909e934f-6c29-4bbd-8cc2-633a171a1750';
const baseRevisionId = 'a'.repeat(64);
const query: ModelScopeQuery = { version: 1, allOf: [{ kind: 'furniture-kind', furnitureKind: 'desk' }], anyOf: [], excludeIds: [] };
const scope: FrozenModelScope = { version: 1, baseRevisionId, query, targetIds: ['desk-one'], contextIds: ['room-one'],
  dependentIds: ['monitor-one'], writableIds: ['desk-one', 'monitor-one'], relationshipIds: [] };
const graph = { units: 'm', version: 2, entities: [
  { id: 'desk-one', type: 'Furniture', name: 'Desk <b>one</b>', kind: 'desk' },
  { id: 'monitor-one', type: 'Furniture', name: 'Monitor', kind: 'monitor' },
  { id: 'room-one', type: 'Space', name: 'Office' },
], relationships: [] };
const saved: SavedModelScope = { id: 'office-desks', name: 'Office desks', query, version: 'b'.repeat(64), recordedAt: 123 };

test('default scope fetch keeps the real browser global receiver and uses bounded uncached requests', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async function(this: unknown, input: Parameters<typeof fetch>[0], options?: RequestInit) {
    assert.equal(this, globalThis); assert.equal(options?.cache, 'no-store'); assert.ok(options?.signal);
    calls.push(String(input)); return Response.json({ scopes: [] });
  });
  assert.deepEqual(await new ModelScopeClient().list(projectId), []);
  assert.deepEqual(calls, [`/api/projects/${projectId}/scopes`]);
});

test('preview reads partial display identities without restoring a complete project or mutating its input', async () => {
  const original = JSON.stringify({ scope, graph });
  const client = new ModelScopeClient(async (path, options) => {
    assert.equal(String(path), `/api/projects/${projectId}/scope-preview`);
    assert.equal(options?.method, 'POST'); assert.deepEqual(JSON.parse(String(options.body)), { baseRevisionId, query });
    return Response.json({ scope, graph });
  });
  const result = await client.preview({ projectId, baseRevisionId, query });
  assert.deepEqual(result.scope, scope);
  assert.deepEqual(result.identities[0], { id: 'desk-one', type: 'Furniture', name: 'Desk <b>one</b>' });
  assert.equal('project' in result, false); assert.equal('serialize' in result, false);
  assert.equal(JSON.stringify({ scope, graph }), original);
});

test('project identities cannot escape the fixed project route and invalid inputs never fetch', async () => {
  let calls = 0; const client = new ModelScopeClient(async () => { calls++; return Response.json({ scopes: [] }); });
  for (const id of ['../other-project', 'project/other', '', 'project?x=1', 'project#other']) await assert.rejects(client.list(id), /identity/);
  await assert.rejects(client.preview({ projectId, baseRevisionId: 'bad', query }), /revision/);
  await assert.rejects(client.preview({ projectId, baseRevisionId, query: { ...query, allOf: [] } }), /scope/);
  assert.equal(calls, 0);
});

test('preview refuses a response from a different base or query', async () => {
  for (const altered of [{ ...scope, baseRevisionId: 'c'.repeat(64) }, { ...scope, query: { ...query, excludeIds: ['desk-one'] } }]) {
    const client = new ModelScopeClient(async () => Response.json({ scope: altered, graph }));
    await assert.rejects(client.preview({ projectId, baseRevisionId, query }), /revision or query/);
  }
});

test('preview membership must exist in the partial graph with unique identities and bounded write authority', async () => {
  const invalid = [
    { scope: { ...scope, targetIds: ['missing'] }, graph },
    { scope: { ...scope, contextIds: ['missing'] }, graph },
    { scope: { ...scope, dependentIds: ['missing'] }, graph },
    { scope: { ...scope, writableIds: ['room-one'] }, graph },
    { scope: { ...scope, contextIds: ['desk-one'] }, graph },
    { scope: { ...scope, relationshipIds: ['missing'] }, graph },
    { scope, graph: { ...graph, entities: [...graph.entities, graph.entities[0]] } },
    { scope, graph: { ...graph, entities: graph.entities.slice(1) } },
  ];
  for (const result of invalid) {
    const client = new ModelScopeClient(async () => Response.json(result));
    await assert.rejects(client.preview({ projectId, baseRevisionId, query }), /membership/);
  }
});

test('preview refuses malformed graph and frozen evidence while an empty target preview stays explicit', async () => {
  for (const result of [{ scope, graph: { ...graph, units: 'mm' } }, { scope: { ...scope, targetIds: ['UPPERCASE'] }, graph }]) {
    await assert.rejects(new ModelScopeClient(async () => Response.json(result)).preview({ projectId, baseRevisionId, query }));
  }
  const empty = await new ModelScopeClient(async () => Response.json({ scope: { ...scope, targetIds: [], dependentIds: [], writableIds: [] }, graph })).preview({ projectId, baseRevisionId, query });
  assert.deepEqual(empty.scope.targetIds, []);
});

test('list and save roundtrip the exact query and CAS version on the project-scoped routes', async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const client = new ModelScopeClient(async (path, options) => {
    calls.push({ path: String(path), body: options?.body ? JSON.parse(String(options.body)) : null });
    return Response.json(options?.method === 'POST' ? { scope: saved } : { scopes: [saved] });
  });
  assert.deepEqual(await client.list(projectId), [saved]);
  assert.deepEqual(await client.save({ projectId, id: saved.id, name: saved.name, query, expectedVersion: null }), saved);
  assert.deepEqual(await client.save({ projectId, id: saved.id, name: saved.name, query, expectedVersion: saved.version }), saved);
  assert.deepEqual(calls, [
    { path: `/api/projects/${projectId}/scopes`, body: null },
    { path: `/api/projects/${projectId}/scopes`, body: { id: saved.id, name: saved.name, expectedVersion: null, query } },
    { path: `/api/projects/${projectId}/scopes`, body: { id: saved.id, name: saved.name, expectedVersion: saved.version, query } },
  ]);
});

test('saved-scope conflicts and unreadable/server/network failures preserve the caller query and selection', async () => {
  const selectedIds = ['desk-one']; const before = JSON.stringify({ query, selectedIds });
  const failures: Array<() => Response> = [() => Response.json({ error: 'CAS conflict' }, { status: 409 }),
    () => Response.json({ error: 'unavailable' }, { status: 503 }), () => new Response('not JSON'),
    () => { throw new Error('disconnected'); }];
  for (const failure of failures) {
    await assert.rejects(new ModelScopeClient(async () => failure()).save({ projectId, id: saved.id, name: saved.name, query, expectedVersion: saved.version }));
    assert.equal(JSON.stringify({ query, selectedIds }), before);
  }
});

test('saved scope version, query identity, names and duplicate list identities are validated', async () => {
  for (const response of [{ scope: { ...saved, version: 'bad' } }, { scope: { ...saved, id: 'other' } },
    { scope: { ...saved, name: 'different' } }, { scope: { ...saved, query: { ...query, excludeIds: ['desk-one'] } } }]) {
    await assert.rejects(new ModelScopeClient(async () => Response.json(response)).save({ projectId, id: saved.id, name: saved.name, query, expectedVersion: null }));
  }
  for (const response of [{ scopes: [saved, saved] }, { scopes: [{ ...saved, version: 'invalid' }] }]) await assert.rejects(new ModelScopeClient(async () => Response.json(response)).list(projectId));
  let fetched = false; const client = new ModelScopeClient(async () => { fetched = true; return Response.json({ scope: saved }); });
  await assert.rejects(client.save({ projectId, id: saved.id, name: saved.name, query, expectedVersion: 'invalid' }));
  assert.equal(fetched, false);
});

test('entity kinds and furniture kinds use distinct semantic domains', () => {
  assert.deepEqual(parseScopeQuery({ ...query, allOf: [{ kind: 'entity-type', entityType: 'Furniture' }] }).allOf, [{ kind: 'entity-type', entityType: 'Furniture' }]);
  assert.throws(() => parseScopeQuery({ ...query, allOf: [{ kind: 'entity-type', entityType: 'desk' }] }), /Unknown entity type/);
  assert.throws(() => parseScopeQuery({ ...query, allOf: [{ kind: 'furniture-kind', furnitureKind: 'Furniture' }] }), /Unknown furniture kind/);
  assert.throws(() => parseScopeQuery({ ...query, allOf: [{ kind: 'furniture-kind', furnitureKind: 'invented-kind' }] }), /Unknown furniture kind/);
});

test('all/any/exclusion, bounds and relation filters retain their shared wire shapes', () => {
  const composed: ModelScopeQuery = { version: 1, allOf: [{ kind: 'in-spaces', spaceIds: ['office'] },
    { kind: 'bounds', levelIds: ['ground'], mode: 'contained', bounds: { minX: 0, minY: 0, maxX: 4, maxY: 5 } }],
    anyOf: [{ kind: 'related', fromIds: ['desk-one'], relation: 'supported-by', direction: 'incoming', depth: 2 },
      { kind: 'parameter-exists', definitionId: 'fire-rating' }], excludeIds: ['desk-two'] };
  assert.deepEqual(parseScopeQuery(composed), composed);
  assert.throws(() => parseScopeQuery({ ...composed, allOf: [{ kind: 'bounds', levelIds: [], mode: 'contained', bounds: { minX: 4, minY: 0, maxX: 4, maxY: 5 } }] }), /positive area/);
});

test('parameter controls derive kinds and valid units from the shared TypeBox schema', () => {
  assert.deepEqual(parameterKinds(), ['length', 'angle', 'duration', 'number', 'text', 'boolean']);
  assert.deepEqual(parameterUnits('length'), ['m', 'mm']); assert.deepEqual(parameterUnits('duration'), ['s', 'min', 'h']);
  assert.deepEqual(parameterUnits('angle'), ['deg']); assert.deepEqual(parameterUnits('number'), []);
  assert.deepEqual(parseParameterValue({ kind: 'length', value: '1200', unit: 'mm' }), { kind: 'length', value: 1200, unit: 'mm' });
  assert.deepEqual(parseParameterValue({ kind: 'duration', value: '60', unit: 'min' }), { kind: 'duration', value: 60, unit: 'min' });
  assert.deepEqual(parseParameterValue({ kind: 'boolean', value: 'false', unit: '' }), { kind: 'boolean', value: false });
  assert.deepEqual(parseParameterValue({ kind: 'text', value: '<img src=x onerror=alert(1)>', unit: '' }), { kind: 'text', value: '<img src=x onerror=alert(1)>' });
  for (const value of ['', 'NaN', 'Infinity', 'not a number']) assert.throws(() => parseParameterValue({ kind: 'number', value, unit: '' }));
  assert.throws(() => parseParameterValue({ kind: 'length', value: '12', unit: 'deg' }));
  assert.throws(() => parseParameterValue({ kind: 'boolean', value: 'maybe', unit: '' }));
});

test('frozen review evidence distinguishes exact membership, read-only context and writable dependents as safe DOM text', () => {
  const host = { textContent: '', hidden: true };
  const malicious = '<img src=x onerror=alert(1)>';
  const frozen = { ...scope, query: { ...query, allOf: [{ kind: 'parameter-compare', definitionId: 'fire-rating', operator: 'eq', value: { kind: 'text', value: malicious } }] } } satisfies FrozenModelScope;
  renderScopeEvidence(host, frozen);
  assert.equal(host.hidden, false);
  assert.match(host.textContent, /Targets \(1\): desk-one/);
  assert.match(host.textContent, /Read-only context \(1\): room-one/);
  assert.match(host.textContent, /Dependents \(1\): monitor-one/);
  assert.match(host.textContent, /Writable \(2\): desk-one, monitor-one/);
  assert.ok(host.textContent.includes(malicious)); assert.match(host.textContent, /no write approval/);
  assert.match(host.textContent, /New matches never join/); assert.ok(host.textContent.includes(JSON.stringify(frozen.query)));
  assert.deepEqual(Object.keys(host).sort(), ['hidden', 'textContent']);
  renderScopeEvidence(host); assert.deepEqual(host, { textContent: '', hidden: true });
});

test('optional scope stays absent for legacy requests and frozen review evidence is copied independently', () => {
  assert.deepEqual(requestScopeContext({}), {}); assert.deepEqual(reviewScopeContext({}), {});
  const scoped = { query, savedScopeId: saved.id };
  assert.deepEqual(requestScopeContext({ scope: scoped }), { scope: scoped });
  const review = reviewScopeContext({ scope }); assert.deepEqual(review, { scope });
  assert.notEqual(review.scope, scope); assert.notEqual(review.scope?.query, scope.query);
  assert.throws(() => requestScopeContext({ scope: null })); assert.throws(() => reviewScopeContext({ scope: scoped }));
});

test('shared descriptor-only scope boundary rejects accessors without invoking them', () => {
  let calls = 0;
  const getter = { get scope() { calls++; return scope; } };
  assert.throws(() => reviewScopeContext(getter), /plain JSON/); assert.equal(calls, 0);
  assert.throws(() => requestScopeContext(getter), /plain JSON/); assert.equal(calls, 0);
  assert.throws(() => parseParameterValue({ get kind() { calls++; return 'length'; }, value: '100', unit: 'mm' }));
  assert.equal(calls, 0);
  assert.throws(() => parseScopeQuery({ ...query, get allOf() { calls++; return []; } })); assert.equal(calls, 0);
});
