import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { DesignTargetSchema } from './design-target-contract.ts';
import { GeometryReceiptSchema, GeometryMeasureRequestSchema, GeometryMeasureResultSchema,
  geometryPlainData, parseGeometryMeasureRequest, parseGeometryReceipts } from './geometry-contract.ts';
import type { GeometryNativeHistory, ModelSnapshot, Revision } from './room-model.ts';

const exact = { additionalProperties: false };
const identity = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' });
const hash = Type.String({ pattern: '^[a-f0-9]{64}$' });
const ancestorHeader = { requestId: identity, baseRevisionId: hash, proposalSnapshotSha256: hash, evidenceSha256: hash };
const collectionPatch = Type.Object({ remove: Type.Array(identity, { maxItems: 100, uniqueItems: true }),
  upsert: Type.Array(Type.Object({ id: identity }, { additionalProperties: true }), { maxItems: 100 }) }, exact);
const snapshotPatch = Type.Object({ snapshotVersion: Type.Union([Type.Literal('legacy'), Type.Literal(2)]),
  entities: collectionPatch, relationships: collectionPatch }, exact);
const ancestorFrame = Type.Object({ ...ancestorHeader, receiptCount: Type.Integer({ minimum: 0, maximum: 128 }),
  measurementCount: Type.Integer({ minimum: 0, maximum: 64 }),
  encoding: Type.Union([Type.Literal('v1-absent'), Type.Literal('v1-present'), Type.Literal('v2')]), patch: snapshotPatch }, exact);
const lineageSchema = Type.Object({ root: Type.Object({ chatId: identity, rootRevisionId: hash,
  target: DesignTargetSchema, originBaseRevisionId: hash, originBaseSnapshotSha256: hash }, exact),
  ancestors: Type.Array(ancestorFrame, { maxItems: 20 }) }, exact);
const evidenceFields = { projectId: identity, requestId: identity, baseRevisionId: hash, proposalSnapshotSha256: hash,
  receipts: Type.Array(GeometryReceiptSchema, { maxItems: 128 }),
  measurements: Type.Array(Type.Object({ request: GeometryMeasureRequestSchema, result: GeometryMeasureResultSchema }, exact), { maxItems: 64 }) };
const evidenceV1 = Type.Object({ version: Type.Literal(1), ...evidenceFields,
  inheritedFrom: Type.Optional(Type.Array(Type.Object(ancestorHeader, exact), { maxItems: 20 })) }, exact);
const evidenceV2 = Type.Object({ version: Type.Literal(2), ...evidenceFields, lineage: lineageSchema }, exact);

export const GeometryEvidenceSchema = Type.Union([evidenceV1, evidenceV2]);
export type GeometryEvidenceV1 = Static<typeof evidenceV1>;
export type GeometryEvidenceV2 = Static<typeof evidenceV2>;
export type GeometryEvidence = Static<typeof GeometryEvidenceSchema>;
export type GeometryDraftLineage = Static<typeof lineageSchema>;
export const MAX_GEOMETRY_EVIDENCE_BYTES = 64 * 1024;
export type GeometryEvidenceLimitDiagnostic = { code: 'geometry-evidence-byte-limit'; bytes: number; limitBytes: number;
  receiptCount: number; measurementCount: number };
export class GeometryEvidenceLimitError extends Error {
  readonly diagnostic: Readonly<GeometryEvidenceLimitDiagnostic>;
  constructor(bytes: number, receiptCount: number, measurementCount: number) {
    super(`[geometry-evidence-byte-limit] Geometry evidence uses ${bytes} bytes; the limit is ${MAX_GEOMETRY_EVIDENCE_BYTES} bytes.`);
    this.name = 'GeometryEvidenceLimitError';
    this.diagnostic = Object.freeze({ code: 'geometry-evidence-byte-limit', bytes,
      limitBytes: MAX_GEOMETRY_EVIDENCE_BYTES, receiptCount, measurementCount });
  }
}

