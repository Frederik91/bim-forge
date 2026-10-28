import type { GeometryBounds, GeometryMatrix, GeometryPoint } from './geometry-contract.ts';

export type Vec3 = GeometryPoint;
export type Triangle = readonly [Vec3, Vec3, Vec3];
export type GeometryMesh = { triangles: Triangle[]; bounds: GeometryBounds; closed: boolean };
export type GeometryShape = { meshes: GeometryMesh[]; bounds: GeometryBounds };
export const NUMERIC_TOLERANCE_METRES = 1e-7;
export class GeometryLimitError extends Error {
  readonly reason: 'budget' | 'deadline';
  constructor(reason: 'budget' | 'deadline') { super(`Geometry ${reason} exceeded.`); this.reason = reason; }
}
export type GeometryWork = ReturnType<typeof geometryWork>;
export function geometryWork(options: { maxWork: number; maxMilliseconds: number; now?: () => number }) {
  const now = options.now ?? (() => performance.now());
  const end = now() + options.maxMilliseconds;
  let work = 0;
  return { tick(cost = 1): void {
    work += cost;
    if (work > options.maxWork) throw new GeometryLimitError('budget');
    if (now() >= end) throw new GeometryLimitError('deadline');
  }, used: () => work };
}
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): number => Math.hypot(...a);
const clamp = (n: number): number => Math.max(0, Math.min(1, n));

export function transformPoint(matrix: GeometryMatrix | number[][], point: Vec3): Vec3 {
  const value = matrix.slice(0, 3).map(row => row[0] * point[0] + row[1] * point[1] + row[2] * point[2] + row[3]);
  const [x, y, z] = value;
  if (value.length !== 3 || [x, y, z].some(n => !Number.isFinite(n) || Math.abs(n) > 1e6)) throw new Error('Geometry transform exceeds the project envelope.');
  return [x, y, z];
}
export function assertRigidTransform(matrix: GeometryMatrix | number[][]): void {
  if (matrix.length !== 4 || matrix.some(row => row.length !== 4 || row.some(n => !Number.isFinite(n) || Math.abs(n) > 1e6))
    || matrix[3].some((n, i) => n !== (i === 3 ? 1 : 0))) throw new Error('Invalid finite affine geometry transform.');
  const rows: Vec3[] = matrix.slice(0, 3).map(row => [row[0], row[1], row[2]]);
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    if (Math.abs(dot(rows[a], rows[b]) - (a === b ? 1 : 0)) > 1e-8) throw new Error('Only rigid metre transforms are supported.');
  }
  if (Math.abs(dot(rows[0], cross(rows[1], rows[2])) - 1) > 1e-8) throw new Error('Reflected geometry transform is unsupported.');
}
export function boundsOf(points: readonly Vec3[]): GeometryBounds {
  if (!points.length) throw new Error('Empty shape has no bounds.');
  const min: Vec3 = [Infinity, Infinity, Infinity]; const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(p[i]) || Math.abs(p[i]) > 1e6) throw new Error('Non-finite or oversized geometry coordinate.');
    min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]);
  }
  return { min, max };
}
export function boundsOverlap(a: GeometryBounds, b: GeometryBounds): boolean {
  return a.min.every((n, i) => n <= b.max[i] + NUMERIC_TOLERANCE_METRES && a.max[i] + NUMERIC_TOLERANCE_METRES >= b.min[i]);
}
function boundsDistance(a: GeometryBounds, b: GeometryBounds): number {
  return Math.hypot(...a.min.map((n, i) => Math.max(0, n - b.max[i], b.min[i] - a.max[i])));
}

