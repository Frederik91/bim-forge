import test from 'node:test';
import assert from 'node:assert/strict';
import { assessHousePilotFixture, createHousePilotFixture } from './house-pilot.ts';
import { RoomRepository } from './room-model.ts';

test('canonical House Pilot fixture binds project, room, entities and evidence to one revision', async () => {
  const fixture = await createHousePilotFixture();
  const revision = fixture.repository.view(fixture.scope.revisionId);
  assert.equal(fixture.repository.projectId, fixture.projectId);
  assert.equal(fixture.repository.head('main'), revision.id);
  assert.equal(revision.snapshot.entities.filter((entity) => entity.type === 'Wall').length, 4);
  assert.equal(revision.snapshot.entities.filter((entity) => entity.type === 'Door').length, 1);
  assert.equal(revision.snapshot.entities.filter((entity) => entity.type === 'Window').length, 1);
  assert.equal(revision.snapshot.entities.filter((entity) => entity.type === 'Equipment').length, 2);
  assert.deepEqual(new Set(fixture.evidence.map((item) => item.kind)), new Set(['photo', 'measurement', 'note', 'document']));
  assert.ok(fixture.evidence.every((item) => item.revisionId === revision.id));
  assert.deepEqual(fixture.scope.entityIds, revision.snapshot.entities.map((entity) => entity.id));
});

test('fixture assessment deterministically exposes one conflict and one unknown', async () => {
  const fixture = await createHousePilotFixture();
  const first = assessHousePilotFixture(fixture);
  const second = assessHousePilotFixture(fixture);
  assert.deepEqual(first, second);
  assert.equal(first.conflicts.length, 1);
  assert.equal(first.conflicts[0]?.property, 'geometry.length');
  assert.deepEqual(first.conflicts[0]?.candidates.map((candidate) => candidate.value), [6, 5.98]);
  assert.equal(first.unknowns.length, 1);
  assert.equal(first.unknowns[0]?.property, 'electrical.circuit');
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.conflicts));
});

test('supported values preserve measured, observed and documented provenance', async () => {
  const fixture = await createHousePilotFixture();
  const origins = fixture.assertions.flatMap((assertion) => {
    if (assertion.status === 'supported') return [assertion.origin.kind];
    if (assertion.status === 'conflicting') return assertion.candidates.map((candidate) => candidate.origin.kind);
    return [];
  });
  assert.ok(origins.includes('measured'));
  assert.ok(origins.includes('observed'));
  assert.ok(origins.includes('documented'));
  assert.equal(fixture.assertions.some((assertion) => assertion.status === 'unknown' && 'value' in assertion), false);
});

test('custom project roots serialize and restore without falling back to the demo room', async () => {
  const fixture = await createHousePilotFixture();
  const saved = fixture.repository.serialize();
  const restored = await RoomRepository.restore(saved);
  assert.equal(restored.projectId, fixture.projectId);
  assert.equal(restored.root(), fixture.repository.root());
  assert.deepEqual(restored.view(restored.head('main')).snapshot, fixture.repository.view(fixture.scope.revisionId).snapshot);
});

test('custom project creation rejects unsupported entities and invalid project identities', async () => {
  const fixture = await createHousePilotFixture();
  const snapshot = fixture.repository.view(fixture.scope.revisionId).snapshot;
  await assert.rejects(RoomRepository.createProject({ projectId: 'not-a-project', name: 'Invalid', snapshot }), /project identity/);
  await assert.rejects(RoomRepository.createProject({
    projectId: '00000000-0000-4000-8000-000000000075', name: 'Invalid',
    snapshot: { ...snapshot, entities: [...snapshot.entities, { id: 'roof-one', type: 'Roof', name: 'Unsupported' }] },
  }), /supported building entities/);
});
