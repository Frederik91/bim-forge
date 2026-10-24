import type { Bounds, Door, Entity, ModelSnapshot, Point, Space, Wall } from './room-model.ts';

export function spaces(snapshot: ModelSnapshot): Space[] {
  return snapshot.entities.filter((item): item is Space => item.type === 'Space');
}

export function floorBounds(snapshot: ModelSnapshot): Bounds {
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

export function spaceAt(snapshot: ModelSnapshot, [x, y]: Point): Space | null {
  return spaces(snapshot).find(({ bounds: b }) => x > b.minX && x < b.maxX && y > b.minY && y < b.maxY) ?? null;
}

function wallOnBoundary(wall: Wall, b: Bounds): boolean {
  const horizontal = wall.start[1] === wall.end[1];
  return horizontal
    ? (wall.start[1] === b.minY || wall.start[1] === b.maxY) && Math.min(wall.start[0], wall.end[0]) < b.maxX && Math.max(wall.start[0], wall.end[0]) > b.minX
    : (wall.start[0] === b.minX || wall.start[0] === b.maxX) && Math.min(wall.start[1], wall.end[1]) < b.maxY && Math.max(wall.start[1], wall.end[1]) > b.minY;
}

export function clearSpaceBounds(snapshot: ModelSnapshot, space: Space): Bounds {
  const walls = snapshot.entities.filter((item): item is Wall => item.type === 'Wall' && wallOnBoundary(item, space.bounds));
  const inset = Math.max(0, ...walls.map((wall) => wall.thickness / 2));
  const b = space.bounds;
  return { minX: b.minX + inset, minY: b.minY + inset, maxX: b.maxX - inset, maxY: b.maxY - inset };
}

export function spaceForFootprint(snapshot: ModelSnapshot, footprint: Bounds): Space | null {
  return spaces(snapshot).find((space) => containsBounds(clearSpaceBounds(snapshot, space), footprint)) ?? null;
}

export function entitySpace(snapshot: ModelSnapshot, entity: Entity): Space | null {
  if (entity.type === 'Space') return entity;
  if (entity.type === 'Furniture' || entity.type === 'Equipment') return spaceAt(snapshot, entity.position);
  return null;
}

export interface DoorConnection { door: Door; roomIds: string[]; exterior: boolean }

/** Opening endpoints, not just its midpoint, must belong to each connected room side. */
export function doorConnections(snapshot: ModelSnapshot): DoorConnection[] {
  const rooms = spaces(snapshot);
  return snapshot.entities.filter((item): item is Door => item.type === 'Door').map((door) => {
    const host = snapshot.relationships.find((link) => link.source === door.id);
    const wall = snapshot.entities.find((item) => item.id === host?.target);
    if (!host || wall?.type !== 'Wall') throw new Error('Door requires a wall host.');
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const dx = (wall.end[0] - wall.start[0]) / length; const dy = (wall.end[1] - wall.start[1]) / length;
    const a: Point = [wall.start[0] + dx * host.offset, wall.start[1] + dy * host.offset];
    const b: Point = [a[0] + dx * door.width, a[1] + dy * door.width];
    const roomIds = rooms.filter((room) => {
      const r = room.bounds;
      return wallOnBoundary(wall, r) && containsBounds(r, { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
        minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) });
    }).map((room) => room.id);
    const f = floorBounds(snapshot);
    const exterior = dx !== 0 ? a[1] === f.minY || a[1] === f.maxY : a[0] === f.minX || a[0] === f.maxX;
    return { door, roomIds, exterior };
  });
}

/** Bounded first slice: one rectangular level tiled by non-overlapping rectangular rooms. */
export function validateFloorPlan(snapshot: ModelSnapshot): void {
  const rooms = spaces(snapshot); const levels = snapshot.entities.filter((item) => item.type === 'Level');
  if (!rooms.length && !levels.length) return; // Legacy snapshots retain their exact contents and hashes.
  const level = levels[0];
  if (levels.length !== 1 || !level || rooms.length < 2 || rooms.length > 12) throw new Error('A residential floor requires one level and two to twelve rooms.');
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
  const reached = new Set(connections.filter((link) => link.exterior).flatMap((link) => link.roomIds));
  for (let i = 0; i < rooms.length; i += 1) for (const link of connections) if (link.roomIds.some((id) => reached.has(id))) for (const id of link.roomIds) reached.add(id);
  if (rooms.some((room) => !reached.has(room.id))) throw new Error('Every room needs a doorway path to the exterior.');
  for (const item of snapshot.entities) if (item.type === 'Equipment') {
    const [x, y] = item.position;
    if (!spaceForFootprint(snapshot, { minX: x - item.width / 2, maxX: x + item.width / 2, minY: y - item.depth / 2, maxY: y + item.depth / 2 })) throw new Error('Equipment must fit inside one room clear of walls.');
  }
}
