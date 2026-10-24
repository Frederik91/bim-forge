import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { ModelScene, entityAnchor, modelPoint, referenceFromHit, referencePosition } from './model-scene.ts';
import { RoomRepository, previewFurnishings, diffSnapshots } from '../src/room-model.ts';
import { createHousePilotFixture } from '../src/house-pilot.ts';

const furnishings = [
  { id: 'desk-test', type: 'Furniture', name: 'Desk', kind: 'desk', position: [3, 3], width: 1.8, depth: .8, height: .75, rotationDeg: 0, supportId: null },
  { id: 'screen-test', type: 'Furniture', name: 'Screen', kind: 'monitor', position: [3, 3.2], width: .6, depth: .2, height: .45, rotationDeg: 0, supportId: 'desk-test' },
  { id: 'laptop-test', type: 'Furniture', name: 'Laptop', kind: 'laptop', position: [2.45, 2.9], width: .35, depth: .25, height: .24, rotationDeg: 0, supportId: 'desk-test' },
  { id: 'chair-test', type: 'Furniture', name: 'Chair', kind: 'chair', position: [3, 2.15], width: .6, depth: .6, height: 1, rotationDeg: 0, supportId: null },
  { id: 'table-test', type: 'Furniture', name: 'Table', kind: 'table', position: [5.3, 3.3], width: .6, depth: .6, height: .55, rotationDeg: 0, supportId: null },
  { id: 'plant-test', type: 'Furniture', name: 'Plant', kind: 'plant', position: [.7, 3.3], width: .5, depth: .5, height: 1.1, rotationDeg: 0, supportId: null },
];

test('real Babylon scene preserves every object, support elevation, camera and selection across modes without changing the model', async (t) => {
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 256, deterministicLockstep: true, lockstepMaxSteps: 4 });
  const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const repo = await RoomRepository.create('Babylon office');
  const snapshot = previewFurnishings(repo.view(repo.head('main')).snapshot, { furnishings });
  const before = structuredClone(snapshot);
  assert.equal(viewer.setModel(snapshot), true); viewer.setCutaway(false);
  viewer.select('desk-test');
  const meshes = [...viewer.scene.meshes]; const materials = viewer.scene.materials.length;
  const camera = viewer.camera; camera.alpha = .4; camera.beta = 1; camera.radius = 8;
  viewer.setMode('basic'); viewer.scene.render();
  assert.ok(viewer.scene.meshes.every((mesh) => mesh.material instanceof StandardMaterial));
  assert.equal(viewer.scene.shadowsEnabled, false);
  assert.equal(viewer.setModel(structuredClone(snapshot)), false, 'polling and selection must not rebuild meshes');
  viewer.setMode('realistic'); viewer.scene.render();
  assert.ok(viewer.scene.meshes.every((mesh) => mesh.material instanceof PBRMaterial));
  assert.equal(viewer.scene.shadowsEnabled, true);
  assert.deepEqual(viewer.scene.meshes, meshes);
  assert.equal(viewer.camera, camera); assert.equal(camera.alpha, .4); assert.equal(camera.radius, 8);
  assert.ok(viewer.scene.meshes.filter((mesh) => mesh.name.startsWith('desk-test')).every((mesh) => mesh.renderOutline));
  for (const item of snapshot.entities) {
    assert.ok(viewer.scene.meshes.some((mesh) => mesh.name.startsWith(item.id)), `${item.id} is rendered`);
    if (item.type !== 'Furniture') continue;
    const own = viewer.scene.meshes.filter((mesh) => mesh.name.startsWith(item.id));
    const bottom = Math.min(...own.map((mesh) => mesh.getBoundingInfo().boundingBox.minimumWorld.y));
    assert.ok(Math.abs(bottom - (item.supportId ? .75 : item.kind === 'chair' ? .04 : 0)) < .00001, `${item.id} has correct elevation`);
    assert.ok(entityAnchor(item, snapshot).y >= item.height);
  }
  for (let i = 0; i < 8; i += 1) { viewer.setMode('basic'); viewer.setMode('realistic'); }
  assert.equal(viewer.scene.materials.length, materials + new Set(meshes.map((mesh) => mesh.material)).size, 'mode materials are reused, not leaked');
  assert.deepEqual(snapshot, before); assert.equal(diffSnapshots(before, snapshot).entities.modified.length, 0);
});

