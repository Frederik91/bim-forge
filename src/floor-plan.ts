import type { Bounds, Door, Entity, ModelGraph, Point, Space, Stair, Wall } from './room-model.ts';
import { entityLevel, levelView, levels, roofHeightAt, stairFootprint } from './building-levels.ts';

export function spaces(snapshot: ModelGraph): Space[] {
  return snapshot.entities.filter((item): item is Space => item.type === 'Space');
}

export function floorBounds(snapshot: ModelGraph): Bounds {
  const points = snapshot.entities.flatMap((item): Point[] => item.type === 'Wall' ? [item.start, item.end] : []);
  if (!points.length) throw new Error('A model requires walls to frame its floor.');
  return { minX: Math.min(...points.map(([x]) => x)), minY: Math.min(...points.map(([, y]) => y)),
    maxX: Math.max(...points.map(([x]) => x)), maxY: Math.max(...points.map(([, y]) => y)) };
}

export function boundsMm(bounds: Bounds): Bounds {
  return { minX: Math.round(bounds.minX * 1000), minY: Math.round(bounds.minY * 1000),
    maxX: Math.round(bounds.maxX * 1000), maxY: Math.round(bounds.maxY * 1000) };
}

export function containsBounds(outer: Bounds, inner: Bounds): boolean {
  return inner.minX >= outer.minX - 1e-9 && inner.minY >= outer.minY - 1e-9
    && inner.maxX <= outer.maxX + 1e-9 && inner.maxY <= outer.maxY + 1e-9;
}

export function overlapsBounds(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX - 1e-9 && a.maxX > b.minX + 1e-9 && a.minY < b.maxY - 1e-9 && a.maxY > b.minY + 1e-9;
}

export function spaceAt(snapshot: ModelGraph, [x, y]: Point): Space | null {
  const matches = spaces(snapshot).filter(({ bounds: b }) => x > b.minX && x < b.maxX && y > b.minY && y < b.maxY);
  if (matches.length > 1) throw new Error('A spatial query requires a level-scoped graph.');
  return matches[0] ?? null;
}

function wallOnBoundary(wall: Wall, b: Bounds): boolean {
  const horizontal = wall.start[1] === wall.end[1];
  return horizontal
    ? (wall.start[1] === b.minY || wall.start[1] === b.maxY) && Math.min(wall.start[0], wall.end[0]) < b.maxX && Math.max(wall.start[0], wall.end[0]) > b.minX
    : (wall.start[0] === b.minX || wall.start[0] === b.maxX) && Math.min(wall.start[1], wall.end[1]) < b.maxY && Math.max(wall.start[1], wall.end[1]) > b.minY;
}

export function clearSpaceBounds(snapshot: ModelGraph, space: Space): Bounds {
  const walls = snapshot.entities.filter((item): item is Wall => item.type === 'Wall' && wallOnBoundary(item, space.bounds)
    && (snapshot.version !== 2 || entityLevel(snapshot, item)?.id === space.levelId));
  const inset = Math.max(0, ...walls.map((wall) => wall.thickness / 2));
  const b = space.bounds;
  return { minX: b.minX + inset, minY: b.minY + inset, maxX: b.maxX - inset, maxY: b.maxY - inset };
}

export function spaceForFootprint(snapshot: ModelGraph, footprint: Bounds): Space | null {
  const matches = spaces(snapshot).filter((space) => containsBounds(clearSpaceBounds(snapshot, space), footprint));
  if (matches.length > 1) throw new Error('A footprint query requires a level-scoped graph.');
  return matches[0] ?? null;
}

export function entitySpace(snapshot: ModelGraph, entity: Entity): Space | null {
  if (entity.type === 'Space') return entity;
  if (entity.type === 'Furniture' || entity.type === 'Equipment') {
    const level = entityLevel(snapshot, entity);
    return spaceAt(snapshot.version === 2 && level ? levelView(snapshot, level.id) : snapshot, entity.position);
  }
  return null;
}

export interface DoorConnection { door: Door; roomIds: string[]; exterior: boolean }

