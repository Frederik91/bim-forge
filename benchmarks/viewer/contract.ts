import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';

const options = { additionalProperties: false };
const text = Type.String({ minLength: 1 });
const finite = Type.Number();
const vec3 = Type.Tuple([finite, finite, finite]);
const sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' });
const cameraSchema = Type.Object({ eye: vec3, target: vec3 }, options);
const sourceEvidence = {
  sourceHashes: Type.Array(sha256, { minItems: 1 }), permissionEvidence: text,
  floorAreaEvidence: text, coordinateReference: text, conversionEvidence: text,
  inventoryEvidence: text, limitations: Type.Array(text),
};
const elementSchema = Type.Object({
  id: text, category: text, discipline: text, storey: text, geometryId: text,
  position: vec3, scale: vec3, color: vec3,
  properties: Type.Record(Type.String(), Type.String()),
}, options);
const geometrySchema = Type.Object({ id: text,
  positions: Type.Array(finite, { minItems: 9 }),
  indices: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 3 }),
}, options);
export const ModelSchema = Type.Object({
  version: Type.Literal(1), id: text, revision: text,
  coordinateSystem: Type.Literal('right-handed-y-up-metres'),
  grossFloorAreaM2: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  cameraPath: Type.Array(cameraSchema, { minItems: 1 }),
  provenance: Type.Union([
    Type.Object({ kind: Type.Literal('synthetic'), seed: Type.Integer() }, options),
    Type.Object({ kind: Type.Literal('real'), ...sourceEvidence }, options),
    Type.Object({ kind: Type.Literal('public-unverified'), ...sourceEvidence }, options),
  ]),
  geometries: Type.Array(geometrySchema, { minItems: 1 }),
  elements: Type.Array(elementSchema, { minItems: 1 }),
}, options);
export type Model = Static<typeof ModelSchema>;
export type Element = Model['elements'][number];
export type Geometry = Model['geometries'][number];
export type Vec3 = Element['position'];
export const NativeManifestSchema = Type.Object({ version: Type.Literal(1), format: Type.Literal('fragments-3.6.0-raw'),
  modelId: text, revision: text, sourceSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }), sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  preprocessorSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  bytes: Type.Integer({ minimum: 1 }), elements: Type.Integer({ minimum: 1 }), triangles: Type.Integer({ minimum: 1 }),
  disciplines: Type.Record(Type.String(), Type.Integer({ minimum: 1 })), preparationMs: Type.Number({ minimum: 0 }),
  qualified: Type.Literal(false), grossFloorAreaM2: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
}, options);
export const FragmentsInputSchema = Type.Union([Type.Object({ kind: Type.Literal('raw-edit') }, options),
  Type.Object({ kind: Type.Literal('native'), manifest: NativeManifestSchema }, options)]);
