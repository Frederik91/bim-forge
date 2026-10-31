import assert from 'node:assert/strict';
import test from 'node:test';
import { multiStoreySnapshot } from '../src/multi-storey-house.ts';
import { captureConversationVisual, requireCurrentVisual, visualLabel, conversationInspection, conversationSelection } from './request-chat-evidence.ts';
import { modelScopeFixture } from '../src/model-scope-fixture.ts';
import { createMarkupPlane, createSpatialMarkup } from '../src/spatial-markup.ts';

const revisionId = 'a'.repeat(64);

test('spatial markup is cloned, bound and replayed without changing the model or inheriting a selected desk', () => {
  const graph = multiStoreySnapshot(); const before = JSON.stringify(graph);
  const level = graph.entities.find(item => item.type === 'Level' && item.id === 'level-attic'); assert.ok(level?.type === 'Level');
  const mark = createSpatialMarkup({ tool: 'rectangle', plane: createMarkupPlane({ origin: [0, 0, level.elevation], normal: [0, 0, 1] }),
    start: [1, 1, level.elevation], end: [3, 2, level.elevation], label: 'Kitchen' });
  const visual = captureConversationVisual({ graph, snapshot: { kind: 'accepted', revisionId }, view: '3d', levelId: level.id,
    selectedObjectIds: [], reference: null, markups: [mark] });
  assert.deepEqual(visual.selectedObjectIds, []); assert.deepEqual(conversationInspection(graph, visual).annotations, [mark]);
  mark.label = 'Changed draft'; assert.equal(visual.annotations[0]?.label, 'Kitchen');
  assert.throws(() => requireCurrentVisual(visual, { kind: 'accepted', revisionId: 'b'.repeat(64) }), /another displayed snapshot/);
  assert.equal(JSON.stringify(graph), before);
});

test('reopening a conversation restores its actual object, room and level instead of the prior browsing default', () => {
  const graph = modelScopeFixture(); const before = JSON.stringify(graph);
  const visual = captureConversationVisual({ graph, snapshot: { kind: 'accepted', revisionId }, view: '3d', levelId: 'level-ground',
    selectedObjectIds: ['office-desk'], reference: null });
  const context = conversationSelection({ graph, selectedObjectIds: ['office-desk'], visual });
  assert.deepEqual(context, { selectedId: 'office-desk', roomId: 'room-office', levelId: 'level-ground', view: '3d' });
  assert.equal(conversationSelection({ graph, selectedObjectIds: ['deleted-desk'], visual }).selectedId, null);
  assert.equal(JSON.stringify(graph), before);
});

test('inspecting retained pins produces a distinct read-only overlay with its exact snapshot and no model mutation', () => {
  const graph = multiStoreySnapshot(); const before = JSON.stringify(graph);
  const visual = captureConversationVisual({ graph, snapshot: { kind: 'proposal', revisionId, proposalName: 'attic-change' }, view: '2d',
    levelId: 'level-attic', selectedObjectIds: ['level-attic-plant'],
    reference: { kind: 'floor-point', levelId: 'level-attic', positionMm: [3500, 3000] } });
  const evidence = JSON.stringify(visual); const inspection = conversationInspection(graph, visual);
  assert.equal(inspection.kind, 'inspection'); assert.deepEqual(inspection.snapshot, visual.snapshot);
  assert.deepEqual(inspection.reference, { kind: 'floor-point', levelId: 'level-attic', positionMm: [3500, 3000] });
  assert.equal(inspection.context.selectedId, 'level-attic-plant'); assert.equal(inspection.context.levelId, 'level-attic');
  assert.equal(JSON.stringify(graph), before); assert.equal(JSON.stringify(visual), evidence);
  assert.throws(() => conversationInspection(graph, { ...visual, selectedObjectIds: ['proposal-only-missing'] }), /absent/);
});

test('a 3D attic pin retains selected stable IDs, model coordinates and immutable proposal binding', () => {
  const graph = multiStoreySnapshot(); const before = JSON.stringify(graph);
  const level = graph.entities.find(item => item.type === 'Level' && item.id === 'level-attic'); assert.ok(level?.type === 'Level');
  const visual = captureConversationVisual({ graph, snapshot: { kind: 'proposal', revisionId, proposalName: 'attic-change' }, view: '3d', levelId: level.id,
    selectedObjectIds: ['level-attic-plant', 'level-attic-plant'], reference: { kind: 'floor-point', levelId: level.id, positionMm: [3500, 3000] } });
  assert.deepEqual(visual.annotations, [{ kind: 'pin', position: [3.5, 3, level.elevation], label: 'Marked floor location' }]);
  assert.deepEqual(visual.selectedObjectIds, ['level-attic-plant']);
  assert.equal(visual.snapshot.kind, 'proposal'); assert.match(visualLabel(visual), /Proposal attic-change.*3D.*level-attic/);
  assert.equal(JSON.stringify(graph), before);
});

test('a 2D wall marker converts millimetres along the wall into model metres without authoring', () => {
  const graph = multiStoreySnapshot(); const wall = graph.entities.find(item => item.type === 'Wall'); assert.ok(wall?.type === 'Wall');
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  const visual = captureConversationVisual({ graph, snapshot: { kind: 'accepted', revisionId }, view: '2d', levelId: wall.levelId ?? null,
    selectedObjectIds: [wall.id], reference: { kind: 'wall-point', wallId: wall.id, alongWallMm: length * 500 } });
  const pin = visual.annotations[0]; assert.ok(pin?.kind === 'pin');
  assert.equal(pin.position[0], (wall.start[0] + wall.end[0]) / 2); assert.equal(pin.position[1], (wall.start[1] + wall.end[1]) / 2);
  requireCurrentVisual(visual, { kind: 'accepted', revisionId });
  assert.throws(() => requireCurrentVisual(visual, { kind: 'accepted', revisionId: 'b'.repeat(64) }), /another displayed snapshot/);
  assert.throws(() => requireCurrentVisual(visual, { kind: 'proposal', revisionId, proposalName: 'same-content' }), /another displayed snapshot/);
});

test('missing objects, levels and unqualified building pins cannot silently become current evidence', () => {
  const graph = multiStoreySnapshot();
  const input = { graph, snapshot: { kind: 'accepted', revisionId }, view: '2d', levelId: null, selectedObjectIds: [], reference: null } satisfies Parameters<typeof captureConversationVisual>[0];
  assert.throws(() => captureConversationVisual({ ...input, selectedObjectIds: ['deleted'] }), /absent from this snapshot/);
  assert.throws(() => captureConversationVisual({ ...input, levelId: 'missing' }), /level is absent/);
  assert.throws(() => captureConversationVisual({ ...input, reference: { kind: 'floor-point', positionMm: [1000, 1000] } }), /storey/);
  const wholeBuilding = captureConversationVisual({ ...input, view: '3d', reference: { kind: 'floor-point', levelId: 'level-attic', positionMm: [1000, 1000] } });
  assert.equal(wholeBuilding.levelId, 'level-attic');
  assert.throws(() => captureConversationVisual({ ...input, levelId: 'level-ground', reference: { kind: 'floor-point', levelId: 'level-attic', positionMm: [1000, 1000] } }), /another storey/);
});