test('walls have actual door and window gaps, cutaway affects visibility only, and replacement disposes old resources', async (t) => {
  const engine = new NullEngine(); const viewer = new ModelScene(engine);
  t.after(() => { viewer.dispose(); engine.dispose(); });
  const fixture = await createHousePilotFixture(); const repo = fixture.repository;
  const snapshot = repo.view(repo.head('main')).snapshot;
  viewer.setModel(snapshot); viewer.setCutaway(false); viewer.scene.render();
  for (const opening of snapshot.entities) {
    if (opening.type !== 'Door' && opening.type !== 'Window') continue;
    const host = snapshot.relationships.find((link) => link.source === opening.id); assert.ok(host);
    const anchor = entityAnchor(opening, snapshot);
    const middle = new Vector3(anchor.x, (opening.type === 'Window' ? opening.sillHeight : 0) + opening.height / 2, anchor.z);
    const walls = viewer.scene.meshes.filter((mesh) => mesh.name.startsWith(`${host.target}-solid-`));
    assert.ok(walls.length > 1);
    assert.ok(walls.every((mesh) => !mesh.intersectsPoint(middle)), `${opening.id} is not a painted-on opening`);
  }
  const count = viewer.scene.meshes.length;
  viewer.setCutaway(true); viewer.scene.render();
  assert.ok(viewer.scene.meshes.some((mesh) => !mesh.isEnabled()));
  assert.equal(viewer.scene.meshes.length, count);
  const old = [...viewer.scene.meshes];
  const empty = await RoomRepository.create('Another scene'); viewer.setModel(empty.view(empty.head('main')).snapshot);
  assert.ok(old.every((mesh) => mesh.isDisposed()));
  viewer.dispose(); assert.equal(viewer.scene.isDisposed, true);
});

test('ray destinations are generic, millimetre-bound floor/wall references and do not infer move/group operations', async () => {
  const repo = await RoomRepository.create(); const snapshot = repo.view(repo.head('main')).snapshot;
  assert.deepEqual(modelPoint(2, 3, .75).asArray(), [2, .75, 3]);
  assert.deepEqual(referenceFromHit(snapshot, modelPoint(2.1234, 1.5678), null), { kind: 'floor-point', positionMm: [2123, 1568] });
  assert.equal(referenceFromHit(snapshot, modelPoint(100, 100), null), null);
  const wall = snapshot.entities.find((item) => item.type === 'Wall'); assert.ok(wall?.type === 'Wall');
  const reference = referenceFromHit(snapshot, modelPoint((wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2), wall.id);
  assert.ok(reference?.kind === 'wall-point');
  const position = referencePosition(reference, snapshot);
  assert.equal(position.x, (wall.start[0] + wall.end[0]) / 2); assert.equal(position.z, (wall.start[1] + wall.end[1]) / 2);
});

test('actual Babylon rays select visible desk geometry and mark floor points through cutaway walls', async (t) => {
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 256, deterministicLockstep: true, lockstepMaxSteps: 4 });
  const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const repo = await RoomRepository.create(); const snapshot = previewFurnishings(repo.view(repo.head('main')).snapshot, { furnishings });
  viewer.setModel(snapshot); viewer.setMode('basic'); viewer.setCutaway(true); viewer.scene.render();
  const screen = (position: Vector3) => Vector3.Project(position, Matrix.IdentityReadOnly, viewer.scene.getTransformMatrix(), viewer.camera.viewport.toGlobal(800, 600));
  const desk = screen(modelPoint(3.5, 3, .751));
  assert.equal(viewer.objectAt(desk.x, desk.y), 'desk-test', 'hidden wall must not intercept a visible furniture pick');
  const point = screen(modelPoint(3.5, 1, -.01));
  const reference = viewer.referenceAt(point.x, point.y);
  assert.ok(reference?.kind === 'floor-point');
  assert.ok(Math.abs(reference.positionMm[0] - 3500) <= 2); assert.ok(Math.abs(reference.positionMm[1] - 1000) <= 2);
});
