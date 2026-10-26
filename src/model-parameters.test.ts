import assert from 'node:assert/strict';
import test from 'node:test';
import { assetGeometry, previewAssetFamilyVariant } from './asset-family.ts';
import { personFamily, personInstance } from './asset-fixture.ts';
import { multiStoreySnapshot } from './multi-storey-house.ts';
import { applyModelParameterEdits, modelParameters, parseModelParameters } from './model-parameters.ts';
import { freezeModelScope } from './model-scope.ts';
import type { ModelScopeQuery, ModelParameter } from './model-scope-contract.ts';
import { diffSnapshots, identifier, parseModelEntity, parseModelRelationship, previewAssets, previewFurnishings,
  previewRectangle, previewRoomFurnishings, rectangleLayout, RoomRepository, validateSnapshot } from './room-model.ts';
import type { Entity, ModelSnapshot } from './room-model.ts';

const fireRating: ModelParameter = { definitionId: 'fire-rating', name: 'Fire resistance', value: { kind: 'duration', value: 60, unit: 'min' } };
const width: ModelParameter = { definitionId: 'geometry-width', name: 'width', value: { kind: 'length', value: 700, unit: 'mm' } };
function entity(snapshot: ModelSnapshot, id: string): Entity {
  const item = snapshot.entities.find((candidate) => candidate.id === id); assert.ok(item); return item;
}
function review(requestId: string) {
  return { requestId, selectedObjectIds: ['door-entry'], instruction: 'Review the typed parameter change.',
    summary: 'Parameter fixture proposal.', rationale: 'Authored fields retain canonical geometry.', constraints: 'Human review.',
    uncertainty: 'Fixture only.', worker: { provider: 'unit-test', model: 'fixture', responseIds: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    toolCalls: [{ name: 'inspect_model', status: 'accepted', error: null }], validator: 'room-graph-v1' };
}

/** Several rooms on three levels, one immutable family and two independent occurrences. */
function parameterFixture(): ModelSnapshot {
  const snapshot = multiStoreySnapshot();
  const instances = ['level-basement-west', 'level-attic-west'].map((roomId, index) => ({
    ...personInstance('parameter-person-' + index, 1.87, { kind: 'room', roomId: identifier(roomId) }), position: [2, 4.5], parameters: [fireRating],
  }));
  const withAssets = previewAssets(snapshot, { families: [{ ...personFamily(), parameters: [fireRating] }], instances, removeInstanceIds: [] });
  return applyModelParameterEdits({ snapshot: withAssets, targetIds: ['level-ground-west', 'level-basement'], edits: [fireRating] });
}

test('metadata remains typed across entity/family/occurrence validation and legacy bytes stay unchanged', async () => {
  const repo = await RoomRepository.create(); const from = repo.head('main');
  assert.equal(from, 'c050c7bdaebb75d7115659ee44495d8a884f7a68034ebc3f72820020e98c9b78');
  const bytes = repo.serialize(); assert.equal((await RoomRepository.restore(bytes)).serialize(), bytes);
  assert.ok(repo.view(from).snapshot.entities.every((item) => !Object.hasOwn(item, 'parameters')));
  const fixture = parameterFixture(); assert.deepEqual(validateSnapshot(fixture), fixture);
  for (const id of ['level-ground-west', 'level-basement', 'standing-person', 'parameter-person-0', 'parameter-person-1']) {
    assert.deepEqual(entity(fixture, id).parameters, [fireRating]);
  }
});

test('unit conversion updates real authored dimensions and derived asset bounds with an inspectable delta', (t) => {
  const before = parameterFixture(); const bytes = JSON.stringify(before);
  const after = applyModelParameterEdits({ snapshot: before, targetIds: ['parameter-person-0'], edits: [width] });
  const instance = entity(after, 'parameter-person-0'); assert.ok(instance.type === 'AssetInstance');
  assert.equal(instance.size.width, .7); assert.equal(assetGeometry(after, instance).bounds.maxX, 2.35);
  assert.deepEqual(instance.parameters, [fireRating]);
  assert.deepEqual(entity(before, 'parameter-person-1'), entity(after, 'parameter-person-1'));
  assert.deepEqual(diffSnapshots(before, after).entities.modified.map((item) => item.id), ['parameter-person-0']);
  assert.equal(JSON.stringify(before), bytes);
  t.diagnostic(JSON.stringify(diffSnapshots(before, after)));
});

test('geometric built-ins reflect authoritative fields without unsupported synthetic dimensions', () => {
  const fixture = parameterFixture();
  const instance = modelParameters(entity(fixture, 'parameter-person-0'));
  assert.deepEqual(instance.map((item) => item.definitionId), ['geometry-width', 'geometry-depth', 'geometry-height', 'geometry-rotation', 'fire-rating']);
  assert.deepEqual(modelParameters(entity(fixture, 'standing-person')), [fireRating]);
  assert.deepEqual(modelParameters(entity(fixture, 'level-basement')).map((item) => item.definitionId), ['geometry-elevation', 'fire-rating']);
  assert.ok(!modelParameters(entity(fixture, 'level-attic-roof')).some((item) => item.definitionId === 'geometry-height'));
});

test('invalid targets, units, grids, unsupported mappings, kind changes and geometric shadowing fail atomically', () => {
  const snapshot = parameterFixture(); const bytes = JSON.stringify(snapshot);
  for (const targetIds of [[], ['missing'], ['parameter-person-0', 'parameter-person-0']]) {
    assert.throws(() => applyModelParameterEdits({ snapshot, targetIds, edits: [width] }));
  }
  for (const edit of [
    { ...width, value: { kind: 'angle', value: 90, unit: 'deg' } },
    { ...width, value: { kind: 'length', value: .0001, unit: 'm' } },
    { ...width, value: { kind: 'length', value: 10, unit: 'm' } },
    { ...fireRating, value: { kind: 'text', value: 'sixty' } },
  ]) assert.throws(() => applyModelParameterEdits({ snapshot, targetIds: ['parameter-person-0'], edits: parseModelParameters([edit]) }));
  assert.throws(() => applyModelParameterEdits({ snapshot, targetIds: ['level-basement'], edits: [width] }), /Unsupported geometric/);
  assert.throws(() => validateSnapshot({ ...snapshot, entities: snapshot.entities.map((item) => item.id === 'level-basement'
    ? { ...item, parameters: [width] } : item) }), /shadow/);
  assert.throws(() => parseModelParameters([fireRating, fireRating]), /unique/);
  assert.throws(() => parseModelParameters([{ ...fireRating, value: { kind: 'length', value: 1, unit: 'cm' } }]));
  assert.equal(JSON.stringify(snapshot), bytes);
});

test('support and hosted-opening validators refuse unsafe dimensional edits with no partial mutation', async () => {
  const repo = await RoomRepository.create(); const root = repo.view(repo.head('main')).snapshot;
  const snapshot = previewFurnishings(root, { furnishings: [
    { id: 'desk', type: 'Furniture', name: 'Desk', kind: 'desk', position: [1, 2], width: 1.2, depth: .8, height: .75, rotationDeg: 0, supportId: null },
    { id: 'monitor', type: 'Furniture', name: 'Monitor', kind: 'monitor', position: [1, 2], width: .5, depth: .2, height: .4, rotationDeg: 0, supportId: 'desk' },
  ] });
  const bytes = JSON.stringify(snapshot);
  assert.throws(() => applyModelParameterEdits({ snapshot, targetIds: ['desk'], edits: [{ ...width, value: { kind: 'length', value: .2, unit: 'm' } }] }));
  assert.throws(() => applyModelParameterEdits({ snapshot, targetIds: ['door-entry'], edits: [{ ...width, value: { kind: 'length', value: 5, unit: 'm' } }] }), /fit inside its wall/);
  const after = applyModelParameterEdits({ snapshot, targetIds: ['door-entry'], edits: [width] });
  assert.equal(modelParameters(entity(after, 'door-entry')).find((item) => item.definitionId === 'geometry-width')?.value.value, .7);
  assert.equal(JSON.stringify(snapshot), bytes);
});

test('geometry tools retain omitted metadata on modified and unrelated records', async () => {
  const repo = await RoomRepository.create(); const root = repo.view(repo.head('main')).snapshot;
  const withMetadata = applyModelParameterEdits({ snapshot: root, targetIds: ['door-entry', 'wall-south'], edits: [fireRating] });
  const resized = previewRectangle(withMetadata, { ...rectangleLayout(withMetadata), door: { widthMm: 1000, offsetMm: 2400 } });
  assert.deepEqual(entity(resized, 'door-entry').parameters, [fireRating]);
  assert.deepEqual(entity(resized, 'wall-south').parameters, [fireRating]);
  const snapshot = parameterFixture();
  const a = entity(snapshot, 'parameter-person-0'); assert.ok(a.type === 'AssetInstance');
  const { parameters: omitted, ...geometry } = a; assert.ok(omitted);
  const assets = previewAssets(snapshot, { families: [], instances: [{ ...geometry, size: { ...a.size, height: 1.8 } }], removeInstanceIds: [] });
  assert.deepEqual(entity(assets, a.id).parameters, [fireRating]);
  const plant = entity(snapshot, 'level-ground-plant'); assert.ok(plant.type === 'Furniture' && 'levelId' in plant);
  const enriched = applyModelParameterEdits({ snapshot, targetIds: [plant.id, 'level-attic-plant'], edits: [fireRating] });
  const { levelId: owner, ...unowned } = plant; assert.ok(owner);
  const furnishings = previewRoomFurnishings(enriched, { roomId: 'level-ground-west', furnishings: [{ ...unowned, height: 1.1 }] });
  assert.deepEqual(entity(furnishings, plant.id).parameters, [fireRating]);
  assert.deepEqual(entity(furnishings, 'level-attic-plant').parameters, [fireRating]);
});

test('subset variants preserve the original recipe, provenance metadata and all unselected occurrences', () => {
  const before = parameterFixture();
  const original = entity(before, 'standing-person'); assert.ok(original.type === 'AssetFamily');
  const after = previewAssetFamilyVariant({ snapshot: before, familyId: original.id, targetIds: ['parameter-person-0'],
    variant: { ...original, id: 'person-variant', description: 'Explicit subset variant for human review.' } });
  assert.deepEqual(entity(after, original.id), original);
  assert.deepEqual(entity(after, 'parameter-person-1'), entity(before, 'parameter-person-1'));
  const selected = entity(after, 'parameter-person-0'); assert.ok(selected.type === 'AssetInstance');
  assert.equal(selected.familyId, 'person-variant'); assert.deepEqual(selected.parameters, [fireRating]);
  assert.deepEqual(diffSnapshots(before, after).entities.added.map((item) => item.id), ['person-variant']);
  assert.throws(() => previewAssetFamilyVariant({ snapshot: before, familyId: original.id, targetIds: ['level-basement'], variant: { ...original, id: 'another-variant' } }));
  assert.throws(() => applyModelParameterEdits({ snapshot: before, targetIds: [original.id], edits: [fireRating] }), /immutable/);
});

test('typed metadata and review provenance survive human acceptance and exact repository restore', async () => {
  const repo = await RoomRepository.create(); const from = repo.head('main');
  const snapshot = applyModelParameterEdits({ snapshot: repo.view(from).snapshot, targetIds: ['door-entry'], edits: [fireRating] });
  const proposed = await repo.proposeReviewedModel({ name: 'parameter-review', from, snapshot, review: review('parameter-review') });
  const accepted = proposed.accept('parameter-review', { decisionId: 'human-parameter', actor: 'Human reviewer' });
  const text = accepted.serialize(); const restored = await RoomRepository.restore(text);
  assert.equal(restored.serialize(), text); assert.deepEqual(restored.review('parameter-review'), accepted.review('parameter-review'));
  assert.deepEqual(entity(restored.view(restored.head('main')).snapshot, 'door-entry').parameters, [fireRating]);
});

test('shape-only hydration accepts partial objects and rejects accessors and extra fields without weakening whole-project validation', () => {
  const raw = { id: 'sample-door', type: 'Door', name: 'Door', width: .9, height: 2.1, parameters: [fireRating] };
  const parsed = parseModelEntity(raw, true); assert.equal(parsed.id, raw.id); assert.deepEqual(parsed.parameters, [fireRating]);
  const wall = parseModelEntity({ id: 'owned-wall', type: 'Wall', name: 'Wall', levelId: 'missing-level', start: [0, 0], end: [3, 0], thickness: .15, height: 3 }, true);
  assert.equal(wall.type, 'Wall');
  const relation = parseModelRelationship({ id: 'sample-host', type: 'hosted-by', source: 'sample-door', target: 'missing-wall', offset: .2 });
  assert.equal(relation.target, 'missing-wall');
  assert.throws(() => validateSnapshot({ units: 'm', entities: [raw], relationships: [relation] }));
  assert.throws(() => parseModelEntity({ ...raw, unexpected: true }, true), /fields/);
  assert.throws(() => parseModelRelationship({ ...relation, unexpected: true }), /fields/);
  let calls = 0;
  assert.throws(() => parseModelEntity(Object.defineProperty({ ...raw }, 'width', { enumerable: true, get() { calls += 1; return .9; } }), true), /accessor/);
  assert.throws(() => parseModelRelationship(Object.defineProperty({ ...relation }, 'offset', { enumerable: true, get() { calls += 1; return .2; } })), /accessor/);
  assert.equal(calls, 0);
});

test('parameter parser rejects accessors without executing them', () => {
  let calls = 0;
  const hostile = Object.defineProperty({ ...fireRating }, 'value', { enumerable: true, get() { calls += 1; return fireRating.value; } });
  assert.throws(() => parseModelParameters([hostile]), /accessor/); assert.equal(calls, 0);
});

test('one definition cannot carry incompatible kinds or names across different objects', () => {
  const snapshot = parameterFixture();
  assert.throws(() => validateSnapshot({ ...snapshot, entities: snapshot.entities.map((item) => item.id === 'parameter-person-0'
    ? { ...item, parameters: [{ ...fireRating, value: { kind: 'text', value: 'sixty' } }] } : item) }), /definition identity/);
});

const idsQuery = (ids: string[]): ModelScopeQuery => ({ version: 1, allOf: [{ kind: 'ids', ids }], anyOf: [], excludeIds: [] });

test('every direct proposal entry point fences forged evidence, mismatched bases and context writes', async () => {
  const repo = await RoomRepository.create(); const from = repo.head('main'); const snapshot = repo.view(from).snapshot;
  const scope = freezeModelScope({ graph: snapshot, query: idsQuery(['door-entry']), baseRevisionId: from });
  const before = repo.serialize();
  const forged = { ...scope, writableIds: [...scope.writableIds, 'wall-south'] };
  await assert.rejects(repo.propose({ name: 'forged-direct', from, doorWidthM: 1, scope: forged }), /scope evidence/);
  await assert.rejects(repo.propose({ name: 'wrong-base', from, doorWidthM: 1, scope: { ...scope, baseRevisionId: 'a'.repeat(64) } }), /exact proposal base/);
  const wallScope = freezeModelScope({ graph: snapshot, query: idsQuery(['wall-north']), baseRevisionId: from });
  await assert.rejects(repo.propose({ name: 'context-door', from, doorWidthM: 1, scope: wallScope }), /Out-of-scope/);
  await assert.rejects(repo.proposeLayout({ name: 'context-layout', from, scope,
    layout: { ...rectangleLayout(snapshot), boundsMm: { minX: 0, minY: 0, maxX: 7000, maxY: 4000 } } }), /Out-of-scope/);
  const outside = validateSnapshot({ ...snapshot, entities: snapshot.entities.map((item) => item.id === 'wall-south' ? { ...item, height: 3.1 } : item) });
  await assert.rejects(repo.proposeReviewedModel({ name: 'context-reviewed', from, snapshot: outside,
    review: { ...review('context-reviewed'), scope } }), /Out-of-scope/);
  assert.equal(repo.serialize(), before);
});

test('review scopes survive exact persistence and direct acceptance; restore refuses forged review-only authority', async () => {
  const repo = await RoomRepository.create(); const from = repo.head('main'); const snapshot = repo.view(from).snapshot;
  const scope = freezeModelScope({ graph: snapshot, query: idsQuery(['door-entry']), baseRevisionId: from });
  const after = applyModelParameterEdits({ snapshot, targetIds: ['door-entry'], edits: [width] });
  const proposed = await repo.proposeReviewedModel({ name: 'scoped-door', from, snapshot: after, review: { ...review('scoped-door'), scope } });
  const restored = await RoomRepository.restore(proposed.serialize()); assert.deepEqual(restored.review('scoped-door').scope, scope);
  const accepted = restored.accept('scoped-door', { decisionId: 'human-scoped-door', actor: 'Human reviewer' });
  assert.equal((await RoomRepository.restore(accepted.serialize())).serialize(), accepted.serialize());
  const state = proposed.persistence(); assert.ok(state.version === 2);
  const forged = { ...state, reviews: state.reviews.map((record) => ({ ...record, scope: { ...scope, writableIds: [...scope.writableIds, 'wall-south'] } })) };
  await assert.rejects(RoomRepository.restore(JSON.stringify(forged)), /scope evidence/);
  assert.equal(accepted.accept('scoped-door', { decisionId: 'human-scoped-door', actor: 'Human reviewer' }).serialize(), accepted.serialize());
});

test('scope reconciliation preserves unrelated accepted edits and refuses relevant context changes', async () => {
  const repo = await RoomRepository.createProject({ projectId: '00000000-0000-4000-8000-000000000172', name: 'Scope reconciliation', snapshot: parameterFixture() });
  const from = repo.head('main'); const base = repo.view(from).snapshot;
  const scope = freezeModelScope({ graph: base, query: idsQuery(['parameter-person-0']), baseRevisionId: from });
  const change = applyModelParameterEdits({ snapshot: base, targetIds: ['parameter-person-0'], edits: [width] });
  const scoped = await repo.proposeReviewedModel({ name: 'scoped-person', from, snapshot: change, review: { ...review('scoped-person'), scope } });
  const unrelated = applyModelParameterEdits({ snapshot: base, targetIds: ['level-attic-plant'], edits: [{ ...width, value: { kind: 'length', value: .5, unit: 'm' } }] });
  const independent = await repo.proposeReviewedModel({ name: 'unrelated-plant', from, snapshot: unrelated, review: review('unrelated-plant') });
  const current = independent.accept('unrelated-plant', { decisionId: 'human-plant', actor: 'Human reviewer' });
  const accepted = await current.acceptFrom(scoped, 'scoped-person', { decisionId: 'human-person', actor: 'Human reviewer' });
  const result = accepted.view(accepted.head('main')).snapshot;
  assert.deepEqual(entity(result, 'level-attic-plant'), entity(unrelated, 'level-attic-plant'));
  assert.deepEqual(entity(result, 'parameter-person-0'), entity(change, 'parameter-person-0'));
  assert.equal((await RoomRepository.restore(accepted.serialize())).serialize(), accepted.serialize());
  const contextChange = applyModelParameterEdits({ snapshot: base, targetIds: ['level-basement-plant'], edits: [fireRating] });
  const relevant = await repo.proposeReviewedModel({ name: 'context-plant', from, snapshot: contextChange, review: review('context-plant') });
  const changed = relevant.accept('context-plant', { decisionId: 'human-context', actor: 'Human reviewer' });
  assert.throws(() => changed.proposalSnapshot(scoped, 'scoped-person'), /scope relevant entity changed/);
  await assert.rejects(changed.acceptFrom(scoped, 'scoped-person', { decisionId: 'reject-context', actor: 'Human reviewer' }), /scope relevant entity changed/);
});

test('new parameter matches never silently enter a reviewed scope through direct acceptance', async () => {
  const marker: ModelParameter = { definitionId: 'work-package', name: 'Work package', value: { kind: 'boolean', value: true } };
  const snapshot = applyModelParameterEdits({ snapshot: parameterFixture(), targetIds: ['level-basement-plant'], edits: [marker] });
  const repo = await RoomRepository.createProject({ projectId: '00000000-0000-4000-8000-000000000173', name: 'Frozen matching', snapshot });
  const from = repo.head('main');
  const query: ModelScopeQuery = { version: 1, allOf: [{ kind: 'parameter-exists', definitionId: marker.definitionId }], anyOf: [], excludeIds: [] };
  const scope = freezeModelScope({ graph: snapshot, query, baseRevisionId: from });
  assert.deepEqual(scope.targetIds, ['level-basement-plant']);
  const change = applyModelParameterEdits({ snapshot, targetIds: scope.targetIds, edits: [{ ...width, value: { kind: 'length', value: .5, unit: 'm' } }] });
  const pending = await repo.proposeReviewedModel({ name: 'frozen-parameter', from, snapshot: change, review: { ...review('frozen-parameter'), scope } });
  const expanded = applyModelParameterEdits({ snapshot, targetIds: ['level-attic-plant'], edits: [marker] });
  const other = await repo.proposeReviewedModel({ name: 'new-match', from, snapshot: expanded, review: review('new-match') });
  const current = other.accept('new-match', { decisionId: 'human-new-match', actor: 'Human reviewer' });
  const bytes = current.serialize();
  assert.throws(() => current.proposalSnapshot(pending, 'frozen-parameter'), /membership or dependencies changed/);
  await assert.rejects(current.acceptFrom(pending, 'frozen-parameter', { decisionId: 'refused-new-match', actor: 'Human reviewer' }), /membership or dependencies changed/);
  assert.equal(current.serialize(), bytes);
});

test('raw reviewed snapshots cannot accidentally discard metadata during a geometry edit', async () => {
  const snapshot = parameterFixture();
  const repo = await RoomRepository.createProject({ projectId: '00000000-0000-4000-8000-000000000174', name: 'Metadata retention', snapshot });
  const from = repo.head('main');
  const after = validateSnapshot({ ...snapshot, entities: snapshot.entities.map((item) => {
    if (item.id !== 'parameter-person-0' || item.type !== 'AssetInstance') return item;
    const { parameters, ...geometry } = item; assert.ok(parameters);
    return { ...geometry, size: { ...geometry.size, width: .7 } };
  }) });
  const proposed = await repo.proposeReviewedModel({ name: 'retain-raw', from, snapshot: after, review: review('retain-raw') });
  assert.deepEqual(entity(proposed.view(proposed.head('retain-raw')).snapshot, 'parameter-person-0').parameters, [fireRating]);
  const family = entity(snapshot, 'standing-person'); assert.ok(family.type === 'AssetFamily');
  const { parameters: metadata, ...recipe } = family; assert.ok(metadata);
  assert.deepEqual(previewAssets(snapshot, { families: [recipe], instances: [], removeInstanceIds: [] }), snapshot);
  const variant = previewAssetFamilyVariant({ snapshot, familyId: family.id, variant: { ...recipe, id: 'inherited-variant' }, targetIds: ['parameter-person-0'] });
  assert.deepEqual(entity(variant, 'inherited-variant').parameters, [fireRating]);
});

test('all seven canonical built-ins edit only their supported authored fields with unit checking', async () => {
  const repo = await RoomRepository.create(); const root = repo.view(repo.head('main')).snapshot;
  const base = validateSnapshot({ ...root, entities: [...root.entities,
    { id: 'window-north', type: 'Window', name: 'North window', width: .8, height: 1, sillHeight: .8 },
    { id: 'equipment', type: 'Equipment', name: 'Mechanical fixture', category: 'mechanical', position: [5, 3], elevation: 1, width: .4, depth: .4, height: .4 },
  ], relationships: [...root.relationships, { id: 'host-window-north', type: 'hosted-by', source: 'window-north', target: 'wall-north', offset: 1 }] });
  const edits: ModelParameter[] = [
    { definitionId: 'geometry-width', name: 'width', value: { kind: 'length', value: 500, unit: 'mm' } },
    { definitionId: 'geometry-depth', name: 'depth', value: { kind: 'length', value: .5, unit: 'm' } },
    { definitionId: 'geometry-height', name: 'height', value: { kind: 'length', value: 500, unit: 'mm' } },
    { definitionId: 'geometry-elevation', name: 'elevation', value: { kind: 'length', value: 1200, unit: 'mm' } },
  ];
  const equipment = applyModelParameterEdits({ snapshot: base, targetIds: ['equipment'], edits });
  const item = entity(equipment, 'equipment'); assert.ok(item.type === 'Equipment');
  assert.deepEqual([item.width, item.depth, item.height, item.elevation], [.5, .5, .5, 1.2]);
  const sill = applyModelParameterEdits({ snapshot: equipment, targetIds: ['window-north'], edits: [
    { definitionId: 'geometry-sill-height', name: 'sill-height', value: { kind: 'length', value: 900, unit: 'mm' } },
  ] });
  const window = entity(sill, 'window-north'); assert.ok(window.type === 'Window'); assert.equal(window.sillHeight, .9);
  const wall = applyModelParameterEdits({ snapshot: sill, targetIds: ['wall-north'], edits: [
    { definitionId: 'geometry-thickness', name: 'thickness', value: { kind: 'length', value: 180, unit: 'mm' } },
  ] });
  const north = entity(wall, 'wall-north'); assert.ok(north.type === 'Wall'); assert.equal(north.thickness, .18);
  const rotation: ModelParameter = { definitionId: 'geometry-rotation', name: 'rotation', value: { kind: 'angle', value: 90, unit: 'deg' } };
  const fixture = parameterFixture();
  const rotated = applyModelParameterEdits({ snapshot: fixture, targetIds: ['parameter-person-0'], edits: [rotation] });
  const asset = entity(rotated, 'parameter-person-0'); assert.ok(asset.type === 'AssetInstance');
  assert.equal(asset.rotationDeg, 90); assert.equal(assetGeometry(rotated, asset).footprint.maxX, 2.15);
  assert.throws(() => applyModelParameterEdits({ snapshot: fixture, targetIds: ['parameter-person-0'], edits: [
    { ...rotation, value: { kind: 'angle', value: 45, unit: 'deg' } },
  ] }), /cardinal angle/);
});
