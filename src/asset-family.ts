import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { identifier } from './room-model.ts';
import type { Bounds, EntityId, ModelGraph, Point } from './room-model.ts';

const id = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
const name = Type.String({ minLength: 1, maxLength: 80 });
const normalized = Type.Number({ minimum: 0, maximum: 1 });
const vector = Type.Array(normalized, { minItems: 3, maxItems: 3 });
const part = Type.Object({ id, kind: Type.Union([Type.Literal('box'), Type.Literal('ellipsoid'), Type.Literal('cylinder')], { title: 'AssetPrimitiveKind' }),
  min: vector, size: vector, color: Type.String({ pattern: '^#[0-9a-f]{6}$' }),
}, { additionalProperties: false, title: 'AssetPart' });
export const AssetFamilySchema = Type.Object({ id, type: Type.Literal('AssetFamily'), name,
  description: Type.String({ minLength: 1, maxLength: 600 }), parts: Type.Array(part, { minItems: 1, maxItems: 16 }),
}, { additionalProperties: false, title: 'AssetFamily' });
export const AssetInstanceSchema = Type.Object({ id, type: Type.Literal('AssetInstance'), name, familyId: id,
  position: Type.Array(Type.Number({ minimum: -1000, maximum: 1000 }), { minItems: 2, maxItems: 2 }),
  rotationDeg: Type.Union([Type.Literal(0), Type.Literal(90), Type.Literal(180), Type.Literal(270)], { title: 'AssetRotation' }),
  size: Type.Object({ width: Type.Number({ minimum: .05, maximum: 5 }), depth: Type.Number({ minimum: .05, maximum: 5 }),
    height: Type.Number({ minimum: .02, maximum: 5 }) }, { additionalProperties: false }),
  placement: Type.Union([
    Type.Object({ kind: Type.Literal('single-room') }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal('room'), roomId: id }, { additionalProperties: false }),
  ], { title: 'AssetPlacement' }),
}, { additionalProperties: false, title: 'AssetInstance' });
export const AssetEditSchema = Type.Object({ families: Type.Array(AssetFamilySchema, { maxItems: 8 }),
  instances: Type.Array(AssetInstanceSchema, { maxItems: 32 }), removeInstanceIds: Type.Array(id, { maxItems: 32 }),
}, { additionalProperties: false, title: 'AssetEdit' });

export type AssetPoint = [number, number, number];
export type AssetPart = Omit<Static<typeof part>, 'min' | 'size'> & { min: AssetPoint; size: AssetPoint };
export type AssetFamily = Omit<Static<typeof AssetFamilySchema>, 'id' | 'parts'> & { id: EntityId; parts: AssetPart[] };
export type AssetInstance = Omit<Static<typeof AssetInstanceSchema>, 'id' | 'familyId' | 'position' | 'placement'> & {
  id: EntityId; familyId: EntityId; position: Point;
  placement: { kind: 'single-room' } | { kind: 'room'; roomId: EntityId };
};
export interface AssetEdit { families: AssetFamily[]; instances: AssetInstance[]; removeInstanceIds: EntityId[] }

/** Copy descriptors before checking schemas; arbitrary callers cannot execute getters. */
function plain(value: unknown, depth = 0): unknown {
  if (depth > 10) throw new Error('Asset data is too deeply nested.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (typeof value !== 'object' || value === null) throw new Error('Assets require finite plain JSON.');
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 100 || keys.length !== value.length + 1) throw new Error('Asset arrays must be dense and bounded.');
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Assets require plain data.');
      return plain(descriptor.value, depth + 1);
    });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || keys.length > 32) throw new Error('Assets require bounded plain objects.');
  return Object.fromEntries(keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Assets require plain data.');
    return [key, plain(descriptor.value, depth + 1)];
  }));
}