export type NativeManifest = Static<typeof NativeManifestSchema>;
export function parseFragmentsInput(input: unknown): Static<typeof FragmentsInputSchema> {
  if (!Check(FragmentsInputSchema, input)) throw new Error('Invalid Fragments input configuration');
  return input;
}
export function assertNativeManifest(manifest: NativeManifest, model: Model, sourceSha256: string): void {
  const disciplines = Object.fromEntries([...new Set(model.elements.map(item => item.discipline))].map(discipline =>
    [discipline, model.elements.filter(item => item.discipline === discipline).length]));
  const trianglesByGeometry = new Map(model.geometries.map(item => [item.id, item.indices.length / 3]));
  const triangles = model.elements.reduce((sum, item) => sum + (trianglesByGeometry.get(item.geometryId) ?? 0), 0);
  if (manifest.modelId !== model.id || manifest.revision !== model.revision || manifest.sourceSha256 !== sourceSha256 || manifest.triangles !== triangles
    || manifest.elements !== model.elements.length || manifest.grossFloorAreaM2 !== model.grossFloorAreaM2
    || JSON.stringify(Object.entries(manifest.disciplines).sort()) !== JSON.stringify(Object.entries(disciplines).sort())) throw new Error('Native Fragments input does not match the common model');
}
export const ProposalSchema = Type.Object({
  id: text, baseRevision: text, nextRevision: text,
  upsert: Type.Array(elementSchema), remove: Type.Array(text),
}, options);
export type Proposal = Static<typeof ProposalSchema>;
export interface Changes { upsert: Element[]; remove: string[] }
export interface Camera { eye: Vec3; target: Vec3 }
export interface Readback { id: string; position: Vec3; min: Vec3; max: Vec3 }
export interface ResourceWork {
  rebuiltBatches: number; uploadedVertices: number; uploadedIndices: number; preservedBatches: number;
  batches: number; elements: number; storedTriangles: number;
}
export interface Adapter {
  load(model: Model): Promise<void>;
  apply(changes: Changes): Promise<void>;
  camera(view: Camera): Promise<void>;
  pick(x: number, y: number): Promise<string | null>;
  select(id: string | null): Promise<void>;
  properties(id: string): Promise<Record<string, string>>;
  visible(ids: string[] | null): Promise<void>;
  section(height: number | null): Promise<void>;
  readback(): Promise<Readback[]>;
  frame(): Promise<void>;
  stats(): { drawCalls: number; triangles: number };
  resources?(): ResourceWork;
  dispose(): Promise<void>;
}

export function parseModel(input: unknown, ownership: 'copy' | 'transfer' = 'copy'): Model {
  if (!Check(ModelSchema, input)) throw new Error('Invalid viewer model schema');
  const ids = new Set<string>(); const geometries = new Map<string, Geometry>();
  for (const geometry of input.geometries) {
    if (geometries.has(geometry.id)) throw new Error('Duplicate geometry ID');
    if (geometry.positions.length % 3 || geometry.indices.length % 3
      || geometry.indices.some(index => index >= geometry.positions.length / 3)
      || geometry.positions.some(value => !Number.isFinite(value))) throw new Error('Invalid triangle geometry');
    geometries.set(geometry.id, geometry);
  }
  for (const element of input.elements) {
    if (ids.has(element.id) || element.id.startsWith('before:')) throw new Error('Duplicate or reserved element ID');
    if (!geometries.has(element.geometryId)) throw new Error('Missing geometry');
    if ([...element.position, ...element.scale, ...element.color].some(value => !Number.isFinite(value))
      || element.scale.some(value => value <= 0) || element.color.some(value => value < 0 || value > 1)) throw new Error('Invalid element transform or color');
    ids.add(element.id);
  }
  for (const camera of input.cameraPath) {
    if ([...camera.eye, ...camera.target].some(value => !Number.isFinite(value))
      || camera.eye.every((value, axis) => value === camera.target[axis])) throw new Error('Invalid camera');
  }
  return ownership === 'copy' ? structuredClone(input) : input;
}

export function applyProposal(base: Model, input: unknown): Model {
  if (!Check(ProposalSchema, input)) throw new Error('Invalid proposal schema');
  if (input.baseRevision !== base.revision || input.nextRevision === base.revision) throw new Error('Stale or invalid proposal revision');
  const elements = new Map(base.elements.map(item => [item.id, item]));
  const touched = new Set<string>();
  for (const id of input.remove) {
    if (!elements.has(id) || touched.has(id)) throw new Error('Invalid removal');
    touched.add(id); elements.delete(id);
  }
  for (const item of input.upsert) {
    if (touched.has(item.id)) throw new Error('Duplicate proposal change');
    touched.add(item.id); elements.set(item.id, item);
  }
  // Proposals replace element records; tessellation is shared and read-only.
  return parseModel({ ...base, revision: input.nextRevision, elements: structuredClone([...elements.values()]) }, 'transfer');
}

