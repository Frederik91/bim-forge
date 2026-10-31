import { isDeepStrictEqual } from 'node:util';
import { parseGeometryMeasureRequest } from './geometry-contract.ts';
import type { GeometryMeasureRequest, GeometryMeasureResult, GeometryRef, GeometryReceipt } from './geometry-contract.ts';
import { geometryDigest, geometryIdentityKey } from './geometry-query.ts';
import { createGeometrySession, validateGeometryReceiptsInWorker } from './geometry-session.ts';
import type { GeometrySession, GeometrySessionInput, GeometryCorrespondence } from './geometry-session.ts';
import type { GeometryNativeHistory, ModelSnapshot } from './room-model.ts';
import type { FrozenModelScope } from './model-scope-contract.ts';
import { parseGeometryEvidence as parseEvidenceContract, readGeometryEvidence as readEvidenceContract } from './geometry-evidence-contract.ts';
import type { GeometryEvidence } from './geometry-evidence-contract.ts';
import { createGeometryDraftLineage, inactiveInheritedBoxMeasurements } from './geometry-draft-lineage.ts';
import type { GeometryDraftLineage, GeometryDraftSeal } from './geometry-draft-lineage.ts';
export { GeometryEvidenceSchema, MAX_GEOMETRY_EVIDENCE_BYTES, GeometryEvidenceLimitError } from './geometry-evidence-contract.ts';
export type { GeometryEvidence } from './geometry-evidence-contract.ts';

export function geometryNativeInput(input: GeometrySessionInput['native'] & { scope?: FrozenModelScope }): GeometrySessionInput['native'] {
  const { scope, ...native } = input;
  return { ...native, ...(scope ? { readableIds: [...new Set([...scope.targetIds, ...scope.contextIds, ...scope.dependentIds, ...scope.writableIds])] } : {}) };
}

export function geometrySnapshotHash(snapshot: ModelSnapshot): string {
  return geometryDigest(snapshot);
}

/** Receipt arrays have their own bounds; opaque JSON preserves the existing native model array limits. */
export function encodeGeometryEvidence(evidence: GeometryEvidence): string { return JSON.stringify(parseGeometryEvidence(evidence)); }
export function readGeometryEvidence(value: unknown): GeometryEvidence {
  return parseGeometryEvidence(readEvidenceContract(value));
}

/** Parses retained host receipts, never authority supplied by a guest decision. */
export function parseGeometryEvidence(input: unknown): GeometryEvidence {
  const value = parseEvidenceContract(input);
  for (const measurement of value.measurements) {
    parseGeometryMeasureRequest(measurement.request);
    if (measurement.result.receipt.operationDigest !== geometryDigest({ method: 'measure', input: measurement.request })
        || !value.receipts.some(receipt => isDeepStrictEqual(receipt, measurement.result.receipt))) {
      throw new Error('Geometry measurement is not bound to its host observation.');
    }
    const { receipt, ...outcome } = measurement.result;
    if (geometryDigest(outcome) !== receipt.resultDigest) throw new Error('Geometry measurement result digest changed.');
  }
  return value;
}
export interface GeometryReadSnapshot {
  input: GeometrySessionInput;
  catalogToken: string;
  correspondences?: GeometryCorrespondence[];
}
export type GeometryPublication<T> = { kind: 'committed'; value: T } | { kind: 'catalog-changed' };

/** The linked store owns authorization, immutable snapshots and its cross-process guard. */
export interface GeometryEvidenceSource {
  snapshot(input: { projectId: string; native: GeometrySessionInput['native']; signal: AbortSignal;
    historicalRefs?: readonly Extract<GeometryRef, { kind: 'ifc' }>[] }): Promise<GeometryReadSnapshot>;
  withCatalogGuard<T>(projectId: string, catalogToken: string, commit: () => T): GeometryPublication<T>;
}

