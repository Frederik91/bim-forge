import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { doorClearanceBounds, doorConnections, floorBounds, spaces } from './floor-plan.ts';
import { residentialFloor } from './residential-floor.ts';
import { RoomRepository, diffSnapshots, validateSnapshot } from './room-model.ts';
import { syntheticResidentialFixture } from './synthetic-residential-fixture.ts';

test('generation has identical bytes and identities across fresh calls and separate processes', () => {
  const fixture = syntheticResidentialFixture();
  const bytes = JSON.stringify(fixture);
  assert.equal(JSON.stringify(syntheticResidentialFixture()), bytes);
  const source = `import { syntheticResidentialFixture } from ${JSON.stringify(new URL('./synthetic-residential-fixture.ts', import.meta.url).href)}; process.stdout.write(JSON.stringify(syntheticResidentialFixture()));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, bytes);
  assert.equal(new Set(fixture.snapshot.entities.map((item) => item.id)).size, 50);
  assert.equal(new Set(fixture.snapshot.relationships.map((item) => item.id)).size, 14);
});

test('native floor remains eight enclosed rooms with shared walls, reachable doorways and furnishings', () => {
  const { snapshot, inventory } = syntheticResidentialFixture();
  assert.deepEqual(validateSnapshot(snapshot), snapshot);
  assert.deepEqual(floorBounds(snapshot), { minX: 0, minY: 0, maxX: 12, maxY: 9 });
  assert.equal(spaces(snapshot).length, 8);
  assert.equal(inventory.walls.length, 11);
  assert.equal(inventory.furnishings.length, 16);
  assert.equal(inventory.hostedOpenings.length, 14);
  assert.equal(inventory.doorways.filter((item) => item.exterior).length, 1);
  assert.equal(inventory.doorways.filter((item) => !item.exterior).length, 8);
  assert.ok(inventory.furnishings.every((item) => item.roomId !== null));
  const reached = new Set(inventory.doorways.filter((item) => item.exterior).flatMap((item) => item.roomIds));
  for (let pass = 0; pass < inventory.rooms.length; pass += 1) {
    for (const door of inventory.doorways) if (door.roomIds.some((id) => reached.has(id))) {
      for (const id of door.roomIds) reached.add(id);
    }
  }
  assert.deepEqual([...reached].sort(), inventory.rooms.map((room) => room.id).sort());
});

test('inventory exposes adjacent rooms, hosted doorway and supported desk devices', () => {
  const { snapshot, inventory } = syntheticResidentialFixture();
  assert.deepEqual(inventory.walls.find((item) => item.id === 'wall-living-kitchen'), {
    id: 'wall-living-kitchen', start: [5, 0], end: [5, 4], thickness: .15, height: 2.7,
    roomIds: ['room-kitchen', 'room-living'],
  });
  assert.deepEqual(inventory.hostedOpenings.find((item) => item.openingId === 'door-living-kitchen'), {
    relationshipId: 'host-door-living-kitchen', openingId: 'door-living-kitchen', wallId: 'wall-living-kitchen', offset: 2.8,
  });
  assert.deepEqual(inventory.doorways.find((item) => item.id === 'door-living-kitchen'), {
    id: 'door-living-kitchen', roomIds: ['room-kitchen', 'room-living'], exterior: false,
  });
  assert.deepEqual(inventory.furnishings.filter((item) => item.supportId !== null), [
    { id: 'office-laptop', roomId: 'room-office', supportId: 'office-desk' },
    { id: 'office-monitor', roomId: 'room-office', supportId: 'office-desk' },
  ]);
  const connection = doorConnections(snapshot).find(({ door }) => door.id === 'door-living-kitchen');
  assert.ok(connection);
  const clearance = doorClearanceBounds(snapshot, connection.door);
  assert.equal(clearance.minX, 4.1);
  assert.equal(clearance.maxX, 5.9);
  assert.equal(clearance.minY, 2.8);
  assert.ok(Math.abs(clearance.maxY - 3.7) < 1e-9);
});

test('inspectable native delta adds only a shared-partition doorway and its host', () => {
  const { snapshot, deltaFromResidentialFloor } = syntheticResidentialFixture();
  assert.deepEqual(deltaFromResidentialFloor, diffSnapshots(residentialFloor(), snapshot));
  assert.deepEqual(deltaFromResidentialFloor.entities, {
    added: [{ id: 'door-living-kitchen', type: 'Door', name: 'Synthetic living / kitchen doorway', width: .9, height: 2.1 }],
    removed: [], modified: [],
  });
  assert.deepEqual(deltaFromResidentialFloor.relationships, {
    added: [{ id: 'host-door-living-kitchen', type: 'hosted-by', source: 'door-living-kitchen', target: 'wall-living-kitchen', offset: 2.8 }],
    removed: [], modified: [],
  });
});

test('synthetic sources identify model objects and retain one explicit unresolved contradiction outside the snapshot', () => {
  const { snapshot, sources } = syntheticResidentialFixture();
  const ids = new Set<string>(snapshot.entities.map((item) => item.id));
  assert.ok(sources.plan.synthetic && sources.brief.synthetic);
  assert.ok([...sources.plan.objectIds, ...sources.brief.objectIds].every((id) => ids.has(id)));
  assert.ok(sources.measurements.every((item) => item.synthetic && ids.has(item.objectId)));
  const conflicts = sources.measurements.filter((item) => item.contradictsSourceIds.length > 0);
  assert.equal(conflicts.length, 1);
  const conflict = conflicts[0]; assert.ok(conflict);
  assert.equal(conflict.valueM, 5.2);
  assert.match(conflict.description, /INTENTIONAL CONTRADICTION.*unresolved/);
  assert.deepEqual(conflict.contradictsSourceIds, [sources.plan.id, sources.measurements[0]?.id]);
  const wall = snapshot.entities.find((item) => item.id === conflict.objectId);
  assert.ok(wall?.type === 'Wall');
  assert.equal(wall.start[0], 5);
  assert.equal(wall.end[0], 5);
  assert.match(sources.plan.text, /wall-living-kitchen: x=5.0/);
  assert.throws(() => validateSnapshot({ ...snapshot, sources }), /field/);
});

test('contradictory partition coordinate cannot silently become a valid native model', async () => {
  const { projectId, snapshot, sources } = syntheticResidentialFixture();
  const repo = await RoomRepository.createProject({ projectId, name: 'Synthetic baseline', snapshot });
  const saved = repo.serialize();
  const conflict = sources.measurements.find((item) => item.contradictsSourceIds.length > 0); assert.ok(conflict);
  assert.throws(() => validateSnapshot({ ...snapshot, entities: snapshot.entities.map((item) =>
    item.id === conflict.objectId && item.type === 'Wall'
      ? { ...item, start: [conflict.valueM, item.start[1]], end: [conflict.valueM, item.end[1]] } : item),
  }), /enclosed|boundar|interior/);
  assert.equal(repo.serialize(), saved);
  assert.deepEqual(repo.view(repo.head('main')).snapshot, snapshot);
});

test('native validators reject lost hosts, doorway overrun, blocked clearance and lost supports', () => {
  const { snapshot } = syntheticResidentialFixture();
  assert.throws(() => validateSnapshot({ ...snapshot,
    relationships: snapshot.relationships.filter((item) => item.source !== 'door-living-kitchen'),
  }), /exactly one host/);
  assert.throws(() => validateSnapshot({ ...snapshot,
    relationships: snapshot.relationships.map((item) => item.source === 'door-living-kitchen' ? { ...item, offset: 3.5 } : item),
  }), /fit inside/);
  assert.throws(() => validateSnapshot({ ...snapshot,
    entities: snapshot.entities.map((item) => item.id === 'living-plant' ? { ...item, position: [4.45, 3.2] } : item),
  }), /door clearance/);
  assert.throws(() => validateSnapshot({ ...snapshot,
    entities: snapshot.entities.filter((item) => item.id !== 'office-desk'),
  }), /support/);
});

test('deterministic native project round-trips within portable caps without persisting source descriptors', async () => {
  const { projectId, snapshot } = syntheticResidentialFixture();
  const create = () => RoomRepository.createProject({ projectId, name: 'Synthetic residential 198', snapshot });
  const repo = await create();
  const bytes = repo.serialize();
  assert.equal((await create()).serialize(), bytes);
  assert.equal((await RoomRepository.restore(bytes)).serialize(), bytes);
  assert.ok(Buffer.byteLength(bytes) < 256 * 1024);
  assert.equal(repo.persistence().revisions.length, 1);
  assert.deepEqual(repo.branches(), [{ name: 'main', revisionId: repo.root() }]);
  assert.equal(bytes.includes('synthetic-plan-198'), false);
  assert.throws(() => validateSnapshot({ ...snapshot, entities: Array.from({ length: 101 }, () => snapshot.entities[0]) }), /dense and bounded/);
  assert.throws(() => validateSnapshot({ ...snapshot, relationships: Array.from({ length: 101 }, () => snapshot.relationships[0]) }), /dense and bounded/);
  await assert.rejects(RoomRepository.restore(JSON.stringify({ ...repo.persistence(),
    revisions: Array.from({ length: 33 }, () => ({})),
  })), /Unsupported saved project/);
  await assert.rejects(RoomRepository.restore(bytes + ' '.repeat(256 * 1024)), /256 KiB/);
  assert.equal(repo.serialize(), bytes);
});

test('mutating a caller-owned source descriptor cannot affect a later generation or the native snapshot', () => {
  const fixture = syntheticResidentialFixture();
  const before = JSON.stringify(fixture);
  const first = fixture.sources.measurements[0]; assert.ok(first);
  first.valueM = 99;
  fixture.inventory.hostedOpenings.splice(0);
  assert.equal(JSON.stringify(syntheticResidentialFixture()), before);
  assert.deepEqual(fixture.snapshot, syntheticResidentialFixture().snapshot);
});
