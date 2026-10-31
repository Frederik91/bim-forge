import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRepository, previewAssets, rectangleLayout } from './room-model.ts';

test('geometry history exposes the complete accepted cut and refuses pending proposal origins', async () => {
  const repository = await RoomRepository.create('Complete geometry authority');
  const root = repository.root();
  const snapshot = repository.view(root).snapshot;
  const history = repository.geometryHistory();
  assert.equal(history.projectId, repository.projectId);
  assert.equal(history.rootRevisionId, root);
  assert.deepEqual(history.acceptedPath(root).map(item => item.snapshot), [snapshot]);
  assert.throws(() => history.acceptedPath('f'.repeat(64)), /outside accepted/);
  assert.deepEqual(history.validateSnapshots([snapshot]), [snapshot]);
  assert.deepEqual(history.reconcile(root, snapshot), snapshot);
  const layout = rectangleLayout(snapshot);
  const draft = await repository.proposeLayout({ name: 'pending-draft', from: root,
    layout: { ...layout, door: { ...layout.door, widthMm: 1200 } } });
  assert.throws(() => draft.geometryHistory({ kind: 'main' }, draft.head('pending-draft')), /outside accepted/);
  assert.deepEqual(draft.geometryHistory().head.snapshot, snapshot);
});

test('reconstructed drafts share native AssetFamily identity validation', async () => {
  const repository = await RoomRepository.create('Native family authority');
  const base = repository.view(repository.head('main')).snapshot;
  const first = previewAssets(base, { families: [{ id: 'proof-family', type: 'AssetFamily', name: 'Proof family',
    description: 'Stable recipe', parts: [{ id: 'body', kind: 'box', min: [0, 0, 0], size: [1, 1, 1], color: '#546778' }] }],
    instances: [], removeInstanceIds: [] });
  const second = structuredClone(first);
  const family = second.entities.find(item => item.type === 'AssetFamily');
  assert.ok(family?.type === 'AssetFamily');
  family.description = 'A conflicting recipe identity';
  assert.throws(() => repository.geometryHistory().validateSnapshots([first, second]), /family/i);
  assert.deepEqual(repository.geometryHistory().validateSnapshots([first]), [first]);
});