type MeasurementContext = { replayLeg: 'primary' | 'original-member' | 'surroundings'; operation: GeometryMeasureRequest['operation'] };
type CompleteMeasurementStatus = { resultKind: 'complete' } & Pick<Extract<GeometryMeasureResult, { kind: 'complete' }>['value'], 'relation' | 'clearance'>;
type MeasurementStatus = CompleteMeasurementStatus
  | ({ resultKind: 'partial'; reason: Extract<GeometryMeasureResult, { kind: 'partial' }>['reason'] }
    & Pick<Extract<GeometryMeasureResult, { kind: 'partial' }>['value'], 'relation' | 'clearance'>)
  | { resultKind: 'unavailable'; reason: Extract<GeometryMeasureResult, { kind: 'unavailable' }>['reason'] };
export type GeometryMeasurementDiagnostic = MeasurementContext & MeasurementStatus & { code: 'measurement-unverified' };
export type GeometryProposalValidationDiagnostic = MeasurementContext & CompleteMeasurementStatus
  & { code: 'clearance-violated' | 'final-shape-mismatch' | 'final-intersection' };

function measurementStatus(result: GeometryMeasureResult): MeasurementStatus {
  if (result.kind === 'unavailable') return { resultKind: result.kind, reason: result.reason };
  const status = { relation: result.value.relation, clearance: result.value.clearance };
  return result.kind === 'partial' ? { resultKind: result.kind, reason: result.reason, ...status } : { resultKind: result.kind, ...status };
}
function measurementSummary(diagnostic: MeasurementContext & MeasurementStatus): string {
  return `[phase=${diagnostic.replayLeg} operation=${diagnostic.operation} result=${diagnostic.resultKind}`
    + ('reason' in diagnostic ? ` reason=${diagnostic.reason}` : '')
    + ('relation' in diagnostic ? ` relation=${diagnostic.relation} clearance=${diagnostic.clearance}` : '') + ']';
}
export class GeometryProposalValidationError extends Error {
  readonly diagnostic: Readonly<GeometryProposalValidationDiagnostic>;
  constructor(diagnostic: GeometryProposalValidationDiagnostic) {
    const messages = {
      'clearance-violated': 'The final authored shape violates the requested clearance constraint.',
      'final-shape-mismatch': 'The final authored shape does not satisfy the inspected geometry measurement.',
      'final-intersection': 'The final candidate intersects or is contained by another physical object.',
    };
    super(`[${diagnostic.code}] ${messages[diagnostic.code]} ${measurementSummary(diagnostic)}`);
    this.name = 'GeometryProposalValidationError'; this.diagnostic = Object.freeze({ ...diagnostic });
  }
}
export class GeometryEvidenceConflict extends Error {
  readonly diagnostic: Readonly<GeometryMeasurementDiagnostic> | null;
  constructor(message = 'Inspected geometry changed or could not be verified. Revalidate the proposal before accepting.',
    diagnostic: GeometryMeasurementDiagnostic | null = null) {
    super(message); this.name = 'GeometryEvidenceConflict'; this.diagnostic = diagnostic ? Object.freeze({ ...diagnostic }) : null;
  }
}

export async function readGeometrySnapshot(source: GeometryEvidenceSource, projectId: string,
  native: GeometrySessionInput['native'], signal: AbortSignal, receipts?: readonly GeometryReceipt[]): Promise<GeometryReadSnapshot> {
  signal.throwIfAborted();
  const historical = new Map<string, Extract<GeometryRef, { kind: 'ifc' }>>();
  const add = (ref: GeometryRef): void => {
    if (ref.kind !== 'ifc') return;
    if (ref.projectId !== projectId) throw new GeometryEvidenceConflict('Historical geometry reference crosses projects.');
    historical.set(geometryDigest(ref), structuredClone(ref));
    if (historical.size > 4096) throw new GeometryEvidenceConflict('Historical geometry reference budget exceeded.');
  };
  for (const receipt of receipts ?? []) for (const read of receipt.reads) {
    if (read.kind === 'object') add(read.ref);
    else if (read.kind === 'query') {
      read.members.forEach(add); read.query.exclude?.forEach(add);
      if (read.query.level) add(read.query.level);
      if (read.candidateExclusion) add(read.candidateExclusion);
    } else if (read.subject.kind === 'object') add(read.subject.ref);
  }
  const value = await source.snapshot({ projectId, native: structuredClone(native), signal,
    ...(receipts ? { historicalRefs: [...historical.values()] } : {}) });
  signal.throwIfAborted();
  if (!value.catalogToken || value.catalogToken.length > 256 || value.input.projectId !== projectId
      || !isDeepStrictEqual(value.input.native, native)) throw new GeometryEvidenceConflict('Geometry context differs from the authorized native read binding.');
  return value;
}

