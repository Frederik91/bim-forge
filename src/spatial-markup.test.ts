import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkupPlane, createSpatialMarkup, parseSpatialMarkup, spatialMarkupBounds, spatialMarkupDescription, spatialMarkupVertices } from './spatial-markup.ts';
import { parseConversationVisual, parseRequestConversation } from './request-conversation.ts';
import { RoomRepository } from './room-model.ts';
import { prepareModelProposal } from './model-proposal.ts';

const plane = createMarkupPlane({ origin: [0, 0, 3.2], normal: [0, 0, 1] });
const rectangle = createSpatialMarkup({ tool: 'rectangle', plane, start: [1, 2, 99], end: [4, 4, -1], label: 'Kitchen area' });
const visual = { snapshot: { kind: 'accepted', revisionId: 'a'.repeat(64) }, view: '3d', levelId: null, selectedObjectIds: [], annotations: [rectangle] };

test('a floor outline retains model metres and storey elevation independently of a camera', () => {
  assert.deepEqual(spatialMarkupBounds(rectangle), { min: [1, 2, 3.2], max: [4, 4, 3.2] });
  assert.equal(spatialMarkupDescription(rectangle), 'Rectangle · 3 × 2 m');
  assert.equal(spatialMarkupVertices(rectangle).length, 5);
  const saved = parseConversationVisual(JSON.parse(JSON.stringify(visual)));
  assert.deepEqual(saved.annotations, [rectangle]); assert.deepEqual(saved.selectedObjectIds, []);
  assert.equal(parseRequestConversation({ version: 1, ticketId: 'markup', sequence: 1, messages: [{ kind: 'user', id: 'draw', sequence: 1,
    at: 1, requestId: 'draw', baseRevisionId: visual.snapshot.revisionId, text: 'Add a kitchen here', sources: [], visual: saved }] }).messages.length, 1);
});

test('surface rectangles and exact circles retain their plane, rather than being flattened to the floor', () => {
  const wall = createMarkupPlane({ origin: [5, 0, 0], normal: [1, 0, 0] });
  const mark = createSpatialMarkup({ tool: 'rectangle', plane: wall, start: [5, 1, .5], end: [5, 3, 2], label: 'Wall' });
  assert.deepEqual(spatialMarkupBounds(mark), { min: [5, 1, .5], max: [5, 3, 2] });
  const circle = createSpatialMarkup({ tool: 'circle', plane: wall, start: [5, 2, 1], end: [5, 3, 1], label: 'Area' });
  assert.deepEqual(spatialMarkupBounds(circle), { min: [5, 1, 0], max: [5, 3, 2] });
  assert.equal(spatialMarkupVertices(circle).length, 65);
  assert.equal(spatialMarkupDescription(circle), 'Circle · radius 1 m');
});

test('invalid, degenerate, oversized and forged shapes are rejected at the conversation boundary', () => {
  for (const annotation of [
    { kind: 'line', from: [0, 0, 0], to: [0, 0, 0], label: '' },
    { kind: 'line', from: [0, 0, 0], to: [Infinity, 0, 0], label: '' },
    { kind: 'line', from: [0, 0, 0], to: [10_001, 0, 0], label: '' },
    { kind: 'circle', center: [0, 0, 0], normal: [0, 0, 2], radius: 1, label: '' },
    { kind: 'rectangle', corners: [[0, 0, 0], [1, 0, 0], [1, 1, 1], [0, 1, 0]], label: '' },
    { kind: 'polyline', points: [[0, 0, 0]], label: '' },
    { ...rectangle, grantsWrite: true },
  ]) assert.throws(() => parseConversationVisual({ ...visual, annotations: [annotation] }));
  assert.throws(() => parseConversationVisual({ ...visual, annotations: Array(17).fill(rectangle) }));
  assert.throws(() => createMarkupPlane({ origin: [0, 0, 0], normal: [0, 0, 0] }));
  assert.throws(() => parseSpatialMarkup({ kind: 'polyline', points: Array(65).fill([0, 0, 0]), label: '' }));
});

test('legacy pins and arrows remain readable alongside region markup', () => {
  const annotations = [{ kind: 'pin', position: [1, 2, 0], label: 'Here' },
    { kind: 'arrow', from: [0, 0, 0], to: [1, 2, 0], label: 'Move' }, rectangle];
  assert.deepEqual(parseConversationVisual({ ...visual, annotations }).annotations, annotations);
});

test('the actual worker receives generic region context without a fabricated selected object or model write', async () => {
  const repo = await RoomRepository.create('Markup context'); const before = repo.serialize(); const revisionId = repo.head('main');
  const mark = createSpatialMarkup({ tool: 'rectangle', plane: createMarkupPlane({ origin: [0, 0, 0], normal: [0, 0, 1] }),
    start: [1, 1, 0], end: [2, 3, 0], label: 'Area' });
  const result = await prepareModelProposal(repo, { requestId: 'region-context', proposalName: 'region-context', baseRevisionId: revisionId,
    selectedObjectIds: [], instruction: 'Add a kitchen here', visualIntent: { kind: 'selection' },
    conversationVisual: { ...visual, snapshot: { kind: 'accepted', revisionId }, annotations: [mark] } }, {
    identity: { provider: 'test', model: 'markup' }, async run(session) {
      assert.ok(session.input && typeof session.input === 'object' && 'request' in session.input);
      const request = session.input.request;
      assert.ok(request && typeof request === 'object' && 'markupContext' in request && 'selectedObjectIds' in request);
      assert.deepEqual(request.selectedObjectIds, []);
      assert.deepEqual(request.markupContext, { snapshot: { kind: 'accepted', revisionId }, levelId: null, units: 'metres',
        meaning: 'approximate user intent, not verified geometry or write authority',
        shapes: [{ shape: mark, bounds: { min: [1, 1, 0], max: [2, 3, 0] }, description: 'Rectangle · 1 × 2 m' }] });
      assert.match(session.instructions, /no implied vertical extent/);
      const outcome = await session.executeTool('run_model_script', { language: 'typescript', source: "return {kind:'clarify',question:'Which kitchen appliances do you want?',options:[]};" });
      assert.equal(outcome.done, true);
    },
  });
  assert.equal(result.status, 'declined'); assert.equal(repo.serialize(), before);
});
