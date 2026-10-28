import { entityElevation, entityLevel, stairFootprint } from './building-levels.ts';
import { assetGeometry } from './asset-family.ts';
import { furnitureFaces } from './furniture-geometry.ts';
import { slabPieces, wallSections } from './viewer-geometry.ts';
import type { Entity, ModelSnapshot, Wall } from './room-model.ts';
import type { GeometryCapability, GeometryCategory, GeometryDescription, GeometryRef, GeometryRelation } from './geometry-contract.ts';
import { GeometryLimitError, boxMesh, meshFromFaces, shapeOf } from './geometry-math.ts';
import type { GeometryMesh, GeometryShape, GeometryWork, Vec3 } from './geometry-math.ts';

export type GeometryRecord = { description: GeometryDescription; shape: GeometryShape | null; relations: GeometryRelation[];
  dependencies: unknown };
export type NativeGeometryInput = { snapshot: ModelSnapshot; revisionId: string; target: Extract<GeometryRef, { kind: 'native' }>['target'] };
export function geometryCategory(type: string): GeometryCategory {
  if (/^(?:Ifc)?Wall/.test(type)) return 'wall';
  if (/^(?:Ifc)?(?:Door|Window|Opening)/.test(type)) return 'opening';
  if (/^(?:Ifc)?Slab/.test(type)) return 'slab';
  if (/^(?:Ifc)?Roof/.test(type)) return 'roof';
  if (/^(?:Ifc)?Stair/.test(type)) return 'stair';
  if (/^(?:Ifc)?Space$/.test(type)) return 'space';
  if (/^(?:Level|IfcBuildingStorey)$/.test(type)) return 'level';
  if (type === 'IfcSite') return 'site';
  if (type === 'IfcBuilding') return 'building';
  if (type === 'Equipment' || /^Ifc(?:Flow|Distribution|EnergyConversion)/.test(type)) return 'equipment';
  if (type === 'Furniture' || /^IfcFurnishing/.test(type)) return 'furniture';
  if (type === 'AssetInstance' || type === 'AssetFamily') return 'asset';
  return 'other';
}
const identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const absent: GeometryCapability = { kind: 'unavailable', reason: 'unsupported', detail: 'This semantic entity has no supported physical representation.' };
const coordinateMatrix = (x: number, y: number, z: number, angle = 0): number[][] => {
  const c = Math.cos(angle); const s = Math.sin(angle);
  return [[c, -s, 0, x], [s, c, 0, y], [0, 0, 1, z], [0, 0, 0, 1]];
};

