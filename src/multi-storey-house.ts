import { RoomRepository, validateSnapshot } from './room-model.ts';
import type { SnapshotV2 } from './room-model.ts';
import type { BuildingLayout } from './building-schema.ts';

/** Browser-safe authoring recipe; importing it never loads the backend compiler. */
export function multiStoreyLayout(): BuildingLayout {
  return {
    levels: [
      { id: 'level-basement', name: 'Basement', elevationMm: -3000 },
      { id: 'level-ground', name: 'Ground floor', elevationMm: 0 },
      { id: 'level-attic', name: 'Attic', elevationMm: 3000 },
    ].map((level) => ({ level, rooms: [
      { id: level.id + '-west', name: level.name + ' west room', boundsMm: { minX: 0, minY: 0, maxX: 4000, maxY: 6000 } },
      { id: level.id + '-east', name: level.name + ' east room', boundsMm: { minX: 4000, minY: 0, maxX: 8000, maxY: 6000 } },
    ], wallThicknessMm: 150, heightMm: 2700, slabThicknessMm: 200,
    openings: [
      { id: level.id + '-door-inner', type: 'Door', name: level.name + ' connecting door', roomId: level.id + '-west',
        side: 'east', offsetMm: 3000, widthMm: 900, heightMm: 2100 },
      ...(level.elevationMm === 0 ? [{ id: 'door-entry', type: 'Door' as const, name: 'Ground entrance', roomId: level.id + '-west',
        side: 'south' as const, offsetMm: 2000, widthMm: 900, heightMm: 2100 }] : []),
    ], roof: level.id === 'level-attic' ? { boundsMm: { minX: 0, minY: 0, maxX: 8000, maxY: 6000 }, thicknessMm: 200,
      profile: { kind: 'gable', eaveHeightMm: 2700, ridgeHeightMm: 4200, ridgeAxis: 'x' } } : null,
    })),
    stairs: [
      { id: 'stair-basement-ground', name: 'Basement stairs', fromLevelId: 'level-basement', toLevelId: 'level-ground',
        startMm: [1000, 1500], endMm: [3000, 1500], widthMm: 800, steps: 15 },
      { id: 'stair-ground-attic', name: 'Attic stairs', fromLevelId: 'level-ground', toLevelId: 'level-attic',
        startMm: [5000, 1500], endMm: [7000, 1500], widthMm: 800, steps: 15 },
    ],
  };
}

/** Trusted fixture geometry is deliberately independent of Node-only shell authoring. */
export function multiStoreySnapshot(): SnapshotV2 {
  const layout = multiStoreyLayout();
  const entities: unknown[] = [];
  const relationships: unknown[] = [];
  for (const floor of layout.levels) {
    const { id, name, elevationMm } = floor.level;
    entities.push({ id, type: 'Level', name, elevation: elevationMm / 1000 });
    for (const room of floor.rooms) entities.push({ id: room.id, type: 'Space', name: room.name, levelId: id,
      bounds: { minX: room.boundsMm.minX / 1000, minY: 0, maxX: room.boundsMm.maxX / 1000, maxY: 6 } });
    for (const wall of [
      { side: 'south', start: [0, 0], end: [8, 0] }, { side: 'north', start: [0, 6], end: [8, 6] },
      { side: 'west', start: [0, 0], end: [0, 6] }, { side: 'east', start: [8, 0], end: [8, 6] },
      { side: 'inner', start: [4, 0], end: [4, 6] },
    ]) entities.push({ id: id + '-wall-' + wall.side, type: 'Wall', name: name + ' ' + wall.side + ' wall',
      levelId: id, start: wall.start, end: wall.end, thickness: .15, height: 2.7 });
    for (const opening of floor.openings) {
      entities.push({ id: opening.id, type: 'Door', name: opening.name, width: .9, height: 2.1 });
      relationships.push({ id: 'host-' + opening.id, type: 'hosted-by', source: opening.id,
        target: id + '-wall-' + (opening.side === 'south' ? 'south' : 'inner'), offset: opening.offsetMm / 1000 });
    }
    entities.push({ id: id + '-slab', type: 'Slab', name: name + ' slab', levelId: id,
      bounds: { minX: 0, minY: 0, maxX: 8, maxY: 6 }, thickness: .2 });
    entities.push({ id: id + '-plant', type: 'Furniture', name: name + ' plant', levelId: id,
      kind: 'plant', position: [1, 4.8], width: .4, depth: .4, height: 1, rotationDeg: 0, supportId: null });
    if (floor.roof) entities.push({ id: id + '-roof', type: 'Roof', name: 'Attic gable roof', levelId: id,
      bounds: { minX: 0, minY: 0, maxX: 8, maxY: 6 }, thickness: .2,
      profile: { kind: 'gable', eaveHeight: 2.7, ridgeHeight: 4.2, ridgeAxis: 'x' } });
  }
  entities.push(...layout.stairs.map((stair) => ({ id: stair.id, type: 'Stair', name: stair.name, fromLevelId: stair.fromLevelId,
    toLevelId: stair.toLevelId, start: stair.startMm.map((n) => n / 1000), end: stair.endMm.map((n) => n / 1000), width: stair.widthMm / 1000, steps: stair.steps })));
  const snapshot = validateSnapshot({ version: 2, units: 'm', entities, relationships });
  if (snapshot.version !== 2) throw new Error('Multi-storey fixture requires version two.');
  return snapshot;
}

export async function createMultiStoreyProject(name: string): Promise<RoomRepository> {
  return RoomRepository.createProject({ projectId: globalThis.crypto.randomUUID(), name, snapshot: multiStoreySnapshot() });
}
