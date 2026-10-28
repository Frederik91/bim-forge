import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { DesignTargetSchema } from './design-target-contract.ts';

const exact = { additionalProperties: false };
const token = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: '^[a-f0-9]{64}$' });
const coordinate = Type.Number({ minimum: -1e6, maximum: 1e6 });
export const GeometryPointSchema = Type.Tuple([coordinate, coordinate, coordinate]);
export const GeometryBoundsSchema = Type.Object({ min: GeometryPointSchema, max: GeometryPointSchema }, exact);
export const GeometryMatrixSchema = Type.Tuple([
  Type.Tuple([coordinate, coordinate, coordinate, coordinate]), Type.Tuple([coordinate, coordinate, coordinate, coordinate]),
  Type.Tuple([coordinate, coordinate, coordinate, coordinate]), Type.Tuple([coordinate, coordinate, coordinate, coordinate]),
]);
export const GeometryRefSchema = Type.Union([
  Type.Object({ kind: Type.Literal('native'), projectId: token, target: DesignTargetSchema, revisionId: hash, entityId: token }, exact),
  Type.Object({ kind: Type.Literal('ifc'), projectId: token, namespace: token, revision: token,
    originalSha256: hash, occurrenceId: token, globalId: token, placementDigest: hash }, exact),
]);
export type GeometryRef = Static<typeof GeometryRefSchema>;
export type GeometryPoint = Static<typeof GeometryPointSchema>;
export type GeometryBounds = Static<typeof GeometryBoundsSchema>;
export type GeometryMatrix = Static<typeof GeometryMatrixSchema>;