function wallMeshes(snapshot: ModelSnapshot, wall: Wall, work: GeometryWork): GeometryMesh[] {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
  const c = Math.cos(angle); const s = Math.sin(angle); const base = entityElevation(snapshot, wall);
  const point = (x: number, y: number, z: number): Vec3 => [wall.start[0] + x * c - y * s, wall.start[1] + x * s + y * c, base + z];
  const openings = snapshot.relationships.filter(link => link.target === wall.id).flatMap(link => {
    const opening = snapshot.entities.find(entity => entity.id === link.source);
    return opening?.type === 'Door' || opening?.type === 'Window' ? [{ start: link.offset, end: link.offset + opening.width,
      bottom: opening.type === 'Window' ? opening.sillHeight : 0, top: (opening.type === 'Window' ? opening.sillHeight : 0) + opening.height }] : [];
  }).sort((a, b) => a.start - b.start);
  const sections: ReturnType<typeof wallSections> = [];
  let cursor = 0;
  for (const opening of openings) {
    sections.push(...wallSections(snapshot, wall, cursor, opening.start, 0, wall.height),
      ...wallSections(snapshot, wall, opening.start, opening.end, 0, opening.bottom),
      ...wallSections(snapshot, wall, opening.start, opening.end, opening.top, wall.height));
    cursor = opening.end;
  }
  sections.push(...wallSections(snapshot, wall, cursor, length, 0, wall.height));
  return sections.map(section => {
    const half = wall.thickness / 2;
    const a = point(section.start, -half, section.bottom); const b = point(section.end, -half, section.bottom);
    const c = point(section.end, half, section.bottom); const d = point(section.start, half, section.bottom);
    const e = point(section.start, -half, section.startTop); const f = point(section.end, -half, section.endTop);
    const g = point(section.end, half, section.endTop); const h = point(section.start, half, section.startTop);
    return meshFromFaces([[d, c, b, a], [e, f, g, h], [a, b, f, e], [b, c, g, f], [c, d, h, g], [d, a, e, h]], work);
  });
}
function nativeShape(snapshot: ModelSnapshot, entity: Entity, work: GeometryWork): { shape: GeometryShape | null; representation: string; error: number | null } {
  const base = entityElevation(snapshot, entity);
  const box = (min: Vec3, max: Vec3, matrix = identity): GeometryMesh => boxMesh({ min, max }, matrix, work);
  switch (entity.type) {
    case 'Wall': return { shape: shapeOf(wallMeshes(snapshot, entity, work)), representation: 'native-wall-sections-with-hosted-voids', error: 0 };
    case 'AssetInstance': {
      const geometry = assetGeometry(snapshot, entity);
      // Reuse authoritative family evaluation and level elevation; viewer-origin offsets never enter the query frame.
      const faces = geometry.faces.map(face => face.points.map(([x, y, z]): Vec3 => [x, y, base + z]));
      const family = snapshot.entities.find(item => item.id === entity.familyId);
      return { shape: shapeOf([meshFromFaces(faces, work)]), representation: 'native-family-tessellation',
        error: family?.type === 'AssetFamily' && family.parts.every(part => part.kind === 'box') ? 0 : null };
    }
    case 'Equipment': return { shape: shapeOf([box([-entity.width / 2, -entity.depth / 2, 0], [entity.width / 2, entity.depth / 2, entity.height],
      coordinateMatrix(entity.position[0], entity.position[1], base + entity.elevation))]), representation: 'native-equipment-box', error: 0 };
    case 'Furniture': {
      // Silhouettes contain intentionally open leaves/bottoms. Report surface-only rather than inventing closed solids from their enclosure.
      const faces = furnitureFaces(entity, snapshot).map(face => face.points.map(([x, y, z]): Vec3 => [x, y, base + z]));
      return { shape: shapeOf([meshFromFaces(faces, work)]), representation: 'native-furniture-display-surfaces', error: null };
    }
    case 'Slab': return { shape: shapeOf(slabPieces(snapshot, entity).map(bounds => box([bounds.minX, bounds.minY, base - entity.thickness],
      [bounds.maxX, bounds.maxY, base]))), representation: 'native-slab-with-stair-voids', error: 0 };
    case 'Door': case 'Window': {
      const host = snapshot.relationships.find(link => link.source === entity.id);
      const wall = snapshot.entities.find(item => item.id === host?.target);
      if (!host || wall?.type !== 'Wall') return { shape: null, representation: 'missing-host', error: null };
      const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
      const sill = entity.type === 'Window' ? entity.sillHeight : 0;
      // Native opening definitions provide a void, not an authored door-leaf/glazing solid.
      return { shape: shapeOf([box([host.offset, -wall.thickness / 2, sill], [host.offset + entity.width, wall.thickness / 2, sill + entity.height],
        coordinateMatrix(wall.start[0], wall.start[1], base, angle))]), representation: 'native-hosted-opening-void', error: 0 };
    }
    case 'Roof': {
      const b = entity.bounds; const profile = entity.profile;
      const height = (x: number, y: number): number => profile.kind === 'flat' ? profile.height : profile.eaveHeight + (profile.ridgeHeight - profile.eaveHeight)
        * (1 - Math.abs(profile.ridgeAxis === 'x' ? y - (b.minY + b.maxY) / 2 : x - (b.minX + b.maxX) / 2) * 2
          / (profile.ridgeAxis === 'x' ? b.maxY - b.minY : b.maxX - b.minX));
      const rectangles = profile.kind === 'flat' ? [b] : profile.ridgeAxis === 'x'
        ? [{ ...b, maxY: (b.minY + b.maxY) / 2 }, { ...b, minY: (b.minY + b.maxY) / 2 }]
        : [{ ...b, maxX: (b.minX + b.maxX) / 2 }, { ...b, minX: (b.minX + b.maxX) / 2 }];
      const meshes = rectangles.map(r => {
        const top: Vec3[] = [[r.minX, r.minY, 0], [r.maxX, r.minY, 0], [r.maxX, r.maxY, 0], [r.minX, r.maxY, 0]]
          .map(([x, y]): Vec3 => [x, y, base + height(x, y)]);
        const lower = top.map(([x, y, z]): Vec3 => [x, y, z - entity.thickness]);
        return meshFromFaces([[...lower].reverse(), top, ...lower.map((p, i) => [p, lower[(i + 1) % 4], top[(i + 1) % 4], top[i]])], work);
      });
      return { shape: shapeOf(meshes), representation: 'native-roof-vertical-thickness', error: 0 };
    }
    case 'Stair': {
      const footprint = stairFootprint(entity); const upper = entityElevation(snapshot, entity.toLevelId);
      const meshes: GeometryMesh[] = [];
      for (let step = 0; step < entity.steps; step++) {
        work.tick();
        const t0 = step / entity.steps; const t1 = (step + 1) / entity.steps;
        const x = entity.start[0] + (entity.end[0] - entity.start[0]) * t0;
        const y = entity.start[1] + (entity.end[1] - entity.start[1]) * t0;
        const x1 = entity.start[0] + (entity.end[0] - entity.start[0]) * t1;
        const y1 = entity.start[1] + (entity.end[1] - entity.start[1]) * t1;
        meshes.push(box([entity.start[0] === entity.end[0] ? footprint.minX : Math.min(x, x1), entity.start[1] === entity.end[1] ? footprint.minY : Math.min(y, y1), base],
          [entity.start[0] === entity.end[0] ? footprint.maxX : Math.max(x, x1), entity.start[1] === entity.end[1] ? footprint.maxY : Math.max(y, y1), base + (upper - base) * t1]));
      }
      return { shape: shapeOf(meshes), representation: 'native-solid-steps', error: 0 };
    }
    case 'Space': case 'Level': case 'AssetFamily': return { shape: null, representation: 'semantic-context', error: null };
    default: { const exhaustive: never = entity; return exhaustive; }
  }
}

