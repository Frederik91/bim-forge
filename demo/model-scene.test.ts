import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { ModelScene, entityAnchor, modelPoint, referenceFromHit, referencePosition } from './model-scene.ts';
import { RoomRepository, previewFurnishings, diffSnapshots } from '../src/room-model.ts';
import { createHousePilotFixture } from '../src/house-pilot.ts';
import { modelChanges } from '../src/model-delta-view.ts';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { viewerBuilding } from './building-viewer-fixture.ts';
import { roofHeightAt } from '../src/building-levels.ts';
import { validateSnapshot } from '../src/room-model.ts';
import type { SpatialReference } from '../src/visual-request.ts';
import { assetGeometry } from '../src/asset-family.ts';
import { familyViewerSnapshot } from './generated-family-viewer-fixture.ts';

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

test('3D delta retains before ghosts for moved and removed objects, solid additions and a stable camera without changing either revision', async (t) => {
  const engine = new NullEngine(); const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const repo = await RoomRepository.create();
  const before = previewFurnishings(repo.view(repo.head('main')).snapshot, { furnishings });
  const after = previewFurnishings(before, { furnishings: [
    ...furnishings.filter((item) => item.id !== 'plant-test').map((item) => ['desk-test', 'screen-test', 'laptop-test', 'chair-test'].includes(item.id) ? { ...item, position: [item.position[0] - 1, item.position[1]] } : item),
    { ...furnishings[5], id: 'new-plant', position: [4.7, 1.5] },
  ] });
  const original = JSON.stringify([before, after]);
  const changes = modelChanges(before, after);
  assert.deepEqual(changes.filter((item) => item.status === 'added').map((item) => item.id), ['new-plant']);
  assert.deepEqual(changes.filter((item) => item.status === 'removed').map((item) => item.id), ['plant-test']);
  assert.equal(changes.filter((item) => item.status === 'modified').length, 4);
  viewer.setModel(after, before); viewer.setCutaway(false); viewer.scene.render();
  const ghost = viewer.scene.meshes.find((mesh) => mesh.name.startsWith('before:desk-test')); assert.ok(ghost);
  assert.ok(ghost.material instanceof StandardMaterial && ghost.material.wireframe);
  assert.equal(ghost.material.name, 'delta:modified-before');
  assert.ok(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('before:plant-test') && mesh.material?.name === 'delta:removed-before'));
  assert.ok(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('new-plant') && mesh.material?.name === 'delta:added'));
  assert.ok(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('change-path:desk-test')));
  assert.equal(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('before:table-test')), false, 'unchanged objects do not get ghosts');
  assert.ok(viewer.anchorOnScreen('plant-test', 800, 600), 'removed objects remain inspectable');
  const camera = viewer.camera; camera.alpha = .45;
  viewer.setMode('basic'); viewer.setMode('realistic');
  assert.equal(viewer.camera.alpha, .45); assert.equal(viewer.camera, camera);
  assert.equal(viewer.setModel(structuredClone(after), structuredClone(before)), false);
  viewer.setModel(after); assert.ok(ghost.isDisposed());
  assert.equal(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('before:')), false);
  assert.equal(JSON.stringify([before, after]), original);
});

test('3D delta includes opening placement and host geometry when only hosting relationships change', async () => {
  const { previewRectangle, rectangleLayout } = await import('../src/room-model.ts');
  const repo = await RoomRepository.create(); const base = repo.view(repo.head('main')).snapshot;
  const layout = rectangleLayout(base); const after = previewRectangle(base, { ...layout, door: { ...layout.door, offsetMm: layout.door.offsetMm + 200 } });
  const delta = diffSnapshots(base, after); assert.equal(delta.entities.modified.length, 0);
  const changes = modelChanges(base, after);
  assert.ok(changes.some((item) => item.id === 'door-entry' && item.reason === 'placement' && item.status === 'modified'));
  assert.ok(changes.some((item) => item.id === 'wall-south' && item.reason === 'placement'));
});

