import assert from 'node:assert/strict';
import test from 'node:test';
import { disciplines, nativeFragments, prepareNative, transformedPositions } from './west-riverside.ts';
import { admission, applyProposal, assertNativeManifest, parseFragmentsInput, parseModel, unchangedModel } from './contract.ts';
import { smokeModel } from './fixtures.ts';
import { EditUtils, SingleThreadedFragmentsModel } from '@thatopen/fragments';
import * as THREE from 'three';
import type { MeshData } from '@thatopen/fragments';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('runner rejects a corrupted native binary before launching a viewer', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-native-integrity-'));
  try {
    const source = path.join(directory, 'model.json'); const binary = path.join(directory, 'model.frag');
    await fs.writeFile(source, JSON.stringify(smokeModel(3))); await prepareNative(source, binary);
    const bytes = await fs.readFile(binary); bytes[bytes.length - 1] ^= 1; await fs.writeFile(binary, bytes);
    const run = spawnSync(process.execPath, ['benchmarks/viewer/runner.ts', '--candidate', 'fragments', '--dataset', source,
      '--fragments', binary, '--output', path.join(directory, 'run'), '--timeout-ms', '1000'],
    { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 15000 });
    assert.notEqual(run.status, 0); assert.match(run.stderr, /Native Fragments binary integrity mismatch/);
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe native test cleanup');
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function triangleCoordinates(meshes: MeshData[]): string[] {
  const result: string[] = [];
  for (const mesh of meshes) {
    if (!mesh.positions || !mesh.indices) throw new Error('Native geometry is missing');
    for (let index = 0; index < mesh.indices.length; index += 3) {
      const points: string[] = [];
      for (let vertex = 0; vertex < 3; vertex++) {
        const point = new THREE.Vector3().fromArray(mesh.positions, mesh.indices[index + vertex] * 3).applyMatrix4(mesh.transform);
        points.push(point.toArray().map(value => Math.round(value * 1e4)).join(','));
      }
      result.push(points.sort().join('|'));
    }
  }
  return result.sort();
}

test('native binary round-trip preserves every part, triangle, placement and property', async () => {
  const model = smokeModel(); const bytes = nativeFragments(model);
  const raw = EditUtils.getModelFromBuffer(bytes, true);
  assert.equal(raw.localIdsLength(), model.elements.length);
  assert.deepEqual(Array.from(raw.localIdsArray() ?? []), model.elements.map((_, index) => index));
  assert.ok(raw.maxLocalId() > Math.max(...EditUtils.getSamplesIds(raw)));
  const native = new SingleThreadedFragmentsModel('native-test', bytes, true);
  try {
    await native.ready;
    for (const element of model.elements) {
      const id = native.getLocalIdsByGuids([element.id])[0]; assert.ok(typeof id === 'number');
      const data = native.getItemsData([id])[0];
      for (const [key, value] of Object.entries(element.properties)) {
        const actual = data['property:' + key]; assert.ok(actual && !Array.isArray(actual)); assert.equal(actual.value, value);
      }
      const geometry = model.geometries.find(item => item.id === element.geometryId); assert.ok(geometry);
      const expected: MeshData = { positions: new Float64Array(geometry.positions), indices: new Uint32Array(geometry.indices),
        transform: new THREE.Matrix4().compose(new THREE.Vector3(...element.position), new THREE.Quaternion(), new THREE.Vector3(...element.scale)) };
      assert.deepEqual(triangleCoordinates(native.getItemsGeometry([id])[0]), triangleCoordinates([expected]));
    }
  } finally { native.dispose(); }
});

test('native manifest rejects mismatched source or discipline coverage instead of falling back', () => {
  const model = smokeModel();
  const input = parseFragmentsInput({ kind: 'native', manifest: { version: 1, format: 'fragments-3.6.0-raw', modelId: model.id,
    revision: model.revision, sourceSha256: 'a'.repeat(64), sha256: 'b'.repeat(64), preprocessorSha256: 'c'.repeat(64), bytes: 100, elements: model.elements.length,
    triangles: 288, preparationMs: 1, qualified: false, grossFloorAreaM2: model.grossFloorAreaM2,
    disciplines: Object.fromEntries([...new Set(model.elements.map(item => item.discipline))].map(discipline =>
      [discipline, model.elements.filter(item => item.discipline === discipline).length])) } });
  if (input.kind !== 'native') throw new Error('Expected native input');
  assertNativeManifest(input.manifest, model, 'a'.repeat(64));
  assert.throws(() => assertNativeManifest(input.manifest, model, 'c'.repeat(64)), /does not match/);
  assert.throws(() => assertNativeManifest({ ...input.manifest, disciplines: { architecture: 1 } }, model, 'a'.repeat(64)), /does not match/);
  assert.throws(() => parseFragmentsInput({ kind: 'native', manifest: { ...input.manifest, qualified: true } }));
});

test('all seven disciplines have distinct IFC4 sources, without duplicate schema exports', () => {
  assert.equal(disciplines.length, 7); assert.equal(new Set(disciplines.map(item => item.file)).size, 7);
  assert.ok(disciplines.every(item => item.file.endsWith('_ifc4.ifc')));
  assert.deepEqual(disciplines.map(item => item.id).sort(), ['architecture', 'electrical', 'fire-alarm', 'mechanical', 'plumbing', 'sprinklers', 'structure']);
});
test('IFC matrix baking retains rotation and metre scale while translation stays on the element', () => {
  const matrix = [0, .001, 0, 0, -.001, 0, 0, 0, 0, 0, .001, 0, 100, 200, 300, 1];
  assert.deepEqual(transformedPositions([1000, 2000, 3000, 0, 0, 1], matrix), [-2, 1, 3]);
  assert.throws(() => transformedPositions([0], matrix));
  assert.throws(() => transformedPositions([Infinity, 0, 0, 0, 0, 0], matrix));
});
test('unknown floor area and publicly mirrored provenance cannot become qualified', () => {
  const source = smokeModel();
  const model = parseModel({ ...source, grossFloorAreaM2: null, provenance: { kind: 'public-unverified', sourceHashes: ['a'.repeat(64)],
    permissionEvidence: 'Local evaluation authorized; redistribution unresolved', floorAreaEvidence: 'Unknown',
    coordinateReference: 'test', conversionEvidence: 'test', inventoryEvidence: 'test', limitations: ['Unverified identity'] } });
  assert.equal(model.grossFloorAreaM2, null); assert.equal(admission(model).qualified, false);
  assert.ok(admission(model).reasons.includes('Gross floor area is unknown'));
  model.grossFloorAreaM2 = 300000;
  assert.ok(admission(model).reasons.some(reason => reason.includes('rights')));
});

test('owned input may transfer after validation; default parsing still isolates the caller', () => {
  const input = smokeModel(); const isolated = parseModel(input);
  assert.notEqual(isolated, input); assert.notEqual(isolated.geometries, input.geometries);
  assert.equal(parseModel(input, 'transfer'), input);
  assert.throws(() => parseModel({ ...input, elements: [{ ...input.elements[0], geometryId: 'missing' }] }, 'transfer'));
});

test('review shares tessellation but isolates element metadata; exact audit detects any accepted mutation', () => {
  const base = smokeModel(); const unchanged = unchangedModel(base);
  const proposal = applyProposal(base, { id: 'audit', baseRevision: base.revision, nextRevision: 'audit', remove: [], upsert: [] });
  assert.equal(proposal.geometries, base.geometries); assert.notEqual(proposal.elements[0], base.elements[0]);
  proposal.elements[0].properties.Name = 'Changed'; assert.equal(unchanged(), true);
  const original = base.geometries[0].positions[1];
  base.geometries[0].positions[1] += .01; assert.equal(unchanged(), false);
  base.geometries[0].positions[1] = original; assert.equal(unchanged(), true);
  base.elements[0].properties.Name = 'Unauthorized'; assert.equal(unchanged(), false);
});
