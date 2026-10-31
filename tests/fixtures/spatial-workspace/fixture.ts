import { RoomRepository, diffSnapshots, validateSnapshot } from '../../../src/room-model.ts';
import type { ModelSnapshot } from '../../../src/room-model.ts';
import { multiStoreySnapshot } from '../../../src/multi-storey-house.ts';
import { parseConversationVisual } from '../../../src/request-conversation.ts';
import type { PlacedTask, TaskPlacement } from '../../../src/task-placement.ts';
import type { ModelScopeQuery } from '../../../src/model-scope-contract.ts';

/** Disposable authored geometry; never a surveyed building or accepted user project. */
export const spatialFixtureManifest = {
  projectId: '00000264-0000-4000-8000-000000000264',
  levelId: 'level-ground',
  doorId: 'level-ground-door-inner',
  hostId: 'host-level-ground-door-inner',
  wallId: 'level-ground-wall-inner',
  frame: 'project-engineering-metres',
  origin: [3.2, 3.45, 1.4],
  eye: [2, 3.45, 1.6],
  forward: [1, 0, 0],
  up: [0, 0, 1],
  before: { width: .9, offset: 3, centre: [4, 3.45, 0] },
  after: { width: 1.1, offset: 2.9, centre: [4, 3.45, 0] },
  taskIds: { first: 'spatial-door-first', second: 'spatial-door-second', region: 'spatial-region-only' },
} as const;

/** Expected data is an independent oracle, never a worker result or accepted change. */
export function spatialExpectedDoorSnapshot(base: ModelSnapshot): ModelSnapshot {
  const spec = spatialFixtureManifest;
  return validateSnapshot({ ...base,
    entities: base.entities.map(entity => entity.id === spec.doorId
      ? { ...entity, width: spec.after.width } : entity),
    relationships: base.relationships.map(host => host.id === spec.hostId
      ? { ...host, offset: spec.after.offset } : host),
  });
}

export async function spatialAcceptanceFixture() {
  const snapshot = multiStoreySnapshot();
  const repository = await RoomRepository.createProject({
    projectId: spatialFixtureManifest.projectId,
    name: 'Disposable spatial acceptance building', snapshot,
  });
  const baseRevisionId = repository.head('main');
  const expected = spatialExpectedDoorSnapshot(snapshot);
  return { repository, snapshot, baseRevisionId, expected,
    expectedDelta: diffSnapshots(snapshot, expected), manifest: spatialFixtureManifest };
}

export function spatialFixtureVisual(repository: RoomRepository, mode: 'object' | 'region' | 'objects-and-region') {
  return parseConversationVisual({
    snapshot: { kind: 'accepted', revisionId: repository.head('main') },
    view: '3d', levelId: spatialFixtureManifest.levelId,
    selectedObjectIds: mode === 'region' ? [] : [spatialFixtureManifest.doorId],
    annotations: mode === 'object' ? [] : [{ kind: 'rectangle', label: 'Discuss this ground-floor area',
      corners: [[3, 2.6, 0], [3.9, 2.6, 0], [3.9, 4.2, 0], [3, 4.2, 0]] }],
  });
}

export function spatialFixturePlacement(repository: RoomRepository, mode: 'object' | 'region' | 'objects-and-region' = 'object'): PlacedTask {
  const snapshot: PlacedTask['origin']['snapshot'] = { projectId: repository.projectId,
    target: { kind: 'main' }, revisionId: repository.head('main') };
  return { version: 1, kind: 'placed', origin: { snapshot, frame: spatialFixtureManifest.frame,
    point: [...spatialFixtureManifest.origin], view: '3d', levelId: spatialFixtureManifest.levelId },
    targets: { objects: mode === 'region' ? [] : [{ kind: 'native', ...snapshot, entityId: spatialFixtureManifest.doorId }],
      regions: mode === 'object' ? [] : [{ snapshot, markup: { kind: 'rectangle', label: 'Ground-floor region',
        corners: [[3, 2.6, 0], [3.9, 2.6, 0], [3.9, 4.2, 0], [3, 4.2, 0]] } }] } };
}

/** Historical missing references are inspectable, but cannot create a new task. */
export function spatialMissingTargetPlacement(repository: RoomRepository): PlacedTask {
  const placement = spatialFixturePlacement(repository);
  placement.targets.objects = [{ kind: 'native', ...placement.origin.snapshot, entityId: 'missing-spatial-door' }];
  return placement;
}

export function spatialUnplacedFixture(reason: 'legacy' | 'not-provided'): TaskPlacement {
  return { version: 1, kind: 'unplaced', reason };
}

export function spatialFixtureRequest(repository: RoomRepository, requestId: string,
  mode: 'object' | 'region' | 'objects-and-region' = 'object') {
  return { requestId, baseRevisionId: repository.head('main'),
    proposalName: requestId, selectedObjectIds: mode === 'region' ? [] : [spatialFixtureManifest.doorId],
    instruction: 'Widen this door from 900 mm to 1100 mm while preserving its centre and existing host. Keep every other object unchanged.',
    visualIntent: { kind: 'selection' } satisfies { kind: 'selection' },
    conversationVisual: spatialFixtureVisual(repository, mode), taskPlacement: spatialFixturePlacement(repository, mode),
    ...(mode === 'region' ? {} : { scope: { query: { version: 1,
      allOf: [{ kind: 'ids', ids: [spatialFixtureManifest.doorId] }], anyOf: [], excludeIds: [] } satisfies ModelScopeQuery } }),
  };
}

/** Independent evaluated centre used by integration assertions, in project metres. */
export function spatialDoorFacts(snapshot: ModelSnapshot) {
  const spec = spatialFixtureManifest;
  const door = snapshot.entities.find(entity => entity.id === spec.doorId);
  const hosts = snapshot.relationships.filter(host => host.source === spec.doorId);
  if (door?.type !== 'Door' || hosts.length !== 1) throw new Error('Fixture requires one hosted native door.');
  const host = hosts[0];
  if (!host) throw new Error('Fixture hosting relationship missing.');
  const wall = snapshot.entities.find(entity => entity.id === host.target);
  if (wall?.type !== 'Wall' || !('levelId' in wall)) throw new Error('Fixture host is not a building wall.');
  const levelId = wall.levelId;
  const level = snapshot.entities.find(entity => entity.type === 'Level' && entity.id === levelId);
  if (level?.type !== 'Level') throw new Error('Fixture host level missing.');
  const dx = wall.end[0] - wall.start[0];
  const dy = wall.end[1] - wall.start[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) throw new Error('Fixture wall is degenerate.');
  const centreOffset = host.offset + door.width / 2;
  return { width: door.width, offset: host.offset, hostId: host.id, wallId: wall.id,
    centre: [wall.start[0] + dx / length * centreOffset,
      wall.start[1] + dy / length * centreOffset, level.elevation] };
}
