import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';

export const MAX_LINK_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_LINK_OUTPUT_BYTES = 8 * 1024 * 1024;
const token = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' });
const guid = Type.String({ pattern: '^[0-3][0-9A-Za-z_$]{21}$' });
const hash = Type.String({ pattern: '^[a-f0-9]{64}$' });
const number = Type.Number({ minimum: -1e6, maximum: 1e6 });
const matrix = Type.Array(Type.Array(number, { minItems: 4, maxItems: 4 }), { minItems: 4, maxItems: 4 });
const source = Type.Object({ namespace: token, revision: token, originalSha256: hash }, { additionalProperties: false });
export const LinkedSourceSchema = source;
export const LinkedTransformSchema = matrix;
const ref = Type.Object({ namespace: token, revision: token, originalSha256: hash, globalId: guid }, { additionalProperties: false });
const artifact = Type.Object({ sha256: hash, bytes: Type.Integer({ minimum: 1, maximum: MAX_LINK_OUTPUT_BYTES }) }, { additionalProperties: false });
const ManifestSchema = Type.Object({
  format: Type.Literal('bim-forge-ifc-link'), version: Type.Literal(1), state: Type.Literal('complete'), readOnly: Type.Literal(true),
  source, schema: Type.Literal('IFC4'), tool: Type.Object({ ifcopenshell: Type.Literal('0.9.0.post1') }),
  occurrence: Type.Object({ id: token, sourceToProjectMetres: matrix }),
  artifacts: Type.Object({ 'original.ifc': artifact, 'index.json': artifact, 'geometry.json': artifact }, { additionalProperties: false }),
  counts: Type.Object({ entities: Type.Integer({ maximum: 2000, minimum: 1 }), objects: Type.Integer({ maximum: 2000, minimum: 0 }),
    products: Type.Integer({ maximum: 64, minimum: 0 }), meshes: Type.Integer({ maximum: 64, minimum: 0 }),
    vertices: Type.Integer({ maximum: 50000, minimum: 0 }), triangles: Type.Integer({ maximum: 100000, minimum: 0 }) }),
  diagnostics: Type.Array(Type.Unknown(), { maxItems: 4000 }), losses: Type.Array(Type.String({ maxLength: 2048 }), { maxItems: 32 }),
});
const IndexSchema = Type.Object({ source, schema: Type.Literal('IFC4'), unitScaleToMetres: Type.Union([Type.Literal(1), Type.Literal(.001)]),
  units: Type.Array(Type.Unknown(), { maxItems: 2000 }), georeferencing: Type.Object({ applied: Type.Literal(false), inventory: Type.Array(Type.Unknown(), { maxItems: 2000 }) }),
  objects: Type.Array(Type.Object({ ref, ifcClass: Type.String({ maxLength: 128 }), name: Type.Union([Type.String(), Type.Null()]),
    properties: Type.Array(Type.Unknown(), { maxItems: 2000 }) }), { maxItems: 2000 }),
  spatial: Type.Array(Type.Object({ kind: Type.Union([Type.Literal('containment'), Type.Literal('decomposition')]), parent: guid, child: guid }), { maxItems: 4000 }),
  relationships: Type.Array(Type.Unknown(), { maxItems: 2000 }), placements: Type.Array(Type.Unknown(), { maxItems: 64 }),
});
const GeometrySchema = Type.Object({ source, frame: Type.Literal('source-engineering-metres'), meshes: Type.Array(Type.Object({ ref,
  verticesMetres: Type.Array(number, { minItems: 9, maxItems: 150000 }),
  triangles: Type.Array(Type.Integer({ minimum: 0, maximum: 49999 }), { minItems: 3, maxItems: 300000 }), productToSourceMetres: matrix,
}), { maxItems: 64 }) });
export type LinkedManifest = Static<typeof ManifestSchema>;
export type LinkedIndex = Static<typeof IndexSchema>;
export type LinkedGeometry = Static<typeof GeometrySchema>;
export type LinkedPrepared = { manifest: LinkedManifest; index: LinkedIndex; geometry: LinkedGeometry };
export function assertLinkedDisplayOccurrence(id: string, prepared: LinkedPrepared): void {
  if (id !== prepared.manifest.occurrence.id) throw new Error('IFC display/job ID must match its source occurrence ID.');
}
export type LinkedSelection = { kind: 'ifc-reference'; source: Static<typeof ref>; occurrence: LinkedManifest['occurrence'] };
export const IDENTITY_LINK_TRANSFORM = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

