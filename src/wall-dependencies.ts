import { entityLevel, levelView } from './building-levels.ts';
import { clearSpaceBounds, doorClearanceBounds, entitySpace, floorBounds, overlapsBounds, spaces } from './floor-plan.ts';
import { diffSnapshots, identifier, validateSnapshot } from './room-model.ts';
import type { EntityId, ModelDelta, ModelSnapshot, Point, Space, Wall } from './room-model.ts';

export interface WallShiftRequest { wallId: string; offsetMetres: number }
export type WallShiftReason = 'target-translation' | 'room-boundary' | 'wall-junction'
  | 'hosted-opening' | 'opening-host' | 'room-contents' | 'support' | 'level-envelope';
export interface WallShiftImpact {
  kind: 'entity' | 'relationship';
  id: EntityId;
  reasons: WallShiftReason[];
  /** Stored bytes changed; false does not imply unchanged evaluated geometry. */
  changed: boolean;
}
export interface WallShiftPreview { snapshot: ModelSnapshot; delta: ModelDelta; impacts: WallShiftImpact[] }

interface Segment { along: 0 | 1; fixed: 0 | 1; at: number; low: number; high: number }
interface RoomSide { room: Space; side: 'minX' | 'maxX' | 'minY' | 'maxY'; low: number; high: number }

function segment(wall: Wall): Segment {
  if (wall.start[0] === wall.end[0]) return { along: 1, fixed: 0, at: wall.start[0],
    low: Math.min(wall.start[1], wall.end[1]), high: Math.max(wall.start[1], wall.end[1]) };
  if (wall.start[1] === wall.end[1]) return { along: 0, fixed: 1, at: wall.start[1],
    low: Math.min(wall.start[0], wall.end[0]), high: Math.max(wall.start[0], wall.end[0]) };
  throw new Error(`Wall ${wall.id} requires axis-aligned topology.`);
}

function roomSide(room: Space, edge: Segment): RoomSide[] {
  const b = room.bounds;
  const low = edge.along === 0 ? b.minX : b.minY;
  const high = edge.along === 0 ? b.maxX : b.maxY;
  if (low >= edge.high || high <= edge.low) return [];
  const sides: RoomSide['side'][] = edge.fixed === 0 ? ['minX', 'maxX'] : ['minY', 'maxY'];
  return sides.filter((side) => b[side] === edge.at).map((side) => ({ room, side, low, high }));
}

function covers(sides: RoomSide[], edge: Segment): boolean {
  let cursor = edge.low;
  for (const side of [...sides].sort((a, b) => a.low - b.low)) {
    if (side.low > cursor) return false;
    cursor = Math.max(cursor, side.high);
  }
  return cursor === edge.high;
}

function shiftPoint(point: Point, axis: 0 | 1, at: number): Point {
  return axis === 0 ? [at, point[1]] : [point[0], at];
}

/**
 * Pure, atomic preview of a complete interior partition translated along global +X/+Y.
 * At most one metre, on the native millimetre grid. No repository or review authority.
 */
