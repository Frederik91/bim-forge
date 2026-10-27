import test from 'node:test';
import assert from 'node:assert/strict';
import { doorClearanceBounds } from './floor-plan.ts';
import { RoomRepository, validateSnapshot } from './room-model.ts';
import { syntheticResidentialFixture } from './synthetic-residential-fixture.ts';
import { previewWallShift } from './wall-dependencies.ts';

test('a residential partition draft updates both rooms and its hosted doorway without changing the accepted baseline', async () => {
  const fixture = syntheticResidentialFixture();
  const repository = await RoomRepository.createProject({ projectId: fixture.projectId, name: 'Synthetic as-is', snapshot: fixture.snapshot });
  const accepted = repository.serialize();
  const evidence = JSON.stringify(fixture.sources);
  const preview = previewWallShift(fixture.snapshot, { wallId: 'wall-living-kitchen', offsetMetres: .2 });
  assert.deepEqual(validateSnapshot(preview.snapshot), preview.snapshot);
  const living = preview.snapshot.entities.find(item => item.id === 'room-living');
  const kitchen = preview.snapshot.entities.find(item => item.id === 'room-kitchen');
  assert.ok(living?.type === 'Space' && kitchen?.type === 'Space');
  assert.equal(living.bounds.maxX, 5.2);
  assert.equal(kitchen.bounds.minX, 5.2);
  const beforeDoor = fixture.snapshot.entities.find(item => item.id === 'door-living-kitchen');
  const afterDoor = preview.snapshot.entities.find(item => item.id === 'door-living-kitchen');
  assert.ok(beforeDoor?.type === 'Door' && afterDoor?.type === 'Door');
  assert.deepEqual(afterDoor, beforeDoor);
  assert.deepEqual(preview.snapshot.relationships.find(item => item.source === afterDoor.id),
    fixture.snapshot.relationships.find(item => item.source === beforeDoor.id));
  const beforeClearance = doorClearanceBounds(fixture.snapshot, beforeDoor);
  const afterClearance = doorClearanceBounds(preview.snapshot, afterDoor);
  assert.ok(Math.abs(afterClearance.minX - beforeClearance.minX - .2) < 1e-9);
  assert.ok(preview.impacts.some(item => item.kind === 'entity' && item.id === afterDoor.id
    && !item.changed && item.reasons.includes('hosted-opening')));
  for (const id of ['room-office', 'office-desk', 'office-laptop', 'office-monitor', 'main-bed']) {
    assert.deepEqual(preview.snapshot.entities.find(item => item.id === id), fixture.snapshot.entities.find(item => item.id === id));
  }
  assert.deepEqual(preview.delta.entities.modified.map(item => item.id).sort(), ['room-kitchen', 'room-living', 'wall-living-kitchen']);
  assert.equal(JSON.stringify(fixture.sources), evidence);
  assert.equal(repository.serialize(), accepted);
});

test('a partition draft that cuts through existing kitchen contents is refused without publishing geometry or resolving evidence', async () => {
  const fixture = syntheticResidentialFixture();
  const repository = await RoomRepository.createProject({ projectId: fixture.projectId, name: 'Synthetic as-is', snapshot: fixture.snapshot });
  const accepted = repository.serialize();
  const evidence = JSON.stringify(fixture.sources);
  assert.throws(() => previewWallShift(fixture.snapshot, { wallId: 'wall-living-kitchen', offsetMetres: .9 }), /rejected/);
  assert.equal(repository.serialize(), accepted);
  assert.equal(JSON.stringify(fixture.sources), evidence);
});