export function linkPoint(matrix: number[][], point: readonly number[]): number[] {
  return matrix.slice(0, 3).map(row => row.slice(0, 3).reduce((sum, value, axis) => sum + value * (point[axis] ?? 0), row[3] ?? 0));
}
export function assertRigidLinkTransform(matrix: number[][]): void {
  if (!Check(Type.Array(Type.Array(number, { minItems: 4, maxItems: 4 }), { minItems: 4, maxItems: 4 }), matrix)) throw new Error('Invalid bounded IFC transform.');
  if (matrix.flat().some(value => !Number.isFinite(value))) throw new Error('Invalid finite IFC transform.');
  if (JSON.stringify(matrix[3]) !== '[0,0,0,1]') throw new Error('Invalid IFC transform.');
  const rows = matrix.slice(0, 3);
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    const dot = (rows[a] ?? []).slice(0, 3).reduce((sum, value, i) => sum + value * (rows[b]?.[i] ?? 0), 0);
    if (Math.abs(dot - (a === b ? 1 : 0)) > 1e-7) throw new Error('Invalid rigid IFC transform.');
  }
  const [a = [], b = [], c = []] = rows;
  const det = (a[0] ?? 0) * ((b[1] ?? 0) * (c[2] ?? 0) - (b[2] ?? 0) * (c[1] ?? 0))
    - (a[1] ?? 0) * ((b[0] ?? 0) * (c[2] ?? 0) - (b[2] ?? 0) * (c[0] ?? 0))
    + (a[2] ?? 0) * ((b[0] ?? 0) * (c[1] ?? 0) - (b[1] ?? 0) * (c[0] ?? 0));
  if (Math.abs(det - 1) > 1e-7) throw new Error('Reflected IFC transform.');
}
export function parseLinkedPrepared(value: unknown): LinkedPrepared {
  if (typeof value !== 'object' || value === null || !('manifest' in value) || !('index' in value) || !('geometry' in value)
      || !Check(ManifestSchema, value.manifest) || !Check(IndexSchema, value.index) || !Check(GeometrySchema, value.geometry)) throw new Error('Invalid bounded IFC artifacts.');
  const { manifest, index, geometry } = value;
  const binding = JSON.stringify(manifest.source);
  const sameSource = (input: Static<typeof source>) => input.namespace === manifest.source.namespace && input.revision === manifest.source.revision && input.originalSha256 === manifest.source.originalSha256;
  if (!binding || !sameSource(index.source) || !sameSource(geometry.source)) throw new Error('IFC source binding differs.');
  assertRigidLinkTransform(manifest.occurrence.sourceToProjectMetres);
  const ids = new Set(index.objects.map(item => item.ref.globalId));
  if (ids.size !== index.objects.length || index.objects.some(item => !sameSource(item.ref)) || index.spatial.some(edge => !ids.has(edge.parent) || !ids.has(edge.child))) throw new Error('Invalid IFC object identity.');
  let vertices = 0; let triangles = 0;
  const meshes = new Set<string>();
  for (const mesh of geometry.meshes) {
    if (!sameSource(mesh.ref) || !ids.has(mesh.ref.globalId) || meshes.has(mesh.ref.globalId) || mesh.verticesMetres.length % 3 || mesh.triangles.length % 3
        || mesh.triangles.some(i => i >= mesh.verticesMetres.length / 3)) throw new Error('Invalid IFC mesh identity or topology.');
    meshes.add(mesh.ref.globalId); assertRigidLinkTransform(mesh.productToSourceMetres);
    vertices += mesh.verticesMetres.length / 3; triangles += mesh.triangles.length / 3;
    for (let i = 0; i < mesh.verticesMetres.length; i += 3) {
      const sourcePoint = linkPoint(mesh.productToSourceMetres, mesh.verticesMetres.slice(i, i + 3));
      const projectPoint = linkPoint(manifest.occurrence.sourceToProjectMetres, sourcePoint);
      if ([...sourcePoint, ...projectPoint].some(n => !Number.isFinite(n) || Math.abs(n) > 1e6)) throw new Error('IFC coordinates exceed envelope.');
    }
  }
  if (vertices > 50000 || triangles > 100000 || manifest.counts.vertices !== vertices || manifest.counts.triangles !== triangles
      || manifest.counts.meshes !== geometry.meshes.length || manifest.counts.objects !== index.objects.length) throw new Error('IFC geometry counts differ.');
  return { manifest, index, geometry };
}

