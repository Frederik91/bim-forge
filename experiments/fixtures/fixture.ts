import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';

export const FixtureSchema = Type.Object({
  schemaVersion: Type.Literal(1), id: Type.String({ minLength: 1 }), units: Type.Literal('metres'),
  entities: Type.Array(Type.Object({ id: Type.String({ minLength: 1 }), kind: Type.String({ minLength: 1 }),
    properties: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])),
  }, { additionalProperties: false }), { minItems: 1 }),
  relationships: Type.Array(Type.Object({ id: Type.String({ minLength: 1 }), kind: Type.String({ minLength: 1 }), source: Type.String(), target: Type.String() }, { additionalProperties: false })),
}, { additionalProperties: false });
export type Fixture = Static<typeof FixtureSchema>;
export function parseFixture(input: unknown): Fixture {
  if (!Check(FixtureSchema, input)) throw new Error('Invalid qualification fixture.');
  const ids = new Set(input.entities.map(item => item.id));
  if (ids.size !== input.entities.length || new Set(input.relationships.map(item => item.id)).size !== input.relationships.length) throw new Error('Duplicate fixture identity.');
  const kinds = new Map(input.entities.map(item => [item.id, item.kind]));
  for (const relationship of input.relationships) {
    if (!ids.has(relationship.source) || !ids.has(relationship.target)) throw new Error('Dangling relationship.');
    if (relationship.kind === 'hostedBy' && kinds.get(relationship.target) !== 'wall') throw new Error('Opening host must be a wall.');
    if (relationship.kind === 'instanceOf' && kinds.get(relationship.target) !== 'type') throw new Error('Instance definition must be a type.');
  }
  return input;
}
