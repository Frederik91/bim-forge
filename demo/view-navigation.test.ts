import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { ModelScene } from './model-scene.ts';
import { ViewNavigation, walkElevation } from './view-navigation.ts';
import type { NavigationContext } from './view-navigation.ts';
import { projectIdentifier } from '../src/room-model.ts';
import { multiStoreySnapshot } from '../src/multi-storey-house.ts';

test('native slab Walk requires real level support, respects holes/stairs/walls and keeps native elevations', () => {
  const snapshot = multiStoreySnapshot();
  const context: NavigationContext = { projectId: null, sourcePin: 'fixture-r1', levelId: 'level-ground', snapshot };
  assert.equal(walkElevation(context, 2, 3), 1.6);
  assert.equal(walkElevation({ ...context, levelId: 'level-basement' }, 2, 3), -1.4);
  assert.equal(walkElevation({ ...context, levelId: 'level-attic' }, 2, 3), 4.6);
  for (const [x, y] of [[-.2, 3], [.1, 3], [4, 3], [2, 1.5], [6, 1.5], [1, 4.8]]) {
    assert.equal(walkElevation(context, x, y), null, `unsupported/blocked ${x},${y}`);
  }
  assert.equal(walkElevation({ ...context, levelId: null }, 2, 3), null);
  assert.equal(walkElevation({ ...context, snapshot: { ...snapshot, entities: snapshot.entities.filter(item => item.type !== 'Slab') } }, 2, 3), null);
});

test('real active perspective camera, picking, explicit return and source-safe per-project session preserve one scene/model', t => {
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 256, deterministicLockstep: true, lockstepMaxSteps: 4 });
  const model = new ModelScene(engine); const navigation = new ViewNavigation(model);
  t.after(() => { navigation.dispose(); model.dispose(); engine.dispose(); });
  const snapshot = multiStoreySnapshot(); const before = JSON.stringify(snapshot);
  model.setModel(snapshot); model.setLevel('level-ground'); model.setCutaway(true);
  const context: NavigationContext = { projectId: projectIdentifier('11111111-1111-1111-1111-111111111111'), sourcePin: 'r1', levelId: 'level-ground', snapshot };
  navigation.setContext(context);
  const scene = model.scene; const cameras = [...scene.cameras]; const meshes = [...scene.meshes];
  assert.equal(navigation.change({ kind: 'inside', motion: 'walk', entry: [2, 3, 99] }).kind, 'changed');
  assert.equal(model.activeCamera, model.insideCamera); scene.render();
  assert.equal(model.activeCamera.position.y, 1.6);
  assert.ok(scene.meshes.filter(mesh => mesh.name.includes('level-ground-wall-')).every(mesh => mesh.isEnabled()), 'Inside does not hide walls as cutaway');
  const pose = navigation.capture(); assert.ok(pose);
  assert.deepEqual(pose.eye, [2, 3, 1.6]);
  const rolled = { ...pose, forward: [1, 0, 0], up: [0, 1, 0] } satisfies typeof pose;
  assert.equal(navigation.returnTo(rolled).kind, 'changed');
  const restored = navigation.capture(); assert.ok(restored);
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(restored.forward[axis] - rolled.forward[axis]) < 1e-6);
    assert.ok(Math.abs(restored.up[axis] - rolled.up[axis]) < 1e-6);
  }
  assert.equal(navigation.returnTo(pose).kind, 'changed'); scene.render();
  const point = Vector3.Project(new Vector3(2, 1.6, 6), Matrix.IdentityReadOnly, scene.getTransformMatrix(), model.activeCamera.viewport.toGlobal(800, 600));
  assert.ok(model.objectAt(point.x, point.y)?.includes('wall-north'), 'native pick uses active perspective camera');
  for (let i = 0; i < 8; i++) {
    assert.equal(navigation.change({ kind: 'plan' }).kind, 'changed');
    assert.equal(navigation.capture(), null);
    navigation.change({ kind: 'overview' }); model.frame();
    assert.equal(navigation.change({ kind: 'inside', motion: 'walk' }).kind, 'changed');
    assert.deepEqual(navigation.capture()?.eye, pose.eye);
  }
  assert.equal(navigation.change({ kind: 'section' }).kind, 'unsupported');
  assert.equal(model.activeCamera, model.insideCamera);
  assert.equal(navigation.returnTo({ ...pose, sourcePin: 'old' }).kind, 'unsupported');
  navigation.setContext({ ...context, sourcePin: 'r2' });
  assert.equal(navigation.state.kind, 'overview');
  assert.equal(navigation.returnTo(pose).kind, 'unsupported');
  navigation.setContext(context);
  assert.equal(navigation.returnTo(pose).kind, 'changed');
  navigation.setContext({ ...context, projectId: projectIdentifier('22222222-2222-2222-2222-222222222222') });
  assert.equal(navigation.returnTo(pose).kind, 'unsupported');
  navigation.setContext(context);
  assert.equal(navigation.change({ kind: 'inside', motion: 'walk' }).kind, 'changed');
  assert.deepEqual(navigation.capture()?.eye, pose.eye);
  navigation.setContext({ ...context, levelId: 'level-attic' });
  assert.equal(navigation.returnTo(pose).kind, 'unsupported');
  assert.equal(navigation.returnTo({ ...pose, sourcePin: 'old' }, { allowLevelChange: true }).kind, 'unsupported');
  assert.equal(navigation.returnTo({ ...pose, projectId: null }, { allowLevelChange: true }).kind, 'unsupported');
  assert.equal(navigation.returnTo(pose, { allowLevelChange: true }).kind, 'changed', 'An explicit task return may revisit its supported floor');
  assert.equal(navigation.capture()?.levelId, 'level-ground');
  navigation.setContext({ ...context, levelId: 'level-attic' });
  assert.equal(navigation.change({ kind: 'inside', motion: 'walk', entry: [6, 1.5, 3] }).kind, 'unsupported');
  assert.equal(navigation.change({ kind: 'inside', motion: 'fly', entry: [6, 1.5, 8] }).kind, 'changed');
  assert.deepEqual(scene.cameras, cameras); assert.deepEqual(scene.meshes, meshes);
  assert.equal(model.scene, scene); assert.equal(JSON.stringify(snapshot), before);
});
