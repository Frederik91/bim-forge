import assert from 'node:assert/strict';
import test from 'node:test';
import { multiStoreySnapshot } from '../src/multi-storey-house.ts';
import { captureConversationVisual, requireCurrentVisual, visualLabel } from './request-chat-evidence.ts';

const revisionId = 'a'.repeat(64);

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
});
