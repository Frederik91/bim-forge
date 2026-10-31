import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { ChangeRequests, BacklogConflict } from './change-requests.ts';
import { RoomRepository, rectangleLayout } from '../src/room-model.ts';
import type { ModelWorker } from '../src/model-proposal.ts';
import type { PlacedTask } from '../src/task-placement.ts';
import { parseRequestConversation } from '../src/request-conversation.ts';
import { parseTaskPlacement } from '../src/task-placement.ts';
import { FixtureGeometrySource, evidenceWall } from '../src/geometry-evidence.fixture.ts';
import { geometryDigest } from '../src/geometry-query.ts';
import { resolveTaskPlacement } from './task-placement.ts';
import { createDemoServer } from './server.ts';

function placed(repo: RoomRepository, regionOnly = false): PlacedTask {
  const snapshot = { projectId: repo.projectId, target: { kind: 'main' }, revisionId: repo.head('main') } satisfies PlacedTask['origin']['snapshot'];
  return { version: 1, kind: 'placed', origin: { snapshot, frame: 'project-engineering-metres', point: [2, 3, 1.6], view: '3d', levelId: null },
    targets: { objects: regionOnly ? [] : [{ kind: 'native', ...snapshot, entityId: 'door-entry' }],
      regions: [{ snapshot, markup: { kind: 'circle', center: [5, 6, 0], normal: [0, 0, 1], radius: 2, label: 'Entry region' } }] } };
}
function request(repo: RoomRepository, requestId: string, taskPlacement?: PlacedTask) {
  return { requestId, baseRevisionId: repo.head('main'), selectedObjectIds: taskPlacement?.targets.objects.flatMap(ref => ref.kind === 'native' ? [ref.entityId] : []) ?? ['door-entry'],
    instruction: 'Inspect this explicit context.', visualIntent: { kind: 'selection' }, ...(taskPlacement ? { taskPlacement } : {}) };
}
async function settled(queue: ChangeRequests, id: string) {
  for (let i = 0; i < 1000; i++) {
    if (['ready', 'failed', 'needs-input'].includes(queue.get(id).state)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Placement worker did not settle.');
}
const clarify: ModelWorker = { identity: { provider: 'fixture', model: 'placement' }, async run(session) {
  const result = await session.executeTool('run_model_script', { language: 'javascript', source: "return {kind:'clarify',question:'Which width?',options:['1100 mm']};" });
  assert.equal(result.done, true);
} };

test('two same-place tickets retain mixed targets and atomic lost-ack replay after restart and follow-up', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task-placement-254-'));
  const file = path.join(directory, 'queue.sqlite');
  const repo = await RoomRepository.create(); const origin = placed(repo);
  let queue = await ChangeRequests.open(file, () => null);
  t.after(async () => { await queue.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const envelope = request(repo, 'first-place', origin);
  await queue.submit(repo.serialize(), envelope);
  await queue.submit(repo.serialize(), request(repo, 'second-place', origin));
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  assert.equal((await queue.submit(repo.serialize(), envelope)).id, 'first-place');
  assert.equal(queue.list(repo.projectId).length, 2);
  assert.equal(queue.get('first-place').conversation?.messages.length, 1);
  await assert.rejects(queue.submit(repo.serialize(), { ...envelope, instruction: 'Changed input.' }), BacklogConflict);
  await assert.rejects(queue.submit(repo.serialize(), { ...envelope, taskPlacement: { ...origin, origin: { ...origin.origin, point: [9, 9, 9] } } }), BacklogConflict);
  await queue.appendMessage('first-place', { messageId: 'follow-up', expectedSequence: 1, baseRevisionId: repo.head('main'), text: 'Use 1100 mm.', sources: [], visual: null });
  assert.deepEqual(queue.get('first-place').taskPlacement, origin);
  assert.deepEqual(queue.get('second-place').taskPlacement, origin);
  assert.equal(queue.get('first-place').request.requestId, 'follow-up');
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  assert.deepEqual(queue.get('first-place').conversation?.taskPlacement, origin);
  assert.equal(queue.get('first-place').conversation?.messages.filter(message => message.kind === 'user').length, 2);
  assert.equal(queue.project(repo.projectId), repo.serialize());
});

test('region-only worker receives exact region with zero object IDs; revision retains captured origin', async t => {
  const repo = await RoomRepository.create(); const origin = placed(repo, true);
  let saw = false;
  const worker: ModelWorker = { ...clarify, async run(session) {
    assert.ok(session.input && typeof session.input === 'object' && 'conversation' in session.input);
    const conversation = parseRequestConversation(session.input.conversation);
    assert.deepEqual(conversation.taskPlacement, origin);
    assert.equal(conversation.messages.find(message => message.kind === 'user')?.visual, null);
    saw = true; await clarify.run(session);
  } };
  const queue = await ChangeRequests.open(':memory:', () => worker); t.after(() => queue.close());
  await queue.submit(repo.serialize(), request(repo, 'region-only', origin)); await settled(queue, 'region-only');
  assert.equal(saw, true); assert.deepEqual(queue.get('region-only').request.selectedObjectIds, []);
  await assert.rejects(queue.revise('region-only', repo.serialize(), { ...request(repo, 'changed-origin', origin), taskPlacement: { ...origin, origin: { ...origin.origin, point: [1, 2, 3] } } }), BacklogConflict);
  await queue.revise('region-only', repo.serialize(), { ...request(repo, 'explicit-new-context', origin), conversationVisual: { snapshot: { kind: 'accepted', revisionId: repo.head('main') }, view: '2d', levelId: null, selectedObjectIds: [], annotations: [] } });
  assert.deepEqual(queue.get('region-only').taskPlacement, origin);
  assert.equal(rectangleLayout(repo.view(repo.head('main')).snapshot).door.widthMm, rectangleLayout((await RoomRepository.restore(queue.project(repo.projectId))).view(repo.head('main')).snapshot).door.widthMm);
});

test('invalid pins and coordinates reject before ticket, message, submission or project registration is committed', async t => {
  const queue = await ChangeRequests.open(':memory:', () => null); t.after(() => queue.close());
  const repo = await RoomRepository.create(); const origin = placed(repo);
  for (const point of [[NaN, 0, 0], [Infinity, 0, 0], [1000001, 0, 0]]) assert.throws(() => parseTaskPlacement({ ...origin, origin: { ...origin.origin, point } }));
  assert.throws(() => parseTaskPlacement({ ...origin, origin: { ...origin.origin, frame: 'viewer' } }));
  for (const input of [
    { ...origin, origin: { ...origin.origin, snapshot: { ...origin.origin.snapshot, projectId: 'different' } } },
    { ...origin, origin: { ...origin.origin, snapshot: { ...origin.origin.snapshot, revisionId: 'a'.repeat(64) } } },
    { ...origin, targets: { ...origin.targets, objects: [{ kind: 'native', ...origin.origin.snapshot, entityId: 'missing-door' }] } },
    { ...origin, origin: { ...origin.origin, levelId: 'door-entry' } },
  ]) await assert.rejects(queue.submit(repo.serialize(), { ...request(repo, 'invalid'), taskPlacement: input }));
  assert.deepEqual(queue.list(repo.projectId), []); assert.equal(queue.project(repo.projectId), null);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task-placement-atomic-'));
  const file = path.join(directory, 'queue.sqlite');
  const persisted = await ChangeRequests.open(file, () => null);
  try {
    await assert.rejects(persisted.submit(repo.serialize(), { ...request(repo, 'source-failure', origin), sources: [{ id: '18100000-0000-4000-8000-000000000001', name: 'missing.md', mediaType: 'text/markdown', byteLength: 1, sha256: 'b'.repeat(64) }] }));
  } finally { await persisted.close(); }
  const db = new DatabaseSync(file);
  try { for (const table of ['requests', 'submissions', 'request_messages', 'projects']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0); }
  finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('legacy tasks remain explicitly unplaced; recovery is durable, append-only and idempotent', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task-placement-legacy-'));
  const file = path.join(directory, 'queue.sqlite'); const repo = await RoomRepository.create();
  let queue = await ChangeRequests.open(file, () => null);
  t.after(async () => { await queue.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await queue.submit(repo.serialize(), request(repo, 'legacy'));
  assert.deepEqual(queue.get('legacy').taskPlacement, { version: 1, kind: 'unplaced', reason: 'not-provided' });
  await queue.close();
  const db = new DatabaseSync(file);
  db.prepare("UPDATE requests SET body=json_remove(body,'$.taskPlacement','$.placementRecoveries') WHERE id='legacy'").run(); db.close();
  queue = await ChangeRequests.open(file, () => null);
  assert.deepEqual(queue.list(repo.projectId)[0]?.taskPlacement, { version: 1, kind: 'unplaced', reason: 'legacy' });
  assert.deepEqual((await queue.placement('legacy')).resolution, { kind: 'unplaced' });
  const command = { recoveryId: 'recover-once', expectedSequence: 1, placement: placed(repo) };
  await queue.recoverPlacement('legacy', command);
  await queue.recoverPlacement('legacy', command);
  await assert.rejects(queue.recoverPlacement('legacy', { ...command, placement: placed(repo, true) }), BacklogConflict);
  await assert.rejects(queue.recoverPlacement('legacy', { ...command, recoveryId: 'stale-recovery', expectedSequence: 0 }), BacklogConflict);
  await queue.appendMessage('legacy', { messageId: 'after-recovery', expectedSequence: 1, baseRevisionId: repo.head('main'), text: 'Continue here.', sources: [], visual: null });
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  const read = await queue.placement('legacy');
  assert.equal(read.taskPlacement.kind, 'unplaced'); assert.deepEqual(read.effectivePlacement, command.placement);
  assert.equal(read.placementRecoveries.length, 1); assert.equal(queue.get('legacy').conversation?.placementRecoveries?.length, 1);
  assert.equal(queue.project(repo.projectId), repo.serialize());
});

test('exact linked pins are admitted atomically; stale, missing, unavailable and moved occurrences never retarget', async t => {
  const repo = await RoomRepository.create(); const geometry = new FixtureGeometrySource(); const prepared = evidenceWall();
  const object = prepared.index.objects[0]; assert.ok(object);
  const linked = { kind: 'ifc', projectId: repo.projectId, ...object.ref, occurrenceId: prepared.manifest.occurrence.id,
    placementDigest: geometryDigest(prepared.manifest.occurrence.sourceToProjectMetres) } satisfies PlacedTask['targets']['objects'][number];
  const origin = placed(repo); origin.origin.source = linked; origin.targets.objects.push(linked);
  const region = origin.targets.regions[0]; assert.ok(region); region.source = linked;
  const queue = await ChangeRequests.open(':memory:', () => null, { geometry }); t.after(() => queue.close());
  await queue.submit(repo.serialize(), request(repo, 'linked-exact', origin));
  assert.equal((await queue.placement('linked-exact')).resolution.kind, 'placed');
  for (const next of [evidenceWall({ version: 'v2' }), evidenceWall({ x: 3 })]) {
    geometry.replace([next]);
    await assert.rejects(queue.submit(repo.serialize(), request(repo, 'linked-stale', origin)), BacklogConflict);
    const read = await queue.placement('linked-exact'); assert.equal(read.resolution.kind === 'placed' && read.resolution.requiresRecovery, true);
    assert.deepEqual(read.taskPlacement, origin);
  }
  geometry.replace([]);
  const missing = await queue.placement('linked-exact'); assert.equal(missing.resolution.kind === 'placed' && missing.resolution.objects[1]?.status, 'missing');
  geometry.unavailableSources = [{ id: 'source', reason: 'Bytes missing' }];
  const unavailable = await queue.placement('linked-exact'); assert.equal(unavailable.resolution.kind === 'placed' && unavailable.resolution.objects[1]?.status, 'unavailable');
  geometry.replace([prepared]); geometry.unavailableSources = []; geometry.onGuard = () => geometry.replace([evidenceWall({ x: 5 })]);
  await assert.rejects(queue.submit(repo.serialize(), request(repo, 'linked-race', origin)), BacklogConflict);
  assert.equal(queue.list(repo.projectId).length, 1);
  const retained = structuredClone(origin); retained.targets.objects = [{ kind: 'native', ...origin.origin.snapshot, entityId: 'deleted-door' }];
  assert.equal(resolveTaskPlacement(retained, repo).kind === 'placed', true);
  const resolution = resolveTaskPlacement(retained, repo); assert.equal(resolution.kind === 'placed' && resolution.objects[0]?.status, 'missing');
});

test('failed attempt, explicit retry and restart preserve the historical origin and numeric attempt identity', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task-placement-retry-'));
  const file = path.join(directory, 'queue.sqlite'); const repo = await RoomRepository.create(); const origin = placed(repo);
  let runs = 0;
  const worker: ModelWorker = { ...clarify, async run(session) {
    if (++runs === 1) throw new Error('Deterministic temporary fixture failure.');
    await clarify.run(session);
  } };
  let queue = await ChangeRequests.open(file, () => worker);
  t.after(async () => { await queue.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await queue.submit(repo.serialize(), request(repo, 'retry-place', origin)); await settled(queue, 'retry-place');
  assert.equal(queue.get('retry-place').state, 'failed'); assert.equal(queue.get('retry-place').attempts, 1);
  await queue.decide('retry-place', { action: 'retry', decisionId: 'retry-this-attempt', expectedRequestId: 'retry-place' });
  await settled(queue, 'retry-place');
  assert.equal(queue.get('retry-place').state, 'needs-input'); assert.equal(queue.get('retry-place').attempts, 2);
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  assert.deepEqual(queue.get('retry-place').taskPlacement, origin); assert.equal(queue.get('retry-place').attempts, 2);
  assert.equal(queue.get('retry-place').conversation?.messages.filter(message => message.kind === 'user').length, 1);
});

test('placement HTTP preserves existing origin guards, exact recovery parsing and read-only decisions', { timeout: 15000 }, async t => {
  const server = await createDemoServer({ modelWorker: null, codex: null });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await server.closeModelWorkers(); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const send = (route: string, method = 'GET', value?: unknown, origin?: string): Promise<{ status: number; body: unknown }> => new Promise((resolve, reject) => {
    const call = http.request({ host: '127.0.0.1', port: address.port, path: route, method, agent: false,
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(body) }));
    });
    call.on('error', reject); call.setTimeout(5000, () => call.destroy(new Error('Placement HTTP timed out.')));
    call.end(value === undefined ? undefined : JSON.stringify(value));
  });
  const repo = await RoomRepository.create();
  assert.equal((await send('/api/change-requests', 'POST', { project: repo.serialize(), request: request(repo, 'http-placement') })).status, 202);
  const route = '/api/change-requests/http-placement/placement';
  assert.equal((await send(route)).status, 200);
  const command = { recoveryId: 'http-recovery', expectedSequence: 1, placement: placed(repo) };
  assert.equal((await send(route, 'POST', command, 'https://other.example')).status, 400);
  assert.equal((await send(route, 'POST', { ...command, approved: true })).status, 400);
  assert.equal((await send(route, 'POST', command)).status, 200);
  assert.equal((await send(route, 'POST', command)).status, 200);
  assert.equal((await send(route, 'POST', { ...command, placement: placed(repo, true) })).status, 409);
  assert.equal((await send(route, 'DELETE')).status, 405);
  assert.equal((await send('/api/change-requests/http-placement/decision', 'POST', { action: 'accept', decisionId: 'cannot-accept-metadata', expectedRequestId: 'http-placement' })).status, 409);
});
