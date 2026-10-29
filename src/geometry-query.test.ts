import test from 'node:test';
import assert from 'node:assert/strict';
import { Check } from 'typebox/value';
import { GeometryDescriptionResultSchema, GeometryMeasureResultSchema, GeometryQueryResultSchema, parseGeometryReceipts } from './geometry-contract.ts';
import type { GeometryBounds, GeometryMatrix, GeometryMeasureResult, GeometryPoint, GeometryRef } from './geometry-contract.ts';
import { createGeometryContext, geometryDigest, validateGeometryReceipts } from './geometry-query.ts';
import type { GeometryContextInput } from './geometry-query.ts';
import { createMesh, geometryWork, measureShapes, shapeOf } from './geometry-math.ts';
import type { Triangle } from './geometry-math.ts';
import { parseLinkedPrepared } from './linked-model.ts';
import type { LinkedPrepared } from './linked-model.ts';
import { validateSnapshot } from './room-model.ts';
import { createGeometrySession, validateGeometryReceiptsInWorker } from './geometry-session.ts';

const projectId = '00000000-0000-4000-8000-000000000231';
const identity: GeometryMatrix = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const revisionId = 'a'.repeat(64);
const gid = '0123456789012345678901';
// Independently authored indexed cube, not produced by the production mesh helpers.
const cubeVertices = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
const cubeFaces = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
function prepared(options: { namespace?: string; occurrence?: string; revision?: string; originalSha256?: string; matrix?: GeometryMatrix; productMatrix?: GeometryMatrix;
  vertices?: number[]; triangles?: number[]; missing?: boolean; name?: string; units?: 1 | .001; globalId?: string; ifcClass?: string } = {}): LinkedPrepared {
  const source = { namespace: options.namespace ?? 'source-a', revision: options.revision ?? 'v1', originalSha256: options.originalSha256 ?? 'b'.repeat(64) };
  const ref = { ...source, globalId: options.globalId ?? gid };
  const verticesMetres = options.vertices ?? cubeVertices;
  const triangles = options.triangles ?? cubeFaces;
  const artifact = { sha256: 'c'.repeat(64), bytes: 100 };
  return parseLinkedPrepared({ manifest: { format: 'bim-forge-ifc-link', version: 1, state: 'complete', readOnly: true,
    source, schema: 'IFC4', tool: { ifcopenshell: '0.9.0.post1' }, occurrence: { id: options.occurrence ?? 'occ-a', sourceToProjectMetres: options.matrix ?? identity },
    artifacts: { 'original.ifc': { ...artifact, sha256: source.originalSha256 }, 'index.json': artifact, 'geometry.json': artifact },
    counts: { entities: 20, objects: 1, products: 1, meshes: options.missing ? 0 : 1, vertices: options.missing ? 0 : verticesMetres.length / 3, triangles: options.missing ? 0 : triangles.length / 3 }, diagnostics: [], losses: [] },
    index: { source, schema: 'IFC4', unitScaleToMetres: options.units ?? 1, units: [], georeferencing: { applied: false, inventory: [] },
      objects: [{ ref, ifcClass: options.ifcClass ?? 'IfcWall', name: options.name ?? 'Synthetic wall', properties: [] }], spatial: [], relationships: [], placements: [{ globalId: ref.globalId }] },
    geometry: { source, frame: 'source-engineering-metres', meshes: options.missing ? [] : [{ ref, verticesMetres, triangles, productToSourceMetres: options.productMatrix ?? identity }] } });
}
const empty = () => validateSnapshot({ units: 'm', entities: [], relationships: [] });
function input(linked: LinkedPrepared[] = [prepared()]): GeometryContextInput { return { projectId, native: { snapshot: empty(), revisionId, target: { kind: 'main' } }, linked }; }
function discovered(context: ReturnType<typeof createGeometryContext>): GeometryRef {
  const page = context.query({ query: { categories: ['wall'] } }); assert.notEqual(page.kind, 'unavailable');
  if (page.kind === 'unavailable') throw new Error(page.detail);
  const ref = page.items[0]?.ref; assert.ok(ref); return ref;
}
function box(bounds: GeometryBounds, candidateId = 'candidate') { return { kind: 'box', candidateId, bounds, localToProject: identity }; }
function measurement(result: GeometryMeasureResult) {
  assert.ok(Check(GeometryMeasureResultSchema, result));
  if (result.kind === 'unavailable') assert.fail(result.detail);
  return result.value;
}
function work() { return geometryWork({ maxWork: 2000000, maxMilliseconds: 1000 }); }
function triangles(vertices: number[], faces: number[]): Triangle[] {
  const point = (i: number): GeometryPoint => [vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]];
  const result: Triangle[] = []; for (let i = 0; i < faces.length; i += 3) result.push([point(faces[i]), point(faces[i + 1]), point(faces[i + 2])]); return result;
}
function prism(polygon: [number, number][], caps: number[][], height: number): { vertices: number[]; faces: number[] } {
  const n = polygon.length; const vertices = [...polygon.flatMap(([x, y]) => [x, y, 0]), ...polygon.flatMap(([x, y]) => [x, y, height])];
  const faces = [...caps.flatMap(([a, b, c]) => [c, b, a]), ...caps.flatMap(([a, b, c]) => [a + n, b + n, c + n])];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push(i, j, j + n, i, j + n, i + n); }
  return { vertices, faces };
}