function requireMeasurement(result: GeometryMeasureResult, context: MeasurementContext, expected?: GeometryMeasureResult): void {
  const diagnostic: GeometryMeasurementDiagnostic = { code: 'measurement-unverified', ...context, ...measurementStatus(result) };
  if (result.kind !== 'complete' || result.value.relation === 'unknown'
      || result.value.clearance === 'unknown' || result.value.clearance === 'violated-mesh') {
    if (result.kind === 'complete' && result.value.relation !== 'unknown' && result.value.clearance === 'violated-mesh') {
      throw new GeometryProposalValidationError({ code: 'clearance-violated', ...context, resultKind: 'complete',
        relation: result.value.relation, clearance: result.value.clearance });
    }
    throw new GeometryEvidenceConflict(`A geometry measurement is incomplete, unsupported or violates the requested constraint. ${measurementSummary(diagnostic)}`, diagnostic);
  }
  if (expected?.kind === 'complete') {
    const a = result.value; const b = expected.value;
    if (a.relation !== b.relation || a.clearance !== b.clearance
        || (a.distanceMetres === null) !== (b.distanceMetres === null)
        || (a.distanceMetres !== null && b.distanceMetres !== null
          && Math.abs(a.distanceMetres - b.distanceMetres) > a.numericToleranceMetres + b.numericToleranceMetres)) {
      if (!['unknown', 'contact-or-overlap'].includes(b.relation) && !['unknown', 'violated-mesh'].includes(b.clearance)
          && a.relation !== 'contact-or-overlap') {
        throw new GeometryProposalValidationError({ code: 'final-shape-mismatch', ...context, resultKind: 'complete',
          relation: a.relation, clearance: a.clearance });
      }
      throw new GeometryEvidenceConflict(`The final authored shape does not satisfy the inspected geometry measurement. ${measurementSummary(diagnostic)}`, diagnostic);
    }
  }
}

function currentMeasurement(request: GeometryMeasureRequest, input: GeometrySessionInput,
  correspondences: readonly GeometryCorrespondence[]): GeometryMeasureRequest {
  const ref = (old: GeometryRef): GeometryRef => {
    if (old.kind === 'native') {
      if (old.projectId !== input.projectId || !isDeepStrictEqual(old.target, input.native.target)) throw new GeometryEvidenceConflict('Measurement reference crosses native targets.');
      return { ...old, revisionId: input.native.revisionId };
    }
    return correspondences.find(pair => isDeepStrictEqual(pair.historical, old))?.current ?? old;
  };
  const against = request.against;
  const subject: GeometryMeasureRequest['subject'] = request.subject.kind === 'object' ? { kind: 'object', ref: ref(request.subject.ref) } : request.subject;
  return { ...request, subject,
    against: against.kind === 'object' ? { kind: 'object', ref: ref(against.ref) }
    : { kind: 'query', query: { ...against.query,
      ...(against.query.exclude ? { exclude: against.query.exclude.map(ref) } : {}),
      ...(against.query.level ? { level: ref(against.query.level) } : {}) } } };
}

function nativeRef(entityId: string, input: GeometrySessionInput): Extract<GeometryRef, { kind: 'native' }> {
  return { kind: 'native', projectId: input.projectId, revisionId: input.native.revisionId, target: input.native.target, entityId };
}
function queryMembers(measurement: GeometryEvidence['measurements'][number]): GeometryRef[] {
  return measurement.result.receipt.reads.flatMap(read => read.kind === 'query' && read.purpose === 'measurement' ? read.members : []);
}
async function nativeDescription(session: GeometrySession, ref: Extract<GeometryRef, { kind: 'native' }>) {
  const result = await session.describe(ref);
  if (result.kind !== 'complete' || result.value.bounds === null || result.value.capability.kind !== 'mesh') {
    throw new GeometryEvidenceConflict('A measured native endpoint has no complete final geometry.');
  }
  const projection = result.receipt.reads.find(read => read.kind === 'object' && read.projection === 'geometry'
    && geometryIdentityKey(read.ref) === geometryIdentityKey(ref));
  if (!projection || projection.kind !== 'object') throw new GeometryEvidenceConflict('Trusted evaluated geometry projection is unavailable.');
  return { description: result.value, digest: projection.digest };
}

