import { clearSpaceBounds } from './floor-plan.ts';
import { identifier, validateSnapshot } from './room-model.ts';
import type { Bounds, EntityId, ModelSnapshot, Point, Space } from './room-model.ts';
import { previewWallShift } from './wall-dependencies.ts';
import type { WallShiftPreview } from './wall-dependencies.ts';

export type DimensionAxis = 'x' | 'y';
export type RoomDimensionMeasurement = { kind: 'confirmed'; metres: number; sourceRef: string }
  | { kind: 'unresolved'; reason: 'unknown-scale' | 'ambiguous-dimension' | 'contradictory-evidence'; sourceRefs: string[] };
export interface MinimumClearSpan { roomId: string; axis: DimensionAxis; metres: number }
export interface RoomDimensionRequest {
  roomId: string;
  wallId: string;
  axis: DimensionAxis;
  measurement: RoomDimensionMeasurement;
  minimumClearSpans: MinimumClearSpan[];
}

export interface EvaluatedRoomDimension {
  bounds: Bounds;
  centrelineSpans: { x: number; y: number };
  clearSpans: { x: number; y: number };
}
export interface EvaluatedOpening {
  hostId: EntityId;
  start: Point;
  end: Point;
}
type DependencyChange<T> = { id: EntityId; storedChanged: boolean; evaluatedChanged: boolean; before: T; after: T };
export type RoomDimensionDependency = ({ kind: 'room' } & DependencyChange<EvaluatedRoomDimension>)
  | ({ kind: 'opening' } & DependencyChange<EvaluatedOpening>);
export interface ClearSpanCheck extends MinimumClearSpan { beforeMetres: number; afterMetres: number }
export type RoomDimensionPreview = { status: 'unresolved'; measurement: Extract<RoomDimensionMeasurement, { kind: 'unresolved' }> }
  | ({ status: 'ready'; offsetMetres: number; measurement: Extract<RoomDimensionMeasurement, { kind: 'confirmed' }>;
    dependencies: RoomDimensionDependency[]; clearSpanChecks: ClearSpanCheck[] } & WallShiftPreview);

const cleanNumber = (value: number): number => Math.round(value * 1e9) / 1e9;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function positiveMillimetres(value: number): void {
  if (!Number.isFinite(value) || value < .001 || value > 1000
      || Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-6) {
    throw new Error('Room dimensions require positive metre values on the millimetre grid, at most 1000 metres.');
  }
}

function sourceReference(value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error('A bounded, nonempty evidence source reference is required.');
}

function dimensionAxis(value: DimensionAxis): void {
  if (value !== 'x' && value !== 'y') throw new Error('Room dimension axis must be x or y.');
}

function roomById(snapshot: ModelSnapshot, id: string): Space {
  const item = snapshot.entities.find((entity) => entity.id === identifier(id));
  if (item?.type !== 'Space') throw new Error(`Room dimension target ${id} must identify an existing room.`);
  return item;
}

function spans(bounds: Bounds): { x: number; y: number } {
  return { x: cleanNumber(bounds.maxX - bounds.minX), y: cleanNumber(bounds.maxY - bounds.minY) };
}

function evaluateRoom(snapshot: ModelSnapshot, id: string): EvaluatedRoomDimension {
  const room = roomById(snapshot, id);
  return { bounds: { ...room.bounds }, centrelineSpans: spans(room.bounds), clearSpans: spans(clearSpaceBounds(snapshot, room)) };
}

function evaluateOpening(snapshot: ModelSnapshot, id: EntityId): EvaluatedOpening {
  const opening = snapshot.entities.find((item) => item.id === id);
  const host = snapshot.relationships.find((link) => link.source === id);
  const wall = snapshot.entities.find((item) => item.id === host?.target);
  if ((opening?.type !== 'Door' && opening?.type !== 'Window') || !host || wall?.type !== 'Wall') {
    throw new Error(`Dependency ${id} requires an opening and its wall host.`);
  }
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  const point = (offset: number): Point => [
    cleanNumber(wall.start[0] + (wall.end[0] - wall.start[0]) * offset / length),
    cleanNumber(wall.start[1] + (wall.end[1] - wall.start[1]) * offset / length),
  ];
  return { hostId: host.target, start: point(host.offset), end: point(host.offset + opening.width) };
}

/**
 * A confirmed centreline room span drives one existing bounded partition operation.
 * Source references are context only: callers still own evidence freshness and human review.
 */
