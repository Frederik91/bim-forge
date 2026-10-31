import { assetFootprint, assetElevation, assetCeiling } from './asset-family.ts';
import type { AssetInstance } from './asset-family.ts';
import { entityLevel, levelView, levels, stairFootprint } from './building-levels.ts';
import { clearSpaceBounds, containsBounds, doorClearanceBounds, floorBounds, overlapsBounds, spaces } from './floor-plan.ts';
import { furnitureFootprint } from './room-model.ts';
import type { Bounds, ModelGraph } from './room-model.ts';

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
  if (families.length > 32) throw new Error('A model supports at most 32 asset families.');
  if (instances.length + graph.entities.filter((item) => item.type === 'Furniture').length > 32) {
    throw new Error('A model supports at most 32 combined furnishings and asset instances.');
  }
  for (const instance of instances) {
    const bottom = assetElevation(graph, instance);
    const top = bottom + instance.size.height;
    const intersectsHeight = (low: number, high: number): boolean => top > low + 1e-9 && bottom < high - 1e-9;
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
    validateWallMount(graph, instance);
    if (bottom < -1e-9 || !Number.isFinite(bottom)) throw new Error('Asset suspension must remain above its room floor.');
    if (top > assetCeiling(graph, instance) + 1e-9) throw new Error('Asset must fit below its ceiling, roof underside and upper slabs.');
    for (const entity of view.entities) {
      if (entity.type === 'Door' && intersectsHeight(0, entity.height) && overlapsBounds(footprint, doorClearanceBounds(view, entity))) throw new Error('Asset blocks a door clearance zone.');
      if (entity.type === 'Stair' && overlapsBounds(footprint, stairFootprint(entity))) throw new Error('Asset must remain clear of stairs and slab voids.');
      if (entity.type === 'Furniture') {
        const support = view.entities.find((item) => item.id === entity.supportId);
        const bottom = support?.type === 'Furniture' ? support.height : 0;
        if (intersectsHeight(bottom, bottom + entity.height) && overlapsBounds(footprint, furnitureFootprint(entity))) throw new Error('Asset overlaps existing furniture.');
      }
      if (entity.type === 'Equipment' && intersectsHeight(entity.elevation, entity.elevation + entity.height)) {
        const [x, y] = entity.position;
        if (overlapsBounds(footprint, { minX: x - entity.width / 2, maxX: x + entity.width / 2,
          minY: y - entity.depth / 2, maxY: y + entity.depth / 2 })) throw new Error('Asset overlaps existing equipment.');
      }
      if (entity.type === 'AssetInstance' && entity.id !== instance.id && intersectsHeight(assetElevation(graph, entity), assetElevation(graph, entity) + entity.size.height) && overlapsBounds(footprint, assetFootprint(view, entity))) {
        throw new Error('Asset instances overlap.');
      }
    }
  }
}

/** A wall host must be on the same floor and touch a full footprint edge. */
function validateWallMount(graph: ModelGraph, instance: AssetInstance): void {
  const mounting = instance.mounting;
  if (mounting?.kind !== 'wall') return;
  const wall = graph.entities.find(item => item.id === mounting.wallId);
  if (wall?.type !== 'Wall' || entityLevel(graph, wall)?.id !== entityLevel(graph, instance)?.id) {
    throw new Error('Wall-mounted asset requires an existing wall host on its owning level.');
  }
  const b = assetFootprint(graph, instance); const tolerance = 1e-6;
  const horizontal = wall.start[1] === wall.end[1]; const vertical = wall.start[0] === wall.end[0];
  const alongMin = horizontal ? b.minX : b.minY; const alongMax = horizontal ? b.maxX : b.maxY;
  const start = horizontal ? wall.start[0] : wall.start[1]; const end = horizontal ? wall.end[0] : wall.end[1];
  const axis = horizontal ? wall.start[1] : wall.start[0];
  const touches = [horizontal ? b.minY : b.minX, horizontal ? b.maxY : b.maxX]
    .some(edge => Math.abs(Math.abs(edge - axis) - wall.thickness / 2) < tolerance);
  if ((!horizontal && !vertical) || !touches || alongMin < Math.min(start, end) - tolerance || alongMax > Math.max(start, end) + tolerance) {
    throw new Error('Wall-mounted asset must touch and fit the host wall face.');
  }
  if (mounting.elevation + instance.size.height > wall.height + tolerance) throw new Error('Wall-mounted asset must fit its host height.');
  for (const link of graph.relationships.filter(link => link.target === wall.id)) {
    const opening = graph.entities.find(item => item.id === link.source);
    if (opening?.type !== 'Door' && opening?.type !== 'Window') continue;
    const low = opening.type === 'Window' ? opening.sillHeight : 0;
    const openingStart = end >= start ? start + link.offset : start - link.offset - opening.width;
    if (mounting.elevation < low + opening.height - tolerance && mounting.elevation + instance.size.height > low + tolerance
      && alongMax > openingStart + tolerance && alongMin < openingStart + opening.width - tolerance) {
      throw new Error('Wall-mounted asset overlaps a host opening.');
    }
  }
}
