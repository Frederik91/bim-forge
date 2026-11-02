import assert from 'node:assert/strict';
import test from 'node:test';
import { multiStoreySnapshot } from '../src/multi-storey-house.ts';
import { taskDispatchPoint } from './task-dispatch.ts';
import { entityAnchor } from './model-scene.ts';
import type { SpatialMarkup } from '../src/spatial-markup.ts';

const graph = multiStoreySnapshot();
test('dispatch uses the marked region before an unrelated selected object or earlier eye', () => {
  const markups: SpatialMarkup[] = [{ kind: 'rectangle', label: 'New area', corners: [[5, 2, 0], [7, 2, 0], [7, 4, 0], [5, 4, 0]] }];
  assert.deepEqual(taskDispatchPoint({ graph, selectedObjectIds: ['door-entry'], markups, eye: [2, 2, 1.6] }), [6, 3, 0]);
});
test('an opening task stays beside its host on the user’s side of the wall', () => {
  const item = graph.entities.find(entity => entity.id === 'door-entry'); assert.ok(item);
  const anchor = entityAnchor(item, graph);
  const point = taskDispatchPoint({ graph, selectedObjectIds: [item.id], markups: [], eye: [2, 2, 1.6] }); assert.ok(point);
  assert.equal(point[2], anchor.y); assert.ok(Math.hypot(point[0] - anchor.x, point[1] - anchor.z) >= .45);
  assert.ok(point[1] > anchor.z, 'The south entrance figure is in front of its host toward the user');
});
test('a wall task has enough clear space beyond the wall face and stays fixed after dispatch', () => {
  const wall = graph.entities.find(entity => entity.id === 'level-ground-wall-east'); assert.ok(wall?.type === 'Wall');
  const point = taskDispatchPoint({ graph, selectedObjectIds: [wall.id], markups: [], eye: [6, 3, 1.6] }); assert.ok(point);
  assert.ok(point[0] < wall.start[0] - wall.thickness / 2 - .4, 'The agent is outside the solid wall, on the interior side');
  const saved = [...point]; taskDispatchPoint({ graph, selectedObjectIds: [wall.id], markups: [], eye: [10, 3, 1.6] });
  assert.deepEqual(point, saved, 'A later context calculation never mutates a dispatched point');
});
test('unreferenced dispatch uses the actual current eye and does not infer an Overview point', () => {
  assert.deepEqual(taskDispatchPoint({ graph, selectedObjectIds: [], markups: [], eye: [6, 3, 1.6] }), [6, 3, 1.6]);
  assert.equal(taskDispatchPoint({ graph, selectedObjectIds: [], markups: [], eye: null }), null);
});
