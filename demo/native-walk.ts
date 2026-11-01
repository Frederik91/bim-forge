import { entityElevation, levels, roofHeightAt, stairFootprint } from '../src/building-levels.ts';
import { assetGeometry } from '../src/asset-family.ts';
import { furnitureFaces } from '../src/furniture-geometry.ts';
import { slabPieces, wallSections } from '../src/viewer-geometry.ts';
import type { Bounds, ModelSnapshot, Roof, Stair } from '../src/room-model.ts';

export type XY = readonly [number, number];
export type XYZ = readonly [number, number, number];
export type WalkSupport = { kind: 'floor'; levelId: string }
  | { kind: 'stair'; stairId: string; fromLevelId: string; toLevelId: string };
export interface WalkPose { eye: XYZ; levelId: string; support: WalkSupport }
const stateBrand = Symbol('native walk state');
export interface WalkState { readonly [stateBrand]: true }
export interface WalkPlacement { state: WalkState; pose: WalkPose }
export type WalkBlockedReason = 'support' | 'opening' | 'landing' | 'headroom' | 'obstacle';
export type WalkResult = ({ kind: 'moved' } | { kind: 'blocked'; reason: WalkBlockedReason }) & WalkPlacement;
type Anchor = { kind: 'floor'; levelId: string; point: XY } | { kind: 'stair'; stairId: string; point: XY };
export interface WalkBookmark {
  readonly version: 1; readonly sourcePin: string; readonly geometry: string;
  readonly anchor: Anchor; readonly levelId: string; readonly eye: number;
}
export interface NativeWalk {
  enter(entry: { levelId: string | null; point: XY }): WalkPlacement | null;
  advance(state: WalkState, displacement: XY, seconds: number): WalkResult;
  bookmark(state: WalkState): WalkBookmark;
  restore(bookmark: unknown): WalkPlacement | null;
}

const radius = .22;
const eyeHeight = 1.6;
const bodyHeight = 1.75;
const maxRiser = .25;
const tolerance = 1e-8;
interface InternalState { anchor: Anchor; feet: number; eye: number; levelId: string }
interface Floor { levelId: string; elevation: number; bounds: Bounds; holes: Bounds[] }
interface Flight { entity: Stair; base: number; top: number; run: number; u: XY; v: XY; usable: boolean; boxes: Solid[] }
interface Solid { bounds: Bounds; bottom: number; top: number; origin: XY; u: XY; v: XY;
  kind: 'wall' | 'slab' | 'stair' | 'obstacle'; owner: string }
const identityX: XY = [1, 0];
const identityY: XY = [0, 1];
const finitePoint = (point: XY): boolean => point.length === 2 && point.every(n => Number.isFinite(n) && Math.abs(n) <= 1_000_000);
const local = (point: XY, origin: XY, axis: XY): number => (point[0] - origin[0]) * axis[0] + (point[1] - origin[1]) * axis[1];
const rectangle = (bounds: Bounds, bottom: number, top: number, kind: Solid['kind'], owner: string): Solid =>
  ({ bounds, bottom, top, origin: [0, 0], u: identityX, v: identityY, kind, owner });

