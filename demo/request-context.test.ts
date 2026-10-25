import assert from 'node:assert/strict';
import test from 'node:test';
import { requestContext } from './request-context.ts';
import { multiStoreySnapshot } from '../src/multi-storey-house.ts';
import { residentialFloor } from '../src/residential-floor.ts';

test('opening or revising an attic ticket restores its object, room and level independently of the browsing floor', () => {
  const snapshot = multiStoreySnapshot();
  assert.deepEqual(requestContext(snapshot, ['level-attic-plant', 'level-attic-west', 'level-attic']), {
    selectedId: 'level-attic-plant', levelId: 'level-attic', roomId: 'level-attic-west',
  });
  assert.equal(requestContext(snapshot, ['level-attic-plant']).levelId, 'level-attic');
  assert.equal(requestContext(snapshot, ['missing', 'level-attic']).selectedId, 'level-attic');
  assert.equal(requestContext(snapshot, ['level-attic', 'level-ground']).levelId, null);
});

test('level-qualified destinations restore their floor without persisting a level into legacy references', () => {
  const snapshot = multiStoreySnapshot();
  const context = requestContext(snapshot, [], { kind: 'spatial-reference', destination: {
    kind: 'floor-point', levelId: 'level-basement', positionMm: [3500, 3000],
  } });
  assert.equal(context.levelId, 'level-basement');
  const legacy = residentialFloor(); const before = JSON.stringify(legacy);
  const level = legacy.entities.find(item => item.type === 'Level'); assert.ok(level);
  assert.equal(requestContext(legacy, [level.id]).levelId, level.id);
  assert.equal(JSON.stringify(legacy), before);
});