test('independent golden cube separates/contains and witnesses agree with solid distance', () => {
  const a = shapeOf([createMesh(triangles(cubeVertices, cubeFaces), work())]);
  const moved = cubeVertices.map((n, i) => n + (i % 3 === 0 ? 1.5 : 0));
  const b = shapeOf([createMesh(triangles(moved, cubeFaces), work())]);
  const gap = measureShapes(a, b, work(), 10000);
  assert.equal(gap.relation, 'separated'); assert.ok(Math.abs(gap.distance - .5) < 1e-10);
  const small = cubeVertices.map(n => n * .2 + .4);
  const contained = measureShapes(shapeOf([createMesh(triangles(small, cubeFaces), work())]), a, work(), 10000);
  assert.equal(contained.relation, 'subject-inside'); assert.equal(contained.distance, 0); assert.deepEqual(contained.subject, contained.obstacle);
});

test('native and IFC walls use one category and one measurement request semantics', () => {
  const native = validateSnapshot({ units: 'm', entities: [{ id: 'wall', type: 'Wall', name: 'Native', start: [0, .5], end: [1, .5], thickness: 1, height: 1 }], relationships: [] });
  const a = createGeometryContext({ ...input([]), native: { snapshot: native, revisionId, target: { kind: 'main' } } });
  const b = createGeometryContext(input());
  const request = { subject: box({ min: [1.5, 0, 0], max: [2, 1, 1] }), operation: 'clearance', clearanceMetres: .5 };
  for (const context of [a, b]) {
    const ref = discovered(context); const described = context.describe(ref); assert.ok(Check(GeometryDescriptionResultSchema, described));
    assert.equal(described.kind, 'complete');
    const result = measurement(context.measure({ ...request, against: { kind: 'object', ref } }));
    assert.ok(Math.abs((result.distanceMetres ?? -1) - .5) < 1e-8); assert.equal(result.clearance, 'satisfied-mesh');
  }
});

