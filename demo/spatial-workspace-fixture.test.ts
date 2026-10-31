import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots, validateSnapshot } from '../src/room-model.ts';
import { spatialAcceptanceFixture, spatialDoorFacts, spatialFixtureManifest,
  spatialFixtureVisual } from '../tests/fixtures/spatial-workspace/fixture.ts';

test('spatial acceptance uses a validated native building with real levels, rooms, slabs and hosted openings', async () => {
  const fixture = await spatialAcceptanceFixture();
  assert.equal(fixture.snapshot.version, 2);
  assert.deepEqual(validateSnapshot(fixture.snapshot), fixture.snapshot);
  assert.equal(fixture.snapshot.entities.filter(entity => entity.type === 'Space' && entity.levelId === 'level-ground').length, 2);
  assert.ok(fixture.snapshot.entities.some(entity => entity.type === 'Slab' && entity.levelId === 'level-ground'));
  assert.ok(fixture.snapshot.entities.some(entity => entity.type === 'Stair'));
  const facts = spatialDoorFacts(fixture.snapshot);
  assert.equal(facts.width, .9);
  assert.equal(facts.offset, 3);
  assert.deepEqual(facts.centre, [4, 3.45, 0]);
  assert.equal(facts.wallId, 'level-ground-wall-inner');
});

test('independent centred-door oracle requires exactly a width edit and host-offset edit', async () => {
  const fixture = await spatialAcceptanceFixture();
  const beforeBytes = fixture.repository.serialize();
  const facts = spatialDoorFacts(fixture.expected);
  assert.equal(facts.width, 1.1);
  assert.equal(facts.offset, 2.9);
  assert.deepEqual(facts.centre, [4, 3.45, 0]);
  assert.equal(facts.hostId, spatialFixtureManifest.hostId);
  const delta = diffSnapshots(fixture.snapshot, fixture.expected);
  assert.deepEqual(delta.entities.added, []);
  assert.deepEqual(delta.entities.removed, []);
  assert.deepEqual(delta.entities.modified.map(change => change.id), [spatialFixtureManifest.doorId]);
  assert.deepEqual(delta.relationships.added, []);
  assert.deepEqual(delta.relationships.removed, []);
  assert.deepEqual(delta.relationships.modified.map(change => change.id), [spatialFixtureManifest.hostId]);
  const change = delta.entities.modified[0];
  const hostChange = delta.relationships.modified[0];
  assert.ok(change && hostChange);
  assert.deepEqual(change.after, { ...change.before, width: 1.1 });
  assert.deepEqual(hostChange.after, { ...hostChange.before, offset: 2.9 });
  assert.equal(fixture.repository.serialize(), beforeBytes, 'Expected fixture data never publishes accepted geometry.');
  assert.equal(spatialDoorFacts(fixture.repository.view(fixture.repository.head('main')).snapshot).width, .9);
});

test('fixture visual evidence supports independent object, region-only and mixed conversations', async () => {
  const { repository, baseRevisionId } = await spatialAcceptanceFixture();
  const object = spatialFixtureVisual(repository, 'object');
  const region = spatialFixtureVisual(repository, 'region');
  const mixed = spatialFixtureVisual(repository, 'objects-and-region');
  assert.deepEqual(object.selectedObjectIds, ['level-ground-door-inner']);
  assert.deepEqual(object.annotations, []);
  assert.deepEqual(region.selectedObjectIds, []);
  assert.equal(region.annotations.length, 1);
  assert.deepEqual(mixed.selectedObjectIds, object.selectedObjectIds);
  assert.deepEqual(mixed.annotations, region.annotations);
  for (const visual of [object, region, mixed]) assert.deepEqual(visual.snapshot, { kind: 'accepted', revisionId: baseRevisionId });
});
