import type { Bounds, Entity, ModelGraph, Point, Wall } from '../src/room-model.ts';
import { furnitureFootprint } from '../src/room-model.ts';
import { levelView, levels, stairFootprint } from '../src/building-levels.ts';
import { assetFootprint } from '../src/asset-family.ts';
import type { GeometryRef } from '../src/geometry-contract.ts';
import type { SpatialTokens } from './ui/design-tokens.ts';

export type PlanPoint = readonly [number, number];
export type PlanProjectPoint = readonly [number, number, number];
export type PlanSource = Readonly<Pick<Extract<GeometryRef, { kind: 'native' }>, 'projectId' | 'target' | 'revisionId'>> & {
  readonly snapshot: ModelGraph;
};
export type PlanTokens = {
  readonly color: Readonly<Pick<SpatialTokens['color'], 'drawingPaper' | 'drawingInk' | 'drawingMuted' | 'drawingOutline'
    | 'wall' | 'floor' | 'furniture' | 'furnitureOutline' | 'existing' | 'proposed' | 'proposedFill' | 'selection' | 'selectionFill'>>;
  readonly drafting: Readonly<SpatialTokens['drafting']>;
  readonly font: Readonly<Pick<SpatialTokens['font'], 'drawing'>>;
};
export interface PlanInput {
  readonly source: PlanSource;
  /** Explicit null is the historical single-floor graph; never silently choose another level. */
  readonly levelId: string | null;
  readonly viewport: { readonly width: number; readonly height: number; readonly bounds?: Readonly<Bounds> };
  readonly comparison: PlanSource | null;
  readonly selectedTargets: readonly GeometryRef[];
  readonly tokens: PlanTokens;
}
export type PlanRepresentation = 'native-footprint' | 'hosted-opening-symbol' | 'footprint-proxy' | 'roof-projection';
export interface PlanHit {
  readonly ref: Extract<GeometryRef, { kind: 'native' }>;
  readonly levelId: string | null;
  readonly revisionRole: 'current' | 'existing';
  readonly representation: PlanRepresentation;
  readonly name: string;
}
interface PlanStyle { readonly stroke: string; readonly fill: string; readonly width: number; readonly dash: string }
export type PlanPrimitive =
  | { readonly kind: 'path'; readonly points: readonly PlanPoint[]; readonly closed: boolean; readonly style: PlanStyle; readonly hit: PlanHit | null }
  | { readonly kind: 'text'; readonly at: PlanPoint; readonly text: string; readonly size: number; readonly color: string; readonly angle: number; readonly anchor: 'start' | 'middle' | 'end' };
interface HitShape { readonly points: readonly PlanPoint[]; readonly closed: boolean; readonly priority: number; readonly hit: PlanHit }
export interface PlanProjection {
  readonly bounds: Readonly<Bounds>;
  readonly pixelsPerMetre: number;
  readonly elevation: number;
  project(point: PlanProjectPoint): PlanPoint;
  /** Input is SVG viewBox space, not browser client coordinates. */
  inverse(point: PlanPoint): { readonly point: PlanProjectPoint; readonly projectId: string; readonly revisionId: string; readonly levelId: string | null };
}
export interface ModelPlan {
  readonly width: number;
  readonly height: number;
  readonly source: PlanSource;
  readonly levelId: string | null;
  readonly levelName: string;
  readonly projection: PlanProjection;
  readonly primitives: readonly PlanPrimitive[];
  readonly hitShapes: readonly HitShape[];
  readonly dimensions: readonly { readonly datum: 'wall-axes' | 'opening'; readonly metres: number; readonly ref: PlanHit['ref'] | null }[];
  readonly scaleBar: { readonly metres: number; readonly pixels: number };
  readonly notices: readonly string[];
  readonly tokens: PlanTokens;
}

