import assert from 'node:assert/strict';
import path from 'node:path';
import type { TestContext } from 'node:test';
import type { ChangeRequests, RequestState } from '../../../demo/change-requests.ts';
import { temporaryRequestResources } from '../../../demo/request-test-resources.ts';
import { RoomRepository, diffSnapshots } from '../../../src/room-model.ts';
import type { ModelSnapshot } from '../../../src/room-model.ts';
import { spatialAcceptanceFixture, spatialDoorFacts, spatialFixtureManifest } from './fixture.ts';
import { spatialFixtureWorker } from './worker.ts';

/** One asynchronous resource owner drains workers and SQLite before deleting bytes. */
export async function spatialQueueFixture(test: TestContext, worker = spatialFixtureWorker()) {
  const resources = temporaryRequestResources(test, 'spatial-acceptance-264-');
  const file = path.join(resources.directory, 'queue.sqlite');
  const fixture = await spatialAcceptanceFixture();
  const queue = await resources.openQueue(file, () => worker);
  return { ...fixture, queue, resources, file };
}

export async function spatialWaitFor(queue: ChangeRequests, id: string,
  states: readonly RequestState[] = ['ready', 'needs-input', 'failed']) {
  const deadline = Date.now() + 30000;
  while (!states.includes(queue.get(id).state)) {
    assert.ok(Date.now() < deadline, `Spatial task ${id} timed out: ${JSON.stringify(queue.get(id))}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return queue.get(id);
}

export async function spatialAcceptedSnapshot(queue: ChangeRequests, projectId = spatialFixtureManifest.projectId) {
  const repository = await RoomRepository.restore(queue.project(projectId));
  return repository.view(repository.head('main')).snapshot;
}

/** Independent facts and full delta: no omitted additions, removals or unrelated fields. */
export function assertSpatialDoorDelta(before: ModelSnapshot, after: ModelSnapshot,
  expected: ModelSnapshot) {
  assert.deepEqual(after, expected);
  assert.deepEqual(diffSnapshots(before, after), diffSnapshots(before, expected));
  assert.deepEqual(spatialDoorFacts(after), { width: 1.1, offset: 2.9,
    centre: [4, 3.45, 0], hostId: spatialFixtureManifest.hostId, wallId: spatialFixtureManifest.wallId });
}
