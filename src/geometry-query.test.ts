import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { Check } from 'typebox/value';
import { GeometryDescriptionResultSchema, GeometryMatrixSchema, GeometryMeasureRequestSchema, GeometryMeasureResultSchema, GeometryPointSchema,
  GeometryQueryResultSchema, GeometryRelationsResultSchema, GeometrySemanticsSchema, parseGeometryReceipts } from './geometry-contract.ts';
import type { GeometryBounds, GeometryMatrix, GeometryMeasureResult, GeometryRef } from './geometry-contract.ts';
import { createGeometryContext, geometryDigest, geometryPublicResultDigest, validateGeometryReceipts } from './geometry-query.ts';
import type { GeometryContextInput } from './geometry-query.ts';
import { createMesh, geometryWork, measureShapes, shapeOf, vector3 } from './geometry-math.ts';
import type { Triangle, Vec3 } from './geometry-math.ts';
import { parseLinkedPrepared } from './linked-model.ts';
import type { LinkedPrepared } from './linked-model.ts';
import { validateSnapshot } from './room-model.ts';
import { createGeometrySession, geometryReplyMatchesReceipt, GeometrySession, validateGeometryReceiptsInWorker } from './geometry-session.ts';
import { residentialFloor } from './residential-floor.ts';
import { multiStoreySnapshot } from './multi-storey-house.ts';

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
  const verticesMetres = [...(options.vertices ?? cubeVertices)];
  const triangles = [...(options.triangles ?? cubeFaces)];
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
  const point = (i: number): Vec3 => [vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]];
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

test('independent triangulated opening boundary preserves passage and lintel distance', () => {
  // U-profile is independent of native wall-section code: a rectangular doorway open at floor level.
  const u = prism([[0, 0], [2, 0], [2, 2], [4, 2], [4, 0], [6, 0], [6, 3], [0, 3]], [[0, 1, 2], [0, 2, 7], [2, 3, 6], [2, 6, 7], [3, 4, 5], [3, 5, 6]], .2);
  // Prism helper's Z extrusion becomes wall thickness Y; swap Y/Z and reverse winding to preserve handedness.
  const vertices = u.vertices.map((n, i) => i % 3 === 1 ? u.vertices[i + 1] : i % 3 === 2 ? u.vertices[i - 1] : n);
  const faces = u.faces.flatMap((_, i) => i % 3 ? [] : [u.faces[i], u.faces[i + 2], u.faces[i + 1]]);
  const context = createGeometryContext(input([prepared({ vertices, triangles: faces })]));
  const result = measurement(context.measure({ subject: box({ min: [2.5, -.4, .2], max: [3.5, .6, 1.5] }), against: { kind: 'object', ref: discovered(context) }, operation: 'clearance', clearanceMetres: .5 }));
  assert.equal(result.relation, 'separated'); assert.ok(Math.abs((result.distanceMetres ?? 0) - .5) < 1e-8); assert.equal(result.clearance, 'satisfied-mesh');
});

test('zero-clearance rejects overlap/containment and permits only proven boundary contact', () => {
  const context = createGeometryContext(input()); const ref = discovered(context);
  for (const [bounds, expected] of [
    [{ min: [.2, .2, .2], max: [.8, .8, .8] }, 'violated-mesh'],
    [{ min: [.5, .2, .2], max: [1.5, .8, .8] }, 'violated-mesh'],
    [{ min: [1, 0, 0], max: [2, 1, 1] }, 'satisfied-mesh'],
    [{ min: [1.1, 0, 0], max: [2, 1, 1] }, 'satisfied-mesh'],
  ] satisfies [GeometryBounds, string][]) {
    const result = measurement(context.measure({ subject: box(bounds), against: { kind: 'object', ref }, operation: 'clearance', clearanceMetres: 0 }));
    assert.equal(result.clearance, expected);
  }
});