/** Complete nominal native authority is supplied by the host, never a projected guest graph. */
export interface GeometryDraftBinding {
  readonly history: GeometryNativeHistory;
  readonly projectId: string;
  readonly requestId: string;
  readonly baseRevisionId: string;
  readonly snapshot: ModelSnapshot;
}
export interface GeometryDraftSeal {
  readonly evidence: GeometryEvidence;
  readonly snapshot: ModelSnapshot;
}
function fail(message: string): never { throw new Error(message); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  return fail('Geometry evidence requires finite JSON data.');
}
function equal(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right); }
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}
function assertBytes(value: unknown, receiptCount: number, measurementCount: number): void {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > MAX_GEOMETRY_EVIDENCE_BYTES) throw new GeometryEvidenceLimitError(bytes, receiptCount, measurementCount);
}
function uniqueRequests(requestId: string, ancestors: readonly { requestId: string }[]): void {
  const requests = new Set(ancestors.map(item => item.requestId));
  if (requests.size !== ancestors.length || requests.has(requestId)) fail('Geometry evidence lineage must be acyclic and unique.');
}
export function parseGeometryEvidence(input: unknown): GeometryEvidence {
  const value = geometryPlainData(input);
  if (!Check(GeometryEvidenceSchema, value)) return fail('Invalid bounded geometry evidence.');
  assertBytes(value, value.receipts.length, value.measurements.length);
  parseGeometryReceipts(value.receipts);
  uniqueRequests(value.requestId, value.version === 1 ? value.inheritedFrom ?? [] : value.lineage.ancestors);
  for (const receipt of value.receipts) if (receipt.projectId !== value.projectId) fail('Geometry evidence crosses projects.');
  for (const measurement of value.measurements) {
    parseGeometryMeasureRequest(measurement.request);
    if (!value.receipts.some(receipt => equal(receipt, measurement.result.receipt))) fail('Geometry measurement is not bound to its host observation.');
  }
  return value;
}
export function readGeometryEvidence(value: unknown): GeometryEvidence {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > MAX_GEOMETRY_EVIDENCE_BYTES) return fail('Invalid stored geometry evidence.');
  return parseGeometryEvidence(JSON.parse(value));
}
/** Shared with the v1 snapshot-only compatibility boundary. */
export async function assertGeometrySnapshotBound(evidence: GeometryEvidence, snapshot: ModelSnapshot): Promise<void> {
  if (await digest(snapshot) !== evidence.proposalSnapshotSha256) fail('Geometry evidence does not match the final authored snapshot.');
  for (const measurement of evidence.measurements) {
    const { receipt, ...outcome } = measurement.result;
    if (await digest({ method: 'measure', input: measurement.request }) !== receipt.operationDigest
        || await digest(outcome) !== receipt.resultDigest) fail('Geometry measurement request or result digest changed.');
  }
}