test('derived support elevation and door-size gaps appear in the 3D delta even without changed relationship records', async () => {
  const { previewRectangle, rectangleLayout } = await import('../src/room-model.ts');
  const repo = await RoomRepository.create(); const shell = repo.view(repo.head('main')).snapshot;
  const before = previewFurnishings(shell, { furnishings });
  const after = previewFurnishings(before, { furnishings: furnishings.map((item) => item.id === 'desk-test' ? { ...item, height: .85 } : item) });
  assert.ok(modelChanges(before, after).some((item) => item.id === 'screen-test' && item.reason === 'placement'));
  assert.ok(modelChanges(before, after).some((item) => item.id === 'laptop-test' && item.reason === 'placement'));
  const layout = rectangleLayout(shell);
  const wider = previewRectangle(shell, { ...layout, door: { ...layout.door, widthMm: 1000 } });
  assert.ok(modelChanges(shell, wider).some((item) => item.id === 'wall-south' && item.reason === 'placement'));
});

test('a residential floor renders shared walls once, frames a room without editing geometry and retains whole-floor deltas', async (t) => {
  const { residentialFloor } = await import('../src/residential-floor.ts');
  const engine = new NullEngine(); const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const before = residentialFloor(); const original = JSON.stringify(before);
  viewer.setModel(before); viewer.setMode('basic'); viewer.setCutaway(false); viewer.scene.render();
  assert.equal(viewer.scene.meshes.filter((mesh) => mesh.name.endsWith('-floor')).length, 8);
  assert.ok(viewer.scene.meshes.some((mesh) => mesh.name === 'room-office-floor'));
  assert.deepEqual(viewer.camera.target.asArray(), [6, .6, 4.5]);
  const wholeRadius = viewer.camera.radius;
  viewer.frame('room-office'); viewer.scene.render();
  assert.deepEqual(viewer.camera.target.asArray(), [10.5, .6, 2]);
  assert.ok(viewer.camera.radius < wholeRadius);
  viewer.setCutaway(true); viewer.scene.render();
  assert.ok(viewer.scene.meshes.filter((mesh) => mesh.name.startsWith('wall-south-solid-')).every((mesh) => !mesh.isEnabled()), 'a long exterior wall must not obscure an off-centre focused room');
  viewer.setCutaway(false);
  viewer.setMode('realistic'); viewer.scene.render();
  assert.deepEqual(viewer.camera.target.asArray(), [10.5, .6, 2]);
  viewer.frame(null); assert.deepEqual(viewer.camera.target.asArray(), [6, .6, 4.5]);
  const after = previewFurnishings(before, { furnishings: before.entities.filter((item) => item.type === 'Furniture')
    .map((item) => item.id === 'office-plant' ? { ...item, position: [11.4, 2.8] } : item) });
  viewer.setModel(after, before); viewer.scene.render();
  assert.ok(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('before:office-plant')));
  assert.equal(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('before:living-sofa')), false);
  assert.equal(JSON.stringify(before), original);
});

test('legacy floor references stay visible on an isolated residential level without changing their wire shape or model', async (t) => {
  const { residentialFloor } = await import('../src/residential-floor.ts');
  const engine = new NullEngine(); const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const snapshot = residentialFloor(); const saved = JSON.stringify(snapshot);
  const reference: SpatialReference = { kind: 'floor-point', positionMm: [10000, 1000] };
  const savedReference = JSON.stringify(reference);
  viewer.setModel(snapshot); viewer.setMode('basic'); viewer.setLevel('level-ground'); viewer.select('office-plant');
  viewer.mark(reference); viewer.scene.render();
  for (const name of ['request-marker-not-geometry', 'request-reference-line']) {
    const mesh = viewer.scene.meshes.find((item) => item.name === name); assert.ok(mesh);
    assert.equal(mesh.isEnabled(), true, `${name} remains visible on the legacy level`);
  }
  assert.equal(JSON.stringify(reference), savedReference);
  assert.equal(JSON.stringify(snapshot), saved);
});

