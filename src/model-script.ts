import { createApiKit, createRuntime, DocsTree, ScriptApiError, Type } from '@frederik91/scriptbox';
import type { ExecutionEvent, ExecutionLimits, ExecutionOutcome, JsonValue, ScriptBoxRuntime } from '@frederik91/scriptbox';
import { spaces, floorBounds, clearSpaceBounds, doorConnections, entitySpace } from './floor-plan.ts';
import {
  diffSnapshots, FURNITURE_KINDS, previewFurnishings, previewRectangle, previewRoomFurnishings,
  rectangleLayout, validateSnapshot,
} from './room-model.ts';
import type { EntityId, ModelDelta, ModelSnapshot } from './room-model.ts';
import type { VisualRequest } from './visual-request.ts';
import type { ActivityUpdate } from './request-activity.ts';
import { parseScriptExecutionEvidence, MAX_SCRIPT_HOST_CALLS } from './script-evidence.ts';
import type { ScriptExecutionEvidence } from './script-evidence.ts';

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
const furnishingSet = Type.Object({ furnishings: Type.Array(furniture, { maxItems: 32 }) });
const roomFurnishingSet = Type.Object({ roomId: identifier, furnishings: Type.Array(furniture, { maxItems: 32 }) });
const space = Type.Object({ id: identifier, type: Type.Literal('Space'), name, levelId: identifier, bounds });
const door = Type.Object({ id: identifier, type: Type.Literal('Door'), name, width: Type.Number(), height: Type.Number() });
const entity = Type.Union([
  Type.Object({ id: identifier, type: Type.Literal('Wall'), name, start: point, end: point, thickness: Type.Number(), height: Type.Number() }),
  door,
  Type.Object({ id: identifier, type: Type.Literal('Window'), name, width: Type.Number(), height: Type.Number(), sillHeight: Type.Number() }),
  Type.Object({ id: identifier, type: Type.Literal('Equipment'), name, category: Type.Union([Type.Literal('mechanical'), Type.Literal('electrical')]),
    position: point, elevation: Type.Number(), width: Type.Number(), depth: Type.Number(), height: Type.Number() }),
  furniture, space, Type.Object({ id: identifier, type: Type.Literal('Level'), name, elevation: Type.Literal(0) }),
], { title: 'ModelEntity' });
const snapshot = Type.Object({ units: Type.Literal('m'), entities: Type.Array(entity, { maxItems: 100 }), relationships: Type.Array(Type.Object({
  id: identifier, type: Type.Literal('hosted-by'), source: identifier, target: identifier, offset: Type.Number(),
}), { maxItems: 100 }) }, { title: 'ModelSnapshot' });
const collectionChanges = Type.Object({ added: Type.Array(identifier), removed: Type.Array(identifier), modified: Type.Array(identifier) });
const changes = Type.Object({ entities: collectionChanges, relationships: collectionChanges });
const inspection = Type.Object({
  revisionId: Type.String(), selectedObjectIds: Type.Array(identifier), model: snapshot,
  placement: Type.Object({
    layout: Type.Union([layout, Type.Null()]), floorBounds: bounds,
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
}
export interface ScriptReviewText { summary: string; rationale: string; constraints: string; uncertainty: string }
export interface ScriptDiagnostic { code: string; message: string; line: number | null; column: number | null }
export type ModelScriptResult =
  | { kind: 'observation'; observation: JsonValue; evidence: ScriptExecutionEvidence }
  | { kind: 'proposal'; snapshot: ModelSnapshot; review: ScriptReviewText; evidence: ScriptExecutionEvidence }
  | { kind: 'declined'; reason: string; uncertainty: string; evidence: ScriptExecutionEvidence }
  | { kind: 'failed'; diagnostic: ScriptDiagnostic; evidence: ScriptExecutionEvidence };

interface Draft {
  readonly base: ModelSnapshot;
  snapshot: ModelSnapshot;
  binding: ModelScriptBinding;
  signal: AbortSignal;
  onActivity: (event: ActivityUpdate) => void;
}
interface RunInput {
  base: ModelSnapshot;
  binding: ModelScriptBinding;
  source: string;
  language: 'javascript' | 'typescript';
  signal: AbortSignal;
  remainingHostCalls: number;
  onActivity: (event: ActivityUpdate) => void;
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
function decision(value: unknown):
  | { kind: 'observe'; observation: JsonValue }
  | { kind: 'propose'; review: ScriptReviewText }
  | { kind: 'decline'; reason: string; uncertainty: string } {
  if (!record(value)) throw new Error('Return an observe, propose or decline decision.');
  if (value.kind === 'observe') {
    fields(value, ['kind', 'observation']);
    // The returned value already passed ScriptBox's JSON boundary.
    return { kind: 'observe', observation: jsonValue(value.observation) };
  }
  if (value.kind === 'propose') {
    fields(value, ['kind', 'review']); fields(value.review, ['summary', 'rationale', 'constraints', 'uncertainty']);
    return { kind: 'propose', review: { summary: text(value.review.summary, 240), rationale: text(value.review.rationale, 800),
      constraints: text(value.review.constraints, 600), uncertainty: text(value.review.uncertainty, 400) } };
  }
  if (value.kind === 'decline') {
    fields(value, ['kind', 'reason', 'uncertainty']);
    return { kind: 'decline', reason: text(value.reason, 800), uncertainty: text(value.uncertainty, 400) };
  }
  throw new Error('Return {kind:"observe",observation}, {kind:"propose",review} or {kind:"decline",reason,uncertainty}.');
}
function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  throw new Error('Invalid observation value.');
}

function stage(draft: Draft, operation: () => ModelSnapshot, revoked: () => void) {
  draft.onActivity({ stage: 'validating', message: 'Testing a scripted model change against the model and placement validators.' });
  let candidate: ModelSnapshot;
  try { candidate = operation(); }
  catch (error) {
    draft.onActivity({ stage: 'validation-failed', message: 'A scripted change failed model validation. Its draft is unchanged; the script can correct it.' });
    throw new ScriptApiError({ name: 'ModelValidationError', message: publicMessage(error instanceof Error ? error.message : 'Invalid model change.') });
  }
  revoked(); draft.signal.throwIfAborted();
  draft.snapshot = candidate;
  draft.onActivity({ stage: 'validated', message: 'Scripted change passed deterministic validation. Accepted model remains unchanged.' });
  return { model: candidate, changes: summarizeModelDelta(diffSnapshots(draft.base, candidate)) };
}

const api = createApiKit<Draft>();
const model = api.namespace({ name: 'model', description: 'Read a bound model and stage validated changes in this script only. Nothing here accepts or saves a project.', methods: {
  inspect: api.method({ summary: 'Inspect the current draft, selected identities, room membership and placement constraints.', effect: 'read', result: inspection,
    handler: (_args, call) => {
      const draft = call.context; const current = draft.snapshot;
      draft.onActivity({ stage: 'inspecting', message: 'Inspecting the bound model, selected identities and room relationships from the script.' });
      return { revisionId: draft.binding.baseRevisionId, selectedObjectIds: [...draft.binding.selectedObjectIds], model: current,
        placement: { layout: spaces(current).length ? null : rectangleLayout(current), floorBounds: floorBounds(current),
          rooms: spaces(current).map((room) => ({ ...room, clearBounds: clearSpaceBounds(current, room), entityIds: current.entities.filter((item) => entitySpace(current, item)?.id === room.id).map((item) => item.id) })),
          doorConnections: spaces(current).length ? doorConnections(current) : [],
          coordinates: 'Metres. X east, Y north. Furniture centred on position; keep clear of wall thickness and connecting doors.',
          suggestedDimensions: { desk: [1.8, .8, .75], monitor: [.6, .2, .45], laptop: [.35, .25, .24], chair: [.6, .6, 1], table: [.6, .6, .55], plant: [.5, .5, 1.1] } } };
    } }),
  previewRectangle: api.method({ summary: 'Stage a single-room rectangular shell and entry door layout, in millimetres.',
    description: 'Not supported for multi-room shells or spatial-reference requests. Retains valid windows, equipment and furnishings.',
    effect: 'draft-write', params: { layout }, result: Type.Object({ model: snapshot, changes }), handler: ({ layout: input }, call) => stage(call.context, () => {
      if (call.context.binding.visualIntent.kind === 'spatial-reference') throw new Error('A spatial reference does not authorize changing the building shell.');
      return previewRectangle(call.context.snapshot, input);
    }, () => call.throwIfRevoked()) }),
  previewFurnishings: api.method({ summary: 'Replace the complete furnishing set, preserving shell, openings, equipment and hosting.',
    description: 'Metres on a 1 mm grid. Retain unrelated items and their identities. Supported devices require a desk/table supportId. Use only for explicit whole-model or cross-room work.',
    effect: 'draft-write', params: { input: furnishingSet }, result: Type.Object({ model: snapshot, changes }), handler: ({ input }, call) => stage(call.context,
      () => previewFurnishings(call.context.snapshot, input), () => call.throwIfRevoked()) }),
  previewRoomFurnishings: api.method({ summary: 'Replace the complete furnishing set in one named room, preserving all other rooms exactly.',
    description: 'Include existing room furnishings to retain. No cross-room transfers. Metres, same placement and support rules as previewFurnishings.',
    effect: 'draft-write', params: { input: roomFurnishingSet }, result: Type.Object({ model: snapshot, changes }), handler: ({ input }, call) => stage(call.context,
      () => previewRoomFurnishings(call.context.snapshot, input), () => call.throwIfRevoked()) }),
} });

const guide = new DocsTree().addFile('/guides/model.md', 'Model units, scope, draft lifecycle and script decisions.',
  'Use await model.inspect() for the exact bound model and placement context. Every script starts from that base. ' +
  'previewRectangle uses millimetres; furnishing positions and sizes use metres on a 1 mm grid. ' +
  'previewRoomFurnishings retains all other rooms. previewFurnishings replaces the complete whole-model furniture set. ' +
  'Monitor/laptop supportId must refer to a desk/table. No implicit workstation or proximity group exists. ' +
  'Return {kind:"observe",observation:value}, {kind:"propose",review:{summary,rationale,constraints,uncertainty}}, ' +
  'or {kind:"decline",reason,uncertainty}. Propose only after authoring the complete change in this script. ' +
  'Only trusted application code validates the proposal, and only a separate human decision accepts it.');

/** One runtime per queue/server, with one fresh, private draft and session for each execution. */
export class ModelScripts {
  #runtime: Promise<ScriptBoxRuntime<Draft>> | null = null;
  #disposed = false;
  readonly #limits: Partial<ExecutionLimits>;
  constructor(limits: Partial<Pick<ExecutionLimits, 'timeoutMs' | 'hostCalls' | 'sourceBytes' | 'resultBytes'>> = {}) { this.#limits = limits; }
  #get(): Promise<ScriptBoxRuntime<Draft>> {
    if (this.#disposed) throw new Error('The model script runtime is disposed.');
    this.#runtime ??= createRuntime<Draft>({ apis: [model], docs: [guide], contractVersion: 'bim-model-scripts-v1', policyVersion: 'proposal-only-v1',
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
    const runtime = await this.#get();
    const draft: Draft = { base: input.base, snapshot: input.base, binding: input.binding, signal: input.signal, onActivity: input.onActivity };
    const session = runtime.createSession({ context: draft,
      capabilities: ['model.inspect', 'model.previewRectangle', 'model.previewFurnishings', 'model.previewRoomFurnishings'],
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
      if (result.kind === 'decline') return { kind: 'declined', reason: result.reason, uncertainty: result.uncertainty, evidence: evidence('declined', 'not-run', null) };
      const candidate = validateSnapshot(draft.snapshot);
      const delta = summarizeModelDelta(diffSnapshots(input.base, candidate));
      if (!Object.values(delta).some((collection) => Object.values(collection).some((ids) => ids.length))) throw new Error('The proposed model is identical to the bound revision.');
      input.signal.throwIfAborted();
      return { kind: 'proposal', snapshot: candidate, review: result.review, evidence: evidence('proposal', 'passed', null) };
    } catch (error) { return failed({ code: 'invalid-proposal', message: publicMessage(error instanceof Error ? error.message : 'Invalid script proposal.'), line: null, column: null }, 'failed'); }
  }
}