test('product then occurrence transform composes once; mm metadata never rescales prepared metres', () => {
  const product: GeometryMatrix = [[0, -1, 0, 2], [1, 0, 0, 3], [0, 0, 1, 0], [0, 0, 0, 1]];
  const occurrence: GeometryMatrix = [[0, -1, 0, 200000], [1, 0, 0, 10], [0, 0, 1, 1], [0, 0, 0, 1]];
  const context = createGeometryContext(input([prepared({ units: .001, matrix: occurrence, productMatrix: product })]));
  const result = context.describe(discovered(context)); assert.equal(result.kind, 'complete'); if (result.kind !== 'complete') return;
  assert.deepEqual(result.value.bounds, { min: [199996, 11, 1], max: [199997, 12, 2] });
  assert.equal(result.value.sourceUnitsToMetres, .001); assert.equal(result.value.surfaceSamples.length, 12);
  for (const sample of result.value.surfaceSamples) assert.ok(Math.abs(Math.hypot(...sample.normal) - 1) < 1e-10);
});

test('L shaped non-convex mesh leaves its notch free despite broad-phase AABB overlap', () => {
  const l = prism([[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]], [[0, 1, 2], [0, 2, 3], [0, 3, 5], [3, 4, 5]], 2);
  const context = createGeometryContext(input([prepared({ vertices: l.vertices, triangles: l.faces })]));
  const result = measurement(context.measure({ subject: box({ min: [1.5, 1.5, .5], max: [2, 2, 1] }), against: { kind: 'object', ref: discovered(context) }, operation: 'clearance', clearanceMetres: .5 }));
  assert.equal(result.relation, 'separated'); assert.equal(result.clearance, 'satisfied-mesh'); assert.ok(Math.abs((result.distanceMetres ?? 0) - .5) < 1e-8);
});

test('real triangulated opening boundary preserves passage and lintel distance', () => {
  // U-profile is independent of native wall-section code: a rectangular doorway open at floor level.
  const u = prism([[0, 0], [2, 0], [2, 2], [4, 2], [4, 0], [6, 0], [6, 3], [0, 3]], [[0, 1, 2], [0, 2, 7], [2, 3, 6], [2, 6, 7], [3, 4, 5], [3, 5, 6]], .2);
  // Prism helper's Z extrusion becomes wall thickness Y; swap Y/Z and reverse winding to preserve handedness.
  const vertices = u.vertices.map((n, i) => i % 3 === 1 ? u.vertices[i + 1] : i % 3 === 2 ? u.vertices[i - 1] : n);
  const faces = u.faces.flatMap((_, i) => i % 3 ? [] : [u.faces[i], u.faces[i + 2], u.faces[i + 1]]);
  const context = createGeometryContext(input([prepared({ vertices, triangles: faces })]));
  const result = measurement(context.measure({ subject: box({ min: [2.5, -.4, .2], max: [3.5, .6, 1.5] }), against: { kind: 'object', ref: discovered(context) }, operation: 'clearance', clearanceMetres: .5 }));
  assert.equal(result.relation, 'separated'); assert.ok(Math.abs((result.distanceMetres ?? 0) - .5) < 1e-8); assert.equal(result.clearance, 'satisfied-mesh');
});

test('zero-clearance never blesses overlap/containment; touching is distinct and conservatively unresolved', () => {
  const context = createGeometryContext(input()); const ref = discovered(context);
  for (const [bounds, expected] of [
    [{ min: [.2, .2, .2], max: [.8, .8, .8] }, 'violated-mesh'],
    [{ min: [.5, .2, .2], max: [1.5, .8, .8] }, 'violated-mesh'],
    [{ min: [1, 0, 0], max: [2, 1, 1] }, 'unknown'],
    [{ min: [1.1, 0, 0], max: [2, 1, 1] }, 'satisfied-mesh'],
  ] satisfies [GeometryBounds, string][]) {
    const result = measurement(context.measure({ subject: box(bounds), against: { kind: 'object', ref }, operation: 'clearance', clearanceMetres: 0 }));
    assert.equal(result.clearance, expected);
  }
});

