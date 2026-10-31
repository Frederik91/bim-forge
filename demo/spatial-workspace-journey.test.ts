import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRepository } from '../src/room-model.ts';
import { parseRequestConversation } from '../src/request-conversation.ts';
import { BacklogConflict } from './change-requests.ts';
import { resolveTaskPlacement } from './task-placement.ts';
import { spatialFixtureRequest, spatialFixturePlacement, spatialMissingTargetPlacement,
  spatialUnplacedFixture, spatialFixtureManifest } from '../tests/fixtures/spatial-workspace/fixture.ts';
import { spatialFixtureWorker, spatialWorkerGate } from '../tests/fixtures/spatial-workspace/worker.ts';
import { spatialQueueFixture, spatialWaitFor, spatialAcceptedSnapshot,
  assertSpatialDoorDelta } from '../tests/fixtures/spatial-workspace/harness.ts';

test('real queued WASM proposal survives restart, preserves centre/host/full delta and publishes only on explicit acceptance', async t => {
  const fixture = await spatialQueueFixture(t);
  const { repository, snapshot, expected, resources, file, baseRevisionId } = fixture;
  let queue = fixture.queue;
  const request = spatialFixtureRequest(repository, spatialFixtureManifest.taskIds.first);
  await queue.submit(repository.serialize(), request);
  const ready = await spatialWaitFor(queue, request.requestId);
  assert.equal(ready.state, 'ready', ready.error ?? ''); assert.ok(ready.result);
  const proposed = await RoomRepository.restore(ready.result.project);
  const review = proposed.review(ready.request.proposalName);
  assert.equal(proposed.head('main'), baseRevisionId);
  assert.equal(review.decision.status, 'pending');
  assert.deepEqual(review.scope?.writableIds, [spatialFixtureManifest.doorId]);
  assert.equal(review.scriptExecutions?.[0]?.validation, 'passed');
  assertSpatialDoorDelta(snapshot, proposed.view(review.proposalRevisionId).snapshot, expected);
  assert.deepEqual(await spatialAcceptedSnapshot(queue), snapshot);
  await queue.close(); queue = await resources.openQueue(file, () => null);
  assert.equal(queue.get(request.requestId).state, 'ready');
  assert.deepEqual(queue.get(request.requestId).taskPlacement, request.taskPlacement);
  assert.deepEqual(await spatialAcceptedSnapshot(queue), snapshot);
  const decision = { action: 'accept', decisionId: 'accept-spatial-first', expectedRequestId: request.requestId };
  const accepted = await queue.decide(request.requestId, decision);
  assert.equal(accepted.ticket.state, 'completed');
  assert.deepEqual(accepted.ticket.taskPlacement, request.taskPlacement);
  const placement = await queue.placement(request.requestId);
  assert.equal(placement.resolution.kind, 'placed');
  if (placement.resolution.kind === 'placed') assert.equal(placement.resolution.objects[0]?.status, 'stale');
  assertSpatialDoorDelta(snapshot, await spatialAcceptedSnapshot(queue), expected);
  const acceptedBytes = queue.project(repository.projectId);
  await queue.decide(request.requestId, decision);
  assert.equal(queue.project(repository.projectId), acceptedBytes);
  await queue.close(); queue = await resources.openQueue(file, () => null);
  assert.equal(queue.get(request.requestId).state, 'completed');
  assertSpatialDoorDelta(snapshot, await spatialAcceptedSnapshot(queue), expected);
});