function triple(value: number[]): AssetPoint {
  const [x, y, z] = value;
  if (value.length !== 3 || x === undefined || y === undefined || z === undefined) throw new Error('Asset vectors require three coordinates.');
  return [x, y, z];
}
function millimetres(value: number): number {
  if (Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-6) throw new Error('Asset placement and dimensions require a millimetre grid.');
  return value;
}
function readable(value: string): string {
  if (!value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Asset names and descriptions must be nonblank readable text without ASCII controls.');
  return value;
}
export function parseAssetFamily(input: unknown): AssetFamily {
  const value = plain(input);
  if (!Check(AssetFamilySchema, value)) throw new Error('Asset family requires exact fields and one to sixteen bounded primitives.');
  const parts = value.parts.map((item): AssetPart => ({ ...item, min: triple(item.min), size: triple(item.size) }));
  if (new Set(parts.map((item) => item.id)).size !== parts.length) throw new Error('Family part identities must be unique.');
  for (let axis = 0; axis < 3; axis += 1) {
    if (parts.some((item) => item.size[axis] <= 0 || item.min[axis] + item.size[axis] > 1)
        || Math.min(...parts.map((item) => item.min[axis])) !== 0
        || Math.max(...parts.map((item) => item.min[axis] + item.size[axis])) !== 1) {
      throw new Error('Positive family primitives must stay inside and attain all six unit-box extrema.');
    }
  }
  return { ...value, id: identifier(value.id), name: readable(value.name), description: readable(value.description), parts };
}
export function parseAssetInstance(input: unknown): AssetInstance {
  const value = plain(input);
  if (!Check(AssetInstanceSchema, value)) throw new Error('Asset instance requires exact fields, a bound placement and bounded dimensions.');
  const [x, y] = value.position;
  if (x === undefined || y === undefined) throw new Error('Asset position requires two coordinates.');
  return { ...value, id: identifier(value.id), name: readable(value.name), familyId: identifier(value.familyId), position: [millimetres(x), millimetres(y)],
    size: { width: millimetres(value.size.width), depth: millimetres(value.size.depth), height: millimetres(value.size.height) },
    placement: value.placement.kind === 'single-room' ? { kind: 'single-room' } : { kind: 'room', roomId: identifier(value.placement.roomId) } };
}
export function parseAssetEdit(input: unknown): AssetEdit {
  const value = plain(input);
  if (!Check(AssetEditSchema, value)) throw new Error('Asset edits require exact bounded families, instances and removeInstanceIds.');
  return { families: value.families.map(parseAssetFamily), instances: value.instances.map(parseAssetInstance), removeInstanceIds: value.removeInstanceIds.map(identifier) };
}

export interface AssetGeometry {
  faces: { points: readonly AssetPoint[]; fill: string }[];
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  footprint: Bounds; dimensions: { width: number; depth: number; height: number }; family: AssetFamily;
}
export function assetFootprint(graph: ModelGraph, instance: AssetInstance): Bounds {
  if (!graph.entities.some((item) => item.type === 'AssetFamily' && item.id === instance.familyId)) throw new Error('Asset instance requires an existing family definition.');
  const sideways = instance.rotationDeg === 90 || instance.rotationDeg === 270;
  const width = sideways ? instance.size.depth : instance.size.width; const depth = sideways ? instance.size.width : instance.size.depth;
  return { minX: instance.position[0] - width / 2, maxX: instance.position[0] + width / 2,
    minY: instance.position[1] - depth / 2, maxY: instance.position[1] + depth / 2 };
}

/** Fixed tessellation includes cardinal extrema and ellipsoid poles/equator. Z is local floor height. */
export function assetGeometry(graph: ModelGraph, instance: AssetInstance): AssetGeometry {
  const family = graph.entities.find((entity): entity is AssetFamily => entity.type === 'AssetFamily' && entity.id === instance.familyId);
  if (!family) throw new Error('Asset instance requires an existing family definition.');
  const faces: AssetGeometry['faces'] = [];
  const transform = ([nx, ny, nz]: AssetPoint): AssetPoint => {
    const x = (nx - .5) * instance.size.width; const y = (ny - .5) * instance.size.depth;
    const rotated: Point = instance.rotationDeg === 0 ? [x, y] : instance.rotationDeg === 90 ? [-y, x]
      : instance.rotationDeg === 180 ? [-x, -y] : [y, -x];
    return [instance.position[0] + rotated[0], instance.position[1] + rotated[1], nz * instance.size.height];
  };
  const face = (points: AssetPoint[], fill: string): void => { faces.push({ points: points.map(transform), fill }); };
  for (const part of family.parts) {
    const [x, y, z] = part.min; const [w, d, h] = part.size; const fill = part.color;
    if (part.kind === 'box') {
      const a: AssetPoint = [x, y, z]; const b: AssetPoint = [x + w, y, z]; const c: AssetPoint = [x + w, y + d, z]; const e: AssetPoint = [x, y + d, z];
      const top = (point: AssetPoint): AssetPoint => [point[0], point[1], z + h];
      face([e, c, b, a], fill); face([top(a), top(b), top(c), top(e)], fill);
      for (const [p, q] of [[a, b], [b, c], [c, e], [e, a]]) face([p, q, top(q), top(p)], fill);
      continue;
    }
    const ring = (segment: number, radius: number, elevation: number): AssetPoint => {
      const angle = segment * Math.PI / 6;
      const cx = segment === 0 ? 1 : segment === 6 ? -1 : segment === 3 || segment === 9 ? 0 : Math.cos(angle);
      const cy = segment === 3 ? 1 : segment === 9 ? -1 : segment === 0 || segment === 6 ? 0 : Math.sin(angle);
      return [radius === 1 && cx === -1 ? x : radius === 1 && cx === 1 ? x + w : x + w / 2 + cx * radius * w / 2,
        radius === 1 && cy === -1 ? y : radius === 1 && cy === 1 ? y + d : y + d / 2 + cy * radius * d / 2, elevation];
    };
    if (part.kind === 'cylinder') {
      const lower = Array.from({ length: 12 }, (_, index) => ring(index, 1, z));
      const upper = Array.from({ length: 12 }, (_, index) => ring(index, 1, z + h));
      face([...lower].reverse(), fill); face(upper, fill);
      for (let index = 0; index < 12; index += 1) { const next = (index + 1) % 12; face([lower[index], lower[next], upper[next], upper[index]], fill); }
    } else {
      const latitude = (band: number, segment: number): AssetPoint => ring(segment, band === 3 ? 1 : Math.sin(band * Math.PI / 6),
        band === 3 ? z + h / 2 : z + h / 2 - Math.cos(band * Math.PI / 6) * h / 2);
      for (let index = 0; index < 12; index += 1) {
        const next = (index + 1) % 12;
        face([[x + w / 2, y + d / 2, z], latitude(1, next), latitude(1, index)], fill);
        for (let band = 1; band < 5; band += 1) face([latitude(band, index), latitude(band, next), latitude(band + 1, next), latitude(band + 1, index)], fill);
        face([latitude(5, index), latitude(5, next), [x + w / 2, y + d / 2, z + h]], fill);
      }
    }
  }
  const footprint = assetFootprint(graph, instance);
  return { faces, bounds: { ...footprint, minZ: 0, maxZ: instance.size.height }, footprint, dimensions: { ...instance.size }, family };
}