/** Resolve actual final native shapes; guest boxes are never proof of authored geometry. */
async function validateFinalMeasurements(evidence: GeometryEvidence, current: GeometrySessionInput, input: GeometrySessionInput, signal: AbortSignal,
  correspondences: readonly GeometryCorrespondence[], inactiveInheritedBoxes: ReadonlySet<number> = new Set()): Promise<{ receipts: GeometryReceipt[]; measurements: GeometryEvidence['measurements'] }> {
  if (!evidence.measurements.length) return { receipts: [], measurements: [] };
  const receipts: GeometryReceipt[] = []; const measurements: GeometryEvidence['measurements'] = [];
  const active = evidence.measurements.filter((_, index) => !inactiveInheritedBoxes.has(index));
  const inactive = evidence.measurements.filter((_, index) => inactiveInheritedBoxes.has(index));
  const lastBox = new Map<string, string>();
  for (const measurement of active) if (measurement.request.subject.kind === 'box') {
    lastBox.set(measurement.request.subject.candidateId, geometryDigest(measurement.request.subject));
  }
  const latest = new Map<string, GeometryEvidence['measurements'][number]>();
  for (const measurement of active) {
    const subject = measurement.request.subject;
    // Distance/intersection probes describe a trial pose. Explicit clearance constraints survive pose changes.
    if (subject.kind === 'box' && measurement.request.operation !== 'clearance'
        && lastBox.get(subject.candidateId) !== geometryDigest(subject)) continue;
    const candidate = subject.kind === 'box' ? subject.candidateId : subject.ref;
    latest.set(geometryDigest({ candidate, against: measurement.request.against, operation: measurement.request.operation,
      clearanceMetres: measurement.request.clearanceMetres ?? null }), measurement);
  }
  const endpoints = new Map<string, Extract<GeometryRef, { kind: 'native' }>>();
  const boxes = new Set<string>();
  for (const measurement of latest.values()) {
    const subject = measurement.request.subject;
    if (subject.kind === 'box') boxes.add(subject.candidateId);
  }
  // Inactive box subjects do not retire any of their observed native endpoints.
  for (const measurement of [...latest.values(), ...inactive]) {
    const subject = measurement.request.subject;
    const refs = [...(subject.kind === 'object' ? [subject.ref] : []),
      ...(measurement.request.against.kind === 'object' ? [measurement.request.against.ref] : queryMembers(measurement))];
    for (const ref of refs) if (ref.kind === 'native') endpoints.set(ref.entityId, nativeRef(ref.entityId, input));
  }
  for (const measurement of inactive) {
    const against = measurement.request.against;
    if (against.kind !== 'query') continue;
    const refs = [...(against.query.exclude ?? []), ...(against.query.level ? [against.query.level] : [])];
    if (refs.some(ref => ref.kind === 'native' && !input.native.snapshot.entities.some(entity => entity.id === ref.entityId))) {
      throw new GeometryEvidenceConflict('A retained query reference has no final native identity.');
    }
  }
  const baseline = new Map<string, string>();
  if (endpoints.size) {
    const before = await createGeometrySession(current, { signal, lifetimeMs: 120000 });
    try {
      for (const entityId of endpoints.keys()) baseline.set(entityId, (await nativeDescription(before, nativeRef(entityId, current))).digest);
      receipts.push(...before.receipts());
    } finally { await before.close(); }
  }
  const safety = new Map<string, Extract<GeometryRef, { kind: 'native' }>>();
  const final = await createGeometrySession(input, { signal, lifetimeMs: 120000 });
  try {
    for (const [entityId, ref] of endpoints) {
      const evaluated = await nativeDescription(final, ref);
      if (baseline.get(entityId) !== evaluated.digest && evaluated.description.role === 'physical') safety.set(entityId, ref);
    }
    for (const entityId of boxes) {
      const ref = nativeRef(entityId, input); const evaluated = await nativeDescription(final, ref);
      if (evaluated.description.role !== 'physical') throw new GeometryEvidenceConflict('A proposed box does not identify a final physical native object.');
      safety.set(entityId, ref);
    }
    for (const measurement of latest.values()) {
      signal.throwIfAborted();
      const subject = measurement.request.subject;
      const rebound = currentMeasurement(measurement.request, input, correspondences);
      const request: GeometryMeasureRequest = subject.kind === 'box'
        ? { ...rebound, subject: { kind: 'object', ref: nativeRef(subject.candidateId, input) } } : rebound;
      const result = await final.measure(request);
      requireMeasurement(result, { replayLeg: 'primary', operation: request.operation },
        subject.kind === 'box' && request.operation !== 'clearance' ? measurement.result : undefined);
      measurements.push({ request, result });
      // Original query membership cannot hide a native endpoint merely by moving it outside the predicate.
      if (request.operation === 'clearance' && measurement.request.against.kind === 'query') {
        for (const member of queryMembers(measurement)) {
          const pair = currentMeasurement({ ...measurement.request, against: { kind: 'object', ref: member } }, input, correspondences);
          const pairRequest: GeometryMeasureRequest = { ...pair, subject: request.subject };
          const pairResult = await final.measure(pairRequest);
          requireMeasurement(pairResult, { replayLeg: 'original-member', operation: pairRequest.operation });
          measurements.push({ request: pairRequest, result: pairResult });
        }
      }
    }
    receipts.push(...final.receipts());
  } finally { await final.close(); }
  if (safety.size) {
    const fullInput = { ...input, native: { snapshot: input.native.snapshot, revisionId: input.native.revisionId, target: input.native.target } };
    const complete = await createGeometrySession(fullInput, { signal, lifetimeMs: 120000 });
    try {
      for (const ref of safety.values()) {
        const evaluated = await nativeDescription(complete, ref); const bounds = evaluated.description.bounds;
        const capability = evaluated.description.capability;
        if (!bounds || capability.kind !== 'mesh') throw new GeometryEvidenceConflict('Final native geometry bounds or tolerance are unavailable.');
        const region = { min: bounds.min.map(n => n - capability.numericToleranceMetres), max: bounds.max.map(n => n + capability.numericToleranceMetres) };
        const request: GeometryMeasureRequest = { subject: { kind: 'object', ref },
          against: { kind: 'query', query: { role: 'physical', region } },
          operation: 'intersection' };
        const surroundings = await complete.measure(request);
        const context = { replayLeg: 'surroundings', operation: request.operation } satisfies MeasurementContext;
        requireMeasurement(surroundings, context);
        if (surroundings.kind === 'complete' && !['separated', 'empty-set', 'contact'].includes(surroundings.value.relation)) {
          if (['volume-overlap', 'subject-inside', 'obstacle-inside'].includes(surroundings.value.relation)) {
            throw new GeometryProposalValidationError({ code: 'final-intersection', ...context, resultKind: 'complete',
              relation: surroundings.value.relation, clearance: surroundings.value.clearance });
          }
          const diagnostic: GeometryMeasurementDiagnostic = { code: 'measurement-unverified', ...context, ...measurementStatus(surroundings) };
          throw new GeometryEvidenceConflict(`The final candidate intersects or is contained by another physical object. ${measurementSummary(diagnostic)}`, diagnostic);
        }
        measurements.push({ request, result: surroundings });
      }
      receipts.push(...complete.receipts());
    } finally { await complete.close(); }
  }
  parseGeometryEvidence({ version: 1, projectId: evidence.projectId, requestId: evidence.requestId, baseRevisionId: evidence.baseRevisionId,
    proposalSnapshotSha256: geometrySnapshotHash(input.native.snapshot), receipts, measurements });
  return { receipts, measurements };
}

