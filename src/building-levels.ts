import type { Bounds, Entity, Level, ModelGraph, Point, Roof, Stair } from './room-model.ts';

/** Stable elevation order; never sorts the caller's entity collection. */
export function levels(snapshot: ModelGraph): Level[] {
  return snapshot.entities.filter((item): item is Level => item.type === 'Level')
    .sort((a, b) => a.elevation - b.elevation || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function entityLevel(snapshot: ModelGraph, entityOrId: Entity | string): Level | null {
  const entity = typeof entityOrId === 'string' ? snapshot.entities.find((item) => item.id === entityOrId) : entityOrId;
  if (!entity) return null;
  if (entity.type === 'AssetFamily') return null;
  if (entity.type === 'AssetInstance') {
    if (entity.placement.kind === 'single-room') return null;
    const roomId = entity.placement.roomId;
    const room = snapshot.entities.find((item) => item.type === 'Space' && item.id === roomId);
    return room ? entityLevel(snapshot, room) : null;
  }
  if (entity.type === 'Level') return entity;
  if (entity.type === 'Door' || entity.type === 'Window') {
    const host = snapshot.relationships.find((link) => link.source === entity.id);
    const wall = snapshot.entities.find((item) => item.id === host?.target);
    return wall?.type === 'Wall' ? entityLevel(snapshot, wall) : null;
  }
  const id = entity.type === 'Stair' ? entity.fromLevelId : 'levelId' in entity ? entity.levelId : null;
  if (id !== null) return levels(snapshot).find((level) => level.id === id) ?? null;
  // Historical single-floor geometry has an implicit zero-elevation owner.
  return snapshot.version === 2 ? null : levels(snapshot)[0] ?? null;
}

/** World floor base only; furniture support and equipment offsets are applied by consumers. */
export function entityElevation(snapshot: ModelGraph, entityOrId: Entity | string): number {
  return entityLevel(snapshot, entityOrId)?.elevation ?? 0;
}

export interface LevelView extends ModelGraph {
  readonly level: Level;
  readonly incidentStairs: readonly Stair[];
}

/** All level metadata, owned geometry and incident stairs; no geometry from adjacent floors. */
export function levelView(snapshot: ModelGraph, levelId: string): LevelView {
  const level = levels(snapshot).find((item) => item.id === levelId);
  if (!level) throw new Error('Unknown level.');
  const incidentStairs = snapshot.entities.filter((item): item is Stair => item.type === 'Stair'
    && (item.fromLevelId === levelId || item.toLevelId === levelId));
  const entities = snapshot.entities.filter((item) => item.type === 'Level' || item.type === 'AssetFamily'
    || (item.type === 'Stair' ? incidentStairs.includes(item) : entityLevel(snapshot, item)?.id === levelId));
  const ids = new Set(entities.map((item) => item.id));
  const relationships = snapshot.relationships.filter((link) => ids.has(link.source) && ids.has(link.target));
  return Object.freeze({ ...(snapshot.version === 2 ? { version: 2 as const } : {}), units: 'm', level,
    entities: Object.freeze(entities), relationships: Object.freeze(relationships), incidentStairs: Object.freeze(incidentStairs) });
}

export function stairFootprint(stair: Stair): Bounds {
  const horizontal = stair.start[1] === stair.end[1];
  return { minX: Math.min(stair.start[0], stair.end[0]) - (horizontal ? 0 : stair.width / 2),
    maxX: Math.max(stair.start[0], stair.end[0]) + (horizontal ? 0 : stair.width / 2),
    minY: Math.min(stair.start[1], stair.end[1]) - (horizontal ? stair.width / 2 : 0),
    maxY: Math.max(stair.start[1], stair.end[1]) + (horizontal ? stair.width / 2 : 0) };
}

/** Local roof underside height. Thickness is vertical, not normal to the pitch. */
export function roofHeightAt(snapshot: ModelGraph, levelId: string, point: Point): number {
  const roofs = snapshot.entities.filter((item): item is Roof => item.type === 'Roof' && item.levelId === levelId);
  let height = Infinity;
  for (const roof of roofs) {
    const b = roof.bounds;
    if (point[0] < b.minX || point[0] > b.maxX || point[1] < b.minY || point[1] > b.maxY) continue;
    const profile = roof.profile;
    const span = profile.kind === 'gable' && profile.ridgeAxis === 'x' ? b.maxY - b.minY : b.maxX - b.minX;
    const distance = profile.kind === 'gable' && profile.ridgeAxis === 'x'
      ? Math.abs(point[1] - (b.minY + b.maxY) / 2) : Math.abs(point[0] - (b.minX + b.maxX) / 2);
    const top = profile.kind === 'flat' ? profile.height
      : profile.eaveHeight + (profile.ridgeHeight - profile.eaveHeight) * (1 - distance * 2 / span);
    height = Math.min(height, top - roof.thickness);
  }
  return height;
}
