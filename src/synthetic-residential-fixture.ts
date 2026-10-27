import { doorConnections, entitySpace, floorBounds, spaces } from './floor-plan.ts';
import { residentialFloor } from './residential-floor.ts';
import { diffSnapshots, validateSnapshot } from './room-model.ts';

/** Disposable test inputs, not surveyed evidence or a persistence contract. */
export function syntheticResidentialFixture() {
  const base = residentialFloor();
  const snapshot = validateSnapshot({
    ...base,
    entities: [...base.entities, {
      id: 'door-living-kitchen', type: 'Door', name: 'Synthetic living / kitchen doorway', width: .9, height: 2.1,
    }],
    relationships: [...base.relationships, {
      id: 'host-door-living-kitchen', type: 'hosted-by', source: 'door-living-kitchen', target: 'wall-living-kitchen', offset: 2.8,
    }],
  });
  const rooms = spaces(snapshot);
  const connections = doorConnections(snapshot);
  const furniture = snapshot.entities.filter((item) => item.type === 'Furniture');
  const inventory = {
    bounds: floorBounds(snapshot),
    rooms: rooms.map((room) => ({
      id: room.id, name: room.name, levelId: room.levelId, bounds: room.bounds,
      furnitureIds: furniture.filter((item) => entitySpace(snapshot, item)?.id === room.id).map((item) => item.id),
    })),
    walls: snapshot.entities.filter((item) => item.type === 'Wall').map((wall) => ({
      id: wall.id, start: wall.start, end: wall.end, thickness: wall.thickness, height: wall.height,
      roomIds: rooms.filter(({ bounds: b }) => wall.start[1] === wall.end[1]
        ? (wall.start[1] === b.minY || wall.start[1] === b.maxY)
          && Math.min(wall.start[0], wall.end[0]) < b.maxX && Math.max(wall.start[0], wall.end[0]) > b.minX
        : (wall.start[0] === b.minX || wall.start[0] === b.maxX)
          && Math.min(wall.start[1], wall.end[1]) < b.maxY && Math.max(wall.start[1], wall.end[1]) > b.minY).map((room) => room.id),
    })),
    hostedOpenings: snapshot.relationships.map((host) => ({
      relationshipId: host.id, openingId: host.source, wallId: host.target, offset: host.offset,
    })),
    doorways: connections.map(({ door, roomIds, exterior }) => ({ id: door.id, roomIds, exterior })),
    furnishings: furniture.map((item) => ({
      id: item.id, roomId: entitySpace(snapshot, item)?.id ?? null, supportId: item.supportId,
    })),
  };
  const sources = {
    plan: {
      id: 'synthetic-plan-198', synthetic: true, mediaType: 'text/plain',
      objectIds: snapshot.entities.map((item) => item.id),
      text: [
        'SYNTHETIC CONCEPT PLAN; generated test data, not a survey or construction design.',
        'Metres; origin southwest; x east, y north; ground level elevation 0; envelope 12 x 9.',
        ...rooms.map((room) => `${room.id}: [${room.bounds.minX},${room.bounds.minY}] to [${room.bounds.maxX},${room.bounds.maxY}].`),
        'wall-living-kitchen: x=5.0, y=0..4; door-living-kitchen: offset=2.8, width=0.9, height=2.1.',
      ].join('\n'),
    },
    measurements: [
      {
        id: 'synthetic-measurement-partition-plan-198', synthetic: true,
        objectId: 'wall-living-kitchen', field: 'start.x', valueM: 5,
        description: 'Generated plan coordinate; agrees with the synthetic model. Not a field measurement.',
        contradictsSourceIds: [],
      },
      {
        id: 'synthetic-measurement-partition-conflict-198', synthetic: true,
        objectId: 'wall-living-kitchen', field: 'start.x', valueM: 5.2,
        description: 'INTENTIONAL CONTRADICTION: invented measurement disagrees with plan x=5.0 by 0.2 m; unresolved.',
        contradictsSourceIds: ['synthetic-plan-198', 'synthetic-measurement-partition-plan-198'],
      },
      {
        id: 'synthetic-measurement-door-width-198', synthetic: true,
        objectId: 'door-living-kitchen', field: 'width', valueM: .9,
        description: 'Generated doorway width; concept clearance only, not regulatory approval.',
        contradictsSourceIds: [],
      },
    ],
    brief: {
      id: 'synthetic-brief-198', synthetic: true, mediaType: 'text/plain',
      objectIds: ['room-living', 'room-kitchen', 'wall-living-kitchen', 'door-living-kitchen'],
      text: 'Explore a shared living/kitchen partition change as an isolated AI proposal. Explain adjacent room bounds and the hosted doorway. Preserve the baseline until human review; resolve the conflicting synthetic measurement explicitly.',
    },
  };
  return {
    id: 'synthetic-residential-198', projectId: '00000198-0000-4000-8000-000000000198', snapshot, sources, inventory,
    deltaFromResidentialFloor: diffSnapshots(base, snapshot),
  };
}

export type SyntheticResidentialFixture = ReturnType<typeof syntheticResidentialFixture>;