type Patch = Static<typeof snapshotPatch>;
type CollectionPatch = Static<typeof collectionPatch>;
type Frame = Static<typeof ancestorFrame>;
function sortedIds(ids: readonly string[]): boolean {
  return ids.every((id, index) => {
    const previous = ids[index - 1];
    return index === 0 || (previous !== undefined && previous < id);
  });
}
function patchCollection(base: readonly { id: string }[], patch: CollectionPatch): unknown[] {
  if (!sortedIds(patch.remove) || !sortedIds(patch.upsert.map(item => item.id))) fail('Geometry draft patch IDs must be sorted and unique.');
  const items = new Map(base.map(item => [item.id, item]));
  const removed = new Set(patch.remove);
  for (const id of patch.remove) if (!items.delete(id)) fail('Geometry draft patch removes an absent ID.');
  for (const item of patch.upsert) {
    if (removed.has(item.id) || equal(items.get(item.id) ?? null, item)) fail('Geometry draft patch contains an overlapping or redundant edit.');
    items.set(item.id, item);
  }
  return [...items.values()];
}
function replayPatch(base: ModelSnapshot, patch: Patch): unknown {
  return { ...(patch.snapshotVersion === 2 ? { version: 2 } : {}), units: 'm',
    entities: patchCollection(base.entities, patch.entities), relationships: patchCollection(base.relationships, patch.relationships) };
}
function collectionDelta(base: readonly { id: string }[], snapshot: readonly { id: string }[]): CollectionPatch {
  const previous = new Map(base.map(item => [item.id, item]));
  const current = new Map(snapshot.map(item => [item.id, item]));
  return { remove: [...previous.keys()].filter(id => !current.has(id)).sort(),
    upsert: [...current.values()].filter(item => !equal(previous.get(item.id) ?? null, item)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}
function modelDelta(base: ModelSnapshot, snapshot: ModelSnapshot): Patch {
  return { snapshotVersion: snapshot.version === 2 ? 2 : 'legacy',
    entities: collectionDelta(base.entities, snapshot.entities), relationships: collectionDelta(base.relationships, snapshot.relationships) };
}
function origin(history: GeometryNativeHistory, id: string): Revision {
  const revision = history.acceptedPath(id)[0];
  if (!revision || revision.id !== id) return fail('Geometry origin is outside accepted target ancestry.');
  return revision;
}
function headers(frames: readonly Frame[]): NonNullable<GeometryEvidenceV1['inheritedFrom']> {
  return frames.map(({ requestId, baseRevisionId, proposalSnapshotSha256, evidenceSha256 }) => ({ requestId,
    baseRevisionId, proposalSnapshotSha256, evidenceSha256 }));
}
function reconstruct(evidence: GeometryEvidenceV2, frame: Frame, index: number): GeometryEvidence {
  const prefix = evidence.lineage.ancestors.slice(0, index);
  const fields = { projectId: evidence.projectId, requestId: frame.requestId, baseRevisionId: frame.baseRevisionId,
    proposalSnapshotSha256: frame.proposalSnapshotSha256, receipts: evidence.receipts.slice(0, frame.receiptCount),
    measurements: evidence.measurements.slice(0, frame.measurementCount) };
  if (frame.encoding === 'v2') return parseGeometryEvidence({ version: 2, ...fields,
    lineage: { root: evidence.lineage.root, ancestors: prefix } });
  if (prefix.some(item => item.encoding === 'v2') || (frame.encoding === 'v1-absent' && prefix.length)) return fail('Legacy geometry evidence is missing or changes its predecessor chain.');
  return parseGeometryEvidence({ version: 1, ...fields,
    ...(frame.encoding === 'v1-present' ? { inheritedFrom: headers(prefix) } : {}) });
}

/** Derives indexes only: source receipts/endpoints and current calls are never filtered here. */
export async function inactiveInheritedBoxMeasurements(input: {
  readonly evidence: GeometryEvidence; readonly binding: GeometryDraftBinding;
}): Promise<readonly number[]> {
  const evidence = parseGeometryEvidence(input.evidence);
  const { history, projectId, requestId, baseRevisionId } = input.binding;
  if (history.projectId !== projectId || evidence.projectId !== projectId || evidence.requestId !== requestId
      || evidence.baseRevisionId !== baseRevisionId) fail('Geometry evidence differs from its original review binding.');
  origin(history, baseRevisionId);
  if (evidence.version === 1) {
    const snapshot = history.validateSnapshots([input.binding.snapshot])[0];
    if (!snapshot) return fail('Missing native geometry snapshot.');
    await assertGeometrySnapshotBound(evidence, snapshot); return Object.freeze([]);
  }
  const { root, ancestors } = evidence.lineage;
  if (root.rootRevisionId !== history.rootRevisionId || !equal(root.target, history.target)) fail('Geometry lineage crosses project roots or native targets.');
  const path = history.acceptedPath(root.originBaseRevisionId);
  const first = path[0];
  if (!first || await digest(first.snapshot) !== root.originBaseSnapshotSha256) fail('Geometry lineage origin snapshot changed.');
  const position = new Map(path.map((revision, index) => [revision.id.toString(), index]));
  const boundPosition = position.get(baseRevisionId);
  if (boundPosition === undefined) return fail('Geometry review base is outside lineage accepted ancestry.');
  let priorPosition = 0; let receipts = 0; let measurements = 0;
  const bases: Revision[] = []; const reconstructed: unknown[] = [];
  for (const frame of ancestors) {
    const framePosition = position.get(frame.baseRevisionId);
    if (framePosition === undefined || framePosition < priorPosition || framePosition > boundPosition) fail('Geometry lineage bases are outside ordered accepted ancestry.');
    if (frame.receiptCount < receipts || frame.measurementCount < measurements
        || frame.receiptCount > evidence.receipts.length || frame.measurementCount > evidence.measurements.length) fail('Geometry lineage prefixes must be monotone and bounded.');
    const base = origin(history, frame.baseRevisionId);
    bases.push(base); reconstructed.push(replayPatch(base.snapshot, frame.patch));
    priorPosition = framePosition; receipts = frame.receiptCount; measurements = frame.measurementCount;
  }
  const snapshots = history.validateSnapshots([...reconstructed, input.binding.snapshot]);
  const original = snapshots.at(-1);
  if (!original) return fail('Missing native geometry snapshot.');
  await assertGeometrySnapshotBound(evidence, original);
  const final = history.validateSnapshots([...snapshots, history.reconcile(baseRevisionId, original)]).at(-1);
  if (!final) return fail('Missing reconciled native geometry snapshot.');
  for (const [index, frame] of ancestors.entries()) {
    const snapshot = snapshots[index]; const base = bases[index];
    if (!snapshot || !base || !equal(frame.patch, modelDelta(base.snapshot, snapshot))) fail('Geometry lineage model patch is not canonical.');
    const previous = reconstruct(evidence, frame, index);
    if (await digest(previous) !== frame.evidenceSha256) fail('Geometry lineage evidence prefix hash changed.');
    await assertGeometrySnapshotBound(previous, snapshot);
  }
  const acceptedIds = new Set(path.flatMap(revision => revision.snapshot.entities.map(entity => entity.id.toString())));
  const finalIds = new Set(final.entities.map(entity => entity.id.toString()));
  const inactive: number[] = [];
  for (let index = 0; index < measurements; index += 1) {
    const measurement = evidence.measurements[index];
    if (!measurement || measurement.request.subject.kind !== 'box') continue;
    const id = measurement.request.subject.candidateId;
    if (acceptedIds.has(id) || finalIds.has(id)) continue;
    const generation = ancestors.findIndex(frame => index < frame.measurementCount);
    const base = bases[generation]; const snapshot = snapshots[generation];
    if (base && snapshot && !base.snapshot.entities.some(entity => entity.id === id)
        && snapshot.entities.some(entity => entity.id === id)) inactive.push(index);
  }
  return Object.freeze(inactive);
}

export async function createGeometryDraftLineage(input: {
  readonly history: GeometryNativeHistory; readonly chatId: string; readonly ancestors: readonly GeometryDraftSeal[];
}): Promise<GeometryDraftLineage> {
  if (input.ancestors.length > 20 || !Check(identity, input.chatId)) return fail('Invalid bounded geometry lineage input.');
  const { history } = input;
  let lineage: GeometryDraftLineage | undefined; let previous: GeometryEvidence | undefined;
  for (const seal of input.ancestors) {
    const evidence = parseGeometryEvidence(seal.evidence);
    const base = origin(history, evidence.baseRevisionId);
    await inactiveInheritedBoxMeasurements({ evidence, binding: { history, projectId: history.projectId,
      requestId: evidence.requestId, baseRevisionId: evidence.baseRevisionId, snapshot: seal.snapshot } });
    const snapshot = history.validateSnapshots([seal.snapshot])[0];
    if (!snapshot) return fail('Missing native geometry snapshot.');
    if (!lineage) lineage = evidence.version === 2 ? structuredClone(evidence.lineage) : {
      root: { chatId: input.chatId, rootRevisionId: history.rootRevisionId, target: structuredClone(history.target),
        originBaseRevisionId: base.id, originBaseSnapshotSha256: await digest(base.snapshot) }, ancestors: [] };
    if (lineage.root.chatId !== input.chatId || lineage.ancestors.length >= 20) fail('Geometry lineage chat differs or its history is full.');
    if (evidence.version === 2) {
      if (!equal(evidence.lineage, lineage)) fail('Geometry seal does not extend the exact predecessor lineage.');
    } else {
      if (lineage.ancestors.some(frame => frame.encoding === 'v2')
          || !equal(evidence.inheritedFrom ?? [], headers(lineage.ancestors))) fail('Legacy geometry ancestors are missing or differ.');
      if (!Object.hasOwn(evidence, 'inheritedFrom') && lineage.ancestors.length) fail('Legacy geometry seal erased its lineage.');
    }
    if (previous && (!equal(evidence.receipts.slice(0, previous.receipts.length), previous.receipts)
        || !equal(evidence.measurements.slice(0, previous.measurements.length), previous.measurements))) fail('Geometry seal changed or erased original observation prefixes.');
    lineage.ancestors.push({ requestId: evidence.requestId, baseRevisionId: evidence.baseRevisionId,
      proposalSnapshotSha256: evidence.proposalSnapshotSha256, evidenceSha256: await digest(evidence),
      receiptCount: evidence.receipts.length, measurementCount: evidence.measurements.length,
      encoding: evidence.version === 2 ? 'v2' : Object.hasOwn(evidence, 'inheritedFrom') ? 'v1-present' : 'v1-absent',
      patch: modelDelta(base.snapshot, snapshot) });
    previous = evidence;
  }
  if (!lineage) lineage = { root: { chatId: input.chatId, rootRevisionId: history.rootRevisionId,
    target: structuredClone(history.target), originBaseRevisionId: history.head.id,
    originBaseSnapshotSha256: await digest(history.head.snapshot) }, ancestors: [] };
  if (!Check(lineageSchema, lineage)) return fail('Invalid bounded geometry draft lineage.');
  uniqueRequests('', lineage.ancestors);
  if (previous) {
    let requestId = 'lineage-factory';
    while (lineage.ancestors.some(frame => frame.requestId === requestId)) requestId += '-next';
    const candidate = parseGeometryEvidence({ version: 2, projectId: previous.projectId, requestId,
      baseRevisionId: previous.baseRevisionId, proposalSnapshotSha256: previous.proposalSnapshotSha256,
      receipts: previous.receipts, measurements: previous.measurements, lineage });
    const last = input.ancestors.at(-1);
    if (!last) return fail('Missing final geometry ancestor.');
    await inactiveInheritedBoxMeasurements({ evidence: candidate, binding: { history, projectId: history.projectId,
      requestId, baseRevisionId: previous.baseRevisionId, snapshot: last.snapshot } });
  } else assertBytes(lineage, 0, 0);
  return structuredClone(lineage);
}