test('an evaluated native asset can stand on a native slab without a penetration or clearance waiver', () => {
  const base = multiStoreySnapshot();
  const snapshot = validateSnapshot({ ...base, entities: [...base.entities,
    { id: 'contact-family', type: 'AssetFamily', name: 'Closed box', description: 'Synthetic contact fixture',
      parts: [{ id: 'body', kind: 'box', min: [0, 0, 0], size: [1, 1, 1], color: '#336699' }] },
    { id: 'standing-box', type: 'AssetInstance', name: 'Standing box', familyId: 'contact-family', position: [6, 4.8],
      rotationDeg: 0, size: { width: .5, depth: .5, height: .5 }, placement: { kind: 'room', roomId: 'level-ground-east' } },
  ] });
  const context = createGeometryContext({ ...input([]), native: { snapshot, revisionId, target: { kind: 'main' } } });
  const ref = (entityId: string): GeometryRef => ({ kind: 'native', projectId, revisionId, target: { kind: 'main' }, entityId });
  const request = { subject: { kind: 'object', ref: ref('standing-box') }, against: { kind: 'object', ref: ref('level-ground-slab') }, operation: 'clearance', clearanceMetres: 0 };
  const result = context.measure(request); assert.equal(result.kind, 'complete');
  const value = measurement(result); assert.equal(value.relation, 'contact'); assert.equal(value.clearance, 'satisfied-mesh');
  const witness = value.witness;
  assert.ok((value.distanceMetres ?? 1) < 1e-10); assert.ok(witness);
  assert.ok(Math.abs(Math.hypot(...witness.subject.map((n, i) => n - witness.obstacle[i])) - (value.distanceMetres ?? -1)) < 1e-10);
  const requiredGap = measurement(context.measure({ ...request, clearanceMetres: .5 }));
  assert.equal(requiredGap.clearance, 'violated-mesh');
  const penetration = measurement(context.measure({ subject: box({ min: [5.75, 4.55, -.01], max: [6.25, 5.05, .49] }),
    against: request.against, operation: 'clearance', clearanceMetres: 0 }));
  assert.notEqual(penetration.relation, 'contact'); assert.notEqual(penetration.clearance, 'satisfied-mesh');
});

test('native and rotated IFC wall boundary contact uses actual mesh supporting planes', () => {
  const native = validateSnapshot({ units: 'm', entities: [{ id: 'wall', type: 'Wall', name: 'Native', start: [0, .5], end: [1, .5], thickness: 1, height: 1 }], relationships: [] });
  const context = createGeometryContext({ ...input([]), native: { snapshot: native, revisionId, target: { kind: 'main' } } });
  const subject = box({ min: [1, 0, 0], max: [2, 1, 1] });
  const value = measurement(context.measure({ subject, against: { kind: 'object', ref: discovered(context) }, operation: 'clearance', clearanceMetres: 0 }));
  assert.equal(value.relation, 'contact'); assert.equal(value.clearance, 'satisfied-mesh');
  const angle = 37 * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle);
  const matrix: GeometryMatrix = [[c, -s, 0, 5], [s, c, 0, -3], [0, 0, 1, 1], [0, 0, 0, 1]];
  const rotated = createGeometryContext(input([prepared({ productMatrix: matrix })]));
  const rotatedValue = measurement(rotated.measure({ subject: { ...subject, localToProject: matrix },
    against: { kind: 'object', ref: discovered(rotated) }, operation: 'clearance', clearanceMetres: 0 }));
  assert.equal(rotatedValue.relation, 'contact'); assert.equal(rotatedValue.clearance, 'satisfied-mesh');
});

