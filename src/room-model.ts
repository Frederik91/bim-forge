import { parseEvidenceReadSet, parseEvidenceUses, evidenceCanonical } from './model-evidence.ts';
import type { EvidenceReadSet, EvidenceUse } from './model-evidence.ts';
import { previewWallShift } from './wall-dependencies.ts';
import type { WallShiftRequest, WallShiftImpact } from './wall-dependencies.ts';
import { parseDesignTarget, parseWritableDesignTarget, parseFrozenDesignTarget, parseDesignTargets, sameDesignTarget } from './design-targets.ts';
import type { DesignTarget, WritableDesignTarget, FrozenDesignTarget, DesignTargetsState, DesignTargetView } from './design-targets.ts';
import { validateFloorPlan, spaces, spaceForFootprint, doorClearanceBounds } from './floor-plan.ts';
import { parseScriptExecutions } from './script-evidence.ts';
import type { ScriptExecutionEvidence } from './script-evidence.ts';
import { parseIntentAssessment } from './model-intent.ts';
import type { IntentAssessment } from './model-intent.ts';
import { parseRequestSources, parseAuthoringScope } from './request-sources.ts';
import type { RequestSource, AuthoringScope } from './request-sources.ts';
import { entityLevel, levelView, levels, roofHeightAt, stairFootprint } from './building-levels.ts';
import type { AssetFamily, AssetInstance } from './asset-family.ts';
import { parseAssetEdit, parseAssetFamily, parseAssetInstance } from './asset-family.ts';
import { validateAssets } from './asset-placement.ts';
import { parseFrozenModelScope } from './model-scope-contract.ts';
import { freezeModelScope, assertModelScopeFresh, assertModelScopeWrites } from './model-scope.ts';
import type { FrozenModelScope, ParameterizedEntity } from './model-scope-contract.ts';
import { parseCustomModelParameters, retainModelParameters } from './model-parameters.ts';
export type { AssetFamily, AssetInstance } from './asset-family.ts';

const MAX_BYTES = 256 * 1024;
const token = Symbol('validated room repository');
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const revisionPattern = /^[a-f0-9]{64}$/;
const requestPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const projectPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

declare const entityIdBrand: unique symbol;
declare const revisionIdBrand: unique symbol;
declare const branchNameBrand: unique symbol;
declare const requestIdBrand: unique symbol;
declare const projectIdBrand: unique symbol;

export type EntityId = string & { readonly [entityIdBrand]: true };
export type RevisionId = string & { readonly [revisionIdBrand]: true };
export type BranchName = string & { readonly [branchNameBrand]: true };
export type RequestId = string & { readonly [requestIdBrand]: true };
export type ProjectId = string & { readonly [projectIdBrand]: true };
export type Point = [number, number];

export interface Wall extends ParameterizedEntity {
  id: EntityId;
  type: 'Wall';
  name: string;
  start: Point;
  end: Point;
  thickness: number;
  height: number;
}

export interface Door extends ParameterizedEntity {
  id: EntityId;
  type: 'Door';
  name: string;
  width: number;
  height: number;
}

export interface Window extends ParameterizedEntity {
  id: EntityId;
  type: 'Window';
  name: string;
  width: number;
  height: number;
  sillHeight: number;
}

export interface Equipment extends ParameterizedEntity {
  id: EntityId;
  type: 'Equipment';
  name: string;
  category: 'mechanical' | 'electrical';
  position: Point;
  elevation: number;
  width: number;
  depth: number;
  height: number;
}

