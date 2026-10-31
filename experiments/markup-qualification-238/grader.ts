import type { MarkupPoint, SpatialMarkup } from '../../src/spatial-markup.ts';

/** Fixed allowance for the host's 1 mm placement grid. Never caller-configurable. */
export const TOLERANCE_METRES = 0.002;
// Arithmetic degeneracy threshold, not a second placement allowance.
const NUMERIC = 1e-10;
type Point = Readonly<MarkupPoint>;
type XY = readonly [number, number];
type Segment = readonly [XY, XY];
type Interval = readonly [number, number];

export type Footprint =
  | { readonly kind: 'oriented-rectangle'; readonly center: Point; readonly widthMetres: number;
      readonly depthMetres: number; readonly yawRadians: number }
  | { readonly kind: 'polygon'; readonly vertices: readonly Point[] };

export type Unsupported = { readonly kind: 'unsupported'; readonly reason:
  'invalid-geometry' | 'non-horizontal' | 'different-elevation' | 'self-intersection' | 'open-path' | 'tolerance-ambiguity'; readonly detail: string };
export type OracleResult<T> = { readonly kind: 'supported'; readonly value: T; readonly toleranceMetres: number } | Unsupported;
type Prepared =
  | { readonly kind: 'circle'; readonly center: XY; readonly radius: number; readonly elevation: number }
  | { readonly kind: 'path'; readonly vertices: readonly XY[]; readonly closed: boolean; readonly elevation: number };
type Polygon = { readonly vertices: readonly XY[]; readonly elevation: number };