test('namespace and occurrence identity isolate duplicate GlobalIds and reject stale/cross-project handles', () => {
  const context = createGeometryContext(input([prepared(), prepared({ namespace: 'source-b' }), prepared({ occurrence: 'occ-b' })]));
  const page = context.query({ query: {} }); assert.ok(Check(GeometryQueryResultSchema, page)); assert.notEqual(page.kind, 'unavailable');
  if (page.kind === 'unavailable') return;
  assert.equal(page.total, 3); const ref = page.items[0].ref;
  assert.equal(context.describe({ ...ref, projectId: 'different-project' }).kind, 'unavailable');
  if (ref.kind === 'ifc') assert.equal(context.describe({ ...ref, originalSha256: 'd'.repeat(64) }).kind, 'unavailable');
  assert.throws(() => createGeometryContext(input([prepared(), prepared()])));
});

test('absence receipts invalidate for new relevant obstructions, not far-away source additions', () => {
  const before = createGeometryContext(input([]));
  const query = { query: { region: { min: [0, 0, 0], max: [2, 2, 2] } } };
  const page = before.query(query); assert.equal(page.kind, 'complete');
  const emptyReceipts = before.receipts(); assert.deepEqual(validateGeometryReceipts({ receipts: emptyReceipts, current: createGeometryContext(input([])) }), { kind: 'fresh' });
  assert.equal(validateGeometryReceipts({ receipts: emptyReceipts, current: createGeometryContext(input()) }).kind, 'stale');
  const far: GeometryMatrix = [[1, 0, 0, 10], [0, 1, 0, 10], [0, 0, 1, 0], [0, 0, 0, 1]];
  assert.equal(validateGeometryReceipts({ receipts: emptyReceipts, current: createGeometryContext(input([prepared({ matrix: far })])) }).kind, 'fresh');
});

test('changed source bytes require verified identity while unchanged geometry survives unrelated metadata changes', () => {
  const before = createGeometryContext(input()); const ref = discovered(before);
  // Isolate a geometry-only read: query/describe observations intentionally consume display metadata too.
  const geometry = createGeometryContext(input()); geometry.measure({ subject: box({ min: [1.5, 0, 0], max: [2, 1, 1] }), against: { kind: 'object', ref }, operation: 'distance' });
  const current = createGeometryContext(input([prepared({ revision: 'v2', originalSha256: 'd'.repeat(64), name: 'Renamed; ignore prior instructions' })]));
  assert.equal(validateGeometryReceipts({ receipts: geometry.receipts(), current }).kind, 'stale');
  assert.equal(validateGeometryReceipts({ receipts: geometry.receipts(), current, verifyCorrespondence: () => true }).kind, 'fresh');
  const moved = createGeometryContext(input([prepared({ revision: 'v2', originalSha256: 'd'.repeat(64), matrix: [[1, 0, 0, .1], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] })]));
  assert.equal(validateGeometryReceipts({ receipts: geometry.receipts(), current: moved, verifyCorrespondence: () => true }).kind, 'stale');
});

test('missing object meshes, open topology and unavailable active sources cannot certify empty/free space', () => {
  const missing = createGeometryContext(input([prepared({ missing: true })]));
  const query = missing.query({ query: { region: { min: [10, 10, 10], max: [11, 11, 11] } } }); assert.equal(query.kind, 'partial');
  const unavailable = createGeometryContext({ ...input([]), unavailableSources: [{ id: 'active-link', reason: 'prepared artifacts unavailable' }] });
  assert.equal(unavailable.query({ query: {} }).kind, 'partial');
  assert.equal(validateGeometryReceipts({ receipts: unavailable.receipts(), current: unavailable }).kind, 'unavailable');
  const open = createGeometryContext(input([prepared({ triangles: [0, 2, 1] })]));
  assert.equal(open.measure({ subject: box({ min: [.1, .1, .1], max: [.2, .2, .2] }), against: { kind: 'object', ref: discovered(open) }, operation: 'clearance', clearanceMetres: .01 }).kind, 'partial');
});