test('stacked geometry applies each floor elevation once, including supported furniture, openings and equipment', (t) => {
  const engine = new NullEngine(); const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const snapshot = viewerBuilding(); const saved = JSON.stringify(snapshot);
  viewer.setModel(snapshot); viewer.setMode('basic'); viewer.setCutaway(false); viewer.scene.render();
  const minimum = (prefix: string) => Math.min(...viewer.scene.meshes.filter((mesh) => mesh.name.startsWith(prefix)).map((mesh) => mesh.getBoundingInfo().boundingBox.minimumWorld.y));
  for (const [id, elevation] of [['basement', -3], ['ground', 0], ['attic', 3]] satisfies [string, number][]) {
    assert.ok(Math.abs(minimum(id + '-desk') - elevation) < 1e-5);
    assert.ok(Math.abs(minimum(id + '-screen') - elevation - .75) < 1e-5);
    assert.ok(Math.abs(minimum(id + '-equipment') - elevation - .3) < 1e-5);
    assert.ok(Math.abs(minimum(id + '-slab') - elevation + .2) < 1e-5);
    const door = snapshot.entities.find((item) => item.id === id + '-door'); assert.ok(door);
    assert.equal(entityAnchor(door, snapshot).y, elevation + .6);
  }
  assert.equal(viewer.scene.meshes.some((mesh) => mesh.name.endsWith('-floor')), false, 'explicit slabs replace synthetic room floors');
  const top = viewer.scene.meshes.find((mesh) => mesh.name === 'stairs-upper-step-12'); assert.ok(top);
  assert.ok(Math.abs(top.getBoundingInfo().boundingBox.maximumWorld.y - 3) < 1e-5);
  assert.equal(JSON.stringify(snapshot), saved);
});

test('incoming stair footprints are real slab voids and ray picking preserves the selected floor', (t) => {
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 256, deterministicLockstep: true, lockstepMaxSteps: 4 });
  const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  viewer.setModel(viewerBuilding()); viewer.setMode('basic'); viewer.setLevel('ground'); viewer.setCutaway(false); viewer.scene.render();
  const slab = (mesh: { name: string }) => mesh.name.startsWith('ground-slab');
  const hole = viewer.scene.pickWithRay(new Ray(modelPoint(1.5, 1, 1), new Vector3(0, -1, 0), 1.1), slab);
  assert.equal(hole?.hit, false, 'the whole incoming footprint must be open');
  const solid = viewer.scene.pickWithRay(new Ray(modelPoint(4.5, 1, 1), new Vector3(0, -1, 0), 1.1), slab);
  assert.ok(solid?.hit); assert.ok(Math.abs(solid.pickedPoint?.y ?? Infinity) < 1e-5);
  const outgoing = viewer.scene.pickWithRay(new Ray(modelPoint(1.5, 3, 1), new Vector3(0, -1, 0), 1.1), slab);
  assert.ok(outgoing?.hit, 'outgoing stairs do not remove the slab at their lower landing');
  viewer.setCutaway(true); viewer.scene.render();
  const screen = Vector3.Project(modelPoint(4.5, 1, 0), Matrix.IdentityReadOnly, viewer.scene.getTransformMatrix(), viewer.camera.viewport.toGlobal(800, 600));
  const reference = viewer.referenceAt(screen.x, screen.y);
  assert.ok(reference?.kind === 'floor-point'); assert.equal(reference.levelId, 'ground');
  assert.ok(Math.abs(reference.positionMm[0] - 4500) <= 2); assert.ok(Math.abs(reference.positionMm[1] - 1000) <= 2);
});

test('pitched roof solids and gable wall vertices meet the shared roof underside at eaves and ridge', (t) => {
  const engine = new NullEngine(); const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const snapshot = viewerBuilding();
  viewer.setModel(snapshot); viewer.setMode('basic'); viewer.setCutaway(false); viewer.scene.render();
  const walls = viewer.scene.meshes.filter((mesh) => mesh.name.startsWith('attic-west-solid-'));
  const vertices = walls.flatMap((mesh) => {
    const positions = mesh.getVerticesData('position') ?? []; const result: Vector3[] = [];
    for (let i = 0; i < positions.length; i += 3) result.push(new Vector3(positions[i], positions[i + 1], positions[i + 2]));
    return result;
  });
  assert.ok(vertices.some((p) => Math.abs(p.z - 2) < 1e-5 && Math.abs(p.y - 6.4) < 1e-5), 'gable ends retain the ridge vertex');
  assert.ok(vertices.some((p) => Math.abs(p.z) < 1e-5 && Math.abs(p.y - 5.2) < 1e-5));
  for (const p of vertices) assert.ok(p.y <= 3 + roofHeightAt(snapshot, 'attic', [0, p.z]) + 1e-5);
  const pitches = viewer.scene.meshes.filter((mesh) => mesh.name.startsWith('house-roof-pitch-'));
  assert.equal(pitches.length, 2);
  assert.ok(Math.abs(Math.max(...pitches.map((mesh) => mesh.getBoundingInfo().boundingBox.maximumWorld.y)) - 6.6) < 1e-5);
  assert.ok(Math.abs(Math.min(...pitches.map((mesh) => mesh.getBoundingInfo().boundingBox.minimumWorld.y)) - 5.2) < 1e-5);
  viewer.setMode('realistic'); viewer.scene.render();
  assert.ok(pitches.every((mesh) => mesh.material instanceof PBRMaterial));
  assert.ok(walls.some((mesh) => (mesh.getVerticesData('normal') ?? []).some((value, i) => i % 3 === 1 && value > .5)), 'pitched wall tops have outward normals for realistic lighting');
});

