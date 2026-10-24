import { diffSnapshots, previewRectangle, previewFurnishings, rectangleLayout, FURNITURE_KINDS } from './room-model.ts';
import { parseVisualRequest } from './visual-request.ts';
import type { VisualRequest } from './visual-request.ts';
import type {
  CollectionChanges, Entity, EntityId, HostingRelationship, ModelDelta, ModelSnapshot,
  ProposalReview, Revision, RoomRepository,
} from './room-model.ts';

const REVISION = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/;
const BRANCH = /^[a-z]+(?:-[a-z]+)*$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_TOOL_CALLS = 12;
type SupportedToolName = 'inspect_model' | 'preview_rectangle' | 'preview_furnishings' | 'submit_proposal' | 'decline_request';
type EvidenceToolName = SupportedToolName | 'unsupported_tool';
type ToolStatus = 'accepted' | 'rejected';

interface BoundRequest {
  requestId: string;
  proposalName: string;
  baseRevisionId: string;
  selectedObjectIds: readonly EntityId[];
  instruction: string;
  visualIntent: VisualRequest;
  base: Revision;
  selectedObjects: readonly Entity[];
}

interface ProviderEvent {
  responseId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ToolEvidence {
  name: EvidenceToolName;
  status: ToolStatus;
  error: string | null;
}

export interface ModelWorkerSession {
  instructions: string;
  input: unknown;
  tools: typeof MODEL_PROPOSAL_TOOLS;
  executeTool: (name: string, argumentsValue: unknown) => Promise<Record<string, unknown>>;
  recordProviderEvent: (event: unknown) => void;
}

export interface ModelWorker {
  identity: { provider: unknown; model: unknown };
  run: (session: ModelWorkerSession) => Promise<void>;
}

interface ReadyResult {
  status: 'ready';
  repository: RoomRepository;
  review: Readonly<ProposalReview & { changes: ReturnType<typeof summarizeDelta> }>;
}

interface DeclinedResult {
  status: 'declined';
  repository: RoomRepository;
  review: Readonly<{
    requestId: string;
    proposalName: string;
    baseRevisionId: string;
    proposalRevisionId: null;
    selectedObjectIds: readonly EntityId[];
    instruction: string;
    summary: string;
    rationale: string;
    constraints: string;
    uncertainty: string;
    changes: null;
  }>;
}

export type ModelProposalResult = Readonly<ReadyResult | DeclinedResult>;

function fail(message: string): never { throw new Error(message); }

export class ModelWorkerError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'ModelWorkerError'; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isModelWorker(value: unknown): value is ModelWorker {
  return isRecord(value) && typeof value.run === 'function' && isRecord(value.identity);
}

function fields(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object'
      || Object.keys(value).length !== expected.length
      || !expected.every((key) => Object.hasOwn(value, key))) fail('Unexpected proposal request fields.');
}

function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string') fail(`${name} must contain readable text no longer than ${maximum} characters.`);
  if (!value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) {
    fail(`${name} must contain readable text no longer than ${maximum} characters.`);
  }
  return value.trim();
}

