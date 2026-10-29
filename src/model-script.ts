import { createApiKit, createRuntime, DocsTree, ScriptApiError, Type } from '@frederik91/scriptbox';
import type { ExecutionEvent, ExecutionLimits, ExecutionOutcome, JsonValue, ScriptBoxRuntime } from '@frederik91/scriptbox';
import { spaces, floorBounds, clearSpaceBounds, doorConnections, entitySpace } from './floor-plan.ts';
import {
  diffSnapshots, FURNITURE_KINDS, previewFurnishings, previewRectangle, previewRoomFurnishings,
  rectangleLayout, validateSnapshot, previewAssets,
} from './room-model.ts';
import type { EntityId, ModelDelta, ModelSnapshot, ModelGraph } from './room-model.ts';
import type { VisualRequest } from './visual-request.ts';
import type { ActivityUpdate } from './request-activity.ts';
import { parseScriptExecutionEvidence, MAX_SCRIPT_HOST_CALLS } from './script-evidence.ts';
import type { ScriptExecutionEvidence } from './script-evidence.ts';
import { MODEL_INTENT_GUIDANCE, parseIntentAssessment } from './model-intent.ts';
import type { IntentAssessment } from './model-intent.ts';
import { previewFloor } from './floor-layout.ts';
import { previewBuilding } from './building-layout.ts';
import { FloorLayoutSchema, BuildingLayoutSchema } from './building-schema.ts';
import { levels, entityLevel, entityElevation, levelView } from './building-levels.ts';
import { AssetFamilySchema, AssetInstanceSchema, AssetEditSchema } from './asset-family.ts';
import type { AuthoringScope } from './request-sources.ts';
import { ModelParametersSchema, ModelParameterSchema } from './model-scope-contract.ts';
import { parseClarification } from './request-conversation.ts';
import type { Clarification } from './request-conversation.ts';
import type { FrozenModelScope } from './model-scope-contract.ts';
import { assertModelScopeFresh, assertModelScopeWrites } from './model-scope.ts';
import { applyModelParameterEdits, modelParameters } from './model-parameters.ts';
import { previewWallShift } from './wall-dependencies.ts';
import type { WallShiftImpact } from './wall-dependencies.ts';
import { previewRoomDimensionChange } from './room-dimension-preview.ts';
import { parseEvidenceUses } from './model-evidence.ts';
import type { EvidenceUse } from './model-evidence.ts';
import { GEOMETRY_SCRIPT_METHODS, GEOMETRY_SCRIPT_CAPABILITIES, GEOMETRY_SCRIPT_GUIDANCE } from './geometry-evidence-api.ts';
import type { GeometryEvidenceSession } from './geometry-evidence.ts';

const identifier = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
const name = Type.String({ minLength: 1, maxLength: 80 });
const point = Type.Array(Type.Number(), { minItems: 2, maxItems: 2 });
const bounds = Type.Object({ minX: Type.Number(), minY: Type.Number(), maxX: Type.Number(), maxY: Type.Number() });
const boundsMm = Type.Object({ minX: Type.Integer(), minY: Type.Integer(), maxX: Type.Integer(), maxY: Type.Integer() });
const layout = Type.Object({ boundsMm, door: Type.Object({ widthMm: Type.Integer(), offsetMm: Type.Integer() }) });
const rotation = Type.Union([Type.Literal(0), Type.Literal(90), Type.Literal(180), Type.Literal(270)]);
const furniture = Type.Object({
  id: identifier, type: Type.Literal('Furniture'), name,
  kind: Type.Enum(FURNITURE_KINDS), position: point,
  width: Type.Number({ minimum: .05, maximum: 5 }), depth: Type.Number({ minimum: .05, maximum: 5 }),
  height: Type.Number({ minimum: .02, maximum: 3 }), rotationDeg: rotation, supportId: Type.Union([identifier, Type.Null()]),
});
const furnishingSet = Type.Object({ furnishings: Type.Array(furniture, { maxItems: 32 }),
  levelAssignments: Type.Optional(Type.Array(Type.Object({ entityId: identifier, levelId: identifier }, { additionalProperties: false }), { maxItems: 32 })) });
const roomFurnishingSet = Type.Object({ roomId: identifier, furnishings: Type.Array(furniture, { maxItems: 32 }) });
const space = Type.Object({ id: identifier, type: Type.Literal('Space'), name, levelId: identifier, bounds });
const door = Type.Object({ id: identifier, type: Type.Literal('Door'), name, width: Type.Number(), height: Type.Number() });
const wall = Type.Object({ id: identifier, type: Type.Literal('Wall'), name, start: point, end: point, thickness: Type.Number(), height: Type.Number() });
const equipment = Type.Object({ id: identifier, type: Type.Literal('Equipment'), name, category: Type.Union([Type.Literal('mechanical'), Type.Literal('electrical')]),
  position: point, elevation: Type.Number(), width: Type.Number(), depth: Type.Number(), height: Type.Number() });
const window = Type.Object({ id: identifier, type: Type.Literal('Window'), name, width: Type.Number(), height: Type.Number(), sillHeight: Type.Number() });
const relationships = Type.Array(Type.Object({
  id: identifier, type: Type.Literal('hosted-by'), source: identifier, target: identifier, offset: Type.Number(),
}), { maxItems: 100 });
// Read contract only: core validation enforces required V2 ownership before staging/persistence.
const parameterFields = { parameters: Type.Optional(ModelParametersSchema) };
const entity = Type.Union([
  Type.Object({ ...wall.properties, ...parameterFields, levelId: Type.Optional(identifier) }),
  Type.Object({ ...equipment.properties, ...parameterFields, levelId: Type.Optional(identifier) }),
  Type.Object({ ...furniture.properties, ...parameterFields, levelId: Type.Optional(identifier) }),
  Type.Object({ ...door.properties, ...parameterFields }), Type.Object({ ...window.properties, ...parameterFields }), Type.Object({ ...space.properties, ...parameterFields }),
  Type.Object({ ...parameterFields, id: identifier, type: Type.Literal('Level'), name, elevation: Type.Number() }),
  Type.Object({ ...parameterFields, id: identifier, type: Type.Literal('Slab'), name, levelId: identifier, bounds, thickness: Type.Number() }),
  Type.Object({ ...parameterFields, id: identifier, type: Type.Literal('Stair'), name, fromLevelId: identifier, toLevelId: identifier,
    start: point, end: point, width: Type.Number(), steps: Type.Integer() }),
  Type.Object({ ...parameterFields, id: identifier, type: Type.Literal('Roof'), name, levelId: identifier, bounds, thickness: Type.Number(), profile: Type.Union([
    Type.Object({ kind: Type.Literal('flat'), height: Type.Number() }),
    Type.Object({ kind: Type.Literal('gable'), eaveHeight: Type.Number(), ridgeHeight: Type.Number(), ridgeAxis: Type.Union([Type.Literal('x'), Type.Literal('y')]) }),
  ]) }),
  Type.Object({ ...AssetFamilySchema.properties, ...parameterFields }), Type.Object({ ...AssetInstanceSchema.properties, ...parameterFields }),
], { title: 'ModelEntity' });
const snapshot = Type.Object({ version: Type.Optional(Type.Literal(2)), units: Type.Literal('m'),
  entities: Type.Array(entity, { maxItems: 100 }), relationships }, { title: 'ModelSnapshot', additionalProperties: false });