test('level isolation and roof visibility compose with cutaway, framing and annotation visibility without rebuilding geometry', (t) => {
  const engine = new NullEngine(); const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const snapshot = viewerBuilding(); const saved = JSON.stringify(snapshot);
  viewer.setModel(snapshot); viewer.setMode('basic'); viewer.setCutaway(false); viewer.scene.render();
  const camera = viewer.camera; const meshes = [...viewer.scene.meshes]; const allRadius = camera.radius;
  assert.ok(camera.target.y > 0 && camera.target.y < 3, 'building framing includes basement and roof height');
  viewer.setLevel('basement'); viewer.scene.render();
  assert.ok(camera.target.y < 0); assert.ok(camera.radius < allRadius);
  assert.ok(viewer.scene.meshes.filter((mesh) => mesh.name.startsWith('attic-')).every((mesh) => !mesh.isEnabled()));
  viewer.mark({ kind: 'floor-point', levelId: 'basement', positionMm: [4000, 1000] });
  const marker = viewer.scene.meshes.find((mesh) => mesh.name === 'request-marker-not-geometry'); assert.ok(marker);
  assert.equal(marker.position.y, -2.975);
  viewer.setLevel('attic'); viewer.setRoofVisible(false); viewer.setCutaway(true); viewer.scene.render();
  assert.equal(marker.isEnabled(), false);
  assert.ok(meshes.filter((mesh) => mesh.name.startsWith('house-roof')).every((mesh) => !mesh.isEnabled()));
  assert.ok(meshes.filter((mesh) => mesh.name.startsWith('ground-desk')).every((mesh) => !mesh.isEnabled()));
  viewer.setCutaway(false); viewer.setRoofVisible(true); viewer.scene.render();
  assert.ok(meshes.filter((mesh) => mesh.name.startsWith('house-roof')).every((mesh) => mesh.isEnabled()));
  assert.equal(viewer.camera, camera); assert.deepEqual(viewer.scene.meshes.filter((mesh) => mesh !== marker), meshes);
  assert.equal(viewer.setModel(snapshot), false); assert.equal(JSON.stringify(snapshot), saved);
});

test('building floor annotations require explicit levels and wall annotations inherit the host elevation', () => {
  const snapshot = viewerBuilding();
  assert.equal(referenceFromHit(snapshot, modelPoint(4, 1, 0), null), null);
  assert.equal(referenceFromHit(snapshot, modelPoint(4, 1, 0), null, 'missing-level'), null);
  for (const [levelId, elevation] of [['basement', -3], ['ground', 0], ['attic', 3]] satisfies [string, number][]) {
    const reference = referenceFromHit(snapshot, modelPoint(4.1234, 1.2345, elevation), null, levelId);
    assert.deepEqual(reference, { kind: 'floor-point', levelId, positionMm: [4123, 1235] }); assert.ok(reference);
    assert.equal(referencePosition(reference, snapshot).y, elevation + .025);
    assert.equal(referencePosition({ kind: 'wall-point', wallId: levelId + '-shared', alongWallMm: 1000 }, snapshot).y, elevation + .08);
  }
  assert.throws(() => referencePosition({ kind: 'floor-point', positionMm: [4000, 1000] }, snapshot), /level/);
});