function request(input: unknown, repository: RoomRepository): BoundRequest {
  fields(input, ['requestId', 'proposalName', 'baseRevisionId', 'selectedObjectIds', 'instruction', 'visualIntent']);
  const requestId = text(input.requestId, 'Request identity', 128);
  if (!REQUEST_ID.test(requestId)) fail('Request identity contains unsupported characters.');
  const proposalName = text(input.proposalName, 'Proposal name', 64);
  if (!BRANCH.test(proposalName) || proposalName === 'main') fail('Proposal names require lowercase words separated by hyphens.');
  if (repository.branches().some((branch) => branch.name === proposalName)) fail('A proposal already uses that name.');
  if (typeof input.baseRevisionId !== 'string' || !REVISION.test(input.baseRevisionId)) fail('Invalid base revision identity.');
  const base = repository.view(input.baseRevisionId);
  if (!Array.isArray(input.selectedObjectIds) || input.selectedObjectIds.length < 1 || input.selectedObjectIds.length > 16) {
    fail('Select between one and sixteen stable model objects.');
  }
  const selectedValues: unknown[] = input.selectedObjectIds;
  if (selectedValues.some((id) => typeof id !== 'string' || !IDENTIFIER.test(id))) fail('Invalid selected object identity.');
  const selectedObjectIds: EntityId[] = [];
  for (const id of selectedValues) {
    if (typeof id !== 'string') fail('Invalid selected object identity.');
    const entity = base.snapshot.entities.find((item) => item.id === id);
    if (!entity) fail('A selected object does not exist in the bound revision.');
    selectedObjectIds.push(entity.id);
  }
  if (new Set(selectedObjectIds).size !== selectedObjectIds.length) fail('Invalid selected object identity.');
  const entities = new Map(base.snapshot.entities.map((entity) => [entity.id, entity]));
  const instruction = text(input.instruction, 'Change request', 1000);
  const visualIntent = parseVisualRequest(base.snapshot, input.visualIntent);
  return Object.freeze({
    requestId,
    proposalName,
    baseRevisionId: base.id,
    selectedObjectIds: Object.freeze(selectedObjectIds),
    instruction,
    visualIntent: Object.freeze(visualIntent),
    base,
    selectedObjects: Object.freeze(selectedObjectIds.map((id) => {
      const entity = entities.get(id);
      if (!entity) fail('A selected object does not exist in the bound revision.');
      return entity;
    })),
  });
}

export function validateModelProposalRequest(repository: RoomRepository, input: unknown): BoundRequest {
  return request(input, repository);
}

function summarizeSnapshot(snapshot: ModelSnapshot): ModelSnapshot {
  return {
    units: snapshot.units,
    entities: snapshot.entities,
    relationships: snapshot.relationships,
  };
}

function summarizeDelta(delta: ModelDelta): {
  entities: { added: EntityId[]; removed: EntityId[]; modified: EntityId[] };
  relationships: { added: EntityId[]; removed: EntityId[]; modified: EntityId[] };
} {
  const map = <T extends Entity | HostingRelationship>(collection: CollectionChanges<T>) => ({
    added: collection.added.map((item) => item.id),
    removed: collection.removed.map((item) => item.id),
    modified: collection.modified.map((item) => item.id),
  });
  return { entities: map(delta.entities), relationships: map(delta.relationships) };
}

function hasChanges(delta: ModelDelta): boolean {
  return delta.entities.added.length > 0 || delta.entities.removed.length > 0 || delta.entities.modified.length > 0
    || delta.relationships.added.length > 0 || delta.relationships.removed.length > 0 || delta.relationships.modified.length > 0;
}

const rectangleParameters = {
  type: 'object',
  properties: {
    boundsMm: {
      type: 'object',
      properties: {
        minX: { type: 'integer', minimum: -1000000, maximum: 1000000 },
        minY: { type: 'integer', minimum: -1000000, maximum: 1000000 },
        maxX: { type: 'integer', minimum: -1000000, maximum: 1000000 },
        maxY: { type: 'integer', minimum: -1000000, maximum: 1000000 },
      },
      required: ['minX', 'minY', 'maxX', 'maxY'],
      additionalProperties: false,
    },
    door: {
      type: 'object',
      properties: {
        widthMm: { type: 'integer', minimum: 1, maximum: 100000 },
        offsetMm: { type: 'integer', minimum: 0, maximum: 1000000 },
      },
      required: ['widthMm', 'offsetMm'],
      additionalProperties: false,
    },
  },
  required: ['boundsMm', 'door'],
  additionalProperties: false,
};

const reviewParameters = {
  type: 'object',
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 240 },
    rationale: { type: 'string', minLength: 1, maxLength: 800 },
    constraints: { type: 'string', minLength: 1, maxLength: 600 },
    uncertainty: { type: 'string', minLength: 1, maxLength: 400 },
  },
  required: ['summary', 'rationale', 'constraints', 'uncertainty'],
  additionalProperties: false,
};