/** Exact-coordinate welding handles converters which duplicate vertices per face. No tolerance weld closes an actual gap. */
export function createMesh(triangles: Triangle[], work: GeometryWork): GeometryMesh {
  if (!triangles.length) throw new Error('Missing mesh triangles.');
  const edges = new Map<string, { count: number; direction: number }>();
  let valid = true;
  for (const [a, b, c] of triangles) {
    work.tick();
    if (norm(cross(sub(b, a), sub(c, a))) < 1e-14) throw new Error('Degenerate mesh triangle.');
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const x = JSON.stringify(p); const y = JSON.stringify(q); const key = x < y ? `${x}|${y}` : `${y}|${x}`;
      const edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++; edge.direction += x < y ? 1 : -1; edges.set(key, edge);
    }
  }
  for (const edge of edges.values()) { work.tick(); if (edge.count !== 2 || edge.direction !== 0) valid = false; }
  return { triangles, bounds: boundsOf(triangles.flatMap(t => [...t])), closed: valid };
}
export function shapeOf(meshes: GeometryMesh[]): GeometryShape {
  if (!meshes.length) throw new Error('Missing solid geometry.');
  return { meshes, bounds: boundsOf(meshes.flatMap(mesh => [mesh.bounds.min, mesh.bounds.max])) };
}
export function meshFromFaces(faces: readonly (readonly Vec3[])[], work: GeometryWork): GeometryMesh {
  const triangles: Triangle[] = [];
  for (const face of faces) for (let i = 1; i + 1 < face.length; i++) {
    work.tick();
    // Native wedges can legitimately collapse one side at a roof/void boundary.
    if (norm(cross(sub(face[i], face[0]), sub(face[i + 1], face[0]))) > 1e-14) triangles.push([face[0], face[i], face[i + 1]]);
  }
  return createMesh(triangles, work);
}
export function boxMesh(bounds: GeometryBounds, matrix: GeometryMatrix | number[][], work: GeometryWork): GeometryMesh {
  assertRigidTransform(matrix);
  if (bounds.min.some((n, i) => n >= bounds.max[i])) throw new Error('Box dimensions must be positive.');
  const [x, y, z] = bounds.min; const [a, b, c] = bounds.max;
  const points: Vec3[] = [[x, y, z], [a, y, z], [a, b, z], [x, b, z], [x, y, c], [a, y, c], [a, b, c], [x, b, c]];
  const p = points.map(point => transformPoint(matrix, point));
  return meshFromFaces([[p[3], p[2], p[1], p[0]], [p[4], p[5], p[6], p[7]], [p[0], p[1], p[5], p[4]],
    [p[1], p[2], p[6], p[5]], [p[2], p[3], p[7], p[6]], [p[3], p[0], p[4], p[7]]], work);
}

