import { validateFloorPlan, spaces, spaceForFootprint } from './floor-plan.ts';

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

export interface Wall {
  id: EntityId;
  type: 'Wall';
  name: string;
  start: Point;
  end: Point;
  thickness: number;
  height: number;
}

export interface Door {
  id: EntityId;
  type: 'Door';
  name: string;
  width: number;
  height: number;
}

export interface Window {
  id: EntityId;
  type: 'Window';
  name: string;
  width: number;
  height: number;
  sillHeight: number;
}

export interface Equipment {
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
export interface Furniture {
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
export interface Level { id: EntityId; type: 'Level'; name: string; elevation: 0 }
export interface Space { id: EntityId; type: 'Space'; name: string; levelId: EntityId; bounds: Bounds }

export type Entity = Wall | Door | Window | Equipment | Furniture | Level | Space;

export interface HostingRelationship {
  id: EntityId;
  type: 'hosted-by';
  source: EntityId;
  target: EntityId;
  offset: number;
}

export interface ModelSnapshot {
  units: 'm';
  entities: Entity[];
  relationships: HostingRelationship[];
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

type ToolCallName = 'inspect_model' | 'preview_rectangle' | 'preview_furnishings' | 'preview_room_furnishings' | 'preview_workstation_move' | 'submit_proposal' | 'decline_request' | 'unsupported_tool';
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
  | { status: 'accepted' | 'superseded'; decisionId: RequestId; actor: string };

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

type RepositoryState = RepositoryStateV1 | RepositoryStateV2;
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

function identifier(value: unknown): EntityId {
  if (!isEntityId(value)) fail('Invalid stable identifier.');
  return value;
}

function isRevisionId(value: unknown): value is RevisionId {
  return typeof value === 'string' && revisionPattern.test(value);
}

function revisionIdentifier(value: unknown): RevisionId {
  if (!isRevisionId(value)) fail('Invalid revision identity.');
  return value;
}

function isBranchName(value: unknown): value is BranchName {
  return typeof value === 'string' && value.length <= 64 && /^[a-z]+(?:-[a-z]+)*$/.test(value);
}

function branchName(value: unknown): BranchName {
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

function projectIdentifier(value: unknown): ProjectId {
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

function reviewRecord(input: unknown, revisions: Map<RevisionId, Revision>, branches: Map<BranchName, Branch>): ProposalReview {
  const review = copy(input);
  fields(review, ['requestId', 'proposalName', 'baseRevisionId', 'proposalRevisionId', 'selectedObjectIds', 'instruction',
    'summary', 'rationale', 'constraints', 'uncertainty', 'worker', 'toolCalls', 'validator', 'decision']);
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
    if (name !== 'inspect_model' && name !== 'preview_rectangle' && name !== 'preview_furnishings' && name !== 'preview_room_furnishings' && name !== 'preview_workstation_move' && name !== 'submit_proposal'
        && name !== 'decline_request' && name !== 'unsupported_tool') fail('Invalid model tool evidence.');
    if (status !== 'accepted' && status !== 'rejected') fail('Invalid model tool evidence.');
    if (error !== null && (typeof error !== 'string' || !error || error.length > 240)) fail('Invalid model tool evidence.');
    toolCalls.push({ name, status, error });
  }
  if (review.validator !== 'room-graph-v1') fail('Unknown proposal validator.');
  fields(review.decision, ['status', 'decisionId', 'actor']);
  const decisionStatus = review.decision.status;
  if (decisionStatus !== 'pending' && decisionStatus !== 'accepted' && decisionStatus !== 'superseded') fail('Invalid proposal decision.');
  let decision: ReviewDecision;
  if (decisionStatus === 'pending') {
    if (review.decision.decisionId !== null || review.decision.actor !== null) fail('Pending proposals cannot contain a decision identity.');
    decision = { status: 'pending', decisionId: null, actor: null };
  } else {
    const decisionId = requestIdentifier(review.decision.decisionId);
    const actor = readable(review.decision.actor, 'Decision actor', 80);
    decision = { status: decisionStatus, decisionId, actor };
  }
  return freeze({
    requestId, proposalName, baseRevisionId, proposalRevisionId, selectedObjectIds, instruction, summary, rationale,
    constraints, uncertainty, worker: { provider, model, responseIds, usage: { inputTokens, outputTokens, totalTokens } },
    toolCalls, validator: 'room-graph-v1', decision,
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

function parseEntity(input: JsonValue): Entity {
  if (!input || Array.isArray(input) || typeof input !== 'object') fail('Unexpected model fields.');
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
    if (input.elevation !== 0) fail('This prototype supports one level at elevation zero.');
    return { id, type: 'Level', name, elevation: 0 };
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

export function furnitureFootprint(item: Furniture): { minX: number; minY: number; maxX: number; maxY: number } {
  const sideways = item.rotationDeg === 90 || item.rotationDeg === 270;
  const width = sideways ? item.depth : item.width;
  const depth = sideways ? item.width : item.depth;
  return { minX: item.position[0] - width / 2, maxX: item.position[0] + width / 2,
    minY: item.position[1] - depth / 2, maxY: item.position[1] + depth / 2 };
}

function validateFurnishings(entities: Entity[], relationships: HostingRelationship[]): void {
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
      const length = wallLength(wall);
      const dx = (wall.end[0] - wall.start[0]) / length;
      const dy = (wall.end[1] - wall.start[1]) / length;
      const x1 = wall.start[0] + dx * relation.offset;
      const y1 = wall.start[1] + dy * relation.offset;
      const x2 = x1 + dx * opening.width; const y2 = y1 + dy * opening.width;
      const clearance = Math.max(0.9, opening.width);
      const zone = rooms.length
        ? dx !== 0
          ? { minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minY: y1 - clearance, maxY: y1 + clearance }
          : { minY: Math.min(y1, y2), maxY: Math.max(y1, y2), minX: x1 - clearance, maxX: x1 + clearance }
        : dx !== 0
        ? { minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minY: wall.start[1] === minY ? minY : maxY - clearance, maxY: wall.start[1] === minY ? minY + clearance : maxY }
        : { minY: Math.min(y1, y2), maxY: Math.max(y1, y2), minX: wall.start[0] === minX ? minX : maxX - clearance, maxX: wall.start[0] === minX ? minX + clearance : maxX };
      if (overlaps(footprint, zone)) fail(`${item.name} blocks the door clearance zone.`);
    }
  }
}

/** Replace the complete furnishing set; building geometry and equipment remain untouched. */
export function previewFurnishings(baseSnapshot: unknown, input: unknown): ModelSnapshot {
  const base = validateSnapshot(baseSnapshot);
  const value = copy(input);
  fields(value, ['furnishings']);
  if (!Array.isArray(value.furnishings) || value.furnishings.length > 32) fail('Provide up to 32 furnishings.');
  const furnishings = value.furnishings.map(parseEntity);
  if (furnishings.some((item) => item.type !== 'Furniture')) fail('Only furnishings can be changed by this tool.');
  return validateSnapshot({ units: 'm', entities: [...base.entities.filter((item) => item.type !== 'Furniture'), ...furnishings], relationships: base.relationships });
}

/** A room-bounded replacement cannot remove or transfer furnishings in adjacent spaces. */
export function previewRoomFurnishings(baseSnapshot: unknown, input: unknown): ModelSnapshot {
  const base = validateSnapshot(baseSnapshot);
  const value = copy(input);
  fields(value, ['roomId', 'furnishings']);
  const room = spaces(base).find((item) => item.id === value.roomId);
  if (!room) fail('Choose a room from the bound floor.');
  if (!Array.isArray(value.furnishings) || value.furnishings.length > 32) fail('Provide up to 32 room furnishings.');
  const incoming = value.furnishings.map(parseEntity);
  for (const item of incoming) {
    if (item.type !== 'Furniture') fail('Only furnishings can be changed by this tool.');
    if (spaceForFootprint(base, furnitureFootprint(item))?.id !== room.id) fail('Room furnishing changes must remain inside the selected room, clear of shared walls. Use the whole-floor tool for explicit transfers.');
  }
  const retained = base.entities.filter((item) => item.type === 'Furniture' && spaceForFootprint(base, furnitureFootprint(item))?.id !== room.id);
  return previewFurnishings(base, { furnishings: [...retained, ...incoming] });
}

export function validateSnapshot(input: unknown): ModelSnapshot {
  const value = copy(input);
  fields(value, ['units', 'entities', 'relationships']);
  if (value.units !== 'm') fail('Unsupported model snapshot.');
  const entityValues = value.entities;
  const relationshipValues = value.relationships;
  if (!Array.isArray(entityValues) || !Array.isArray(relationshipValues)
      || entityValues.length > 100 || relationshipValues.length > 100) fail('Unsupported model snapshot.');
  const byEntityId = new Map<EntityId, Entity>();
  const entities: Entity[] = [];
  for (const item of entityValues) {
    const entity = parseEntity(item);
    if (byEntityId.has(entity.id)) fail('Duplicate entity identifier.');
    byEntityId.set(entity.id, entity);
    entities.push(entity);
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
  validateFloorPlan({ units: 'm', entities, relationships });
  validateFurnishings(entities, relationships);
  const byId = (a: ModelItem, b: ModelItem): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  entities.sort(byId); relationships.sort(byId);
  return freeze({ units: 'm', entities, relationships });
}

function cloneSnapshot(snapshot: ModelSnapshot): ModelSnapshot {
  return {
    units: 'm',
    entities: snapshot.entities.map((entity): Entity => {
      if (entity.type === 'Wall') return { ...entity, start: [...entity.start], end: [...entity.end] };
      if (entity.type === 'Equipment' || entity.type === 'Furniture') return { ...entity, position: [...entity.position] };
      return { ...entity };
    }),
    relationships: snapshot.relationships.map((relationship) => ({ ...relationship })),
  };
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
  return freeze({ entities: changes(left.entities, right.entities), relationships: changes(left.relationships, right.relationships) });
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

export class RoomRepository {
  #state: RepositoryState;
  #revisions: Map<RevisionId, Revision>;

  constructor(key: symbol, state: RepositoryState) {
    if (key !== token) fail('Use RoomRepository.create or restore.');
    const branches = [...state.branches].sort((a, b) =>
      a.name === b.name ? 0 : a.name === 'main' ? -1 : b.name === 'main' ? 1 : a.name < b.name ? -1 : 1);
    this.#state = state.version === 1
      ? freeze({ version: 1, projectId: state.projectId, name: state.name, revisions: state.revisions, branches })
      : freeze({ version: 2, projectId: state.projectId, name: state.name, revisions: state.revisions, branches, reviews: state.reviews });
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
    if (!value || Array.isArray(value) || typeof value !== 'object') fail('Unsupported saved project.');
    if (value.version === 1) fields(value, ['version', 'projectId', 'name', 'revisions', 'branches']);
    else if (value.version === 2) fields(value, ['version', 'projectId', 'name', 'revisions', 'branches', 'reviews']);
    else fail('Unsupported saved project.');
    const name = label(value.name);
    const projectId = projectIdentifier(value.projectId);
    const revisionValues = value.revisions;
    const branchValues = value.branches;
    if (!Array.isArray(revisionValues) || !revisionValues.length || revisionValues.length > 32
        || !Array.isArray(branchValues) || !branchValues.length || branchValues.length > 32) fail('Unsupported saved project.');
    const reviewValues = value.version === 2 ? value.reviews : [];
    if (!Array.isArray(reviewValues) || reviewValues.length > 31) fail('Unsupported saved project.');
    const revisions = new Map<RevisionId, Revision>();
    for (const item of revisionValues) {
      fields(item, ['id', 'parentId', 'snapshot']);
      const id = revisionIdentifier(item.id);
      const parentId = item.parentId === null ? null : revisionIdentifier(item.parentId);
      if (revisions.has(id)) fail('Invalid revision identity.');
      const validated = await revision(parentId, validateSnapshot(item.snapshot));
      if (validated.id !== id) fail('Saved revision content does not match its hash.');
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
    if (!branches.has(branchName('main')) || reachable.size !== revisions.size) fail('Saved project has missing or unreachable history.');
    const reviews: ProposalReview[] = [];
    if (value.version === 2) {
      const requests = new Set<RequestId>(); const proposals = new Set<BranchName>();
      for (const item of reviewValues) {
        const review = reviewRecord(item, revisions, branches);
        if (requests.has(review.requestId) || proposals.has(review.proposalName)) fail('Duplicate proposal review identity.');
        requests.add(review.requestId); proposals.add(review.proposalName); reviews.push(review);
      }
      const mainBranch = branches.get(branchName('main'));
      if (!mainBranch) fail('Saved project has missing or unreachable history.');
      const main = mainBranch.revisionId;
      if (main !== roots[0].id && !reviews.some((review) => review.proposalRevisionId === main && review.decision.status === 'accepted')) {
        fail('The current model must reference an accepted reviewed proposal.');
      }
    }
    const restored: RepositoryState = value.version === 1
      ? { version: 1, projectId, name, revisions: [...revisions.values()], branches: [...branches.values()] }
      : { version: 2, projectId, name, revisions: [...revisions.values()], branches: [...branches.values()], reviews };
    return new RoomRepository(token, restored);
  }

  get name(): string { return this.#state.name; }

  get projectId(): ProjectId { return this.#state.projectId; }

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

  reviews(): ProposalReview[] { return this.#state.version === 2 ? this.#state.reviews : []; }

  review(name: string): ProposalReview {
    const proposalName = branchName(name);
    const value = this.reviews().find((item) => item.proposalName === proposalName);
    if (!value) fail('Unknown reviewed proposal.');
    return value;
  }

  accept(name: string, input: unknown): RoomRepository {
    const proposalName = branchName(name);
    if (proposalName === 'main') fail('Choose a proposal to accept.');
    const proposal = this.#state.branches.find((item) => item.name === proposalName);
    if (!proposal) fail('Unknown proposal.');
    const review = this.review(proposalName);
    const decision = copy(input);
    fields(decision, ['decisionId', 'actor']);
    const decisionId = requestIdentifier(decision.decisionId);
    const actor = readable(decision.actor, 'Decision actor', 80);
    if (this.head('main') === proposal.revisionId && review.decision.status === 'accepted') return this;
    const mainName = branchName('main');
    const branches: Branch[] = this.#state.branches.map((item) => item.name === mainName
      ? { name: mainName, revisionId: proposal.revisionId } : item);
    const reviews: ProposalReview[] = this.reviews().map((item): ProposalReview => {
      if (item.proposalName === proposalName) return { ...item, decision: { status: 'accepted', decisionId, actor } };
      if (item.decision.status === 'accepted') return { ...item, decision: { ...item.decision, status: 'superseded' } };
      return item;
    });
    const state: RepositoryStateV2 = {
      version: 2, projectId: this.#state.projectId, name: this.#state.name,
      revisions: this.#state.revisions, branches, reviews,
    };
    if (size(canonical(state)) > MAX_BYTES) fail('Saved project exceeds the 256 KiB demo limit.');
    return new RoomRepository(token, state);
  }

  async propose(input: unknown): Promise<RoomRepository> {
    const proposal = copy(input);
    fields(proposal, ['name', 'from', 'doorWidthM']);
    const name = branchName(proposal.name);
    const from = proposal.from;
    if (typeof from !== 'string') fail('Unknown revision.');
    const doorWidthM = metres(proposal.doorWidthM);
    const base = this.view(from);
    const snapshot = cloneSnapshot(base.snapshot);
    const door = snapshot.entities.find((item): item is Door => item.id === 'door-entry' && item.type === 'Door');
    if (!door) fail('This revision has no entry door.');
    door.width = doorWidthM;
    return this.#commit(name, base, snapshot);
  }

  async proposeLayout(input: unknown): Promise<RoomRepository> {
    const proposal = copy(input);
    fields(proposal, ['name', 'from', 'layout']);
    const name = branchName(proposal.name);
    const from = proposal.from;
    if (typeof from !== 'string') fail('Unknown revision.');
    const layout = proposal.layout;
    const base = this.view(from);
    return this.#commit(name, base, previewRectangle(base.snapshot, layout));
  }

  async proposeReviewedModel(input: unknown): Promise<RoomRepository> {
    const proposal = copy(input);
    fields(proposal, ['name', 'from', 'snapshot', 'review']);
    const proposalName = branchName(proposal.name);
    const from = proposal.from;
    if (typeof from !== 'string') fail('Unknown revision.');
    const details = proposal.review;
    fields(details, ['requestId', 'selectedObjectIds', 'instruction', 'summary', 'rationale', 'constraints',
      'uncertainty', 'worker', 'toolCalls', 'validator']);
    const base = this.view(from);
    const next = await this.#commit(proposalName, base, proposal.snapshot);
    if (next === this) fail('The reviewed proposal must change the bound revision.');
    const record = reviewRecord({
      requestId: details.requestId, proposalName, baseRevisionId: base.id,
      proposalRevisionId: next.head(proposalName), selectedObjectIds: details.selectedObjectIds,
      instruction: details.instruction, summary: details.summary, rationale: details.rationale,
      constraints: details.constraints, uncertainty: details.uncertainty, worker: details.worker,
      toolCalls: details.toolCalls, validator: details.validator,
      decision: { status: 'pending', decisionId: null, actor: null },
    }, next.#revisions, branchMap(next.#state.branches));
    const reviews = [...next.reviews(), record];
    if (reviews.some((item, index) => reviews.findIndex((other) => other.requestId === item.requestId || other.proposalName === item.proposalName) !== index)) {
      fail('Duplicate proposal review identity.');
    }
    const state: RepositoryStateV2 = {
      version: 2, projectId: next.#state.projectId, name: next.#state.name,
      revisions: next.#state.revisions, branches: next.#state.branches, reviews,
    };
    if (size(canonical(state)) > MAX_BYTES) fail('Saved project exceeds the 256 KiB demo limit.');
    return new RoomRepository(token, state);
  }

  async #commit(name: BranchName, base: Revision, snapshot: unknown): Promise<RoomRepository> {
    if (name === 'main') fail('Choose a proposal name other than main.');
    const updated = validateSnapshot(snapshot);
    const next = canonical(updated) === canonical(base.snapshot) ? base : await revision(base.id, updated);
    const existing = this.#state.branches.find((item) => item.name === name);
    if (existing) {
      if (existing.revisionId === next.id) return this;
      fail('A different proposal already uses that name.');
    }
    if (next === base) return this;
    const revisions = this.#revisions.has(next.id) ? this.#state.revisions : [...this.#state.revisions, next];
    if (revisions.length > 32 || this.#state.branches.length >= 32) fail('Demo history is full. Export it before starting another project.');
    const branches: Branch[] = [...this.#state.branches, { name, revisionId: next.id }];
    const state: RepositoryState = this.#state.version === 1
      ? { version: 1, projectId: this.#state.projectId, name: this.#state.name, revisions, branches }
      : { version: 2, projectId: this.#state.projectId, name: this.#state.name, revisions, branches, reviews: this.#state.reviews };
    if (size(canonical(state)) > MAX_BYTES) fail('Saved project exceeds the 256 KiB demo limit.');
    return new RoomRepository(token, state);
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
      ...collectionConflicts('entity', base.entities, left.entities, right.entities),
      ...collectionConflicts('relationship', base.relationships, left.relationships, right.relationships),
    ]);
  }

  serialize(): string { return canonical(this.#state); }
}
