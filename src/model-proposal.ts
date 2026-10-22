import { diffSnapshots, previewRectangle, rectangleLayout } from './room-model.ts';
import type {
  CollectionChanges, Entity, EntityId, HostingRelationship, ModelDelta, ModelSnapshot,
  ProposalReview, Revision, RoomLayout, RoomRepository,
} from './room-model.ts';

const REVISION = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/;
const BRANCH = /^[a-z]+(?:-[a-z]+)*$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_TOOL_CALLS = 12;
type SupportedToolName = 'inspect_model' | 'preview_rectangle' | 'submit_proposal' | 'decline_request';
const TOOL_NAMES: readonly SupportedToolName[] = Object.freeze(['inspect_model', 'preview_rectangle', 'submit_proposal', 'decline_request']);
type EvidenceToolName = SupportedToolName | 'unsupported_tool';
type ToolStatus = 'accepted' | 'rejected';

interface BoundRequest {
  requestId: string;
  proposalName: string;
  baseRevisionId: string;
  selectedObjectIds: readonly EntityId[];
  instruction: string;
  visualIntent: Readonly<{ kind: 'rectangle-layout-sketch'; layout: RoomLayout }>;
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

interface ModelWorkerSession {
  instructions: string;
  input: unknown;
  tools: typeof MODEL_PROPOSAL_TOOLS;
  executeTool: (name: string, argumentsValue: unknown) => Promise<Record<string, unknown>>;
  recordProviderEvent: (event: unknown) => void;
}

interface ModelWorker {
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

interface WorkerOptions {
  getAccessToken?: () => Promise<string>;
  model?: string;
  fetchImpl?: typeof globalThis.fetch;
  maxTurns?: number;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

interface CompletedResponse {
  id: string;
  output: unknown[];
  usage?: unknown;
}

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
  fields(input.visualIntent, ['kind', 'layout']);
  if (input.visualIntent.kind !== 'rectangle-layout-sketch') fail('Unsupported visual request kind.');
  const visualSnapshot = previewRectangle(base.snapshot, input.visualIntent.layout);
  return Object.freeze({
    requestId,
    proposalName,
    baseRevisionId: base.id,
    selectedObjectIds: Object.freeze(selectedObjectIds),
    instruction,
    visualIntent: Object.freeze({ kind: input.visualIntent.kind, layout: rectangleLayout(visualSnapshot) }),
    base,
    selectedObjects: Object.freeze(selectedObjectIds.map((id) => {
      const entity = entities.get(id);
      if (!entity) fail('A selected object does not exist in the bound revision.');
      return entity;
    })),
  });
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
    type: 'function', name: 'submit_proposal',
    description: 'Submit the latest validated preview as a separate proposal with a concise human review. Call only after preview_rectangle succeeds.',
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
  if (!repository || typeof repository.view !== 'function' || typeof repository.proposeReviewedLayout !== 'function') fail('A validated room repository is required.');
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

  const evidenceName = (name: string): EvidenceToolName => name === 'inspect_model' || name === 'preview_rectangle'
    || name === 'submit_proposal' || name === 'decline_request' ? name : 'unsupported_tool';
  const recordTool = (name: string, status: ToolStatus, error: string | null = null): void => {
    toolCalls.push(Object.freeze({ name: evidenceName(name), status, error }));
  };

