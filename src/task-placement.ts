import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { GeometryRefSchema, geometryPlainData } from './geometry-contract.ts';
import { WritableDesignTargetSchema } from './design-target-contract.ts';
import { MarkupPointSchema, SpatialMarkupSchema, parseSpatialMarkup } from './spatial-markup.ts';

const exact = { additionalProperties: false };
const id = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' });
const snapshot = Type.Object({ projectId: id, target: WritableDesignTargetSchema,
  revisionId: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, exact);
export const TaskOriginSchema = Type.Object({ snapshot, frame: Type.Literal('project-engineering-metres'),
  point: MarkupPointSchema, source: Type.Optional(GeometryRefSchema),
  view: Type.Union([Type.Literal('2d'), Type.Literal('3d')]), levelId: Type.Union([id, Type.Null()]) }, exact);
export const TaskTargetsSchema = Type.Object({ objects: Type.Array(GeometryRefSchema, { maxItems: 100 }),
  regions: Type.Array(Type.Object({ snapshot, source: Type.Optional(GeometryRefSchema), markup: SpatialMarkupSchema }, exact), { maxItems: 16 }) }, exact);
export const PlacedTaskSchema = Type.Object({ version: Type.Literal(1), kind: Type.Literal('placed'),
  origin: TaskOriginSchema, targets: TaskTargetsSchema }, exact);
export const TaskPlacementSchema = Type.Union([PlacedTaskSchema,
  Type.Object({ version: Type.Literal(1), kind: Type.Literal('unplaced'),
    reason: Type.Union([Type.Literal('legacy'), Type.Literal('not-provided')]) }, exact)]);
export type TaskPlacement = Static<typeof TaskPlacementSchema>;
export type PlacedTask = Static<typeof PlacedTaskSchema>;
export type TaskOrigin = Static<typeof TaskOriginSchema>;
export const TaskPlacementRecoveryCommandSchema = Type.Object({ recoveryId: id,
  expectedSequence: Type.Integer({ minimum: 0 }), placement: PlacedTaskSchema }, exact);
export const TaskPlacementRecoverySchema = Type.Object({ ...TaskPlacementRecoveryCommandSchema.properties,
  at: Type.Integer({ minimum: 0 }) }, exact);
export const TaskPlacementRecoveriesSchema = Type.Array(TaskPlacementRecoverySchema, { maxItems: 8 });
export type TaskPlacementRecovery = Static<typeof TaskPlacementRecoverySchema>;

export function parseTaskPlacement(input: unknown): TaskPlacement {
  const value = geometryPlainData(input);
  if (!Check(TaskPlacementSchema, value)) throw new Error('Invalid task placement. Use a pinned origin in project-engineering-metres and explicit object/region targets.');
  if (value.kind === 'placed') {
    value.targets.regions.forEach(region => parseSpatialMarkup(region.markup));
    const identities = value.targets.objects.map(ref => JSON.stringify(ref.kind === 'native'
      ? [ref.kind, ref.projectId, ref.target.kind, 'id' in ref.target ? ref.target.id : null, ref.revisionId, ref.entityId]
      : [ref.kind, ref.projectId, ref.namespace, ref.revision, ref.originalSha256, ref.occurrenceId, ref.globalId, ref.placementDigest]));
    if (new Set(identities).size !== identities.length) throw new Error('Task object targets must be unique.');
  }
  return value;
}
export function parseTaskPlacementRecoveryCommand(input: unknown): Static<typeof TaskPlacementRecoveryCommandSchema> {
  const value = geometryPlainData(input);
  if (!Check(TaskPlacementRecoveryCommandSchema, value)) throw new Error('Invalid explicit placement recovery.');
  parseTaskPlacement(value.placement);
  return value;
}
export function parseTaskPlacementRecoveries(input: unknown): TaskPlacementRecovery[] {
  const value = geometryPlainData(input);
  if (!Check(TaskPlacementRecoveriesSchema, value)) throw new Error('Invalid task placement recovery history.');
  value.forEach(recovery => parseTaskPlacement(recovery.placement));
  if (new Set(value.map(recovery => recovery.recoveryId)).size !== value.length) throw new Error('Duplicate placement recovery identity.');
  return value;
}
