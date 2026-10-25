import { assetFootprint } from './asset-family.ts';
import type { AssetInstance } from './asset-family.ts';
import { entityLevel, levelView, levels, roofHeightAt, stairFootprint } from './building-levels.ts';
import { clearSpaceBounds, containsBounds, doorClearanceBounds, floorBounds, overlapsBounds, spaces } from './floor-plan.ts';
import { furnitureFootprint } from './room-model.ts';
import type { Bounds, ModelGraph, Point } from './room-model.ts';

function singleRoomBounds(graph: ModelGraph): Bounds {
  const walls = graph.entities.filter((item) => item.type === 'Wall');
  const bounds = floorBounds(graph);
  const sides = new Set(walls.map((wall) => {
    if (wall.start[1] === wall.end[1] && Math.min(wall.start[0], wall.end[0]) === bounds.minX && Math.max(wall.start[0], wall.end[0]) === bounds.maxX) {
      return wall.start[1] === bounds.minY ? 'south' : wall.start[1] === bounds.maxY ? 'north' : 'invalid';
    }
    if (wall.start[0] === wall.end[0] && Math.min(wall.start[1], wall.end[1]) === bounds.minY && Math.max(wall.start[1], wall.end[1]) === bounds.maxY) {
      return wall.start[0] === bounds.minX ? 'west' : wall.start[0] === bounds.maxX ? 'east' : 'invalid';
    }
    return 'invalid';
  }));
  if (walls.length !== 4 || sides.size !== 4 || sides.has('invalid') || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) {
    throw new Error('Single-room assets require one enclosed rectangular shell.');
  }
  const inset = Math.max(...walls.map((wall) => wall.thickness / 2));
  return { minX: bounds.minX + inset, minY: bounds.minY + inset, maxX: bounds.maxX - inset, maxY: bounds.maxY - inset };
}

/** Shared validation on every candidate, including ordinary furnishing and shell edits. */
export function validateAssets(graph: ModelGraph): void {
  const families = graph.entities.filter((item) => item.type === 'AssetFamily');
  const instances = graph.entities.filter((item): item is AssetInstance => item.type === 'AssetInstance');
  if (families.length > 8) throw new Error('A model supports at most eight asset families.');
  if (instances.length + graph.entities.filter((item) => item.type === 'Furniture').length > 32) {
    throw new Error('A model supports at most 32 combined furnishings and asset instances.');
  }
  for (const instance of instances) {
    const footprint = assetFootprint(graph, instance);
    let allowed: Bounds;
    if (instance.placement.kind === 'single-room') {
      if (graph.version === 2 || spaces(graph).length || levels(graph).length) {
        throw new Error('Single-room asset placement cannot survive room reconstruction. Explicitly remove and rebind the instance to a named room.');
      }
      allowed = singleRoomBounds(graph);
    } else {
      const roomId = instance.placement.roomId;
      const room = spaces(graph).find((item) => item.id === roomId);
      if (!room) throw new Error('Asset placement must reference an existing room; retain that room or explicitly rebind/remove the instance before reconstruction.');
      allowed = clearSpaceBounds(graph, room);
    }
    if (!containsBounds(allowed, footprint)) throw new Error('Asset footprint must fit its bound room clear of wall thickness.');
    const owner = entityLevel(graph, instance);
    const view = owner ? levelView(graph, owner.id) : graph;
    const walls = view.entities.filter((item) => item.type === 'Wall');
    if (instance.size.height > Math.min(...walls.map((wall) => wall.height)) + 1e-9) throw new Error('Asset must fit below its room ceiling.');
    const corners: Point[] = [[footprint.minX, footprint.minY], [footprint.minX, footprint.maxY],
      [footprint.maxX, footprint.minY], [footprint.maxX, footprint.maxY]];
    if (owner && corners.some((point) => instance.size.height > roofHeightAt(view, owner.id, point) + 1e-9)) throw new Error('Asset must fit below the roof underside.');
    for (const entity of view.entities) {
      if (entity.type === 'Door' && overlapsBounds(footprint, doorClearanceBounds(view, entity))) throw new Error('Asset blocks a door clearance zone.');
      if (entity.type === 'Stair' && overlapsBounds(footprint, stairFootprint(entity))) throw new Error('Asset must remain clear of stairs and slab voids.');
      if (entity.type === 'Furniture') {
        const support = view.entities.find((item) => item.id === entity.supportId);
        const bottom = support?.type === 'Furniture' ? support.height : 0;
        if (instance.size.height > bottom + 1e-9 && overlapsBounds(footprint, furnitureFootprint(entity))) throw new Error('Asset overlaps existing furniture.');
      }
      if (entity.type === 'Equipment' && instance.size.height > entity.elevation + 1e-9) {
        const [x, y] = entity.position;
        if (overlapsBounds(footprint, { minX: x - entity.width / 2, maxX: x + entity.width / 2,
          minY: y - entity.depth / 2, maxY: y + entity.depth / 2 })) throw new Error('Asset overlaps existing equipment.');
      }
      if (entity.type === 'AssetInstance' && entity.id !== instance.id && overlapsBounds(footprint, assetFootprint(view, entity))) {
        throw new Error('Asset instances overlap.');
      }
    }
    if (owner) for (const entity of graph.entities) {
      if (entity.type !== 'Slab') continue;
      const slabLevel = entityLevel(graph, entity);
      if (slabLevel && slabLevel.elevation > owner.elevation && overlapsBounds(footprint, entity.bounds)
          && owner.elevation + instance.size.height > slabLevel.elevation - entity.thickness + 1e-9) {
        throw new Error('Asset must remain below overlapping upper slabs.');
      }
    }
  }
}