export function previewRoomDimensionChange(baseSnapshot: unknown, input: RoomDimensionRequest): RoomDimensionPreview {
  const base = validateSnapshot(baseSnapshot);
  const room = roomById(base, input.roomId);
  const wallId = identifier(input.wallId);
  const wall = base.entities.find((item) => item.id === wallId);
  dimensionAxis(input.axis);
  if (wall?.type !== 'Wall') throw new Error(`Room dimension wall ${wallId} must identify an existing wall.`);
  const coordinate = input.axis === 'x' ? 0 : 1;
  const minimum = input.axis === 'x' ? room.bounds.minX : room.bounds.minY;
  const maximum = input.axis === 'x' ? room.bounds.maxX : room.bounds.maxY;
  const at = wall.start[coordinate];
  if (at !== wall.end[coordinate] || (at !== minimum && at !== maximum)) {
    throw new Error(`Wall ${wallId} must bound room ${room.id} along dimension axis ${input.axis}.`);
  }
  const roomLevel = room.levelId;
  if ('levelId' in wall && wall.levelId !== roomLevel) throw new Error('The driving room and wall must belong to the same level.');
  const along = coordinate === 0 ? 1 : 0;
  const low = along === 0 ? room.bounds.minX : room.bounds.minY;
  const high = along === 0 ? room.bounds.maxX : room.bounds.maxY;
  if (Math.min(wall.start[along], wall.end[along]) > low || Math.max(wall.start[along], wall.end[along]) < high) {
    throw new Error(`Wall ${wallId} must cover the complete room side.`);
  }

  if (input.minimumClearSpans.length > 24) throw new Error('At most 24 minimum clear-span constraints are supported.');
  const constraints = input.minimumClearSpans.map((constraint) => {
    dimensionAxis(constraint.axis);
    positiveMillimetres(constraint.metres);
    const target = roomById(base, constraint.roomId);
    return { roomId: target.id, axis: constraint.axis, metres: constraint.metres };
  }).sort((a, b) => compare(a.roomId, b.roomId) || compare(a.axis, b.axis));
  if (new Set(constraints.map((item) => `${item.roomId}:${item.axis}`)).size !== constraints.length) {
    throw new Error('Minimum clear-span constraints must be unique per room and axis.');
  }
  const measurement = input.measurement;
  switch (measurement.kind) {
    case 'unresolved': {
      if (!['unknown-scale', 'ambiguous-dimension', 'contradictory-evidence'].includes(measurement.reason)
          || measurement.sourceRefs.length < 1 || measurement.sourceRefs.length > 24) {
        throw new Error('Unresolved measurements require a supported reason and one to 24 source references.');
      }
      measurement.sourceRefs.forEach(sourceReference);
      return { status: 'unresolved', measurement: { ...measurement, sourceRefs: [...new Set(measurement.sourceRefs)].sort(compare) } };
    }
    case 'confirmed':
      positiveMillimetres(measurement.metres);
      sourceReference(measurement.sourceRef);
      break;
    default: {
      const exhaustive: never = measurement;
      throw new Error(`Unsupported room measurement: ${String(exhaustive)}`);
    }
  }
  const offsetMetres = cleanNumber((measurement.metres - (maximum - minimum)) * (at === maximum ? 1 : -1));
  const preview = previewWallShift(base, { wallId, offsetMetres });
  const clearSpanChecks = constraints.map((constraint) => {
    const beforeMetres = evaluateRoom(base, constraint.roomId).clearSpans[constraint.axis];
    const afterMetres = evaluateRoom(preview.snapshot, constraint.roomId).clearSpans[constraint.axis];
    if (afterMetres + 1e-9 < constraint.metres) {
      throw new Error(`Minimum clear span for ${constraint.roomId} on ${constraint.axis} requires ${constraint.metres} m; candidate has ${afterMetres} m.`);
    }
    return { ...constraint, beforeMetres, afterMetres };
  });
  const rooms = new Set<EntityId>([room.id, ...constraints.map((item) => item.roomId)]);
  const openings = new Set<EntityId>();
  for (const impact of preview.impacts) {
    if (impact.kind !== 'entity') continue;
    if (impact.reasons.includes('room-boundary')) rooms.add(impact.id);
    if (impact.reasons.includes('hosted-opening')) openings.add(impact.id);
  }
  const changed = new Set(preview.delta.entities.modified.map((item) => item.id));
  const dependencies: RoomDimensionDependency[] = [];
  for (const id of rooms) {
    const before = evaluateRoom(base, id); const after = evaluateRoom(preview.snapshot, id);
    dependencies.push({ kind: 'room', id, storedChanged: changed.has(id), evaluatedChanged: JSON.stringify(before) !== JSON.stringify(after), before, after });
  }
  for (const id of openings) {
    const before = evaluateOpening(base, id); const after = evaluateOpening(preview.snapshot, id);
    dependencies.push({ kind: 'opening', id, storedChanged: changed.has(id), evaluatedChanged: JSON.stringify(before) !== JSON.stringify(after), before, after });
  }
  dependencies.sort((a, b) => compare(a.kind, b.kind) || compare(a.id, b.id));
  return { status: 'ready', ...preview, offsetMetres, measurement: { ...measurement }, dependencies, clearSpanChecks };
}
