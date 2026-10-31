import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { SceneSerializer } from '@babylonjs/core/Misc/sceneSerializer.js';
import { SpatialTaskLayer } from './spatial-task-layer.ts';
import type { TaskAgentDescriptor } from './spatial-task-layer.ts';
import { spatialTokens } from './ui/design-tokens.ts';

function descriptor(ticketId = 'door-01', changes: Partial<Omit<TaskAgentDescriptor, 'identity' | 'state'>> = {}): Extract<TaskAgentDescriptor, { state: Exclude<TaskAgentDescriptor['state'], 'unsent'> }> {
  return { identity: { kind: 'task', projectId: 'project-a', ticketId }, state: 'queued', title: 'Entry door',
    placement: { kind: 'placed', origin: [2, 3, 4] }, visible: true, selected: false, ...changes };
}

function setup() {
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 256, deterministicLockstep: true, lockstepMaxSteps: 4 });
  const scene = new Scene(engine);
  const camera = new FreeCamera('borrowed-camera', new Vector3(2, 4.4, 6), scene);
  camera.setTarget(new Vector3(2, 4.4, 3)); camera.minZ = .01;
  const building = MeshBuilder.CreateBox('building', { size: 1 }, scene); building.position.set(20, 0, 0);
  const material = new StandardMaterial('borrowed-material', scene); building.material = material;
  const layer = new SpatialTaskLayer({ scene, tokens: spatialTokens.color, isConstructionMesh: mesh => mesh === building, reducedMotion: false });
  const ray = new Ray(new Vector3(2, 4.24, 6), new Vector3(0, 0, -1), 10);
  return { engine, scene, camera, building, material, layer, ray,
    dispose() { layer.dispose(); scene.dispose(); engine.dispose(); } };
}

test('real solid body/head picks keep engineering XYZ metres and fixed origins independent of camera/selection', t => {
  const h = setup(); t.after(() => h.dispose());
  const first = descriptor(); h.layer.replace('project-a', [first]); h.scene.render();
  const body = h.scene.meshes.find(mesh => mesh.name === 'task-agent:torso'); assert.ok(body);
  assert.ok(Vector3.Distance(body.getAbsolutePosition(), new Vector3(2, 4.24, 3)) < .00001);
  assert.deepEqual(h.layer.pick(h.ray, 'idle'), { kind: 'task', identity: first.identity });
  assert.equal(h.layer.pick(new Ray(new Vector3(2, 4.46, 6), new Vector3(0, 0, -1), 10), 'idle').kind, 'task', 'head is a real pickable sphere');
  h.camera.position.x = 9;
  h.layer.replace('project-a', [descriptor('door-01', { selected: true, title: 'Different focus' })]);
  h.scene.render(); assert.ok(Vector3.Distance(body.getAbsolutePosition(), new Vector3(2, 4.24, 3)) < .00001);
  assert.equal(h.layer.listEntries()[0]?.selected, true);
  assert.throws(() => h.layer.replace('project-a', [descriptor('door-01', { placement: { kind: 'placed', origin: [7, 3, 4] } })]), /cannot move/);
  assert.equal(h.layer.pick(h.ray, 'idle').kind, 'task', 'rejected input leaves the current layer intact');
});

test('same-place tasks and unsent drafts return an explicit chooser with each identity; unplaced stays list-accessible', t => {
  const h = setup(); t.after(() => h.dispose());
  const draft: TaskAgentDescriptor = { ...descriptor(), identity: { kind: 'draft', projectId: 'project-a', draftId: 'local-1' }, state: 'unsent' };
  h.layer.replace('project-a', [descriptor('one'), descriptor('two'), draft, descriptor('legacy', { placement: { kind: 'unplaced' } })]); h.scene.render();
  const hit = h.layer.pick(h.ray, 'idle'); assert.equal(hit.kind, 'chooser');
  assert.equal(hit.candidates.length, 3); assert.deepEqual(hit.candidates.map(id => id.kind), ['task', 'task', 'draft']);
  assert.deepEqual(h.layer.listEntries().map(entry => entry.stateLabel), ['Queued', 'Queued', 'Unsent draft', 'Queued']);
  assert.equal(h.layer.listEntries()[3]?.placement, 'unplaced');
  const anchors = h.layer.anchors(h.camera, 800, 600); assert.equal(anchors[0]?.candidates.length, 3);
  assert.ok(anchors.some(anchor => anchor.kind === 'hidden' && anchor.reason === 'unplaced'));
  h.layer.replace('project-a', [descriptor('one', { visible: false }), descriptor('two')]); h.scene.render();
  assert.deepEqual(h.layer.pick(h.ray, 'idle'), { kind: 'task', identity: descriptor('two').identity });
});

test('construction occlusion, hidden figures, markup and navigation cannot activate a task', t => {
  const h = setup(); t.after(() => h.dispose());
  h.layer.replace('project-a', [descriptor()]); h.scene.render();
  for (const interaction of ['markup', 'navigation'] satisfies ('markup' | 'navigation')[]) assert.equal(h.layer.pick(h.ray, interaction).kind, 'none');
  h.building.position.set(2, 4.4, 4.5); h.scene.render();
  assert.equal(h.layer.pick(h.ray, 'idle').kind, 'none');
  assert.ok(h.layer.anchors(h.camera, 800, 600).every(anchor => anchor.kind === 'hidden' && anchor.reason === 'occluded'));
  h.building.setEnabled(false); h.scene.render(); assert.equal(h.layer.pick(h.ray, 'idle').kind, 'task');
  h.layer.replace('project-a', [descriptor('door-01', { visible: false })]); h.scene.render();
  assert.equal(h.layer.pick(h.ray, 'idle').kind, 'none');
  assert.ok(h.layer.anchors(h.camera, 800, 600).every(anchor => anchor.kind === 'hidden' && anchor.reason === 'hidden'));
});

