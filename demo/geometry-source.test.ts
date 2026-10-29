import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeometryEvidenceSource } from './geometry-source.ts';
import { evidenceWall } from '../src/geometry-evidence.fixture.ts';
import { geometryDigest } from '../src/geometry-query.ts';
import { RoomRepository, previewRectangle, rectangleLayout } from '../src/room-model.ts';
import type { GeometryRef } from '../src/geometry-contract.ts';
import type { GeometrySessionInput } from '../src/geometry-session.ts';
import type { LinkedModelStore } from './linked-model-store.ts';

async function setup() {
  const repository = await RoomRepository.create(previewRectangle(rectangleLayout(6, 4, 2.7, .2, 1)));
  const native: GeometrySessionInput['native'] = { snapshot: repository.view('main').snapshot,
    revisionId: repository.head('main'), target: { kind: 'main' }, readableIds: [] };
  return { native, projectId: repository.projectId, signal: new AbortController().signal };
}
function ref(projectId: string, prepared: ReturnType<typeof evidenceWall>): Extract<GeometryRef, { kind: 'ifc' }> {
  const object = prepared.index.objects[0]; assert.ok(object);
  return { kind: 'ifc', projectId, ...object.ref, occurrenceId: prepared.manifest.occurrence.id,
    placementDigest: geometryDigest(prepared.manifest.occurrence.sourceToProjectMetres) };
}

test('native-only source preserves explicit read domain and guards project publication', async () => {
  const input = await setup(); const source = createGeometryEvidenceSource({ links: null, hasProject: id => id === input.projectId });
  const snapshot = await source.snapshot(input);
  assert.deepEqual(snapshot.input.native, input.native); assert.deepEqual(snapshot.input.linked, []);
  let committed = 0;
  assert.deepEqual(source.withCatalogGuard(input.projectId, 'different', () => ++committed), { kind: 'catalog-changed' });
  assert.equal(committed, 0);
  assert.deepEqual(source.withCatalogGuard(input.projectId, snapshot.catalogToken, () => ++committed), { kind: 'committed', value: 1 });
  await assert.rejects(source.snapshot({ ...input, projectId: 'other' }), /Unknown geometry project/);
  assert.throws(() => source.withCatalogGuard('other', snapshot.catalogToken, () => ++committed), /Unknown geometry project/);
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(source.snapshot({ ...input, signal: canceled.signal }));
  await assert.rejects(source.snapshot({ ...input, historicalRefs: [ref(input.projectId, evidenceWall())] }), /unavailable/);
});

test('only consumed retained pins are resolved and missing active sources remain explicit', async () => {
  const input = await setup(); const old = evidenceWall(); const current = evidenceWall({ version: 'v2', name: 'Changed property' });
  const historical = ref(input.projectId, old); const reads: unknown[] = [];
  const links: Pick<LinkedModelStore, 'snapshotCurrent' | 'resolveRetained' | 'withCatalogGuard'> = {
    snapshotCurrent(projectId) {
      assert.equal(projectId, input.projectId);
      return { catalogToken: 'catalog-v2', links: [{ linkId: 'source', generation: 2, versionId: 'v2', prepared: current }],
        unavailable: [{ linkId: 'missing-source', reason: 'Missing artifacts' }] };
    },
    resolveRetained(projectId, pin) {
      assert.equal(projectId, input.projectId); reads.push(pin);
      return { kind: 'ok', versionId: 'v1', prepared: old };
    },
    withCatalogGuard(projectId, token, commit) {
      assert.equal(projectId, input.projectId);
      return token === 'catalog-v2' ? { kind: 'committed', value: commit() } : { kind: 'catalog-changed' };
    },
  };
  const source = createGeometryEvidenceSource({ links, hasProject: id => id === input.projectId });
  const initial = await source.snapshot(input);
  assert.deepEqual(reads, [], 'initial construction does not load source history');
  assert.deepEqual(initial.input.unavailableSources, [{ id: 'missing-source', reason: 'Missing artifacts' }]);
  const updated = await source.snapshot({ ...input, historicalRefs: [historical, historical] });
  assert.equal(reads.length, 1, 'repeated consumed pins are resolved once');
  assert.deepEqual(updated.correspondences, [{ historical, current: ref(input.projectId, current) }]);
  assert.deepEqual(updated.input.native, input.native);
  await assert.rejects(source.snapshot({ ...input, historicalRefs: [{ ...historical, projectId: 'other' }] }), /authorized domain/);
  assert.equal(reads.length, 1, 'cross-project references do not reach source storage');
  assert.deepEqual(source.withCatalogGuard(input.projectId, 'stale', () => assert.fail('must not commit')), { kind: 'catalog-changed' });
});

test('unresolved, removed or reclassified identities never receive correspondence authority', async () => {
  const input = await setup(); const old = evidenceWall(); const current = evidenceWall({ version: 'v2' });
  const historical = ref(input.projectId, old); let available = false;
  const links: Pick<LinkedModelStore, 'snapshotCurrent' | 'resolveRetained' | 'withCatalogGuard'> = {
    snapshotCurrent: () => ({ catalogToken: 'current', links: [{ linkId: 'source', generation: 2, versionId: 'v2', prepared: current }], unavailable: [] }),
    resolveRetained: () => available ? { kind: 'ok', versionId: 'v1', prepared: old } : { kind: 'unavailable', reason: 'missing' },
    withCatalogGuard: (_projectId, _token, commit) => ({ kind: 'committed', value: commit() }),
  };
  const source = createGeometryEvidenceSource({ links, hasProject: id => id === input.projectId });
  assert.deepEqual((await source.snapshot({ ...input, historicalRefs: [historical] })).correspondences, []);
  available = true;
  const object = current.index.objects[0]; assert.ok(object); object.ifcClass = 'IfcDoor';
  assert.deepEqual((await source.snapshot({ ...input, historicalRefs: [historical] })).correspondences, []);
  current.index.objects = [];
  assert.deepEqual((await source.snapshot({ ...input, historicalRefs: [historical] })).correspondences, []);
});