export const FURNITURE_KINDS = ['desk', 'monitor', 'laptop', 'chair', 'table', 'plant', 'bed', 'sofa', 'cabinet'] as const;
export type FurnitureKind = typeof FURNITURE_KINDS[number];
export interface Furniture extends ParameterizedEntity {
  id: EntityId;
  type: 'Furniture';
  name: string;
  kind: FurnitureKind;
  /** Centre of the footprint in model metres; positive Y is north. */
  position: Point;
  width: number;
  depth: number;
  height: number;
  rotationDeg: 0 | 90 | 180 | 270;
  /** Monitor/laptop reference a desk or table; floor items use null. */
  supportId: EntityId | null;
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface Level extends ParameterizedEntity { id: EntityId; type: 'Level'; name: string; elevation: number }
export interface Space extends ParameterizedEntity { id: EntityId; type: 'Space'; name: string; levelId: EntityId; bounds: Bounds }

export interface Slab extends ParameterizedEntity { id: EntityId; type: 'Slab'; name: string; levelId: EntityId; bounds: Bounds; thickness: number }
export interface Stair extends ParameterizedEntity {
  id: EntityId; type: 'Stair'; name: string; fromLevelId: EntityId; toLevelId: EntityId;
  start: Point; end: Point; width: number; steps: number;
}
export type RoofProfile = { kind: 'flat'; height: number }
  | { kind: 'gable'; eaveHeight: number; ridgeHeight: number; ridgeAxis: 'x' | 'y' };
export interface Roof extends ParameterizedEntity {
  id: EntityId; type: 'Roof'; name: string; levelId: EntityId;
  bounds: Bounds; thickness: number; profile: RoofProfile;
}
export type LegacyEntity = Wall | Door | Window | Equipment | Furniture | Level | Space | AssetFamily | AssetInstance;
export type BuildingWall = Wall & { levelId: EntityId };
export type BuildingFurniture = Furniture & { levelId: EntityId };
export type BuildingEquipment = Equipment & { levelId: EntityId };
export type BuildingEntity = BuildingWall | BuildingFurniture | BuildingEquipment
  | Door | Window | Level | Space | Slab | Stair | Roof | AssetFamily | AssetInstance;
export type Entity = LegacyEntity | BuildingEntity;

export interface HostingRelationship {
  id: EntityId;
  type: 'hosted-by';
  source: EntityId;
  target: EntityId;
  offset: number;
}

export interface LegacySnapshot {
  version?: never;
  units: 'm';
  entities: LegacyEntity[];
  relationships: HostingRelationship[];
}
export interface SnapshotV2 {
  version: 2;
  units: 'm';
  entities: BuildingEntity[];
  relationships: HostingRelationship[];
}
export type ModelSnapshot = LegacySnapshot | SnapshotV2;
/** Read views are graphs, not complete snapshots suitable for persistence/validation. */
export interface ModelGraph {
  readonly version?: 2;
  readonly units: 'm';
  readonly entities: readonly Entity[];
  readonly relationships: readonly HostingRelationship[];
}

export interface RoomLayout {
  boundsMm: { minX: number; minY: number; maxX: number; maxY: number };
  door: { widthMm: number; offsetMm: number };
}

export interface Revision {
  id: RevisionId;
  parentId: RevisionId | null;
  snapshot: ModelSnapshot;
}

export interface Branch {
  name: BranchName;
  revisionId: RevisionId;
}

type ToolCallName = 'run_model_script' | 'inspect_model' | 'preview_rectangle' | 'preview_furnishings' | 'preview_room_furnishings' | 'preview_workstation_move' | 'submit_proposal' | 'decline_request' | 'unsupported_tool';
type ToolCallStatus = 'accepted' | 'rejected';

export interface ToolCallEvidence {
  name: ToolCallName;
  status: ToolCallStatus;
  error: string | null;
}

export interface WorkerEvidence {
  provider: string;
  model: string;
  responseIds: RequestId[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

type ReviewDecision =
  | { status: 'pending'; decisionId: null; actor: null }
  | { status: 'accepted' | 'superseded'; decisionId: RequestId; actor: string; appliedRevisionId?: RevisionId };

export interface ProposalReview {
  requestId: RequestId;
  proposalName: BranchName;
  baseRevisionId: RevisionId;
  proposalRevisionId: RevisionId;
  selectedObjectIds: EntityId[];
  instruction: string;
  summary: string;
  rationale: string;
  constraints: string;
  uncertainty: string;
  worker: WorkerEvidence;
  toolCalls: ToolCallEvidence[];
  scriptExecutions?: ScriptExecutionEvidence[];
  intent?: IntentAssessment;
  sources?: RequestSource[];
  authoringScope?: AuthoringScope;
  scope?: FrozenModelScope;
  target?: FrozenDesignTarget;
  evidence?: EvidenceReadSet;
  evidenceUses?: EvidenceUse[];
  validator: 'room-graph-v1';
  decision: ReviewDecision;
}

interface RepositoryStateV1 {
  version: 1;
  projectId: ProjectId;
  name: string;
  revisions: Revision[];
  branches: Branch[];
}

interface RepositoryStateV2 {
  version: 2;
  projectId: ProjectId;
  name: string;
  revisions: Revision[];
  branches: Branch[];
  reviews: ProposalReview[];
}

interface RepositoryStateV3 {
  version: 3;
  projectId: ProjectId;
  name: string;
  revisions: Revision[];
  branches: Branch[];
  reviews: ProposalReview[];
  designTargets: DesignTargetsState;
  externalDependencies?: { readonly evidence: 'external'; readonly sourceBytes: 'external' };
}
export type RepositoryState = RepositoryStateV1 | RepositoryStateV2 | RepositoryStateV3;
type ModelItem = Entity | HostingRelationship;

export interface CollectionChanges<T extends ModelItem> {
  added: T[];
  removed: T[];
  modified: Array<{ id: EntityId; before: T; after: T }>;
}

export interface ModelDelta {
  entities: CollectionChanges<Entity>;
  relationships: CollectionChanges<HostingRelationship>;
}

export interface ModelConflict {
  kind: 'entity' | 'relationship';
  id: EntityId;
  base: ModelItem | null;
  left: ModelItem | null;
  right: ModelItem | null;
}

function fail(message: string): never {
  throw new Error(message);
}
const size = (text: string): number => new TextEncoder().encode(text).length;

function copy(value: unknown, depth = 0, seen: Set<object> = new Set()): JsonValue {
  if (depth > 16) fail('Model data is too deeply nested.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (typeof value !== 'object' || value === null) fail('Model data must be finite JSON values.');
  if (seen.has(value)) fail('Model data must be finite JSON values.');
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Model data must be plain objects.');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 256) fail('Model collection is too large or has unknown fields.');
  const stringKeys: string[] = [];
  for (const key of keys) {
    if (typeof key !== 'string') fail('Model collection is too large or has unknown fields.');
    stringKeys.push(key);
  }
  if (array && (value.length > 100 || keys.length !== value.length + 1)) fail('Model arrays must be dense and bounded.');
  seen.add(value);
  if (array) {
    const output: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor) fail('Model accessors are not supported.');
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('Model accessors are not supported.');
      const entry: unknown = descriptor.value;
      output.push(copy(entry, depth + 1, seen));
    }
    seen.delete(value);
    return output;
  }
  const output: JsonObject = {};
  for (const key of stringKeys.sort()) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('Unsupported model field.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) fail('Model accessors are not supported.');
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('Model accessors are not supported.');
    const entry: unknown = descriptor.value;
    output[key] = copy(entry, depth + 1, seen);
  }
  seen.delete(value);
  return output;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fields(value: JsonValue, expected: readonly string[]): asserts value is JsonObject {
  if (!value || Array.isArray(value) || typeof value !== 'object'
      || Object.keys(value).length !== expected.length
      || !expected.every((key) => Object.hasOwn(value, key))) fail('Unexpected model fields.');
}

function label(value: unknown): string {
  if (typeof value !== 'string') fail('Names must contain 1 to 80 readable characters.');
  if (!value.trim() || value.length > 80 || /[\u0000-\u001f]/.test(value)) fail('Names must contain 1 to 80 readable characters.');
  return value;
}

function isEntityId(value: unknown): value is EntityId {
  return typeof value === 'string' && idPattern.test(value);
}

export function identifier(value: unknown): EntityId {
  if (!isEntityId(value)) fail('Invalid stable identifier.');
  return value;
}

function isRevisionId(value: unknown): value is RevisionId {
  return typeof value === 'string' && revisionPattern.test(value);
}

export function revisionIdentifier(value: unknown): RevisionId {
  if (!isRevisionId(value)) fail('Invalid revision identity.');
  return value;
}

function isBranchName(value: unknown): value is BranchName {
  return typeof value === 'string' && value.length <= 64 && /^[a-z]+(?:-[a-z]+)*$/.test(value);
}

export function branchName(value: unknown): BranchName {
  if (!isBranchName(value)) fail('Proposal names require lowercase words separated by hyphens.');
  return value;
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === 'string' && requestPattern.test(value);
}

function requestIdentifier(value: unknown): RequestId {
  if (!isRequestId(value)) fail('Invalid request identity.');
  return value;
}

function isProjectId(value: unknown): value is ProjectId {
  return typeof value === 'string' && projectPattern.test(value);
}

export function projectIdentifier(value: unknown): ProjectId {
  if (!isProjectId(value)) fail('Invalid project identity.');
  return value;
}

function readable(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string') {
    fail(`${name} must contain readable text no longer than ${maximum} characters.`);
  }
  if (!value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) {
    fail(`${name} must contain readable text no longer than ${maximum} characters.`);
  }
  return value.trim();
}

function boundedInteger(value: unknown, name: string): number {
  if (typeof value !== 'number') fail(`Invalid ${name}.`);
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000) fail(`Invalid ${name}.`);
  return value;
}

function validateScriptReview(executions: ScriptExecutionEvidence[], toolCalls: ToolCallEvidence[]): void {
  const terminal = executions.at(-1);
  if (!terminal || terminal.status !== 'completed' || terminal.disposition !== 'proposal'
      || terminal.validation !== 'passed' || terminal.diagnostic !== null) {
    fail('Script reviews require a final completed and validated proposal execution.');
  }
  const fatalCodes = ['execution-integrity', 'internal', 'audit-failure', 'protocol-mismatch', 'host-failure', 'denied'];
  for (const [index, execution] of executions.entries()) {
    if (index < executions.length - 1 && (execution.disposition === 'proposal' || execution.disposition === 'declined')) {
      fail('Script reviews cannot continue after a terminal proposal or decline.');
    }
    if (execution.status === 'cancelled' || execution.status === 'timed-out' || execution.status === 'resource-limit'
        || fatalCodes.includes(execution.diagnostic?.code ?? '')
        || execution.calls.some((call) => call.disposition !== 'completed' && call.disposition !== 'app-error')) {
      fail('Script reviews cannot contain executions that lost authority.');
    }
  }
  if (toolCalls.some((call) => call.name !== 'run_model_script' && !(call.name === 'unsupported_tool' && call.status === 'rejected'))) {
    fail('Script reviews require only actual script tool calls.');
  }
  const scriptCalls = toolCalls.filter((call) => call.name === 'run_model_script');
  if (scriptCalls.length !== executions.length || toolCalls.at(-1) !== scriptCalls.at(-1)) {
    fail('Script reviews require one matching tool call per execution and no calls after the terminal proposal.');
  }
  for (const [index, execution] of executions.entries()) {
    const call = scriptCalls[index];
    const rejected = execution.disposition === 'discarded';
    if (!call || call.status !== (rejected ? 'rejected' : 'accepted')
        || call.error !== (rejected ? execution.diagnostic?.message : null)) {
      fail('Script review tool outcomes must match their execution evidence.');
    }
  }
}

/** Frozen review authority only; live evidence readiness belongs to the accepting store. */
export function assertEvidenceUsesBound(readSet: EvidenceReadSet, uses: readonly EvidenceUse[]): void {
  for (const use of uses) {
    if (!readSet.pins.some(pin => evidenceCanonical(pin) === evidenceCanonical(use.pin))
        || !readSet.subjects.some(item => evidenceCanonical(item.subject) === evidenceCanonical(use.subject))) {
      fail('Evidence uses must match exact pinned entries and frozen subjects.');
    }
  }
}

function reviewRecord(input: unknown, revisions: Map<RevisionId, Revision>, branches: Map<BranchName, Branch>, projectId: ProjectId): ProposalReview {
  const review = copy(input);
  const hasEvidence = review !== null && typeof review === 'object' && Object.hasOwn(review, 'evidence');
  const hasEvidenceUses = review !== null && typeof review === 'object' && Object.hasOwn(review, 'evidenceUses');
  const hasTarget = review !== null && typeof review === 'object' && Object.hasOwn(review, 'target');
  const hasScripts = review !== null && typeof review === 'object' && Object.hasOwn(review, 'scriptExecutions');
  const hasIntent = review !== null && typeof review === 'object' && Object.hasOwn(review, 'intent');
  const hasSources = review !== null && typeof review === 'object' && Object.hasOwn(review, 'sources');
  const hasFrozenScope = review !== null && typeof review === 'object' && Object.hasOwn(review, 'scope');
  const hasScope = review !== null && typeof review === 'object' && Object.hasOwn(review, 'authoringScope');
  fields(review, ['requestId', 'proposalName', 'baseRevisionId', 'proposalRevisionId', 'selectedObjectIds', 'instruction',
    'summary', 'rationale', 'constraints', 'uncertainty', 'worker', 'toolCalls', 'validator', 'decision',
    ...(hasScripts ? ['scriptExecutions'] : []), ...(hasIntent ? ['intent'] : []),
    ...(hasSources ? ['sources'] : []), ...(hasScope ? ['authoringScope'] : []), ...(hasFrozenScope ? ['scope'] : []), ...(hasTarget ? ['target'] : []), ...(hasEvidence ? ['evidence'] : []), ...(hasEvidenceUses ? ['evidenceUses'] : [])]);
  const requestId = requestIdentifier(review.requestId);
  const proposalName = branchName(review.proposalName);
  const baseRevisionId = revisionIdentifier(review.baseRevisionId);
  const proposalRevisionId = revisionIdentifier(review.proposalRevisionId);
  const base = revisions.get(baseRevisionId); const proposal = revisions.get(proposalRevisionId);
  const branch = branches.get(proposalName);
  if (!base) fail('Review is not bound to its proposal history.');
  if (!proposal) fail('Review is not bound to its proposal history.');
  if (proposal.parentId !== base.id || branch?.revisionId !== proposal.id) fail('Review is not bound to its proposal history.');
  const selectedValues = review.selectedObjectIds;
  if (!Array.isArray(selectedValues) || selectedValues.length < 1 || selectedValues.length > 16) fail('Invalid reviewed object identities.');
  const selectedObjectIds = selectedValues.map(identifier);
  if (new Set(selectedObjectIds).size !== selectedObjectIds.length) fail('Invalid reviewed object identities.');
  const baseObjects = new Set(base.snapshot.entities.map((entity) => entity.id));
  for (const id of selectedObjectIds) if (!baseObjects.has(id)) fail('Invalid reviewed object identity.');
  const instruction = readable(review.instruction, 'Reviewed instruction', 1000);
  const summary = readable(review.summary, 'Review summary', 240);
  const rationale = readable(review.rationale, 'Review rationale', 800);
  const constraints = readable(review.constraints, 'Review constraints', 600);
  const uncertainty = readable(review.uncertainty, 'Review uncertainty', 400);
  fields(review.worker, ['provider', 'model', 'responseIds', 'usage']);
  const provider = readable(review.worker.provider, 'Worker provider', 80);
  const model = readable(review.worker.model, 'Worker model', 100);
  const responseValues = review.worker.responseIds;
  if (!Array.isArray(responseValues) || responseValues.length > 12
      || responseValues.some((id) => !isRequestId(id))) fail('Invalid model response identities.');
  const responseIds = responseValues.map(requestIdentifier);
  fields(review.worker.usage, ['inputTokens', 'outputTokens', 'totalTokens']);
  const inputTokens = boundedInteger(review.worker.usage.inputTokens, 'input token count');
  const outputTokens = boundedInteger(review.worker.usage.outputTokens, 'output token count');
  const totalTokens = boundedInteger(review.worker.usage.totalTokens, 'total token count');
  if (totalTokens < inputTokens + outputTokens) fail('Invalid total token count.');
  const toolValues = review.toolCalls;
  if (!Array.isArray(toolValues) || toolValues.length < 1 || toolValues.length > 12) fail('Invalid model tool evidence.');
  const toolCalls: ToolCallEvidence[] = [];
  for (const call of toolValues) {
    fields(call, ['name', 'status', 'error']);
    const name = call.name;
    const status = call.status;
    const error = call.error;
    if (name !== 'run_model_script' && name !== 'inspect_model' && name !== 'preview_rectangle' && name !== 'preview_furnishings' && name !== 'preview_room_furnishings' && name !== 'preview_workstation_move' && name !== 'submit_proposal'
        && name !== 'decline_request' && name !== 'unsupported_tool') fail('Invalid model tool evidence.');
    if (status !== 'accepted' && status !== 'rejected') fail('Invalid model tool evidence.');
    if (error !== null && (typeof error !== 'string' || !error || error.length > 240)) fail('Invalid model tool evidence.');
    toolCalls.push({ name, status, error });
  }
  const scriptEvidence: Pick<ProposalReview, 'scriptExecutions'> = hasScripts ? { scriptExecutions: parseScriptExecutions(review.scriptExecutions) } : {};
  if (hasScripts || toolCalls.some((call) => call.name === 'run_model_script')) {
    if (!scriptEvidence.scriptExecutions) fail('Script reviews require execution evidence.');
    validateScriptReview(scriptEvidence.scriptExecutions, toolCalls);
  }
  const evidence = hasEvidence ? parseEvidenceReadSet(review.evidence) : undefined;
  if (evidence && (evidence.projectId !== projectId || evidence.revisionId !== baseRevisionId
      || evidence.subjects.some(item => item.subject.anchor.projectId !== projectId))) {
    fail('Evidence read set must match the exact review project and base revision.');
  }
  const target = hasTarget ? parseFrozenDesignTarget(review.target) : undefined;
  if (target && target.revisionId !== baseRevisionId) fail('Review target does not match its original base.');
  if (evidence && canonical(evidence.target) !== canonical(target?.target ?? { kind: 'main' })) {
    fail('Evidence read set target must match the review target.');
  }
  const evidenceUses = hasEvidenceUses ? parseEvidenceUses(review.evidenceUses) : undefined;
  if (evidenceUses) {
    if (!evidence) fail('Evidence uses require a frozen evidence read set.');
    assertEvidenceUsesBound(evidence, evidenceUses);
  }
  const scope = hasFrozenScope ? parseFrozenModelScope(review.scope) : undefined;
  if (scope) assertScopeBinding(base, proposal.snapshot, scope);
  if (review.validator !== 'room-graph-v1') fail('Unknown proposal validator.');
  const hasApplied = review.decision !== null && typeof review.decision === 'object' && Object.hasOwn(review.decision, 'appliedRevisionId');
  fields(review.decision, ['status', 'decisionId', 'actor', ...(hasApplied ? ['appliedRevisionId'] : [])]);
  const decisionStatus = review.decision.status;
  if (decisionStatus !== 'pending' && decisionStatus !== 'accepted' && decisionStatus !== 'superseded') fail('Invalid proposal decision.');
  let decision: ReviewDecision;
  if (decisionStatus === 'pending') {
    if (review.decision.decisionId !== null || review.decision.actor !== null || hasApplied) fail('Pending proposals cannot contain a decision identity.');
    decision = { status: 'pending', decisionId: null, actor: null };
  } else {
    const decisionId = requestIdentifier(review.decision.decisionId);
    const actor = readable(review.decision.actor, 'Decision actor', 80);
    if (hasApplied) {
      const appliedRevisionId = revisionIdentifier(review.decision.appliedRevisionId);
      const applied = revisions.get(appliedRevisionId);
      const onto = applied?.parentId ? revisions.get(applied.parentId) : undefined;
      if (!applied || !onto) fail('The applied proposal must retain its accepted predecessor.');
      let ancestor = onto;
      while (ancestor.id !== base.id && ancestor.parentId !== null) {
        const parent = revisions.get(ancestor.parentId);
        if (!parent) fail('Applied proposal ancestry is incomplete.');
        ancestor = parent;
      }
      if (ancestor.id !== base.id) fail('The applied proposal must share its original base.');
      if (scope) assertModelScopeFresh({ base: base.snapshot, current: onto.snapshot, binding: scope });
      if (canonical(mergeSnapshots(base.snapshot, onto.snapshot, proposal.snapshot)) !== canonical(applied.snapshot)) {
        fail('The applied revision does not match the reviewed proposal delta.');
      }
      decision = { status: decisionStatus, decisionId, actor, appliedRevisionId };
    } else decision = { status: decisionStatus, decisionId, actor };
  }
  return freeze({
    requestId, proposalName, baseRevisionId, proposalRevisionId, selectedObjectIds, instruction, summary, rationale,
    constraints, uncertainty, worker: { provider, model, responseIds, usage: { inputTokens, outputTokens, totalTokens } },
    toolCalls, ...scriptEvidence, ...(hasIntent ? { intent: parseIntentAssessment(review.intent) } : {}),
    ...(hasSources ? { sources: parseRequestSources(review.sources) } : {}),
    ...(hasScope ? { authoringScope: parseAuthoringScope(review.authoringScope) } : {}), ...(scope ? { scope } : {}), ...(target ? { target } : {}), ...(evidence ? { evidence } : {}),
    ...(evidenceUses ? { evidenceUses } : {}), validator: 'room-graph-v1', decision,
  });
}

function metres(value: unknown, min = 0.001, max = 100): number {
  if (typeof value !== 'number') fail('Dimensions must be bounded metres on a 1 mm grid.');
  if (!Number.isFinite(value) || value < min || value > max
      || Math.abs(Math.round(value * 1000) - value * 1000) > 0.000001) fail('Dimensions must be bounded metres on a 1 mm grid.');
  return value;
}

function point(value: unknown): Point {
  if (!Array.isArray(value) || value.length !== 2) fail('Model coordinates require two dimensions.');
  const [x, y] = value;
  return [metres(x, -1000, 1000), metres(y, -1000, 1000)];
}

function wallLength(wall: Wall): number {
  return Math.hypot(
    Math.round(wall.end[0] * 1000) - Math.round(wall.start[0] * 1000),
    Math.round(wall.end[1] * 1000) - Math.round(wall.start[1] * 1000),
  ) / 1000;
}

function parseBounds(input: JsonValue): Bounds {
  fields(input, ['minX', 'minY', 'maxX', 'maxY']);
  const bounds = { minX: metres(input.minX, -1000, 1000), minY: metres(input.minY, -1000, 1000),
    maxX: metres(input.maxX, -1000, 1000), maxY: metres(input.maxY, -1000, 1000) };
  if (bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) fail('Bounds must have positive width and depth.');
  return bounds;
}

function parseEntity(input: JsonValue, building = false): Entity {
  if (!input || Array.isArray(input) || typeof input !== 'object') fail('Unexpected model fields.');
  if (Object.hasOwn(input, 'parameters')) {
    const { parameters, ...geometry } = input;
    return { ...parseEntity(geometry, building), parameters: parseCustomModelParameters(parameters) };
  }
  if (input.type === 'AssetFamily') return parseAssetFamily(input);
  if (input.type === 'AssetInstance') return parseAssetInstance(input);
  if (building && (input.type === 'Wall' || input.type === 'Furniture' || input.type === 'Equipment')) {
    const { levelId: rawLevel, ...geometry } = input;
    const levelId = identifier(rawLevel);
    const entity = parseEntity(geometry);
    if (entity.type !== 'Wall' && entity.type !== 'Furniture' && entity.type !== 'Equipment') fail('Invalid owned geometry.');
    return { ...entity, levelId };
  }
  if (building && input.type === 'Slab') {
    fields(input, ['id', 'type', 'name', 'levelId', 'bounds', 'thickness']);
    return { id: identifier(input.id), type: 'Slab', name: label(input.name), levelId: identifier(input.levelId),
      bounds: parseBounds(input.bounds), thickness: metres(input.thickness, .001, 5) };
  }
  if (building && input.type === 'Stair') {
    fields(input, ['id', 'type', 'name', 'fromLevelId', 'toLevelId', 'start', 'end', 'width', 'steps']);
    const steps = input.steps;
    if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 1 || steps > 100) fail('Stairs require one to one hundred whole steps.');
    return { id: identifier(input.id), type: 'Stair', name: label(input.name),
      fromLevelId: identifier(input.fromLevelId), toLevelId: identifier(input.toLevelId),
      start: point(input.start), end: point(input.end), width: metres(input.width, .1, 5), steps };
  }
  if (building && input.type === 'Roof') {
    fields(input, ['id', 'type', 'name', 'levelId', 'bounds', 'thickness', 'profile']);
    const profile = input.profile;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) fail('Unsupported roof profile.');
    let parsed: RoofProfile;
    if (profile.kind === 'flat') {
      fields(profile, ['kind', 'height']);
      parsed = { kind: 'flat', height: metres(profile.height) };
    } else if (profile.kind === 'gable') {
      fields(profile, ['kind', 'eaveHeight', 'ridgeHeight', 'ridgeAxis']);
      if (profile.ridgeAxis !== 'x' && profile.ridgeAxis !== 'y') fail('Gable ridge axis must be x or y.');
      parsed = { kind: 'gable', eaveHeight: metres(profile.eaveHeight), ridgeHeight: metres(profile.ridgeHeight), ridgeAxis: profile.ridgeAxis };
      if (parsed.ridgeHeight <= parsed.eaveHeight) fail('Gable ridge must be higher than its eaves.');
    } else return fail('Unsupported roof profile.');
    return { id: identifier(input.id), type: 'Roof', name: label(input.name), levelId: identifier(input.levelId),
      bounds: parseBounds(input.bounds), thickness: metres(input.thickness, .001, 5), profile: parsed };
  }
  if (input.type === 'Level') fields(input, ['id', 'type', 'name', 'elevation']);
  else if (input.type === 'Space') fields(input, ['id', 'type', 'name', 'levelId', 'bounds']);
  else if (input.type === 'Wall') fields(input, ['id', 'type', 'name', 'start', 'end', 'thickness', 'height']);
  else if (input.type === 'Door') fields(input, ['id', 'type', 'name', 'width', 'height']);
  else if (input.type === 'Window') fields(input, ['id', 'type', 'name', 'width', 'height', 'sillHeight']);
  else if (input.type === 'Equipment') {
    fields(input, ['id', 'type', 'name', 'category', 'position', 'elevation', 'width', 'depth', 'height']);
  } else if (input.type === 'Furniture') {
    fields(input, ['id', 'type', 'name', 'kind', 'position', 'width', 'depth', 'height', 'rotationDeg', 'supportId']);
  } else return fail('Only supported building entities are accepted.');
  const id = identifier(input.id);
  const name = label(input.name);
  if (input.type === 'Level') {
    if (!building && input.elevation !== 0) fail('This prototype supports one level at elevation zero.');
    return { id, type: 'Level', name, elevation: building ? metres(input.elevation, -100, 100) : 0 };
  }
  if (input.type === 'Space') {
    fields(input.bounds, ['minX', 'minY', 'maxX', 'maxY']);
    return { id, type: 'Space', name, levelId: identifier(input.levelId), bounds: {
      minX: metres(input.bounds.minX, -1000, 1000), minY: metres(input.bounds.minY, -1000, 1000),
      maxX: metres(input.bounds.maxX, -1000, 1000), maxY: metres(input.bounds.maxY, -1000, 1000),
    } };
  }
  if (input.type === 'Wall') {
      const entity: Wall = {
        id, type: 'Wall', name, start: point(input.start), end: point(input.end),
        thickness: metres(input.thickness), height: metres(input.height),
      };
      const length = Math.hypot(entity.end[0] - entity.start[0], entity.end[1] - entity.start[1]);
      // Measure the minimum on the validated grid: a 1 mm edge near 1000 m can subtract to slightly less.
      if (wallLength(entity) < 0.001 || length > 1000) fail('Wall length is outside the demo bounds.');
      return entity;
  }
  if (input.type === 'Door') return {
    id, type: 'Door', name, width: metres(input.width), height: metres(input.height),
  };
  if (input.type === 'Window') return {
    id, type: 'Window', name, width: metres(input.width), height: metres(input.height),
    sillHeight: metres(input.sillHeight, 0, 100),
  };
  if (input.type === 'Furniture') {
    const kind = FURNITURE_KINDS.find((kind) => kind === input.kind);
    if (!kind) fail('Unsupported furnishing kind.');
    const rotationDeg = input.rotationDeg;
    if (rotationDeg !== 0 && rotationDeg !== 90 && rotationDeg !== 180 && rotationDeg !== 270) fail('Furniture rotation must be 0, 90, 180 or 270 degrees.');
    return {
      id, type: 'Furniture', name, kind, position: point(input.position),
      width: metres(input.width, 0.05, 5), depth: metres(input.depth, 0.05, 5),
      height: metres(input.height, 0.02, 3), rotationDeg,
      supportId: input.supportId === null ? null : identifier(input.supportId),
    };
  }
  if (input.category !== 'mechanical' && input.category !== 'electrical') fail('Unsupported equipment category.');
  return {
    id, type: 'Equipment', name, category: input.category, position: point(input.position),
    elevation: metres(input.elevation, 0, 100), width: metres(input.width),
    depth: metres(input.depth), height: metres(input.height),
  };
}

