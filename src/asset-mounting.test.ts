import assert from 'node:assert/strict';
import test from 'node:test';
import { assetGeometry, parseAssetFamily } from './asset-family.ts';
import { personFamily, personInstance } from './asset-fixture.ts';
import { multiStoreySnapshot } from './multi-storey-house.ts';
import { entityAnchor } from '../demo/model-scene.ts';
import { nativeGeometryRecords } from './geometry-native.ts';
import { geometryWork } from './geometry-math.ts';
import { createModelScopeIndex } from './model-scope.ts';
import { entityElevation } from './building-levels.ts';
import { previewAssets, RoomRepository, identifier } from './room-model.ts';

test('three 400 mm wall cabinets fit above floor assets, with shared immutable recipe', async () => {
  const repo = await RoomRepository.create(); const base = repo.view(repo.head('main')).snapshot;
  const wall = base.entities.find(e => e.id === 'wall-north'); assert.ok(wall?.type === 'Wall');
  const y = wall.start[1] - wall.thickness / 2 - .15;
  const cabinet = parseAssetFamily({ id: 'cabinet', type: 'AssetFamily', name: 'Door cabinet proxy', description: 'Concept cabinet with door panel.', parts: [
    { id: 'body', kind: 'box', min: [0, .05, 0], size: [1, .95, 1], color: '#aabbcc' },
    { id: 'door', kind: 'box', min: [0, 0, 0], size: [1, .05, 1], color: '#eeeeee' },
  ] });
  const instances = [1, 1.5, 2].map((x, i) => ({ ...personInstance('cabinet-' + i, .6),
    familyId: cabinet.id, position: [x, y], size: { width: .4, depth: .3, height: .6 },
    mounting: { kind: 'wall', wallId: wall.id, elevation: 1.4 } }));
  const sink = { ...personInstance('sink', .9), familyId: cabinet.id, position: [1.5, y] };
  const prior = previewAssets(base, { families: Array.from({ length: 8 }, (_, i) => ({ ...personFamily(), id: 'prior-family-' + i })), instances: [], removeInstanceIds: [] });
  const after = previewAssets(prior, { families: [cabinet], instances: [...instances, sink], removeInstanceIds: [] });
  for (const item of after.entities.filter(e => e.type === 'AssetInstance' && e.id !== 'sink')) {
    assert.ok(item.type === 'AssetInstance');
    const geometry = assetGeometry(after, item);
    assert.equal(geometry.bounds.minZ, 1.4); assert.equal(geometry.bounds.maxZ, 2);
  }
  assert.equal(after.entities.length - prior.entities.length, 5);
  assert.equal(after.entities.filter(e => e.type === 'AssetFamily').length, 9);
  assert.ok(createModelScopeIndex(after).edges.some(e => e.relation === 'hosted-by' && e.source === 'cabinet-0' && e.target === wall.id));
  const records = nativeGeometryRecords('mounting-test', { snapshot: after, revisionId: 'fixture', target: { kind: 'main' } }, geometryWork({ maxWork: 2000000, maxMilliseconds: 1000 }));
  const cabinetRecord = records.find(r => r.description.ref.kind === 'native' && r.description.ref.entityId === 'cabinet-0');
  assert.equal(cabinetRecord?.description.bounds?.min[2], 1.4);
  assert.ok(cabinetRecord?.relations.some(r => r.kind === 'hosted-by'));

});

test('ceiling suspension and free floating objects use disjoint vertical occupancy and preserve mounting on restore', async () => {
  const repo = await RoomRepository.create(); const base = repo.view(repo.head('main')).snapshot;
  const instances = [
    { ...personInstance('base', .8), size: { width: .4, depth: .3, height: .8 } },
    { ...personInstance('floating', .4), mounting: { kind: 'free-floating', elevation: 1.2 } },
    { ...personInstance('pendant', .3), mounting: { kind: 'ceiling', clearance: .1 } },
  ];
  const after = previewAssets(base, { families: [personFamily()], instances, removeInstanceIds: [] });
  const pendant = after.entities.find(e => e.id === 'pendant'); assert.ok(pendant?.type === 'AssetInstance');
  const ceiling = Math.min(...base.entities.filter(e => e.type === 'Wall').map(e => e.height));
  assert.ok(Math.abs(assetGeometry(after, pendant).bounds.maxZ - (ceiling - .1)) < 1e-9);
  const restored = await RoomRepository.restore((await RoomRepository.createProject({
    projectId: '00000000-0000-4000-8000-000000000245', name: 'Mounted assets', snapshot: after,
  })).serialize());
  assert.deepEqual(restored.view(restored.head('main')).snapshot, after);
  assert.throws(() => previewAssets(after, { families: [], instances: [{ ...instances[1], mounting: { kind: 'free-floating', elevation: .7 } }], removeInstanceIds: [] }), /overlap/);
  for (const mounting of [{ kind: 'free-floating', elevation: -1 }, { kind: 'free-floating', elevation: 1.0001 },
    { kind: 'ceiling', clearance: ceiling }, { kind: 'free-floating', elevation: ceiling }]) {
    assert.throws(() => previewAssets(base, { families: [personFamily()], instances: [{ ...personInstance(), mounting }], removeInstanceIds: [] }));
  }
});