export function previewWallShift(baseSnapshot: unknown, input: WallShiftRequest): WallShiftPreview {
  const wallId = identifier(input.wallId);
  const offset = input.offsetMetres;
  if (!Number.isFinite(offset) || Math.abs(offset) < .001 || Math.abs(offset) > 1
      || Math.abs(offset * 1000 - Math.round(offset * 1000)) > 1e-6) {
    throw new Error('Wall shift requires a nonzero millimetre-grid offset of at most one metre.');
  }
  const base = validateSnapshot(baseSnapshot);
  const target = base.entities.find((item) => item.id === wallId);
  if (target?.type !== 'Wall') throw new Error(`Wall shift target ${wallId} must identify an existing wall.`);
  const level = entityLevel(base, target);
  if (!level) throw new Error('Wall shift requires a named residential level and rectangular rooms.');
  const view = levelView(base, level.id);
  const edge = segment(target);
  const bounds = floorBounds(view);
  const exterior = edge.fixed === 0 ? [bounds.minX, bounds.maxX] : [bounds.minY, bounds.maxY];
  if (exterior.includes(edge.at)) throw new Error(`Exterior wall ${wallId} cannot be shifted by a partition preview.`);
  const sides = spaces(view).flatMap((room) => roomSide(room, edge));
  if (sides.some((side) => side.low < edge.low || side.high > edge.high)) {
    throw new Error(`Wall ${wallId} covers only part of a rectangular room side; topology is unsupported.`);
  }
  const minimum = edge.fixed === 0 ? 'minX' : 'minY';
  if (!covers(sides.filter((side) => side.side === minimum), edge)
      || !covers(sides.filter((side) => side.side !== minimum), edge)) {
    throw new Error(`Wall ${wallId} requires complete adjacent rectangular rooms on both sides.`);
  }

  const movedAt = Math.round((edge.at + offset) * 1000) / 1000;
  const replacements = new Map<EntityId, Wall>();
  replacements.set(target.id, { ...target, start: shiftPoint(target.start, edge.fixed, movedAt),
    end: shiftPoint(target.end, edge.fixed, movedAt) });
  const impacts = new Map<string, WallShiftImpact>();
  const mark = (kind: WallShiftImpact['kind'], id: EntityId, reason: WallShiftReason): void => {
    const key = `${kind}:${id}`;
    const impact = impacts.get(key) ?? { kind, id, reasons: [], changed: false };
    if (!impact.reasons.includes(reason)) impact.reasons.push(reason);
    impacts.set(key, impact);
  };
  mark('entity', target.id, 'target-translation');
  const junctions = new Set<EntityId>([target.id]);
  for (const other of view.entities) {
    if (other.type !== 'Wall' || other.id === target.id) continue;
    const neighbour = segment(other);
    if (neighbour.fixed === edge.fixed) {
      if (neighbour.at === edge.at && neighbour.low <= edge.high && neighbour.high >= edge.low) {
        throw new Error(`Collinear continuation ${other.id} requires a separate topology operation.`);
      }
      continue;
    }
    if (neighbour.at < edge.low || neighbour.at > edge.high || edge.at < neighbour.low || edge.at > neighbour.high) continue;
    const startsHere = other.start[edge.fixed] === edge.at;
    const endsHere = other.end[edge.fixed] === edge.at;
    if (!startsHere && !endsHere && neighbour.at !== edge.low && neighbour.at !== edge.high) {
      throw new Error(`Crossing junction ${other.id} is unsupported; only terminating T-junctions can follow the wall.`);
    }
    junctions.add(other.id);
    mark('entity', other.id, 'wall-junction');
    if (startsHere || endsHere) {
      const remainingAt = startsHere ? other.end[edge.fixed] : other.start[edge.fixed];
      if ((remainingAt - edge.at) * (remainingAt - movedAt) <= 0) {
        throw new Error(`Wall shift would collapse or reverse connected wall ${other.id}.`);
      }
      replacements.set(other.id, { ...other,
        start: startsHere ? shiftPoint(other.start, edge.fixed, movedAt) : other.start,
        end: endsHere ? shiftPoint(other.end, edge.fixed, movedAt) : other.end });
    }
  }

  const roomBounds = new Map(sides.map(({ room, side }) => {
    mark('entity', room.id, 'room-boundary');
    const b = { ...room.bounds, [side]: movedAt };
    if (b.minX >= b.maxX || b.minY >= b.maxY) throw new Error(`Wall shift would collapse room ${room.id}.`);
    return [room.id, b];
  }));
  const entities = base.entities.map((item) => {
    const wall = replacements.get(item.id);
    if (wall) return wall;
    const b = roomBounds.get(item.id);
    return item.type === 'Space' && b ? { ...item, bounds: b } : item;
  });
  const relationships = base.relationships.map((link) => {
    if (!junctions.has(link.target)) return link;
    mark('entity', link.source, 'hosted-opening');
    mark('relationship', link.id, 'opening-host');
    const oldWall = view.entities.find((item) => item.id === link.target);
    const wall = replacements.get(link.target);
    if (!wall || oldWall?.type !== 'Wall' || link.target === target.id) return link;
    // Resizing a perpendicular wall keeps its openings at their existing world positions.
    const axis = segment(oldWall).along;
    const direction = Math.sign(oldWall.end[axis] - oldWall.start[axis]);
    const adjusted = Math.round((link.offset + (oldWall.start[axis] - wall.start[axis]) * direction) * 1000) / 1000;
    if (adjusted < 0) throw new Error(`Opening ${link.source} would fall outside its resized host ${wall.id}.`);
    return { ...link, offset: adjusted };
  });
  let snapshot: ModelSnapshot;
  try {
    snapshot = validateSnapshot({ ...base, entities, relationships });
    for (const room of spaces(snapshot).filter((item) => roomBounds.has(item.id))) {
      const clear = clearSpaceBounds(snapshot, room);
      if (clear.minX >= clear.maxX || clear.minY >= clear.maxY) throw new Error(`Room ${room.id} has no clear interior after wall thickness.`);
    }
    const candidateView = levelView(snapshot, level.id);
    for (const item of view.entities) {
      if (item.type !== 'Furniture' && item.type !== 'Equipment' && item.type !== 'AssetInstance') continue;
      if (entitySpace(base, item)?.id !== entitySpace(snapshot, item)?.id) {
        throw new Error(`Wall shift cannot transfer ${item.id} to a different room.`);
      }
      if (item.type === 'Equipment') {
        const [x, y] = item.position;
        const footprint = { minX: x - item.width / 2, maxX: x + item.width / 2, minY: y - item.depth / 2, maxY: y + item.depth / 2 };
        if (candidateView.entities.some((door) => door.type === 'Door' && overlapsBounds(footprint, doorClearanceBounds(candidateView, door)))) {
          throw new Error(`Equipment ${item.id} blocks a door clearance zone.`);
        }
      }
    }
  } catch (error) {
    throw new Error(`Wall shift ${wallId} rejected: ${error instanceof Error ? error.message : 'invalid dependent geometry'}`, { cause: error });
  }

  // Evaluation dependencies are distinct from the stored entity delta.
  for (const item of view.entities) {
    const room = entitySpace(base, item);
    if (room && roomBounds.has(room.id) && item.type !== 'Space') {
      mark('entity', item.id, 'room-contents');
      if (item.type === 'Furniture' && item.supportId !== null) mark('entity', item.supportId, 'support');
    }
    if (item.type === 'Slab' || item.type === 'Roof' || item.type === 'Stair') mark('entity', item.id, 'level-envelope');
  }
  const delta = diffSnapshots(base, snapshot);
  const changedEntities = new Set(delta.entities.modified.map((item) => item.id));
  const changedRelationships = new Set(delta.relationships.modified.map((item) => item.id));
  return { snapshot, delta, impacts: [...impacts.values()].map((impact) => ({ ...impact,
    reasons: impact.reasons.sort(), changed: (impact.kind === 'entity' ? changedEntities : changedRelationships).has(impact.id),
  })).sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}
