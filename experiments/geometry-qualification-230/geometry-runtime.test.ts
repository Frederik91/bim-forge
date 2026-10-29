import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { parseLinkedPrepared } from '../../src/linked-model.ts';
import type { LinkedPrepared } from '../../src/linked-model.ts';
import { GeometryBoundsSchema, GeometryMatrixSchema } from '../../src/geometry-contract.ts';
import type { GeometryDescription, GeometryMeasureResult } from '../../src/geometry-contract.ts';
import { createGeometryContext } from '../../src/geometry-query.ts';
import { receivingProject } from './receiving-native.ts';

// Production calculation is the system under test. All expected distances and box
// transforms come from the withheld independent Python prism oracle, never its math.
const ProbeSchema = Type.Array(Type.Object({ id: Type.String(), occurrence: Type.Union([Type.Literal('a'), Type.Literal('b')]),
  obstacleName: Type.String(), bounds: GeometryBoundsSchema, localToProject: GeometryMatrixSchema,
  expectedDistanceMetres: Type.Number({ minimum: 0 }), nonPenetrating: Type.Boolean(), strictlySeparated: Type.Boolean(),
}), { minItems: 14, maxItems: 32 });

async function inputs() {
  assert.equal(process.env.QUAL_SERVER_CONTAINER, 'issue234', 'No local fallback for geometry qualification.');
  await fs.stat('/.dockerenv');
  const artifacts = process.env.QUAL_CONVERTER_ARTIFACTS;
  assert.ok(artifacts && path.resolve(artifacts).startsWith('/ssd1/'));
  const output = process.env.QUAL_ARTIFACTS;
  assert.ok(output && path.resolve(output).startsWith('/ssd1/'));
  const source = process.env.QUAL_SOURCE_SHA;
  assert.ok(source && /^[a-f0-9]{40}$/.test(source));
  const probes: unknown = JSON.parse(await fs.readFile(path.join(artifacts, 'private-product-probes.json'), 'utf8'));
  assert.ok(Check(ProbeSchema, probes));
  const prepared: LinkedPrepared[] = [];
  for (const directory of await fs.readdir(artifacts, { withFileTypes: true })) {
    if (!directory.isDirectory() || !directory.name.startsWith('converted-')) continue;
    const root = path.join(artifacts, directory.name);
    const manifest: unknown = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
    const index: unknown = JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8'));
    const geometry: unknown = JSON.parse(await fs.readFile(path.join(root, 'geometry.json'), 'utf8'));
    const parsed = parseLinkedPrepared({ manifest, index, geometry });
    const names: ('original.ifc' | 'index.json' | 'geometry.json')[] = ['original.ifc', 'index.json', 'geometry.json'];
    for (const name of names) {
      const data = await fs.readFile(path.join(root, name));
      assert.equal(data.byteLength, parsed.manifest.artifacts[name].bytes);
      assert.equal(createHash('sha256').update(data).digest('hex'), parsed.manifest.artifacts[name].sha256);
    }
    assert.equal(parsed.manifest.source.originalSha256, parsed.manifest.artifacts['original.ifc'].sha256);
    prepared.push(parsed);
  }
  const project = await receivingProject();
  const native = { snapshot: project.view(project.head('main')).snapshot, revisionId: project.head('main'), target: { kind: 'main' } } satisfies Parameters<typeof createGeometryContext>[0]['native'];
  return { artifacts, output, source, probes, prepared, projectId: project.projectId, native };
}

function sourceBy(input: LinkedPrepared[], revision: string, occurrence = 'occurrence-a'): LinkedPrepared {
  const found = input.find(item => item.manifest.source.revision === revision && item.manifest.occurrence.id === occurrence);
  assert.ok(found, `Missing real converted fixture ${revision}/${occurrence}`);
  return found;
}

function one(items: GeometryDescription[], name: string): GeometryDescription {
  const matches = items.filter(item => item.name === name);
  assert.equal(matches.length, 1);
  const found = matches[0];
  assert.ok(found);
  return found;
}

test('real converted rotated metre/mm geometry matches independent prism distances and zero-clearance controls', async () => {
  const input = await inputs();
  const retained: { source: string; unit: string; probe: string; occurrence: string; expectedDistanceMetres: number; result: GeometryMeasureResult }[] = [];
  // Write each result before its assertion, so a red run preserves the offending witness/receipt.
  for (const unit of ['m', 'mm']) for (const probe of input.probes) {
    const linked = sourceBy(input.prepared, `${unit}-v1`, `occurrence-${probe.occurrence}`);
    const context = createGeometryContext({ projectId: input.projectId, native: input.native, linked: [linked] });
    const discovery = context.query({ query: { role: 'physical' }, limit: 32 });
    if (discovery.kind !== 'complete') throw new Error(JSON.stringify(discovery));
    const obstacle = one(discovery.items, probe.obstacleName);
    const subject = { kind: 'box', candidateId: `${unit}-${probe.occurrence}-${probe.id}`, bounds: probe.bounds, localToProject: probe.localToProject };
    const result = context.measure({ subject, against: { kind: 'object', ref: obstacle.ref }, operation: 'distance' });
    retained.push({ source: input.source, unit, probe: probe.id, occurrence: probe.occurrence,
      expectedDistanceMetres: probe.expectedDistanceMetres, result });
    await fs.writeFile(path.join(input.output, 'private-runtime-measurements.json'), JSON.stringify(retained, null, 2) + '\n');
    if (result.kind !== 'complete') throw new Error(JSON.stringify(result));
    assert.notEqual(result.value.distanceMetres, null);
    assert.ok(Math.abs((result.value.distanceMetres ?? Infinity) - probe.expectedDistanceMetres) <= 1e-6, JSON.stringify({ probe, result }));
    assert.equal(result.value.exactness, 'prepared-representation');
    if (probe.strictlySeparated) {
      assert.equal(result.value.relation, 'separated');
      assert.ok(result.value.witness);
      assert.ok(Math.abs(Math.hypot(...result.value.witness.subject.map((value, index) => value - (result.value.witness?.obstacle[index] ?? Infinity)))
        - probe.expectedDistanceMetres) <= 1e-6);
    }
    const zero = context.measure({ subject, against: { kind: 'object', ref: obstacle.ref }, operation: 'clearance', clearanceMetres: 0 });
    retained.push({ source: input.source, unit, probe: `${probe.id}:clearance-zero`, occurrence: probe.occurrence,
      expectedDistanceMetres: probe.expectedDistanceMetres, result: zero });
    await fs.writeFile(path.join(input.output, 'private-runtime-measurements.json'), JSON.stringify(retained, null, 2) + '\n');
    if (zero.kind !== 'complete') throw new Error(JSON.stringify(zero));
    if (!probe.nonPenetrating || !probe.strictlySeparated) {
      assert.notEqual(zero.value.clearance, 'satisfied-mesh', JSON.stringify({ probe: probe.id, zero }));
    } else assert.equal(zero.value.clearance, 'satisfied-mesh');
  }
});

