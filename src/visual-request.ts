import { boundsMm, floorBounds } from './floor-plan.ts';
import { previewRectangle, rectangleLayout } from './room-model.ts';
import type { ModelSnapshot, Point, RoomLayout } from './room-model.ts';

export type SpatialReference =
  | Readonly<{ kind: 'floor-point'; positionMm: Point }>
  | Readonly<{ kind: 'wall-point'; wallId: string; alongWallMm: number }>;

export type VisualRequest =
  | Readonly<{ kind: 'selection' }>
  | Readonly<{ kind: 'spatial-reference'; destination: SpatialReference }>
  | Readonly<{ kind: 'rectangle-layout-sketch'; layout: RoomLayout }>;

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function record(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
    throw new Error('Unexpected visual request fields.');
  }
}

export function parseVisualRequest(snapshot: ModelSnapshot, input: unknown): VisualRequest {
  if (!isRecord(input)) throw new Error('A visual request kind is required.');
  if (input.kind === 'selection') { record(input, ['kind']); return { kind: 'selection' }; }
  if (input.kind === 'rectangle-layout-sketch') {
    record(input, ['kind', 'layout']);
    return { kind: 'rectangle-layout-sketch', layout: rectangleLayout(previewRectangle(snapshot, input.layout)) };
  }
  if (input.kind !== 'spatial-reference') throw new Error('Unsupported visual request kind.');
  record(input, ['kind', 'destination']);
  const target = input.destination;
  if (!isRecord(target)) throw new Error('A spatial reference is required.');
  if (target.kind === 'floor-point') {
    record(target, ['kind', 'positionMm']);
    if (!Array.isArray(target.positionMm) || target.positionMm.length !== 2) throw new Error('A floor reference requires two whole millimetre coordinates.');
    const [x, y]: unknown[] = target.positionMm;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new Error('A floor reference requires two whole millimetre coordinates.');
    }
    const b = boundsMm(floorBounds(snapshot));
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) throw new Error('The floor reference must be inside the floor.');
    return { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [x, y] } };
  }
  record(target, ['kind', 'wallId', 'alongWallMm']);
  const wall = snapshot.entities.find((item) => item.id === target.wallId);
  if (target.kind !== 'wall-point' || wall?.type !== 'Wall') throw new Error('The referenced wall is missing from this revision.');
  const length = Math.round(Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) * 1000);
  if (typeof target.alongWallMm !== 'number' || !Number.isSafeInteger(target.alongWallMm) || target.alongWallMm < 0 || target.alongWallMm > length) {
    throw new Error('The wall reference must lie within its span, in whole millimetres.');
  }
  return { kind: 'spatial-reference', destination: { kind: 'wall-point', wallId: wall.id, alongWallMm: target.alongWallMm } };
}