test('sub-tolerance penetration, coincident solids and coplanar surface ambiguity never become certified contact', () => {
  const context = createGeometryContext(input()); const ref = discovered(context);
  for (const bounds of [{ min: [1 - 1e-10, 0, 0], max: [2, 1, 1] }, { min: [0, 0, 0], max: [1, 1, 1] }] satisfies GeometryBounds[]) {
    const value = measurement(context.measure({ subject: box(bounds), against: { kind: 'object', ref }, operation: 'clearance', clearanceMetres: 0 }));
    assert.notEqual(value.relation, 'contact'); assert.notEqual(value.clearance, 'satisfied-mesh');
  }
  const coplanar = createGeometryContext(input([prepared({ triangles: [0, 2, 1, 0, 1, 2] })]));
  const value = measurement(coplanar.measure({ subject: box({ min: [0, 0, 0], max: [1, 1, 1] }),
    against: { kind: 'object', ref: discovered(coplanar) }, operation: 'clearance', clearanceMetres: 0 }));
  assert.notEqual(value.relation, 'contact'); assert.equal(value.clearance, 'unknown');
});

test('ambiguous coincident solids never satisfy any positive gap, including one below numeric tolerance', () => {
  const context = createGeometryContext(input()); const ref = discovered(context);
  for (const clearanceMetres of [0, 1e-8, 1e-7, .5]) {
    const result = context.measure({ subject: box({ min: [0, 0, 0], max: [1, 1, 1] }),
      against: { kind: 'object', ref }, operation: 'clearance', clearanceMetres });
    assert.equal(result.kind, 'partial');
    const value = measurement(result);
    assert.equal(value.relation, 'contact-or-overlap'); assert.equal(value.clearance, 'unknown');
  }
});

