import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDemoServer } from './server.ts';
import type { DemoServer } from './server.ts';
import { createResidentialProject } from '../src/residential-floor.ts';
import { RoomRepository, diffSnapshots } from '../src/room-model.ts';
import { modelChanges } from '../src/model-delta-view.ts';
import { houseFixtureWorker } from './fixtures/versioned-house-agent.ts';

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function project(value: unknown): string {
  if (!object(value) || typeof value.project !== 'string') throw new Error('Expected a server project.');
  return value.project;
}
function ticket(value: unknown): Record<string, unknown> {
  if (!object(value) || !object(value.ticket)) throw new Error('Expected a request ticket.');
  return value.ticket;
}
async function call(server: DemoServer, target: string, body?: unknown): Promise<{ status: number; value: unknown }> {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected test TCP listener.');
  const bytes = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: address.port, path: target, method: bytes === undefined ? 'GET' : 'POST',
      headers: bytes === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve({ status: response.statusCode ?? 0, value }); }
        catch (error) { reject(error); }
      });
    });
    request.once('error', reject); request.end(bytes);
  });
}
async function start(file: string, repository: RoomRepository, wait?: () => Promise<void>): Promise<DemoServer> {
  const server = await createDemoServer({ backlogFile: file, modelWorker: houseFixtureWorker(repository, wait) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}
async function stop(server: DemoServer): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await server.closeModelWorkers();
}
async function ready(server: DemoServer, id: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await call(server, `/api/change-requests/${id}`);
    assert.equal(response.status, 200);
    const current = ticket(response.value);
    if (current.state === 'ready') return current;
    assert.ok(current.state === 'queued' || current.state === 'working', JSON.stringify(current));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('House request did not become reviewable within its test deadline.');
}

for (const order of [['office-desk', 'main-bed'], ['main-bed', 'office-desk']]) {
  test(`house HTTP workflow survives ${order.join(' then ')} acceptance and restart`, { timeout: 180_000 }, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-house161-'));
    const repository = await createResidentialProject('Versioned house integration');
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let server = await start(path.join(directory, 'house.sqlite'), repository, () => gate);
    let closed = false;
    t.after(async () => { release(); if (!closed) await stop(server); await fs.rm(directory, { recursive: true, force: true }); });
    const registration = await call(server, '/api/projects', { project: repository.serialize() });
    assert.ok(registration.status === 200 || registration.status === 201);
    const source = await RoomRepository.restore(project(registration.value));
    assert.equal(source.head('main'), repository.head('main'));
    for (const id of order) {
      const acknowledgement = await call(server, '/api/change-requests', { project: repository.serialize(), request: {
        requestId: id, proposalName: id, baseRevisionId: repository.head('main'), selectedObjectIds: [id],
        instruction: 'Widen the selected furnishing by 0.2 m.', visualIntent: { kind: 'selection' },
      } });
      assert.equal(acknowledgement.status, 202, JSON.stringify(acknowledgement.value));
      assert.ok(['queued', 'working'].includes(String(ticket(acknowledgement.value).state)));
    }
    const untouched = await call(server, `/api/projects/${repository.projectId}`);
    assert.equal((await RoomRepository.restore(project(untouched.value))).head('main'), repository.head('main'));
    release();
    for (const id of order) {
      const proposed = await ready(server, id);
      assert.ok(object(proposed.result));
      const draft = await RoomRepository.restore(project(proposed.result));
      const changes = modelChanges(repository.view(repository.head('main')).snapshot, draft.view(draft.head(id)).snapshot);
      assert.deepEqual(changes.map((change) => change.id), [id], 'Existing 3D review receives the isolated object delta.');
    }
    for (const id of order) {
      const accepted = await call(server, `/api/change-requests/${id}/decision`, { action: 'accept', decisionId: `accept-${id}`, expectedRequestId: id });
      assert.equal(accepted.status, 200, JSON.stringify(accepted.value));
      assert.equal(ticket(accepted.value).state, 'completed');
    }
    const current = await call(server, `/api/projects/${repository.projectId}`);
    const accepted = await RoomRepository.restore(project(current.value));
    const delta = diffSnapshots(repository.view(repository.head('main')).snapshot, accepted.view(accepted.head('main')).snapshot);
    assert.deepEqual(delta.entities.modified.map((item) => item.id).sort(), ['main-bed', 'office-desk']);
    assert.deepEqual(delta.relationships, { added: [], removed: [], modified: [] });
    const staleImport = await call(server, '/api/projects', { project: repository.serialize() });
    assert.equal(staleImport.status, 200);
    assert.equal((await RoomRepository.restore(project(staleImport.value))).head('main'), accepted.head('main'), 'Browser recovery cannot roll accepted state back.');
    await stop(server); closed = true;
    server = await start(path.join(directory, 'house.sqlite'), repository); closed = false;
    const recovered = await call(server, `/api/projects/${repository.projectId}`);
    assert.equal((await RoomRepository.restore(project(recovered.value))).head('main'), accepted.head('main'));
    const listing = await call(server, '/api/projects');
    assert.equal(listing.status, 200);
    assert.ok(object(listing.value) && Array.isArray(listing.value.projects));
    assert.equal(listing.value.projects.length, 1);
    const seen = new Set<string>(); let cursor: string | null = null;
    do {
      const page = await call(server, `/api/projects/${repository.projectId}/history?limit=1${cursor ? `&before=${cursor}` : ''}`);
      assert.equal(page.status, 200);
      assert.ok(object(page.value) && Array.isArray(page.value.entries));
      assert.equal(page.value.entries.length, 1);
      const entry: unknown = page.value.entries[0]; assert.ok(object(entry) && typeof entry.revisionId === 'string');
      assert.ok(!seen.has(entry.revisionId)); seen.add(entry.revisionId);
      assert.ok(page.value.nextCursor === null || typeof page.value.nextCursor === 'string'); cursor = page.value.nextCursor;
    } while (cursor);
    assert.equal(seen.size, 3, 'Accepted history contains two changes and the initial model, excluding private proposal branches.');
    for (const id of order) {
      const replay = await call(server, `/api/change-requests/${id}/decision`, { action: 'accept', decisionId: `accept-${id}`, expectedRequestId: id });
      assert.equal(replay.status, 200);
      assert.equal((await RoomRepository.restore(project(replay.value))).head('main'), accepted.head('main'));
      const detail = ticket((await call(server, `/api/change-requests/${id}`)).value);
      assert.equal(detail.state, 'completed'); assert.ok(Array.isArray(detail.executions) && detail.executions.length > 0);
    }
  });
}