test('meshless native and IFC levels/spaces remain complete semantic discoveries; solid measurement still refuses', async () => {
  const input = await inputs();
  const linked = sourceBy(input.prepared, 'm-v1');
  const context = createGeometryContext({ projectId: input.projectId, native: input.native, linked: [linked] });
  for (const category of ['level', 'space']) {
    const semantic = context.query({ query: { role: 'context', categories: [category] }, limit: 32 });
    if (semantic.kind !== 'complete') throw new Error(JSON.stringify(semantic));
    assert.equal(semantic.uncertainMembers, 0);
    assert.ok(semantic.items.some(item => item.ref.kind === 'native'));
    assert.ok(semantic.items.some(item => item.ref.kind === 'ifc'));
    for (const object of semantic.items) assert.equal(context.describe(object.ref).kind, 'complete');
    const meshless = semantic.items.find(item => item.capability.kind === 'unavailable');
    assert.ok(meshless, 'The fixture must retain a declared semantic object without a physical mesh.');
    const probe = input.probes[0]; assert.ok(probe);
    const measured = context.measure({ subject: { kind: 'box', candidateId: 'semantic-no-solid', bounds: probe.bounds,
      localToProject: probe.localToProject }, against: { kind: 'object', ref: meshless.ref }, operation: 'clearance', clearanceMetres: .5 });
    assert.notEqual(measured.kind, 'complete');
    if (measured.kind !== 'unavailable') assert.notEqual(measured.value.clearance, 'satisfied-mesh');
  }
});

test('unavailable active source and missing physical shape prevent absence and clearance certainty', async () => {
  const input = await inputs();
  const region = { min: [100, 100, 3], max: [103, 103, 7] };
  const subject = { kind: 'box', candidateId: 'empty-region', bounds: { min: [101, 101, 4], max: [102, 102, 5] },
    localToProject: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] };
  const unavailable = createGeometryContext({ projectId: input.projectId, native: input.native, linked: [],
    unavailableSources: [{ id: 'active-link-with-no-index-or-mesh', reason: 'Current prepared artifacts unavailable' }] });
  const absence = unavailable.query({ query: { role: 'physical', region } });
  assert.notEqual(absence.kind, 'complete');
  const clearance = unavailable.measure({ subject, against: { kind: 'query', query: { role: 'physical', region } }, operation: 'clearance', clearanceMetres: .5 });
  assert.notEqual(clearance.kind, 'complete');
  if (clearance.kind !== 'unavailable') assert.equal(clearance.value.clearance, 'unknown');
  const partial = createGeometryContext({ projectId: input.projectId, native: input.native, linked: [sourceBy(input.prepared, 'm-partial')] });
  const missingShape = partial.query({ query: { role: 'physical' } });
  assert.notEqual(missingShape.kind, 'complete');
});

test('receiving native project is ordinary valid context, matching floor elevation without any proposed asset', async () => {
  const input = await inputs();
  const snapshot = input.native.snapshot;
  const hall = snapshot.entities.find(item => item.id === 'receiving-hall');
  const level = snapshot.entities.find(item => item.id === 'receiving-level');
  assert.ok(hall?.type === 'Space' && level?.type === 'Level');
  assert.equal(level.elevation, 3.5);
  assert.deepEqual(hall.bounds, { minX: 0, minY: 0, maxX: 50, maxY: 50 });
  assert.equal(snapshot.entities.filter(item => item.type === 'AssetFamily' || item.type === 'AssetInstance').length, 0);
  const context = createGeometryContext({ projectId: input.projectId, native: input.native, linked: [sourceBy(input.prepared, 'm-v1')] });
  const walls = context.query({ query: { classes: ['IfcWall'], role: 'physical' } });
  if (walls.kind !== 'complete') throw new Error(JSON.stringify(walls));
  for (const wall of walls.items) {
    assert.ok(wall.bounds);
    assert.ok(wall.bounds.min[0] > hall.bounds.minX && wall.bounds.max[0] < hall.bounds.maxX);
    assert.ok(wall.bounds.min[1] > hall.bounds.minY && wall.bounds.max[1] < hall.bounds.maxY);
    assert.ok(Math.abs(wall.bounds.min[2] - level.elevation) <= 1e-7);
  }
});
