import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { SceneMeshBatches } from './model-scene-batches.ts';
import { ModelScene, modelPoint } from './model-scene.ts';
import { productionViewerFixture } from './production-viewer-fixture.ts';
import { RoomRepository, validateSnapshot } from '../src/room-model.ts';
import type { ModelSnapshot } from '../src/room-model.ts';

function engine(): NullEngine {
  return new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 256, deterministicLockstep: true, lockstepMaxSteps: 4 });
}
function geometry(viewer: ModelScene): string[] {
  const triangles: string[] = [];
  for (const mesh of viewer.scene.meshes) {
    if (!mesh.geometry || !mesh.isVisible || !mesh.isEnabled()) continue;
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind); const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
    const uvs = mesh.getVerticesData(VertexBuffer.UVKind); const indices = mesh.getIndices();
    if (!positions || !indices || !normals || !uvs) continue;
    const world = mesh.computeWorldMatrix(); const normalMatrix = Matrix.Transpose(world.clone().invert());
    const rounded = (value: number): string => (Math.abs(value) < .000005 ? 0 : value).toFixed(5);
    for (let i = 0; i < indices.length; i += 3) triangles.push([indices[i], indices[i + 1], indices[i + 2]].map(index => {
      const p = Vector3.TransformCoordinates(Vector3.FromArray(positions, index * 3), world);
      const n = Vector3.TransformNormal(Vector3.FromArray(normals, index * 3), normalMatrix).normalize();
      return [...p.asArray(), ...n.asArray(), uvs[index * 2], uvs[index * 2 + 1]].map(rounded).join(',');
    }).join('|'));
  }
  return triangles.sort();
}

test('production batching preserves every triangle, normal and UV in both material modes', async () => {
  const fixture = await productionViewerFixture(); const a = engine(); const b = engine();
  const baseline = new ModelScene(a, 'off'); const batched = new ModelScene(b);
  const original = JSON.stringify(fixture.accepted);
  try {
    baseline.setModel(fixture.accepted, null, fixture.projectId); batched.setModel(fixture.accepted, null, fixture.projectId);
    baseline.setCutaway(false); batched.setCutaway(false);
    assert.ok(batched.renderResources().batchedParts >= 48);
    assert.ok(batched.renderResources().batches < batched.renderResources().parts / 2);
    for (const mode of ['basic', 'realistic'] satisfies ('basic' | 'realistic')[]) {
      baseline.setMode(mode); batched.setMode(mode); baseline.scene.render(); batched.scene.render();
      assert.deepEqual(geometry(batched), geometry(baseline));
    }
    assert.equal(JSON.stringify(fixture.accepted), original);
  } finally { baseline.dispose(); batched.dispose(); a.dispose(); b.dispose(); }
});

test('visibility changes retain vertex buffers and stable picked IDs through highlight and isolation', async () => {
  const fixture = await productionViewerFixture(); const gpu = engine(); const viewer = new ModelScene(gpu);
  try {
    viewer.setModel(fixture.accepted, null, fixture.projectId); viewer.setCutaway(false); viewer.setMode('basic');
    const vertices = viewer.renderResources().totalVertexUploads;
    const buffers = new Map(viewer.scene.meshes.filter(mesh => mesh.name.startsWith('bim-batch-')).map(mesh => [mesh, mesh.getVertexBuffer(VertexBuffer.PositionKind)?.getBuffer()]));
    viewer.setLevel('attic'); viewer.setLevel('ground'); viewer.setRoofVisible(false); viewer.setRoofVisible(true);
    assert.equal(viewer.renderResources().totalVertexUploads, vertices);
    for (const [mesh, buffer] of buffers) assert.equal(mesh.getVertexBuffer(VertexBuffer.PositionKind)?.getBuffer(), buffer);
    viewer.camera.setPosition(new Vector3(3.3, 2, .3)); viewer.camera.setTarget(modelPoint(3.3, .3, .3)); viewer.scene.render();
    const screen = Vector3.Project(modelPoint(3.3, .3, .4), Matrix.IdentityReadOnly, viewer.scene.getTransformMatrix(), viewer.camera.viewport.toGlobal(800, 600));
    assert.equal(viewer.objectAt(screen.x, screen.y), 'batch-equipment-0');
    viewer.select('batch-equipment-0'); viewer.scene.render();
    assert.equal(viewer.objectAt(screen.x, screen.y), 'batch-equipment-0');
    viewer.select(''); viewer.setLevel('attic'); viewer.scene.render();
    assert.notEqual(viewer.objectAt(screen.x, screen.y), 'batch-equipment-0');
  } finally { viewer.dispose(); gpu.dispose(); }
});

