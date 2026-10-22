import { diffSnapshots, previewRectangle, rectangleLayout } from './room-model.mjs';

const REVISION = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/;
const BRANCH = /^[a-z]+(?:-[a-z]+)*$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_TOOL_CALLS = 12;

const fail = (message) => { throw new Error(message); };

export class ModelWorkerError extends Error {
  constructor(message, options) { super(message, options); this.name = 'ModelWorkerError'; }
}

function fields(value, expected) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
      || Object.keys(value).length !== expected.length
      || !expected.every((key) => Object.hasOwn(value, key))) fail('Unexpected proposal request fields.');
}

function text(value, name, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) {
    fail(`${name} must contain readable text no longer than ${maximum} characters.`);
  }
  return value.trim();
}

function request(input, repository) {
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
  const selectedObjectIds = [...input.selectedObjectIds];
  if (new Set(selectedObjectIds).size !== selectedObjectIds.length
      || selectedObjectIds.some((id) => typeof id !== 'string' || !IDENTIFIER.test(id))) fail('Invalid selected object identity.');
  const entities = new Map(base.snapshot.entities.map((entity) => [entity.id, entity]));
  if (selectedObjectIds.some((id) => !entities.has(id))) fail('A selected object does not exist in the bound revision.');
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
    selectedObjects: Object.freeze(selectedObjectIds.map((id) => entities.get(id))),
  });
}

function summarizeSnapshot(snapshot) {
  return {
    units: snapshot.units,
    entities: snapshot.entities,
    relationships: snapshot.relationships,
  };
}

function summarizeDelta(delta) {
  const map = (collection) => ({
    added: collection.added.map((item) => item.id),
    removed: collection.removed.map((item) => item.id),
    modified: collection.modified.map((item) => item.id),
  });
  return { entities: map(delta.entities), relationships: map(delta.relationships) };
}

function hasChanges(delta) {
  return ['entities', 'relationships'].some((kind) => ['added', 'removed', 'modified'].some((change) => delta[kind][change].length));
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
    uncertainty: { type: 'string', minLength: 1, maxLength: 400 },
  },
  required: ['summary', 'rationale', 'uncertainty'],
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

export async function prepareModelProposal(repository, input, worker) {
  if (!repository || typeof repository.view !== 'function' || typeof repository.proposeLayout !== 'function') fail('A validated room repository is required.');
  if (!worker || typeof worker.run !== 'function') fail('A model worker is required.');
  const bound = request(input, repository);
  let candidate = null;
  let delta = null;
  let result = null;
  let calls = 0;

  const executeTool = async (name, argumentsValue) => {
    calls += 1;
    if (calls > MAX_TOOL_CALLS) fail('The model worker exceeded the bounded tool-call budget.');
    if (result) return { ok: false, error: 'This proposal session has already finished.' };
    try {
      if (name === 'inspect_model') {
        fields(argumentsValue, []);
        return { ok: true, revisionId: bound.base.id, selectedObjectIds: bound.selectedObjectIds, model: summarizeSnapshot(bound.base.snapshot) };
      }
      if (name === 'preview_rectangle') {
        candidate = previewRectangle(bound.base.snapshot, argumentsValue);
        delta = diffSnapshots(bound.base.snapshot, candidate);
        return { ok: true, layout: rectangleLayout(candidate), changes: summarizeDelta(delta) };
      }
      if (name === 'submit_proposal') {
        fields(argumentsValue, ['summary', 'rationale', 'uncertainty']);
        if (!candidate || !delta) fail('Prepare a validated preview before submitting a proposal.');
        if (!hasChanges(delta)) fail('The proposed model is identical to the bound revision.');
        const summary = text(argumentsValue.summary, 'Summary', 240);
        const rationale = text(argumentsValue.rationale, 'Rationale', 800);
        const uncertainty = text(argumentsValue.uncertainty, 'Uncertainty', 400);
        const next = await repository.proposeLayout({ name: bound.proposalName, from: bound.base.id, layout: rectangleLayout(candidate) });
        result = Object.freeze({
          status: 'ready', repository: next,
          review: Object.freeze({
            requestId: bound.requestId, proposalName: bound.proposalName, baseRevisionId: bound.base.id,
            proposalRevisionId: next.head(bound.proposalName), selectedObjectIds: bound.selectedObjectIds,
            instruction: bound.instruction, summary, rationale, uncertainty, changes: summarizeDelta(delta),
          }),
        });
        return { ok: true, done: true, proposalRevisionId: result.review.proposalRevisionId };
      }
      if (name === 'decline_request') {
        fields(argumentsValue, ['reason', 'uncertainty']);
        result = Object.freeze({
          status: 'declined', repository,
          review: Object.freeze({
            requestId: bound.requestId, proposalName: bound.proposalName, baseRevisionId: bound.base.id,
            proposalRevisionId: null, selectedObjectIds: bound.selectedObjectIds, instruction: bound.instruction,
            summary: 'No model proposal was prepared.', rationale: text(argumentsValue.reason, 'Reason', 800),
            uncertainty: text(argumentsValue.uncertainty, 'Uncertainty', 400), changes: null,
          }),
        });
        return { ok: true, done: true };
      }
      return { ok: false, error: 'Unsupported model tool.' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'The model tool failed.' };
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
    });
  } catch (error) {
    throw new ModelWorkerError(error instanceof Error ? error.message : 'The model worker failed.', { cause: error });
  }
  if (!result) throw new ModelWorkerError('The model worker ended without submitting or declining the request.');
  return result;
}

export function createOpenAIModelWorker({ apiKey, model, fetchImpl = globalThis.fetch, maxTurns = 8 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey) fail('OPENAI_API_KEY is required for the model worker.');
  if (typeof model !== 'string' || !model.trim() || model.length > 100) fail('OPENAI_MODEL is required for the model worker.');
  if (typeof fetchImpl !== 'function') fail('A fetch implementation is required for the model worker.');
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 12) fail('Model turn budget must be between one and twelve.');
  return Object.freeze({
    async run(session) {
      let previousResponseId = null;
      let inputItems = [{ role: 'user', content: JSON.stringify(session.input) }];
      for (let turn = 0; turn < maxTurns; turn += 1) {
        const body = {
          model: model.trim(), instructions: session.instructions, input: inputItems, tools: session.tools,
          tool_choice: 'required', parallel_tool_calls: false,
          ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        };
        const response = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response?.ok) fail(`The model provider rejected the request with HTTP ${response?.status ?? 'unknown'}.`);
        const payload = await response.json();
        if (typeof payload?.id !== 'string' || !Array.isArray(payload.output)) fail('The model provider returned an invalid response.');
        const calls = payload.output.filter((item) => item?.type === 'function_call');
        if (calls.length !== 1) fail('The model worker must issue exactly one bounded tool call per turn.');
        const call = calls[0];
        if (typeof call.name !== 'string' || typeof call.arguments !== 'string' || typeof call.call_id !== 'string') {
          fail('The model provider returned an invalid tool call.');
        }
        let argumentsValue;
        try { argumentsValue = JSON.parse(call.arguments); } catch { fail('The model worker returned invalid tool arguments.'); }
        const output = await session.executeTool(call.name, argumentsValue);
        if (output.done === true) return;
        previousResponseId = payload.id;
        inputItems = [{ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) }];
      }
      fail('The model worker exceeded its turn budget without finishing.');
    },
  });
}