export async function validateGeometryEvidence(input: {
  evidence: GeometryEvidence; source: GeometryEvidenceSource; native: GeometrySessionInput['native'];
  candidate: ModelSnapshot; signal: AbortSignal; history?: GeometryNativeHistory; authoredSnapshot?: ModelSnapshot;
}): Promise<GeometryReadSnapshot & { verifiedCandidateSha256: string; finalReceipts: GeometryReceipt[]; finalMeasurements: GeometryEvidence['measurements'] }> {
  const evidence = parseGeometryEvidence(input.evidence);
  assertNativeHistory(evidence.projectId, input.native, input.history);
  if (evidence.version === 2 && (!input.history || !input.authoredSnapshot)) {
    throw new GeometryEvidenceConflict('Geometry evidence v2 requires its original snapshot and complete current native history.');
  }
  let inactive: readonly number[] = [];
  if (input.history && input.authoredSnapshot) {
    const reconciled = input.history.reconcile(evidence.baseRevisionId, input.authoredSnapshot);
    if (!isDeepStrictEqual(reconciled, input.candidate)) {
      throw new GeometryEvidenceConflict('The final candidate differs from native reconciliation of the original authored snapshot.');
    }
    inactive = await inactiveInheritedBoxMeasurements({ evidence, binding: { history: input.history,
      projectId: evidence.projectId, requestId: evidence.requestId, baseRevisionId: evidence.baseRevisionId,
      snapshot: input.authoredSnapshot } });
  } else if (input.authoredSnapshot && geometrySnapshotHash(input.authoredSnapshot) !== evidence.proposalSnapshotSha256) {
    throw new GeometryEvidenceConflict('Geometry evidence does not match the original authored snapshot.');
  }
  input.signal.throwIfAborted();
  const snapshot = await readGeometrySnapshot(input.source, evidence.projectId, input.native, input.signal, evidence.receipts);
  const candidate = { ...snapshot.input, native: { ...snapshot.input.native, snapshot: input.candidate } };
  const status = await validateGeometryReceiptsInWorker({ receipts: evidence.receipts, current: snapshot.input,
    candidate: snapshot.input, ...(snapshot.correspondences ? { correspondences: snapshot.correspondences } : {}) }, { signal: input.signal });
  input.signal.throwIfAborted();
  if (status.kind !== 'fresh') throw new GeometryEvidenceConflict(status.reason);
  // Independent host verification sees the complete authorized project; no full-graph facts cross the guest boundary.
  const final = await validateFinalMeasurements(evidence, snapshot.input, candidate, input.signal,
    snapshot.correspondences ?? [], new Set(inactive));
  return { ...snapshot, verifiedCandidateSha256: geometrySnapshotHash(input.candidate), finalReceipts: final.receipts, finalMeasurements: final.measurements };
}