test('level elevation and incoming stair changes produce derived object and slab-void deltas with before ghosts', (t) => {
  const engine = new NullEngine(); const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const before = viewerBuilding();
  const after = validateSnapshot({ ...before, entities: before.entities.map((item) => item.id === 'attic' ? { ...item, elevation: 3.5 } : item) });
  const changes = modelChanges(before, after);
  for (const id of ['attic-desk', 'attic-screen', 'attic-door', 'attic-equipment', 'attic-slab', 'house-roof', 'stairs-upper']) {
    assert.ok(changes.some((item) => item.id === id && item.reason === 'placement'), `${id} follows its changed level`);
  }
  assert.equal(changes.some((item) => item.id === 'basement-desk' || item.id === 'ground-desk'), false);
  viewer.setModel(after, before); viewer.setMode('basic'); viewer.setLevel('attic'); viewer.setCutaway(false); viewer.scene.render();
  assert.ok(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('before:house-roof')));
  assert.ok(viewer.scene.meshes.some((mesh) => mesh.name === 'change-path:attic-desk'));
  const moved = validateSnapshot({ ...before, entities: before.entities.map((item) => item.id === 'stairs-upper' ? { ...item, start: [.5, 2.8], end: [2.5, 2.8] } : item) });
  assert.ok(modelChanges(before, moved).some((item) => item.id === 'attic-slab' && item.reason === 'placement'));
  assert.equal(modelChanges(before, moved).some((item) => item.id === 'ground-slab'), false);
});

test('roof changes derive clipped-wall deltas and flat roofs have physical thickness', (t) => {
  const engine = new NullEngine(); const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const before = viewerBuilding();
  const after = validateSnapshot({ ...before, entities: before.entities.map((item) => item.type === 'Roof' ? { ...item, profile: { kind: 'flat', height: 3 } } : item) });
  assert.ok(modelChanges(before, after).some((item) => item.id === 'attic-west' && item.reason === 'placement'));
  assert.equal(modelChanges(before, after).some((item) => item.id === 'ground-west'), false);
  viewer.setModel(after); viewer.setMode('basic'); viewer.setCutaway(false); viewer.scene.render();
  const roof = viewer.scene.meshes.find((mesh) => mesh.name === 'house-roof-pitch-0'); assert.ok(roof);
  assert.ok(Math.abs(roof.getBoundingInfo().boundingBox.minimumWorld.y - 5.8) < 1e-5);
  assert.ok(Math.abs(roof.getBoundingInfo().boundingBox.maximumWorld.y - 6) < 1e-5);
});

test('before slab ghosts stay inspectable but cannot intercept a current-floor reference ray', (t) => {
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 256, deterministicLockstep: true, lockstepMaxSteps: 4 });
  const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const initial = viewerBuilding();
  const before = validateSnapshot({ ...initial, entities: initial.entities.map((item) => item.id === 'attic' ? { ...item, elevation: 3.5 } : item) });
  const after = validateSnapshot({ ...before, entities: before.entities.map((item) => item.id === 'attic' ? { ...item, elevation: 3 } : item) });
  viewer.setModel(after, before); viewer.setMode('basic'); viewer.setLevel('attic'); viewer.setRoofVisible(false); viewer.setCutaway(true);
  viewer.camera.beta = .08; viewer.scene.render();
  assert.ok(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('before:attic-slab') && mesh.isEnabled()));
  const screen = Vector3.Project(modelPoint(4.5, 1, 3), Matrix.IdentityReadOnly, viewer.scene.getTransformMatrix(), viewer.camera.viewport.toGlobal(800, 600));
  const reference = viewer.referenceAt(screen.x, screen.y);
  assert.ok(reference?.kind === 'floor-point'); assert.equal(reference.levelId, 'attic');
  assert.ok(Math.abs(reference.positionMm[0] - 4500) <= 2); assert.ok(Math.abs(reference.positionMm[1] - 1000) <= 2);
});