test('retained projection replaces changed units only and releases all geometry across project identities', async () => {
  const fixture = await productionViewerFixture(); const gpu = engine(); const viewer = new ModelScene(gpu);
  try {
    viewer.setModel(fixture.accepted, null, fixture.projectId);
    const unchanged = viewer.scene.getMeshByName('batch-equipment-2'); const changed = viewer.scene.getMeshByName('batch-equipment-0');
    assert.ok(unchanged && changed);
    viewer.setModel(fixture.proposed, null, fixture.projectId);
    assert.equal(viewer.scene.getMeshByName('batch-equipment-2'), unchanged); assert.equal(unchanged.isDisposed(), false);
    assert.equal(changed.isDisposed(), true);
    const current = [...viewer.scene.meshes]; const other = await RoomRepository.create('Different project');
    viewer.setModel(fixture.proposed, null, other.projectId);
    assert.ok(current.every(mesh => mesh.isDisposed()));
  } finally { viewer.dispose(); gpu.dispose(); }
});

test('retained projection detects callers mutating a prior snapshot object instead of silently keeping stale geometry', async () => {
  const fixture = await productionViewerFixture(); const gpu = engine(); const viewer = new ModelScene(gpu);
  try {
    const mutable: ModelSnapshot = structuredClone(fixture.accepted);
    viewer.setModel(mutable, null, fixture.projectId);
    const original = viewer.scene.getMeshByName('batch-equipment-0');
    const item = mutable.entities.find(item => item.id === 'batch-equipment-0'); assert.ok(item?.type === 'Equipment');
    item.height = .5;
    assert.equal(viewer.setModel(mutable, null, fixture.projectId), true);
    assert.equal(original?.isDisposed(), true);
    const replacement = viewer.scene.getMeshByName(item.id); assert.ok(replacement);
    replacement.computeWorldMatrix(true); assert.ok(Math.abs(replacement.getBoundingInfo().boundingBox.maximumWorld.y - .7) < .00001);
  } finally { viewer.dispose(); gpu.dispose(); }
});

test('one hundred retained preview/compare/discard cycles recover source, batch, geometry and shadow-caster counts', async () => {
  const fixture = await productionViewerFixture(); const gpu = engine(); const viewer = new ModelScene(gpu);
  const original = JSON.stringify(fixture.accepted);
  const counts = () => {
    const sun = viewer.scene.lights.find(light => light instanceof DirectionalLight);
    return { meshes: viewer.scene.meshes.length, geometries: viewer.scene.geometries.length,
      materials: viewer.scene.materials.length, textures: viewer.scene.textures.length,
      shadowCasters: sun instanceof DirectionalLight ? sun.getShadowGenerator()?.getShadowMap()?.renderList?.length ?? 0 : 0,
      parts: viewer.renderResources().parts, cachedVertices: viewer.renderResources().cachedVertices, batches: viewer.renderResources().batches };
  };
  try {
    viewer.setModel(fixture.accepted, null, fixture.projectId); viewer.setCutaway(false);
    for (let step = 0; step < 2; step++) {
      viewer.setModel(fixture.proposed, fixture.accepted, fixture.projectId); viewer.setModel(fixture.accepted, null, fixture.projectId);
    }
    const settled = counts();
    for (let step = 0; step < 100; step++) {
      viewer.setModel(fixture.proposed, fixture.accepted, fixture.projectId);
      assert.ok(viewer.scene.meshes.some(mesh => mesh.name.startsWith('before:batch-equipment-0')));
      assert.ok(viewer.scene.meshes.some(mesh => mesh.name.startsWith('before:batch-equipment-1')));
      assert.ok(viewer.scene.getMeshByName('batch-added-equipment'));
      viewer.setModel(fixture.accepted, null, fixture.projectId);
      assert.deepEqual(counts(), settled);
    }
    assert.equal(JSON.stringify(fixture.accepted), original);
  } finally { viewer.dispose(); gpu.dispose(); }
  assert.equal(viewer.scene.isDisposed, true);
});

