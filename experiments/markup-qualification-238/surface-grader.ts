import type { SpatialMarkup } from '../../src/spatial-markup.ts';
import type { Footprint } from './grader.ts';
import { TOLERANCE_METRES } from './grader.ts';

type WallGrade = { kind: 'unsupported'; reason: string } | { kind: 'supported'; value: boolean; gapMetres: number;
  centeringErrorMetres: number; sameSide: boolean; below: boolean; floor: boolean; withinWidth: boolean };
/** Independent analytic check for the declared floor-standing/below-wall case on the zero-elevation model floor. */
export function gradeBelowWall(input: { markup: SpatialMarkup; footprint: Footprint; heightMetres: number; gapMetres: number }): WallGrade {
  const { markup, footprint, heightMetres, gapMetres } = input;
  if (markup.kind !== 'rectangle' || footprint.kind !== 'oriented-rectangle') return { kind: 'unsupported', reason: 'Expected a wall rectangle and a rectangular footprint.' };
  const [a, b, , d] = markup.corners;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const nx = (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0);
  const ny = (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0);
  const nz = (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0);
  const norm = Math.hypot(nx, ny, nz);
  if (norm < 1e-10 || Math.abs(nz / norm) > 1e-10) return { kind: 'unsupported', reason: 'The reference must be a vertical wall plane.' };
  const normal = [nx / norm, ny / norm];
  const widthAxis = [-ny / norm, nx / norm];
  const project = (p: readonly number[], axis: readonly number[]) => ((p[0] ?? 0) - a[0]) * (axis[0] ?? 0) + ((p[1] ?? 0) - a[1]) * (axis[1] ?? 0);
  const widthPositions = markup.corners.map(p => project(p, widthAxis));
  const lo = Math.min(...widthPositions); const hi = Math.max(...widthPositions);
  const c = Math.cos(footprint.yawRadians); const s = Math.sin(footprint.yawRadians);
  const vertices = [-1, 1].flatMap(x => [-1, 1].map(y => {
    const dx = x * footprint.widthMetres / 2; const dy = y * footprint.depthMetres / 2;
    return [footprint.center[0] + dx * c - dy * s, footprint.center[1] + dx * s + dy * c];
  }));
  const signed = vertices.map(p => project(p, normal));
  const sameSide = Math.min(...signed) >= 0 || Math.max(...signed) <= 0;
  const gap = Math.min(...signed.map(Math.abs));
  const centeringError = Math.abs(project(footprint.center, widthAxis) - (lo + hi) / 2);
  const below = footprint.center[2] + heightMetres <= Math.min(...markup.corners.map(p => p[2])) + TOLERANCE_METRES;
  const floor = Math.abs(footprint.center[2]) <= TOLERANCE_METRES;
  const withinWidth = vertices.every(p => project(p, widthAxis) >= lo - TOLERANCE_METRES && project(p, widthAxis) <= hi + TOLERANCE_METRES);
  return { kind: 'supported', value: sameSide && Math.abs(gap - gapMetres) <= TOLERANCE_METRES && centeringError <= TOLERANCE_METRES && below && floor && withinWidth,
    gapMetres: gap, centeringErrorMetres: centeringError, sameSide, below, floor, withinWidth };
}
