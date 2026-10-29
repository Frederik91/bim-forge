import { isDeepStrictEqual } from 'node:util';
import { parseGeometryMeasureRequest } from './geometry-contract.ts';
import type { GeometryMeasureRequest, GeometryMeasureResult, GeometryRef, GeometryReceipt } from './geometry-contract.ts';
import { geometryDigest } from './geometry-query.ts';
import { createGeometrySession, validateGeometryReceiptsInWorker } from './geometry-session.ts';
import type { GeometrySession, GeometrySessionInput, GeometryCorrespondence } from './geometry-session.ts';
import type { ModelSnapshot } from './room-model.ts';
import type { FrozenModelScope } from './model-scope-contract.ts';
import { parseGeometryEvidence as parseEvidenceContract, readGeometryEvidence as readEvidenceContract } from './geometry-evidence-contract.ts';
import type { GeometryEvidence } from './geometry-evidence-contract.ts';
export { GeometryEvidenceSchema, MAX_GEOMETRY_EVIDENCE_BYTES } from './geometry-evidence-contract.ts';
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

export class GeometryEvidenceConflict extends Error {
  constructor(message = 'Inspected geometry changed or could not be verified. Revalidate the proposal before accepting.') {
    super(message); this.name = 'GeometryEvidenceConflict';
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

function requireMeasurement(result: GeometryMeasureResult, expected?: GeometryMeasureResult): void {
  if (result.kind !== 'complete' || result.value.relation === 'unknown'
      || result.value.clearance === 'unknown' || result.value.clearance === 'violated-mesh') {
    throw new GeometryEvidenceConflict('A geometry measurement is incomplete, unsupported or violates the requested constraint.');
  }
  if (expected?.kind === 'complete') {
    const a = result.value; const b = expected.value;
    if (a.relation !== b.relation || a.clearance !== b.clearance
        || (a.distanceMetres === null) !== (b.distanceMetres === null)
        || (a.distanceMetres !== null && b.distanceMetres !== null
          && Math.abs(a.distanceMetres - b.distanceMetres) > a.numericToleranceMetres + b.numericToleranceMetres)) {
      throw new GeometryEvidenceConflict('The final authored shape does not satisfy the inspected geometry measurement.');
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
  return { ...request, against: against.kind === 'object' ? { kind: 'object', ref: ref(against.ref) }
    : { kind: 'query', query: { ...against.query,
      ...(against.query.exclude ? { exclude: against.query.exclude.map(ref) } : {}),
      ...(against.query.level ? { level: ref(against.query.level) } : {}) } } };
}

/** Resolve actual final native shapes; guest boxes are never proof of authored geometry. */
async function validateFinalMeasurements(evidence: GeometryEvidence, input: GeometrySessionInput, signal: AbortSignal,
  correspondences: readonly GeometryCorrespondence[]): Promise<ReturnType<GeometrySession['receipts']>> {
  if (!evidence.measurements.length) return [];
  const final = await createGeometrySession(input, { signal, lifetimeMs: 120000 });
  try {
    const lastBox = new Map<string, string>();
    for (const measurement of evidence.measurements) if (measurement.request.subject.kind === 'box') {
      lastBox.set(measurement.request.subject.candidateId, geometryDigest(measurement.request.subject));
    }
    const latest = new Map<string, GeometryEvidence['measurements'][number]>();
    for (const measurement of evidence.measurements) {
      const subject = measurement.request.subject;
      // Distance/intersection probes describe a trial pose. Explicit clearance constraints survive pose changes.
      if (subject.kind === 'box' && measurement.request.operation !== 'clearance'
          && lastBox.get(subject.candidateId) !== geometryDigest(subject)) continue;
      const candidate = subject.kind === 'box' ? subject.candidateId : subject.ref;
      latest.set(geometryDigest({ candidate, against: measurement.request.against, operation: measurement.request.operation,
        clearanceMetres: measurement.request.clearanceMetres ?? null }), measurement);
    }
    for (const measurement of latest.values()) {
      signal.throwIfAborted();
      requireMeasurement(measurement.result);
      const subject = measurement.request.subject;
      const entityId = subject.kind === 'box' ? subject.candidateId
        : subject.ref.kind === 'native' ? subject.ref.entityId : null;
      if (entityId === null) continue;
      const ref = { kind: 'native', projectId: input.projectId, revisionId: input.native.revisionId,
        target: input.native.target, entityId } satisfies Extract<GeometryMeasureRequest['subject'], { kind: 'object' }>['ref'];
      const description = await final.describe(ref);
      if (description.kind !== 'complete' || description.value.role !== 'physical' || description.value.bounds === null) {
        throw new GeometryEvidenceConflict('A measured candidate does not identify a supported final native object.');
      }
      const request: GeometryMeasureRequest = { ...currentMeasurement(measurement.request, input, correspondences), subject: { kind: 'object', ref } };
      requireMeasurement(await final.measure(request), measurement.result);
      if (subject.kind !== 'box') continue;
      // A finite against-ID never certifies absence of other obstructions.
      const surroundings = await final.measure({ subject: { kind: 'object', ref },
        against: { kind: 'query', query: { role: 'physical', region: description.value.bounds } },
        operation: 'intersection' });
      requireMeasurement(surroundings);
      if (surroundings.kind === 'complete' && !['separated', 'empty-set', 'contact'].includes(surroundings.value.relation)) {
        throw new GeometryEvidenceConflict('The final candidate intersects or is contained by another physical object.');
      }
    }
    return final.receipts();
  } finally { await final.close(); }
}

export async function validateGeometryEvidence(input: {
  evidence: GeometryEvidence; source: GeometryEvidenceSource; native: GeometrySessionInput['native'];
  candidate: ModelSnapshot; signal: AbortSignal;
}): Promise<GeometryReadSnapshot & { verifiedCandidateSha256: string; finalReceipts: ReturnType<GeometrySession['receipts']> }> {
  const evidence = parseGeometryEvidence(input.evidence);
  const snapshot = await readGeometrySnapshot(input.source, evidence.projectId, input.native, input.signal, evidence.receipts);
  const candidate = { ...snapshot.input, native: { ...snapshot.input.native, snapshot: input.candidate } };
  const status = await validateGeometryReceiptsInWorker({ receipts: evidence.receipts, current: snapshot.input,
    candidate, ...(snapshot.correspondences ? { correspondences: snapshot.correspondences } : {}) }, { signal: input.signal });
  input.signal.throwIfAborted();
  if (status.kind !== 'fresh') throw new GeometryEvidenceConflict(status.reason);
  // Independent host verification sees the complete authorized project; no full-graph facts cross the guest boundary.
  const fullNative = { snapshot: input.candidate, revisionId: input.native.revisionId, target: input.native.target };
  const finalReceipts = await validateFinalMeasurements(evidence, { ...candidate, native: fullNative }, input.signal, snapshot.correspondences ?? []);
  return { ...snapshot, verifiedCandidateSha256: geometrySnapshotHash(input.candidate), finalReceipts };
}

type OpenGeometryEvidence = { source: GeometryEvidenceSource; projectId: string; requestId: string;
  native: GeometrySessionInput['native']; signal: AbortSignal; current?: () => Promise<GeometrySessionInput['native']> };

/** One host-owned request session. Guest decisions cannot supply, erase or replace receipts. */
export class GeometryEvidenceSession {
  readonly #input: OpenGeometryEvidence;
  readonly #session: GeometrySession;
  readonly #measurements: GeometryEvidence['measurements'] = [];
  #closed = false;
  private constructor(input: OpenGeometryEvidence, session: GeometrySession) { this.#input = input; this.#session = session; }
  static async open(input: OpenGeometryEvidence): Promise<GeometryEvidenceSession> {
    const snapshot = await readGeometrySnapshot(input.source, input.projectId, input.native, input.signal);
    const session = await createGeometrySession(snapshot.input, { signal: input.signal, lifetimeMs: 180000 });
    if (input.signal.aborted) { await session.close(); input.signal.throwIfAborted(); }
    return new GeometryEvidenceSession({ ...input, native: structuredClone(input.native) }, session);
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
  async #current(): Promise<GeometrySessionInput['native']> { return this.#input.current ? this.#input.current() : this.#input.native; }
  async assertFresh(candidate?: ModelSnapshot): Promise<void> {
    this.#assertAlive();
    const receipts = this.#session.receipts();
    if (!receipts.length) return;
    const native = await this.#current();
    this.#assertAlive();
    const current = await readGeometrySnapshot(this.#input.source, this.#input.projectId, native, this.#input.signal, receipts);
    const result = await validateGeometryReceiptsInWorker({ receipts, current: current.input,
      candidate: { ...current.input, native: { ...current.input.native, snapshot: candidate ?? native.snapshot } },
      ...(current.correspondences ? { correspondences: current.correspondences } : {}) }, { signal: this.#input.signal });
    this.#assertAlive();
    if (result.kind !== 'fresh') throw new GeometryEvidenceConflict(result.reason);
  }
  async seal(candidate: ModelSnapshot): Promise<GeometryEvidence | undefined> {
    this.#assertAlive();
    if (!this.#session.receipts().length) return;
    await this.assertFresh(candidate);
    this.#assertAlive();
    const evidence = parseGeometryEvidence({ version: 1, projectId: this.#input.projectId, requestId: this.#input.requestId,
      baseRevisionId: this.#input.native.revisionId, proposalSnapshotSha256: geometrySnapshotHash(candidate),
      receipts: this.#session.receipts(), measurements: this.#measurements });
    await validateGeometryEvidence({ evidence, source: this.#input.source, native: await this.#current(), candidate, signal: this.#input.signal });
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
