import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { plainScopeData } from './model-scope-contract.ts';

export const MARKUP_LIMITS = Object.freeze({ coordinateMetres: 1_000_000, spanMetres: 10_000, points: 64, minimumMetres: .001 });
const coordinate = Type.Number({ minimum: -MARKUP_LIMITS.coordinateMetres, maximum: MARKUP_LIMITS.coordinateMetres });
export const MarkupPointSchema = Type.Tuple([coordinate, coordinate, coordinate]);
export type MarkupPoint = Static<typeof MarkupPointSchema>;
const label = Type.String({ maxLength: 120 });
const exact = { additionalProperties: false };

/** Approximate user intent, in project X east, Y north, Z elevation, metres. */
export const SpatialMarkupSchema = Type.Union([
  Type.Object({ kind: Type.Literal('line'), from: MarkupPointSchema, to: MarkupPointSchema, label }, exact),
  Type.Object({ kind: Type.Literal('rectangle'), corners: Type.Tuple([MarkupPointSchema, MarkupPointSchema, MarkupPointSchema, MarkupPointSchema]), label }, exact),
  Type.Object({ kind: Type.Literal('circle'), center: MarkupPointSchema, normal: MarkupPointSchema,
    radius: Type.Number({ minimum: MARKUP_LIMITS.minimumMetres, maximum: MARKUP_LIMITS.spanMetres / 2 }), label }, exact),
  Type.Object({ kind: Type.Literal('polyline'), points: Type.Array(MarkupPointSchema, { minItems: 2, maxItems: MARKUP_LIMITS.points }), label }, exact),
]);
export type SpatialMarkup = Static<typeof SpatialMarkupSchema>;
export type MarkupTool = SpatialMarkup['kind'];
export interface MarkupPlane { readonly origin: MarkupPoint; readonly normal: MarkupPoint; readonly u: MarkupPoint; readonly v: MarkupPoint }
export interface MarkupBounds { readonly min: MarkupPoint; readonly max: MarkupPoint }

const subtract = (a: MarkupPoint, b: MarkupPoint): MarkupPoint => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: MarkupPoint, b: MarkupPoint): MarkupPoint => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: MarkupPoint, value: number): MarkupPoint => [a[0] * value, a[1] * value, a[2] * value];
const dot = (a: MarkupPoint, b: MarkupPoint): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: MarkupPoint, b: MarkupPoint): MarkupPoint => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: MarkupPoint): number => Math.hypot(...a);
const distance = (a: MarkupPoint, b: MarkupPoint): number => length(subtract(a, b));
function unit(a: MarkupPoint): MarkupPoint {
  const size = length(a);
  if (!Number.isFinite(size) || size < 1e-9) throw new Error('Choose a visible drawing surface with a usable normal.');
  return scale(a, 1 / size);
}

/** Captured once per gesture. Subsequent points cannot jump to another surface. */
export function createMarkupPlane(input: { origin: MarkupPoint; normal: MarkupPoint }): MarkupPlane {
  if (!Check(MarkupPointSchema, input.origin) || !Check(MarkupPointSchema, input.normal)) throw new Error('Drawing planes require finite project-space coordinates.');
  const normal = unit(input.normal);
  const horizontal = cross([0, 0, 1], normal);
  const u = length(horizontal) > 1e-6 ? unit(horizontal) : unit(subtract([1, 0, 0], scale(normal, normal[0])));
  return { origin: [...input.origin], normal, u, v: unit(cross(normal, u)) };
}

export function projectToMarkupPlane(plane: MarkupPlane, point: MarkupPoint): MarkupPoint {
  const delta = subtract(point, plane.origin);
  return add(plane.origin, add(scale(plane.u, dot(delta, plane.u)), scale(plane.v, dot(delta, plane.v))));
}

export function spatialMarkupBounds(markup: SpatialMarkup): MarkupBounds {
  if (markup.kind === 'circle') {
    const extent: MarkupPoint = [Math.sqrt(Math.max(0, 1 - markup.normal[0] ** 2)) * markup.radius,
      Math.sqrt(Math.max(0, 1 - markup.normal[1] ** 2)) * markup.radius,
      Math.sqrt(Math.max(0, 1 - markup.normal[2] ** 2)) * markup.radius];
    return { min: subtract(markup.center, extent), max: add(markup.center, extent) };
  }
  const points = markup.kind === 'line' ? [markup.from, markup.to] : markup.kind === 'rectangle' ? markup.corners : markup.points;
  return { min: [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.min(...points.map(p => p[2]))],
    max: [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1])), Math.max(...points.map(p => p[2]))] };
}

