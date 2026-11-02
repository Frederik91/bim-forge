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
test('explicit object dispatch uses its validated native anchor', () => {
  const item = graph.entities.find(entity => entity.id === 'door-entry'); assert.ok(item);
  const anchor = entityAnchor(item, graph);
  assert.deepEqual(taskDispatchPoint({ graph, selectedObjectIds: [item.id], markups: [], eye: [2, 2, 1.6] }), [anchor.x, anchor.z, anchor.y]);
});
test('unreferenced dispatch uses the actual current eye and does not infer an Overview point', () => {
  assert.deepEqual(taskDispatchPoint({ graph, selectedObjectIds: [], markups: [], eye: [6, 3, 1.6] }), [6, 3, 1.6]);
  assert.equal(taskDispatchPoint({ graph, selectedObjectIds: [], markups: [], eye: null }), null);
});
