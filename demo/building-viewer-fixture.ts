import { validateSnapshot } from '../src/room-model.ts';
import type { SnapshotV2 } from '../src/room-model.ts';

/** Coincident XY floors deliberately make accidental global-XY ownership observable. */
export function viewerBuilding(): SnapshotV2 {
  const storeys = [{ id: 'basement', elevation: -3 }, { id: 'ground', elevation: 0 }, { id: 'attic', elevation: 3 }];
  const entities: unknown[] = [];
  const relationships: unknown[] = [];
  for (const level of storeys) {
    const levelId = level.id;
    entities.push({ id: levelId, type: 'Level', name: levelId, elevation: level.elevation },
      { id: `${levelId}-left`, type: 'Space', name: `${levelId} left`, levelId, bounds: { minX: 0, maxX: 3, minY: 0, maxY: 4 } },
      { id: `${levelId}-right`, type: 'Space', name: `${levelId} right`, levelId, bounds: { minX: 3, maxX: 6, minY: 0, maxY: 4 } },
      { id: `${levelId}-slab`, type: 'Slab', name: `${levelId} slab`, levelId, bounds: { minX: 0, maxX: 6, minY: 0, maxY: 4 }, thickness: .2 });
    const walls = [
      { id: 'south', start: [0, 0], end: [6, 0] }, { id: 'east', start: [6, 0], end: [6, 4] },
      { id: 'north', start: [6, 4], end: [0, 4] }, { id: 'west', start: [0, 4], end: [0, 0] },
      { id: 'shared', start: [3, 0], end: [3, 4] },
    ];
    for (const wall of walls) entities.push({ ...wall, id: `${levelId}-${wall.id}`, type: 'Wall', name: `${levelId} ${wall.id}`,
      levelId, thickness: .1, height: levelId === 'attic' ? 3.4 : 2.7 });
    entities.push({ id: `${levelId}-door`, type: 'Door', name: `${levelId} door`, width: .8, height: 1.8 },
      { id: `${levelId}-desk`, type: 'Furniture', name: `${levelId} desk`, levelId, kind: 'desk', position: [4.5, 2], width: 1.2, depth: .6,
        height: .75, rotationDeg: 0, supportId: null },
      { id: `${levelId}-screen`, type: 'Furniture', name: `${levelId} screen`, levelId, kind: 'monitor', position: [4.5, 2], width: .5, depth: .15,
        height: .4, rotationDeg: 0, supportId: `${levelId}-desk` },
      { id: `${levelId}-equipment`, type: 'Equipment', name: `${levelId} equipment`, levelId, category: 'electrical', position: [5.6, 3.4],
        elevation: .3, width: .2, depth: .15, height: .4 });
    relationships.push({ id: `${levelId}-host`, type: 'hosted-by', source: `${levelId}-door`, target: `${levelId}-shared`, offset: 1.6 });
  }
  entities.push({ id: 'outside-door', type: 'Door', name: 'Outside door', width: .8, height: 2 },
    { id: 'stairs-lower', type: 'Stair', name: 'Basement stairs', fromLevelId: 'basement', toLevelId: 'ground', start: [.5, 1], end: [2.5, 1], width: .8, steps: 12 },
    { id: 'stairs-upper', type: 'Stair', name: 'Attic stairs', fromLevelId: 'ground', toLevelId: 'attic', start: [.5, 3], end: [2.5, 3], width: .8, steps: 12 },
    { id: 'house-roof', type: 'Roof', name: 'House roof', levelId: 'attic', bounds: { minX: 0, maxX: 6, minY: 0, maxY: 4 }, thickness: .2,
      profile: { kind: 'gable', eaveHeight: 2.4, ridgeHeight: 3.6, ridgeAxis: 'x' } });
  relationships.push({ id: 'outside-host', type: 'hosted-by', source: 'outside-door', target: 'ground-south', offset: 4 });
  const snapshot = validateSnapshot({ version: 2, units: 'm', entities, relationships });
  if (snapshot.version !== 2) throw new Error('Expected the versioned building fixture.');
  return snapshot;
}
