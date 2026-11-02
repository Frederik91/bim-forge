import assert from 'node:assert/strict';
import test from 'node:test';
import { multiStoreySnapshot } from '../src/multi-storey-house.ts';
import { taskDispatchPoint } from './task-dispatch.ts';
import { entityAnchor } from './model-scene.ts';
import type { SpatialMarkup } from '../src/spatial-markup.ts';
import { validateSnapshot, furnitureFootprint } from '../src/room-model.ts';
import type { ModelSnapshot } from '../src/room-model.ts';
import { personFamily, personInstance } from '../src/asset-fixture.ts';
import { assetGeometry } from '../src/asset-family.ts';

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
  assert.equal(taskDispatchPoint({ graph, selectedObjectIds: [], markups: [], eye: null, viewpoint: [10, -5, 4] }), null,
    'The Overview camera chooses the side of selected geometry; it never becomes an unreferenced task origin');
});

test('Overview door, window and permanent opening agents are outside the host face and beside the jamb', () => {
  const before = structuredClone(graph);
  for (const type of ['Door', 'Window', 'Opening']) {
    const selectedId = type === 'Window' ? 'dispatch-window' : 'door-entry';
    const variant = validateSnapshot(type === 'Window' ? { ...graph, entities: [...graph.entities,
      { id: selectedId, type: 'Window', name: 'Dispatch window', width: .9, height: 1.5, sillHeight: .8 }],
      relationships: [...graph.relationships, { id: 'host-dispatch-window', type: 'hosted-by', source: selectedId, target: 'level-ground-wall-south', offset: 5 }] }
      : { ...graph, entities: graph.entities.map(entity => entity.id === selectedId ? { ...entity, type } : entity) });
    const item = variant.entities.find(entity => entity.id === selectedId); assert.ok(item && 'width' in item);
    const host = variant.relationships.find(link => link.source === item.id); assert.ok(host);
    const wall = variant.entities.find(entity => entity.id === host.target); assert.ok(wall?.type === 'Wall');
    const anchor = entityAnchor(item, variant);
    for (const y of [-5, 5]) {
      const point = taskDispatchPoint({ graph: variant, selectedObjectIds: [item.id], markups: [], eye: null, viewpoint: [2, y, 4] }); assert.ok(point);
      assert.equal(Math.sign(point[1] - anchor.z), Math.sign(y));
      assert.ok(Math.abs(point[1] - anchor.z) >= wall.thickness / 2 + .44, `${type}: the entire figure clears the host wall`);
      assert.ok(Math.abs(point[0] - anchor.x) >= item.width / 2 + .29, `${type}: figure is beside the opening, rather than covering its centre`);
      assert.equal(point[2], anchor.y);
    }
    const withoutCamera = taskDispatchPoint({ graph: variant, selectedObjectIds: [item.id], markups: [], eye: null }); assert.ok(withoutCamera);
    assert.ok(Math.abs(withoutCamera[1] - anchor.z) >= wall.thickness / 2 + .44, 'Missing camera never embeds the figure');
  }
  assert.deepEqual(graph, before, 'No construction or host relationship is changed by placement');
});

test('upper-level rotated furniture and authored assets place figures beyond their real footprints', () => {
  const item = graph.entities.find(entity => entity.id === 'level-attic-plant'); assert.ok(item?.type === 'Furniture');
  const rotated: typeof item = { ...item, width: 1.4, depth: .6, rotationDeg: 90 };
  const furnitureGraph = { ...graph, entities: graph.entities.map(entity => entity.id === item.id ? rotated : entity) };
  const bounds = furnitureFootprint(rotated);
  const point = taskDispatchPoint({ graph: furnitureGraph, selectedObjectIds: [item.id], markups: [], eye: [4, 4.8, 4.6] }); assert.ok(point);
  assert.ok(point[0] >= bounds.maxX + .44); assert.equal(point[2], entityAnchor(rotated, furnitureGraph).y);
  const family = personFamily(); const instance = personInstance();
  const assetGraph: ModelSnapshot = { units: 'm', entities: [family, instance], relationships: [] };
  const assetBounds = assetGeometry(assetGraph, instance).bounds;
  const assetPoint = taskDispatchPoint({ graph: assetGraph, selectedObjectIds: [instance.id], markups: [], eye: [10, instance.position[1], 1.6] }); assert.ok(assetPoint);
  assert.ok(assetPoint[0] >= assetBounds.maxX + .44);
});