export function unchangedModel(model: Model): () => boolean {
  const header = (): string => JSON.stringify({ ...model, geometries: [], elements: [] });
  const originalHeader = header();
  const geometries = model.geometries.map(item => JSON.stringify(item));
  const elements = model.elements.map(item => JSON.stringify(item));
  // Exact per-record comparisons retain full mutation coverage without another
  // federation-sized temporary string during every accepted-state assertion.
  return () => header() === originalHeader
    && model.geometries.length === geometries.length && model.elements.length === elements.length
    && model.geometries.every((item, index) => JSON.stringify(item) === geometries[index])
    && model.elements.every((item, index) => JSON.stringify(item) === elements[index]);
}

export function changesBetween(before: Element[], after: Element[]): Changes {
  const previous = new Map(before.map(item => [item.id, item]));
  const current = new Set(after.map(item => item.id));
  return { remove: before.filter(item => !current.has(item.id)).map(item => item.id),
    upsert: after.filter(item => JSON.stringify(previous.get(item.id)) !== JSON.stringify(item)) };
}

export function comparisonElements(base: Model, proposal: Model): Element[] {
  const before = new Map(base.elements.map(item => [item.id, item]));
  const after = new Map(proposal.elements.map(item => [item.id, item]));
  const result = proposal.elements.map(item => {
    const original = before.get(item.id);
    if (!original) return { ...item, color: [0.08, 0.7, 0.35] satisfies Vec3 };
    return JSON.stringify(original) === JSON.stringify(item) ? item : { ...item, color: [1, 0.65, 0.08] satisfies Vec3 };
  });
  for (const item of base.elements) {
    const next = after.get(item.id);
    if (JSON.stringify(item) !== JSON.stringify(next)) result.push({ ...item, id: 'before:' + item.id,
      color: next ? [0.55, 0.4, 0.1] : [0.85, 0.1, 0.2] });
  }
  return result;
}

export function admission(model: Model): { qualified: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (model.provenance.kind === 'synthetic') reasons.push('Synthetic fixture cannot qualify a realistic project');
  if (model.provenance.kind === 'public-unverified') reasons.push('Public model identity, area and rights have not been admitted');
  if (model.grossFloorAreaM2 === null) reasons.push('Gross floor area is unknown');
  else if (model.grossFloorAreaM2 < 200000) reasons.push('Gross floor area is below 200,000 m²');
  const disciplines = new Set(model.elements.map(item => item.discipline));
  for (const discipline of ['architecture', 'structure', 'mechanical', 'electrical', 'plumbing']) {
    if (!disciplines.has(discipline)) reasons.push('Missing discipline: ' + discipline);
  }
  reasons.push('Dataset evidence, hardware profile, conversion equivalence, and complete scored scenarios require human qualification');
  return { qualified: false, reasons };
}

export function assertReadback(model: Model, elements: Element[], actual: Readback[]): void {
  if (elements.length !== actual.length || new Set(actual.map(item => item.id)).size !== actual.length) throw new Error('Renderer element count/identity mismatch: expected=' + elements.length + ' actual=' + actual.length + ' unique=' + new Set(actual.map(item => item.id)).size);
  const byId = new Map(actual.map(item => [item.id, item]));
  const geometryBounds = new Map(model.geometries.map(geometry => {
    const min: Vec3 = [Infinity, Infinity, Infinity]; const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < geometry.positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], geometry.positions[i + axis]); max[axis] = Math.max(max[axis], geometry.positions[i + axis]);
    }
    return [geometry.id, { min, max }] satisfies [string, { min: Vec3; max: Vec3 }];
  }));
  for (const element of elements) {
    const item = byId.get(element.id); const geometry = geometryBounds.get(element.geometryId);
    if (!item || !geometry || item.position.some((value, axis) => !Number.isFinite(value) || Math.abs(value - element.position[axis]) > 0.0001)) throw new Error('Renderer transform mismatch: ' + element.id);
    for (const side of ['min', 'max'] satisfies ('min' | 'max')[]) {
      if (item[side].some((value, axis) => !Number.isFinite(value)
        || Math.abs(value - (geometry[side][axis] * element.scale[axis] + element.position[axis])) > .001)) throw new Error('Renderer geometry bounds mismatch: ' + element.id + ' ' + side + '=' + JSON.stringify(item[side]));
    }
  }
}