function pointRectangleDistance(point: XY, bounds: Bounds): number {
  return Math.max(bounds.minX - point[0], 0, point[0] - bounds.maxX) ** 2
    + Math.max(bounds.minY - point[1], 0, point[1] - bounds.maxY) ** 2;
}
function pointSegmentDistance(point: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length));
  return (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2;
}
function segmentRectangleDistance(a: XY, b: XY, bounds: Bounds): number {
  let lo = 0; let hi = 1;
  for (const [position, delta, min, max] of [[a[0], b[0] - a[0], bounds.minX, bounds.maxX],
    [a[1], b[1] - a[1], bounds.minY, bounds.maxY]]) {
    if (delta === 0) { if (position < min || position > max) { lo = 1; hi = 0; } }
    else { const t0 = (min - position) / delta; const t1 = (max - position) / delta;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1)); }
  }
  if (lo <= hi) return 0;
  const corners: XY[] = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]];
  return Math.min(pointRectangleDistance(a, bounds), pointRectangleDistance(b, bounds), ...corners.map(p => pointSegmentDistance(p, a, b)));
}
function intersects(solid: Solid, a: XY, b: XY): boolean {
  const at = (point: XY): XY => [local(point, solid.origin, solid.u), local(point, solid.origin, solid.v)];
  return segmentRectangleDistance(at(a), at(b), solid.bounds) < radius * radius - tolerance;
}
function floorSupports(floor: Floor | undefined, point: XY): boolean {
  if (!floor) return false;
  const b = floor.bounds;
  return point[0] >= b.minX + radius - tolerance && point[0] <= b.maxX - radius + tolerance
    && point[1] >= b.minY + radius - tolerance && point[1] <= b.maxY - radius + tolerance
    && floor.holes.every(hole => pointRectangleDistance(point, hole) >= radius * radius - tolerance);
}
function flightPosition(flight: Flight, point: XY): XY {
  return [local(point, flight.entity.start, flight.u), local(point, flight.entity.start, flight.v)];
}
function flightPoint(flight: Flight, station: number, across: number): XY {
  return [flight.entity.start[0] + flight.u[0] * station + flight.v[0] * across,
    flight.entity.start[1] + flight.u[1] * station + flight.v[1] * across];
}
function flightFeet(flight: Flight, point: XY): number {
  return Math.max(flight.base, ...flight.boxes.filter(box => intersects(box, point, point)).map(box => box.top));
}
function geometryIdentity(snapshot: ModelSnapshot): string {
  let hash = 14695981039346656037n;
  for (const character of JSON.stringify(snapshot)) hash = BigInt.asUintN(64, (hash ^ BigInt(character.charCodeAt(0))) * 1099511628211n);
  return hash.toString(16);
}