const commonJob = { id: Type.String({ pattern: '^[a-f0-9-]{36}$' }), projectId: Type.String({ pattern: '^[a-f0-9-]{36}$' }),
  name: Type.String({ minLength: 1, maxLength: 160 }), source, occurrence: token, createdAt: Type.Integer({ minimum: 0 }) };
export const LinkedJobSchema = Type.Union([
  Type.Object({ ...commonJob, kind: Type.Literal('queued') }),
  Type.Object({ ...commonJob, kind: Type.Literal('running'), progress: Type.String({ maxLength: 256 }) }),
  Type.Object({ ...commonJob, kind: Type.Literal('ready') }),
  Type.Object({ ...commonJob, kind: Type.Literal('failed'), error: Type.String({ maxLength: 1024 }) }),
  Type.Object({ ...commonJob, kind: Type.Literal('cancelled') }),
]);
export type LinkedJob = Static<typeof LinkedJobSchema>;
export function parseLinkedJob(value: unknown): LinkedJob {
  if (!Check(LinkedJobSchema, value)) throw new Error('Invalid IFC job.'); return value;
}
export function linkedReferenceText(selection: LinkedSelection): string {
  return `Read-only IFC context (no native edit authority): ${JSON.stringify(selection)}`;
}
export function linkedSelectionKey(selection: LinkedSelection): string {
  const { source, occurrence } = selection;
  return JSON.stringify([source.namespace, source.revision, source.originalSha256, source.globalId, occurrence.id, occurrence.sourceToProjectMetres]);
}

export const MAX_LINK_REVISIONS = 8;
export const LinkedStateSchema = Type.Object({
  id: token, projectId: token, namespace: token, occurrence: token,
  generation: Type.Integer({ minimum: 0 }), currentVersionId: Type.Union([token, Type.Null()]),
  sourceToProjectMetres: matrix,
}, { additionalProperties: false });
export type LinkedState = Static<typeof LinkedStateSchema>;
export function parseLinkedState(value: unknown): LinkedState {
  if (!Check(LinkedStateSchema, value)) throw new Error('Invalid IFC link state.');
  assertRigidLinkTransform(value.sourceToProjectMetres); return value;
}
const deltaIds = Type.Array(guid, { maxItems: 2000 });
const LinkedDeltaSchema = Type.Object({ added: deltaIds, removed: deltaIds, moved: deltaIds, geometry: deltaIds, properties: deltaIds,
  ambiguous: deltaIds, unchanged: deltaIds, transformChanged: Type.Boolean(), correspondence: Type.Union([Type.Literal('same-source'), Type.Literal('global-id-only')]) });