export function nativeGeometryRecords(projectId: string, input: NativeGeometryInput, work: GeometryWork): GeometryRecord[] {
  const { snapshot } = input;
  const ref = (entityId: string): GeometryRef => ({ kind: 'native', projectId, target: structuredClone(input.target), revisionId: input.revisionId, entityId });
  return snapshot.entities.map(entity => {
    work.tick();
    const relations: GeometryRelation[] = [];
    const relate = (kind: GeometryRelation['kind'], id: string): void => { relations.push({ kind, target: ref(id), basis: 'declared' }); };
    const level = entityLevel(snapshot, entity);
    if (level && level.id !== entity.id) relate('level', level.id);
    if (entity.type === 'Furniture' && entity.supportId) relate('supported-by', entity.supportId);
    if (entity.type === 'AssetInstance' && entity.placement.kind === 'room') relate('space', entity.placement.roomId);
    for (const host of snapshot.relationships) if (host.source === entity.id) relate('hosted-by', host.target);
    let derived: ReturnType<typeof nativeShape>;
    try { derived = nativeShape(snapshot, entity, work); }
    catch (error) { if (error instanceof GeometryLimitError) throw error; derived = { shape: null, representation: 'unsupported-native-evaluation', error: null }; }
    const isContext = ['Level', 'Space', 'AssetFamily', 'Door', 'Window'].includes(entity.type);
    return { description: { ref: ref(entity.id), name: entity.name.slice(0, 256), class: entity.type, category: geometryCategory(entity.type), role: isContext ? 'context' : 'physical',
      frame: 'project-engineering-metres', sourceUnitsToMetres: 1, writeAuthority: 'native-review',
      bounds: derived.shape?.bounds ?? null, capability: derived.shape ? { kind: 'mesh', closed: derived.shape.meshes.every(mesh => mesh.closed),
        representation: derived.representation, numericToleranceMetres: 1e-7, sourceErrorMetres: derived.error,
        limitation: 'Prepared representation only. Open surfaces do not establish containment or solid clearance. Internal component faces can underestimate surface separation.' } : absent,
      surfaceSamples: [], surfaceSamplesTruncated: false },
      shape: derived.shape, relations, dependencies: entity.type === 'Space' ? { bounds: entity.bounds, level: level?.elevation ?? 0 }
        : entity.type === 'Level' ? { elevation: entity.elevation } : null };
  });
}