// The guest only reads this host-validated query. ScriptBox's closed read schema
// cannot express the wire schema's uniqueItems constraint; no authority is parsed here.
const scopeReadIds = Type.Array(identifier, { maxItems: 100 });
const scopeRead = Type.Object({ version: Type.Literal(1), baseRevisionId: Type.String(), query: Type.Unknown(),
  targetIds: scopeReadIds, contextIds: scopeReadIds, dependentIds: scopeReadIds, writableIds: scopeReadIds, relationshipIds: scopeReadIds });
const collectionChanges = Type.Object({ added: Type.Array(identifier), removed: Type.Array(identifier), modified: Type.Array(identifier) });
const changes = Type.Object({ entities: collectionChanges, relationships: collectionChanges });
const wallShiftImpacts = Type.Array(Type.Object({
  kind: Type.Union([Type.Literal('entity'), Type.Literal('relationship')]), id: identifier,
  reasons: Type.Array(Type.Union([
    Type.Literal('target-translation'), Type.Literal('room-boundary'), Type.Literal('wall-junction'),
    Type.Literal('hosted-opening'), Type.Literal('opening-host'), Type.Literal('room-contents'),
    Type.Literal('support'), Type.Literal('level-envelope'),
  ]), { maxItems: 8 }), changed: Type.Boolean(),
}, { additionalProperties: false }), { maxItems: 200 });
const dimensionAxis = Type.Union([Type.Literal('x'), Type.Literal('y')]);
const sourceRef = Type.String({ minLength: 1, maxLength: 256 });
const confirmedDimension = Type.Object({ kind: Type.Literal('confirmed'),
  metres: Type.Number({ minimum: .001, maximum: 1000 }), sourceRef }, { additionalProperties: false });
const unresolvedDimension = Type.Object({ kind: Type.Literal('unresolved'),
  reason: Type.Union([Type.Literal('unknown-scale'), Type.Literal('ambiguous-dimension'), Type.Literal('contradictory-evidence')]),
  sourceRefs: Type.Array(sourceRef, { minItems: 1, maxItems: 24 }) }, { additionalProperties: false });
const minimumClearSpan = { roomId: identifier, axis: dimensionAxis, metres: Type.Number({ minimum: .001, maximum: 1000 }) };
const roomDimensionRequest = Type.Object({ roomId: identifier, wallId: identifier, axis: dimensionAxis,
  measurement: Type.Union([confirmedDimension, unresolvedDimension]),
  minimumClearSpans: Type.Array(Type.Object(minimumClearSpan, { additionalProperties: false }), { maxItems: 24 }) }, { additionalProperties: false });
const dimensionSpans = Type.Object({ x: Type.Number(), y: Type.Number() }, { additionalProperties: false });
const evaluatedRoomDimension = Type.Object({ bounds, centrelineSpans: dimensionSpans, clearSpans: dimensionSpans }, { additionalProperties: false });
const evaluatedDimensionOpening = Type.Object({ hostId: identifier, start: point, end: point }, { additionalProperties: false });
const dimensionDependency = { id: identifier, storedChanged: Type.Boolean(), evaluatedChanged: Type.Boolean() };
const roomDimensionResult = Type.Union([
  Type.Object({ status: Type.Literal('unresolved'), measurement: unresolvedDimension }, { additionalProperties: false }),
  Type.Object({ status: Type.Literal('ready'), model: snapshot, changes, impacts: wallShiftImpacts,
    offsetMetres: Type.Number(), measurement: confirmedDimension,
    clearSpanChecks: Type.Array(Type.Object({ ...minimumClearSpan, beforeMetres: Type.Number(), afterMetres: Type.Number() }, { additionalProperties: false }), { maxItems: 24 }),
    dependencies: Type.Array(Type.Union([
      Type.Object({ ...dimensionDependency, kind: Type.Literal('room'), before: evaluatedRoomDimension, after: evaluatedRoomDimension }, { additionalProperties: false }),
      Type.Object({ ...dimensionDependency, kind: Type.Literal('opening'), before: evaluatedDimensionOpening, after: evaluatedDimensionOpening }, { additionalProperties: false }),
    ], { title: 'RoomDimensionDependency' }), { maxItems: 100 }),
  }, { additionalProperties: false }),
]);
const inspection = Type.Object({
  revisionId: Type.String(), selectedObjectIds: Type.Array(identifier), model: snapshot,
  parameters: Type.Array(Type.Object({ entityId: identifier, parameters: Type.Array(ModelParameterSchema, { maxItems: 32 }) }), { maxItems: 100 }),
  placement: Type.Object({
    levels: Type.Array(Type.Object({ id: identifier, type: Type.Literal('Level'), name, elevation: Type.Number() })),
    selectedLevelId: Type.Union([identifier, Type.Null()]),
    entities: Type.Array(Type.Object({ entityId: identifier, levelId: Type.Union([identifier, Type.Null()]), elevation: Type.Number() })),
    assetFamilies: Type.Array(Type.Object({ familyId: identifier, instanceIds: Type.Array(identifier, { maxItems: 32 }) }), { maxItems: 8 }),
    assetInstances: Type.Array(Type.Object({ entityId: identifier, familyId: identifier,
      roomId: Type.Union([identifier, Type.Null()]), levelId: Type.Union([identifier, Type.Null()]), elevation: Type.Number() }), { maxItems: 32 }),
    layout: Type.Union([layout, Type.Null()]), floorBounds: Type.Union([bounds, Type.Null()]),
    rooms: Type.Array(Type.Object({ ...space.properties, clearBounds: bounds, entityIds: Type.Array(identifier) })),
    doorConnections: Type.Array(Type.Object({ door, roomIds: Type.Array(identifier), exterior: Type.Boolean() })),
    coordinates: Type.String(), suggestedDimensions: Type.Object({ desk: Type.Array(Type.Number()), monitor: Type.Array(Type.Number()),
      laptop: Type.Array(Type.Number()), chair: Type.Array(Type.Number()), table: Type.Array(Type.Number()), plant: Type.Array(Type.Number()) }),
  }),
});

export interface ModelScriptBinding {
  baseRevisionId: string;
  selectedObjectIds: readonly EntityId[];
  visualIntent: VisualRequest;
  authoringScope?: AuthoringScope;
  scope?: FrozenModelScope;
}
export interface ScriptReviewText {
  summary: string; rationale: string; constraints: string; uncertainty: string; intent: IntentAssessment;
  evidenceUses?: EvidenceUse[];
}
export const MODEL_REVIEW_TEXT_CONTRACT = Object.freeze({
  maximumLengths: Object.freeze({ summary: 240, rationale: 800, constraints: 600, uncertainty: 400 }),
  forbiddenControls: '[\\u0000-\\u001f]',
  forbiddenControlsDescription: 'control characters U+0000-U+001F (including newlines and tabs)',
});
export const MODEL_REVIEW_TEXT_GUIDANCE = 'Each proposal review text field must be a nonempty string with non-whitespace content. ' +
  Object.entries(MODEL_REVIEW_TEXT_CONTRACT.maximumLengths).map(([field, maximum]) => `review.${field}: 1-${maximum} characters`).join('; ') + '. ' +
  `Use single-line text with no ${MODEL_REVIEW_TEXT_CONTRACT.forbiddenControlsDescription}. ` +
  'Limits count JavaScript string.length (UTF-16 code units) on the supplied string before trimming. ' +
  'If invalid-proposal names a review field, repair that field and replay the complete proposed operations. Do not silently truncate review facts or change geometry just to repair review text.';