test('wall hosting rejects missing, detached, opening-obstructing and wrong-level hosts', async () => {
  const repo = await RoomRepository.create(); const base = repo.view(repo.head('main')).snapshot;
  const instance = { ...personInstance('mounted', .4), mounting: { kind: 'wall', wallId: 'missing-wall', elevation: 1.4 } };
  assert.throws(() => previewAssets(base, { families: [personFamily()], instances: [instance], removeInstanceIds: [] }), /wall host/);
  assert.throws(() => previewAssets(base, { families: [personFamily()], instances: [{ ...instance, mounting: { ...instance.mounting, wallId: 'wall-north' } }], removeInstanceIds: [] }), /wall face/);
  const south = base.entities.find(e => e.id === 'wall-south'); assert.ok(south?.type === 'Wall');
  const door = base.entities.find(e => e.type === 'Door'); assert.ok(door?.type === 'Door');
  const link = base.relationships.find(e => e.source === door.id); assert.ok(link);
  const wall = base.entities.find(e => e.id === link.target); assert.ok(wall?.type === 'Wall');
  const x = wall.start[0] + link.offset + door.width / 2;
  assert.throws(() => previewAssets(base, { families: [personFamily()], instances: [{ ...instance,
    position: [x, south.start[1] + south.thickness / 2 + .15],
    mounting: { kind: 'wall', wallId: south.id, elevation: .2 } }], removeInstanceIds: [] }), /opening|clearance/);
});


test('named room mounts retain world elevation and reject a wall on another level', () => {
  const base = multiStoreySnapshot();
  const roomId = identifier('level-attic-west');
  const item = { ...personInstance('attic-floating', .2, { kind: 'room', roomId }), position: [2, 4.5],
    mounting: { kind: 'free-floating', elevation: 1 } };
  const after = previewAssets(base, { families: [personFamily()], instances: [item], removeInstanceIds: [] });
  const placed = after.entities.find(e => e.id === item.id); assert.ok(placed?.type === 'AssetInstance');
  assert.equal(entityElevation(after, placed), 3);
  assert.ok(Math.abs(entityAnchor(placed, after).y - 4.35) < 1e-9);
  const otherWall = base.entities.find(e => e.type === 'Wall' && 'levelId' in e && e.levelId === 'level-ground'); assert.ok(otherWall);
  assert.throws(() => previewAssets(base, { families: [personFamily()], instances: [{ ...item,
    mounting: { kind: 'wall', wallId: otherWall.id, elevation: 1 } }], removeInstanceIds: [] }), /owning level/);
});


test('mounted asset meshes and before ghosts retain actual elevated bounds in both rendering modes', async (t) => {
  const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine.js');
  const { ModelScene } = await import('../demo/model-scene.ts');
  const engine = new NullEngine(); const viewer = new ModelScene(engine);
  t.after(() => { viewer.dispose(); engine.dispose(); });
  const repo = await RoomRepository.create(); const base = repo.view(repo.head('main')).snapshot;
  const original = { ...personInstance('suspended', .3), mounting: { kind: 'ceiling', clearance: .1 } };
  const before = previewAssets(base, { families: [personFamily()], instances: [original], removeInstanceIds: [] });
  const after = previewAssets(before, { families: [], instances: [{ ...original, mounting: { kind: 'free-floating', elevation: 1.4 } }], removeInstanceIds: [] });
  viewer.setModel(after, before);
  for (const mode of ['basic', 'realistic'] satisfies ('basic' | 'realistic')[]) {
    viewer.setMode(mode); viewer.scene.render();
    const current = viewer.scene.meshes.filter(m => m.name.startsWith('suspended-'));
    const ghosts = viewer.scene.meshes.filter(m => m.name.startsWith('before:suspended-'));
    assert.ok(current.length); assert.ok(ghosts.length);
    assert.ok(Math.abs(Math.min(...current.map(m => m.getBoundingInfo().boundingBox.minimumWorld.y)) - 1.4) < 1e-6);
    const ceiling = Math.min(...base.entities.filter(e => e.type === 'Wall').map(e => e.height));
    assert.ok(Math.abs(Math.max(...ghosts.map(m => m.getBoundingInfo().boundingBox.maximumWorld.y)) - ceiling + .1) < 1e-6);
  }
});

test('ceiling envelope changes move suspended geometry and appear as derived review changes', async () => {
  const { validateSnapshot } = await import('./room-model.ts');
  const { modelChanges } = await import('./model-delta-view.ts');
  const repo = await RoomRepository.create(); const base = repo.view(repo.head('main')).snapshot;
  const before = previewAssets(base, { families: [personFamily()], instances: [{ ...personInstance('pendant', .3),
    mounting: { kind: 'ceiling', clearance: .1 } }], removeInstanceIds: [] });
  const after = validateSnapshot({ ...before, entities: before.entities.map(e => e.type === 'Wall' ? { ...e, height: e.height - .2 } : e) });
  const a = before.entities.find(e => e.id === 'pendant'); const b = after.entities.find(e => e.id === 'pendant');
  assert.ok(a?.type === 'AssetInstance' && b?.type === 'AssetInstance');
  assert.deepEqual(a, b);
  assert.ok(Math.abs(assetGeometry(before, a).bounds.maxZ - assetGeometry(after, b).bounds.maxZ - .2) < 1e-9);
  assert.ok(modelChanges(before, after).some(change => change.id === 'pendant' && change.reason === 'placement'));
});