function edge(a: MarkupPoint, b: MarkupPoint): void {
  if (distance(a, b) < MARKUP_LIMITS.minimumMetres) throw new Error('Draw markup at least 1 mm long.');
}

export function parseSpatialMarkup(input: unknown): SpatialMarkup {
  const value = plainScopeData(input);
  if (!Check(SpatialMarkupSchema, value)) throw new Error('Invalid 3D markup. Use finite project-space metres and a bounded line, rectangle, circle or polyline.');
  if (value.kind === 'line') edge(value.from, value.to);
  else if (value.kind === 'rectangle') {
    const [a, b, c, d] = value.corners;
    edge(a, b); edge(a, d);
    const u = subtract(b, a); const v = subtract(d, a);
    if (Math.abs(dot(u, v)) > 1e-6 * length(u) * length(v)
        || distance(c, add(a, add(u, v))) > 1e-6 * Math.max(1, length(u), length(v))) {
      throw new Error('A rectangle requires four ordered, coplanar corners and perpendicular sides.');
    }
  } else if (value.kind === 'circle') {
    if (Math.abs(length(value.normal) - 1) > 1e-6) throw new Error('A circle requires a unit drawing-plane normal.');
  } else for (let i = 1; i < value.points.length; i++) {
    const before = value.points[i - 1]; const after = value.points[i];
    if (before && after) edge(before, after);
  }
  const bounds = spatialMarkupBounds(value);
  if (length(subtract(bounds.max, bounds.min)) > MARKUP_LIMITS.spanMetres
      || [...bounds.min, ...bounds.max].some(n => !Number.isFinite(n) || Math.abs(n) > MARKUP_LIMITS.coordinateMetres)) {
    throw new Error('Markup must remain within the supported project coordinates and 10 km extent.');
  }
  return value;
}

export function createSpatialMarkup(input: { tool: Exclude<MarkupTool, 'polyline'>; plane: MarkupPlane; start: MarkupPoint; end: MarkupPoint; label: string }): SpatialMarkup {
  const from = projectToMarkupPlane(input.plane, input.start);
  const to = projectToMarkupPlane(input.plane, input.end);
  if (input.tool === 'line') return parseSpatialMarkup({ kind: 'line', from, to, label: input.label });
  if (input.tool === 'circle') return parseSpatialMarkup({ kind: 'circle', center: from, normal: input.plane.normal, radius: distance(from, to), label: input.label });
  const delta = subtract(to, from);
  return parseSpatialMarkup({ kind: 'rectangle', corners: [from, add(from, scale(input.plane.u, dot(delta, input.plane.u))), to,
    add(from, scale(input.plane.v, dot(delta, input.plane.v)))], label: input.label });
}

const metres = (value: number): string => value.toFixed(value < .01 ? 3 : 2).replace(/\.?0+$/, '');
export function spatialMarkupDescription(markup: SpatialMarkup): string {
  if (markup.kind === 'line') return `Line · ${metres(distance(markup.from, markup.to))} m`;
  if (markup.kind === 'circle') return `Circle · radius ${metres(markup.radius)} m`;
  if (markup.kind === 'rectangle') return `Rectangle · ${metres(distance(markup.corners[0], markup.corners[1]))} × ${metres(distance(markup.corners[0], markup.corners[3]))} m`;
  let total = 0;
  for (let i = 1; i < markup.points.length; i++) {
    const a = markup.points[i - 1]; const b = markup.points[i];
    if (a && b) total += distance(a, b);
  }
  return `Polyline · ${markup.points.length} points · ${metres(total)} m`;
}

/** Display-only tessellation; the wire retains exact circle centre/normal/radius. */
export function spatialMarkupVertices(markup: SpatialMarkup): MarkupPoint[] {
  if (markup.kind === 'line') return [markup.from, markup.to];
  if (markup.kind === 'polyline') return markup.points;
  if (markup.kind === 'rectangle') return [...markup.corners, markup.corners[0]];
  const plane = createMarkupPlane({ origin: markup.center, normal: markup.normal });
  return Array.from({ length: 65 }, (_, i) => {
    const angle = i / 64 * Math.PI * 2;
    return add(markup.center, add(scale(plane.u, Math.cos(angle) * markup.radius), scale(plane.v, Math.sin(angle) * markup.radius)));
  });
}