test('a closest exterior contact never hides unresolved inset containment, in either evaluation order', () => {
  const inset = cubeVertices.map(n => 1e-8 + n * (1 - 2e-8));
  const exterior: GeometryMatrix = [[1, 0, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (const [insideId, contactId] of [['a-inside', 'z-contact'], ['z-inside', 'a-contact']]) {
    const context = createGeometryContext(input([prepared({ occurrence: insideId, vertices: inset }), prepared({ occurrence: contactId, matrix: exterior })]));
    for (const operation of ['clearance', 'intersection']) {
      const result = context.measure({ subject: box({ min: [0, 0, 0], max: [1, 1, 1] }),
        against: { kind: 'query', query: {} }, operation, ...(operation === 'clearance' ? { clearanceMetres: 0 } : {}) });
      assert.equal(result.kind, 'partial');
      const value = measurement(result);
      assert.equal(value.relation, 'contact-or-overlap'); assert.equal(value.distanceMetres, 0);
      assert.equal(value.nearest?.kind === 'ifc' ? value.nearest.occurrenceId : null, contactId);
      assert.equal(value.clearance, operation === 'clearance' ? 'unknown' : 'not-requested');
    }
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

test('worker abortion prevents publication of successful partial history', async () => {
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(createGeometrySession(input(), { signal: aborted.signal }), /aborted/);
  const controller = new AbortController(); const session = await createGeometrySession(input(), { signal: controller.signal });
  await session.query({ query: {} }); controller.abort();
  assert.throws(() => session.receipts(), /aborted/); await session.close();
});

test('semantic level/space discovery is complete without solids; spatial context queries expose missing bounds', () => {
  const native = residentialFloor();
  const readableIds = native.entities.filter(entity => entity.type === 'Level' || entity.type === 'Space').map(entity => entity.id);
  const nativeContext = createGeometryContext({ ...input([]), native: { snapshot: native, revisionId, target: { kind: 'main' }, readableIds } });
  const linkedContext = createGeometryContext(input([prepared({ ifcClass: 'IfcBuildingStorey', missing: true }),
    prepared({ namespace: 'space-source', ifcClass: 'IfcSpace', missing: true })]));
  for (const context of [nativeContext, linkedContext]) {
    const page = context.query({ query: { role: 'context', categories: ['level', 'space'] } });
    assert.equal(page.kind, 'complete');
    if (page.kind !== 'complete') continue;
    assert.ok(page.items.length >= 2); assert.equal(validateGeometryReceipts({ receipts: context.receipts(), current: context }).kind, 'fresh');
    const spatial = context.query({ query: { role: 'context', categories: ['level', 'space'], region: { min: [0, 0, 0], max: [2, 2, 2] } } });
    assert.equal(spatial.kind, 'partial');
  }
});

test('scope reads evaluate hidden hosts privately, hide identities/relations and bind coverage to receipts', () => {
  const snapshot = validateSnapshot({ units: 'm', entities: [
    { id: 'wall-private', type: 'Wall', name: 'PRIVATE HOST NAME', start: [0, 0], end: [3, 0], thickness: .2, height: 3 },
    { id: 'door-visible', type: 'Door', name: 'Visible void', width: 1, height: 2 },
  ], relationships: [{ id: 'host-private', type: 'hosted-by', source: 'door-visible', target: 'wall-private', offset: 1 }] });
  const contextInput = { ...input([]), native: { snapshot, revisionId, target: { kind: 'main' }, readableIds: ['door-visible'] } } satisfies GeometryContextInput;
  const context = createGeometryContext(contextInput);
  const page = context.query({ query: { role: 'all' } }); assert.equal(page.kind, 'complete'); if (page.kind !== 'complete') return;
  assert.equal(page.total, 1); assert.equal(page.domain.kind, 'authorized-native-scope');
  const ref = page.items[0].ref; assert.equal(ref.kind, 'native');
  assert.deepEqual(page.items[0].bounds, { min: [1, -.1, 0], max: [2, .1, 2] });
  assert.equal(JSON.stringify(page).includes('PRIVATE HOST NAME'), false); assert.equal(JSON.stringify(page).includes('wall-private'), false);
  assert.equal(context.describe({ kind: 'native', projectId, target: { kind: 'main' }, revisionId, entityId: 'wall-private' }).kind, 'unavailable');
  const related = context.relations(ref); assert.equal(related.kind, 'complete'); if (related.kind === 'complete') assert.deepEqual(related.items, []);
  const clean = createGeometryContext(contextInput); clean.describe(ref);
  const moved = validateSnapshot({ ...snapshot, entities: snapshot.entities.map(entity => entity.type === 'Wall'
    ? { ...entity, start: [0, 1], end: [3, 1] } : entity) });
  const current = createGeometryContext({ ...contextInput, native: { ...contextInput.native, snapshot: moved, revisionId: 'e'.repeat(64) } });
  assert.equal(validateGeometryReceipts({ receipts: clean.receipts(), current }).kind, 'stale');
  const full = createGeometryContext({ ...input([]), native: { snapshot, revisionId, target: { kind: 'main' } } });
  assert.equal(validateGeometryReceipts({ receipts: clean.receipts(), current: full }).kind, 'stale');
  assert.deepEqual(snapshot.relationships[0].target, 'wall-private');
});

test('candidate object receipts require final reconciled geometry rather than a fabricated box binding', () => {
  const snapshot = validateSnapshot({ units: 'm', entities: [
    { id: 'candidate-native', type: 'Wall', name: 'Proposal object', start: [1.5, .5], end: [2, .5], thickness: 1, height: 1 },
  ], relationships: [] });
  const candidateInput = { ...input(), native: { snapshot, revisionId, target: { kind: 'main' } } } satisfies GeometryContextInput;
  const context = createGeometryContext(candidateInput);
  const ref: GeometryRef = { kind: 'native', projectId, target: { kind: 'main' }, revisionId, entityId: 'candidate-native' };
  const result = context.measure({ subject: { kind: 'object', ref }, against: { kind: 'query', query: {} }, operation: 'clearance', clearanceMetres: .5 });
  assert.equal(measurement(result).clearance, 'satisfied-mesh');
  const current = createGeometryContext(input());
  assert.equal(validateGeometryReceipts({ receipts: context.receipts(), current }).kind, 'stale');
  assert.equal(validateGeometryReceipts({ receipts: context.receipts(), current, candidate: context }).kind, 'fresh');
  const changed = validateSnapshot({ ...snapshot, entities: snapshot.entities.map(entity => entity.type === 'Wall' ? { ...entity, thickness: .8 } : entity) });
  const final = createGeometryContext({ ...candidateInput, native: { ...candidateInput.native, snapshot: changed } });
  assert.equal(validateGeometryReceipts({ receipts: context.receipts(), current, candidate: final }).kind, 'stale');
});

test('hard startup timeout terminates a worker before a late ready event can make it usable', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = new GeometrySession(input(), { constructionTimeoutMs: 10 });
  const rejected = assert.rejects(session.ready, /hard deadline/);
  t.mock.timers.tick(10); await rejected;
  assert.throws(() => session.receipts(), /hard deadline/); await session.close();
});

test('idle lifetime covers thinking separately from hard operation deadlines and fences late worker replies', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = await createGeometrySession(input(), { lifetimeMs: 2000, operationTimeoutMs: 10 });
  try {
    t.mock.timers.tick(1900);
    const pending = session.query({ query: {} });
    // Let the async host dispatch microtasks run, without delivering a worker message event to the parent.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const rejected = assert.rejects(pending, /hard worker deadline/);
    t.mock.timers.tick(10); await rejected;
    assert.throws(() => session.receipts(), /hard worker deadline/);
  } finally { await session.close(); }
});

test('discovery binds full membership, returned descriptions, and not unconsumed off-page geometry', () => {
  const before = createGeometryContext(input([prepared(), prepared({ occurrence: 'second' })]));
  const page = before.query({ query: {}, limit: 1 }); assert.equal(page.kind, 'complete');
  const taller = prepared({ occurrence: 'second', vertices: cubeVertices.map((n, i) => i % 3 === 2 ? n * 2 : n), revision: 'v2', originalSha256: 'd'.repeat(64) });
  const current = createGeometryContext(input([prepared(), taller]));
  assert.equal(validateGeometryReceipts({ receipts: before.receipts(), current, verifyCorrespondence: () => true }).kind, 'fresh');
  assert.equal(validateGeometryReceipts({ receipts: before.receipts(), current }).kind, 'stale');
  const changedReturned = createGeometryContext(input([prepared({ name: 'A consumed description changed' }), prepared({ occurrence: 'second' })]));
  assert.equal(validateGeometryReceipts({ receipts: before.receipts(), current: changedReturned }).kind, 'stale');
  const measured = createGeometryContext(input([prepared(), prepared({ occurrence: 'second' })]));
  assert.equal(measured.measure({ subject: box({ min: [4, 0, 0], max: [5, 1, 1] }), against: { kind: 'query', query: {} }, operation: 'distance' }).kind, 'complete');
  assert.equal(validateGeometryReceipts({ receipts: measured.receipts(), current, verifyCorrespondence: () => true }).kind, 'stale');
  const scoped = createGeometryContext(input([prepared(), prepared({ occurrence: 'second' })]));
  scoped.query({ query: { region: { min: [0, 0, 0], max: [2, 2, 2] } }, limit: 1 });
  const moved: GeometryMatrix = [[1, 0, 0, 10], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  const removedFromRegion = createGeometryContext(input([prepared(), prepared({ occurrence: 'second', matrix: moved })]));
  assert.equal(validateGeometryReceipts({ receipts: scoped.receipts(), current: removedFromRegion }).kind, 'stale');
});

test('bounded replies never silently truncate predicate membership', () => {
  const bounded = createGeometryContext({ ...input(), limits: { maxResponseBytes: 1 } });
  const rejected = bounded.query({ query: {} }); assert.equal(rejected.kind, 'unavailable');
  if (rejected.kind === 'unavailable') assert.equal(rejected.reason, 'response-limit');
  assert.equal(validateGeometryReceipts({ receipts: bounded.receipts(), current: bounded }).kind, 'unavailable');
});

test('touching at one obstacle cannot hide penetration at a different obstacle', () => {
  const contained: GeometryMatrix = [[1, 0, 0, 1.2], [0, 1, 0, .2], [0, 0, 1, .2], [0, 0, 0, 1]];
  const context = createGeometryContext(input([prepared(), prepared({ occurrence: 'inside', matrix: contained })]));
  const result = measurement(context.measure({ subject: box({ min: [1, 0, 0], max: [3, 2, 2] }),
    against: { kind: 'query', query: {} }, operation: 'clearance', clearanceMetres: 0 }));
  assert.equal(result.clearance, 'violated-mesh');
});

test('explicit exclusions require exact live pins while verified replay rebinds historical exclusions', () => {
  const context = createGeometryContext(input()); const ref = discovered(context); assert.equal(ref.kind, 'ifc');
  if (ref.kind !== 'ifc') return;
  for (const stale of [{ ...ref, revision: 'obsolete' }, { ...ref, originalSha256: 'e'.repeat(64) }, { ...ref, placementDigest: 'f'.repeat(64) }]) {
    const rejected = context.query({ query: { exclude: [stale] } }); assert.equal(rejected.kind, 'unavailable');
    if (rejected.kind === 'unavailable') assert.equal(rejected.reason, 'stale-reference');
    assert.equal(context.measure({ subject: box({ min: [2, 0, 0], max: [3, 1, 1] }), against: { kind: 'query', query: { exclude: [stale] } }, operation: 'distance' }).kind, 'unavailable');
  }
  const clean = createGeometryContext(input()); const emptyPage = clean.query({ query: { exclude: [ref] } });
  assert.equal(emptyPage.kind, 'complete'); if (emptyPage.kind === 'complete') assert.equal(emptyPage.total, 0);
  const replaced = createGeometryContext(input([prepared({ revision: 'v2', originalSha256: 'd'.repeat(64), name: 'Unrelated property edit' })]));
  assert.equal(validateGeometryReceipts({ receipts: clean.receipts(), current: replaced }).kind, 'stale');
  assert.equal(validateGeometryReceipts({ receipts: clean.receipts(), current: replaced, verifyCorrespondence: () => true }).kind, 'fresh');
  assert.equal(validateGeometryReceipts({ receipts: clean.receipts(), current: createGeometryContext(input([])), verifyCorrespondence: () => true }).kind, 'stale');
});

test('all four methods hash their public wire payload and schema-valid payload changes fail receipt binding', () => {
  const context = createGeometryContext(input()); const ref = discovered(context);
  const description = context.describe(ref); const page = context.query({ query: {} }); const relations = context.relations(ref);
  const measured = context.measure({ subject: box({ min: [1.5, 0, 0], max: [2, 1, 1] }), against: { kind: 'object', ref }, operation: 'distance' });
  const missing = createGeometryContext(input([prepared({ missing: true })]));
  const partial = missing.query({ query: { region: { min: [0, 0, 0], max: [2, 2, 2] } } });
  const unavailable = context.describe({ ...ref, projectId: 'outside' });
  for (const result of [description, page, relations, measured, partial, unavailable]) {
    assert.equal(result.receipt.resultDigest, geometryPublicResultDigest(result));
    assert.equal(geometryReplyMatchesReceipt(result, { projectId, operationDigest: result.receipt.operationDigest }), true);
  }
  assert.equal(description.kind, 'complete'); assert.equal(page.kind, 'complete'); assert.equal(relations.kind, 'complete'); assert.equal(measured.kind, 'complete');
  if (description.kind !== 'complete' || page.kind !== 'complete' || relations.kind !== 'complete' || measured.kind !== 'complete') return;
  const changedDescription = structuredClone(description); changedDescription.value.name = 'Changed after receipt creation';
  const changedPage = structuredClone(page); changedPage.total++;
  const changedRelations = structuredClone(relations); changedRelations.items.push({ kind: 'level', target: ref, basis: 'declared' });
  const changedMeasurement = structuredClone(measured); changedMeasurement.value.distanceMetres = .75;
  assert.ok(Check(GeometryDescriptionResultSchema, changedDescription)); assert.ok(Check(GeometryQueryResultSchema, changedPage));
  assert.ok(Check(GeometryRelationsResultSchema, changedRelations)); assert.ok(Check(GeometryMeasureResultSchema, changedMeasurement));
  for (const result of [changedDescription, changedPage, changedRelations, changedMeasurement]) {
    assert.equal(geometryReplyMatchesReceipt(result, { projectId, operationDigest: result.receipt.operationDigest }), false);
  }
});

test('the actual worker session rejects a schema-valid changed measurement and fences all receipt publication', async t => {
  const originalEmit = Worker.prototype.emit;
  t.mock.method(Worker.prototype, 'emit', function(this: Worker, event: string | symbol, ...args: unknown[]): boolean {
    const frame = args[0];
    if (event === 'message' && typeof frame === 'object' && frame !== null && 'kind' in frame && frame.kind === 'result'
      && 'value' in frame && Check(GeometryMeasureResultSchema, frame.value) && frame.value.kind === 'complete') {
      const changed = structuredClone(frame.value); changed.value.distanceMetres = .75;
      return originalEmit.call(this, event, { ...frame, value: changed }, ...args.slice(1));
    }
    return originalEmit.call(this, event, ...args);
  });
  const session = await createGeometrySession(input());
  try {
    const page = await session.query({ query: {} }); assert.equal(page.kind, 'complete'); if (page.kind !== 'complete') return;
    await assert.rejects(session.measure({ subject: box({ min: [1.5, 0, 0], max: [2, 1, 1] }),
      against: { kind: 'object', ref: page.items[0].ref }, operation: 'distance' }), /does not match/);
    assert.throws(() => session.receipts(), /does not match/);
  } finally { await session.close(); }
});

test('canonical fixed-array schemas preserve vector, matrix and footprint bounds without tuple-only JSON keywords', () => {
  assert.equal(Check(GeometryPointSchema, [1, -2, 3]), true);
  for (const value of [[], [1, 2], [1, 2, 3, 4], ['1', 2, 3], [null, 2, 3], [Infinity, 2, 3], [NaN, 2, 3], [1e6 + 1, 2, 3]]) {
    assert.equal(Check(GeometryPointSchema, value), false);
  }
  assert.deepEqual(vector3([1, -2, 3]), [1, -2, 3]);
  for (const value of [[], [1, 2], [1, 2, 3, 4], [Infinity, 2, 3], [1e6 + 1, 2, 3], new Array<number>(3)]) assert.throws(() => vector3(value));
  assert.equal(Check(GeometryMatrixSchema, identity), true);
  for (const value of [identity.slice(0, 3), [...identity, identity[0]], identity.map(row => row.slice(0, 3)), identity.map(row => [...row, 0]),
    [['1', 0, 0, 0], ...identity.slice(1)], [[1e6 + 1, 0, 0, 0], ...identity.slice(1)], [[NaN, 0, 0, 0], ...identity.slice(1)]]) {
    assert.equal(Check(GeometryMatrixSchema, value), false);
  }
  const footprint = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  assert.equal(Check(GeometrySemanticsSchema, { kind: 'space', footprintProjectMetres: footprint }), true);
  assert.equal(Check(GeometrySemanticsSchema, { kind: 'space', footprintProjectMetres: footprint.slice(0, 3) }), false);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const child of value) visit(child); return; }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      assert.notEqual(key, 'additionalItems'); if (key === 'items') assert.equal(Array.isArray(child), false);
      visit(child);
    }
  };
  for (const schema of [GeometryMeasureRequestSchema, GeometryDescriptionResultSchema, GeometryQueryResultSchema, GeometryRelationsResultSchema, GeometryMeasureResultSchema]) visit(schema);
});
