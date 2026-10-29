import { createHash } from 'node:crypto';
import { Check } from 'typebox/value';
import { Type } from 'typebox';
import { parseLinkedPrepared } from './linked-model.ts';
import type { LinkedPrepared } from './linked-model.ts';
import { validateSnapshot } from './room-model.ts';
import { GeometryMatrixSchema, GeometryPageRequestSchema, geometryPlainData, parseGeometryMeasureRequest, parseGeometryQuery, parseGeometryReceipts, parseGeometryRef } from './geometry-contract.ts';
import type { GeometryDescription, GeometryDescriptionResult, GeometryDomain, GeometryFailure, GeometryMeasureRequest, GeometryMeasureResult, GeometryMeasurement,
  GeometryPageRequest, GeometryProjection, GeometryQuery, GeometryQueryResult, GeometryRead, GeometryReceipt, GeometryRef, GeometryRelation, GeometryRelationsResult, GeometryResult } from './geometry-contract.ts';
import { GeometryLimitError, NUMERIC_TOLERANCE_METRES, add, assertRigidTransform, boundsOverlap, boxMesh, createMesh, cross, dot,
  geometryWork, measureShapes, scale, shapeOf, sub, transformPoint } from './geometry-math.ts';
import type { GeometryShape, GeometryWork, Triangle, Vec3 } from './geometry-math.ts';
import { geometryCategory, nativeGeometryRecords } from './geometry-native.ts';
import type { GeometryRecord, NativeGeometryInput } from './geometry-native.ts';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  throw new Error('Geometry digest requires finite JSON.');
}
export const geometryDigest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
/** Canonical wire payload hash. Receipt metadata is excluded to avoid a recursive digest. */
export function geometryPublicResultDigest(result: GeometryResult): string {
  const { receipt, ...payload } = result;
  return geometryDigest(payload);
}
export function geometryIdentityKey(ref: GeometryRef): string {
  return canonical(ref.kind === 'native' ? [ref.kind, ref.projectId, ref.target, ref.entityId]
    : [ref.kind, ref.projectId, ref.namespace, ref.occurrenceId, ref.globalId]);
}
function exactRef(a: GeometryRef, b: GeometryRef): boolean { return canonical(a) === canonical(b); }
function projection(record: GeometryRecord, kind: GeometryProjection): unknown {
  if (kind === 'geometry') return { shape: record.shape, capability: record.description.capability, dependencies: record.dependencies };
  if (kind === 'relations') return record.relations.map(relation => ({ ...relation, target: geometryIdentityKey(relation.target) }));
  return { ...record.description, ref: geometryIdentityKey(record.description.ref), dependencies: record.dependencies };
}
function surfaceSamples(record: GeometryRecord, work: GeometryWork): void {
  if (!record.shape) return;
  const samples: { triangle: Triangle; area: number; normal: Vec3 }[] = [];
  for (const mesh of record.shape.meshes) for (const triangle of mesh.triangles) {
    work.tick();
    const n = cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0])); const magnitude = Math.hypot(...n);
    samples.push({ triangle, area: magnitude / 2, normal: scale(n, 1 / magnitude) });
  }
  samples.sort((a, b) => b.area - a.area);
  record.description.surfaceSamples = samples.slice(0, 12).map(sample => ({ point: scale(add(add(sample.triangle[0], sample.triangle[1]), sample.triangle[2]), 1 / 3),
    normal: sample.normal, triangleAreaMetres2: sample.area, orientation: 'mesh-winding' }));
  record.description.surfaceSamplesTruncated = samples.length > 12;
}
function linkedRecords(projectId: string, input: LinkedPrepared, work: GeometryWork): GeometryRecord[] {
  const prepared = parseLinkedPrepared(input);
  const source = prepared.manifest.source; const occurrence = prepared.manifest.occurrence;
  assertRigidTransform(occurrence.sourceToProjectMetres);
  const placementDigest = geometryDigest(occurrence.sourceToProjectMetres);
  const ref = (globalId: string): GeometryRef => ({ kind: 'ifc', projectId, ...source, occurrenceId: occurrence.id, globalId, placementDigest });
  const meshes = new Map(prepared.geometry.meshes.map(mesh => [mesh.ref.globalId, mesh]));
  const placementIdentitySchema = Type.Object({ globalId: Type.String() });
  const products = new Set(prepared.index.placements.flatMap(value => Check(placementIdentitySchema, value) ? [value.globalId] : []));
  const completeProductInventory = products.size === prepared.manifest.counts.products && products.size === prepared.index.placements.length
    && [...products].every(id => prepared.index.objects.some(object => object.ref.globalId === id));
  const placedSchema = Type.Object({ globalId: Type.String(), productToSourceMetres: GeometryMatrixSchema });
  const levelElevations = new Map<string, number>();
  for (const placement of prepared.index.placements) if (Check(placedSchema, placement)) {
    try {
      assertRigidTransform(placement.productToSourceMetres);
      const origin = transformPoint(occurrence.sourceToProjectMetres, transformPoint(placement.productToSourceMetres, [0, 0, 0]));
      const up = sub(transformPoint(occurrence.sourceToProjectMetres, transformPoint(placement.productToSourceMetres, [0, 0, 1])), origin);
      if (Math.hypot(up[0], up[1], up[2] - 1) < 1e-8) levelElevations.set(placement.globalId, origin[2]);
    } catch { /* Unusable semantic placement has no inferred project elevation. Physical meshes validate separately. */ }
  }
  return prepared.index.objects.map(object => {
    work.tick(); const raw = meshes.get(object.ref.globalId);
    let shape: GeometryShape | null = null;
    let detail = 'No prepared physical mesh was supplied for this source object.';
    if (raw) {
      assertRigidTransform(raw.productToSourceMetres);
      const points: Vec3[] = [];
      for (let i = 0; i < raw.verticesMetres.length; i += 3) {
        work.tick();
        const point: Vec3 = [raw.verticesMetres[i], raw.verticesMetres[i + 1], raw.verticesMetres[i + 2]];
        // Converter contract already normalized local vertices and product placement to metres. Never apply source mm scale twice.
        points.push(transformPoint(occurrence.sourceToProjectMetres, transformPoint(raw.productToSourceMetres, point)));
      }
      const triangles: Triangle[] = [];
      for (let i = 0; i < raw.triangles.length; i += 3) {
        work.tick(); const a = points[raw.triangles[i]]; const b = points[raw.triangles[i + 1]]; const c = points[raw.triangles[i + 2]];
        if (!a || !b || !c) throw new Error('Prepared mesh topology references missing vertices.');
        triangles.push([a, b, c]);
      }
      try { shape = shapeOf([createMesh(triangles, work)]); }
      catch (error) { if (error instanceof GeometryLimitError) throw error; detail = 'Prepared mesh has degenerate or unsupported topology.'; }
    }
    const category = geometryCategory(object.ifcClass);
    const context = ['IfcProject', 'IfcSite', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSpace', 'IfcOpeningElement'].includes(object.ifcClass)
      || completeProductInventory && !products.has(object.ref.globalId);
    const relations: GeometryRecord['relations'] = prepared.index.spatial.filter(edge => edge.child === object.ref.globalId).map(edge => ({ kind: edge.kind, target: ref(edge.parent), basis: 'declared' }));
    // A declared storey ancestor is a semantic level; no geometric containment is asserted.
    const ancestors = new Set<string>([object.ref.globalId]);
    for (let depth = 0; depth < 16; depth++) {
      let changed = false;
      for (const edge of prepared.index.spatial) {
        work.tick(); if (ancestors.has(edge.child) && !ancestors.has(edge.parent)) { ancestors.add(edge.parent); changed = true; }
      }
      if (!changed) break;
    }
    for (const level of prepared.index.objects) if (level.ifcClass === 'IfcBuildingStorey' && ancestors.has(level.ref.globalId) && level.ref.globalId !== object.ref.globalId) {
      relations.push({ kind: 'level', target: ref(level.ref.globalId), basis: 'declared' });
    }
    return { description: { ref: ref(object.ref.globalId), name: (object.name ?? '').slice(0, 256), class: object.ifcClass, category,
      role: context ? 'context' : 'physical', frame: 'project-engineering-metres', sourceUnitsToMetres: prepared.index.unitScaleToMetres,
      writeAuthority: 'read-only', bounds: shape?.bounds ?? null, capability: shape ? { kind: 'mesh', closed: shape.meshes.every(mesh => mesh.closed),
        representation: 'ifcopenshell-prepared-triangles', numericToleranceMetres: NUMERIC_TOLERANCE_METRES, sourceErrorMetres: null,
        limitation: 'Original-solid tessellation error is unqualified. Measurements are relative to prepared triangles; closed topology alone does not certify a self-intersection-free engineering solid. Map conversion is unapplied.' }
        : { kind: 'unavailable', reason: raw ? 'unsupported' : 'missing-geometry', detail },
      semantics: category === 'level' ? { kind: 'level', elevationMetres: levelElevations.get(object.ref.globalId) ?? null }
        : category === 'space' ? { kind: 'space', footprintProjectMetres: null } : { kind: 'none' }, surfaceSamples: [], surfaceSamplesTruncated: false },
      shape, relations, dependencies: shape ? null : { placement: structuredClone(occurrence.sourceToProjectMetres) } };
  });
}

export type GeometryLimits = { maxObjects: number; maxTriangles: number; maxWork: number; maxPairs: number; maxMilliseconds: number;
  maxResponseBytes: number; maxReceipts: number };
const defaults: GeometryLimits = { maxObjects: 4096, maxTriangles: 120000, maxWork: 2000000, maxPairs: 200000, maxMilliseconds: 1000,
  maxResponseBytes: 256 * 1024, maxReceipts: 128 };
export type GeometryContextInput = { projectId: string; native: NativeGeometryInput; linked: readonly LinkedPrepared[];
  unavailableSources?: readonly { id: string; reason: string }[]; limits?: Partial<GeometryLimits>; now?: () => number };
class GeometryUnavailableError extends Error {
  readonly reason: GeometryFailure;
  constructor(reason: GeometryFailure, detail: string) { super(detail); this.reason = reason; }
}
type Outcome<T> = { kind: 'complete'; value: T } | { kind: 'partial'; value: T; reason: GeometryFailure; detail: string }
  | { kind: 'unavailable'; reason: GeometryFailure; detail: string };
type Selection = { records: GeometryRecord[]; uncertain: number; complete: boolean; read: Extract<GeometryRead, { kind: 'query' }> };
type QueryPurpose = Extract<GeometryRead, { kind: 'query' }>['purpose'];
type QueryPage = { items: GeometryDescription[]; domain: GeometryDomain; total: number; uncertainMembers: number; nextCursor: string | null };
function publicQueryPayload(outcome: Outcome<QueryPage>) {
  return outcome.kind === 'unavailable' ? outcome : { kind: outcome.kind, ...outcome.value };
}
function publicRelationsPayload(outcome: Outcome<GeometryRelation[]>) {
  return outcome.kind === 'unavailable' ? outcome : ({ kind: 'complete', items: outcome.value } satisfies { kind: 'complete'; items: GeometryRelation[] });
}

/** A request-local derived read model. No DB, authoring, external fetch, or acceptance authority. */
export class GeometryContext {
  readonly projectId: string;
  readonly domain: Readonly<GeometryDomain>;
  readonly #records: Map<string, GeometryRecord>;
  readonly #limits: GeometryLimits;
  readonly #now: () => number;
  readonly #unavailable: readonly { id: string; reason: string }[];
  readonly #log: GeometryReceipt[] = [];
  #logBytes = 0;
  #exhausted = false;
  constructor(input: GeometryContextInput) {
    this.projectId = input.projectId;
    if (!input.projectId || input.projectId.length > 128) throw new Error('A bounded authorized project is required.');
    this.#limits = { ...defaults, ...input.limits };
    for (const key of Object.keys(defaults)) {
      const supplied = Object.entries(this.#limits).find(([name]) => name === key)?.[1]; const maximum = Object.entries(defaults).find(([name]) => name === key)?.[1];
      if (supplied === undefined || maximum === undefined || !Number.isInteger(supplied) || supplied < 1 || supplied > maximum) throw new Error('Geometry limits may only lower bounded defaults.');
    }
    this.#now = input.now ?? (() => performance.now());
    this.#unavailable = (input.unavailableSources ?? []).map(source => ({ id: source.id.slice(0, 128), reason: source.reason.slice(0, 1024) }));
    if (this.#unavailable.length > 64 || input.linked.length > 64) throw new Error('Too many linked source occurrences.');
    const work = this.#work();
    const native = { ...input.native, snapshot: validateSnapshot(input.native.snapshot) };
    // Parsing a reference validates native target/revision metadata independently of source bodies.
    parseGeometryRef({ kind: 'native', projectId: input.projectId, target: native.target, revisionId: native.revisionId, entityId: 'context' });
    const readableIds = native.readableIds === undefined ? null : new Set(native.readableIds);
    if (native.readableIds && (native.readableIds.length > 100 || readableIds?.size !== native.readableIds.length
      || native.readableIds.some(id => !native.snapshot.entities.some(entity => entity.id === id)))) throw new Error('Native readable identities must be a bounded unique authorized subset of the full evaluation graph.');
    this.domain = Object.freeze({ kind: readableIds ? 'authorized-native-scope' : 'project', digest: geometryDigest({ projectId: input.projectId, target: native.target,
      nativeDomain: readableIds ? [...readableIds].sort() : 'project' }) });
    const records = nativeGeometryRecords(input.projectId, native, work).filter(record => !readableIds || readableIds.has(record.description.ref.kind === 'native' ? record.description.ref.entityId : ''));
    for (const record of records) record.relations = record.relations.filter(relation => relation.target.kind !== 'native' || !readableIds || readableIds.has(relation.target.entityId));
    const occurrences = new Set<string>();
    for (const linked of input.linked) {
      const occurrenceKey = canonical([linked.manifest.source.namespace, linked.manifest.occurrence.id]);
      if (occurrences.has(occurrenceKey)) throw new Error('Duplicate current source occurrence; historical versions require separate frozen contexts.');
      occurrences.add(occurrenceKey); records.push(...linkedRecords(input.projectId, linked, work));
    }
    if (records.length > this.#limits.maxObjects) throw new GeometryLimitError('budget');
    let triangles = 0;
    for (const record of records) { work.tick(); triangles += record.shape?.meshes.reduce((sum, mesh) => sum + mesh.triangles.length, 0) ?? 0; }
    if (triangles > this.#limits.maxTriangles) throw new GeometryLimitError('budget');
    for (const record of records) surfaceSamples(record, work);
    this.#records = new Map(records.map(record => [geometryIdentityKey(record.description.ref), record]));
    if (this.#records.size !== records.length) throw new Error('Duplicate geometry identity in a source namespace/occurrence/target.');
  }
  #work(): GeometryWork { return geometryWork({ maxWork: this.#limits.maxWork, maxMilliseconds: this.#limits.maxMilliseconds, now: this.#now }); }
  #resolve(ref: GeometryRef): GeometryRecord {
    if (ref.projectId !== this.projectId) throw new GeometryUnavailableError('missing-object', 'Geometry reference is outside this authorized project.');
    const record = this.#records.get(geometryIdentityKey(ref));
    if (!record) throw new GeometryUnavailableError('missing-object', 'Geometry object is absent from this frozen context.');
    if (!exactRef(ref, record.description.ref)) throw new GeometryUnavailableError('stale-reference', 'Geometry reference is not pinned to this frozen source/placement/native revision.');
    return record;
  }
  #objectRead(record: GeometryRecord, kind: GeometryProjection, reads: GeometryRead[]): void {
    const read: GeometryRead = { kind: 'object', ref: record.description.ref, projection: kind, digest: geometryDigest(projection(record, kind)) };
    if (!reads.some(existing => canonical(existing) === canonical(read))) reads.push(read);
  }
  #select(query: GeometryQuery, work: GeometryWork, purpose: QueryPurpose = 'discovery', candidateExclusion?: GeometryRef): Selection {
    if (query.level) this.#resolve(query.level);
    // Explicit caller exclusions require exact live pins. Only the host's separately receipted candidate can be absent from the accepted read model.
    for (const ref of query.exclude ?? []) this.#resolve(ref);
    const excluded = new Set(query.exclude?.map(geometryIdentityKey));
    if (candidateExclusion) excluded.add(geometryIdentityKey(candidateExclusion));
    const records: GeometryRecord[] = []; let uncertain = 0;
    for (const record of this.#records.values()) {
      work.tick(); const d = record.description;
      if (excluded.has(geometryIdentityKey(d.ref)) || (query.role !== 'all' && d.role !== (query.role ?? 'physical'))
        || (query.classes && !query.classes.includes(d.class)) || (query.categories && !query.categories.includes(d.category))) continue;
      let unknownLevel = false;
      if (query.level) {
        const levelKey = geometryIdentityKey(query.level);
        const levels = record.relations.filter(relation => relation.kind === 'level');
        if (!levels.length) unknownLevel = true;
        else if (!levels.some(relation => geometryIdentityKey(relation.target) === levelKey)) continue;
      }
      if (query.region && d.bounds && !boundsOverlap(query.region, d.bounds)) continue;
      records.push(record); if (((query.region !== undefined || purpose === 'measurement') && !record.shape) || unknownLevel) uncertain++;
    }
    records.sort((a, b) => geometryIdentityKey(a.description.ref).localeCompare(geometryIdentityKey(b.description.ref)));
    const complete = uncertain === 0 && this.#unavailable.length === 0;
    const digest = geometryDigest({ query: queryIdentity(query), purpose, candidateExclusion: candidateExclusion ? geometryIdentityKey(candidateExclusion) : null,
      members: records.map(record => purpose === 'measurement' ? { key: geometryIdentityKey(record.description.ref), geometry: projection(record, 'geometry') }
        : geometryIdentityKey(record.description.ref)), uncertain, unavailableSources: this.#unavailable });
    return { records, uncertain, complete, read: { kind: 'query', query, digest, purpose, ...(candidateExclusion ? { candidateExclusion } : {}), members: records.map(record => record.description.ref),
      unavailableSources: this.#unavailable.map(source => source.id), complete } };
  }
  #run<T>(method: string, input: unknown, calculate: (value: unknown, reads: GeometryRead[], work: GeometryWork) => Outcome<T>,
    publicPayload: (outcome: Outcome<T>) => unknown = outcome => outcome): { outcome: Outcome<T>; receipt: GeometryReceipt } {
    let reads: GeometryRead[] = []; let operationDigest = geometryDigest({ method, invalid: true }); let outcome: Outcome<T>;
    try {
      if (this.#exhausted || this.#log.length >= this.#limits.maxReceipts - 1) { this.#exhausted = true; throw new GeometryLimitError('budget'); }
      const value = geometryPlainData(input); operationDigest = geometryDigest({ method, input: value });
      const work = this.#work(); outcome = calculate(value, reads, work); work.tick();
      if (reads.length > 128) throw new GeometryLimitError('budget');
      const replyBytes = Buffer.byteLength(canonical({ outcome: publicPayload(outcome), reads }));
      if (replyBytes > this.#limits.maxResponseBytes || this.#logBytes + replyBytes > 1024 * 1024) throw new GeometryUnavailableError('response-limit', 'Geometry reply or accumulated evidence exceeds the byte limit.');
    } catch (error) {
      reads = [];
      outcome = { kind: 'unavailable', reason: error instanceof GeometryLimitError || error instanceof GeometryUnavailableError ? error.reason : 'invalid-input',
        detail: error instanceof Error ? error.message.slice(0, 1024) : 'Invalid geometry operation.' };
    }
    const receipt: GeometryReceipt = { version: 1, projectId: this.projectId, domain: structuredClone(this.domain), reads: structuredClone(reads), operationDigest,
      resultDigest: geometryDigest(publicPayload(outcome)), status: outcome.kind };
    if (this.#log.length < this.#limits.maxReceipts) { this.#log.push(receipt); this.#logBytes += Buffer.byteLength(canonical(receipt)); }
    return { outcome: structuredClone(outcome), receipt: structuredClone(receipt) };
  }
  describe(input: unknown): GeometryDescriptionResult {
    const { outcome, receipt } = this.#run<GeometryDescription>('describe', input, (value, reads) => {
      const record = this.#resolve(parseGeometryRef(value)); this.#objectRead(record, 'description', reads);
      return record.shape || record.description.role === 'context' ? { kind: 'complete', value: record.description }
        : { kind: 'partial', value: record.description, reason: 'missing-geometry', detail: 'Object identity exists but physical geometry is unavailable.' };
    });
    return { ...outcome, receipt };
  }
  query(input: unknown): GeometryQueryResult {
    const { outcome, receipt } = this.#run<QueryPage>('query', input, (value, reads, work) => {
      if (!Check(GeometryPageRequestSchema, value)) throw new Error('Invalid bounded geometry page request.');
      const query = parseGeometryQuery(value.query); const selection = this.#select(query, work); reads.push(selection.read);
      const contextDigest = geometryDigest([...this.#records.values()].map(record => record.description.ref));
      const prefix = `${geometryDigest(query)}.${contextDigest}.`;
      const offset = value.cursor === undefined ? 0 : value.cursor.startsWith(prefix) && /^\d+$/.test(value.cursor.slice(prefix.length)) ? Number(value.cursor.slice(prefix.length)) : NaN;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > selection.records.length) throw new GeometryUnavailableError('stale-reference', 'Cursor does not belong to this exact frozen context and predicate.');
      const limit = value.limit ?? 20; const page = selection.records.slice(offset, offset + limit);
      for (const record of page) this.#objectRead(record, 'description', reads);
      const result = { items: page.map(record => record.description), domain: this.domain, total: selection.records.length, uncertainMembers: selection.uncertain + this.#unavailable.length,
        nextCursor: offset + limit < selection.records.length ? `${prefix}${offset + limit}` : null };
      return selection.complete ? { kind: 'complete', value: result } : { kind: 'partial', value: result, reason: 'missing-geometry', detail: 'One or more potentially relevant objects or active sources lack geometry.' };
    }, publicQueryPayload);
    return { ...publicQueryPayload(outcome), receipt };
  }
  relations(input: unknown): GeometryRelationsResult {
    const { outcome, receipt } = this.#run<GeometryRelation[]>('relations', input, (value, reads) => {
      const record = this.#resolve(parseGeometryRef(value)); this.#objectRead(record, 'relations', reads);
      if (record.relations.length > 128) throw new GeometryLimitError('budget');
      return { kind: 'complete', value: record.relations };
    }, publicRelationsPayload);
    return { ...publicRelationsPayload(outcome), receipt };
  }
  measure(input: unknown): GeometryMeasureResult {
    const { outcome, receipt } = this.#run<GeometryMeasurement>('measure', input, (value, reads, work) => {
      const request = parseGeometryMeasureRequest(value);
      if (request.operation === 'containment' && request.against.kind !== 'object') throw new GeometryUnavailableError('unsupported', 'Containment requires one explicit container object, not a union of query candidates.');
      const subjectRecord = request.subject.kind === 'object' ? this.#resolve(request.subject.ref) : null;
      const subject = request.subject.kind === 'box' ? shapeOf([boxMesh(request.subject.bounds, request.subject.localToProject, work)]) : subjectRecord?.shape;
      if (!subject) throw new GeometryUnavailableError('missing-geometry', 'Measurement subject has no supported shape.');
      const candidateDigest = request.subject.kind === 'box' ? geometryDigest(request.subject) : geometryDigest(projection(subjectRecordRequired(subjectRecord), 'geometry'));
      reads.push({ kind: 'candidate', subject: request.subject, digest: candidateDigest });
      let candidates: GeometryRecord[]; let complete = true;
      if (request.against.kind === 'query') {
        const query = structuredClone(request.against.query);
        const selected = this.#select(query, work, 'measurement', request.subject.kind === 'object' ? request.subject.ref : undefined);
        reads.push(selected.read); candidates = selected.records; complete = selected.complete;
        if (request.operation === 'clearance' && query.region) {
          const gap = (request.clearanceMetres ?? 0) + NUMERIC_TOLERANCE_METRES;
          if (subject.bounds.min.some((n, i) => query.region && (query.region.min[i] > n - gap || query.region.max[i] < subject.bounds.max[i] + gap))) {
            throw new GeometryUnavailableError('invalid-input', 'A clearance region must enclose the candidate expanded by the requested clearance.');
          }
        }
      } else { const record = this.#resolve(request.against.ref); this.#objectRead(record, 'geometry', reads); candidates = [record]; }
      let nearest: GeometryRecord | null = null; let best: ReturnType<typeof measureShapes> | null = null; let tested = 0;
      let errorBound: number | null = subjectRecord?.description.capability.kind === 'mesh' ? subjectRecord.description.capability.sourceErrorMetres : 0;
      for (const record of candidates) {
        work.tick(); if (!record.shape) { complete = false; continue; }
        const hit = measureShapes(subject, record.shape, work, this.#limits.maxPairs); tested++;
        if (!hit.closed || hit.relation === 'unknown') complete = false;
        const capability = record.description.capability;
        if (capability.kind === 'mesh') errorBound = errorBound === null || capability.sourceErrorMetres === null ? null : errorBound + capability.sourceErrorMetres;
        const penetrates = (relation: string): boolean => ['volume-overlap', 'subject-inside', 'obstacle-inside'].includes(relation);
        if (!best || hit.distance < best.distance || (hit.distance === best.distance && penetrates(hit.relation) && !penetrates(best.relation))) { best = hit; nearest = record; }
      }
      const clearance = request.operation !== 'clearance' ? 'not-requested' : !complete ? 'unknown'
        : !best ? 'satisfied-mesh' : best.relation === 'contact-or-overlap' && (request.clearanceMetres ?? 0) === 0 ? 'unknown'
          : best.relation === 'volume-overlap' || best.relation === 'subject-inside' || best.relation === 'obstacle-inside' ? 'violated-mesh'
          : best.distance + NUMERIC_TOLERANCE_METRES >= (request.clearanceMetres ?? 0) ? 'satisfied-mesh' : 'violated-mesh';
      const measurement: GeometryMeasurement = { nearest: nearest?.description.ref ?? null, distanceMetres: best?.distance ?? null,
        witness: best ? { subject: best.subject, obstacle: best.obstacle } : null, relation: best?.relation ?? (complete ? 'empty-set' : 'unknown'),
        clearance, numericToleranceMetres: NUMERIC_TOLERANCE_METRES, sourceErrorMetres: errorBound,
        exactness: 'prepared-representation', testedObjects: tested, domain: this.domain };
      return complete ? { kind: 'complete', value: measurement } : { kind: 'partial', value: measurement, reason: 'unsupported',
        detail: 'Potentially relevant geometry is missing or has open/unsupported solid topology. Surface distance is not a solid-clearance certificate.' };
    });
    return { ...outcome, receipt };
  }
  receipts(): GeometryReceipt[] { return structuredClone(this.#log); }
  /** Host-only projection lookup. No guest method receives the underlying shape. */
  currentProjection(ref: GeometryRef, kind: GeometryProjection): { ref: GeometryRef; digest: string } | null {
    if (ref.projectId !== this.projectId) return null;
    const record = this.#records.get(geometryIdentityKey(ref));
    return record ? { ref: structuredClone(record.description.ref), digest: geometryDigest(projection(record, kind)) } : null;
  }
  /** Host-only predicate replay used by trusted receipt revalidation, with complete membership. */
  currentQuery(query: GeometryQuery, purpose: QueryPurpose = 'discovery', candidateExclusion?: GeometryRef): Extract<GeometryRead, { kind: 'query' }> {
    return structuredClone(this.#select(query, this.#work(), purpose, candidateExclusion).read);
  }
}
function subjectRecordRequired(record: GeometryRecord | null): GeometryRecord {
  if (!record) throw new Error('Missing measured object record.'); return record;
}
function queryIdentity(query: GeometryQuery): unknown {
  return { ...query, ...(query.level ? { level: geometryIdentityKey(query.level) } : {}),
    ...(query.exclude ? { exclude: query.exclude.map(geometryIdentityKey) } : {}) };
}
export function createGeometryContext(input: GeometryContextInput): GeometryContext { return new GeometryContext(input); }

export type GeometryFreshness = { kind: 'fresh' } | { kind: 'stale' | 'unavailable'; reason: string };
/** Receipts are trusted host observations, not caller-supplied credentials. Bind their full digest into proposal evidence in the acceptance owner. */
export function validateGeometryReceipts(input: { receipts: unknown; current: GeometryContext; candidate?: GeometryContext;
  verifyCorrespondence?: (historical: Extract<GeometryRef, { kind: 'ifc' }>, current: Extract<GeometryRef, { kind: 'ifc' }>) => boolean }): GeometryFreshness {
  try {
    const receipts = parseGeometryReceipts(input.receipts);
    const correspondence = (old: GeometryRef, current: GeometryRef): boolean => {
      if (geometryIdentityKey(old) !== geometryIdentityKey(current)) return false;
      if (old.kind === 'native' && current.kind === 'native') return true;
      return old.kind === 'ifc' && current.kind === 'ifc' && (old.originalSha256 === current.originalSha256 && old.revision === current.revision
        || input.verifyCorrespondence?.(old, current) === true);
    };
    for (const receipt of receipts) {
      if (receipt.projectId !== input.current.projectId || receipt.status !== 'complete') return { kind: 'unavailable', reason: 'An observation is incomplete or belongs to another project.' };
      if (canonical(receipt.domain) !== canonical(input.current.domain)) return { kind: 'stale', reason: 'The authorized geometry read domain changed.' };
      for (const read of receipt.reads) {
        if (read.kind === 'object') {
          const current = input.current.currentProjection(read.ref, read.projection);
          if (!current || !correspondence(read.ref, current.ref) || current.digest !== read.digest) return { kind: 'stale', reason: 'A consumed object projection or its verified correspondence changed.' };
        } else if (read.kind === 'query') {
          const query = structuredClone(read.query);
          if (query.level) {
            const level = input.current.currentProjection(query.level, 'relations');
            if (!level || !correspondence(query.level, level.ref)) return { kind: 'stale', reason: 'Query level identity changed.' };
            query.level = level.ref;
          }
          if (query.exclude) {
            const rebound: GeometryRef[] = [];
            for (const excluded of query.exclude) {
              const current = input.current.currentProjection(excluded, 'relations');
              if (!current || !correspondence(excluded, current.ref)) return { kind: 'stale', reason: 'An explicit exclusion lacks verified current identity correspondence.' };
              rebound.push(current.ref);
            }
            query.exclude = rebound;
          }
          if (read.candidateExclusion) {
            const candidateRef = read.candidateExclusion;
            const candidateRead = receipt.reads.find(item => item.kind === 'candidate' && item.subject.kind === 'object' && exactRef(item.subject.ref, candidateRef));
            const currentCandidate = input.candidate?.currentProjection(candidateRef, 'geometry');
            if (!candidateRead || candidateRead.kind !== 'candidate' || !currentCandidate || currentCandidate.digest !== candidateRead.digest
              || !correspondence(candidateRef, currentCandidate.ref)) return { kind: 'stale', reason: 'The implicit exclusion is not bound to the final measured candidate.' };
          }
          const current = input.current.currentQuery(query, read.purpose, read.candidateExclusion);
          if (!current.complete || current.digest !== read.digest || current.members.length !== read.members.length) return { kind: 'stale', reason: 'Complete spatial candidate membership or a relevant geometry projection changed.' };
          const members = new Map(current.members.map(ref => [geometryIdentityKey(ref), ref]));
          for (const ref of read.members) { const member = members.get(geometryIdentityKey(ref)); if (!member || !correspondence(ref, member)) return { kind: 'stale', reason: 'A candidate lacks verified source identity correspondence.' }; }
        } else if (read.subject.kind === 'box') {
          if (geometryDigest(read.subject) !== read.digest) return { kind: 'stale', reason: 'Measured candidate descriptor changed.' };
        } else {
          const candidate = input.candidate?.currentProjection(read.subject.ref, 'geometry');
          if (!candidate || candidate.digest !== read.digest || !correspondence(read.subject.ref, candidate.ref)) return { kind: 'stale', reason: 'Final evaluated candidate is absent or changed; supply the reconciled candidate context.' };
        }
      }
    }
    return { kind: 'fresh' };
  } catch (error) { return { kind: 'unavailable', reason: error instanceof Error ? error.message : 'Geometry revalidation failed.' }; }
}