const unsupported = (reason: Unsupported['reason'], detail: string): Unsupported => ({ kind: 'unsupported', reason, detail });
const supported = <T>(value: T): OracleResult<T> => ({ kind: 'supported', value, toleranceMetres: TOLERANCE_METRES });
const xy = (p: Point): XY => [p[0], p[1]];
const delta = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const dot = (a: XY, b: XY): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: XY, b: XY): number => a[0] * b[1] - a[1] * b[0];
const length = (a: XY): number => Math.hypot(a[0], a[1]);
const distance = (a: XY, b: XY): number => length(delta(a, b));
const at = (a: XY, b: XY, t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const finitePoint = (p: Point): boolean => p.every(v => Number.isFinite(v) && Math.abs(v) <= 1_000_000);

function segments(vertices: readonly XY[], closed: boolean): Segment[] {
  return vertices.flatMap((a, i) => {
    const b = vertices[i + 1] ?? (closed ? vertices[0] : undefined);
    return b ? [[a, b] satisfies Segment] : [];
  });
}

function pointSegment(p: XY, [a, b]: Segment): number {
  const ab = delta(b, a);
  const t = Math.max(0, Math.min(1, dot(delta(p, a), ab) / dot(ab, ab)));
  return distance(p, at(a, b, t));
}

function side(a: XY, b: XY, p: XY): number {
  const signed = cross(delta(b, a), delta(p, a)) / distance(a, b);
  return Math.abs(signed) <= NUMERIC ? 0 : Math.sign(signed);
}

function intersects([a, b]: Segment, [c, d]: Segment): boolean {
  const abC = side(a, b, c); const abD = side(a, b, d);
  const cdA = side(c, d, a); const cdB = side(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0)
    || (abC === 0 && pointSegment(c, [a, b]) <= NUMERIC)
    || (abD === 0 && pointSegment(d, [a, b]) <= NUMERIC)
    || (cdA === 0 && pointSegment(a, [c, d]) <= NUMERIC)
    || (cdB === 0 && pointSegment(b, [c, d]) <= NUMERIC);
}

function segmentDistance(a: Segment, b: Segment): number {
  return intersects(a, b) ? 0 : Math.min(pointSegment(a[0], b), pointSegment(a[1], b), pointSegment(b[0], a), pointSegment(b[1], a));
}

function boundaryDistance(p: XY, vertices: readonly XY[], closed: boolean): number {
  return Math.min(...segments(vertices, closed).map(edge => pointSegment(p, edge)));
}

function contains(p: XY, vertices: readonly XY[]): boolean {
  if (boundaryDistance(p, vertices, true) <= NUMERIC) return true;
  let inside = false;
  for (const [a, b] of segments(vertices, true)) {
    if ((a[1] > p[1]) !== (b[1] > p[1])
        && p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) inside = !inside;
  }
  return inside;
}

function planar(points: readonly Point[]): number | Unsupported {
  const first = points[0];
  if (!first || points.length > 256 || !points.every(finitePoint)) return unsupported('invalid-geometry', 'Expected 1..256 finite project-space points within 1000 km.');
  if (points.some(p => Math.abs(p[2] - first[2]) > NUMERIC)) return unsupported('non-horizontal', 'Vertices must share one horizontal plane; no silent projection.');
  if (points.some(p => distance(xy(p), xy(first)) > 10_000)) return unsupported('invalid-geometry', 'Planar extent exceeds 10 km.');
  return first[2];
}

function validatePath(vertices: readonly XY[], closed: boolean): Unsupported | undefined {
  if (vertices.length < (closed ? 3 : 2)) return unsupported('invalid-geometry', 'Too few distinct vertices.');
  const edges = segments(vertices, closed);
  if (edges.some(([a, b]) => distance(a, b) <= NUMERIC)) return unsupported('invalid-geometry', 'Zero-length edge.');
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i];
    if (!a) continue;
    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j];
      if (!b) continue;
      const adjacent = j === i + 1 || (closed && i === 0 && j === edges.length - 1);
      if (!adjacent && intersects(a, b)) return unsupported('self-intersection', 'Non-adjacent edges cross or touch.');
      if (adjacent) {
        // Shared endpoints are allowed, overlapping/backtracking neighbours are not.
        const outerA = j === i + 1 ? a[0] : a[1];
        const outerB = j === i + 1 ? b[1] : b[0];
        if (pointSegment(outerA, b) <= NUMERIC || pointSegment(outerB, a) <= NUMERIC) {
          return unsupported('self-intersection', 'Adjacent edges overlap or backtrack.');
        }
      }
    }
  }
  const origin = vertices[0];
  if (closed && origin && Math.abs(edges.reduce((sum, [a, b]) => sum + cross(delta(a, origin), delta(b, origin)), 0)) <= NUMERIC ** 2) {
    return unsupported('invalid-geometry', 'Region has zero area.');
  }
  return undefined;
}

function prepareMarkup(markup: SpatialMarkup): Prepared | Unsupported {
  if (markup.kind === 'circle') {
    if (!finitePoint(markup.center) || !markup.normal.every(Number.isFinite) || !Number.isFinite(markup.radius)
        || markup.radius <= NUMERIC || markup.radius > 5_000) return unsupported('invalid-geometry', 'Invalid circle centre, normal or radius.');
    if (Math.abs(Math.hypot(...markup.normal) - 1) > NUMERIC) return unsupported('invalid-geometry', 'Circle normal must be unit length.');
    if (Math.hypot(markup.normal[0], markup.normal[1]) > NUMERIC) return unsupported('non-horizontal', 'Tilted circle is outside this planar oracle.');
    return { kind: 'circle', center: xy(markup.center), radius: markup.radius, elevation: markup.center[2] };
  }
  const points = markup.kind === 'line' ? [markup.from, markup.to] : markup.kind === 'rectangle' ? markup.corners : markup.points;
  const elevation = planar(points);
  if (typeof elevation !== 'number') return elevation;
  const first = points[0]; const last = points[points.length - 1];
  // Closure is explicit; the 2 mm grade tolerance never snaps an open path shut.
  const repeated = first !== undefined && last !== undefined && distance(xy(first), xy(last)) <= NUMERIC;
  const closed = markup.kind === 'rectangle' || (markup.kind === 'polyline' && repeated);
  const vertices = (repeated ? points.slice(0, -1) : points).map(xy);
  const issue = validatePath(vertices, closed);
  if (issue) return issue;
  if (markup.kind === 'rectangle') {
    const [a, b, c, d] = markup.corners.map(xy);
    if (!a || !b || !c || !d) return unsupported('invalid-geometry', 'Rectangle requires four corners.');
    const ab = delta(b, a); const ad = delta(d, a);
    if (Math.abs(dot(ab, ad)) / (length(ab) * length(ad)) > NUMERIC
        || distance(c, [b[0] + d[0] - a[0], b[1] + d[1] - a[1]]) > NUMERIC) {
      return unsupported('invalid-geometry', 'Rectangle corners must be ordered and orthogonal.');
    }
  }
  return { kind: 'path', vertices, closed, elevation };
}