export const GeometryQuerySchema = Type.Object({
  region: Type.Optional(GeometryBoundsSchema), classes: Type.Optional(Type.Array(token, { maxItems: 32, uniqueItems: true })),
  role: Type.Optional(Type.Union([Type.Literal('physical'), Type.Literal('context'), Type.Literal('all')])),
  // A level is a qualified object identity; names never establish correspondence.
  level: Type.Optional(GeometryRefSchema),
}, exact);
export const GeometryPageRequestSchema = Type.Object({ query: GeometryQuerySchema,
  cursor: Type.Optional(Type.String({ maxLength: 256 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
}, exact);
export type GeometryQuery = Static<typeof GeometryQuerySchema>;
export type GeometryPageRequest = Static<typeof GeometryPageRequestSchema>;

export const GeometrySubjectSchema = Type.Union([
  Type.Object({ kind: Type.Literal('object'), ref: GeometryRefSchema }, exact),
  Type.Object({ kind: Type.Literal('box'), candidateId: token, bounds: GeometryBoundsSchema,
    localToProject: GeometryMatrixSchema }, exact),
]);
export const GeometryMeasureRequestSchema = Type.Object({ subject: GeometrySubjectSchema,
  against: Type.Union([Type.Object({ kind: Type.Literal('object'), ref: GeometryRefSchema }, exact),
    Type.Object({ kind: Type.Literal('query'), query: GeometryQuerySchema }, exact)]),
  operation: Type.Union([Type.Literal('distance'), Type.Literal('clearance'), Type.Literal('intersection'), Type.Literal('containment')]),
  clearanceMetres: Type.Optional(Type.Number({ minimum: 0, maximum: 1e4 })),
}, exact);
export type GeometryMeasureRequest = Static<typeof GeometryMeasureRequestSchema>;

const reason = Type.Union([Type.Literal('missing-object'), Type.Literal('stale-reference'), Type.Literal('missing-geometry'),
  Type.Literal('unsupported'), Type.Literal('budget'), Type.Literal('deadline'), Type.Literal('invalid-input'),
  Type.Literal('unbounded-accuracy'), Type.Literal('response-limit')]);
export type GeometryFailure = Static<typeof reason>;
export const GeometryCapabilitySchema = Type.Union([
  Type.Object({ kind: Type.Literal('mesh'), closed: Type.Boolean(), representation: token,
    numericToleranceMetres: Type.Number({ minimum: 0, maximum: 1 }),
    sourceErrorMetres: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
    limitation: Type.String({ maxLength: 1024 }) }, exact),
  Type.Object({ kind: Type.Literal('unavailable'), reason, detail: Type.String({ maxLength: 1024 }) }, exact),
]);
export type GeometryCapability = Static<typeof GeometryCapabilitySchema>;
export const GeometryDescriptionSchema = Type.Object({ ref: GeometryRefSchema, name: Type.String({ maxLength: 256 }),
  class: token, role: Type.Union([Type.Literal('physical'), Type.Literal('context')]),
  frame: Type.Literal('project-engineering-metres'), sourceUnitsToMetres: Type.Number({ exclusiveMinimum: 0, maximum: 1e6 }),
  writeAuthority: Type.Union([Type.Literal('native-review'), Type.Literal('read-only')]),
  bounds: Type.Union([GeometryBoundsSchema, Type.Null()]), capability: GeometryCapabilitySchema,
  surfaceSamples: Type.Array(Type.Object({ point: GeometryPointSchema, normal: GeometryPointSchema,
    triangleAreaMetres2: Type.Number({ minimum: 0, maximum: 4e12 }), orientation: Type.Literal('mesh-winding') }, exact), { maxItems: 12 }),
  surfaceSamplesTruncated: Type.Boolean(),
}, exact);
export type GeometryDescription = Static<typeof GeometryDescriptionSchema>;
export const GeometryRelationSchema = Type.Object({ kind: Type.Union([Type.Literal('hosted-by'), Type.Literal('supported-by'),
  Type.Literal('level'), Type.Literal('space'), Type.Literal('containment'), Type.Literal('decomposition')]),
  target: GeometryRefSchema, basis: Type.Literal('declared') }, exact);
export type GeometryRelation = Static<typeof GeometryRelationSchema>;

export const GeometryProjectionSchema = Type.Union([Type.Literal('description'), Type.Literal('geometry'), Type.Literal('relations')]);
export type GeometryProjection = Static<typeof GeometryProjectionSchema>;
const objectRead = Type.Object({ kind: Type.Literal('object'), ref: GeometryRefSchema, projection: GeometryProjectionSchema, digest: hash }, exact);
const queryRead = Type.Object({ kind: Type.Literal('query'), query: GeometryQuerySchema, digest: hash,
  members: Type.Array(GeometryRefSchema, { maxItems: 4096 }), complete: Type.Boolean() }, exact);
const candidateRead = Type.Object({ kind: Type.Literal('candidate'), subject: GeometrySubjectSchema, digest: hash }, exact);
export const GeometryReadSchema = Type.Union([objectRead, queryRead, candidateRead]);
export type GeometryRead = Static<typeof GeometryReadSchema>;
export const GeometryReceiptSchema = Type.Object({ version: Type.Literal(1), projectId: token,
  reads: Type.Array(GeometryReadSchema, { maxItems: 128 }),
  operationDigest: hash, resultDigest: hash,
  status: Type.Union([Type.Literal('complete'), Type.Literal('partial'), Type.Literal('unavailable')]),
}, exact);
export type GeometryReceipt = Static<typeof GeometryReceiptSchema>;
export const GeometryReceiptsSchema = Type.Array(GeometryReceiptSchema, { maxItems: 128 });

export const GeometryMeasurementSchema = Type.Object({
  nearest: Type.Union([GeometryRefSchema, Type.Null()]),
  distanceMetres: Type.Union([Type.Number({ minimum: 0, maximum: 4e6 }), Type.Null()]),
  witness: Type.Union([Type.Object({ subject: GeometryPointSchema, obstacle: GeometryPointSchema }, exact), Type.Null()]),
  relation: Type.Union([Type.Literal('separated'), Type.Literal('subject-inside'), Type.Literal('obstacle-inside'),
    Type.Literal('volume-overlap'), Type.Literal('contact-or-overlap'), Type.Literal('unknown'), Type.Literal('empty-set')]),
  clearance: Type.Union([Type.Literal('satisfied-mesh'), Type.Literal('violated-mesh'), Type.Literal('unknown'), Type.Literal('not-requested')]),
  numericToleranceMetres: Type.Number({ minimum: 0, maximum: 1 }),
  sourceErrorMetres: Type.Union([Type.Number({ minimum: 0, maximum: 2 }), Type.Null()]),
  exactness: Type.Literal('prepared-representation'), testedObjects: Type.Integer({ minimum: 0, maximum: 4096 }),
}, exact);
export type GeometryMeasurement = Static<typeof GeometryMeasurementSchema>;

const failure = { reason, detail: Type.String({ maxLength: 1024 }) };
export const GeometryDescriptionResultSchema = Type.Union([
  Type.Object({ kind: Type.Literal('complete'), value: GeometryDescriptionSchema, receipt: GeometryReceiptSchema }, exact),
  Type.Object({ kind: Type.Literal('partial'), value: GeometryDescriptionSchema, receipt: GeometryReceiptSchema, ...failure }, exact),
  Type.Object({ kind: Type.Literal('unavailable'), receipt: GeometryReceiptSchema, ...failure }, exact),
]);
const queryPage = { items: Type.Array(GeometryDescriptionSchema, { maxItems: 32 }),
    nextCursor: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]), total: Type.Integer({ minimum: 0, maximum: 4096 }),
    uncertainMembers: Type.Integer({ minimum: 0, maximum: 4096 }), receipt: GeometryReceiptSchema };
export const GeometryQueryResultSchema = Type.Union([
  Type.Object({ kind: Type.Literal('complete'), ...queryPage }, exact),
  Type.Object({ kind: Type.Literal('partial'), ...queryPage }, exact),
  Type.Object({ kind: Type.Literal('unavailable'), receipt: GeometryReceiptSchema, ...failure }, exact),
]);
export const GeometryRelationsResultSchema = Type.Union([
  Type.Object({ kind: Type.Literal('complete'), items: Type.Array(GeometryRelationSchema, { maxItems: 128 }), receipt: GeometryReceiptSchema }, exact),
  Type.Object({ kind: Type.Literal('unavailable'), receipt: GeometryReceiptSchema, ...failure }, exact),
]);
export const GeometryMeasureResultSchema = Type.Union([
  Type.Object({ kind: Type.Literal('complete'), value: GeometryMeasurementSchema, receipt: GeometryReceiptSchema }, exact),
  Type.Object({ kind: Type.Literal('partial'), value: GeometryMeasurementSchema, receipt: GeometryReceiptSchema, ...failure }, exact),
  Type.Object({ kind: Type.Literal('unavailable'), receipt: GeometryReceiptSchema, ...failure }, exact),
]);
export type GeometryDescriptionResult = Static<typeof GeometryDescriptionResultSchema>;
export type GeometryQueryResult = Static<typeof GeometryQueryResultSchema>;
export type GeometryRelationsResult = Static<typeof GeometryRelationsResultSchema>;
export type GeometryMeasureResult = Static<typeof GeometryMeasureResultSchema>;

export function parseGeometryRef(input: unknown): GeometryRef {
  const value = geometryPlainData(input);
  if (!Check(GeometryRefSchema, value)) throw new Error('Invalid qualified geometry reference.');
  return value;
}
export function parseGeometryQuery(input: unknown): GeometryQuery {
  const value = geometryPlainData(input);
  if (!Check(GeometryQuerySchema, value)) throw new Error('Invalid bounded geometry query.');
  if (value.region) assertGeometryBounds(value.region);
  return value;
}
export function parseGeometryMeasureRequest(input: unknown): GeometryMeasureRequest {
  const value = geometryPlainData(input);
  if (!Check(GeometryMeasureRequestSchema, value)) throw new Error('Invalid bounded geometry measurement.');
  if (value.subject.kind === 'box') assertGeometryBounds(value.subject.bounds);
  if (value.operation === 'clearance' && value.clearanceMetres === undefined) throw new Error('Clearance requires a distance in metres.');
  if (value.against.kind === 'query') parseGeometryQuery(value.against.query);
  return value;
}
export function parseGeometryReceipts(input: unknown): GeometryReceipt[] {
  const value = geometryPlainData(input);
  if (!Check(GeometryReceiptsSchema, value)) throw new Error('Invalid bounded geometry receipts.');
  return value;
}
export function assertGeometryBounds(bounds: GeometryBounds): void {
  if (bounds.min.some((n, i) => !Number.isFinite(n) || !Number.isFinite(bounds.max[i]) || n > bounds.max[i])) {
    throw new Error('Geometry bounds must be ordered finite coordinates.');
  }
}

/** Bounded descriptor copy for wire data. Never evaluate getters, proxies from guests, sparse arrays or non-finite values. */
export function geometryPlainData(value: unknown): unknown {
  let nodes = 0;
  function copy(item: unknown, depth: number): unknown {
    if (++nodes > 100000 || depth > 20) throw new Error('Geometry wire data exceeds structural limits.');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return Object.is(item, -0) ? 0 : item;
    if (typeof item === 'string' && item.length <= 4096) return item;
    if (typeof item !== 'object' || item === null) throw new Error('Geometry requires finite plain JSON data.');
    const keys = Reflect.ownKeys(item);
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype || item.length > 4096 || keys.length !== item.length + 1) throw new Error('Geometry arrays must be dense and bounded.');
      return Array.from({ length: item.length }, (_, i) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Geometry accessors are forbidden.');
        return copy(descriptor.value, depth + 1);
      });
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(item)) || keys.length > 128) throw new Error('Geometry objects must be plain and bounded.');
    return Object.fromEntries(keys.map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Geometry accessors and symbols are forbidden.');
      return [key, copy(descriptor.value, depth + 1)];
    }));
  }
  const result = copy(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 2 * 1024 * 1024) throw new Error('Geometry wire data exceeds byte limits.');
  return result;
}