/** Opening endpoints, not just its midpoint, must belong to each connected room side. */
export function doorConnections(snapshot: ModelGraph): DoorConnection[] {
  return snapshot.entities.filter((item): item is Door => item.type === 'Door').map((door) => {
    const host = snapshot.relationships.find((link) => link.source === door.id);
    const wall = snapshot.entities.find((item) => item.id === host?.target);
    if (!host || wall?.type !== 'Wall') throw new Error('Door requires a wall host.');
    const owner = entityLevel(snapshot, wall);
    const view = snapshot.version === 2 && owner ? levelView(snapshot, owner.id) : snapshot;
    const rooms = spaces(view);
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const dx = (wall.end[0] - wall.start[0]) / length; const dy = (wall.end[1] - wall.start[1]) / length;
    const a: Point = [wall.start[0] + dx * host.offset, wall.start[1] + dy * host.offset];
    const b: Point = [a[0] + dx * door.width, a[1] + dy * door.width];
    const roomIds = rooms.filter((room) => {
      const r = room.bounds;
      return wallOnBoundary(wall, r) && containsBounds(r, { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
        minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) });
    }).map((room) => room.id);
    const f = floorBounds(view);
    const exterior = dx !== 0 ? a[1] === f.minY || a[1] === f.maxY : a[0] === f.minX || a[0] === f.maxX;
    return { door, roomIds, exterior };
  });
}

/** Bounded first slice: one rectangular level tiled by non-overlapping rectangular rooms. */
function validateSingleFloor(snapshot: ModelGraph, levelId?: string): void {
  const rooms = spaces(snapshot); const floorLevels = levels(snapshot);
  if (!rooms.length && !floorLevels.length) return; // Legacy snapshots retain their exact contents and hashes.
  const level = levelId ? floorLevels.find((item) => item.id === levelId) : floorLevels[0];
  if ((!levelId && floorLevels.length !== 1) || !level || rooms.length < 2 || rooms.length > 12) throw new Error('A residential floor requires one level and two to twelve rooms.');
  const walls = snapshot.entities.filter((item): item is Wall => item.type === 'Wall');
  const f = floorBounds(snapshot);
  for (const room of rooms) {
    const b = room.bounds;
    if (room.levelId !== level.id || b.minX >= b.maxX || b.minY >= b.maxY || !containsBounds(f, b)) throw new Error('Room bounds and level references must be valid.');
    if (rooms.some((other) => other.id !== room.id && overlapsBounds(b, other.bounds))) throw new Error('Room areas cannot overlap.');
    const edges: Array<{ axis: 0 | 1; at: number; start: number; end: number }> = [
      { axis: 1, at: b.minY, start: b.minX, end: b.maxX }, { axis: 1, at: b.maxY, start: b.minX, end: b.maxX },
      { axis: 0, at: b.minX, start: b.minY, end: b.maxY }, { axis: 0, at: b.maxX, start: b.minY, end: b.maxY },
    ];
    for (const edge of edges) {
      const along = edge.axis === 0 ? 1 : 0;
      const intervals = walls.filter((wall) => wall.start[edge.axis] === edge.at && wall.end[edge.axis] === edge.at)
        .map((wall) => [Math.min(wall.start[along], wall.end[along]), Math.max(wall.start[along], wall.end[along])])
        .sort((a, b) => a[0] - b[0]);
      let cursor = edge.start;
      for (const [start, end] of intervals) if (start <= cursor + 1e-9) cursor = Math.max(cursor, end);
      if (cursor < edge.end - 1e-9) throw new Error('Every room side must be enclosed by shared model walls.');
    }
  }
  const area = (b: Bounds): number => (b.maxX - b.minX) * (b.maxY - b.minY);
  if (Math.abs(rooms.reduce((sum, room) => sum + area(room.bounds), 0) - area(f)) > 1e-6) throw new Error('Rooms must cover the entire level without gaps.');
  for (const wall of walls) {
    if (wall.start[0] !== wall.end[0] && wall.start[1] !== wall.end[1]) throw new Error('Residential walls must be axis aligned.');
    if (!rooms.some((room) => wallOnBoundary(wall, room.bounds))) throw new Error('Walls must form room boundaries.');
    const horizontal = wall.start[1] === wall.end[1]; const axis = horizontal ? 0 : 1; const fixed = horizontal ? 1 : 0;
    const low = Math.min(wall.start[axis], wall.end[axis]); const high = Math.max(wall.start[axis], wall.end[axis]);
    for (const room of rooms) {
      const b = room.bounds;
      if (wall.start[fixed] > (horizontal ? b.minY : b.minX) && wall.start[fixed] < (horizontal ? b.maxY : b.maxX)
          && low < (horizontal ? b.maxX : b.maxY) && high > (horizontal ? b.minX : b.minY)) throw new Error('A wall cannot pass through a room interior.');
    }
    if (walls.some((other) => other.id !== wall.id && other.start[fixed] === wall.start[fixed] && other.end[fixed] === wall.start[fixed]
        && Math.min(other.start[axis], other.end[axis]) < high && Math.max(other.start[axis], other.end[axis]) > low)) throw new Error('Shared walls must exist once, without duplicate overlapping segments.');
    const openings = snapshot.relationships.filter((link) => link.target === wall.id).map((link) => {
      const item = snapshot.entities.find((entity) => entity.id === link.source);
      if (item?.type !== 'Door' && item?.type !== 'Window') throw new Error('Invalid opening.');
      if (item.type === 'Window' && item.sillHeight + item.height > wall.height) throw new Error('Window must fit below the wall top.');
      return { start: link.offset, end: link.offset + item.width };
    }).sort((a, b) => a.start - b.start);
    for (let i = 1; i < openings.length; i += 1) if (openings[i].start < openings[i - 1].end - 1e-9) throw new Error('Hosted openings cannot overlap.');
  }
  const connections = doorConnections(snapshot);
  for (const connection of connections) if (connection.roomIds.length !== (connection.exterior ? 1 : 2)) throw new Error('Each door must connect two rooms or one room to the exterior.');
  if (snapshot.version !== 2) validateReachability(rooms, connections.filter((link) => link.exterior).flatMap((link) => link.roomIds), connections.map((link) => link.roomIds));
  for (const item of snapshot.entities) if (item.type === 'Equipment') {
    const [x, y] = item.position;
    if (!spaceForFootprint(snapshot, { minX: x - item.width / 2, maxX: x + item.width / 2, minY: y - item.depth / 2, maxY: y + item.depth / 2 })) throw new Error('Equipment must fit inside one room clear of walls.');
  }
}