function prepareFootprint(footprint: Footprint): Polygon | Unsupported {
  let points: readonly Point[];
  if (footprint.kind === 'oriented-rectangle') {
    const { center, widthMetres: w, depthMetres: d, yawRadians: angle } = footprint;
    if (!finitePoint(center) || ![w, d, angle].every(Number.isFinite) || w <= NUMERIC || d <= NUMERIC) {
      return unsupported('invalid-geometry', 'Footprint requires finite positive dimensions and yaw.');
    }
    const c = Math.cos(angle); const s = Math.sin(angle);
    const corners: XY[] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    points = corners.map(([x, y]): Point => [center[0] + c * x - s * y, center[1] + s * x + c * y, center[2]]);
  } else points = footprint.vertices;
  const elevation = planar(points);
  if (typeof elevation !== 'number') return elevation;
  const first = points[0]; const last = points[points.length - 1];
  const repeated = first !== undefined && last !== undefined && distance(xy(first), xy(last)) <= NUMERIC;
  const vertices = (repeated ? points.slice(0, -1) : points).map(xy);
  return validatePath(vertices, true) ?? { vertices, elevation };
}

function pair(input: { markup: SpatialMarkup; footprint: Footprint }): { shape: Prepared; polygon: Polygon } | Unsupported {
  const shape = prepareMarkup(input.markup);
  if (shape.kind === 'unsupported') return shape;
  const polygon = prepareFootprint(input.footprint);
  if ('kind' in polygon) return polygon;
  if (Math.abs(shape.elevation - polygon.elevation) > TOLERANCE_METRES) return unsupported('different-elevation', 'Markup and footprint must be on the same storey plane within 2 mm.');
  return { shape, polygon };
}

function linearInterval(start: number, slope: number, low: number, high: number): Interval | undefined {
  if (slope === 0) return start >= low && start <= high ? [0, 1] : undefined;
  const a = (low - start) / slope; const b = (high - start) / slope;
  const min = Math.max(0, Math.min(a, b)); const max = Math.min(1, Math.max(a, b));
  return min <= max ? [min, max] : undefined;
}

/** Exact parameter intervals where an edge is within 2 mm of a boundary segment. */
function capsuleIntervals([a, b]: Segment, [c, d]: Segment): Interval[] {
  const direction = delta(b, a); const axis = delta(d, c); const offset = delta(a, c);
  const axisLength = length(axis); const intervals: Interval[] = [];
  const along = linearInterval(dot(offset, axis) / axisLength, dot(direction, axis) / axisLength, 0, axisLength);
  const across = linearInterval(cross(axis, offset) / axisLength, cross(axis, direction) / axisLength, -TOLERANCE_METRES, TOLERANCE_METRES);
  if (along && across) {
    const lo = Math.max(along[0], across[0]); const hi = Math.min(along[1], across[1]);
    if (lo <= hi) intervals.push([lo, hi]);
  }
  const square = dot(direction, direction);
  for (const endpoint of [c, d]) {
    const toCentre = delta(endpoint, a);
    const t = dot(toCentre, direction) / square;
    const perpendicular = Math.abs(cross(direction, toCentre)) / Math.sqrt(square);
    if (perpendicular > TOLERANCE_METRES) continue;
    const half = Math.sqrt(Math.max(0, TOLERANCE_METRES ** 2 - perpendicular ** 2) / square);
    const lo = Math.max(0, t - half); const hi = Math.min(1, t + half);
    if (lo <= hi) intervals.push([lo, hi]);
  }
  return intervals;
}

