import { Type } from 'typebox';

const exact = { additionalProperties: false };
const entityId = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
const projectId = Type.String({ pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' });
const revisionId = Type.String({ pattern: '^[a-f0-9]{64}$' });

/** Wire schemas are independent of repository initialization and acceptance. */
export const WritableDesignTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('main') }, exact),
  Type.Object({ kind: Type.Literal('alternative'), id: entityId }, exact),
]);
export const DesignTargetSchema = Type.Union([
  ...WritableDesignTargetSchema.anyOf,
  Type.Object({ kind: Type.Literal('baseline'), id: entityId }, exact),
]);
export const FrozenDesignTargetSchema = Type.Object({ projectId,
  target: WritableDesignTargetSchema, revisionId }, exact);
