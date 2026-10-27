import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { parseObservations as parseSharedObservations } from '../contracts/schema.ts';
import type { Observation } from '../contracts/schema.ts';
export type { Observation } from '../contracts/schema.ts';

const id = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
const mm = Type.Integer({ minimum: -1000000, maximum: 1000000 });
const closed = { additionalProperties: false };
const attachment = Type.Union([
  Type.Object({ kind: Type.Literal('datum') }, closed),
  Type.Object({ kind: Type.Literal('unresolved'), reason: Type.String({ minLength: 1 }) }, closed),
]);
export const NodeSchema = Type.Union([
  Type.Object({ kind: Type.Literal('level'), id, elevationMm: mm }, closed),
  Type.Object({ kind: Type.Literal('hosted'), id, hostId: id, offsetMm: mm,
    ceilingMm: mm, attachment }, closed),
  Type.Object({ kind: Type.Literal('dimension'), id, fromId: id, toId: id }, closed),
]);
export const ModelSchema = Type.Object({
  nodes: Type.Array(NodeSchema, { minItems: 1, maxItems: 100 }),
  connectivity: Type.Array(Type.Tuple([id, id]), { maxItems: 200 }),
}, closed);
export type Model = Static<typeof ModelSchema>;
export type Node = Model['nodes'][number];

export function parseModel(value: unknown): Model {
  if (!Check(ModelSchema, value)) throw new Error('Invalid bounded EX-07 model input');
  return value;
}

export function parseObservations(value: unknown): Observation[] {
  const observations = parseSharedObservations(value);
  if (observations.length < 1 || observations.length > 100 || observations.some((entry) => entry.experimentId !== 'EX-07')) {
    throw new Error('Invalid bounded EX-07 observation array');
  }
  const ids = observations.map((entry) => entry.caseId);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate EX-07 case IDs');
  return observations;
}