function validateReachability(rooms: Space[], exits: string[], edges: string[][]): void {
  const reached = new Set(exits);
  for (let i = 0; i < rooms.length; i += 1) for (const edge of edges) if (edge.some((id) => reached.has(id))) for (const id of edge) reached.add(id);
  if (rooms.some((room) => !reached.has(room.id))) throw new Error('Every room needs a doorway path to the exterior, including stairs between levels.');
}

/** Topology validates each owned floor, then connects floors through actual stairs. */
export function validateFloorPlan(snapshot: ModelGraph): void {
  if (snapshot.version !== 2) return validateSingleFloor(snapshot);
  const ordered = levels(snapshot);
  if (!ordered.length || ordered.length > 6 || new Set(ordered.map((level) => level.elevation)).size !== ordered.length) {
    throw new Error('Buildings require one to six levels with distinct elevations.');
  }
  for (const entity of snapshot.entities) {
    if (entity.type !== 'Level' && !entityLevel(snapshot, entity)) throw new Error('Every building entity requires a valid level owner.');
    if (entity.type === 'Furniture' && entity.supportId !== null) {
      const support = snapshot.entities.find((item) => item.id === entity.supportId);
      if (!support || entityLevel(snapshot, support)?.id !== entityLevel(snapshot, entity)?.id) throw new Error('Furniture supports must remain on the same level.');
    }
  }
  validateSlabClearance(snapshot);
  for (const level of ordered) {
    const view = levelView(snapshot, level.id);
    validateSingleFloor(view, level.id);
    const bounds = floorBounds(view);
    const slabs = view.entities.filter((item) => item.type === 'Slab');
    if (slabs.length !== 1 || !slabs[0] || !containsBounds(slabs[0].bounds, bounds) || !containsBounds(bounds, slabs[0].bounds)) {
      throw new Error('Each level requires one slab matching its floor bounds.');
    }
    const below = ordered[ordered.indexOf(level) - 1];
    if (below && level.elevation - slabs[0].thickness <= below.elevation) throw new Error('Slab thickness must fit between levels.');
    const roofs = view.entities.filter((item) => item.type === 'Roof');
    if (roofs.length > 1) throw new Error('A level supports at most one roof.');
    for (const roof of roofs) {
      if (level.id !== ordered.at(-1)?.id || !containsBounds(roof.bounds, bounds)) throw new Error('A roof must cover the highest level.');
      const minimum = (roof.profile.kind === 'flat' ? roof.profile.height : roof.profile.eaveHeight) - roof.thickness;
      if (minimum <= 0) throw new Error('Roof underside must remain above its level.');
    }
    for (const opening of view.entities) {
      if (opening.type !== 'Door' && opening.type !== 'Window') continue;
      const host = view.relationships.find((link) => link.source === opening.id);
      const wall = view.entities.find((item) => item.id === host?.target);
      if (!host || wall?.type !== 'Wall') continue;
      const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
      const points: Point[] = [host.offset, host.offset + opening.width].map((offset) =>
        [wall.start[0] + (wall.end[0] - wall.start[0]) * offset / length, wall.start[1] + (wall.end[1] - wall.start[1]) * offset / length]);
      const top = opening.height + (opening.type === 'Window' ? opening.sillHeight : 0);
      if (points.some((point) => top > roofHeightAt(view, level.id, point) + 1e-9)) throw new Error('Hosted openings must fit below the roof underside.');
    }
    for (const equipment of view.entities) {
      if (equipment.type !== 'Equipment') continue;
      const [x, y] = equipment.position;
      const b = { minX: x - equipment.width / 2, maxX: x + equipment.width / 2, minY: y - equipment.depth / 2, maxY: y + equipment.depth / 2 };
      const corners: Point[] = [[b.minX, b.minY], [b.minX, b.maxY], [b.maxX, b.minY], [b.maxX, b.maxY]];
      if (corners.some((point) => equipment.elevation + equipment.height > roofHeightAt(view, level.id, point) + 1e-9)) throw new Error('Equipment must fit below the roof underside.');
      if (view.incidentStairs.some((stair) => overlapsBounds(b, stairFootprint(stair)))) throw new Error('Equipment must remain clear of stairs and slab voids.');
    }
  }
  const stairs = snapshot.entities.filter((item): item is Stair => item.type === 'Stair');
  const stairEdges = stairs.map((stair) => {
    const from = ordered.findIndex((level) => level.id === stair.fromLevelId);
    const to = ordered.findIndex((level) => level.id === stair.toLevelId);
    if (from < 0 || to !== from + 1) throw new Error('Stairs must connect adjacent levels from lower to higher.');
    const dx = stair.end[0] - stair.start[0]; const dy = stair.end[1] - stair.start[1];
    if ((dx === 0) === (dy === 0)) throw new Error('Stairs require a positive axis-aligned run.');
    const footprint = stairFootprint(stair);
    const lower = spaceForFootprint(levelView(snapshot, stair.fromLevelId), footprint);
    const upper = spaceForFootprint(levelView(snapshot, stair.toLevelId), footprint);
    if (!lower || !upper) throw new Error('The complete stair footprint must fit a room at both endpoints.');
    return [lower.id, upper.id];
  });
  const connections = doorConnections(snapshot);
  // Without a terrain/landing model, only elevation-zero exterior doors establish ground exits.
  const exits = connections.filter((link) => link.exterior && entityLevel(snapshot, link.door)?.elevation === 0).flatMap((link) => link.roomIds);
  validateReachability(spaces(snapshot), exits, [...connections.map((link) => link.roomIds), ...stairEdges]);
}