function parseRelationship(input: JsonValue): HostingRelationship {
  fields(input, ['id', 'type', 'source', 'target', 'offset']);
  if (input.type !== 'hosted-by') fail('Invalid or duplicate hosting relationship.');
  return {
    id: identifier(input.id), type: 'hosted-by', source: identifier(input.source),
    target: identifier(input.target), offset: metres(input.offset, 0, 1000),
  };
}

/** Shape-only hydration boundary; a partial graph is not an engineering-valid project. */
export function parseModelEntity(value: unknown, building: boolean): Entity {
  return parseEntity(copy(value), building);
}

/** Shape-only relationship hydration; endpoint existence requires validateSnapshot. */
export function parseModelRelationship(value: unknown): HostingRelationship {
  return parseRelationship(copy(value));
}

export function furnitureFootprint(item: Furniture): { minX: number; minY: number; maxX: number; maxY: number } {
  const sideways = item.rotationDeg === 90 || item.rotationDeg === 270;
  const width = sideways ? item.depth : item.width;
  const depth = sideways ? item.width : item.depth;
  return { minX: item.position[0] - width / 2, maxX: item.position[0] + width / 2,
    minY: item.position[1] - depth / 2, maxY: item.position[1] + depth / 2 };
}

function footprintCorners(bounds: Bounds): Point[] {
  return [[bounds.minX, bounds.minY], [bounds.minX, bounds.maxY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY]];
}

function isLegacyEntity(entity: Entity): entity is LegacyEntity {
  return entity.type !== 'Slab' && entity.type !== 'Stair' && entity.type !== 'Roof';
}

function isBuildingEntity(entity: Entity): entity is BuildingEntity {
  return (entity.type !== 'Wall' && entity.type !== 'Furniture' && entity.type !== 'Equipment')
    || ('levelId' in entity && typeof entity.levelId === 'string');
}