test('same-door tasks keep separate identities; replay, follow-up and reload retain immutable source-pinned origins', async t => {
  const fixture = await spatialQueueFixture(t);
  const { repository, resources, file, snapshot } = fixture;
  let queue = fixture.queue;
  const first = spatialFixtureRequest(repository, spatialFixtureManifest.taskIds.first, 'objects-and-region');
  const second = spatialFixtureRequest(repository, spatialFixtureManifest.taskIds.second, 'objects-and-region');
  await queue.submit(repository.serialize(), first); await queue.submit(repository.serialize(), second);
  await spatialWaitFor(queue, first.requestId); await spatialWaitFor(queue, second.requestId);
  await queue.close(); queue = await resources.openQueue(file, () => null);
  assert.equal((await queue.submit(repository.serialize(), first)).id, first.requestId);
  assert.equal(queue.list(repository.projectId).length, 2);
  await assert.rejects(queue.submit(repository.serialize(), { ...first, taskPlacement: {
    ...first.taskPlacement, origin: { ...first.taskPlacement.origin, point: [9, 9, 9] } } }), BacklogConflict);
  const sequence = queue.get(first.requestId).conversation?.sequence; assert.ok(sequence);
  const reply = { messageId: 'spatial-follow-up', expectedSequence: sequence, baseRevisionId: repository.head('main'),
    text: 'Keep the same host and centre.', sources: [], visual: null };
  await queue.appendMessage(first.requestId, reply); await queue.appendMessage(first.requestId, reply);
  await queue.close(); queue = await resources.openQueue(file, () => null);
  for (const id of [first.requestId, second.requestId]) {
    assert.deepEqual(queue.get(id).taskPlacement, first.taskPlacement);
    assert.deepEqual(queue.get(id).conversation?.taskPlacement, first.taskPlacement);
  }
  assert.equal(queue.get(first.requestId).request.requestId, reply.messageId);
  assert.equal(queue.get(second.requestId).request.requestId, second.requestId);
  assert.equal(queue.get(first.requestId).conversation?.messages.filter(message => message.id === reply.messageId).length, 1);
  assert.deepEqual(await spatialAcceptedSnapshot(queue), snapshot);
});

test('region-only worker gets zero object IDs and real clarification; no nearby door is silently selected', async t => {
  let observed = false;
  const fixture = await spatialQueueFixture(t, spatialFixtureWorker({ mode: 'region-context', inspectInput(input) {
    assert.ok(input && typeof input === 'object' && 'conversation' in input && 'request' in input);
    const conversation = parseRequestConversation(input.conversation);
    assert.deepEqual(conversation.taskPlacement, spatialFixturePlacement(fixture.repository, 'region'));
    assert.ok(input.request && typeof input.request === 'object' && 'selectedObjectIds' in input.request);
    assert.deepEqual(input.request.selectedObjectIds, []); observed = true;
  } }));
  const { queue, repository, snapshot } = fixture;
  const request = spatialFixtureRequest(repository, spatialFixtureManifest.taskIds.region, 'region');
  await queue.submit(repository.serialize(), request);
  const waiting = await spatialWaitFor(queue, request.requestId);
  assert.equal(observed, true); assert.equal(waiting.state, 'needs-input', waiting.error ?? '');
  assert.ok(waiting.conversation?.messages.some(message => message.kind === 'assistant'
    && message.content.kind === 'clarification'));
  assert.deepEqual(waiting.request.selectedObjectIds, []);
  await assert.rejects(queue.decide(request.requestId, { action: 'accept', decisionId: 'region-cannot-accept',
    expectedRequestId: request.requestId }), BacklogConflict);
  assert.deepEqual(await spatialAcceptedSnapshot(queue), snapshot);
});