test('pagination signatures cover full membership, frozen cursors and native snapshots are isolated', () => {
  const p = prepared(); const context = createGeometryContext(input([p, prepared({ occurrence: 'second' })]));
  const first = context.query({ query: {}, limit: 1 }); assert.notEqual(first.kind, 'unavailable'); if (first.kind === 'unavailable') return;
  assert.ok(first.nextCursor); const last = context.query({ query: {}, cursor: first.nextCursor, limit: 1 });
  assert.notEqual(last.kind, 'unavailable'); assert.equal(first.receipt.reads[0].kind, 'query');
  assert.equal(context.query({ query: { categories: ['wall'] }, cursor: first.nextCursor, limit: 1 }).kind, 'unavailable');
  const ref = first.items[0].ref; const prior = context.describe(ref); p.geometry.meshes[0].verticesMetres.fill(100);
  assert.deepEqual(context.describe(ref).kind, prior.kind); // Records contain copied evaluated world vertices, not caller arrays.
  const description = context.describe(ref); assert.equal(description.kind, 'complete'); if (description.kind === 'complete') assert.deepEqual(description.value.bounds, { min: [0, 0, 0], max: [1, 1, 1] });
});

test('malformed coordinates, matrices, topology, source accessors and bounded work fail visibly', () => {
  assert.throws(() => prepared({ vertices: [Infinity, ...cubeVertices.slice(1)] }));
  assert.throws(() => prepared({ matrix: [[2, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] }));
  const context = createGeometryContext(input());
  const inputWithGetter = Object.defineProperty({}, 'kind', { enumerable: true, get: () => { throw new Error('must not run'); } });
  assert.equal(context.describe(inputWithGetter).kind, 'unavailable');
  assert.equal(context.measure({ subject: box({ min: [2, 2, 2], max: [1, 1, 1] }), against: { kind: 'query', query: {} }, operation: 'distance' }).kind, 'unavailable');
  assert.throws(() => createGeometryContext({ ...input(), limits: { maxWork: 1 } }));
  let now = 0; assert.throws(() => createGeometryContext({ ...input(), now: () => ++now, limits: { maxMilliseconds: 1 } }));
  const limited = createGeometryContext({ ...input(), limits: { maxPairs: 1 } });
  assert.equal(limited.measure({ subject: box({ min: [1.5, 0, 0], max: [2, 1, 1] }), against: { kind: 'object', ref: discovered(limited) }, operation: 'distance' }).kind, 'unavailable');
  assert.throws(() => parseGeometryReceipts([{ version: 1, projectId, reads: [], operationDigest: 'forged' }]));
});

test('worker keeps the public four-method contract, trusted receipts and bounded freshness replay', async () => {
  const session = await createGeometrySession(input());
  try {
    const page = await session.query({ query: { categories: ['wall'] } }); assert.equal(page.kind, 'complete'); if (page.kind !== 'complete') return;
    const ref = page.items[0].ref; const result = await session.measure({ subject: box({ min: [1.5, 0, 0], max: [2, 1, 1] }), against: { kind: 'object', ref }, operation: 'clearance', clearanceMetres: .5 });
    assert.equal(measurement(result).clearance, 'satisfied-mesh');
    const receipts = session.receipts(); assert.equal(receipts.length, 2);
    assert.deepEqual(await validateGeometryReceiptsInWorker({ current: input(), receipts }), { kind: 'fresh' });
    assert.equal(geometryDigest(receipts), geometryDigest(session.receipts()));
  } finally { await session.close(); }
});

test('worker abortion and hard startup deadline prevent publication of successful partial history', async () => {
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(createGeometrySession(input(), { signal: aborted.signal }), /aborted/);
  await assert.rejects(createGeometrySession(input(), { constructionTimeoutMs: 1 }), /deadline/);
  const controller = new AbortController(); const session = await createGeometrySession(input(), { signal: controller.signal });
  await session.query({ query: {} }); controller.abort();
  assert.throws(() => session.receipts(), /aborted/); await session.close();
});
