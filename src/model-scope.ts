import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { ModelParametersSchema } from './model-scope-contract.ts';

const id = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
const entityType = Type.Union([
  Type.Literal('Wall'), Type.Literal('Door'), Type.Literal('Window'), Type.Literal('Equipment'),
  Type.Literal('Furniture'), Type.Literal('Level'), Type.Literal('Space'), Type.Literal('Slab'),
  Type.Literal('Stair'), Type.Literal('Roof'), Type.Literal('AssetFamily'), Type.Literal('AssetInstance'),
]);
const furnitureKind = Type.Union([
  Type.Literal('desk'), Type.Literal('monitor'), Type.Literal('laptop'), Type.Literal('chair'),
  Type.Literal('table'), Type.Literal('plant'), Type.Literal('bed'), Type.Literal('sofa'), Type.Literal('cabinet'),
]);
const boundsSchema = Type.Object({ minX: Type.Number(), minY: Type.Number(), maxX: Type.Number(), maxY: Type.Number() }, { additionalProperties: false });
const relation = Type.Union([Type.Literal('hosted-by'), Type.Literal('supported-by'), Type.Literal('instance-of'), Type.Literal('contained-in')]);
export const ModelScopeIndexEntitySchema = Type.Object({
  id, type: entityType, furnitureKind: Type.Union([furnitureKind, Type.Null()]),
  levelIds: Type.Array(id, { uniqueItems: true }), spaceIds: Type.Array(id, { uniqueItems: true }),
  familyId: Type.Union([id, Type.Null()]), bounds: Type.Union([boundsSchema, Type.Null()]), parameters: ModelParametersSchema,
}, { additionalProperties: false });
export const ModelScopeIndexEdgeSchema = Type.Object({
  id: Type.Union([id, Type.Null()]), relation, source: id, target: id,
}, { additionalProperties: false });
/** Derived search data only: no immutable entity bodies, geometry recipes or source stubs. */
export const ModelScopeIndexSchema = Type.Object({ version: Type.Literal(1),
  entities: Type.Array(ModelScopeIndexEntitySchema, { maxItems: 100_000 }),
  edges: Type.Array(ModelScopeIndexEdgeSchema, { maxItems: 1_000_000 }),
}, { additionalProperties: false });
export type ModelScopeIndexEntity = Static<typeof ModelScopeIndexEntitySchema>;
export type ModelScopeIndexEdge = Static<typeof ModelScopeIndexEdgeSchema>;
export type ModelScopeIndex = Static<typeof ModelScopeIndexSchema>;

export function parseModelScopeIndex(value: unknown): ModelScopeIndex {
  if (!Check(ModelScopeIndexSchema, value)) throw new Error('Invalid compact model scope index.');
  return structuredClone(value);
}