function validateFurnishings(entities: readonly Entity[], relationships: readonly HostingRelationship[], graph?: ModelGraph): void {
  const items = entities.filter((item): item is Furniture => item.type === 'Furniture');
  if (!items.length) return;
  if (items.length > 32) fail('The prototype supports at most 32 furnishings.');
  const walls = entities.filter((item): item is Wall => item.type === 'Wall');
  const rooms = spaces({ units: 'm', entities, relationships });
  if ((!rooms.length && walls.length !== 4) || walls.some((wall) => wall.start[0] !== wall.end[0] && wall.start[1] !== wall.end[1])) {
    fail('Furnishing placement requires a rectangular room shell.');
  }
  const minX = Math.min(...walls.flatMap((wall) => [wall.start[0], wall.end[0]]));
  const minY = Math.min(...walls.flatMap((wall) => [wall.start[1], wall.end[1]]));
  const maxX = Math.max(...walls.flatMap((wall) => [wall.start[0], wall.end[0]]));
  const maxY = Math.max(...walls.flatMap((wall) => [wall.start[1], wall.end[1]]));
  const inset = Math.max(...walls.map((wall) => wall.thickness / 2));
  const contains = (outer: ReturnType<typeof furnitureFootprint>, inner: ReturnType<typeof furnitureFootprint>): boolean =>
    inner.minX >= outer.minX - 1e-9 && inner.maxX <= outer.maxX + 1e-9
    && inner.minY >= outer.minY - 1e-9 && inner.maxY <= outer.maxY + 1e-9;
  const overlaps = (a: ReturnType<typeof furnitureFootprint>, b: ReturnType<typeof furnitureFootprint>): boolean =>
    a.minX < b.maxX - 1e-9 && a.maxX > b.minX + 1e-9 && a.minY < b.maxY - 1e-9 && a.maxY > b.minY + 1e-9;
  for (const item of items) {
    const footprint = furnitureFootprint(item);
    const device = item.kind === 'monitor' || item.kind === 'laptop';
    const support = entities.find((entity) => entity.id === item.supportId);
    if (device) {
      if (!support || support.type !== 'Furniture' || (support.kind !== 'desk' && support.kind !== 'table')
          || support.supportId !== null || !contains(furnitureFootprint(support), footprint)) {
        fail(`${item.name} requires a desk/table support containing its entire footprint.`);
      }
      if (support.height + item.height > Math.min(...walls.map((wall) => wall.height))) fail('Supported device must fit below the room ceiling.');
    } else if (item.supportId !== null) fail('Floor furnishings cannot have a support.');
    if (rooms.length && !spaceForFootprint({ units: 'm', entities, relationships }, footprint)) {
      fail(`${item.name} must fit inside one room, clear of shared wall thickness.`);
    }
    if (!rooms.length && !contains({ minX: minX + inset, maxX: maxX - inset, minY: minY + inset, maxY: maxY - inset }, footprint)) {
      fail(`${item.name} must fit inside the room, clear of wall thickness.`);
    }
    if (item.height > Math.min(...walls.map((wall) => wall.height))) fail('Furniture must fit below the room ceiling.');
    if (graph?.version === 2) {
      const level = entityLevel(graph, item);
      const top = item.height + (device && support?.type === 'Furniture' ? support.height : 0);
      if (!level || footprintCorners(footprint).some((point) => top > roofHeightAt(graph, level.id, point) + 1e-9)) {
        fail('Furniture and supported devices must fit below the roof underside.');
      }
      if (graph.entities.some((stair) => stair.type === 'Stair' && overlaps(footprint, stairFootprint(stair)))) {
        fail('Furniture must remain clear of stairs and slab voids.');
      }
    }
  }
  for (const item of items) {
    const footprint = furnitureFootprint(item);
    const device = item.kind === 'monitor' || item.kind === 'laptop';
    for (const other of items) {
      if (item.id >= other.id || item.supportId !== other.supportId) continue;
      if (overlaps(footprint, furnitureFootprint(other))) fail(`${item.name} and ${other.name} overlap.`);
    }
    if (device) continue;
    for (const equipment of entities) {
      if (equipment.type !== 'Equipment' || equipment.elevation >= item.height) continue;
      const [x, y] = equipment.position;
      if (overlaps(footprint, { minX: x - equipment.width / 2, maxX: x + equipment.width / 2,
        minY: y - equipment.depth / 2, maxY: y + equipment.depth / 2 })) fail(`${item.name} overlaps existing equipment.`);
    }
    for (const relation of relationships) {
      const opening = entities.find((entity) => entity.id === relation.source);
      const wall = walls.find((entity) => entity.id === relation.target);
      if (opening?.type !== 'Door' || !wall) continue;
      const zone = doorClearanceBounds(graph ?? { units: 'm', entities, relationships }, opening);
      if (overlaps(footprint, zone)) fail(`${item.name} blocks the door clearance zone.`);
    }
  }
}

/** Replace the complete furnishing set; building geometry and equipment remain untouched. */
export function previewFurnishings(baseSnapshot: unknown, input: unknown): ModelSnapshot {
  const base = validateSnapshot(baseSnapshot);
  const value = copy(input);
  const hasAssignments = value !== null && typeof value === 'object' && Object.hasOwn(value, 'levelAssignments');
  fields(value, hasAssignments ? ['furnishings', 'levelAssignments'] : ['furnishings']);
  if (!Array.isArray(value.furnishings) || value.furnishings.length > 32) fail('Provide up to 32 furnishings.');
  const furnishings = value.furnishings.map((item) => { const entity = parseEntity(item);
    return retainModelParameters(base.entities.find((existing) => existing.id === entity.id), entity); });
  if (furnishings.some((item) => item.type !== 'Furniture')) fail('Only furnishings can be changed by this tool.');
  const assignments = new Map<EntityId, EntityId>();
  if (hasAssignments) {
    if (base.version !== 2) fail('Level assignments require a version-2 building.');
    if (!Array.isArray(value.levelAssignments) || value.levelAssignments.length > 32) fail('Provide up to 32 level assignments.');
    for (const assignment of value.levelAssignments) {
      fields(assignment, ['entityId', 'levelId']);
      const entityId = identifier(assignment.entityId); const levelId = identifier(assignment.levelId);
      if (assignments.has(entityId) || !furnishings.some((item) => item.id === entityId)) fail('Level assignments must uniquely identify incoming furnishings.');
      if (!levels(base).some((level) => level.id === levelId)) fail('Level assignment references an unknown level.');
      assignments.set(entityId, levelId);
    }
  }
  const owned = base.version !== 2 ? furnishings : furnishings.map((item) => {
    const existing = base.entities.find((entity) => entity.id === item.id && entity.type === 'Furniture');
    const levelId = assignments.get(item.id) ?? (existing ? entityLevel(base, existing)?.id : undefined);
    if (!levelId) fail('New building furnishings require an explicit level assignment.');
    return { ...item, levelId };
  });
  return validateSnapshot({ ...base, entities: [...base.entities.filter((item) => item.type !== 'Furniture'), ...owned] });
}

/** A room-bounded replacement cannot remove or transfer furnishings in adjacent spaces. */
export function previewRoomFurnishings(baseSnapshot: unknown, input: unknown): ModelSnapshot {
  const base = validateSnapshot(baseSnapshot);
  const value = copy(input);
  fields(value, ['roomId', 'furnishings']);
  const room = spaces(base).find((item) => item.id === value.roomId);
  if (!room) fail('Choose a room from the bound floor.');
  if (!Array.isArray(value.furnishings) || value.furnishings.length > 32) fail('Provide up to 32 room furnishings.');
  const incoming = value.furnishings.map((item) => { const entity = parseEntity(item);
    return retainModelParameters(base.entities.find((existing) => existing.id === entity.id), entity); });
  const view = base.version === 2 ? levelView(base, room.levelId) : base;
  for (const item of incoming) {
    if (item.type !== 'Furniture') fail('Only furnishings can be changed by this tool.');
    const existing = base.entities.find((entity) => entity.id === item.id);
    if (base.version === 2 && existing && entityLevel(base, existing)?.id !== room.levelId) fail('Room furnishing changes cannot transfer objects between levels.');
    if (spaceForFootprint(view, furnitureFootprint(item))?.id !== room.id) fail('Room furnishing changes must remain inside the selected room, clear of shared walls. Use the whole-floor tool for explicit transfers.');
  }
  const retained = base.entities.filter((item): item is Furniture => item.type === 'Furniture'
    && (base.version === 2 && entityLevel(base, item)?.id !== room.levelId || spaceForFootprint(view, furnitureFootprint(item))?.id !== room.id));
  const unowned = retained.map((item) => { const { id, type, name, kind, position, width, depth, height, rotationDeg, supportId } = item;
    return { id, type, name, kind, position, width, depth, height, rotationDeg, supportId }; });
  return previewFurnishings(base, { furnishings: [...unowned, ...incoming], ...(base.version === 2
    ? { levelAssignments: incoming.map((item) => ({ entityId: item.id, levelId: room.levelId })) } : {}) });
}

/** Atomically upsert inert recipes/placements; shell geometry and all other entities stay intact. */
export function previewAssets(baseSnapshot: unknown, input: unknown): ModelSnapshot {
  const base = validateSnapshot(baseSnapshot);
  const edit = parseAssetEdit(input);
  const byId = new Map<EntityId, Entity>(base.entities.map((item) => [item.id, item]));
  const touched = new Set<EntityId>();
  for (const requestedFamily of edit.families) {
    const family = retainModelParameters(byId.get(requestedFamily.id), requestedFamily);
    if (touched.has(family.id)) fail('Asset edit identities must be unique.');
    touched.add(family.id);
    const existing = byId.get(family.id);
    if (existing && (existing.type !== 'AssetFamily' || canonical(existing) !== canonical(family))) {
      fail('Family IDs are immutable. Register a new family ID for a changed recipe.');
    }
    byId.set(family.id, family);
  }
  for (const instance of edit.instances) {
    if (touched.has(instance.id)) fail('Asset edit identities must be unique.');
    touched.add(instance.id);
    const existing = byId.get(instance.id);
    if (existing && existing.type !== 'AssetInstance') fail('Asset edits cannot replace protected model entities.');
    byId.set(instance.id, retainModelParameters(existing, instance));
  }
  for (const id of edit.removeInstanceIds) {
    if (touched.has(id)) fail('An instance cannot be removed and upserted in the same edit.');
    touched.add(id);
    if (byId.get(id)?.type !== 'AssetInstance') fail('Only existing asset instances can be removed.');
    byId.delete(id);
  }
  return validateSnapshot({ ...base, entities: [...byId.values()] });
}

export function validateSnapshot(input: unknown): ModelSnapshot {
  const value = copy(input);
  const building = value !== null && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'version');
  fields(value, building ? ['version', 'units', 'entities', 'relationships'] : ['units', 'entities', 'relationships']);
  if (building && value.version !== 2) fail('Unsupported model snapshot version.');
  if (value.units !== 'm') fail('Unsupported model snapshot.');
  const entityValues = value.entities;
  const relationshipValues = value.relationships;
  if (!Array.isArray(entityValues) || !Array.isArray(relationshipValues)
      || entityValues.length > 100 || relationshipValues.length > 100) fail('Unsupported model snapshot.');
  const byEntityId = new Map<EntityId, Entity>();
  const entities: Entity[] = [];
  for (const item of entityValues) {
    const entity = parseEntity(item, building);
    if (byEntityId.has(entity.id)) fail('Duplicate entity identifier.');
    byEntityId.set(entity.id, entity);
    entities.push(entity);
  }
  const parameterDefinitions = new Map<string, { name: string; kind: string }>();
  for (const entity of byEntityId.values()) for (const parameter of entity.parameters ?? []) {
    const previous = parameterDefinitions.get(parameter.definitionId);
    if (previous && (previous.name !== parameter.name || previous.kind !== parameter.value.kind)) fail('Parameter definition identity and value kind must agree across the model.');
    parameterDefinitions.set(parameter.definitionId, { name: parameter.name, kind: parameter.value.kind });
  }
  const relationIds = new Set<EntityId>();
  const hosted = new Set<EntityId>();
  const relationships: HostingRelationship[] = [];
  for (const item of relationshipValues) {
    const relation = parseRelationship(item);
    if (relationIds.has(relation.id) || hosted.has(relation.source)) fail('Invalid or duplicate hosting relationship.');
    const opening = byEntityId.get(relation.source); const wall = byEntityId.get(relation.target);
    if (!opening || (opening.type !== 'Door' && opening.type !== 'Window')) {
      fail('Hosting references must identify an opening and wall.');
    }
    if (!wall || wall.type !== 'Wall') fail('Hosting references must identify an opening and wall.');
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    if (relation.offset + opening.width > length + 1e-9 || opening.height > wall.height) {
      fail('Hosted opening must fit inside its wall.');
    }
    relationIds.add(relation.id); hosted.add(relation.source); relationships.push(relation);
  }
  if (entities.some((entity) => (entity.type === 'Door' || entity.type === 'Window') && !hosted.has(entity.id))) {
    fail('Every opening must have exactly one host.');
  }
  const graph: ModelGraph = { ...(building ? { version: 2 as const } : {}), units: 'm', entities, relationships };
  validateFloorPlan(graph);
  if (building) {
    if (entities.filter((item) => item.type === 'Furniture').length > 32) fail('The prototype supports at most 32 furnishings.');
    for (const level of levels(graph)) {
      const view = levelView(graph, level.id);
      validateFurnishings(view.entities, view.relationships, view);
    }
  } else validateFurnishings(entities, relationships);
  validateAssets(graph);
  const byId = (a: ModelItem, b: ModelItem): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  entities.sort(byId); relationships.sort(byId);
  if (building && entities.every(isBuildingEntity)) return freeze({ version: 2, units: 'm', entities, relationships });
  if (!building && entities.every(isLegacyEntity)) return freeze({ units: 'm', entities, relationships });
  return fail('Snapshot entity format does not match its version.');
}