  const executeTool = async (name: string, argumentsValue: unknown): Promise<Record<string, unknown>> => {
    calls += 1;
    if (calls > MAX_TOOL_CALLS) fail('The model worker exceeded the bounded tool-call budget.');
    if (result) return { ok: false, error: 'This proposal session has already finished.' };
    try {
      if (name === 'inspect_model') {
        fields(argumentsValue, []);
        const output = { ok: true, revisionId: bound.base.id, selectedObjectIds: bound.selectedObjectIds, model: summarizeSnapshot(bound.base.snapshot) };
        recordTool(name, 'accepted');
        return output;
      }
      if (name === 'preview_rectangle') {
        candidate = previewRectangle(bound.base.snapshot, argumentsValue);
        delta = diffSnapshots(bound.base.snapshot, candidate);
        const output = { ok: true, layout: rectangleLayout(candidate), changes: summarizeDelta(delta) };
        recordTool(name, 'accepted');
        return output;
      }
      if (name === 'submit_proposal') {
        fields(argumentsValue, ['summary', 'rationale', 'constraints', 'uncertainty']);
        if (!candidate || !delta) fail('Prepare a validated preview before submitting a proposal.');
        if (!hasChanges(delta)) fail('The proposed model is identical to the bound revision.');
        const summary = text(argumentsValue.summary, 'Summary', 240);
        const rationale = text(argumentsValue.rationale, 'Rationale', 800);
        const constraints = text(argumentsValue.constraints, 'Constraints', 600);
        const uncertainty = text(argumentsValue.uncertainty, 'Uncertainty', 400);
        const acceptedTools = Object.freeze([...toolCalls, Object.freeze({ name, status: 'accepted', error: null })]);
        const next = await repository.proposeReviewedLayout({
          name: bound.proposalName, from: bound.base.id, layout: rectangleLayout(candidate),
          review: {
            requestId: bound.requestId, selectedObjectIds: bound.selectedObjectIds, instruction: bound.instruction,
            summary, rationale, constraints, uncertainty, worker: workerEvidence(), toolCalls: acceptedTools,
            validator: 'room-graph-v1',
          },
        });
        recordTool(name, 'accepted');
        const ready: ReadyResult = Object.freeze({
          status: 'ready', repository: next,
          review: Object.freeze({ ...next.review(bound.proposalName), changes: summarizeDelta(delta) }),
        });
        result = ready;
        return { ok: true, done: true, proposalRevisionId: ready.review.proposalRevisionId };
      }
      if (name === 'decline_request') {
        fields(argumentsValue, ['reason', 'uncertainty']);
        const declined: DeclinedResult = Object.freeze({
          status: 'declined', repository,
          review: Object.freeze({
            requestId: bound.requestId, proposalName: bound.proposalName, baseRevisionId: bound.base.id,
            proposalRevisionId: null, selectedObjectIds: bound.selectedObjectIds, instruction: bound.instruction,
            summary: 'No model proposal was prepared.', rationale: text(argumentsValue.reason, 'Reason', 800),
            constraints: 'The bounded rectangular-room tools could not represent this request.',
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
      instructions: 'You prepare BIM model proposals for human review. Work only on the bound revision. Inspect when needed, use preview_rectangle for every geometry candidate, and finish with submit_proposal or decline_request. The visual layout is intent, not authoritative geometry. Never claim construction, code, accessibility, or coordination approval.',
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
  const finalResult = result;
  if (!finalResult) throw new ModelWorkerError('The model worker ended without submitting or declining the request.');
  return finalResult;
}

async function readCompletedResponse(response: Response, maxResponseBytes: number): Promise<CompletedResponse> {
  if (!response.ok) fail(`The ChatGPT plan rejected the request with HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) fail('The ChatGPT plan response exceeded the configured byte limit.');
  if (!response.body) fail('The ChatGPT plan returned no response stream.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxResponseBytes) fail('The ChatGPT plan response exceeded the configured byte limit.');
    chunks.push(bytes);
  }
  const blocks = Buffer.concat(chunks).toString('utf8').split(/\r?\n\r?\n/);
  let completed: unknown = null;
  for (const block of blocks) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') continue;
    let event: unknown;
    try { event = JSON.parse(data); } catch { fail('The ChatGPT plan returned an invalid event stream.'); }
    if (!isRecord(event)) fail('The ChatGPT plan returned an invalid event stream.');
    if (event.type === 'response.failed') {
      const responseValue = event.response;
      const error = isRecord(responseValue) ? responseValue.error : null;
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown_error';
      fail(`The ChatGPT plan could not complete the request (${code}).`);
    }
    if (event.type === 'response.incomplete') fail('The ChatGPT plan returned an incomplete response.');
    if (event.type === 'response.completed') completed = event.response;
  }
  if (!completed) fail('The ChatGPT plan stream ended without a completed response.');
  if (!isRecord(completed) || typeof completed.id !== 'string' || !Array.isArray(completed.output)) fail('The ChatGPT plan returned an invalid completed response.');
  return { id: completed.id, output: completed.output, ...(completed.usage === undefined ? {} : { usage: completed.usage }) };
}

export function createChatGPTPlanModelWorker({
  getAccessToken, model, fetchImpl = globalThis.fetch, maxTurns = 8,
  requestTimeoutMs = 30000, maxResponseBytes = 256 * 1024,
}: WorkerOptions = {}): Readonly<ModelWorker> {
  if (typeof getAccessToken !== 'function') fail('A ChatGPT plan token provider is required.');
  if (typeof model !== 'string' || !model.trim() || model.length > 100) fail('A selected ChatGPT model is required.');
  if (typeof fetchImpl !== 'function') fail('A fetch implementation is required for the model worker.');
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 12) fail('Model turn budget must be between one and twelve.');
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 120000) fail('Model request timeout must be between one and 120 seconds.');
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 1024 * 1024) fail('Model response limit must be between 1 KiB and 1 MiB.');
  const configuredModel = model.trim();
  return Object.freeze({
    identity: Object.freeze({ provider: 'openai-chatgpt-plan', model: configuredModel }),
    async run(session: ModelWorkerSession): Promise<void> {
      const history: unknown[] = [{ role: 'user', content: JSON.stringify(session.input) }];
      const tools = [{
        type: 'namespace', name: 'bim_model',
        description: 'Bounded BIM model inspection, deterministic room preview, and human-review proposal tools.',
        tools: session.tools,
      }];
      for (let turn = 0; turn < maxTurns; turn += 1) {
        const accessToken = await getAccessToken();
        const body = {
          model: configuredModel,
          instructions: session.instructions,
          input: history,
          tools,
          tool_choice: 'required',
          parallel_tool_calls: false,
          store: false,
          stream: true,
        };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
        let response: Response;
        try {
          response = await fetchImpl('https://api.openai.com/v1/responses', {
            method: 'POST', signal: controller.signal,
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify(body),
          });
          const payload = await readCompletedResponse(response, maxResponseBytes);
          const usage = isRecord(payload.usage) ? payload.usage : {};
          const inputTokens = typeof usage.input_tokens === 'number' && Number.isSafeInteger(usage.input_tokens) ? usage.input_tokens : 0;
          const outputTokens = typeof usage.output_tokens === 'number' && Number.isSafeInteger(usage.output_tokens) ? usage.output_tokens : 0;
          const totalTokens = typeof usage.total_tokens === 'number' && Number.isSafeInteger(usage.total_tokens)
            ? usage.total_tokens : inputTokens + outputTokens;
          session.recordProviderEvent({
            responseId: payload.id,
            inputTokens,
            outputTokens,
            totalTokens,
          });
          const calls = payload.output.filter((item) => isRecord(item) && item.type === 'function_call');
          if (calls.length !== 1) fail('The model worker must issue exactly one bounded tool call per turn.');
          const call = calls[0];
          if (!isRecord(call) || call.namespace !== 'bim_model' || typeof call.name !== 'string' || typeof call.arguments !== 'string' || typeof call.call_id !== 'string') {
            fail('The ChatGPT plan returned an invalid bounded tool call.');
          }
          let argumentsValue: unknown;
          try { argumentsValue = JSON.parse(call.arguments); } catch { fail('The model worker returned invalid tool arguments.'); }
          const output = await session.executeTool(call.name, argumentsValue);
          if (output.done === true) return;
          history.push(...payload.output, { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
        } catch (error) {
          if (controller.signal.aborted) fail(`The ChatGPT plan exceeded the ${requestTimeoutMs} ms request timeout.`);
          throw error;
        } finally { clearTimeout(timeout); }
      }
      fail('The model worker exceeded its turn budget without finishing.');
    },
  });
}
