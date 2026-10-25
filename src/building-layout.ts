import { createHash } from 'node:crypto';
import { Check } from 'typebox/value';
import { BuildingLayoutSchema } from './building-schema.ts';
import type { BuildingLayout } from './building-schema.ts';
import { compileFloorLayout, plainLayoutInput } from './floor-layout.ts';
import { entityLevel } from './building-levels.ts';
import { validateSnapshot } from './room-model.ts';
import type { Bounds, SnapshotV2 } from './room-model.ts';
export { BuildingLayoutSchema } from './building-schema.ts';
export type { BuildingLayout } from './building-schema.ts';

export function parseBuildingLayout(input: unknown): BuildingLayout {
  const value = plainLayoutInput(input);
  if (!Check(BuildingLayoutSchema, value)) throw new Error('Building layout requires exact fields and bounded whole millimetres.');
  return value;
}

const boundsMetres = (bounds: Bounds): Bounds => ({ minX: bounds.minX / 1000, minY: bounds.minY / 1000, maxX: bounds.maxX / 1000, maxY: bounds.maxY / 1000 });
function derivedId(kind: 'slab' | 'roof', levelId: string): string {
  return 'building-' + kind + '-' + BigInt('0x' + createHash('sha256').update(levelId).digest('hex')).toString(36);
}

/** Complete, atomic building reconstruction. Preserves contents by identity, never by XY. */
export function previewBuilding(baseSnapshot: unknown, input: unknown): SnapshotV2 {
  const base = validateSnapshot(baseSnapshot);
  const layout = parseBuildingLayout(input);
  const zeroLevels = layout.levels.filter((item) => item.level.elevationMm === 0);
  const contents = base.entities.filter((item) => item.type === 'Furniture' || item.type === 'Equipment').map((item) => {
    if (base.version === 2) {
      const level = entityLevel(base, item);
      if (!level || !layout.levels.some((candidate) => candidate.level.id === level.id)) throw new Error('Building reconstruction must retain every content owner.');
      return item;
    }
    const zero = zeroLevels[0];
    if (zeroLevels.length !== 1 || !zero) throw new Error('Unlevelled contents require a unique elevation-zero level.');
    return { ...item, levelId: zero.level.id };
  });
  const entities: unknown[] = [...contents];
  const relationships: unknown[] = [];
  for (const floor of layout.levels) {
    const shell = compileFloorLayout({ level: { id: floor.level.id, name: floor.level.name }, rooms: floor.rooms,
      wallThicknessMm: floor.wallThicknessMm, heightMm: floor.heightMm, openings: floor.openings },
    { kind: 'building', elevation: floor.level.elevationMm / 1000 });
    entities.push(...shell.entities);
    relationships.push(...shell.relationships);
    const bounds = { minX: Math.min(...floor.rooms.map((room) => room.boundsMm.minX)), minY: Math.min(...floor.rooms.map((room) => room.boundsMm.minY)),
      maxX: Math.max(...floor.rooms.map((room) => room.boundsMm.maxX)), maxY: Math.max(...floor.rooms.map((room) => room.boundsMm.maxY)) };
    entities.push({ id: derivedId('slab', floor.level.id), type: 'Slab', name: floor.level.name + ' slab',
      levelId: floor.level.id, bounds: boundsMetres(bounds), thickness: floor.slabThicknessMm / 1000 });
    if (floor.roof) {
      const profile = floor.roof.profile;
      entities.push({ id: derivedId('roof', floor.level.id), type: 'Roof', name: floor.level.name + ' roof', levelId: floor.level.id,
        bounds: boundsMetres(floor.roof.boundsMm), thickness: floor.roof.thicknessMm / 1000,
        profile: profile.kind === 'flat' ? { kind: 'flat', height: profile.heightMm / 1000 }
          : { kind: 'gable', eaveHeight: profile.eaveHeightMm / 1000, ridgeHeight: profile.ridgeHeightMm / 1000, ridgeAxis: profile.ridgeAxis } });
    }
  }
  entities.push(...layout.stairs.map((stair) => ({ id: stair.id, type: 'Stair', name: stair.name,
    fromLevelId: stair.fromLevelId, toLevelId: stair.toLevelId, start: stair.startMm.map((n) => n / 1000),
    end: stair.endMm.map((n) => n / 1000), width: stair.widthMm / 1000, steps: stair.steps })));
  const result = validateSnapshot({ version: 2, units: 'm', entities, relationships });
  if (result.version !== 2) throw new Error('Building reconstruction requires version two.');
  return result;
}