test('a name-only hosted opening change still produces its before ghost and discard restores its host unit', async () => {
  const fixture = await productionViewerFixture(); const gpu = engine(); const viewer = new ModelScene(gpu);
  const after = validateSnapshot({ ...fixture.accepted, entities: fixture.accepted.entities.map(item => item.id === 'ground-door' ? { ...item, name: 'Renamed door' } : item) });
  try {
    viewer.setModel(fixture.accepted, null, fixture.projectId);
    const unrelated = viewer.scene.getMeshByName('batch-equipment-10');
    viewer.setModel(after, fixture.accepted, fixture.projectId);
    assert.ok(viewer.scene.meshes.some(mesh => mesh.name.startsWith('before:ground-door')));
    assert.equal(viewer.scene.getMeshByName('batch-equipment-10'), unrelated);
    viewer.setModel(fixture.accepted, null, fixture.projectId);
    assert.equal(viewer.scene.meshes.some(mesh => mesh.name.startsWith('before:')), false);
  } finally { viewer.dispose(); gpu.dispose(); }
});

test('batching captures shared source geometry before releasing its last GPU user', () => {
  const gpu = engine(); const scene = new Scene(gpu);
  const light = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
  const shadow = new ShadowGenerator(256, light); const batches = new SceneMeshBatches(scene, shadow, true);
  const first = CreateBox('source', {}, scene); first.material = new StandardMaterial('shared', scene);
  // The neutral BIM benchmark shares geometry across many source meshes.
  first.removeVerticesData(VertexBuffer.UVKind);
  const sources = [first, ...Array.from({ length: 127 }, (_, index) => {
    const mesh = new Mesh('shared-' + index, scene); first.geometry?.applyToMesh(mesh);
    mesh.material = first.material; mesh.position.x = index % 10; return mesh;
  })];
  try {
    batches.update(sources.map(mesh => ({ mesh, castsShadow: false })));
    assert.equal(batches.resources().batchedParts, 128);
    assert.equal(batches.resources().cachedVertices, 128 * 24);
    assert.ok(sources.every(mesh => !mesh.subMeshes?.length));
    const rendered = scene.meshes.filter(mesh => mesh.name.startsWith('bim-batch-'));
    assert.equal(rendered.reduce((sum, mesh) => sum + mesh.getTotalIndices(), 0), 128 * 36);
    for (const mesh of sources) mesh.setEnabled(false);
    batches.update(sources.map(mesh => ({ mesh, castsShadow: false })));
    first.position.x += .1; first.computeWorldMatrix(true);
    batches.update(sources.map(mesh => ({ mesh, castsShadow: false })));
    for (const mesh of sources) mesh.setEnabled(true);
    batches.update(sources.map(mesh => ({ mesh, castsShadow: false })));
    assert.equal(rendered.reduce((sum, mesh) => sum + mesh.getTotalIndices(), 0), 128 * 36,
      'restoring a hidden rebuilt batch must restore its triangles');
    first.renderOutline = true; batches.update(sources.map(mesh => ({ mesh, castsShadow: false })));
    assert.equal(first.getTotalIndices(), 36); assert.equal(first.isVisible, true);
  } finally { batches.clear(); shadow.dispose(); scene.dispose(); gpu.dispose(); }
});

test('retention invalidates derived level, support and host geometry while preserving other levels', async () => {
  const fixture = await productionViewerFixture(); const gpu = engine(); const viewer = new ModelScene(gpu);
  const altered = validateSnapshot({ ...fixture.accepted, entities: fixture.accepted.entities.map(item => {
    if (item.id === 'attic' && item.type === 'Level') return { ...item, elevation: 3.5 };
    if (item.id === 'ground-desk' && item.type === 'Furniture') return { ...item, height: .9 };
    if (item.id === 'ground-shared' && item.type === 'Wall') return { ...item, thickness: .2 };
    return item;
  }) });
  try {
    viewer.setModel(fixture.accepted, null, fixture.projectId);
    const screen = viewer.scene.meshes.find(mesh => mesh.name.startsWith('ground-screen-')); const door = viewer.scene.getMeshByName('ground-door-leaf');
    const attic = viewer.scene.getMeshByName('basement-equipment'); assert.ok(screen && door && attic);
    viewer.setModel(altered, null, fixture.projectId);
    assert.ok(screen.isDisposed() && door.isDisposed());
    assert.equal(viewer.scene.getMeshByName('basement-equipment'), attic);
    const individual = new ModelScene(gpu, 'off');
    try {
      individual.setModel(altered); viewer.setCutaway(false); individual.setCutaway(false);
      viewer.scene.render(); individual.scene.render();
      assert.deepEqual(geometry(viewer), geometry(individual));
    } finally { individual.dispose(); }
  } finally { viewer.dispose(); gpu.dispose(); }
});