test('screen anchors respect perspective, orthographic views, camera direction, viewport and narrow screens', t => {
  const h = setup(); t.after(() => h.dispose());
  h.layer.replace('project-a', [descriptor()]); h.scene.render();
  for (const width of [800, 390]) {
    const anchor = h.layer.anchors(h.camera, width, 600)[0]; assert.ok(anchor?.kind === 'visible');
    assert.ok(anchor.x > 0 && anchor.x < width && anchor.y > 0 && anchor.y < 600);
  }
  h.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  h.camera.orthoLeft = -2; h.camera.orthoRight = 2; h.camera.orthoTop = 2; h.camera.orthoBottom = -2; h.scene.render();
  assert.equal(h.layer.anchors(h.camera, 800, 600)[0]?.kind, 'visible');
  h.camera.setTarget(new Vector3(2, 4.4, 9)); h.scene.render();
  assert.deepEqual(h.layer.anchors(h.camera, 800, 600)[0], { kind: 'hidden', reason: 'offscreen', identity: descriptor().identity, candidates: [descriptor().identity] });
  h.camera.position.x = 30; h.camera.setTarget(new Vector3(30, 4.4, 3)); h.scene.render();
  assert.equal(h.layer.anchors(h.camera, 800, 600)[0]?.kind, 'hidden');
});

test('only server-reported working animates; all states have text and drafts have no worker state', t => {
  const h = setup(); t.after(() => h.dispose());
  const states = ['queued', 'working', 'needs-input', 'ready', 'completed', 'rejected', 'cancelled', 'failed'] satisfies Exclude<TaskAgentDescriptor['state'], 'unsent'>[];
  for (const state of states) {
    h.layer.replace('project-a', [{ ...descriptor(), state }]);
    h.layer.renderFrame(550 * Math.PI / 2); h.scene.render();
    const root = h.scene.transformNodes.find(node => node.name.startsWith('task-agent:')); assert.ok(root);
    assert.ok(Math.abs(root.position.y - (4.24 + (state === 'working' ? .018 : 0))) < .00001);
    assert.equal(h.layer.listEntries()[0]?.stateLabel, state === 'completed' ? 'Accepted' : state === 'needs-input' ? 'Needs input' : state === 'ready' ? 'Ready for review' : state[0]?.toUpperCase() + state.slice(1));
  }
  h.layer.replace('project-a', [{ ...descriptor(), state: 'working' }]); h.layer.setReducedMotion(true); h.layer.renderFrame(800);
  assert.equal(h.scene.transformNodes[0]?.position.y, 4.24);
});

test('replacement, reconciliation, project switch and repeated disposal release only owned resources exactly once', t => {
  const h = setup(); t.after(() => h.dispose());
  const baseline = { meshes: h.scene.meshes.length, materials: h.scene.materials.length, nodes: h.scene.transformNodes.length,
    textures: h.scene.textures.length, observers: h.scene.onBeforeRenderObservable.observers.length };
  let meshDisposals = 0; let materialDisposals = 0;
  for (let index = 0; index < 10; index++) {
    h.layer.replace('project-a', [descriptor()]);
    const ownedMeshes = h.scene.meshes.filter(mesh => h.layer.ownsMesh(mesh));
    const ownedMaterials = h.scene.materials.filter(material => material.name.startsWith('task-agent:'));
    for (const mesh of ownedMeshes) mesh.onDisposeObservable.add(() => meshDisposals++);
    for (const material of ownedMaterials) material.onDisposeObservable.add(() => materialDisposals++);
    assert.ok(ownedMeshes.every(mesh => !mesh.checkCollisions && mesh.doNotSerialize));
    const serialized: unknown = SceneSerializer.Serialize(h.scene);
    assert.equal(JSON.stringify(serialized).includes('task-agent:'), false, 'task presentation is excluded from scene export');
    h.layer.replace('project-b', [{ ...descriptor(), identity: { kind: 'task', projectId: 'project-b', ticketId: 'door-01' } }]);
    assert.equal(h.layer.pick(h.ray, 'idle').kind, 'task');
    h.layer.replace('project-b', []);
    assert.deepEqual({ meshes: h.scene.meshes.length, materials: h.scene.materials.length, nodes: h.scene.transformNodes.length,
      textures: h.scene.textures.length, observers: h.scene.onBeforeRenderObservable.observers.length }, baseline);
  }
  assert.equal(meshDisposals, 70); assert.equal(materialDisposals, 40);
  h.layer.dispose(); h.layer.dispose();
  assert.equal(h.building.isDisposed(), false); assert.ok(h.scene.materials.includes(h.material)); assert.equal(h.scene.isDisposed, false);
  assert.equal(h.scene.activeCamera, h.camera); assert.equal(h.layer.pick(h.ray, 'idle').kind, 'none');
  assert.deepEqual(h.layer.listEntries(), []); assert.deepEqual(h.layer.anchors(h.camera, 800, 600), []);
});

test('invalid/project-conflicting input is atomic and descriptor mutation cannot move a rendered origin', t => {
  const h = setup(); t.after(() => h.dispose()); const item = descriptor();
  h.layer.replace('project-a', [item]);
  assert.throws(() => h.layer.replace('wrong-project', [item]), /project conflict/);
  assert.throws(() => h.layer.replace('project-a', [item, item]), /conflict/);
  assert.throws(() => h.layer.replace('project-a', [descriptor('bad', { placement: { kind: 'placed', origin: [NaN, 0, 0] } })]), /envelope/);
  assert.equal(h.layer.listEntries().length, 1);
});
