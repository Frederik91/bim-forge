import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';

const id = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
const ids = Type.Array(id, { maxItems: 100, uniqueItems: true });
const nonemptyIds = Type.Array(id, { minItems: 1, maxItems: 100, uniqueItems: true });
const number = Type.Number({ minimum: -1_000_000, maximum: 1_000_000 });
const exact = { additionalProperties: false };

export const ModelParameterValueSchema = Type.Union([
  Type.Object({ kind: Type.Literal('length'), value: number, unit: Type.Union([Type.Literal('m'), Type.Literal('mm')]) }, exact),
  Type.Object({ kind: Type.Literal('angle'), value: number, unit: Type.Literal('deg') }, exact),
  Type.Object({ kind: Type.Literal('duration'), value: number, unit: Type.Union([Type.Literal('s'), Type.Literal('min'), Type.Literal('h')]) }, exact),
  Type.Object({ kind: Type.Literal('number'), value: number }, exact),
  Type.Object({ kind: Type.Literal('text'), value: Type.String({ maxLength: 240 }) }, exact),
  Type.Object({ kind: Type.Literal('boolean'), value: Type.Boolean() }, exact),
]);
export const ModelParameterSchema = Type.Object({ definitionId: id, name: Type.String({ minLength: 1, maxLength: 80 }),
  value: ModelParameterValueSchema }, exact);
export const ModelParametersSchema = Type.Array(ModelParameterSchema, { maxItems: 24 });
export type ModelParameterValue = Static<typeof ModelParameterValueSchema>;
export type ModelParameter = Static<typeof ModelParameterSchema>;
export interface ParameterizedEntity { parameters?: ModelParameter[] }

const parameterKind = Type.Union([Type.Literal('length'), Type.Literal('angle'), Type.Literal('duration'),
  Type.Literal('number'), Type.Literal('text'), Type.Literal('boolean')]);
const operator = Type.Union([Type.Literal('eq'), Type.Literal('ne'), Type.Literal('lt'), Type.Literal('lte'), Type.Literal('gt'), Type.Literal('gte')]);
const bounds = Type.Object({ minX: number, minY: number, maxX: number, maxY: number }, exact);
export const ModelScopePredicateSchema = Type.Union([
  Type.Object({ kind: Type.Literal('all') }, exact),
  Type.Object({ kind: Type.Literal('ids'), ids: nonemptyIds }, exact),
  Type.Object({ kind: Type.Literal('in-spaces'), spaceIds: nonemptyIds }, exact),
  Type.Object({ kind: Type.Literal('on-levels'), levelIds: nonemptyIds }, exact),
  Type.Object({ kind: Type.Literal('entity-type'), entityType: Type.String({ minLength: 1, maxLength: 64 }) }, exact),
  Type.Object({ kind: Type.Literal('furniture-kind'), furnitureKind: Type.String({ minLength: 1, maxLength: 64 }) }, exact),
  Type.Object({ kind: Type.Literal('asset-family'), familyId: id }, exact),
  Type.Object({ kind: Type.Literal('parameter-exists'), definitionId: id }, exact),
  Type.Object({ kind: Type.Literal('parameter-kind'), valueKind: parameterKind }, exact),
  Type.Object({ kind: Type.Literal('parameter-compare'), definitionId: id, operator, value: ModelParameterValueSchema }, exact),
  Type.Object({ kind: Type.Literal('bounds'), bounds, levelIds: ids,
    mode: Type.Union([Type.Literal('intersects'), Type.Literal('contained')]) }, exact),
  Type.Object({ kind: Type.Literal('related'), fromIds: nonemptyIds,
    relation: Type.Union([Type.Literal('hosted-by'), Type.Literal('supported-by'), Type.Literal('instance-of'), Type.Literal('contained-in')]),
    direction: Type.Union([Type.Literal('outgoing'), Type.Literal('incoming'), Type.Literal('either')]), depth: Type.Integer({ minimum: 1, maximum: 8 }) }, exact),
]);
/** All clauses must match; anyOf is an optional disjunction, then exclusions apply. */
export const ModelScopeQuerySchema = Type.Object({ version: Type.Literal(1),
  allOf: Type.Array(ModelScopePredicateSchema, { maxItems: 16 }),
  anyOf: Type.Array(ModelScopePredicateSchema, { maxItems: 16 }), excludeIds: ids }, exact);
export type ModelScopePredicate = Static<typeof ModelScopePredicateSchema>;
export type ModelScopeQuery = Static<typeof ModelScopeQuerySchema>;

/** Base revision pins the exact immutable bodies; membership never expands after review. */
export const FrozenModelScopeSchema = Type.Object({ version: Type.Literal(1),
  baseRevisionId: Type.String({ pattern: '^[a-f0-9]{64}$' }), query: ModelScopeQuerySchema,
  targetIds: ids, contextIds: ids, dependentIds: ids, writableIds: ids, relationshipIds: ids }, exact);
export type FrozenModelScope = Static<typeof FrozenModelScopeSchema>;

export const ScopedRequestSchema = Type.Object({ query: ModelScopeQuerySchema,
  savedScopeId: Type.Optional(id) }, exact);
export type ScopedRequest = Static<typeof ScopedRequestSchema>;
export const SavedModelScopeSchema = Type.Object({ id, name: Type.String({ minLength: 1, maxLength: 80 }),
  version: Type.String({ pattern: '^[a-f0-9]{64}$' }), query: ModelScopeQuerySchema,
  recordedAt: Type.Integer({ minimum: 0 }) }, exact);
export type SavedModelScope = Static<typeof SavedModelScopeSchema>;

export function parseModelScopeQuery(value: unknown): ModelScopeQuery {
  if (!Check(ModelScopeQuerySchema, value) || value.allOf.length + value.anyOf.length === 0) {
    throw new Error('A model scope requires bounded exact filters and an explicit selection.');
  }
  for (const predicate of [...value.allOf, ...value.anyOf]) {
    if (predicate.kind === 'bounds' && (predicate.bounds.minX >= predicate.bounds.maxX || predicate.bounds.minY >= predicate.bounds.maxY)) {
      throw new Error('Scope bounds must have positive area.');
    }
  }
  return structuredClone(value);
}

export function parseScopedRequest(value: unknown): ScopedRequest {
  if (!Check(ScopedRequestSchema, value)) throw new Error('Invalid scoped request.');
  return { ...value, query: parseModelScopeQuery(value.query) };
}

export function parseFrozenModelScope(value: unknown): FrozenModelScope {
  if (!Check(FrozenModelScopeSchema, value)) throw new Error('Invalid frozen model scope.');
  return { ...structuredClone(value), query: parseModelScopeQuery(value.query) };
}