function cloneSnapshot(snapshot: ModelSnapshot): ModelSnapshot {
  return structuredClone(snapshot);
}

function registerFamilyIdentities(known: Map<EntityId, string>, snapshot: ModelSnapshot): void {
  for (const entity of snapshot.entities) if (entity.type === 'AssetFamily') {
    const recipe = canonical(entity);
    const previous = known.get(entity.id);
    if (previous !== undefined && previous !== recipe) fail('Family IDs are immutable across repository history. Register a new family ID.');
    known.set(entity.id, recipe);
  }
}

function fixture(): ModelSnapshot {
  const sides: Array<{ side: string; start: Point; end: Point }> = [
    { side: 'south', start: [0, 0], end: [6, 0] },
    { side: 'east', start: [6, 0], end: [6, 4] },
    { side: 'north', start: [6, 4], end: [0, 4] },
    { side: 'west', start: [0, 4], end: [0, 0] },
  ];
  return validateSnapshot({ units: 'm', entities: [
    ...sides.map(({ side, start, end }) => ({ id: `wall-${side}`, type: 'Wall', name: `${side.charAt(0).toUpperCase()}${side.slice(1)} wall`, start, end, thickness: 0.2, height: 3 })),
    { id: 'door-entry', type: 'Door', name: 'Entry door', width: 0.9, height: 2.1 },
  ], relationships: [{ id: 'host-entry', type: 'hosted-by', source: 'door-entry', target: 'wall-south', offset: 2.4 }] });
}

interface RectangleModel {
  snapshot: ModelSnapshot;
  boundsMm: RoomLayout['boundsMm'];
  door: Door;
}

function rectangle(input: unknown): RectangleModel {
  const snapshot = validateSnapshot(input);
  if (spaces(snapshot).length) fail('A multi-room floor cannot be resized as one room. Request room-aware furnishing changes instead.');
  const walls = snapshot.entities.filter((entity): entity is Wall => entity.type === 'Wall');
  const door = snapshot.entities.find((entity): entity is Door => entity.type === 'Door' && entity.id === 'door-entry');
  if (walls.length !== 4 || !door || snapshot.entities.filter((entity) => entity.type === 'Door').length !== 1) {
    fail('Interactive editing requires four rectangular walls and one hosted entry door.');
  }
  const millimetres = ([x, y]: Point): Point => [Math.round(x * 1000), Math.round(y * 1000)];
  const edges: Array<[Point, Point]> = walls.map((wall) => [millimetres(wall.start), millimetres(wall.end)]);
  const corners: Point[] = edges.flat();
  const minX = Math.min(...corners.map((point) => point[0]));
  const maxX = Math.max(...corners.map((point) => point[0]));
  const minY = Math.min(...corners.map((point) => point[1]));
  const maxY = Math.max(...corners.map((point) => point[1]));
  const sides = new Set<string>();
  for (const [[sx, sy], [ex, ey]] of edges) {
    let side: string | undefined;
    if (sy === ey && Math.min(sx, ex) === minX && Math.max(sx, ex) === maxX) {
      if (sy === minY) side = 'south';
      else if (sy === maxY) side = 'north';
    } else if (sx === ex && Math.min(sy, ey) === minY && Math.max(sy, ey) === maxY) {
      if (sx === minX) side = 'west';
      else if (sx === maxX) side = 'east';
    }
    if (!side) fail('Interactive editing requires a connected axis-aligned rectangle.');
    if (sides.has(side)) fail('Interactive editing requires a connected axis-aligned rectangle.');
    sides.add(side);
  }
  if (minX >= maxX || minY >= maxY) fail('Interactive editing requires a positive rectangular area.');
  return { snapshot, boundsMm: { minX, minY, maxX, maxY }, door };
}

function integerMm(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number') fail('Layout dimensions must be bounded whole millimetres.');
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('Layout dimensions must be bounded whole millimetres.');
  return value;
}

export function rectangleLayout(snapshot: unknown): RoomLayout {
  const room = rectangle(snapshot);
  const relationship = room.snapshot.relationships.find((item) => item.source === room.door.id);
  if (!relationship) fail('Interactive editing requires one hosted entry door.');
  return freeze({ boundsMm: room.boundsMm, door: {
    widthMm: Math.round(room.door.width * 1000),
    offsetMm: Math.round(relationship.offset * 1000),
  } });
}

function parseLayout(input: unknown): RoomLayout {
  const layout = copy(input);
  fields(layout, ['boundsMm', 'door']);
  fields(layout.boundsMm, ['minX', 'minY', 'maxX', 'maxY']);
  fields(layout.door, ['widthMm', 'offsetMm']);
  return {
    boundsMm: {
      minX: integerMm(layout.boundsMm.minX, -1000000, 1000000),
      minY: integerMm(layout.boundsMm.minY, -1000000, 1000000),
      maxX: integerMm(layout.boundsMm.maxX, -1000000, 1000000),
      maxY: integerMm(layout.boundsMm.maxY, -1000000, 1000000),
    },
    door: {
      widthMm: integerMm(layout.door.widthMm, 1, 100000),
      offsetMm: integerMm(layout.door.offsetMm, 0, 1000000),
    },
  };
}

export function previewRectangle(baseSnapshot: unknown, input: unknown): ModelSnapshot {
  const layout = parseLayout(input);
  const { minX, minY, maxX, maxY } = layout.boundsMm;
  const width = maxX - minX; const depth = maxY - minY;
  if (width <= 0 || depth <= 0 || width > 1000000 || depth > 1000000) fail('Room spans must be between 1 and 1000000 millimetres.');
  const base = rectangle(baseSnapshot);
  const snapshot = cloneSnapshot(base.snapshot);
  const host = snapshot.relationships.find((item) => item.source === base.door.id);
  if (!host) fail('Interactive editing requires one hosted entry door.');
  const hostWall = snapshot.entities.find((entity) => entity.id === host.target);
  if (!hostWall || hostWall.type !== 'Wall') fail('Hosting references must identify a door and wall.');
  const hostLength = Math.round(hostWall.start[1] * 1000) === Math.round(hostWall.end[1] * 1000) ? width : depth;
  if (layout.door.offsetMm + layout.door.widthMm > hostLength) fail('Door opening must fit inside its host wall.');
  for (const entity of snapshot.entities) {
    if (entity.type === 'Wall') {
      const move = ([x, y]: Point): Point => [
        (Math.round(x * 1000) === base.boundsMm.minX ? minX : maxX) / 1000,
        (Math.round(y * 1000) === base.boundsMm.minY ? minY : maxY) / 1000,
      ];
      entity.start = move(entity.start);
      entity.end = move(entity.end);
    } else if (entity.id === base.door.id && entity.type === 'Door') entity.width = layout.door.widthMm / 1000;
  }
  host.offset = layout.door.offsetMm / 1000;
  return validateSnapshot(snapshot);
}

async function revision(parentId: RevisionId | null, snapshot: ModelSnapshot): Promise<Revision> {
  const bytes = new TextEncoder().encode(canonical({ version: 1, parentId, snapshot }));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const id = revisionIdentifier(Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(''));
  return freeze({ id, parentId, snapshot });
}

function changes<T extends ModelItem>(before: T[], after: T[]): CollectionChanges<T> {
  const left = new Map<EntityId, T>(before.map((item) => [item.id, item]));
  const right = new Map<EntityId, T>(after.map((item) => [item.id, item]));
  return {
    added: after.filter((item) => !left.has(item.id)),
    removed: before.filter((item) => !right.has(item.id)),
    modified: after.flatMap((item) => {
      const previous = left.get(item.id);
      return previous && canonical(item) !== canonical(previous) ? [{ id: item.id, before: previous, after: item }] : [];
    }),
  };
}

export function diffSnapshots(before: unknown, after: unknown): ModelDelta {
  const left = validateSnapshot(before); const right = validateSnapshot(after);
  return freeze({ entities: changes<Entity>(left.entities, right.entities), relationships: changes(left.relationships, right.relationships) });
}

function branchMap(branches: Branch[]): Map<BranchName, Branch> {
  const result = new Map<BranchName, Branch>();
  for (const branch of branches) result.set(branch.name, branch);
  return result;
}

function collectionConflicts<T extends ModelItem>(
  kind: ModelConflict['kind'],
  base: T[],
  left: T[],
  right: T[],
): ModelConflict[] {
  const originalById = new Map<EntityId, T>(base.map((item) => [item.id, item]));
  const leftById = new Map<EntityId, T>(left.map((item) => [item.id, item]));
  const rightById = new Map<EntityId, T>(right.map((item) => [item.id, item]));
  const ids = [...new Set([...originalById.keys(), ...leftById.keys(), ...rightById.keys()])].sort();
  const conflicts: ModelConflict[] = [];
  for (const id of ids) {
    const original = originalById.get(id) ?? null;
    const a = leftById.get(id) ?? null;
    const b = rightById.get(id) ?? null;
    if (canonical(a) !== canonical(original) && canonical(b) !== canonical(original) && canonical(a) !== canonical(b)) {
      conflicts.push({ kind, id, base: original, left: a, right: b });
    }
  }
  return conflicts;
}

function assertScopeBinding(base: Revision, after: ModelSnapshot, binding: FrozenModelScope): void {
  if (binding.baseRevisionId !== base.id) fail('Frozen scope must identify the exact proposal base revision.');
  const expected = freezeModelScope({ graph: base.snapshot, query: binding.query, baseRevisionId: base.id });
  if (canonical(expected) !== canonical(binding)) fail('Frozen scope evidence does not match the proposal base.');
  assertModelScopeFresh({ base: base.snapshot, current: base.snapshot, binding });
  assertModelScopeWrites({ before: base.snapshot, after, binding });
}

export class ProposalConflict extends Error {}

function mergeCollection<T extends ModelItem>(base: T[], current: T[], proposed: T[]): T[] {
  const original = new Map(base.map((item) => [item.id, item]));
  const incoming = new Map(proposed.map((item) => [item.id, item]));
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const id of new Set([...original.keys(), ...incoming.keys()])) {
    const before = original.get(id); const after = incoming.get(id);
    if (canonical(before ?? null) === canonical(after ?? null)) continue;
    if (after) merged.set(id, after); else merged.delete(id);
  }
  return [...merged.values()];
}