test('legacy and explicitly unplaced tasks stay discoverable; missing target retains its historic identity without retargeting', async t => {
  const fixture = await spatialQueueFixture(t);
  const { repository, resources, file, snapshot } = fixture;
  await fixture.queue.close();
  let queue = await resources.openQueue(file, () => null);
  const { taskPlacement: omitted, ...legacyRequest } = spatialFixtureRequest(repository, 'spatial-legacy');
  assert.equal(omitted.kind, 'placed');
  await queue.submit(repository.serialize(), legacyRequest);
  await queue.submit(repository.serialize(), { ...spatialFixtureRequest(repository, 'spatial-unplaced'),
    taskPlacement: spatialUnplacedFixture('not-provided') });
  await queue.close();
  const database = resources.openDatabase(file);
  database.prepare("UPDATE requests SET body=json_remove(body,'$.taskPlacement','$.placementRecoveries') WHERE id='spatial-legacy'").run();
  database.close(); queue = await resources.openQueue(file, () => null);
  assert.deepEqual(queue.get('spatial-legacy').taskPlacement, spatialUnplacedFixture('legacy'));
  assert.deepEqual(queue.get('spatial-unplaced').taskPlacement, spatialUnplacedFixture('not-provided'));
  assert.deepEqual((await queue.placement('spatial-legacy')).resolution, { kind: 'unplaced' });
  assert.equal(queue.list(repository.projectId).length, 2);
  const missing = spatialMissingTargetPlacement(repository);
  const resolution = resolveTaskPlacement(missing, repository);
  assert.equal(resolution.kind, 'placed');
  if (resolution.kind === 'placed') {
    assert.equal(resolution.objects[0]?.status, 'missing'); assert.equal(resolution.requiresRecovery, true);
    assert.equal(resolution.origin.status, 'current');
  }
  await assert.rejects(queue.submit(repository.serialize(), { ...spatialFixtureRequest(repository, 'missing-target'),
    selectedObjectIds: ['missing-spatial-door'], taskPlacement: missing }));
  assert.equal(queue.list(repository.projectId).length, 2);
  assert.deepEqual(await spatialAcceptedSnapshot(queue), snapshot);
});

test('cancelled real proposal returns late without replacing task state or accepted geometry', { timeout: 30000 }, async t => {
  const gate = spatialWorkerGate();
  const { queue, repository, snapshot, resources, file } = await spatialQueueFixture(t, spatialFixtureWorker({ afterScript: gate.afterScript }));
  const request = spatialFixtureRequest(repository, 'spatial-cancel');
  await queue.submit(repository.serialize(), request); await gate.reached;
  assert.equal(queue.get(request.requestId).state, 'working');
  await queue.decide(request.requestId, { action: 'cancel', decisionId: 'cancel-spatial', expectedRequestId: request.requestId });
  await gate.finished;
  assert.deepEqual(await spatialAcceptedSnapshot(queue), snapshot);
  await queue.close();
  const reopened = await resources.openQueue(file, () => null);
  assert.equal(reopened.get(request.requestId).state, 'cancelled');
  assert.equal(reopened.get(request.requestId).result, null);
  assert.deepEqual(reopened.get(request.requestId).taskPlacement, request.taskPlacement);
  assert.deepEqual(await spatialAcceptedSnapshot(reopened), snapshot);
});

test('superseding a staged real result preserves newer turn and stale reviewed turns cannot accept', { timeout: 30000 }, async t => {
  const gate = spatialWorkerGate(); let runs = 0;
  const fixture = await spatialQueueFixture(t, spatialFixtureWorker({ afterScript: async session => {
    if (++runs === 1) await gate.afterScript(session);
  } }));
  const { queue, repository, snapshot } = fixture;
  const request = spatialFixtureRequest(repository, 'spatial-superseded');
  await queue.submit(repository.serialize(), request); await gate.reached;
  const sequence = queue.get(request.requestId).conversation?.sequence; assert.ok(sequence);
  await queue.appendMessage(request.requestId, { messageId: 'spatial-new-turn', expectedSequence: sequence,
    baseRevisionId: repository.head('main'), text: request.instruction, sources: [], visual: null });
  await gate.finished;
  const ready = await spatialWaitFor(queue, request.requestId);
  assert.equal(ready.state, 'ready', ready.error ?? ''); assert.equal(ready.request.requestId, 'spatial-new-turn');
  assert.deepEqual(ready.taskPlacement, request.taskPlacement);
  assert.ok(ready.conversation?.messages.some(message => message.kind === 'assistant' && message.requestId === request.requestId
    && message.content.kind === 'explanation'));
  assert.equal(ready.conversation?.messages.filter(message => message.kind === 'assistant' && message.requestId === request.requestId
    && message.content.kind === 'proposal').length, 0);
  await assert.rejects(queue.decide(request.requestId, { action: 'accept', decisionId: 'stale-turn-accept',
    expectedRequestId: request.requestId }), BacklogConflict);
  assert.deepEqual(await spatialAcceptedSnapshot(queue), snapshot);
});