export type GeometryCurrentContext = { native: GeometrySessionInput['native']; history: GeometryNativeHistory };

function assertNativeHistory(projectId: string, native: GeometrySessionInput['native'], history?: GeometryNativeHistory): void {
  if (history && (history.projectId !== projectId || !isDeepStrictEqual(history.target, native.target)
      || history.head.id !== native.revisionId || !isDeepStrictEqual(history.head.snapshot, native.snapshot))) {
    throw new GeometryEvidenceConflict('Current native geometry differs from its complete accepted history.');
  }
}

/** Host-selected predecessor: evidence and native snapshots cannot be supplied independently to a session. */
export class DraftContinuation {
  readonly history: GeometryNativeHistory;
  readonly #predecessor: GeometryDraftSeal;
  readonly #initialDraft: ModelSnapshot;
  readonly #lineage: GeometryDraftLineage;
  private constructor(history: GeometryNativeHistory, predecessor: GeometryDraftSeal, initialDraft: ModelSnapshot, lineage: GeometryDraftLineage) {
    this.history = history; this.#predecessor = structuredClone(predecessor);
    this.#initialDraft = structuredClone(initialDraft); this.#lineage = structuredClone(lineage);
    Object.freeze(this);
  }
  static async fromPrior(input: { chatId: string; history: GeometryNativeHistory; predecessor: GeometryDraftSeal;
    legacyAncestors?: readonly GeometryDraftSeal[] }): Promise<DraftContinuation> {
    const predecessor = { evidence: parseGeometryEvidence(input.predecessor.evidence), snapshot: structuredClone(input.predecessor.snapshot) };
    const ancestors = (input.legacyAncestors ?? []).map(seal => ({ evidence: parseGeometryEvidence(seal.evidence), snapshot: structuredClone(seal.snapshot) }));
    const lineage = await createGeometryDraftLineage({ history: input.history, chatId: input.chatId,
      ancestors: [...ancestors, predecessor] });
    const initialDraft = input.history.reconcile(predecessor.evidence.baseRevisionId, predecessor.snapshot);
    return new DraftContinuation(input.history, predecessor, initialDraft, lineage);
  }
  get initialDraft(): ModelSnapshot { return structuredClone(this.#initialDraft); }
  get predecessor(): GeometryDraftSeal { return structuredClone(this.#predecessor); }
  get lineage(): GeometryDraftLineage { return structuredClone(this.#lineage); }
}

export type OpenGeometryEvidence = { source: GeometryEvidenceSource; projectId: string; requestId: string;
  native: GeometrySessionInput['native']; signal: AbortSignal; current?: () => Promise<GeometryCurrentContext>;
  history?: GeometryNativeHistory; chatId?: string; continuation?: DraftContinuation };

/** One host-owned request session. Guest decisions cannot supply, erase or replace receipts. */
export class GeometryEvidenceSession {
  readonly #input: OpenGeometryEvidence;
  readonly #session: GeometrySession;
  readonly #inherited: GeometryEvidence | undefined;
  readonly #lineage: GeometryDraftLineage | undefined;
  readonly #measurements: GeometryEvidence['measurements'] = [];
  #closed = false;
  private constructor(input: OpenGeometryEvidence, session: GeometrySession, lineage?: GeometryDraftLineage) {
    this.#input = input; this.#session = session; this.#inherited = input.continuation?.predecessor.evidence;
    this.#lineage = lineage;
    if (this.#inherited) this.#measurements.push(...structuredClone(this.#inherited.measurements));
  }
  static async open(input: OpenGeometryEvidence): Promise<GeometryEvidenceSession> {
    input.signal.throwIfAborted();
    if (Object.hasOwn(input, 'inherited')) throw new GeometryEvidenceConflict('Use an exact predecessor continuation to inherit geometry evidence.');
    assertNativeHistory(input.projectId, input.native, input.history);
    if ((input.continuation || input.chatId) && !input.history) {
      throw new GeometryEvidenceConflict('A geometry conversation requires complete native history.');
    }
    const inherited = input.continuation?.predecessor.evidence;
    if (inherited && (inherited.projectId !== input.projectId || inherited.requestId === input.requestId)) {
      throw new GeometryEvidenceConflict('Inherited geometry evidence belongs to another project or the same request generation.');
    }
    let lineage: GeometryDraftLineage | undefined;
    if (input.continuation) {
      assertNativeHistory(input.projectId, input.native, input.continuation.history);
      if (input.continuation.history.rootRevisionId !== input.history?.rootRevisionId) {
        throw new GeometryEvidenceConflict('Geometry continuation belongs to another native project root.');
      }
      lineage = input.continuation.lineage;
      if (input.chatId !== undefined && input.chatId !== lineage.root.chatId) {
        throw new GeometryEvidenceConflict('Geometry continuation belongs to another conversation.');
      }
    } else if (input.history) {
      if (!input.chatId) throw new GeometryEvidenceConflict('Geometry evidence v2 requires a host conversation identity.');
      lineage = await createGeometryDraftLineage({ history: input.history, chatId: input.chatId, ancestors: [] });
    }
    const snapshot = await readGeometrySnapshot(input.source, input.projectId, input.native, input.signal);
    const session = await createGeometrySession(snapshot.input, { signal: input.signal, lifetimeMs: 180000 });
    if (input.signal.aborted) { await session.close(); input.signal.throwIfAborted(); }
    return new GeometryEvidenceSession({ ...input, native: structuredClone(input.native) }, session, lineage);
  }
  #assertAlive(): void {
    this.#input.signal.throwIfAborted();
    if (this.#closed) throw new GeometryEvidenceConflict('Geometry read authority was revoked.');
  }
  describe(input: unknown) { return this.#read(() => this.#session.describe(input)); }
  query(input: unknown) { return this.#read(() => this.#session.query(input)); }
  relations(input: unknown) { return this.#read(() => this.#session.relations(input)); }
  async measure(input: unknown): Promise<GeometryMeasureResult> {
    const request = parseGeometryMeasureRequest(input);
    const result = await this.#read(() => this.#session.measure(request));
    this.#measurements.push({ request: structuredClone(request), result: structuredClone(result) });
    return result;
  }
  async #read<T>(call: () => Promise<T>): Promise<T> {
    this.#assertAlive(); const value = await call(); this.#assertAlive(); return value;
  }
  async #current(): Promise<{ native: GeometrySessionInput['native']; history?: GeometryNativeHistory }> {
    const context = this.#input.current ? await this.#input.current()
      : { native: this.#input.native, history: this.#input.history };
    assertNativeHistory(this.#input.projectId, context.native, context.history);
    if (this.#lineage && !context.history) throw new GeometryEvidenceConflict('Current geometry history is unavailable.');
    if (this.#input.history && context.history?.rootRevisionId !== this.#input.history.rootRevisionId) {
      throw new GeometryEvidenceConflict('Current geometry belongs to another native project root.');
    }
    return context;
  }
  #receipts(): GeometryReceipt[] {
    const receipts = [...(this.#inherited?.receipts ?? []), ...this.#session.receipts()];
    return [...new Map(receipts.map(receipt => [geometryDigest(receipt), receipt])).values()];
  }
  async assertFresh(): Promise<void> {
    this.#assertAlive();
    const receipts = this.#receipts();
    if (!receipts.length) return;
    const { native } = await this.#current();
    this.#assertAlive();
    const current = await readGeometrySnapshot(this.#input.source, this.#input.projectId, native, this.#input.signal, receipts);
    const result = await validateGeometryReceiptsInWorker({ receipts, current: current.input,
      candidate: current.input,
      ...(current.correspondences ? { correspondences: current.correspondences } : {}) }, { signal: this.#input.signal });
    this.#assertAlive();
    if (result.kind !== 'fresh') throw new GeometryEvidenceConflict(result.reason);
  }
  async seal(candidate: ModelSnapshot): Promise<GeometryEvidence | undefined> {
    this.#assertAlive();
    if (!this.#receipts().length && !this.#inherited) return;
    await this.assertFresh();
    this.#assertAlive();
    const evidence = parseGeometryEvidence({ ...(this.#lineage ? { version: 2, lineage: this.#lineage } : { version: 1 }),
      projectId: this.#input.projectId, requestId: this.#input.requestId,
      baseRevisionId: this.#input.native.revisionId, proposalSnapshotSha256: geometrySnapshotHash(candidate),
      receipts: this.#receipts(), measurements: this.#measurements });
    const { native, history } = await this.#current();
    const reconciled = history ? history.reconcile(evidence.baseRevisionId, candidate) : candidate;
    await validateGeometryEvidence({ evidence, source: this.#input.source, native, candidate: reconciled,
      authoredSnapshot: candidate, ...(history ? { history } : {}), signal: this.#input.signal });
    this.#assertAlive(); return evidence;
  }
  async close(): Promise<void> { this.#closed = true; await this.#session.close(); }
}

/** A catalogue change retries validation; its token is never a semantic staleness verdict. */
export async function publishWithGeometryGuard<T>(input: {
  source: GeometryEvidenceSource;
  projectId: string;
  validate: () => Promise<GeometryReadSnapshot>;
  commit: () => T;
  signal: AbortSignal;
}): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    input.signal.throwIfAborted();
    const snapshot = await input.validate();
    input.signal.throwIfAborted();
    const result = input.source.withCatalogGuard(input.projectId, snapshot.catalogToken, input.commit);
    if (result.kind === 'committed') return result.value;
  }
  throw new GeometryEvidenceConflict('The linked geometry catalogue kept changing during review. Refresh and retry acceptance.');
}