test('generated families render exact instance heights and unrelated geometry in both modes without changing definitions', async (t) => {
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 256, deterministicLockstep: true, lockstepMaxSteps: 4 });
  const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const repo = await RoomRepository.create(); const snapshot = familyViewerSnapshot(repo.view(repo.head('main')).snapshot);
  const saved = JSON.stringify(snapshot);
  viewer.setModel(snapshot); viewer.setCutaway(true); viewer.select('person-187');
  const meshes = [...viewer.scene.meshes];
  for (const mode of ['basic', 'realistic'] satisfies ('basic' | 'realistic')[]) {
    viewer.setMode(mode); viewer.scene.render();
    for (const [id, height] of [['person-187', 1.87], ['person-165', 1.65], ['plinth-one', .8]] satisfies [string, number][]) {
      const item = snapshot.entities.find((entity) => entity.type === 'AssetInstance' && entity.id === id); assert.ok(item?.type === 'AssetInstance');
      const own = viewer.scene.meshes.filter((mesh) => mesh.name.startsWith(id + '-')); assert.ok(own.length);
      assert.ok(Math.abs(Math.min(...own.map((mesh) => mesh.getBoundingInfo().boundingBox.minimumWorld.y))) < 1e-6);
      assert.ok(Math.abs(Math.max(...own.map((mesh) => mesh.getBoundingInfo().boundingBox.maximumWorld.y)) - height) < 1e-6);
      assert.equal(assetGeometry(snapshot, item).bounds.maxZ, height);
      assert.equal(assetGeometry(snapshot, item).dimensions.height, height);
      assert.ok(own.every((mesh) => mode === 'basic' ? mesh.material instanceof StandardMaterial : mesh.material instanceof PBRMaterial));
    }
    const body = viewer.scene.meshes.find((mesh) => mesh.name === 'person-187-#507a92'); assert.ok(body);
    const color = body.material instanceof PBRMaterial ? body.material.albedoColor : body.material instanceof StandardMaterial ? body.material.diffuseColor : null;
    assert.equal(color?.toHexString().toLowerCase(), '#507a92');
    const point = Vector3.Project(modelPoint(3.6, .8, 1.8), Matrix.IdentityReadOnly, viewer.scene.getTransformMatrix(), viewer.camera.viewport.toGlobal(800, 600));
    assert.equal(viewer.objectAt(point.x, point.y), 'person-187', 'all primitive parts pick the owning instance');
  }
  const plinth = viewer.scene.meshes.filter((mesh) => mesh.name.startsWith('plinth-one-'));
  assert.ok(Math.abs(Math.min(...plinth.map((mesh) => mesh.getBoundingInfo().boundingBox.minimumWorld.x)) - 5.2) < 1e-6);
  assert.ok(Math.abs(Math.max(...plinth.map((mesh) => mesh.getBoundingInfo().boundingBox.maximumWorld.z)) - 1.1) < 1e-6, 'world XY is already rotated by the evaluator');
  for (const family of snapshot.entities.filter((item) => item.type === 'AssetFamily')) {
    assert.equal(viewer.scene.meshes.some((mesh) => mesh.name.startsWith(family.id)), false);
    assert.equal(viewer.anchorOnScreen(family.id, 800, 600), null);
  }
  assert.ok(viewer.scene.meshes.filter((mesh) => mesh.name.startsWith('person-187-')).every((mesh) => mesh.renderOutline));
  assert.deepEqual(viewer.scene.meshes, meshes);
  assert.equal(JSON.stringify(snapshot), saved);
});

test('resizing one generated instance retains its family, ghosts and isolated delta without changing another size of that family', async (t) => {
  const engine = new NullEngine(); const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const repo = await RoomRepository.create(); const before = familyViewerSnapshot(repo.view(repo.head('main')).snapshot);
  const saved = JSON.stringify(before);
  const after = validateSnapshot({ ...before, entities: before.entities.map((item) => item.type === 'AssetInstance' && item.id === 'person-187'
    ? { ...item, size: { ...item.size, height: 2.1 } } : item) });
  assert.deepEqual(modelChanges(before, after).map((item) => item.id), ['person-187']);
  viewer.setModel(after, before); viewer.setMode('basic'); viewer.setCutaway(false); viewer.scene.render();
  const ghosts = viewer.scene.meshes.filter((mesh) => mesh.name.startsWith('before:person-187-')); assert.ok(ghosts.length);
  const solids = viewer.scene.meshes.filter((mesh) => mesh.name.startsWith('person-187-')); assert.ok(solids.length);
  assert.ok(Math.abs(Math.max(...ghosts.map((mesh) => mesh.getBoundingInfo().boundingBox.maximumWorld.y)) - 1.87) < 1e-6);
  assert.ok(Math.abs(Math.max(...solids.map((mesh) => mesh.getBoundingInfo().boundingBox.maximumWorld.y)) - 2.1) < 1e-6);
  assert.ok(ghosts.every((mesh) => mesh.material instanceof StandardMaterial && mesh.material.wireframe));
  assert.ok(viewer.scene.meshes.some((mesh) => mesh.name === 'change-path:person-187'));
  assert.equal(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('before:person-165-') || mesh.name.startsWith('before:plinth-one-')), false);
  assert.equal(JSON.stringify(before), saved);
});