const reviewTextControls = new RegExp(MODEL_REVIEW_TEXT_CONTRACT.forbiddenControls);
export interface ScriptDiagnostic { code: string; message: string; line: number | null; column: number | null }
export type ModelScriptResult =
  | { kind: 'observation'; observation: JsonValue; evidence: ScriptExecutionEvidence }
  | { kind: 'proposal'; snapshot: ModelSnapshot; review: ScriptReviewText; evidence: ScriptExecutionEvidence }
  | { kind: 'declined'; reason: string; uncertainty: string; clarification?: Clarification; intent?: IntentAssessment; evidence: ScriptExecutionEvidence }
  | { kind: 'failed'; diagnostic: ScriptDiagnostic; evidence: ScriptExecutionEvidence };

interface Draft {
  geometry?: GeometryEvidenceSession;
  readonly base: ModelSnapshot;
  snapshot: ModelSnapshot;
  binding: ModelScriptBinding;
  signal: AbortSignal;
  onActivity: (event: ActivityUpdate) => void;
  onPreview?: (snapshot: ModelSnapshot | null) => void;
}
interface RunInput {
  geometry?: GeometryEvidenceSession;
  base: ModelSnapshot;
  initialDraft?: ModelSnapshot;
  binding: ModelScriptBinding;
  source: string;
  language: 'javascript' | 'typescript';
  signal: AbortSignal;
  remainingHostCalls: number;
  onActivity: (event: ActivityUpdate) => void;
  onPreview?: (snapshot: ModelSnapshot | null) => void;
}

export function summarizeModelDelta(delta: ModelDelta) {
  const ids = <T extends { id: EntityId }>(value: { added: T[]; removed: T[]; modified: { id: EntityId }[] }) => ({
    added: value.added.map((item) => item.id), removed: value.removed.map((item) => item.id), modified: value.modified.map((item) => item.id),
  });
  return { entities: ids(delta.entities), relationships: ids(delta.relationships) };
}