function mergeSnapshots(base: ModelSnapshot, current: ModelSnapshot, proposed: ModelSnapshot): ModelSnapshot {
  if (canonical(base) === canonical(current)) return proposed;
  if (base.version !== current.version || base.version !== proposed.version) {
    throw new ProposalConflict('The model representation changed. Revise this proposal against the current model.');
  }
  const conflicts = [
    ...collectionConflicts<Entity>('entity', base.entities, current.entities, proposed.entities),
    ...collectionConflicts('relationship', base.relationships, current.relationships, proposed.relationships),
  ];
  if (conflicts.length) throw new ProposalConflict(`Conflicting changes to ${conflicts.map((item) => item.id).join(', ')}. Revise this proposal against the current model.`);
  try {
    return validateSnapshot({ ...current,
      entities: mergeCollection<Entity>(base.entities, current.entities, proposed.entities),
      relationships: mergeCollection(base.relationships, current.relationships, proposed.relationships) });
  } catch (error) {
    throw new ProposalConflict(`The combined changes fail model validation: ${error instanceof Error ? error.message : 'invalid model'}. Revise this proposal against the current model.`);
  }
}

export class RoomRepository {
  #state: RepositoryState;
  #revisions: Map<RevisionId, Revision>;

  constructor(key: symbol, state: RepositoryState) {
    if (key !== token) fail('Use RoomRepository.create or restore.');
    const branches = [...state.branches].sort((a, b) =>
      a.name === b.name ? 0 : a.name === 'main' ? -1 : b.name === 'main' ? 1 : a.name < b.name ? -1 : 1);
    this.#state = freeze({ ...state, branches });
    this.#revisions = new Map<RevisionId, Revision>(state.revisions.map((item) => [item.id, item]));
    Object.freeze(this);
  }

  static async create(name = 'Courtyard study'): Promise<RoomRepository> {
    return RoomRepository.createProject({
      projectId: globalThis.crypto.randomUUID(),
      name,
      snapshot: fixture(),
    });
  }

  static async createProject(input: unknown): Promise<RoomRepository> {
    const value = copy(input);
    fields(value, ['projectId', 'name', 'snapshot']);
    const validatedName = label(value.name);
    const initial = await revision(null, validateSnapshot(value.snapshot));
    const state: RepositoryStateV2 = {
      version: 2,
      projectId: projectIdentifier(value.projectId),
      name: validatedName,
      revisions: [initial],
      branches: [{ name: branchName('main'), revisionId: initial.id }],
      reviews: [],
    };
    return new RoomRepository(token, state);
  }

  static async restore(text: unknown): Promise<RoomRepository> {
    if (typeof text !== 'string' || size(text) > MAX_BYTES) fail('Saved project exceeds the 256 KiB demo limit.');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { fail('Saved project is not valid bounded JSON.'); }
    const value = copy(parsed);
    if (!value || Array.isArray(value) || typeof value !== 'object' || !Array.isArray(value.revisions) || value.revisions.length > 32) fail('Unsupported saved project.');
    for (const item of value.revisions) {
      fields(item, ['id', 'parentId', 'snapshot']);
      const id = revisionIdentifier(item.id);
      const parentId = item.parentId === null ? null : revisionIdentifier(item.parentId);
      const validated = await revision(parentId, validateSnapshot(item.snapshot));
      if (validated.id !== id) fail('Saved revision content does not match its hash.');
    }
    return RoomRepository.#restoreState(value);
  }

  /** Storage has already verified revision hashes; synchronously check native authority. */
  static assertDesignTargetAuthority(input: unknown): void {
    const repository = RoomRepository.#restoreState(input);
    if (repository.#state.version !== 3) fail('Target authority requires envelope version 3.');
  }

  static #restoreState(input: unknown): RoomRepository {
    const value = copy(input);
    if (!value || Array.isArray(value) || typeof value !== 'object') fail('Unsupported saved project.');
    if (value.version === 1) fields(value, ['version', 'projectId', 'name', 'revisions', 'branches']);
    else if (value.version === 2) fields(value, ['version', 'projectId', 'name', 'revisions', 'branches', 'reviews']);
    else if (value.version === 3) fields(value, ['version', 'projectId', 'name', 'revisions', 'branches', 'reviews', 'designTargets',
      ...(Object.hasOwn(value, 'externalDependencies') ? ['externalDependencies'] : [])]);
    else fail('Unsupported saved project.');
    const name = label(value.name);
    const projectId = projectIdentifier(value.projectId);
    const revisionValues = value.revisions;
    const branchValues = value.branches;
    if (!Array.isArray(revisionValues) || !revisionValues.length || revisionValues.length > 32
        || !Array.isArray(branchValues) || !branchValues.length || branchValues.length > 32) fail('Unsupported saved project.');
    const reviewValues = value.version !== 1 ? value.reviews : [];
    const targets = value.version === 3 ? parseDesignTargets(value.designTargets, branchName) : undefined;
    if (!Array.isArray(reviewValues) || reviewValues.length > 31) fail('Unsupported saved project.');
    const revisions = new Map<RevisionId, Revision>();
    const familyIdentities = new Map<EntityId, string>();
    for (const item of revisionValues) {
      fields(item, ['id', 'parentId', 'snapshot']);
      const id = revisionIdentifier(item.id);
      const parentId = item.parentId === null ? null : revisionIdentifier(item.parentId);
      if (revisions.has(id)) fail('Invalid revision identity.');
      const validated: Revision = { id, parentId, snapshot: validateSnapshot(item.snapshot) };
      registerFamilyIdentities(familyIdentities, validated.snapshot);
      revisions.set(id, validated);
    }
    const roots = [...revisions.values()].filter((item) => item.parentId === null);
    if (roots.length !== 1) fail('The original room revision must be preserved.');
    const root = roots[0];
    if (!root) fail('The original room revision must be preserved.');
    for (const item of revisions.values()) {
      const seen = new Set<RevisionId>(); let current = item;
      while (current.parentId !== null) {
        if (seen.has(current.id)) fail('Revision ancestry contains a cycle.');
        seen.add(current.id);
        const parent = revisions.get(current.parentId);
        if (!parent) fail('Revision ancestry is incomplete.');
        current = parent;
      }
    }
    const branches = new Map<BranchName, Branch>(); const reachable = new Set<RevisionId>();
    for (const rawBranch of branchValues) {
      fields(rawBranch, ['name', 'revisionId']);
      const branch: Branch = { name: branchName(rawBranch.name), revisionId: revisionIdentifier(rawBranch.revisionId) };
      if (branches.has(branch.name) || !revisions.has(branch.revisionId)) fail('Invalid branch target or duplicate branch.');
      branches.set(branch.name, branch);
      if (value.version === 1 && branch.name === 'main' && branch.revisionId !== root.id) fail('Version one main must preserve the original revision.');
      let current = revisions.get(branch.revisionId);
      while (current) {
        reachable.add(current.id);
        current = current.parentId === null ? undefined : revisions.get(current.parentId);
      }
    }
    if (targets) {
      for (const id of [...targets.baselines.map(item => item.from.revisionId), ...targets.alternatives.map(item => item.revisionId)]) {
        let current = revisions.get(id);
        if (!current) fail('Missing design target revision.');
        while (current) { reachable.add(current.id); current = current.parentId === null ? undefined : revisions.get(current.parentId); }
      }
    }
    if (!branches.has(branchName('main')) || reachable.size !== revisions.size) fail('Saved project has missing or unreachable history.');
    const reviews: ProposalReview[] = [];
    if (value.version !== 1) {
      const requests = new Set<RequestId>(); const proposals = new Set<BranchName>();
      for (const item of reviewValues) {
        const review = reviewRecord(item, revisions, branches, projectId);
        if (requests.has(review.requestId) || proposals.has(review.proposalName)) fail('Duplicate proposal review identity.');
        requests.add(review.requestId); proposals.add(review.proposalName); reviews.push(review);
      }
      if (!targets && reviews.some(review => review.target || review.evidence)) fail('Target/evidence reviews require envelope version 3.');
      const mainBranch = branches.get(branchName('main'));
      if (!mainBranch) fail('Saved project has missing or unreachable history.');
      const main = mainBranch.revisionId;
      if (!targets && main !== roots[0].id && !reviews.some((review) => review.decision.status === 'accepted' && (review.decision.appliedRevisionId ?? review.proposalRevisionId) === main)) {
        fail('The current model must reference an accepted reviewed proposal.');
      }
      for (const review of reviews) {
        if (targets || review.decision.status === 'pending' || !review.decision.appliedRevisionId) continue;
        const onto = revisions.get(review.decision.appliedRevisionId)?.parentId;
        if (!reviews.some((item) => item.decision.status !== 'pending'
            && (item.decision.appliedRevisionId ?? item.proposalRevisionId) === onto)) fail('Proposal application must preserve an accepted predecessor.');
      }
    }
    const externalDependencies: RepositoryStateV3['externalDependencies'] = reviews.some(review => review.evidence)
      ? { evidence: 'external', sourceBytes: 'external' } : undefined;
    if (externalDependencies) {
      fields(value.externalDependencies, ['evidence', 'sourceBytes']);
      if (value.externalDependencies.evidence !== 'external' || value.externalDependencies.sourceBytes !== 'external') {
        fail('Portable evidence pins require external dependencies; source bytes are not included.');
      }
    } else if (Object.hasOwn(value, 'externalDependencies')) fail('Unexpected external evidence dependency declaration.');
    const restored: RepositoryState = value.version === 1
      ? { version: 1, projectId, name, revisions: [...revisions.values()], branches: [...branches.values()] }
      : targets ? { version: 3, projectId, name, revisions: [...revisions.values()], branches: [...branches.values()], reviews, designTargets: targets, ...(externalDependencies ? { externalDependencies } : {}) }
      : { version: 2, projectId, name, revisions: [...revisions.values()], branches: [...branches.values()], reviews };
    const repository = new RoomRepository(token, restored);
    if (targets) repository.#validateTargets();
    return repository;
  }

  get name(): string { return this.#state.name; }

  get projectId(): ProjectId { return this.#state.projectId; }

  #targets(): DesignTargetsState | undefined {
    return this.#state.version === 3 ? this.#state.designTargets : undefined;
  }

  #next(revisions = this.#state.revisions, branches = this.#state.branches,
    reviews = this.reviews(), targets = this.#targets()): RoomRepository {
    if (revisions.length > 32 || branches.length > 32 || reviews.length > 31) fail('Unsupported saved project. Demo history is full.');
    if (reviews.some(review => review.evidence)) targets ??= { baselines: [], alternatives: [], proposals: [] };
    const externalDependencies: RepositoryStateV3['externalDependencies'] = reviews.some(review => review.evidence)
      ? { evidence: 'external', sourceBytes: 'external' } : undefined;
    const common = { projectId: this.projectId, name: this.name, revisions, branches };
    const state: RepositoryState = targets
      ? { ...common, version: 3, reviews, designTargets: parseDesignTargets(targets, branchName), ...(externalDependencies ? { externalDependencies } : {}) }
      : this.#state.version === 1 && reviews.length === 0 ? { ...common, version: 1 }
      : { ...common, version: 2, reviews };
    if (size(canonical(state)) > MAX_BYTES) fail('Saved project exceeds the 256 KiB demo limit.');
    const repository = new RoomRepository(token, state);
    if (targets) repository.#validateTargets();
    return repository;
  }