/** Owned solids may touch an upper slab underside but may not extend through it. */
function validateSlabClearance(snapshot: ModelGraph): void {
  const slabs = snapshot.entities.filter((item) => item.type === 'Slab');
  for (const entity of snapshot.entities) {
    const owner = entityLevel(snapshot, entity);
    if (!owner) continue;
    let footprint: Bounds;
    let bottom = owner.elevation;
    let top: number;
    if (entity.type === 'Wall') {
      footprint = { minX: Math.min(entity.start[0], entity.end[0]) - entity.thickness / 2,
        minY: Math.min(entity.start[1], entity.end[1]) - entity.thickness / 2,
        maxX: Math.max(entity.start[0], entity.end[0]) + entity.thickness / 2,
        maxY: Math.max(entity.start[1], entity.end[1]) + entity.thickness / 2 };
      top = bottom + entity.height;
    } else if (entity.type === 'Equipment' || entity.type === 'Furniture') {
      const sideways = entity.type === 'Furniture' && (entity.rotationDeg === 90 || entity.rotationDeg === 270);
      const width = sideways ? entity.depth : entity.width; const depth = sideways ? entity.width : entity.depth;
      footprint = { minX: entity.position[0] - width / 2, maxX: entity.position[0] + width / 2,
        minY: entity.position[1] - depth / 2, maxY: entity.position[1] + depth / 2 };
      if (entity.type === 'Equipment') bottom += entity.elevation;
      else if (entity.supportId !== null) {
        const support = snapshot.entities.find((item) => item.id === entity.supportId);
        if (support?.type === 'Furniture') bottom += support.height;
      }
      top = bottom + entity.height;
    } else continue;
    for (const slab of slabs) {
      const slabLevel = entityLevel(snapshot, slab);
      if (!slabLevel || slabLevel.elevation <= owner.elevation || !overlapsBounds(footprint, slab.bounds)) continue;
      // Also reject equipment placed wholly above its owner's ceiling: it cannot acquire another floor by offset.
      if (top > slabLevel.elevation - slab.thickness + 1e-9) {
        throw new Error('Walls, furniture and equipment must remain below overlapping upper slabs.');
      }
    }
  }
}
