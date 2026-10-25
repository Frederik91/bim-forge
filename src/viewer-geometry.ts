import { entityLevel, roofHeightAt, stairFootprint } from './building-levels.ts';
import type { Bounds, ModelGraph, Point, Slab, Wall } from './room-model.ts';

/** Disjoint solid rectangles; voids have one source of truth: incoming stairs. */
export function slabPieces(snapshot: ModelGraph, slab: Slab): Bounds[] {
  let pieces = [slab.bounds];
  for (const stair of [...snapshot.entities].sort((a, b) => a.id.localeCompare(b.id))) {
    if (stair.type !== 'Stair' || stair.toLevelId !== slab.levelId) continue;
    const hole = stairFootprint(stair);
    pieces = pieces.flatMap((b) => {
      const minX = Math.max(b.minX, hole.minX); const maxX = Math.min(b.maxX, hole.maxX);
      const minY = Math.max(b.minY, hole.minY); const maxY = Math.min(b.maxY, hole.maxY);
      if (minX >= maxX || minY >= maxY) return [b];
      return [
        { minX: b.minX, maxX: minX, minY: b.minY, maxY: b.maxY },
        { minX: maxX, maxX: b.maxX, minY: b.minY, maxY: b.maxY },
        { minX, maxX, minY: b.minY, maxY: minY },
        { minX, maxX, minY: maxY, maxY: b.maxY },
      ].filter((part) => part.maxX > part.minX && part.maxY > part.minY);
    });
  }
  return pieces;
}

export interface WallSection { start: number; end: number; bottom: number; startTop: number; endTop: number }

/** Piecewise-linear roof clipping, including ridge and nominal-height crossings. */
export function wallSections(snapshot: ModelGraph, wall: Wall, start: number, end: number, bottom: number, top: number): WallSection[] {
  if (end - start < 1e-8 || top - bottom < 1e-8) return [];
  const level = entityLevel(snapshot, wall);
  const dx = wall.end[0] - wall.start[0]; const dy = wall.end[1] - wall.start[1];
  const length = Math.hypot(dx, dy);
  const point = (along: number): Point => [wall.start[0] + dx * along / length, wall.start[1] + dy * along / length];
  const cuts = new Set([start, end]);
  for (const roof of snapshot.entities) {
    if (roof.type !== 'Roof' || roof.levelId !== level?.id) continue;
    const add = (coordinate: number, axis: 0 | 1): void => {
      const delta = axis === 0 ? dx : dy;
      if (delta === 0) return;
      const along = (coordinate - wall.start[axis]) * length / delta;
      if (along > start && along < end) cuts.add(along);
    };
    add(roof.bounds.minX, 0); add(roof.bounds.maxX, 0);
    add(roof.bounds.minY, 1); add(roof.bounds.maxY, 1);
    if (roof.profile.kind === 'gable') {
      if (roof.profile.ridgeAxis === 'x') add((roof.bounds.minY + roof.bounds.maxY) / 2, 1);
      else add((roof.bounds.minX + roof.bounds.maxX) / 2, 0);
    }
  }
  const height = (along: number): number => level ? roofHeightAt(snapshot, level.id, point(along)) : Infinity;
  const ordered = [...cuts].sort((a, b) => a - b);
  const sections: WallSection[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const a = ordered[i - 1]; const b = ordered[i];
    // Sample just inside each roof interval, avoiding an adjacent roof's boundary.
    const inset = Math.min(1e-7, (b - a) / 4);
    const h0 = height(a + inset); const h1 = height(b - inset);
    const slope = Number.isFinite(h0) && Number.isFinite(h1) ? (h1 - h0) / (b - a - 2 * inset) : 0;
    const at = (x: number): number => Number.isFinite(h0) ? h0 + slope * (x - a - inset) : Infinity;
    const splits = [a, b];
    if (slope !== 0) for (const limit of [bottom, top]) {
      const crossing = a + inset + (limit - h0) / slope;
      if (crossing > a && crossing < b) splits.push(crossing);
    }
    splits.sort((x, y) => x - y);
    for (let j = 1; j < splits.length; j += 1) {
      const x = splits[j - 1]; const y = splits[j];
      const startTop = Math.max(bottom, Math.min(top, at(x)));
      const endTop = Math.max(bottom, Math.min(top, at(y)));
      if (y - x > 1e-8 && Math.max(startTop, endTop) - bottom > 1e-8) sections.push({ start: x, end: y, bottom, startTop, endTop });
    }
  }
  return sections;
}