/** Closest point on a nondegenerate triangle, including all edge/vertex Voronoi regions. */
function pointTriangle(p: Vec3, [a, b, c]: Triangle): Vec3 {
  const ab = sub(b, a); const ac = sub(c, a); const ap = sub(p, a);
  const d1 = dot(ab, ap); const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b); const d3 = dot(ab, bp); const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c); const d5 = dot(ab, cp); const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const inverse = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * inverse), scale(ac, vc * inverse)));
}
function segmentSegment(p: Vec3, q: Vec3, a: Vec3, b: Vec3): [Vec3, Vec3] {
  const d = sub(q, p); const e = sub(b, a); const r = sub(p, a);
  const dd = dot(d, d); const ee = dot(e, e); const de = dot(d, e); const dr = dot(d, r); const er = dot(e, r);
  const denominator = dd * ee - de * de;
  let s = denominator > 1e-30 ? clamp((de * er - dr * ee) / denominator) : 0;
  let t = (de * s + er) / ee;
  if (t < 0) { t = 0; s = clamp(-dr / dd); }
  if (t > 1) { t = 1; s = clamp((de - dr) / dd); }
  return [add(p, scale(d, s)), add(a, scale(e, t))];
}
function segmentTriangle(p: Vec3, q: Vec3, [a, b, c]: Triangle): { point: Vec3; proper: boolean } | null {
  const d = sub(q, p); const e = sub(b, a); const f = sub(c, a); const h = cross(d, f); const determinant = dot(e, h);
  if (Math.abs(determinant) < 1e-14 * norm(d) * norm(e) * norm(f)) return null;
  const r = sub(p, a); const u = dot(r, h) / determinant; const k = cross(r, e);
  const v = dot(d, k) / determinant; const t = dot(f, k) / determinant;
  const tolerance = 1e-10;
  if (u < -tolerance || v < -tolerance || u + v > 1 + tolerance || t < -tolerance || t > 1 + tolerance) return null;
  return { point: add(p, scale(d, clamp(t))), proper: u > tolerance && v > tolerance && u + v < 1 - tolerance && t > tolerance && t < 1 - tolerance };
}
type Witness = { distance: number; subject: Vec3; obstacle: Vec3; crossing: boolean };
function triangleDistance(a: Triangle, b: Triangle): Witness {
  let best: Witness = { distance: Infinity, subject: a[0], obstacle: b[0], crossing: false };
  const offer = (p: Vec3, q: Vec3): void => { const distance = norm(sub(p, q)); if (distance < best.distance) best = { distance, subject: p, obstacle: q, crossing: best.crossing }; };
  const edges = (t: Triangle): [Vec3, Vec3][] => [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
  for (const [p, q] of edges(a)) { const hit = segmentTriangle(p, q, b); if (hit) { offer(hit.point, hit.point); best.crossing ||= hit.proper; } }
  for (const [p, q] of edges(b)) { const hit = segmentTriangle(p, q, a); if (hit) { offer(hit.point, hit.point); best.crossing ||= hit.proper; } }
  for (const p of a) offer(p, pointTriangle(p, b));
  for (const q of b) offer(pointTriangle(q, a), q);
  for (const [p, q] of edges(a)) for (const [x, y] of edges(b)) { const [s, t] = segmentSegment(p, q, x, y); offer(s, t); }
  return best;
}
type Tree = { kind: 'leaf'; bounds: GeometryBounds; triangles: Triangle[] }
  | { kind: 'branch'; bounds: GeometryBounds; left: Tree; right: Tree };
function tree(triangles: Triangle[], work: GeometryWork): Tree {
  work.tick(triangles.length);
  const bounds = boundsOf(triangles.flatMap(t => [...t]));
  if (triangles.length <= 8) return { kind: 'leaf', bounds, triangles };
  const spans = bounds.max.map((n, i) => n - bounds.min[i]);
  const axis = spans.indexOf(Math.max(...spans));
  const ordered = [...triangles].sort((a, b) => (a[0][axis] + a[1][axis] + a[2][axis]) - (b[0][axis] + b[1][axis] + b[2][axis]));
  const middle = Math.floor(ordered.length / 2);
  return { kind: 'branch', bounds, left: tree(ordered.slice(0, middle), work), right: tree(ordered.slice(middle), work) };
}
/** Winding number, not a ray whose vertex/edge hits can double-count. Open meshes have no inside predicate. */
export function pointInside(point: Vec3, shape: GeometryShape, work: GeometryWork): boolean {
  return shape.meshes.some(mesh => {
    if (!mesh.closed) return false;
    let angle = 0;
    for (const triangle of mesh.triangles) {
      work.tick();
      const [a, b, c] = triangle.map(p => sub(p, point));
      const denominator = norm(a) * norm(b) * norm(c) + dot(a, b) * norm(c) + dot(b, c) * norm(a) + dot(c, a) * norm(b);
      angle += 2 * Math.atan2(dot(a, cross(b, c)), denominator);
    }
    return Math.abs(angle) > 2 * Math.PI;
  });
}
export type ShapeMeasurement = Witness & { relation: 'separated' | 'subject-inside' | 'obstacle-inside' | 'volume-overlap' | 'contact-or-overlap' | 'unknown'; closed: boolean };
export function measureShapes(subject: GeometryShape, obstacle: GeometryShape, work: GeometryWork, maxPairs: number): ShapeMeasurement {
  const a = tree(subject.meshes.flatMap(mesh => mesh.triangles), work); const b = tree(obstacle.meshes.flatMap(mesh => mesh.triangles), work);
  let best: Witness = { distance: Infinity, subject: subject.bounds.min, obstacle: obstacle.bounds.min, crossing: false };
  let pairs = 0;
  const pending: [Tree, Tree][] = [[a, b]];
  while (pending.length) {
    work.tick();
    const pair = pending.pop(); if (!pair) break;
    const [x, y] = pair;
    if (boundsDistance(x.bounds, y.bounds) > best.distance + NUMERIC_TOLERANCE_METRES) continue;
    if (x.kind === 'leaf' && y.kind === 'leaf') {
      for (const p of x.triangles) for (const q of y.triangles) {
        work.tick(); if (++pairs > maxPairs) throw new GeometryLimitError('budget');
        const hit = triangleDistance(p, q);
        if (hit.distance < best.distance) best = { ...hit, crossing: best.crossing || hit.crossing };
        else best.crossing ||= hit.crossing;
      }
    } else if (x.kind === 'branch') { pending.push([x.left, y], [x.right, y]); }
    else if (y.kind === 'branch') { pending.push([x, y.left], [x, y.right]); }
  }
  const closed = subject.meshes.every(mesh => mesh.closed) && obstacle.meshes.every(mesh => mesh.closed);
  if (!closed) return { ...best, relation: best.distance <= NUMERIC_TOLERANCE_METRES ? 'contact-or-overlap' : 'unknown', closed };
  if (best.distance <= NUMERIC_TOLERANCE_METRES) return { ...best, distance: 0,
    relation: best.crossing ? 'volume-overlap' : 'contact-or-overlap', closed };
  // With disjoint boundaries, each connected component has constant containment. Check every mesh component vertex.
  // Checking every triangle vertex also handles disconnected shells in a single converted mesh.
  let anySubject = false; let allSubject = true; let anyObstacle = false; let allObstacle = true;
  let containedPoint: Vec3 | null = null;
  for (const mesh of subject.meshes) for (const triangle of mesh.triangles) for (const p of triangle) {
    const inside = pointInside(p, obstacle, work); anySubject ||= inside; allSubject &&= inside; if (inside) containedPoint = p;
  }
  for (const mesh of obstacle.meshes) for (const triangle of mesh.triangles) for (const p of triangle) {
    const inside = pointInside(p, subject, work); anyObstacle ||= inside; allObstacle &&= inside; if (inside) containedPoint = p;
  }
  const relation = allSubject ? 'subject-inside' : allObstacle ? 'obstacle-inside' : anySubject || anyObstacle ? 'volume-overlap' : 'separated';
  return containedPoint ? { distance: 0, subject: containedPoint, obstacle: containedPoint, crossing: false, relation, closed }
    : { ...best, relation, closed };
}