function publicMessage(value: string): string { return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 240) || 'Model script failed.'; }
function auditMethod(value: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(value)) return value.slice(0, 256);
  // Rejected names are hostile data too. Keep their escaped identity without permitting controls or unbounded UTF-8 bytes.
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).slice(0, 256);
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fields(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) throw new Error('Unexpected script decision fields.');
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) throw new Error(`Review text requires 1 to ${maximum} readable characters.`);
  return value.trim();
}
function reviewText(value: unknown, field: keyof typeof MODEL_REVIEW_TEXT_CONTRACT.maximumLengths): string {
  const maximum = MODEL_REVIEW_TEXT_CONTRACT.maximumLengths[field];
  const label = `review.${field}`;
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a nonempty string (1-${maximum} characters); received ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}.`);
  }
  if (reviewTextControls.test(value)) {
    throw new Error(`${label} contains forbidden ${MODEL_REVIEW_TEXT_CONTRACT.forbiddenControlsDescription}; use a single line. Received length ${value.length}; maximum ${maximum}.`);
  }
  if (!value.trim()) throw new Error(`${label} must be a nonempty string (1-${maximum} characters); received an empty or whitespace-only string (length ${value.length}).`);
  if (value.length > maximum) throw new Error(`${label} length ${value.length} exceeds maximum ${maximum}; shorten this field to 1-${maximum} characters on a single line.`);
  return value.trim();
}
function decision(value: unknown):
  | { kind: 'observe'; observation: JsonValue }
  | { kind: 'propose'; review: ScriptReviewText }
  | { kind: 'clarify'; clarification: Clarification }
  | { kind: 'decline'; reason: string; uncertainty: string; intent?: IntentAssessment } {
  if (!record(value)) throw new Error('Return an observe, propose or decline decision.');
  if (value.kind === 'observe') {
    fields(value, ['kind', 'observation']);
    // The returned value already passed ScriptBox's JSON boundary.
    return { kind: 'observe', observation: jsonValue(value.observation) };
  }
  if (value.kind === 'propose') {
    fields(value, ['kind', 'review']);
    const hasEvidenceUses = record(value.review) && Object.hasOwn(value.review, 'evidenceUses');
    fields(value.review, ['summary', 'rationale', 'constraints', 'uncertainty', 'intent', ...(hasEvidenceUses ? ['evidenceUses'] : [])]);
    return { kind: 'propose', review: { summary: reviewText(value.review.summary, 'summary'), rationale: reviewText(value.review.rationale, 'rationale'),
      constraints: reviewText(value.review.constraints, 'constraints'), uncertainty: reviewText(value.review.uncertainty, 'uncertainty'),
      intent: parseIntentAssessment(value.review.intent),
      ...(hasEvidenceUses ? { evidenceUses: parseEvidenceUses(value.review.evidenceUses) } : {}) } };
  }
  if (value.kind === 'clarify') {
    fields(value, ['kind', 'question', 'options']);
    return { kind: 'clarify', clarification: parseClarification({ question: value.question, options: value.options }) };
  }
  if (value.kind === 'decline') {
    const hasIntent = Object.hasOwn(value, 'intent');
    fields(value, ['kind', 'reason', 'uncertainty', ...(hasIntent ? ['intent'] : [])]);
    return { kind: 'decline', reason: text(value.reason, 800), uncertainty: text(value.uncertainty, 400),
      ...(hasIntent ? { intent: parseIntentAssessment(value.intent) } : {}) };
  }
  throw new Error('Return {kind:"observe",observation}, {kind:"propose",review} or {kind:"decline",reason,uncertainty}.');
}
function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  throw new Error('Invalid observation value.');
}

/** A live read projection; never validated or persisted as a complete project. */
export function modelWorkingGraph(graph: ModelGraph, scope?: FrozenModelScope): Omit<ModelGraph, 'entities' | 'relationships'> & {
  entities: ModelGraph['entities'][number][]; relationships: ModelGraph['relationships'][number][];
} {
  if (!scope) return { ...graph, entities: [...graph.entities], relationships: [...graph.relationships] };
  const ids = new Set([...scope.targetIds, ...scope.contextIds, ...scope.dependentIds, ...scope.writableIds]);
  // New variant definitions are derived resources of writable occurrences, never extra targets.
  for (const entity of graph.entities) if (entity.type === 'AssetInstance' && scope.writableIds.includes(entity.id)) ids.add(entity.familyId);
  const links = new Set(scope.relationshipIds);
  return { ...(graph.version === 2 ? { version: 2 } : {}), units: graph.units,
    entities: graph.entities.filter(item => ids.has(item.id)),
    relationships: graph.relationships.filter(link => links.has(link.id) && ids.has(link.source) && ids.has(link.target)) };
}

function stage(draft: Draft, operation: () => ModelSnapshot, revoked: () => void) {
  draft.onActivity({ stage: 'validating', message: 'Testing a scripted model change against the model and placement validators.' });
  let candidate: ModelSnapshot;
  try {
    candidate = validateSnapshot(operation());
    if (draft.binding.scope) assertModelScopeWrites({ before: draft.base, after: candidate, binding: draft.binding.scope });
  }
  catch (error) {
    draft.onActivity({ stage: 'validation-failed', message: 'A scripted change failed model validation. Its draft is unchanged; the script can correct it.' });
    throw new ScriptApiError({ name: 'ModelValidationError', message: publicMessage(error instanceof Error ? error.message : 'Invalid model change.') });
  }
  revoked(); draft.signal.throwIfAborted();
  draft.snapshot = candidate;
  draft.onActivity({ stage: 'validated', message: 'Scripted change passed deterministic validation. Accepted model remains unchanged.' });
  revoked(); draft.signal.throwIfAborted();
  draft.onPreview?.(candidate);
  return { model: modelWorkingGraph(candidate, draft.binding.scope), changes: summarizeModelDelta(diffSnapshots(draft.base, candidate)) };
}

function selectedLevel(current: ModelGraph, binding: ModelScriptBinding) {
  const selected = current.entities.filter((item) => binding.selectedObjectIds.includes(item.id));
  const explicit = selected.filter((item) => item.type === 'Level');
  if (explicit.length) return explicit.length === 1 ? explicit[0] : null;
  const visual = binding.visualIntent;
  if (visual.kind === 'spatial-reference') {
    const target = visual.destination;
    if (target.kind === 'floor-point' && 'levelId' in target && typeof target.levelId === 'string') {
      return levels(current).find((level) => level.id === target.levelId) ?? null;
    }
    if (target.kind === 'wall-point') return entityLevel(current, target.wallId);
  }
  const owners = new Map(selected.flatMap((item) => {
    const level = entityLevel(current, item);
    return level ? [[level.id, level] as const] : [];
  }));
  if (owners.size) return owners.size === 1 ? owners.values().next().value ?? null : null;
  const available = levels(current);
  return available.length === 1 ? available[0] : null;
}

const api = createApiKit<Draft>();
async function geometryRead<T>(draft: Draft, revoked: () => void, read: (session: GeometryEvidenceSession) => Promise<T>): Promise<T> {
  revoked(); draft.signal.throwIfAborted();
  if (!draft.geometry) throw new Error('No authorized geometry context is bound to this request.');
  draft.onActivity({ stage: 'inspecting', message: 'Reading source-bound geometry through the unified geometry tools.' });
  const value = await read(draft.geometry);
  revoked(); draft.signal.throwIfAborted();
  return value;
}
const geometry = api.namespace({ name: 'geometry', description: GEOMETRY_SCRIPT_GUIDANCE, methods: {
  describe: api.method({ ...GEOMETRY_SCRIPT_METHODS.describe, effect: 'read',
    handler: ({ input }, call) => geometryRead(call.context, () => call.throwIfRevoked(), session => session.describe(input)) }),
  query: api.method({ ...GEOMETRY_SCRIPT_METHODS.query, effect: 'read',
    handler: ({ input }, call) => geometryRead(call.context, () => call.throwIfRevoked(), session => session.query(input)) }),
  relations: api.method({ ...GEOMETRY_SCRIPT_METHODS.relations, effect: 'read',
    handler: ({ input }, call) => geometryRead(call.context, () => call.throwIfRevoked(), session => session.relations(input)) }),
  measure: api.method({ ...GEOMETRY_SCRIPT_METHODS.measure, effect: 'read',
    handler: ({ input }, call) => geometryRead(call.context, () => call.throwIfRevoked(), session => session.measure(input)) }),
} });
const model = api.namespace({ name: 'model', description: 'Read a bound model and stage validated changes in this script only. Nothing here accepts or saves a project.', methods: {
  scope: api.method({ summary: 'Read the frozen request scope and live working graph. Context is read-only; this graph is not a complete project.',
    effect: 'read', result: Type.Object({ scope: Type.Union([scopeRead, Type.Null()]), graph: snapshot }),
    handler: (_args, call) => {
      call.context.onActivity({ stage: 'inspecting', message: 'Inspecting frozen scope targets, read-only context, dependencies and write authority.' });
      return { scope: call.context.binding.scope ?? null, graph: modelWorkingGraph(call.context.snapshot, call.context.binding.scope) };
    } }),
  previewParameters: api.method({ summary: 'Stage typed parameter edits on exactly the frozen target IDs, retaining context and unrelated objects.',
    description: 'Requires a model scope. Supply edits with definitionId, name and typed value including units. Built-in geometry uses existing support, hosting, family and placement validators. This private draft never grants approval.',
    effect: 'draft-write', params: { input: Type.Object({ edits: ModelParametersSchema }, { additionalProperties: false }) }, result: Type.Object({ model: snapshot, changes }),
    handler: ({ input }, call) => stage(call.context, () => {
      const scope = call.context.binding.scope;
      if (!scope) throw new Error('Parameter editing requires a frozen model scope.');
      return applyModelParameterEdits({ snapshot: call.context.snapshot, targetIds: scope.targetIds, edits: input.edits });
    }, () => call.throwIfRevoked()) }),
  previewWallShift: api.method({ summary: 'Stage a bounded shared-partition shift and report stored changes and evaluated dependencies.',
    description: 'Translate an existing complete interior axis-aligned partition, updating adjacent rectangular room bounds and supported wall junctions. Nonzero millimetre-grid offset, at most one metre; positive means global +X for vertical walls or +Y for horizontal walls. Existing contents and hosted openings are validated. Impacts describe evaluation, not write authority: a hosted door may move while changed is false. Frozen scope must authorize every stored write, including adjacent Spaces; readable context grants no writes. No model is accepted or published.',
    effect: 'draft-write', metadata: { units: 'm', acceptsOrPublishesModel: false },
    params: { input: Type.Object({ wallId: identifier, offsetMetres: Type.Number({ minimum: -1, maximum: 1 }) }, { additionalProperties: false }) },
    result: Type.Object({ model: snapshot, changes, impacts: wallShiftImpacts }),
    handler: ({ input }, call) => {
      let impacts: WallShiftImpact[] = [];
      const result = stage(call.context, () => {
        const preview = previewWallShift(call.context.snapshot, input);
        impacts = preview.impacts;
        return preview.snapshot;
      }, () => call.throwIfRevoked());
      return { ...result, impacts };
    } }),
  previewRoomDimensionChange: api.method({ summary: 'Drive one bounded partition from a confirmed centreline room span and check minimum clear spans.',
    description: 'Input matches RoomDimensionRequest: roomId, wallId, axis:x|y, measurement, minimumClearSpans. Confirmed measurement:{kind:confirmed,metres,sourceRef} is an agent/user interpretation for separate human review, never verified evidence or acceptance authority. Centreline driving spans are distinct from conservative clear spans, which use the existing maximum boundary half-thickness inset on every side. Unknown scale, ambiguous dimensions or contradictory evidence use measurement:{kind:unresolved,reason,sourceRefs}; they return status:unresolved without changing the current draft or publishing a preview. Ready results contain working model, cumulative stored changes, impacts, derived offsetMetres, measurement, clearSpanChecks and evaluated room/opening before/after dependencies. Constraints and driving references must be readable in the frozen scope; dependencies are projected to that same scope. Every stored write, including adjacent Spaces, still needs existing scope authority. Source references are opaque context; existing frozen target/evidence and explicit human acceptance requirements are unchanged. No source claims are resolved or promoted.',
    effect: 'draft-write', metadata: { units: 'm', acceptsOrPublishesModel: false },
    params: { input: roomDimensionRequest }, result: roomDimensionResult,
    handler: ({ input }, call) => {
      const draft = call.context;
      const readable = new Set<string>(modelWorkingGraph(draft.snapshot, draft.binding.scope).entities.map(item => item.id));
      let preview: ReturnType<typeof previewRoomDimensionChange>;
      try {
        if (draft.binding.scope && ![input.wallId, input.roomId, ...input.minimumClearSpans.map(item => item.roomId)].every(id => readable.has(id))) {
          throw new Error('Dimension driving and constraint references must be readable within the frozen model scope.');
        }
        preview = previewRoomDimensionChange(draft.snapshot, input);
      } catch (error) {
        draft.onActivity({ stage: 'validation-failed', message: 'A scripted dimension change failed model validation. Its draft is unchanged; the script can correct it.' });
        throw new ScriptApiError({ name: 'ModelValidationError', message: publicMessage(error instanceof Error ? error.message : 'Invalid room dimension change.') });
      }
      call.throwIfRevoked(); draft.signal.throwIfAborted();
      if (preview.status === 'unresolved') return preview;
      const ready = preview;
      const result = stage(draft, () => ready.snapshot, () => call.throwIfRevoked());
      return { status: ready.status, ...result, offsetMetres: ready.offsetMetres, measurement: ready.measurement,
        clearSpanChecks: ready.clearSpanChecks, impacts: ready.impacts, dependencies: ready.dependencies.filter(item => readable.has(item.id)) };
    } }),
  inspect: api.method({ summary: 'Inspect the current draft, selected identities, room membership and placement constraints.', effect: 'read', result: inspection,
    handler: (_args, call) => {
      const draft = call.context; const current = modelWorkingGraph(draft.snapshot, draft.binding.scope);
      const available = levels(current);
      const selected = selectedLevel(current, draft.binding);
      const plans = available.length ? available.map((level) => levelView(current, level.id)) : [current];
      const boundPlan = selected ? levelView(current, selected.id) : current;
      draft.onActivity({ stage: 'inspecting', message: 'Inspecting the bound model, selected identities and room relationships from the script.' });
      return { revisionId: draft.binding.baseRevisionId, selectedObjectIds: [...draft.binding.selectedObjectIds], model: current,
        parameters: current.entities.map(item => ({ entityId: item.id, parameters: modelParameters(item) })),
        placement: { levels: available, selectedLevelId: selected?.id ?? null,
          entities: current.entities.map((item) => ({ entityId: item.id, levelId: entityLevel(current, item)?.id ?? null, elevation: entityElevation(current, item) })),
          assetFamilies: current.entities.filter((item) => item.type === 'AssetFamily').map((family) => ({ familyId: family.id,
            instanceIds: current.entities.filter((item) => item.type === 'AssetInstance' && item.familyId === family.id).map((item) => item.id) })),
          assetInstances: current.entities.filter((item) => item.type === 'AssetInstance').map((item) => ({ entityId: item.id, familyId: item.familyId,
            roomId: entitySpace(current, item)?.id ?? null, levelId: entityLevel(current, item)?.id ?? null, elevation: entityElevation(current, item) })),
          layout: draft.binding.scope || spaces(current).length || current.version === 2 ? null : rectangleLayout(current),
          floorBounds: !draft.binding.scope && boundPlan.entities.some(item => item.type === 'Wall') ? floorBounds(boundPlan) : null,
          rooms: plans.flatMap((plan) => spaces(plan).map((room) => ({ ...room, clearBounds: clearSpaceBounds(plan, room),
            entityIds: plan.entities.filter((item) => entitySpace(plan, item)?.id === room.id).map((item) => item.id) }))),
          doorConnections: plans.flatMap((plan) => spaces(plan).length ? doorConnections(plan) : []),
          coordinates: 'Metres. X east, Y north; elevations are world floor bases. Ownership and room membership are level-bound, never inferred from overlapping XY. Furniture is centred on position; keep clear of walls, doors, stairs and roof undersides.',
          suggestedDimensions: { desk: [1.8, .8, .75], monitor: [.6, .2, .45], laptop: [.35, .25, .24], chair: [.6, .6, 1], table: [.6, .6, .55], plant: [.5, .5, 1.1] } } };
    } }),
  previewRectangle: api.method({ summary: 'Stage a single-room rectangular shell and entry door layout, in millimetres.',
    description: 'Not supported for multi-room shells or spatial-reference requests. Retains valid windows, equipment and furnishings.',
    effect: 'draft-write', params: { layout }, result: Type.Object({ model: snapshot, changes }), handler: ({ layout: input }, call) => stage(call.context, () => {
      if (call.context.binding.visualIntent.kind === 'spatial-reference') throw new Error('A spatial reference does not authorize changing the building shell.');
      return previewRectangle(call.context.snapshot, input);
    }, () => call.throwIfRevoked()) }),
  previewFurnishings: api.method({ summary: 'Replace the complete furnishing set, preserving shell, openings, equipment and hosting.',
    description: 'Metres on a 1 mm grid. Retain unrelated items, identities and existing levels. Furnishing DTOs omit the stored levelId; the host preserves ownership by identity. New or transferred building furnishings require levelAssignments:[{entityId,levelId}]. Supported devices require a desk/table supportId on the same level. Use only for explicit whole-model or cross-room work.',
    effect: 'draft-write', params: { input: furnishingSet }, result: Type.Object({ model: snapshot, changes }), handler: ({ input }, call) => stage(call.context,
      () => previewFurnishings(call.context.snapshot, input), () => call.throwIfRevoked()) }),
  previewAssets: api.method({ summary: 'Author reusable primitive asset families and upsert or remove their floor-standing instances in this private draft.',
    description: 'Available for ordinary requests, without shell reconstruction scope. Supply families, instances and removeInstanceIds. Family IDs are immutable; identical registration is idempotent and a changed recipe needs a new ID. Parts are normalized box/ellipsoid/vertical-cylinder geometry, not code. Instance size is metres on a 1 mm grid; placement is single-room or room with roomId, deriving its level. Unmentioned assets and all unrelated objects are retained. Disclose proxy fidelity in review.',
    effect: 'draft-write', params: { input: AssetEditSchema }, result: Type.Object({ model: snapshot, changes }), handler: ({ input }, call) => stage(call.context,
      () => previewAssets(call.context.snapshot, input), () => call.throwIfRevoked()) }),
  previewFloor: api.method({ summary: 'Compile a rectangular multi-room floor shell from rooms and hosted openings, in whole millimetres.',
    description: 'Requires explicit floor-plan-reconstruction or building-reconstruction scope. Reconstructs one stable level, retaining its elevation, slab, roof, incident stairs, all contents and every other level. Rooms tile one rectangle; shared walls are generated once. Door/Window offsets run from each room side minimum X (north/south) or Y (east/west).',
    effect: 'draft-write', params: { input: FloorLayoutSchema }, result: Type.Object({ model: snapshot, changes }), handler: ({ input }, call) => stage(call.context, () => {
      const scope = call.context.binding.authoringScope;
      if (scope !== 'floor-plan-reconstruction' && scope !== 'building-reconstruction') throw new Error('Floor reconstruction requires explicit authoring scope.');
      if (scope === 'floor-plan-reconstruction' && call.context.base.version === 2
          && selectedLevel(call.context.base, call.context.binding)?.id !== input.level.id) {
        throw new Error('Floor reconstruction must target the bound level. Select one Level for this request.');
      }
      return previewFloor(call.context.snapshot, input);
    }, () => call.throwIfRevoked()) }),
  previewBuilding: api.method({ summary: 'Compile basement, ground and attic levels, slabs, straight stairs and a flat or gabled roof into a version-2 building proposal.',
    description: 'Requires explicit building-reconstruction scope. Supply BuildingLayout levels and stairs; level elevations and geometry inputs use whole millimetres. Retains contents and their ownership. Stair slab voids are derived. No complex roofs, multi-flight stairs or code certification. Changes remain private until a separate human acceptance.',
    effect: 'draft-write', params: { input: BuildingLayoutSchema }, result: Type.Object({ model: snapshot, changes }), handler: ({ input }, call) => stage(call.context, () => {
      if (call.context.binding.authoringScope !== 'building-reconstruction') throw new Error('Building reconstruction requires explicit authoring scope.');
      return previewBuilding(call.context.snapshot, input);
    }, () => call.throwIfRevoked()) }),
  previewRoomFurnishings: api.method({ summary: 'Replace the complete furnishing set in one named room, preserving all other rooms exactly.',
    description: 'Include existing room furnishings to retain. Ownership derives from roomId, including for new items on stacked floors. No cross-room transfers. Metres, same placement and support rules as previewFurnishings.',
    effect: 'draft-write', params: { input: roomFurnishingSet }, result: Type.Object({ model: snapshot, changes }), handler: ({ input }, call) => stage(call.context,
      () => previewRoomFurnishings(call.context.snapshot, input), () => call.throwIfRevoked()) }),
} });

export { model as modelScriptApi, geometry as geometryScriptApi };

const guide = new DocsTree().addFile('/guides/model.md', 'Model units, scope, draft lifecycle and script decisions.',
  'A propose decision returns review:{summary,rationale,constraints,uncertainty,intent,evidenceUses?}. Optional evidenceUses is an array of {pin,subject,rationale} choosing exact pinned known sourceEvidence facts as proposal-local assumptions for human review. Copy the complete frozen subject including anchor.target; preserve competing claims and explain the choice without promoting global truth. The host validates choices against the bound read set and context; self-rated certainty grants no authority. ' +
  MODEL_REVIEW_TEXT_GUIDANCE + ' ' +
  'For scoped requests, await model.scope() returns {scope,graph}: immutable target/context/dependent/writable IDs and a live partial working graph. Context is never write authority. model.inspect and mutation results use this same context. It is not a standalone valid project. ' +
  'Call model.previewParameters({edits:[{definitionId,name,value}]}) to edit frozen targets with explicit typed units. All mutation tools enforce frozen write limits; query matches never expand during a proposal. Changed membership or dependencies require a fresh human review. ' +
  'Call model.previewWallShift({wallId,offsetMetres}) for a bounded complete shared partition. Offsets are nonzero metres on a 1 mm grid, at most one metre; positive means global +X for vertical walls or +Y for horizontal walls. The existing helper updates adjacent rectangular Spaces and supported wall junctions, then validates contents and openings atomically. Frozen scope must authorize every stored write; adjacent Spaces in read-only context do not grant permission. The result contains model, cumulative stored changes from the execution base, and impacts for this operation. An impact with changed:false can still move in world geometry when its host moves. Impacts never expand write authority. Unsupported topology or invalid contents leave the draft unchanged. ' +
  'Call model.previewRoomDimensionChange({roomId,wallId,axis:"x"|"y",measurement,minimumClearSpans:[]}) to derive one bounded shared-partition move from a centreline room span. A confirmed measurement is {kind:"confirmed",metres,sourceRef}; sourceRef is opaque context and confirmed is an agent/user interpretation for human review, not new evidence authority. Require confirmed units/scale and distinguish centreline driving dimensions from minimumClearSpans:[{roomId,axis,metres}]. Clear spans preserve the existing conservative maximum boundary half-thickness inset on every side, not surveyed face-specific dimensions. Unknown scale, ambiguity or contradictions require {kind:"unresolved",reason:"unknown-scale"|"ambiguous-dimension"|"contradictory-evidence",sourceRefs:[...]}; the result is status:"unresolved" with no model/changes and no draft mutation or preview. A ready result has status:"ready",model,cumulative changes,impacts,offsetMetres,measurement,clearSpanChecks with beforeMetres/afterMetres, and sorted dependencies with before/after room bounds/spans or opening world endpoints, storedChanged and evaluatedChanged. Named references must be readable in frozen scope and evaluated dependencies use that same projection. Existing atomic validation, adjacent-room write scope, abort/preview fences, frozen target/evidence read sets and separate human acceptance remain required. Constraints are design inputs, not code compliance or evidence claims. ' +
  'Use await model.inspect() for the exact bound model and placement context. Every script starts from that base or the supplied prior proposal draft for a conversation continuation. ' +
  'placement.levels lists stable levels and world elevations; placement.selectedLevelId binds a selected Level, spatial reference or unambiguous selected-object owner. ' +
  'placement.entities supplies entityId, levelId and world floor-base elevation. placement.rooms supplies levelId and entityIds computed within that level. ' +
  'placement.assetFamilies maps reusable family IDs to instance IDs; placement.assetInstances resolves their room, level and floor elevation. Complete recipes and placements remain in model.entities. Family definitions are nonspatial read dependencies. ' +
  'Coincident XY coordinates on different levels never imply shared room membership. A null selectedLevelId means the context does not identify one level. ' +
  'previewRectangle uses millimetres; furnishing positions and sizes use metres on a 1 mm grid. ' +
  'For a requested object outside Furniture.kind, author a new normalized primitive recipe with previewAssets; read /guides/assets.md. It needs no catalog entry, shell scope or snapshot upgrade. ' +
  'previewRoomFurnishings derives ownership from roomId and retains all other rooms and levels. previewFurnishings replaces the complete whole-model furniture set. ' +
  'Retain existing furnishing levels; new or transferred whole-building items require optional levelAssignments:[{entityId,levelId}]. Never assign levels by XY overlap. ' +
  'When reusing inspected V2 Furniture, omit stored levelId from the furnishing DTO; the host retains ownership by identity. Use the separate levelAssignments only to assign new or transferred items. ' +
  'previewFloor(input:FloorLayout) requires floor-plan-reconstruction or building-reconstruction scope and replaces one level shell using its stable level ID. ' +
  'On a building it retains that level elevation, slab, roof, incident stairs, all contents and every other level. Floor-only scope must target the bound level. ' +
  'Floor-only reconstruction authority resolves from the immutable base and request binding; transferring selected furnishings changes inspection context, never that authority. ' +
  'Supply level:{id,name}, 2..12 rooms:{id,name,boundsMm:{minX,minY,maxX,maxY}}, wallThicknessMm, heightMm and openings. ' +
  'Each opening has type:Door|Window, id,name,roomId,side:north|south|east|west,offsetMm,widthMm,heightMm; Windows also require sillHeightMm. ' +
  'All floor values are whole millimetres. Room bounds are wall centrelines; offsets run from the side minimum X for north/south or Y for east/west. ' +
  'Rooms tile each level rectangle; doors and stairs together must provide a path to a real exterior exit. Basement and attic do not each need an exterior door. Shared walls and opening hosts are compiled automatically. ' +
  'previewBuilding(input:BuildingLayout) requires building-reconstruction scope ONLY. Selection, spatial references and attached files never grant building authority. ' +
  'BuildingLayout contains levels and stairs. Each level supplies the floor layout fields, level:{id,name,elevationMm}, slabThicknessMm and roof (or null). ' +
  'roof supplies boundsMm, thicknessMm and profile:{kind:"flat",heightMm} or {kind:"gable",eaveHeightMm,ridgeHeightMm,ridgeAxis:"x"|"y"}. ' +
  'Each stair supplies id,name,fromLevelId,toLevelId,startMm:[x,y],endMm:[x,y],widthMm and integer steps. ' +
  'Use negative basement elevation, zero ground elevation and positive attic elevation. At most six levels and twelve rooms per level, subject to the bounded complete graph. ' +
  'The highest level may have a flat or gabled roof. Stairs are straight, axis aligned, connect adjacent levels, and fit rooms at both endpoints; slab voids are derived. Complex roofs and multi-flight stairs are unsupported. ' +
  'New building reconstruction creates version 2 with explicit level ownership. Historical inspection and edits retain their format and hashes; no defaults are persisted during restore. ' +
  'Current draft Furniture/Equipment and their ownership are retained. If they do not fit, reconstruction fails; explicitly move/remove requested furnishings with previewFurnishings in the same script before rebuilding. Equipment cannot be removed by furnishing tools. ' +
  'For multiple images or PDF pages, map each source/page to its separate level and document elevations, dimensions, roof/stair assumptions and omitted features in review. Never flatten basement and attic into one floor. ' +
  'Roof clearance and stair geometry are concept evidence, never structural, headroom or building-code certification. ' +
  'Monitor/laptop supportId must refer to a desk/table. No implicit workstation or proximity group exists. ' +
  'Return {kind:"observe",observation:value}, {kind:"propose",review:{summary,rationale,constraints,uncertainty,intent:{interpretation,assumptions,certainty,basis}}}, ' +
  'or {kind:"clarify",question,options:[]} for a user question, or {kind:"decline",reason,uncertainty}. Propose only after authoring the complete change in this script. ' +
  'Only trusted application code validates the proposal, and only a separate human decision accepts it. ' + MODEL_INTENT_GUIDANCE)
  .addFile('/guides/assets.md', 'Author and reuse custom asset recipes from the user request.', [
    'Inspect the bound model first. Design a compact primitive recipe for the requested object, rather than looking for a preconfigured catalog category. The host has no built-in person family.',
    'Call model.previewAssets({families,instances,removeInstanceIds}). These are atomic upserts/removals, not replacements of every asset. Preserve unrelated entities and identities. Ordinary requests can use this capability; it grants no shell reconstruction, network, filesystem or approval authority.',
    'An AssetFamily has id,type:AssetFamily,name,description,parts. Each part has id,kind:box|ellipsoid|cylinder,min:[x,y,z],size:[width,depth,height],color:#rrggbb. Use bounded arrays of three numbers, not executable expressions. Coordinates are normalized to 0..1; every positive part stays inside the unit box and the combined analytic extrema must reach all six bounds. Cylinders are vertical and ellipsoid sizes are full diameters.',
    'An AssetInstance has id,type:AssetInstance,name,familyId,position:[x,y],rotationDeg:0|90|180|270,size:{width,depth,height},placement. World size is metres on the millimetre grid; height 1.87 means exactly 1870 mm. Position is the footprint centre; local floor Z starts at zero. Use placement:{kind:single-room} only for an existing unlevelled single-room shell, or placement:{kind:room,roomId} for a named room. Room placement derives the level; never supply a competing levelId or infer it from overlapping XY.',
    'Authoring example: the following display stand recipe is written in a script, not registered in a product catalog. Design different parts for other requested shapes.',
    '```typescript',
    'await model.previewAssets({',
    '  families: [{id:"request-stand-v1",type:"AssetFamily",name:"Authored display stand",description:"Concept display stand proxy, not a certified product.",parts:[',
    '    {id:"base",kind:"box",min:[0,0,0],size:[1,1,.15],color:"#546778"},',
    '    {id:"column",kind:"cylinder",min:[.25,.25,.15],size:[.5,.5,.7],color:"#718799"},',
    '    {id:"top",kind:"box",min:[0,0,.85],size:[1,1,.15],color:"#546778"}',
    '  ]}],',
    '  instances: [{id:"requested-stand",type:"AssetInstance",name:"Requested display stand",familyId:"request-stand-v1",position:[1,2],rotationDeg:0,size:{width:.6,depth:.6,height:1.1},placement:{kind:"single-room"}}],',
    '  removeInstanceIds:[]',
    '});',
    '```',
    'Reuse the same familyId for a second size or placement; send families:[] when the definition already exists. Re-registering an identical definition is idempotent. Definition IDs are immutable: a changed recipe needs a new ID and explicit instance updates. removeInstanceIds removes only named instances; definitions remain available for reuse.',
    'For a human figure, compose approximate torso, head, arms and legs from primitives and disclose that it is a conceptual proxy, with no anatomical fidelity. For another object, design its own recipe. Do not decline merely because Furniture.kind lacks the requested category, and do not claim photorealism, anatomical, manufacturer, structural or product certification.',
    'At most eight families, sixteen parts per family and thirty-two combined furnishings/instances, subject to the full graph and 64 KiB script-result limits. Inspect recipes through model.entities; return compact observations instead of duplicating the model. Placement must clear walls, doors, stairs, slabs, roofs and other objects.',
    'Record recipe interpretation, dimensions, placement, proxy fidelity and assumptions in review. Return a proposal only after the complete authored change passes validation. A separate human decision accepts it.',
  ].join('\n\n'));