export const MODEL_PROPOSAL_TOOLS = Object.freeze([
  Object.freeze({
    type: 'function', name: 'inspect_model',
    description: 'Inspect the exact model revision and selected stable objects bound to this request.',
    parameters: Object.freeze({ type: 'object', properties: Object.freeze({}), required: Object.freeze([]), additionalProperties: false }),
    strict: true,
  }),
  Object.freeze({
    type: 'function', name: 'preview_rectangle',
    description: 'Prepare and deterministically validate a complete rectangular room layout in millimetres. This changes only the proposal preview.',
    parameters: rectangleParameters,
    strict: true,
  }),
  Object.freeze({
    type: 'function', name: 'preview_furnishings',
    description: 'Replace the COMPLETE furnishing set in the current preview, preserving walls, openings and equipment. Include existing furnishings you wish to retain. Positions/dimensions are metres on a 1 mm grid; position is the footprint centre. Rotation 0 faces north (+Y), 90 faces west. Monitor/laptop supportId must reference a desk/table in this set; their elevation is the support height. Floor items use null. Checks room containment, overlaps and doorway clearance. Inspect first.',
    parameters: {
      type: 'object', properties: { furnishings: { type: 'array', maxItems: 32, items: {
        type: 'object', properties: {
          id: { type: 'string', pattern: IDENTIFIER.source }, type: { type: 'string', enum: ['Furniture'] },
          name: { type: 'string', minLength: 1, maxLength: 80 }, kind: { type: 'string', enum: FURNITURE_KINDS },
          position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          width: { type: 'number', minimum: 0.05, maximum: 5 }, depth: { type: 'number', minimum: 0.05, maximum: 5 },
          height: { type: 'number', minimum: 0.02, maximum: 3 }, rotationDeg: { type: 'integer', enum: [0, 90, 180, 270] },
          supportId: { type: ['string', 'null'] },
        }, required: ['id', 'type', 'name', 'kind', 'position', 'width', 'depth', 'height', 'rotationDeg', 'supportId'], additionalProperties: false,
      } } }, required: ['furnishings'], additionalProperties: false,
    },
    strict: true,
  }),
  Object.freeze({
    type: 'function', name: 'submit_proposal',
    description: 'Submit the latest validated preview as a separate proposal with a concise human review. Call only after a preview tool succeeds.',
    parameters: reviewParameters,
    strict: true,
  }),
  Object.freeze({
    type: 'function', name: 'decline_request',
    description: 'Decline when the bounded room tools cannot safely satisfy the request. Explain the exact limitation and uncertainty.',
    parameters: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        reason: Object.freeze({ type: 'string', minLength: 1, maxLength: 800 }),
        uncertainty: Object.freeze({ type: 'string', minLength: 1, maxLength: 400 }),
      }),
      required: Object.freeze(['reason', 'uncertainty']),
      additionalProperties: false,
    }),
    strict: true,
  }),
]);