test('room-owned generated instances follow their level exactly once, including anchors, ghosts and visibility', (t) => {
  const engine = new NullEngine(); const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const before = familyViewerSnapshot(viewerBuilding(), 'attic-right');
  const saved = JSON.stringify(before);
  const after = validateSnapshot({ ...before, entities: before.entities.map((item) => item.id === 'attic' ? { ...item, elevation: 3.5 } : item) });
  for (const id of ['person-187', 'person-165', 'plinth-one']) assert.ok(modelChanges(before, after).some((item) => item.id === id && item.reason === 'placement'));
  viewer.setModel(after, before); viewer.setMode('basic'); viewer.setLevel('attic'); viewer.setRoofVisible(false); viewer.setCutaway(false); viewer.scene.render();
  const solids = viewer.scene.meshes.filter((mesh) => mesh.name.startsWith('person-187-'));
  const ghosts = viewer.scene.meshes.filter((mesh) => mesh.name.startsWith('before:person-187-'));
  assert.ok(solids.length && ghosts.length);
  assert.ok(Math.abs(Math.min(...solids.map((mesh) => mesh.getBoundingInfo().boundingBox.minimumWorld.y)) - 3.5) < 1e-6);
  assert.ok(Math.abs(Math.max(...solids.map((mesh) => mesh.getBoundingInfo().boundingBox.maximumWorld.y)) - 5.37) < 1e-6);
  assert.ok(Math.abs(Math.max(...ghosts.map((mesh) => mesh.getBoundingInfo().boundingBox.maximumWorld.y)) - 4.87) < 1e-6);
  const item = after.entities.find((entity) => entity.id === 'person-187'); assert.ok(item);
  assert.ok(Math.abs(entityAnchor(item, after).y - 5.52) < 1e-6);
  assert.ok([...solids, ...ghosts].every((mesh) => mesh.isEnabled()));
  viewer.setLevel('ground'); viewer.scene.render();
  assert.ok([...solids, ...ghosts].every((mesh) => !mesh.isEnabled()));
  assert.equal(viewer.scene.meshes.find((mesh) => mesh.name === 'change-path:person-187')?.isEnabled(), false);
  assert.equal(JSON.stringify(before), saved);
});

test('explicit family reassignment preserves the original definition and reviews the new definition without rendering it', async (t) => {
  const engine = new NullEngine(); const viewer = new ModelScene(engine); t.after(() => { viewer.dispose(); engine.dispose(); });
  const repo = await RoomRepository.create(); const before = familyViewerSnapshot(repo.view(repo.head('main')).snapshot);
  const family = before.entities.find((item) => item.type === 'AssetFamily' && item.id === 'standing-person'); assert.ok(family?.type === 'AssetFamily');
  const replacement = { ...family, id: 'revised-figure', name: 'Revised figure proxy', parts: family.parts.map((part) => ({ ...part, color: '#bb6633' })) };
  const after = validateSnapshot({ ...before, entities: [...before.entities.map((item) => item.type === 'AssetInstance' && item.id === 'person-187'
    ? { ...item, familyId: replacement.id } : item), replacement] });
  const changes = modelChanges(before, after);
  assert.deepEqual(changes.map((item) => [item.id, item.status]), [['person-187', 'modified'], ['revised-figure', 'added']]);
  assert.deepEqual(after.entities.find((item) => item.id === family.id), family);
  viewer.setModel(after, before); viewer.setMode('realistic'); viewer.setCutaway(false); viewer.scene.render();
  assert.ok(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('before:person-187-')));
  assert.ok(viewer.scene.meshes.some((mesh) => mesh.name === 'person-187-#bb6633'));
  assert.equal(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('standing-person') || mesh.name.startsWith('revised-figure')), false);
  assert.equal(viewer.scene.meshes.some((mesh) => mesh.name.startsWith('before:person-165-')), false);
});
