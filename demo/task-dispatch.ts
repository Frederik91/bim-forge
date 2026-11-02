import { entityAnchor } from './model-scene.ts';
import type { ModelSnapshot } from '../src/room-model.ts';
import { spatialMarkupBounds } from '../src/spatial-markup.ts';
import type { SpatialMarkup } from '../src/spatial-markup.ts';
import type { NavigationPoint } from './view-navigation.ts';

/** Select the instruction's location at dispatch, independently of the assistant's earlier position. */
export function taskDispatchPoint(input: { graph: ModelSnapshot; selectedObjectIds: readonly string[];
  markups: readonly SpatialMarkup[]; eye: NavigationPoint | null }): NavigationPoint | null {
  const regions = input.markups.map(spatialMarkupBounds);
  if (regions.length) return [
    (Math.min(...regions.map(b => b.min[0])) + Math.max(...regions.map(b => b.max[0]))) / 2,
    (Math.min(...regions.map(b => b.min[1])) + Math.max(...regions.map(b => b.max[1]))) / 2,
    (Math.min(...regions.map(b => b.min[2])) + Math.max(...regions.map(b => b.max[2]))) / 2,
  ];
  const points = input.selectedObjectIds.map(id => {
    const item = input.graph.entities.find(entity => entity.id === id);
    if (!item || item.type === 'AssetFamily') throw new Error('Select a spatial model item before assigning this task.');
    const anchor = entityAnchor(item, input.graph);
    const hostId = input.graph.relationships.find(link => link.source === item.id)?.target;
    const wall = item.type === 'Wall' ? item : input.graph.entities.find(entity => entity.id === hostId);
    if (wall?.type === 'Wall' && input.eye) {
      const dx = wall.end[0] - wall.start[0]; const dy = wall.end[1] - wall.start[1]; const length = Math.hypot(dx, dy);
      const nx = -dy / length; const ny = dx / length;
      const side = (input.eye[0] - anchor.x) * nx + (input.eye[1] - anchor.z) * ny >= 0 ? 1 : -1;
      const gap = (wall.thickness / 2 + .45) * side;
      return [anchor.x + nx * gap, anchor.z + ny * gap, anchor.y] satisfies NavigationPoint;
    }
    return [anchor.x, anchor.z, anchor.y] satisfies NavigationPoint;
  });
  if (points.length) return [points.reduce((sum, p) => sum + p[0], 0) / points.length,
    points.reduce((sum, p) => sum + p[1], 0) / points.length, points.reduce((sum, p) => sum + p[2], 0) / points.length];
  return input.eye;
}
