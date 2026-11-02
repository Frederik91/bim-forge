import { entityAnchor } from './model-scene.ts';
import type { ModelSnapshot } from '../src/room-model.ts';
import { spatialMarkupBounds } from '../src/spatial-markup.ts';
import type { SpatialMarkup } from '../src/spatial-markup.ts';
import type { NavigationPoint } from './view-navigation.ts';
import { furnitureFootprint } from '../src/room-model.ts';
import type { Bounds, Entity } from '../src/room-model.ts';
import { assetGeometry } from '../src/asset-family.ts';
import { floorBounds } from '../src/floor-plan.ts';
import { levelView, stairFootprint } from '../src/building-levels.ts';

const agentClearance = .45;

function footprint(item: Entity, graph: ModelSnapshot): Bounds | null {
  switch (item.type) {
    case 'Furniture': return furnitureFootprint(item);
    case 'AssetInstance': return assetGeometry(graph, item).bounds;
    case 'Equipment': return { minX: item.position[0] - item.width / 2, maxX: item.position[0] + item.width / 2,
      minY: item.position[1] - item.depth / 2, maxY: item.position[1] + item.depth / 2 };
    case 'Space': case 'Slab': case 'Roof': return item.bounds;
    case 'Level': return floorBounds(levelView(graph, item.id));
    case 'Stair': return stairFootprint(item);
    case 'Wall': case 'Door': case 'Window': case 'Opening': case 'AssetFamily': return null;
    default: { const exhaustive: never = item; return exhaustive; }
  }
}

function besideObject(item: Entity, graph: ModelSnapshot, viewpoint: NavigationPoint | null): NavigationPoint {
  const anchor = entityAnchor(item, graph);
  const host = graph.relationships.find(link => link.source === item.id);
  const wall = item.type === 'Wall' ? item : graph.entities.find(entity => entity.id === host?.target);
  if (wall?.type === 'Wall') {
    const dx = wall.end[0] - wall.start[0]; const dy = wall.end[1] - wall.start[1]; const length = Math.hypot(dx, dy);
    const tx = dx / length; const ty = dy / length; const nx = -ty; const ny = tx;
    const side = !viewpoint || (viewpoint[0] - anchor.x) * nx + (viewpoint[1] - anchor.z) * ny >= 0 ? 1 : -1;
    let along = 0;
    if (item.type === 'Door' || item.type === 'Window' || item.type === 'Opening') {
      const preference = viewpoint && (viewpoint[0] - anchor.x) * tx + (viewpoint[1] - anchor.z) * ty < 0 ? -1 : 1;
      const beside = item.width / 2 + .3; const centre = host ? host.offset + item.width / 2 : length / 2;
      const fits = (offset: number) => centre + offset >= .2 && centre + offset <= length - .2;
      along = fits(beside * preference) ? beside * preference : fits(-beside * preference) ? -beside * preference : 0;
    }
    // The rendered figure's hands reach .18 m; leave further room for motion and picking.
    const normal = (wall.thickness / 2 + agentClearance) * side;
    return [anchor.x + nx * normal + tx * along, anchor.z + ny * normal + ty * along, anchor.y];
  }
  const bounds = footprint(item, graph);
  if (!bounds) return [anchor.x, anchor.z, anchor.y];
  const x = (bounds.minX + bounds.maxX) / 2; const y = (bounds.minY + bounds.maxY) / 2;
  const dx = viewpoint ? viewpoint[0] - x : 0; const dy = viewpoint ? viewpoint[1] - y : -1;
  const direction = Math.hypot(dx, dy) > .0001 ? [dx, dy] : [0, -1];
  const scale = Math.min(direction[0] === 0 ? Infinity : ((bounds.maxX - bounds.minX) / 2 + agentClearance) / Math.abs(direction[0]),
    direction[1] === 0 ? Infinity : ((bounds.maxY - bounds.minY) / 2 + agentClearance) / Math.abs(direction[1]));
  return [x + direction[0] * scale, y + direction[1] * scale, anchor.y];
}

/** Select the instruction's location at dispatch, independently of the assistant's earlier position. */
export function taskDispatchPoint(input: { graph: ModelSnapshot; selectedObjectIds: readonly string[];
  markups: readonly SpatialMarkup[]; eye: NavigationPoint | null; viewpoint?: NavigationPoint | null }): NavigationPoint | null {
  const regions = input.markups.map(spatialMarkupBounds);
  if (regions.length) return [
    (Math.min(...regions.map(b => b.min[0])) + Math.max(...regions.map(b => b.max[0]))) / 2,
    (Math.min(...regions.map(b => b.min[1])) + Math.max(...regions.map(b => b.max[1]))) / 2,
    (Math.min(...regions.map(b => b.min[2])) + Math.max(...regions.map(b => b.max[2]))) / 2,
  ];
  const points = input.selectedObjectIds.map(id => {
    const item = input.graph.entities.find(entity => entity.id === id);
    if (!item || item.type === 'AssetFamily') throw new Error('Select a spatial model item before assigning this task.');
    return besideObject(item, input.graph, input.viewpoint ?? input.eye);
  });
  if (points.length) return [points.reduce((sum, p) => sum + p[0], 0) / points.length,
    points.reduce((sum, p) => sum + p[1], 0) / points.length, points.reduce((sum, p) => sum + p[2], 0) / points.length];
  return input.eye;
}