function edgeInside(edge: Segment, region: readonly XY[]): 'inside' | 'tolerance-only' | 'outside' {
  const [a, b] = edge; const direction = delta(b, a);
  const cuts = [0, 1]; const intervals: Interval[] = [];
  for (const boundary of segments(region, true)) {
    intervals.push(...capsuleIntervals(edge, boundary));
    const [c, d] = boundary; const axis = delta(d, c);
    const denominator = cross(direction, axis);
    if (denominator !== 0) {
      const t = cross(delta(c, a), axis) / denominator;
      const u = cross(delta(c, a), direction) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    } else if (side(a, b, c) === 0) {
      for (const endpoint of [c, d]) {
        const t = dot(delta(endpoint, a), direction) / dot(direction, direction);
        if (t > 0 && t < 1) cuts.push(t);
      }
    }
  }
  cuts.sort((x, y) => x - y);
  let exact = true;
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1]; const hi = cuts[i];
    if (lo !== undefined && hi !== undefined && hi > lo) {
      if (contains(at(a, b, (lo + hi) / 2), region)) intervals.push([lo, hi]);
      else exact = false;
    }
  }
  if (exact) return 'inside';
  intervals.sort((x, y) => x[0] - y[0]);
  let covered = 0;
  for (const [lo, hi] of intervals) {
    if ((lo - covered) * length(direction) > NUMERIC) return 'outside';
    covered = Math.max(covered, hi);
    if (covered >= 1) return 'tolerance-only';
  }
  return covered >= 1 ? 'tolerance-only' : 'outside';
}

function convex(vertices: readonly XY[]): boolean {
  let winding = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]; const b = vertices[(i + 1) % vertices.length]; const c = vertices[(i + 2) % vertices.length];
    if (!a || !b || !c) return false;
    const turn = side(a, b, c);
    if (turn !== 0 && winding !== 0 && turn !== winding) return false;
    if (turn !== 0) winding = turn;
  }
  return winding !== 0;
}

/** Tests the complete filled footprint, including edges crossing a concave notch. */
export function gradeInside(input: { markup: SpatialMarkup; footprint: Footprint }): OracleResult<boolean> {
  const prepared = pair(input);
  if ('kind' in prepared) return prepared;
  const { shape, polygon } = prepared;
  if (shape.kind === 'circle') return supported(polygon.vertices.every(p => distance(p, shape.center) <= shape.radius + TOLERANCE_METRES));
  if (!shape.closed) return unsupported('open-path', 'Inside is undefined for a line or open polyline.');
  const edges = segments(polygon.vertices, true).map(edge => edgeInside(edge, shape.vertices));
  if (edges.includes('outside')) return supported(false);
  // A concave region's offset can seal its mouth and create a hole. Boundary
  // coverage alone then cannot certify the filled interior; abstain explicitly.
  if (edges.includes('tolerance-only') && !convex(shape.vertices)) {
    return unsupported('tolerance-ambiguity', 'Concave containment depends on the 2 mm band; filled-interior certainty is unavailable.');
  }
  return supported(true);
}