const corners = (b: Readonly<Bounds>): Point[] => [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
const offset = (a: PlanPoint, u: PlanPoint, distance: number): Point => [a[0] + u[0] * distance, a[1] + u[1] * distance];
const metric = (metres: number): string => `${Math.round(metres * 1000).toLocaleString('en-GB')} mm`;
function wallFrame(wall: Wall): { length: number; unit: Point; normal: Point } {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  if (!(length > 0)) throw new Error('Plan requires nonzero native wall length.');
  const unit: Point = [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length];
  return { length, unit, normal: [-unit[1], unit[0]] };
}
function band(start: PlanPoint, end: PlanPoint, normal: PlanPoint, thickness: number): Point[] {
  return [offset(start, normal, thickness / 2), offset(end, normal, thickness / 2),
    offset(end, normal, -thickness / 2), offset(start, normal, -thickness / 2)];
}
function graphAt(source: PlanSource, levelId: string | null): ModelGraph {
  if (levelId !== null) return levelView(source.snapshot, levelId);
  if (levels(source.snapshot).length) throw new Error('Select an explicit native level.');
  return source.snapshot;
}
function footprint(graph: ModelGraph, entity: Entity): Point[] {
  switch (entity.type) {
    case 'Wall': { const f = wallFrame(entity); return band(entity.start, entity.end, f.normal, entity.thickness); }
    case 'Furniture': return corners(furnitureFootprint(entity));
    case 'Equipment': return corners({ minX: entity.position[0] - entity.width / 2, maxX: entity.position[0] + entity.width / 2,
      minY: entity.position[1] - entity.depth / 2, maxY: entity.position[1] + entity.depth / 2 });
    case 'AssetInstance': return corners(assetFootprint(graph, entity));
    case 'Stair': return corners(stairFootprint(entity));
    case 'Space': case 'Slab': case 'Roof': return corners(entity.bounds);
    case 'Door': case 'Window': case 'Level': case 'AssetFamily': return [];
    default: { const unreachable: never = entity; return unreachable; }
  }
}
function sameTarget(a: GeometryRef, b: PlanSource, entityId: string): boolean {
  return a.kind === 'native' && a.projectId === b.projectId && a.revisionId === b.revisionId && a.entityId === entityId
    && a.target.kind === b.target.kind && (a.target.kind === 'main' || b.target.kind !== 'main' && a.target.id === b.target.id);
}

/** Read-only native horizontal profiles and conventional opening symbols; never a general section kernel. */
export function createModelPlan(input: PlanInput): ModelPlan {
  const { source, comparison, levelId, viewport, tokens } = input;
  if (![viewport.width, viewport.height].every(Number.isFinite) || viewport.width < 240 || viewport.height < 280) {
    throw new Error('Plan viewport must be finite and at least 240 × 280 screen units.');
  }
  if (comparison && comparison.projectId !== source.projectId) throw new Error('Plan comparison must belong to the same project.');
  const graph = graphAt(source, levelId);
  const oldGraph = comparison && (levelId === null || levels(comparison.snapshot).some(level => level.id === levelId))
    ? graphAt(comparison, levelId) : null;
  const level = levels(source.snapshot).find(item => item.id === levelId);
  const elevation = level?.elevation ?? 0;
  const allPoints = [...graph.entities.flatMap(item => footprint(graph, item)),
    ...(oldGraph ? oldGraph.entities.flatMap(item => footprint(oldGraph, item)) : [])];
  const empty = allPoints.length === 0;
  const bounds = viewport.bounds ?? (empty ? { minX: -1, maxX: 1, minY: -1, maxY: 1 } : {
    minX: Math.min(...allPoints.map(p => p[0])), maxX: Math.max(...allPoints.map(p => p[0])),
    minY: Math.min(...allPoints.map(p => p[1])), maxY: Math.max(...allPoints.map(p => p[1])),
  });
  if (!Object.values(bounds).every(Number.isFinite) || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) {
    throw new Error('Plan bounds must be finite with positive spans.');
  }
  const marginX = viewport.width < 500 ? 48 : 72;
  const scale = Math.min((viewport.width - marginX * 2) / (bounds.maxX - bounds.minX),
    (viewport.height - 166) / (bounds.maxY - bounds.minY));
  const cx = (bounds.minX + bounds.maxX) / 2; const cy = (bounds.minY + bounds.maxY) / 2;
  const screenCx = viewport.width / 2; const screenCy = (viewport.height - 16) / 2;
  const project = ([x, y]: readonly number[]): PlanPoint => [screenCx + (x - cx) * scale, screenCy - (y - cy) * scale];
  const projection: PlanProjection = {
    bounds: { ...bounds }, pixelsPerMetre: scale, elevation,
    project: point => {
      if (!point.every(Number.isFinite)) throw new Error('Plan point must be finite.');
      return project(point);
    },
    inverse: point => {
      if (!point.every(Number.isFinite)) throw new Error('Plan screen point must be finite.');
      return { point: [cx + (point[0] - screenCx) / scale, cy - (point[1] - screenCy) / scale, elevation],
        projectId: source.projectId, revisionId: source.revisionId, levelId };
    },
  };
  const primitives: PlanPrimitive[] = []; const hitShapes: HitShape[] = [];
  const dimensions: ModelPlan['dimensions'][number][] = [];
  const { color: c, drafting: d } = tokens;
  const text = (at: PlanPoint, content: string, color: string = c.drawingMuted, angle = 0,
    anchor: 'start' | 'middle' | 'end' = 'middle'): void => {
    primitives.push({ kind: 'text', at, text: content, size: d.dimensionText, color, angle, anchor });
  };
  const path = (points: readonly PlanPoint[], closed: boolean, stroke: string, fill = 'none', width: number = d.detail,
    dash = '', hit: PlanHit | null = null, priority = 0): void => {
    primitives.push({ kind: 'path', points, closed, style: { stroke, fill, width, dash }, hit });
    if (hit) hitShapes.push({ points, closed, priority, hit });
  };
  const line = (a: PlanPoint, b: PlanPoint, color: string = c.drawingOutline, width: number = d.detail, dash = ''): void => path([a, b], false, color, 'none', width, dash);
  const dimension = (a: PlanPoint, b: PlanPoint, metres: number, color: string, datum: 'wall-axes' | 'opening', ref: PlanHit['ref'] | null,
    label = metric(metres)): void => {
    line(a, b, color, d.dimension);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u: PlanPoint = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    for (const p of [a, b]) line([p[0] - u[0] * 3 + u[1] * 4, p[1] - u[1] * 3 - u[0] * 4],
      [p[0] + u[0] * 3 - u[1] * 4, p[1] + u[1] * 3 + u[0] * 4], color, d.dimension);
    let angle = Math.atan2(u[1], u[0]) * 180 / Math.PI;
    if (angle > 90 || angle < -90) angle += 180;
    text([(a[0] + b[0]) / 2 + u[1] * 10, (a[1] + b[1]) / 2 - u[0] * 10], label, color, angle);
    dimensions.push({ datum, metres, ref });
  };
  const refFor = (pin: PlanSource, item: Entity): PlanHit['ref'] => ({ kind: 'native', projectId: pin.projectId,
    target: pin.target, revisionId: pin.revisionId, entityId: item.id });
  function draw(pin: PlanSource, model: ModelGraph, ghost: boolean): void {
    const oldItems = new Map(oldGraph?.entities.map(item => [item.id, item]));
    const oldLinks = new Map(oldGraph?.relationships.map(link => [link.source, link]));
    const changed = (item: Entity): boolean => !ghost && Boolean(comparison)
      && (JSON.stringify(item) !== JSON.stringify(oldItems.get(item.id))
        || JSON.stringify(model.relationships.find(link => link.source === item.id)) !== JSON.stringify(oldLinks.get(item.id)));
    const hitFor = (item: Entity, representation: PlanRepresentation): PlanHit => ({ ref: refFor(pin, item), levelId,
      revisionRole: ghost ? 'existing' : 'current', representation, name: item.name });
    const ink = (item: Entity): string => ghost ? c.existing : input.selectedTargets.some(target => sameTarget(target, pin, item.id))
      ? c.selection : changed(item) ? c.proposed : c.drawingInk;
    const dash = ghost ? d.existingDash : '';
    const width = ghost ? d.existing : d.outline;
    const objects = [...model.entities].sort((a, b) => {
      const priority = (e: Entity): number => e.type === 'Slab' ? 0 : e.type === 'Space' ? 1 : e.type === 'Wall' ? 3 : e.type === 'Roof' ? 2 : 4;
      return priority(a) - priority(b);
    });
    for (const item of objects) {
      if (ghost) {
        const current = graph.entities.find(entity => entity.id === item.id);
        const currentLink = graph.relationships.find(link => link.source === item.id);
        const priorLink = model.relationships.find(link => link.source === item.id);
        if (JSON.stringify(current) === JSON.stringify(item) && JSON.stringify(currentLink) === JSON.stringify(priorLink)) continue;
      }
      const hit = hitFor(item, item.type === 'AssetInstance' || item.type === 'Equipment' || item.type === 'Furniture'
        ? 'footprint-proxy' : item.type === 'Roof' ? 'roof-projection' : 'native-footprint');
      switch (item.type) {
        case 'Slab': case 'Space': {
          path(corners(item.bounds).map(project), true, ghost ? c.existing : c.drawingOutline,
            ghost ? 'none' : c.floor, width, dash, hit, item.type === 'Space' ? 10 : 0);
          break;
        }
        case 'Wall': {
          const f = wallFrame(item);
          const openings = model.relationships.filter(link => link.target === item.id).map(link => {
            const opening = model.entities.find(entity => entity.id === link.source);
            return opening && (opening.type === 'Door' || opening.type === 'Window') ? { start: link.offset, end: link.offset + opening.width } : null;
          }).filter(item => item !== null).sort((a, b) => a.start - b.start);
          let at = 0;
          for (const gap of [...openings, { start: f.length, end: f.length }]) {
            if (gap.start > at) path(band(offset(item.start, f.unit, at), offset(item.start, f.unit, gap.start), f.normal, item.thickness).map(project),
              true, ink(item), ghost ? 'none' : changed(item) ? c.proposedFill : c.wall, ghost ? width : d.cut, dash, hit, 30);
            at = Math.max(at, gap.end);
          }
          break;
        }
        case 'Door': case 'Window': {
          const link = model.relationships.find(link => link.source === item.id && link.type === 'hosted-by');
          const wall = model.entities.find(entity => entity.id === link?.target);
          if (!link || wall?.type !== 'Wall') break;
          const { unit, normal } = wallFrame(wall);
          const hinge = offset(wall.start, unit, link.offset); const jamb = offset(hinge, unit, item.width);
          const openingHit = hitFor(item, 'hosted-opening-symbol');
          const profile = band(hinge, jamb, normal, wall.thickness);
          path(profile.map(project), true, ink(item), 'none', width, dash, openingHit, 50);
          if (item.type === 'Door') {
            const leaf = offset(hinge, normal, item.width);
            line(project(hinge), project(leaf), ink(item), ghost ? width : d.selected, dash);
            const arc = Array.from({ length: 25 }, (_, i) => {
              const angle = i * Math.PI / 48;
              return project([hinge[0] + item.width * (unit[0] * Math.cos(angle) + normal[0] * Math.sin(angle)),
                hinge[1] + item.width * (unit[1] * Math.cos(angle) + normal[1] * Math.sin(angle))]);
            });
            path(arc, false, ink(item), 'none', d.detail, dash);
          } else {
            for (const distance of [-wall.thickness / 3, 0, wall.thickness / 3]) line(project(offset(hinge, normal, distance)),
              project(offset(jamb, normal, distance)), ink(item), d.detail, dash);
          }
          if (!ghost && (changed(item) || input.selectedTargets.some(target => sameTarget(target, pin, item.id)))) {
            const a = offset(project(hinge), [normal[0], -normal[1]], -23);
            const b = offset(project(jamb), [normal[0], -normal[1]], -23);
            const prior = oldItems.get(item.id);
            const label = prior && (prior.type === 'Door' || prior.type === 'Window')
              ? `${Math.round(prior.width * 1000)} → ${Math.round(item.width * 1000)} mm` : metric(item.width);
            dimension(a, b, item.width, ink(item), 'opening', refFor(pin, item), label);
          }
          break;
        }
        case 'Furniture': case 'Equipment': case 'AssetInstance': {
          const pts = footprint(model, item).map(project);
          path(pts, true, ink(item) === c.drawingInk ? c.furnitureOutline : ink(item), ghost ? 'none' : c.furniture, width, dash, hit, 40);
          if (!ghost && item.type === 'Furniture') {
            const b = furnitureFootprint(item);
            if (item.kind === 'plant') {
              const radius = Math.min(item.width, item.depth) / 2;
              path(Array.from({ length: 17 }, (_, i) => project([item.position[0] + Math.cos(i * Math.PI / 8) * radius,
                item.position[1] + Math.sin(i * Math.PI / 8) * radius])), false, c.furnitureOutline);
            } else if (item.kind === 'bed' || item.kind === 'sofa' || item.kind === 'desk' || item.kind === 'table') {
              const inset = Math.min(b.maxX - b.minX, b.maxY - b.minY) * .12;
              path(corners({ minX: b.minX + inset, maxX: b.maxX - inset, minY: b.minY + inset, maxY: b.maxY - inset }).map(project), true, c.furnitureOutline);
              if (item.kind === 'bed' || item.kind === 'sofa') line(project([b.minX + inset, b.maxY - inset * 3]), project([b.maxX - inset, b.maxY - inset * 3]), c.furnitureOutline);
            }
          }
          break;
        }
        case 'Stair': {
          const b = stairFootprint(item); const horizontal = item.start[1] === item.end[1];
          path(corners(b).map(project), true, ink(item), ghost ? 'none' : c.floor, width, dash, hit, 20);
          for (let step = 1; step < item.steps; step++) {
            const at = offset(item.start, [item.end[0] - item.start[0], item.end[1] - item.start[1]], step / item.steps);
            line(project(horizontal ? [at[0], b.minY] : [b.minX, at[1]]), project(horizontal ? [at[0], b.maxY] : [b.maxX, at[1]]), ink(item), d.detail, dash);
          }
          if (!ghost) text(project([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]), item.toLevelId === levelId ? 'DOWN' : 'UP', ink(item));
          break;
        }
        case 'Roof': {
          path(corners(item.bounds).map(project), true, ink(item), 'none', width, d.regionDash, hit, -1);
          const b = item.bounds;
          if (item.profile.kind === 'gable') line(project(item.profile.ridgeAxis === 'x' ? [b.minX, (b.minY + b.maxY) / 2] : [(b.minX + b.maxX) / 2, b.minY]),
            project(item.profile.ridgeAxis === 'x' ? [b.maxX, (b.minY + b.maxY) / 2] : [(b.minX + b.maxX) / 2, b.maxY]), ink(item), d.detail, d.regionDash);
          break;
        }
        case 'Level': case 'AssetFamily': break;
        default: { const unreachable: never = item; throw new Error(`Unsupported native Plan entity: ${unreachable}`); }
      }
    }
  }
  draw(source, graph, false);
  if (comparison && oldGraph) draw(comparison, oldGraph, true);
  for (const room of graph.entities.filter(entity => entity.type === 'Space')) {
    const b = room.bounds; const p = project([(b.minX + b.maxX) / 2, b.maxY - (b.maxY - b.minY) * .25]);
    const roomWidth = (b.maxX - b.minX) * scale;
    const maxCharacters = Math.max(6, Math.floor(roomWidth / 7));
    const words = room.name.split(' '); let label = ''; const lines: string[] = [];
    for (const word of words) {
      if (label && `${label} ${word}`.length > maxCharacters) { lines.push(label); label = ''; }
      label = label ? `${label} ${word}` : word;
    }
    if (label) lines.push(label);
    lines.forEach((label, i) => text([p[0], p[1] + i * 16], label, c.drawingInk));
    text([p[0], p[1] + lines.length * 16], `${((b.maxX - b.minX) * (b.maxY - b.minY)).toFixed(1)} m²`);
  }
  const walls = graph.entities.filter(entity => entity.type === 'Wall');
  if (walls.length) {
    const pts = walls.flatMap(wall => [wall.start, wall.end]);
    const minX = Math.min(...pts.map(p => p[0])); const maxX = Math.max(...pts.map(p => p[0]));
    const minY = Math.min(...pts.map(p => p[1])); const maxY = Math.max(...pts.map(p => p[1]));
    const leftTop = project([minX, maxY]); const rightBottom = project([maxX, minY]);
    if (maxX > minX) {
      for (const x of [leftTop[0], rightBottom[0]]) line([x, leftTop[1] - 6], [x, leftTop[1] - 35]);
      dimension([leftTop[0], leftTop[1] - 29], [rightBottom[0], leftTop[1] - 29], maxX - minX, c.drawingMuted, 'wall-axes', null);
    }
    if (maxY > minY) {
      for (const y of [leftTop[1], rightBottom[1]]) line([leftTop[0] - 6, y], [leftTop[0] - 35, y]);
      dimension([leftTop[0] - 29, rightBottom[1]], [leftTop[0] - 29, leftTop[1]], maxY - minY, c.drawingMuted, 'wall-axes', null);
    }
  }
  const rawScale = 70 / scale;
  const power = 10 ** Math.floor(Math.log10(rawScale));
  const scaleMetres = [1, 2, 5, 10].map(n => n * power).filter(n => n <= rawScale).at(-1) ?? power;
  const scalePixels = scaleMetres * scale; const scaleY = viewport.height - 26;
  line([22, scaleY], [22 + scalePixels, scaleY], c.drawingInk, d.selected);
  for (const x of [22, 22 + scalePixels]) line([x, scaleY - 4], [x, scaleY + 4], c.drawingInk);
  text([22, scaleY - 12], `${scaleMetres} m`, c.drawingInk, 0, 'start');
  const northX = viewport.width - 25;
  path([[northX - 4, scaleY - 7], [northX, scaleY - 17], [northX + 4, scaleY - 7]], false, c.drawingInk);
  line([northX, scaleY - 17], [northX, scaleY + 1], c.drawingInk);
  text([northX, scaleY - 24], 'Y / N', c.drawingInk);
  text([16, 22], `${level?.name ?? 'Native Plan'} · ${elevation.toFixed(2)} m`, c.drawingInk, 0, 'start');
  text([viewport.width / 2, viewport.height - 5], 'Wall axes · mm', c.drawingMuted);
  const notices = ['Native footprints and conventional opening swings; furniture/equipment/assets are footprint proxies.',
    'Linked IFC Plan cuts and true Section are unsupported. North is project +Y, not a georeference.'];
  if (empty) { notices.push('No supported native geometry on this level.'); text([viewport.width / 2, viewport.height / 2], 'No native geometry'); }
  if (comparison && !oldGraph) notices.push('Comparison level unavailable; no existing geometry substituted.');
  if (comparison) {
    text([viewport.width - 16, 22], 'Existing', c.existing, 0, 'end');
    text([viewport.width - 16, 40], 'Proposed / selected', c.proposed, 0, 'end');
  }
  return { width: viewport.width, height: viewport.height, source, levelId, levelName: level?.name ?? 'Native Plan',
    projection, primitives, hitShapes, dimensions, scaleBar: { metres: scaleMetres, pixels: scalePixels }, notices, tokens };
}

function segmentDistance(p: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function contains(p: PlanPoint, points: readonly PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]; const b = points[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** All overlapping source-qualified candidates, current before existing, then openings/objects before context. */
export function hitTestModelPlan(plan: ModelPlan, point: PlanPoint, tolerancePx = 4): readonly PlanHit[] {
  if (!point.every(Number.isFinite) || !Number.isFinite(tolerancePx) || tolerancePx < 0) throw new Error('Invalid Plan hit coordinates or tolerance.');
  if (point[0] < 0 || point[1] < 0 || point[0] > plan.width || point[1] > plan.height) return [];
  const seen = new Set<string>();
  return plan.hitShapes.filter(shape => shape.closed && contains(point, shape.points) || shape.points.some((p, index) => {
    const next = shape.points[index + 1] ?? (shape.closed ? shape.points[0] : p);
    return segmentDistance(point, p, next) <= tolerancePx;
  })).sort((a, b) => Number(a.hit.revisionRole === 'existing') - Number(b.hit.revisionRole === 'existing') || b.priority - a.priority)
    .flatMap(shape => {
      const key = JSON.stringify(shape.hit.ref);
      if (seen.has(key)) return [];
      seen.add(key); return [shape.hit];
    });
}

/** Renderer has no routing or event ownership. Use inverse()/hitTestModelPlan() from the integrating shell. */
export function renderModelPlan(document: Document, plan: ModelPlan): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${plan.width} ${plan.height}`);
  svg.setAttribute('width', String(plan.width)); svg.setAttribute('height', String(plan.height));
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${plan.levelName} native Plan. ${plan.notices.join(' ')}`);
  svg.style.background = plan.tokens.color.drawingPaper;
  svg.style.fontFamily = plan.tokens.font.drawing;
  svg.style.fontVariantNumeric = 'tabular-nums';
  svg.style.display = 'block';
  svg.dataset.projectId = plan.source.projectId; svg.dataset.revisionId = plan.source.revisionId;
  if (plan.levelId !== null) svg.dataset.levelId = plan.levelId;
  for (const primitive of plan.primitives) {
    if (primitive.kind === 'text') {
      const node = document.createElementNS(svg.namespaceURI, 'text');
      node.setAttribute('x', String(primitive.at[0])); node.setAttribute('y', String(primitive.at[1]));
      node.setAttribute('fill', primitive.color); node.setAttribute('font-size', String(primitive.size));
      node.setAttribute('text-anchor', primitive.anchor); node.setAttribute('paint-order', 'stroke');
      node.setAttribute('stroke', plan.tokens.color.drawingPaper); node.setAttribute('stroke-width', String(plan.tokens.drafting.labelHalo));
      node.setAttribute('stroke-linejoin', 'round'); node.setAttribute('pointer-events', 'none');
      if (primitive.angle) node.setAttribute('transform', `rotate(${primitive.angle} ${primitive.at[0]} ${primitive.at[1]})`);
      node.textContent = primitive.text; svg.append(node);
    } else {
      const node = document.createElementNS(svg.namespaceURI, primitive.closed ? 'polygon' : 'polyline');
      node.setAttribute('points', primitive.points.map(point => point.join(',')).join(' '));
      node.setAttribute('stroke', primitive.style.stroke); node.setAttribute('fill', primitive.style.fill);
      node.setAttribute('stroke-width', String(primitive.style.width)); node.setAttribute('stroke-dasharray', primitive.style.dash);
      node.setAttribute('vector-effect', 'non-scaling-stroke');
      if (primitive.hit) {
        const hit = primitive.hit;
        node.setAttribute('data-entity-id', hit.ref.entityId); node.setAttribute('data-project-id', hit.ref.projectId);
        node.setAttribute('data-revision-id', hit.ref.revisionId); node.setAttribute('data-revision-role', hit.revisionRole);
        node.setAttribute('data-representation', hit.representation);
        const title = document.createElementNS(svg.namespaceURI, 'title');
        title.textContent = `${hit.name} · ${hit.representation} · ${hit.revisionRole}`; node.append(title);
      }
      svg.append(node);
    }
  }
  return svg;
}