  #targetHead(target: WritableDesignTarget): RevisionId {
    if (target.kind === 'main') return this.head('main');
    const alternative = this.#targets()?.alternatives.find(item => item.id === target.id);
    if (!alternative) fail('Unknown design alternative.');
    return alternative.revisionId;
  }

  freezeDesignTarget(input: unknown): FrozenDesignTarget {
    const target = parseWritableDesignTarget(input);
    return freeze({ projectId: this.projectId, target, revisionId: this.#targetHead(target) });
  }

  #frozen(input: unknown, current: boolean): FrozenDesignTarget {
    const target = parseFrozenDesignTarget(input);
    if (target.projectId !== this.projectId) fail('Design target belongs to another project.');
    const head = this.#targetHead(target.target);
    if (current && head !== target.revisionId) fail('Frozen design target has advanced.');
    this.view(target.revisionId);
    return target;
  }

  captureBaseline(input: { id: string; name: string; from: FrozenDesignTarget }): RoomRepository {
    const value = copy(input); fields(value, ['id', 'name', 'from']);
    const from = this.#frozen(value.from, true);
    const targets = this.#targets() ?? { baselines: [], alternatives: [], proposals: [] };
    if (targets.baselines.some(item => item.id === value.id)) fail('Baseline identity is immutable.');
    return this.#next(undefined, undefined, undefined, { ...targets,
      baselines: [...targets.baselines, { id: identifier(value.id), name: label(value.name), from }] });
  }

  forkAlternative(input: { id: string; name: string; baselineId: string }): RoomRepository {
    const value = copy(input); fields(value, ['id', 'name', 'baselineId']);
    const targets = this.#targets();
    const baseline = targets?.baselines.find(item => item.id === value.baselineId);
    if (!targets || !baseline) fail('Unknown immutable baseline.');
    if (targets.alternatives.some(item => item.id === value.id)) fail('Alternative identity already exists.');
    return this.#next(undefined, undefined, undefined, { ...targets, alternatives: [...targets.alternatives,
      { id: identifier(value.id), name: label(value.name), baselineId: baseline.id, revisionId: baseline.from.revisionId }] });
  }

  designTargets(): readonly DesignTargetView[] {
    const targets = this.#targets();
    const result: DesignTargetView[] = [
      { target: { kind: 'main' }, name: 'Main', revisionId: this.head('main') },
      ...(targets?.baselines.map((item): DesignTargetView => ({ target: { kind: 'baseline', id: item.id }, name: item.name, revisionId: item.from.revisionId })) ?? []),
      ...(targets?.alternatives.map((item): DesignTargetView => ({ target: { kind: 'alternative', id: item.id }, name: item.name, revisionId: item.revisionId })) ?? []),
    ];
    return freeze(result);
  }

  designView(input: unknown): { target: DesignTarget; revisionId: RevisionId; snapshot: ModelSnapshot;
    baselineRevisionId: RevisionId; delta: ModelDelta } {
    const target = parseDesignTarget(input);
    const selected = this.designTargets().find(item => item.target.kind === target.kind
      && (target.kind === 'main' || (item.target.kind !== 'main' && item.target.id === target.id)));
    if (!selected) fail('Unknown design target.');
    const alternative = target.kind === 'alternative' ? this.#targets()?.alternatives.find(item => item.id === target.id) : undefined;
    const baseline = this.#targets()?.baselines.find(item => item.id === alternative?.baselineId);
    const baselineRevisionId = baseline?.from.revisionId ?? (target.kind === 'baseline' ? selected.revisionId : this.root());
    return freeze({ target, revisionId: selected.revisionId, snapshot: this.view(selected.revisionId).snapshot,
      baselineRevisionId, delta: this.compare(baselineRevisionId, selected.revisionId) });
  }

  #validateTargets(): void {
    const targets = this.#targets();
    if (!targets) return;
    const main: WritableDesignTarget = { kind: 'main' };
    const reviewTarget = (review: ProposalReview): WritableDesignTarget => review.target?.target ?? main;
    for (const binding of targets.proposals) {
      const head = this.view(this.head(binding.proposalName));
      if (binding.proposalName === 'main' || binding.target.projectId !== this.projectId
          || head.parentId !== binding.target.revisionId) fail('Invalid frozen proposal target.');
      this.#targetHead(binding.target.target);
    }
    for (const review of this.reviews()) {
      const binding = targets.proposals.find(item => item.proposalName === review.proposalName);
      if (canonical(binding?.target ?? null) !== canonical(review.target ?? null)) fail('Review target binding mismatch.');
    }
    const chains = new Map<string, Set<RevisionId>>(); const visiting = new Set<string>();
    const key = (target: WritableDesignTarget): string => target.kind === 'main' ? 'main' : `alternative:${target.id}`;
    const chain = (target: WritableDesignTarget): Set<RevisionId> => {
      const identity = key(target); const cached = chains.get(identity);
      if (cached) return cached;
      if (visiting.has(identity)) fail('Cyclic baseline authority.');
      visiting.add(identity);
      const alternative = target.kind === 'alternative' ? targets.alternatives.find(item => item.id === target.id) : undefined;
      const baseline = alternative ? targets.baselines.find(item => item.id === alternative.baselineId) : undefined;
      if (target.kind === 'alternative' && !baseline) fail('Missing alternative baseline.');
      if (baseline && (baseline.from.projectId !== this.projectId || !chain(baseline.from.target).has(baseline.from.revisionId))) {
        fail('Baseline must pin accepted target ancestry.');
      }
      const origin = baseline?.from.revisionId ?? this.root(); const head = this.#targetHead(target);
      const accepted = new Set<RevisionId>(); let id = head;
      while (id !== origin) {
        if (accepted.has(id)) fail('Cyclic accepted target ancestry.');
        accepted.add(id);
        const decisions = this.reviews().filter(review => sameDesignTarget(reviewTarget(review), target)
          && review.decision.status !== 'pending' && (review.decision.appliedRevisionId ?? review.proposalRevisionId) === id);
        const review = decisions[0];
        if (decisions.length !== 1 || !review || review.decision.status === 'pending') fail('Target head requires exact native accepted review ancestry.');
        if (review.decision.status !== (id === head ? 'accepted' : 'superseded')) fail('Target-local decision status mismatch.');
        const parent = this.view(id).parentId;
        if (!parent) fail('Target acceptance must extend its baseline.');
        id = parent;
      }
      accepted.add(origin); chains.set(identity, accepted); visiting.delete(identity);
      for (const review of this.reviews().filter(item => sameDesignTarget(reviewTarget(item), target))) {
        if (!accepted.has(review.baseRevisionId)) fail('Proposal base is outside accepted target ancestry.');
        if (review.target && review.target.projectId !== this.projectId) fail('Review target belongs to another project.');
        if (review.decision.status !== 'pending' && !accepted.has(review.decision.appliedRevisionId ?? review.proposalRevisionId)) {
          fail('Decision is outside accepted target ancestry.');
        }
      }
      return accepted;
    };
    chain(main);
    for (const alternative of targets.alternatives) chain({ kind: 'alternative', id: alternative.id });
    for (const baseline of targets.baselines) {
      if (baseline.from.projectId !== this.projectId || !chain(baseline.from.target).has(baseline.from.revisionId)) {
        fail('Baseline must pin accepted target ancestry.');
      }
    }
    for (const binding of targets.proposals) {
      if (!chain(binding.target.target).has(binding.target.revisionId)) fail('Proposal base is outside accepted target ancestry.');
    }
    const decisionIds = this.reviews().filter(item => item.decision.status !== 'pending').map(item => item.decision.decisionId);
    if (new Set(decisionIds).size !== decisionIds.length) fail('Duplicate human decision identity.');
  }

  root(): RevisionId {
    const root = this.#state.revisions.find((item) => item.parentId === null);
    if (!root) fail('Revision ancestry is incomplete.');
    return root.id;
  }

  head(name: string): RevisionId {
    const validatedName = branchName(name);
    const branch = this.#state.branches.find((item) => item.name === validatedName);
    if (!branch) fail('Unknown branch.');
    return branch.revisionId;
  }

  view(id: string): Revision {
    if (!isRevisionId(id)) fail('Unknown revision.');
    const value = this.#revisions.get(id);
    if (!value) fail('Unknown revision.');
    return value;
  }

  branches(): Branch[] { return this.#state.branches; }

  reviews(): ProposalReview[] { return this.#state.version !== 1 ? this.#state.reviews : []; }

  review(name: string): ProposalReview {
    const proposalName = branchName(name);
    const value = this.reviews().find((item) => item.proposalName === proposalName);
    if (!value) fail('Unknown reviewed proposal.');
    return value;
  }

  reviewAt(revisionId: string): { review: ProposalReview; comparisonBaseRevisionId: RevisionId } | null {
    const selected = this.view(revisionId);
    for (const review of this.reviews()) {
      if (review.proposalRevisionId === selected.id) return freeze({ review, comparisonBaseRevisionId: review.baseRevisionId });
      if (review.decision.status !== 'pending' && review.decision.appliedRevisionId === selected.id && selected.parentId !== null) {
        return freeze({ review, comparisonBaseRevisionId: selected.parentId });
      }
    }
    return null;
  }

  #reviewTarget(review: ProposalReview, input: unknown): FrozenDesignTarget | undefined {
    if (!review.target) {
      if (input !== undefined) fail('Legacy reviews retain their original main target binding.');
      return undefined;
    }
    const target = this.#frozen(input, false);
    if (canonical(target) !== canonical(review.target)) fail('Frozen proposal target mismatch; proposals cannot be retargeted.');
    return target;
  }

  #decision(input: unknown): { decisionId: RequestId; actor: string } {
    const value = copy(input); fields(value, ['decisionId', 'actor']);
    return { decisionId: requestIdentifier(value.decisionId), actor: readable(value.actor, 'Decision actor', 80) };
  }

  #advance(review: ProposalReview, applied: Revision, decision: { decisionId: RequestId; actor: string },
    revisions: Revision[], branches: Branch[], reviews: ProposalReview[], targets = this.#targets()): RoomRepository {
    const target: WritableDesignTarget = review.target?.target ?? { kind: 'main' };
    if (reviews.some(item => item.proposalName !== review.proposalName && item.decision.decisionId === decision.decisionId)) fail('Duplicate human decision identity.');
    const nextBranches = target.kind === 'main' ? branches.map(item => item.name === 'main' ? { ...item, revisionId: applied.id } : item) : branches;
    const nextTargets = targets && target.kind === 'alternative' ? { ...targets,
      alternatives: targets.alternatives.map(item => item.id === target.id ? { ...item, revisionId: applied.id } : item) } : targets;
    const nextReviews = reviews.map((item): ProposalReview => item.proposalName === review.proposalName
      ? { ...item, decision: { status: 'accepted', ...decision,
        ...(applied.id !== review.proposalRevisionId ? { appliedRevisionId: applied.id } : {}) } }
      : item.decision.status === 'accepted' && sameDesignTarget(item.target?.target ?? { kind: 'main' }, target)
        ? { ...item, decision: { ...item.decision, status: 'superseded' } } : item);
    return this.#next(revisions, nextBranches, nextReviews, nextTargets);
  }

  accept(name: string, input: unknown, target?: FrozenDesignTarget): RoomRepository {
    const proposalName = branchName(name);
    if (proposalName === 'main') fail('Choose a proposal to accept.');
    const proposal = this.#state.branches.find(item => item.name === proposalName);
    if (!proposal) fail('Unknown proposal.');
    const review = this.review(proposalName); this.#reviewTarget(review, target);
    const decision = this.#decision(input);
    if (review.decision.status !== 'pending') {
      if (review.decision.status === 'accepted' && review.decision.decisionId === decision.decisionId
          && review.decision.actor === decision.actor) return this;
      fail('This proposal already has a different human decision.');
    }
    const head = this.#targetHead(review.target?.target ?? { kind: 'main' });
    if (head !== review.baseRevisionId) fail('Accepting an older proposal requires reconciliation with the current model.');
    if (review.scope) assertScopeBinding(this.view(head), this.view(proposal.revisionId).snapshot, review.scope);
    return this.#advance(review, this.view(proposal.revisionId), decision, this.#state.revisions, this.#state.branches, this.reviews());
  }

  proposalSnapshot(proposed: RoomRepository, name: string, target?: FrozenDesignTarget): ModelSnapshot {
    if (proposed.projectId !== this.projectId || proposed.root() !== this.root()) fail('The proposal belongs to another project.');
    const review = proposed.review(name);
    this.#reviewTarget(review, target);
    const base = this.#revisions.get(review.baseRevisionId);
    if (!base) throw new ProposalConflict('This proposal is based on an unaccepted model. Revise it against the current accepted model.');
    const head = this.#targetHead(review.target?.target ?? { kind: 'main' });
    let ancestor = this.view(head);
    while (ancestor.id !== base.id && ancestor.parentId !== null) ancestor = this.view(ancestor.parentId);
    if (ancestor.id !== base.id) throw new ProposalConflict('This proposal is based on an unaccepted model. Revise it against the current accepted model.');
    if (review.scope) {
      assertScopeBinding(base, proposed.view(review.proposalRevisionId).snapshot, review.scope);
      assertModelScopeFresh({ base: base.snapshot, current: this.view(head).snapshot, binding: review.scope });
    }
    return mergeSnapshots(base.snapshot, this.view(head).snapshot, proposed.view(review.proposalRevisionId).snapshot);
  }

  async acceptFrom(proposed: RoomRepository, name: string, input: unknown, target?: FrozenDesignTarget): Promise<RoomRepository> {
    const snapshot = this.proposalSnapshot(proposed, name, target);
    const review = proposed.review(name); const decision = this.#decision(input);
    if (review.decision.status !== 'pending') fail('Only a pending reviewed proposal can be accepted.');
    const previous = this.reviews().find(item => item.proposalName === review.proposalName);
    if (previous && previous.decision.status !== 'pending') fail('This proposal already has a decision.');
    if (previous && canonical(previous) !== canonical(review)) fail('Proposal review evidence changed.');
    const head = this.#targetHead(review.target?.target ?? { kind: 'main' });
    const proposal = proposed.view(review.proposalRevisionId);
    const applied = head === review.baseRevisionId ? proposal : await revision(head, snapshot);
    const revisions = new Map(this.#revisions);
    revisions.set(proposal.id, proposal); revisions.set(applied.id, applied);
    const branches = branchMap(this.#state.branches); const existing = branches.get(review.proposalName);
    if (existing && existing.revisionId !== proposal.id) fail('A different proposal already uses that name.');
    branches.set(review.proposalName, { name: review.proposalName, revisionId: proposal.id });
    const reviews = previous ? this.reviews() : [...this.reviews(), review];
    let targets = this.#targets();
    if (review.target) {
      targets ??= { baselines: [], alternatives: [], proposals: [] };
      const binding = targets.proposals.find(item => item.proposalName === review.proposalName);
      if (binding && canonical(binding.target) !== canonical(review.target)) fail('Proposal target evidence changed.');
      if (!binding) targets = { ...targets, proposals: [...targets.proposals, { proposalName: review.proposalName, target: review.target }] };
    }
    const accepted = this.#advance(review, applied, decision, [...revisions.values()], [...branches.values()], reviews, targets);
    return RoomRepository.restore(accepted.serialize());
  }

  #proposalTarget(value: JsonObject, from: string): FrozenDesignTarget | undefined {
    if (!Object.hasOwn(value, 'target')) {
      if (this.#state.version === 3) fail('New proposals require an explicit frozen design target.');
      return undefined;
    }
    const target = this.#frozen(value.target, true);
    if (target.revisionId !== from) fail('Proposal source revision must match its frozen design target.');
    return target;
  }

  async propose(input: unknown): Promise<RoomRepository> {
    const proposal = copy(input);
    const hasFrozenScope = proposal !== null && typeof proposal === 'object' && Object.hasOwn(proposal, 'scope');
    fields(proposal, ['name', 'from', 'doorWidthM', ...(hasFrozenScope ? ['scope'] : []), ...(proposal !== null && typeof proposal === 'object' && Object.hasOwn(proposal, 'target') ? ['target'] : [])]);
    const name = branchName(proposal.name);
    const from = proposal.from;
    if (typeof from !== 'string') fail('Unknown revision.');
    const doorWidthM = metres(proposal.doorWidthM);
    const base = this.view(from);
    const snapshot = cloneSnapshot(base.snapshot);
    const door = snapshot.entities.find((item): item is Door => item.id === 'door-entry' && item.type === 'Door');
    if (!door) fail('This revision has no entry door.');
    door.width = doorWidthM;
    return this.#commit(name, base, snapshot, hasFrozenScope ? parseFrozenModelScope(proposal.scope) : undefined, this.#proposalTarget(proposal, from));
  }

  async proposeLayout(input: unknown): Promise<RoomRepository> {
    const proposal = copy(input);
    const hasFrozenScope = proposal !== null && typeof proposal === 'object' && Object.hasOwn(proposal, 'scope');
    fields(proposal, ['name', 'from', 'layout', ...(hasFrozenScope ? ['scope'] : []), ...(proposal !== null && typeof proposal === 'object' && Object.hasOwn(proposal, 'target') ? ['target'] : [])]);
    const name = branchName(proposal.name);
    const from = proposal.from;
    if (typeof from !== 'string') fail('Unknown revision.');
    const layout = proposal.layout;
    const base = this.view(from);
    return this.#commit(name, base, previewRectangle(base.snapshot, layout), hasFrozenScope ? parseFrozenModelScope(proposal.scope) : undefined, this.#proposalTarget(proposal, from));
  }

  async proposeReviewedModel(input: unknown): Promise<RoomRepository> {
    const proposal = copy(input);
    fields(proposal, ['name', 'from', 'snapshot', 'review', ...(proposal !== null && typeof proposal === 'object' && Object.hasOwn(proposal, 'target') ? ['target'] : [])]);
    const proposalName = branchName(proposal.name);
    const from = proposal.from;
    if (typeof from !== 'string') fail('Unknown revision.');
    const details = proposal.review;
    const hasEvidence = details !== null && typeof details === 'object' && Object.hasOwn(details, 'evidence');
    const hasEvidenceUses = details !== null && typeof details === 'object' && Object.hasOwn(details, 'evidenceUses');
    const hasScripts = details !== null && typeof details === 'object' && Object.hasOwn(details, 'scriptExecutions');
    const hasIntent = details !== null && typeof details === 'object' && Object.hasOwn(details, 'intent');
    const hasSources = details !== null && typeof details === 'object' && Object.hasOwn(details, 'sources');
    const hasFrozenScope = details !== null && typeof details === 'object' && Object.hasOwn(details, 'scope');
    const hasScope = details !== null && typeof details === 'object' && Object.hasOwn(details, 'authoringScope');
    fields(details, ['requestId', 'selectedObjectIds', 'instruction', 'summary', 'rationale', 'constraints',
      'uncertainty', 'worker', 'toolCalls', 'validator', ...(hasScripts ? ['scriptExecutions'] : []), ...(hasIntent ? ['intent'] : []),
      ...(hasSources ? ['sources'] : []), ...(hasScope ? ['authoringScope'] : []), ...(hasFrozenScope ? ['scope'] : []), ...(hasEvidence ? ['evidence'] : []), ...(hasEvidenceUses ? ['evidenceUses'] : [])]);
    const base = this.view(from);
    const target = this.#proposalTarget(proposal, from);
    const next = await this.#commit(proposalName, base, proposal.snapshot, hasFrozenScope ? parseFrozenModelScope(details.scope) : undefined, target);
    if (next === this) fail('The reviewed proposal must change the bound revision.');
    const record = reviewRecord({
      requestId: details.requestId, proposalName, baseRevisionId: base.id,
      proposalRevisionId: next.head(proposalName), selectedObjectIds: details.selectedObjectIds,
      instruction: details.instruction, summary: details.summary, rationale: details.rationale,
      constraints: details.constraints, uncertainty: details.uncertainty, worker: details.worker,
      toolCalls: details.toolCalls, validator: details.validator,
      ...(hasScripts ? { scriptExecutions: details.scriptExecutions } : {}),
      ...(hasIntent ? { intent: details.intent } : {}),
      ...(hasSources ? { sources: details.sources } : {}),
      ...(hasScope ? { authoringScope: details.authoringScope } : {}),
      ...(hasFrozenScope ? { scope: details.scope } : {}),
      ...(target ? { target } : {}),
      ...(hasEvidence ? { evidence: details.evidence } : {}),
      ...(hasEvidenceUses ? { evidenceUses: details.evidenceUses } : {}),
      decision: { status: 'pending', decisionId: null, actor: null },
    }, next.#revisions, branchMap(next.#state.branches), this.projectId);
    const reviews = [...next.reviews(), record];
    if (reviews.some((item, index) => reviews.findIndex((other) => other.requestId === item.requestId || other.proposalName === item.proposalName) !== index)) {
      fail('Duplicate proposal review identity.');
    }
    return next.#next(undefined, undefined, reviews);
  }

  async proposeWallShift(input: { name: string; from: string; target: FrozenDesignTarget;
    shift: WallShiftRequest; review: unknown }): Promise<{ repository: RoomRepository; impacts: WallShiftImpact[]; delta: ModelDelta }> {
    const value = copy(input); fields(value, ['name', 'from', 'target', 'shift', 'review']);
    const target = this.#frozen(value.target, true);
    if (target.revisionId !== value.from) fail('Proposal source revision must match its frozen design target.');
    fields(value.shift, ['wallId', 'offsetMetres']);
    if (typeof value.shift.wallId !== 'string' || typeof value.shift.offsetMetres !== 'number') fail('Invalid wall shift request.');
    const preview = previewWallShift(this.view(target.revisionId).snapshot, { wallId: value.shift.wallId, offsetMetres: value.shift.offsetMetres });
    const repository = await this.proposeReviewedModel({ name: value.name, from: target.revisionId, target,
      snapshot: preview.snapshot, review: value.review });
    return freeze({ repository, impacts: preview.impacts, delta: preview.delta });
  }

  async #commit(name: BranchName, base: Revision, snapshot: unknown, scope?: FrozenModelScope, target?: FrozenDesignTarget): Promise<RoomRepository> {
    if (name === 'main') fail('Choose a proposal name other than main.');
    const candidate = validateSnapshot(snapshot);
    const updated = validateSnapshot({ ...candidate, entities: candidate.entities.map((entity) =>
      retainModelParameters(base.snapshot.entities.find((before) => before.id === entity.id && before.type === entity.type), entity)) });
    if (scope) assertScopeBinding(base, updated, scope);
    const familyIdentities = new Map<EntityId, string>();
    for (const revision of this.#state.revisions) registerFamilyIdentities(familyIdentities, revision.snapshot);
    registerFamilyIdentities(familyIdentities, updated);
    const next = canonical(updated) === canonical(base.snapshot) ? base : await revision(base.id, updated);
    const existing = this.#state.branches.find((item) => item.name === name);
    if (existing) {
      const binding = this.#targets()?.proposals.find(item => item.proposalName === name);
      if (canonical(binding?.target ?? null) !== canonical(target ?? null)) fail('A proposal cannot be retargeted.');
      if (existing.revisionId === next.id) return this;
      fail('A different proposal already uses that name.');
    }
    if (next === base) return this;
    const revisions = this.#revisions.has(next.id) ? this.#state.revisions : [...this.#state.revisions, next];
    if (revisions.length > 32 || this.#state.branches.length >= 32) fail('Demo history is full. Export it before starting another project.');
    const branches: Branch[] = [...this.#state.branches, { name, revisionId: next.id }];
    let targets = this.#targets();
    if (target) {
      targets ??= { baselines: [], alternatives: [], proposals: [] };
      targets = { ...targets, proposals: [...targets.proposals, { proposalName: name, target }] };
    }
    return this.#next(revisions, branches, undefined, targets);
  }

  compare(before: string, after: string): ModelDelta { return diffSnapshots(this.view(before).snapshot, this.view(after).snapshot); }

  conflicts(baseId: string, leftId: string, rightId: string): ModelConflict[] {
    const validatedBaseId = revisionIdentifier(baseId);
    const ancestor = (id: string): void => {
      let current = this.view(id);
      while (current.id !== validatedBaseId && current.parentId !== null) current = this.view(current.parentId);
      if (current.id !== validatedBaseId) fail('Comparison requires a shared ancestor.');
    };
    ancestor(leftId); ancestor(rightId);
    const base = this.view(validatedBaseId).snapshot;
    const left = this.view(leftId).snapshot; const right = this.view(rightId).snapshot;
    return freeze([
      ...collectionConflicts<Entity>('entity', base.entities, left.entities, right.entities),
      ...collectionConflicts('relationship', base.relationships, left.relationships, right.relationships),
    ]);
  }

  /** Validated, deeply frozen state for durable storage; callers cannot author through this view. */
  persistence(): RepositoryState { return this.#state; }

  serialize(): string { return canonical(this.#state); }
}
