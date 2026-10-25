import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { assetFixtureEdit, personFamily } from './asset-fixture.ts';
import { previewAssets, RoomRepository, validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';

function review(requestId: string) {
  return { requestId, selectedObjectIds: ['door-entry'], instruction: 'Review these generated concept proxies.',
    summary: 'Generated asset proposal.', rationale: 'Test fixture for native asset history.', constraints: 'Human acceptance required.',
    uncertainty: 'Conceptual proxy geometry.', worker: { provider: 'unit-test', model: 'fixture', responseIds: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    toolCalls: [{ name: 'inspect_model', status: 'accepted', error: null }], validator: 'room-graph-v1' };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => JSON.stringify(key) + ':' + canonical(entry)).join(',') + '}';
  return JSON.stringify(value);
}

test('asset proposals retain old root bytes and preserve proxy descriptions through human acceptance and exact restore', async () => {
  const repo = await RoomRepository.create('Native assets'); const from = repo.head('main'); const oldText = repo.serialize();
  const before = repo.view(from).snapshot;
  assert.equal(from, 'c050c7bdaebb75d7115659ee44495d8a884f7a68034ebc3f72820020e98c9b78');
  const after = previewAssets(before, assetFixtureEdit());
  const proposed = await repo.proposeReviewedModel({ name: 'asset-proxy-study', from, snapshot: after, review: review('asset-proxy-study') });
  assert.equal(proposed.head('main'), from); assert.equal(repo.serialize(), oldText);
  assert.deepEqual(proposed.view(from).snapshot, before);
  const accepted = proposed.accept('asset-proxy-study', { decisionId: 'human-accept-assets', actor: 'Human reviewer' });
  const text = accepted.serialize(); const restored = await RoomRepository.restore(text);
  assert.equal(restored.serialize(), text);
  const definition = restored.view(restored.head('main')).snapshot.entities.find((item) => item.type === 'AssetFamily' && item.id === 'standing-person');
  assert.ok(definition?.type === 'AssetFamily'); assert.equal(definition.description, personFamily().description);
  assert.equal(Object.hasOwn(restored.view(restored.head('main')).snapshot, 'version'), false);
});

test('a changed family recipe requires a new ID even on a sibling proposal from before registration', async () => {
  const repo = await RoomRepository.create(); const from = repo.head('main');
  const snapshot = previewAssets(repo.view(from).snapshot, assetFixtureEdit());
  const registered = await repo.proposeReviewedModel({ name: 'register-assets', from, snapshot, review: review('register-assets') });
  const changed = validateSnapshot({ ...snapshot, entities: snapshot.entities.map((item) => item.type === 'AssetFamily' && item.id === 'standing-person'
    ? { ...item, description: 'A different recipe provenance.' } : item) });
  await assert.rejects(registered.proposeReviewedModel({ name: 'rewrite-recipe', from, snapshot: changed, review: review('rewrite-recipe') }), /immutable across repository history/);
  const newId = previewAssets(snapshot, { families: [{ ...personFamily(), id: 'standing-person-revised', description: 'Explicitly revised proxy.' }],
    instances: assetFixtureEdit().instances.filter((item) => item.familyId === 'standing-person').map((item) => ({ ...item, familyId: 'standing-person-revised' })), removeInstanceIds: [] });
  assert.ok(newId.entities.some((item) => item.id === 'standing-person'));
  assert.ok(newId.entities.some((item) => item.id === 'standing-person-revised'));
  await assert.doesNotReject(registered.proposeReviewedModel({ name: 'new-recipe-id', from: registered.head('register-assets'), snapshot: newId, review: review('new-recipe-id') }));
});

test('restore rejects conflicting family recipes even when every saved revision hash is correct', async () => {
  const root = previewAssets((await RoomRepository.create()).view('c050c7bdaebb75d7115659ee44495d8a884f7a68034ebc3f72820020e98c9b78').snapshot, assetFixtureEdit());
  const changed: ModelSnapshot = validateSnapshot({ ...root, entities: root.entities.map((item) => item.type === 'AssetFamily' && item.id === 'standing-person'
    ? { ...item, name: 'Another person recipe' } : item) });
  const rootId = createHash('sha256').update(canonical({ version: 1, parentId: null, snapshot: root })).digest('hex');
  const childId = createHash('sha256').update(canonical({ version: 1, parentId: rootId, snapshot: changed })).digest('hex');
  const text = canonical({ version: 1, projectId: '00000000-0000-4000-8000-000000000113', name: 'Conflicting recipes',
    revisions: [{ id: rootId, parentId: null, snapshot: root }, { id: childId, parentId: rootId, snapshot: changed }],
    branches: [{ name: 'main', revisionId: childId }] });
  await assert.rejects(RoomRepository.restore(text), /immutable across repository history/);
});