function measuredBoundaries(shape: Prepared, polygon: Polygon): { vertexDistancesMetres: number[]; boundaryDistanceMetres: number } {
  if (shape.kind === 'circle') {
    const radii = polygon.vertices.map(p => distance(p, shape.center));
    const min = Math.min(...segments(polygon.vertices, true).map(edge => pointSegment(shape.center, edge)));
    const max = Math.max(...radii);
    return { vertexDistancesMetres: radii.map(r => Math.abs(r - shape.radius)),
      boundaryDistanceMetres: min <= shape.radius && max >= shape.radius ? 0 : Math.min(Math.abs(min - shape.radius), Math.abs(max - shape.radius)) };
  }
  const boundary = segments(shape.vertices, shape.closed);
  return { vertexDistancesMetres: polygon.vertices.map(p => boundaryDistance(p, shape.vertices, shape.closed)),
    boundaryDistanceMetres: Math.min(...segments(polygon.vertices, true).flatMap(edge => boundary.map(other => segmentDistance(edge, other)))) };
}

/** Boundary-to-boundary distance; containment can have a positive boundary distance. */
export function measureFootprintBoundaryDistances(input: { markup: SpatialMarkup; footprint: Footprint }): OracleResult<{
  vertexDistancesMetres: number[]; boundaryDistanceMetres: number;
}> {
  const prepared = pair(input);
  return 'kind' in prepared ? prepared : supported(measuredBoundaries(prepared.shape, prepared.polygon));
}

/** Outside requires disjoint filled regions, even when the requested gap is zero. */
export function gradeOutside(input: { markup: SpatialMarkup; footprint: Footprint; minimumGapMetres: number }): OracleResult<{
  satisfied: boolean; disjoint: boolean; gapMetres: number;
}> {
  if (!Number.isFinite(input.minimumGapMetres) || input.minimumGapMetres < 0) return unsupported('invalid-geometry', 'Minimum gap must be finite and nonnegative.');
  const prepared = pair(input);
  if ('kind' in prepared) return prepared;
  const { shape, polygon } = prepared;
  let disjoint: boolean;
  if (shape.kind === 'circle') {
    disjoint = !contains(shape.center, polygon.vertices)
      && boundaryDistance(shape.center, polygon.vertices, true) > shape.radius + NUMERIC;
  } else {
    if (!shape.closed) return unsupported('open-path', 'Outside a region is undefined for an open path; use boundary distance.');
    disjoint = !shape.vertices.some(p => contains(p, polygon.vertices)) && !polygon.vertices.some(p => contains(p, shape.vertices))
      && measuredBoundaries(shape, polygon).boundaryDistanceMetres > NUMERIC;
  }
  const gapMetres = disjoint ? measuredBoundaries(shape, polygon).boundaryDistanceMetres : 0;
  return supported({ satisfied: disjoint && gapMetres + TOLERANCE_METRES >= input.minimumGapMetres, disjoint, gapMetres });
}

/** Distance to finite path segments or exact circle/rectangle perimeter, never bounds. */
export function measurePointBoundaryDistance(input: { markup: SpatialMarkup; point: Point }): OracleResult<number> {
  const shape = prepareMarkup(input.markup);
  if (shape.kind === 'unsupported') return shape;
  if (!finitePoint(input.point)) return unsupported('invalid-geometry', 'Point must be finite project-space metres.');
  if (Math.abs(shape.elevation - input.point[2]) > TOLERANCE_METRES) return unsupported('different-elevation', 'Point and markup must share a plane within 2 mm.');
  const p = xy(input.point);
  return supported(shape.kind === 'circle' ? Math.abs(distance(p, shape.center) - shape.radius) : boundaryDistance(p, shape.vertices, shape.closed));
}

export function gradeCentreDistance(input: { markup: SpatialMarkup; centre: Point; targetDistanceMetres: number }): OracleResult<{
  satisfied: boolean; distanceMetres: number;
}> {
  if (!Number.isFinite(input.targetDistanceMetres) || input.targetDistanceMetres < 0) return unsupported('invalid-geometry', 'Target distance must be finite and nonnegative.');
  const result = measurePointBoundaryDistance({ markup: input.markup, point: input.centre });
  return result.kind === 'unsupported' ? result : supported({ satisfied: Math.abs(result.value - input.targetDistanceMetres) <= TOLERANCE_METRES, distanceMetres: result.value });
}