/** Immutable native geometry and per-session opaque states; no model, camera, or authoring writes. */
export function compileNativeWalk(source: ModelSnapshot, sourcePin: string): NativeWalk {
  const snapshot = structuredClone(source);
  const geometry = geometryIdentity(snapshot);
  const states = new WeakMap<WalkState, InternalState>();
  const floors = new Map<string, Floor>();
  const flights = new Map<string, Flight>();
  const solids: Solid[] = [];
  const roofs = snapshot.entities.filter((entity): entity is Roof => entity.type === 'Roof');
  for (const entity of snapshot.entities) if (entity.type === 'Stair') {
    const dx = entity.end[0] - entity.start[0]; const dy = entity.end[1] - entity.start[1];
    const run = Math.hypot(dx, dy); const u: XY = run ? [dx / run, dy / run] : [1, 0]; const v: XY = [-u[1], u[0]];
    const base = entityElevation(snapshot, entity); const top = entityElevation(snapshot, entity.toLevelId);
    const boxes: Solid[] = Array.from({ length: entity.steps }, (_, index) => ({
      bounds: { minX: run * index / entity.steps, maxX: run * (index + 1) / entity.steps, minY: -entity.width / 2, maxY: entity.width / 2 },
      bottom: base, top: base + (top - base) * (index + 1) / entity.steps,
      origin: entity.start, u, v, kind: 'stair', owner: entity.id,
    }));
    const ordered = levels(snapshot); const lower = ordered.findIndex(level => level.id === entity.fromLevelId);
    const upper = ordered.findIndex(level => level.id === entity.toLevelId);
    const usable = lower >= 0 && upper === lower + 1 && run > 0 && (dx === 0) !== (dy === 0)
      && top > base && (top - base) / entity.steps <= maxRiser + tolerance && entity.width >= radius * 2;
    flights.set(entity.id, { entity, base, top, run, u, v, boxes, usable }); solids.push(...boxes);
  }
  for (const level of levels(snapshot)) {
    const slabs = snapshot.entities.filter(entity => entity.type === 'Slab' && entity.levelId === level.id);
    if (slabs.length === 1 && slabs[0]?.type === 'Slab') floors.set(level.id, { levelId: level.id, elevation: level.elevation,
      bounds: slabs[0].bounds, holes: [...flights.values()].filter(f => f.entity.toLevelId === level.id).map(f => stairFootprint(f.entity)) });
  }
  for (const entity of snapshot.entities) {
    const base = entityElevation(snapshot, entity);
    if (entity.type === 'Slab') for (const bounds of slabPieces(snapshot, entity)) solids.push(rectangle(bounds, base - entity.thickness, base, 'slab', entity.levelId));
    else if (entity.type === 'Wall') {
      const dx = entity.end[0] - entity.start[0]; const dy = entity.end[1] - entity.start[1]; const length = Math.hypot(dx, dy);
      const u: XY = [dx / length, dy / length]; const v: XY = [-u[1], u[0]];
      const doors = snapshot.relationships.filter(link => link.target === entity.id).flatMap(link => {
        const door = snapshot.entities.find(item => item.id === link.source);
        return door?.type === 'Door' ? [{ start: link.offset, end: link.offset + door.width, height: door.height }] : [];
      }).sort((a, b) => a.start - b.start);
      const add = (start: number, end: number, bottom: number): void => {
        for (const section of wallSections(snapshot, entity, start, end, bottom, entity.height)) solids.push({
          bounds: { minX: section.start, maxX: section.end, minY: -entity.thickness / 2, maxY: entity.thickness / 2 },
          bottom: base + bottom, top: base + Math.max(section.startTop, section.endTop), origin: entity.start, u, v, kind: 'wall', owner: entity.id,
        });
      };
      let cursor = 0;
      for (const door of doors) { add(cursor, door.start, 0); add(door.start, door.end, door.height); cursor = door.end; }
      add(cursor, length, 0);
    } else if (entity.type === 'Equipment') solids.push(rectangle({ minX: entity.position[0] - entity.width / 2, maxX: entity.position[0] + entity.width / 2,
      minY: entity.position[1] - entity.depth / 2, maxY: entity.position[1] + entity.depth / 2 }, base + entity.elevation, base + entity.elevation + entity.height, 'obstacle', entity.id));
    else if (entity.type === 'Furniture') {
      const points = furnitureFaces(entity, snapshot).flatMap(face => face.points);
      solids.push(rectangle({ minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
        minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])) }, base + Math.min(...points.map(p => p[2])),
      base + Math.max(...points.map(p => p[2])), 'obstacle', entity.id));
    } else if (entity.type === 'AssetInstance') {
      const bounds = assetGeometry(snapshot, entity).bounds;
      solids.push(rectangle(bounds, base + bounds.minZ, base + bounds.maxZ, 'obstacle', entity.id));
    }
  }

  function support(anchor: Anchor): WalkSupport {
    if (anchor.kind === 'floor') return { kind: 'floor', levelId: anchor.levelId };
    const flight = flights.get(anchor.stairId);
    if (!flight) throw new Error('Unknown native stair support.');
    return { kind: 'stair', stairId: flight.entity.id, fromLevelId: flight.entity.fromLevelId, toLevelId: flight.entity.toLevelId };
  }
  function placement(value: InternalState): WalkPlacement {
    const state: WalkState = { [stateBrand]: true }; Object.freeze(state); states.set(state, value);
    return { state, pose: { eye: [value.anchor.point[0], value.anchor.point[1], value.eye], levelId: value.levelId, support: support(value.anchor) } };
  }
  function internal(state: WalkState): InternalState {
    const value = states.get(state); if (!value) throw new Error('Walk state belongs to a different native world.'); return value;
  }
  function collision(before: InternalState, after: InternalState): WalkBlockedReason | null {
    const a = before.anchor.point; const b = after.anchor.point;
    if (before.anchor.kind === 'floor' && after.anchor.kind === 'floor' && before.anchor.levelId === after.anchor.levelId
      && floors.get(before.anchor.levelId)?.holes.some(hole => segmentRectangleDistance(a, b, hole) < radius * radius - tolerance)) return 'support';
    const bottom = Math.min(before.feet, after.feet);
    const top = Math.max(before.feet + bodyHeight, after.feet + bodyHeight, before.eye + .15, after.eye + .15);
    const active = after.anchor.kind === 'stair' ? flights.get(after.anchor.stairId)
      : before.anchor.kind === 'stair' ? flights.get(before.anchor.stairId) : undefined;
    const supportTop = Math.max(before.feet, after.feet);
    for (const solid of solids) {
      if (solid.top <= bottom + tolerance || solid.bottom >= top - tolerance) continue;
      const designatedSupport = active && ((solid.kind === 'stair' && solid.owner === active.entity.id)
        || (solid.kind === 'slab' && (solid.owner === active.entity.fromLevelId || solid.owner === active.entity.toLevelId)));
      if (designatedSupport && solid.top <= supportTop + tolerance) continue;
      if (intersects(solid, a, b)) return solid.bottom > bottom + tolerance ? 'headroom' : solid.kind === 'wall' ? 'opening' : 'obstacle';
    }
    for (const roof of roofs) {
      if (segmentRectangleDistance(a, b, roof.bounds) >= radius * radius - tolerance) continue;
      const minX = Math.max(roof.bounds.minX, Math.min(a[0], b[0]) - radius); const maxX = Math.min(roof.bounds.maxX, Math.max(a[0], b[0]) + radius);
      const minY = Math.max(roof.bounds.minY, Math.min(a[1], b[1]) - radius); const maxY = Math.min(roof.bounds.maxY, Math.max(a[1], b[1]) + radius);
      const points: [number, number][] = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
      const base = entityElevation(snapshot, roof);
      const underside = base + Math.min(...points.map(point => roofHeightAt(snapshot, roof.levelId, point)));
      const roofTop = base + (roof.profile.kind === 'flat' ? roof.profile.height : roof.profile.ridgeHeight);
      if (top > underside + tolerance && bottom < roofTop - tolerance) return 'headroom';
    }
    return null;
  }
  function landing(flight: Flight, upper: boolean, across: number): boolean {
    const levelId = upper ? flight.entity.toLevelId : flight.entity.fromLevelId;
    const point = flightPoint(flight, upper ? flight.run + radius : -radius, across);
    const floor = floors.get(levelId); if (!floorSupports(floor, point) || !floor) return false;
    const value: InternalState = { anchor: { kind: 'floor', levelId, point }, feet: floor.elevation, eye: floor.elevation + eyeHeight, levelId };
    return collision(value, value) === null;
  }
  function nextAnchor(previous: InternalState, point: XY): Anchor | WalkBlockedReason {
    if (previous.anchor.kind === 'stair') {
      const flight = flights.get(previous.anchor.stairId); if (!flight?.usable) return 'support';
      const [station, across] = flightPosition(flight, point);
      if (Math.abs(across) > flight.entity.width / 2 - radius + tolerance) return 'support';
      if (station < -radius - tolerance || station > flight.run + radius + tolerance) {
        const upper = station > flight.run;
        const levelId = upper ? flight.entity.toLevelId : flight.entity.fromLevelId;
        if (!landing(flight, upper, across) || !floorSupports(floors.get(levelId), point)) return 'landing';
        return { kind: 'floor', levelId, point };
      }
      return { kind: 'stair', stairId: flight.entity.id, point };
    }
    const levelId = previous.anchor.levelId;
    for (const flight of flights.values()) {
      const lower = levelId === flight.entity.fromLevelId; const upper = levelId === flight.entity.toLevelId;
      if (!lower && !upper) continue;
      const [start, across0] = flightPosition(flight, previous.anchor.point); const [end, across1] = flightPosition(flight, point);
      const gate = lower ? -radius : flight.run + radius;
      const crossed = lower ? start <= gate + tolerance && end > gate + tolerance : start >= gate - tolerance && end < gate - tolerance;
      if (!crossed) continue;
      const t = (gate - start) / (end - start); const across = across0 + (across1 - across0) * t;
      if (Math.abs(across) > flight.entity.width / 2 - radius + tolerance) continue;
      if (!flight.usable) return 'support';
      if (!landing(flight, lower ? false : true, across)) return 'landing';
      if (Math.abs(across1) > flight.entity.width / 2 - radius + tolerance) return 'support';
      return { kind: 'stair', stairId: flight.entity.id, point };
    }
    return floorSupports(floors.get(levelId), point) ? { kind: 'floor', levelId, point } : 'support';
  }
  function feetAt(anchor: Anchor): number | null {
    if (anchor.kind === 'floor') { const floor = floors.get(anchor.levelId); return floorSupports(floor, anchor.point) && floor ? floor.elevation : null; }
    const flight = flights.get(anchor.stairId); if (!flight?.usable) return null;
    const [station, across] = flightPosition(flight, anchor.point);
    if (station < -radius - tolerance || station > flight.run + radius + tolerance || Math.abs(across) > flight.entity.width / 2 - radius + tolerance) return null;
    return station >= flight.run - tolerance ? flight.top : flightFeet(flight, anchor.point);
  }
  function parseBookmark(input: unknown): InternalState | null {
    if (!input || typeof input !== 'object' || !('version' in input) || input.version !== 1 || !('sourcePin' in input) || input.sourcePin !== sourcePin
      || !('geometry' in input) || input.geometry !== geometry || !('anchor' in input) || !('levelId' in input) || typeof input.levelId !== 'string'
      || !('eye' in input) || typeof input.eye !== 'number' || !Number.isFinite(input.eye)) return null;
    const raw = input.anchor;
    if (!raw || typeof raw !== 'object' || !('kind' in raw) || !('point' in raw) || !Array.isArray(raw.point)
      || raw.point.length !== 2 || typeof raw.point[0] !== 'number' || typeof raw.point[1] !== 'number') return null;
    const point: XY = [raw.point[0], raw.point[1]]; if (!finitePoint(point)) return null;
    let anchor: Anchor;
    if (raw.kind === 'floor' && 'levelId' in raw && typeof raw.levelId === 'string') {
      if (input.levelId !== raw.levelId) return null; anchor = { kind: 'floor', levelId: raw.levelId, point };
    } else if (raw.kind === 'stair' && 'stairId' in raw && typeof raw.stairId === 'string') {
      const flight = flights.get(raw.stairId);
      if (!flight || (input.levelId !== flight.entity.fromLevelId && input.levelId !== flight.entity.toLevelId)) return null;
      anchor = { kind: 'stair', stairId: raw.stairId, point };
    } else return null;
    const feet = feetAt(anchor);
    if (feet === null || Math.abs(input.eye - feet - eyeHeight) > .5 + tolerance) return null;
    const value = { anchor, feet, eye: input.eye, levelId: input.levelId };
    return collision(value, value) === null ? value : null;
  }
  return {
    enter(entry) {
      if (entry.levelId === null || !finitePoint(entry.point)) return null;
      const anchor: Anchor = { kind: 'floor', levelId: entry.levelId, point: [entry.point[0], entry.point[1]] };
      const feet = feetAt(anchor); if (feet === null) return null;
      const value = { anchor, feet, eye: feet + eyeHeight, levelId: entry.levelId };
      return collision(value, value) === null ? placement(value) : null;
    },
    advance(state, displacement, seconds) {
      const initial = internal(state);
      if (!finitePoint(displacement) || !Number.isFinite(seconds) || seconds < 0) return { kind: 'blocked', reason: 'support', ...placement(initial) };
      const time = Math.min(.05, seconds); const length = Math.hypot(...displacement);
      const scale = length ? Math.min(1, time * 2 / length) : 0;
      const delta: XY = [displacement[0] * scale, displacement[1] * scale];
      const count = Math.max(1, Math.ceil(Math.hypot(...delta) / .01));
      let current = initial;
      for (let step = 1; step <= count; step++) {
        const point: XY = [initial.anchor.point[0] + delta[0] * step / count, initial.anchor.point[1] + delta[1] * step / count];
        const anchor = nextAnchor(current, point);
        if (typeof anchor === 'string') return { kind: 'blocked', reason: anchor, ...placement(current) };
        const feet = feetAt(anchor);
        if (feet === null || Math.abs(feet - initial.feet) > maxRiser + tolerance) return { kind: 'blocked', reason: 'support', ...placement(current) };
        const eye = current.eye + (feet + eyeHeight - current.eye) * (1 - Math.exp(-12 * time / count));
        if (Math.abs(eye - feet - eyeHeight) > .5 + tolerance) return { kind: 'blocked', reason: 'support', ...placement(current) };
        const next = { anchor, feet, eye, levelId: anchor.kind === 'floor' ? anchor.levelId : current.levelId };
        const reason = collision(current, next);
        if (reason) return { kind: 'blocked', reason, ...placement(current) };
        current = next;
      }
      return { kind: 'moved', ...placement(current) };
    },
    bookmark(state) {
      const value = internal(state);
      const anchor: Anchor = value.anchor.kind === 'floor'
        ? { kind: 'floor', levelId: value.anchor.levelId, point: [value.anchor.point[0], value.anchor.point[1]] }
        : { kind: 'stair', stairId: value.anchor.stairId, point: [value.anchor.point[0], value.anchor.point[1]] };
      return { version: 1, sourcePin, geometry, anchor, levelId: value.levelId, eye: value.eye };
    },
    restore(bookmark) { const value = parseBookmark(bookmark); return value ? placement(value) : null; },
  };
}