/** One runtime per queue/server, with one fresh, private draft and session for each execution. */
export class ModelScripts {
  #runtime: Promise<ScriptBoxRuntime<Draft>> | null = null;
  #disposed = false;
  readonly #limits: Partial<ExecutionLimits>;
  constructor(limits: Partial<Pick<ExecutionLimits, 'timeoutMs' | 'hostCalls' | 'sourceBytes' | 'resultBytes'>> = {}) { this.#limits = limits; }
  #get(): Promise<ScriptBoxRuntime<Draft>> {
    if (this.#disposed) throw new Error('The model script runtime is disposed.');
    this.#runtime ??= createRuntime<Draft>({ apis: [model, geometry], docs: [guide,
      new DocsTree().addFile('/guides/geometry.md', 'Unified source-bound geometry reads, limits and proposal evidence.', GEOMETRY_SCRIPT_GUIDANCE)],
      contractVersion: 'bim-model-scripts-v3', policyVersion: 'proposal-intent-v1',
      sealResults: true, compilerWorkers: 1,
      limits: { memoryBytes: 64 * 1024 * 1024, compilerHeapMb: 256, sourceBytes: 32 * 1024, resultBytes: 64 * 1024,
        hostCalls: MAX_SCRIPT_HOST_CALLS, evidenceRecords: MAX_SCRIPT_HOST_CALLS, ...this.#limits },
    });
    return this.#runtime;
  }
  async declarations(): Promise<string> { return (await this.#get()).getTypeScriptDeclarations(); }
  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#runtime) await (await this.#runtime).dispose();
  }
  async run(input: RunInput): Promise<ModelScriptResult> {
    input.onPreview?.(null);
    let retainPreview = false;
    try {
      const binding = structuredClone(input.binding);
      if (binding.scope) {
        if (binding.scope.baseRevisionId !== binding.baseRevisionId) throw new Error('Scope and script base revisions differ.');
        assertModelScopeFresh({ base: input.base, current: input.base, binding: binding.scope });
      }
      const runtime = await this.#get();
      const draft: Draft = { base: input.base, snapshot: input.initialDraft ?? input.base, binding, signal: input.signal,
        ...(input.geometry ? { geometry: input.geometry } : {}),
        onActivity: input.onActivity, ...(input.onPreview ? { onPreview: input.onPreview } : {}) };
      const session = runtime.createSession({ context: draft,
        capabilities: ['model.inspect', 'model.scope', 'model.previewParameters', 'model.previewWallShift', 'model.previewRoomDimensionChange', 'model.previewRectangle', 'model.previewFurnishings', 'model.previewRoomFurnishings', 'model.previewAssets',
          ...(input.geometry ? GEOMETRY_SCRIPT_CAPABILITIES : []),
          ...(input.binding.authoringScope === 'floor-plan-reconstruction' || input.binding.authoringScope === 'building-reconstruction' ? ['model.previewFloor'] : []),
          ...(input.binding.authoringScope === 'building-reconstruction' ? ['model.previewBuilding'] : [])],
        limits: { hostCalls: Math.max(0, Math.min(runtime.limits.hostCalls, input.remainingHostCalls - 1)) },
        // Awaited audit callbacks fail closed. Never forward guest logs or raw handler errors to product activity.
        audit: (event: ExecutionEvent) => {
          if (event.type === 'limit-reached') input.onActivity({ stage: 'validation-failed', message: 'The script reached an execution limit. Its proposed changes will be discarded.' });
        },
      });
      let outcome: ExecutionOutcome;
      try { outcome = await session.execute({ language: input.language, source: input.source, signal: input.signal }); }
      finally { await session.dispose(); }
      const evidence = (disposition: ScriptExecutionEvidence['disposition'], validation: ScriptExecutionEvidence['validation'], diagnostic: ScriptDiagnostic | null) => parseScriptExecutionEvidence({
        version: 1, executionId: outcome.evidence.executionId, language: input.language, sourceSha256: outcome.evidence.source.sha256,
        status: outcome.status, disposition, validation, contractSha256: outcome.evidence.contract.sha256,
        policyVersion: outcome.evidence.policyVersion, runtime: { packageVersion: outcome.evidence.runtime.packageVersion,
          guestAbi: outcome.evidence.runtime.guestAbi, bootstrapVersion: outcome.evidence.runtime.bootstrapVersion, artifactSha256: outcome.evidence.runtime.artifactSha256 },
        calls: outcome.evidence.calls.map((call) => ({ sequence: call.seq, method: auditMethod(call.method), disposition: call.disposition })), diagnostic,
      });
      const failed = (diagnostic: ScriptDiagnostic, validation: ScriptExecutionEvidence['validation'] = 'not-run'): ModelScriptResult => ({
        kind: 'failed', diagnostic, evidence: evidence('discarded', validation, diagnostic),
      });
      const integrityFailure = outcome.evidence.calls.find((call) => call.disposition !== 'completed'
        && !(call.disposition === 'app-error' && call.errorName === 'ModelValidationError'));
      if (integrityFailure) return failed({ code: 'execution-integrity', message: publicMessage(`Host call ${auditMethod(integrityFailure.method)} ended as ${integrityFailure.disposition}. Staged changes discarded.`), line: null, column: null });
      if (outcome.status !== 'completed') return failed({ code: outcome.status === 'failed' ? outcome.error.code : outcome.status,
        message: publicMessage(outcome.status === 'failed' ? outcome.error.message : `Script ${outcome.status}. Staged changes discarded.`),
        line: outcome.status === 'failed' ? outcome.error.line : null, column: outcome.status === 'failed' ? outcome.error.column : null });
      if (input.signal.aborted) return failed({ code: 'cancelled', message: 'Script authority was revoked. Staged changes discarded.', line: null, column: null });
      try {
        const result = decision(outcome.value);
        if (result.kind === 'observe') return { kind: 'observation', observation: result.observation, evidence: evidence('observation', 'not-run', null) };
        if (result.kind === 'clarify') return { kind: 'declined', reason: result.clarification.question, uncertainty: 'Awaiting user clarification.', clarification: result.clarification, evidence: evidence('declined', 'not-run', null) };
        if (result.kind === 'decline') return { kind: 'declined', reason: result.reason, uncertainty: result.uncertainty,
          ...(result.intent ? { intent: result.intent } : {}), evidence: evidence('declined', 'not-run', null) };
        const candidate = validateSnapshot(draft.snapshot);
        if (binding.scope) assertModelScopeWrites({ before: input.base, after: candidate, binding: binding.scope });
        const delta = summarizeModelDelta(diffSnapshots(input.base, candidate));
        if (!Object.values(delta).some((collection) => Object.values(collection).some((ids) => ids.length))) throw new Error('The proposed model is identical to the bound revision.');
        input.signal.throwIfAborted();
        const proposal: ModelScriptResult = { kind: 'proposal', snapshot: candidate, review: result.review, evidence: evidence('proposal', 'passed', null) };
        retainPreview = true;
        return proposal;
      } catch (error) { return failed({ code: 'invalid-proposal', message: publicMessage(error instanceof Error ? error.message : 'Invalid script proposal.'), line: null, column: null }, 'failed'); }
    } finally { if (!retainPreview) input.onPreview?.(null); }
  }
}