export async function prepareModelProposal(repository: RoomRepository, input: unknown, worker: unknown): Promise<ModelProposalResult> {
  if (!repository || typeof repository.view !== 'function' || typeof repository.proposeReviewedModel !== 'function') fail('A validated room repository is required.');
  if (!isModelWorker(worker)) fail('A model worker with an auditable identity is required.');
  fields(worker.identity, ['provider', 'model']);
  const workerIdentity = Object.freeze({
    provider: text(worker.identity.provider, 'Worker provider', 80),
    model: text(worker.identity.model, 'Worker model', 100),
  });
  const bound = request(input, repository);
  let candidate: ModelSnapshot | null = null;
  let delta: ModelDelta | null = null;
  let result: ModelProposalResult | null = null;
  const pending: { value: { snapshot: ModelSnapshot; delta: ModelDelta; summary: string; rationale: string; constraints: string; uncertainty: string } | null } = { value: null };
  let calls = 0;
  const toolCalls: ToolEvidence[] = [];
  const providerEvents: ProviderEvent[] = [];

  const recordProviderEvent = (event: unknown): void => {
    fields(event, ['responseId', 'inputTokens', 'outputTokens', 'totalTokens']);
    const responseId = text(event.responseId, 'Model response identity', 128);
    if (!REQUEST_ID.test(responseId)) fail('Model response identity contains unsupported characters.');
    for (const [name, value] of [['input token count', event.inputTokens], ['output token count', event.outputTokens], ['total token count', event.totalTokens]]) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1000000000) fail(`Invalid ${name}.`);
    }
    if (typeof event.inputTokens !== 'number' || typeof event.outputTokens !== 'number' || typeof event.totalTokens !== 'number') fail('Invalid total token count.');
    if (event.totalTokens < event.inputTokens + event.outputTokens) fail('Invalid total token count.');
    providerEvents.push(Object.freeze({ responseId, inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalTokens: event.totalTokens }));
  };

  const workerEvidence = () => Object.freeze({
    ...workerIdentity,
    responseIds: Object.freeze(providerEvents.map((event) => event.responseId)),
    usage: Object.freeze(providerEvents.reduce((usage, event) => ({
      inputTokens: usage.inputTokens + event.inputTokens,
      outputTokens: usage.outputTokens + event.outputTokens,
      totalTokens: usage.totalTokens + event.totalTokens,
    }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 })),
  });

  const evidenceName = (name: string): EvidenceToolName => name === 'inspect_model' || name === 'preview_rectangle' || name === 'preview_furnishings'
    || name === 'submit_proposal' || name === 'decline_request' ? name : 'unsupported_tool';
  const recordTool = (name: string, status: ToolStatus, error: string | null = null): void => {
    toolCalls.push(Object.freeze({ name: evidenceName(name), status, error }));
  };

  const executeTool = async (name: string, argumentsValue: unknown): Promise<Record<string, unknown>> => {
    calls += 1;
    if (calls > MAX_TOOL_CALLS) fail('The model worker exceeded the bounded tool-call budget.');
    if (result || pending.value) return { ok: false, error: 'This proposal session has already finished.' };
    try {
      if (name === 'inspect_model') {
        fields(argumentsValue, []);
        const output = { ok: true, revisionId: bound.base.id, selectedObjectIds: bound.selectedObjectIds, model: summarizeSnapshot(candidate ?? bound.base.snapshot),
          placement: { layout: rectangleLayout(candidate ?? bound.base.snapshot), coordinates: 'Metres. X east, Y north. Furniture centred on position; keep clear of wall thickness and entry door.',
            suggestedDimensions: { desk: [1.8, 0.8, 0.75], monitor: [0.6, 0.2, 0.45], laptop: [0.35, 0.25, 0.24], chair: [0.6, 0.6, 1], table: [0.6, 0.6, 0.55], plant: [0.5, 0.5, 1.1] } } };
        recordTool(name, 'accepted');
        return output;
      }
      if (name === 'preview_rectangle') {
        if (bound.visualIntent.kind === 'spatial-reference') fail('A spatial reference does not authorize changing the building shell. Use furnishing tools or request clarification.');
        candidate = previewRectangle(candidate ?? bound.base.snapshot, argumentsValue);
        delta = diffSnapshots(bound.base.snapshot, candidate);
        const output = { ok: true, layout: rectangleLayout(candidate), changes: summarizeDelta(delta) };
        recordTool(name, 'accepted');
        return output;
      }
      if (name === 'preview_furnishings') {
        candidate = previewFurnishings(candidate ?? bound.base.snapshot, argumentsValue);
        delta = diffSnapshots(bound.base.snapshot, candidate);
        recordTool(name, 'accepted');
        return { ok: true, model: summarizeSnapshot(candidate), changes: summarizeDelta(delta) };
      }
      if (name === 'submit_proposal') {
        fields(argumentsValue, ['summary', 'rationale', 'constraints', 'uncertainty']);
        if (!candidate || !delta) fail('Prepare a validated preview before submitting a proposal.');
        if (!hasChanges(delta)) fail('The proposed model is identical to the bound revision.');
        const summary = text(argumentsValue.summary, 'Summary', 240);
        const rationale = text(argumentsValue.rationale, 'Rationale', 800);
        const constraints = text(argumentsValue.constraints, 'Constraints', 600);
        const uncertainty = text(argumentsValue.uncertainty, 'Uncertainty', 400);
        recordTool(name, 'accepted');
        pending.value = { snapshot: candidate, delta, summary, rationale, constraints, uncertainty };
        return { ok: true, done: true };
      }
      if (name === 'decline_request') {
        fields(argumentsValue, ['reason', 'uncertainty']);
        const declined: DeclinedResult = Object.freeze({
          status: 'declined', repository,
          review: Object.freeze({
            requestId: bound.requestId, proposalName: bound.proposalName, baseRevisionId: bound.base.id,
            proposalRevisionId: null, selectedObjectIds: bound.selectedObjectIds, instruction: bound.instruction,
            summary: 'No model proposal was prepared.', rationale: text(argumentsValue.reason, 'Reason', 800),
            constraints: 'The bounded model tools could not safely represent this request.',
            uncertainty: text(argumentsValue.uncertainty, 'Uncertainty', 400), changes: null,
          }),
        });
        result = declined;
        recordTool(name, 'accepted');
        return { ok: true, done: true };
      }
      recordTool(name, 'rejected', 'Unsupported model tool.');
      return { ok: false, error: 'Unsupported model tool.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The model tool failed.';
      recordTool(name, 'rejected', message.slice(0, 240));
      return { ok: false, error: message };
    }
  };

  try {
    await worker.run({
      instructions: 'You prepare BIM model proposals for human review. Work only on the bound revision. Inspect first. Selection and spatial references are CONTEXT, not a move command, group, or permission to alter neighbours. The instruction determines create, copy, move, removal and scope. A request for another desk creates ONLY that desk unless companions are requested; retain existing objects and identities. A freestanding floor point does not imply wall attachment. For moving a setup, reason about supported devices and nearby furniture, but proximity is not an explicit relationship or permission. Never leave devices without valid support; if desk-only movement leaves their intended destination unclear, decline with a specific clarification question. Use preview_rectangle for explicitly requested shell changes; a spatial reference cannot authorize shell edits. Use preview_furnishings for furniture. It replaces the COMPLETE furnishing set, so preserve every unrelated item exactly. Explain the interpreted operation, changed/added objects, preserved objects, dependencies and any adjustment from the destination in the review. If intent or dependencies are ambiguous, decline and ask a specific question. Leave circulation clear. Finish with submit_proposal or decline_request. Visual references are intent, not authoritative geometry. Never claim construction, code, accessibility, or coordination approval.',
      input: {
        request: {
          requestId: bound.requestId,
          proposalName: bound.proposalName,
          baseRevisionId: bound.base.id,
          selectedObjectIds: bound.selectedObjectIds,
          instruction: bound.instruction,
          visualIntent: bound.visualIntent,
        },
        selectedObjects: bound.selectedObjects,
      },
      tools: MODEL_PROPOSAL_TOOLS,
      executeTool,
      recordProviderEvent,
    });
  } catch (error) {
    throw new ModelWorkerError(error instanceof Error ? error.message : 'The model worker failed.', { cause: error });
  }
  if (pending.value) {
    const { snapshot, delta: submittedDelta, summary, rationale, constraints, uncertainty } = pending.value;
    const next = await repository.proposeReviewedModel({
      name: bound.proposalName, from: bound.base.id, snapshot,
      review: {
        requestId: bound.requestId, selectedObjectIds: bound.selectedObjectIds, instruction: bound.instruction,
        summary, rationale, constraints, uncertainty, worker: workerEvidence(), toolCalls, validator: 'room-graph-v1',
      },
    });
    return Object.freeze({ status: 'ready', repository: next,
      review: Object.freeze({ ...next.review(bound.proposalName), changes: summarizeDelta(submittedDelta) }) });
  }
  const finalResult = result;
  if (!finalResult) throw new ModelWorkerError('The model worker ended without submitting or declining the request.');
  return finalResult;
}