export type LinkedDelta = Static<typeof LinkedDeltaSchema>;
const LinkedCatalogSchema = Type.Array(Type.Object({ state: LinkedStateSchema,
  versions: Type.Array(Type.Object({ job: LinkedJobSchema, expectedGeneration: Type.Integer({ minimum: 0 }), current: Type.Boolean(), adopted: Type.Boolean() }), { maxItems: MAX_LINK_REVISIONS }),
  revisionLimit: Type.Literal(MAX_LINK_REVISIONS) }), { maxItems: 8 });
export type LinkedCatalogItem = Static<typeof LinkedCatalogSchema>[number];
export function parseLinkedCatalog(value: unknown): LinkedCatalogItem[] {
  if (!Check(LinkedCatalogSchema, value)) throw new Error('Invalid IFC version catalog.');
  for (const item of value) parseLinkedState(item.state); return value;
}
const LinkedReviewSchema = Type.Object({ linkId: token, candidateId: token, generation: Type.Integer({ minimum: 0 }), expectedGeneration: Type.Integer({ minimum: 0 }),
  delta: LinkedDeltaSchema, diagnostics: Type.Array(Type.Unknown(), { maxItems: 4000 }), losses: Type.Array(Type.String(), { maxItems: 32 }) });
export type LinkedReview = Static<typeof LinkedReviewSchema>;
export function parseLinkedReview(value: unknown): LinkedReview {
  if (!Check(LinkedReviewSchema, value)) throw new Error('Invalid IFC candidate review.'); return value;
}

/** Cross-revision identity is deliberately conservative: an exporter may reuse any GlobalId. */
export function linkedDelta(before: LinkedPrepared | null, after: LinkedPrepared): LinkedDelta {
  if (before && (before.manifest.source.namespace !== after.manifest.source.namespace || before.manifest.occurrence.id !== after.manifest.occurrence.id)) throw new Error('IFC correspondence requires the same namespace and occurrence.');
  const delta: LinkedDelta = { added: [], removed: [], moved: [], geometry: [], properties: [], ambiguous: [], unchanged: [],
    transformChanged: before !== null && JSON.stringify(before.manifest.occurrence) !== JSON.stringify(after.manifest.occurrence),
    correspondence: before?.manifest.source.originalSha256 === after.manifest.source.originalSha256 ? 'same-source' : 'global-id-only' };
  const previous = new Map(before?.index.objects.map(object => [object.ref.globalId, object]) ?? []);
  const current = new Map(after.index.objects.map(object => [object.ref.globalId, object]));
  const oldMeshes = new Map(before?.geometry.meshes.map(mesh => [mesh.ref.globalId, mesh]) ?? []);
  const newMeshes = new Map(after.geometry.meshes.map(mesh => [mesh.ref.globalId, mesh]));
  for (const id of previous.keys()) if (!current.has(id)) delta.removed.push(id);
  for (const [id, object] of current) {
    const old = previous.get(id); if (!old) { delta.added.push(id); continue; }
    const oldMesh = oldMeshes.get(id); const newMesh = newMeshes.get(id);
    const properties = JSON.stringify([old.ifcClass, old.name, old.properties]) !== JSON.stringify([object.ifcClass, object.name, object.properties]);
    const moved = JSON.stringify(oldMesh?.productToSourceMetres) !== JSON.stringify(newMesh?.productToSourceMetres);
    const shape = JSON.stringify([oldMesh?.verticesMetres, oldMesh?.triangles]) !== JSON.stringify([newMesh?.verticesMetres, newMesh?.triangles]);
    if (properties) delta.properties.push(id); if (moved) delta.moved.push(id); if (shape) delta.geometry.push(id);
    if (delta.correspondence === 'global-id-only' && (old.ifcClass !== object.ifcClass || shape || moved || properties)) delta.ambiguous.push(id);
    if (!properties && !moved && !shape) delta.unchanged.push(id);
  }
  return delta;
}