test('competing proposals on the same door require refreshed review after the first acceptance', async t => {
  const { queue, repository, snapshot, expected } = await spatialQueueFixture(t);
  for (const id of ['spatial-conflict-first', 'spatial-conflict-second']) {
    await queue.submit(repository.serialize(), spatialFixtureRequest(repository, id));
    assert.equal((await spatialWaitFor(queue, id)).state, 'ready');
  }
  await queue.decide('spatial-conflict-first', { action: 'accept', decisionId: 'accept-first-conflict', expectedRequestId: 'spatial-conflict-first' });
  assert.equal(queue.get('spatial-conflict-second').state, 'needs-input');
  await assert.rejects(queue.decide('spatial-conflict-second', { action: 'accept', decisionId: 'reject-stale-accept',
    expectedRequestId: 'spatial-conflict-second' }), BacklogConflict);
  assertSpatialDoorDelta(snapshot, await spatialAcceptedSnapshot(queue), expected);
  assert.ok(queue.get('spatial-conflict-second').result, 'Conflicting proposal stays inspectable.');
});

test('interrupted real proposal restarts as the next bounded attempt with no duplicate task or publication', { timeout: 30000 }, async t => {
  const gate = spatialWorkerGate();
  const fixture = await spatialQueueFixture(t, spatialFixtureWorker({ afterScript: gate.afterScript }));
  const { repository, resources, file, snapshot, expected } = fixture;
  let queue = fixture.queue;
  const request = spatialFixtureRequest(repository, 'spatial-interrupted');
  await queue.submit(repository.serialize(), request); await gate.reached;
  assert.equal(queue.get(request.requestId).attempts, 1);
  await queue.close();
  queue = await resources.openQueue(file, () => spatialFixtureWorker());
  const ready = await spatialWaitFor(queue, request.requestId);
  assert.equal(ready.state, 'ready', ready.error ?? ''); assert.equal(ready.attempts, 2);
  assert.equal(queue.list(repository.projectId).length, 1);
  assert.deepEqual(ready.taskPlacement, request.taskPlacement);
  assert.ok(ready.activity.some(event => event.stage === 'recovered'));
  assert.deepEqual(await spatialAcceptedSnapshot(queue), snapshot); assert.ok(ready.result);
  const proposed = await RoomRepository.restore(ready.result.project);
  assertSpatialDoorDelta(snapshot, proposed.view(proposed.review(ready.request.proposalName).proposalRevisionId).snapshot, expected);
});

test('deterministic failed worker keeps geometry unchanged and explicit retry preserves attempt/origin through reload', async t => {
  let runs = 0;
  const fixture = await spatialQueueFixture(t, spatialFixtureWorker({ afterScript: async () => {
    if (++runs === 1) throw new Error('Intentional offline fixture failure after script execution.');
  } }));
  const { repository, resources, file, snapshot } = fixture;
  let queue = fixture.queue;
  const request = spatialFixtureRequest(repository, 'spatial-retry');
  await queue.submit(repository.serialize(), request);
  const failed = await spatialWaitFor(queue, request.requestId);
  assert.equal(failed.state, 'failed'); assert.match(failed.error ?? '', /Intentional offline fixture failure/);
  assert.deepEqual(await spatialAcceptedSnapshot(queue), snapshot);
  await queue.decide(request.requestId, { action: 'retry', decisionId: 'retry-spatial-worker', expectedRequestId: request.requestId });
  const ready = await spatialWaitFor(queue, request.requestId);
  assert.equal(ready.state, 'ready', ready.error ?? ''); assert.equal(ready.attempts, 2);
  await queue.close(); queue = await resources.openQueue(file, () => null);
  assert.equal(queue.get(request.requestId).attempts, 2);
  assert.deepEqual(queue.get(request.requestId).taskPlacement, request.taskPlacement);
  assert.deepEqual(await spatialAcceptedSnapshot(queue), snapshot);
});
