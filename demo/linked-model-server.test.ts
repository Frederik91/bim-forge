import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createDemoServer } from './server.ts';
import type { DemoServerOptions } from './server.ts';
import { RoomRepository } from '../src/room-model.ts';
import { syntheticResidentialFixture } from '../src/synthetic-residential-fixture.ts';
import { parseLinkedJob, parseLinkedPrepared } from '../src/linked-model.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error('Expected response object.');
  return value;
}

async function listen(t: TestContext, options: DemoServerOptions) {
  const server = await createDemoServer(options);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ifc-http-'));
  const socketPath = path.join(directory, 'api.sock');
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  const close = async () => {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await server.closeModelWorkers();
  };
  t.after(async () => { await close(); await fs.rm(directory, { recursive: true, force: true }); });
  const request = (url: string, options: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {}) =>
    new Promise<{ status: number | undefined; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.request({ socketPath, path: url, method: options.method ?? 'GET',
        headers: { Host: 'preview.example', Origin: 'https://preview.example', ...options.headers } }, response => {
        let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
      });
      req.on('error', reject); req.end(options.body);
    });
  return { request, close };
}

test('actual server authorizes every IFC route, separates projects and preserves native state through sidecar/restart', async t => {
  const privateRoot = process.env.IFC_PRIVATE_ROOT; const spool = process.env.IFC_EXTERNAL_SPOOL; const fixture = process.env.IFC_FIXTURE;
  if (!privateRoot || !spool || !fixture) throw new Error('Run with separate app/converter containers and SSD private root, spool and fixture.');
  const state = path.join(privateRoot, 'state'); await fs.mkdir(state, { recursive: true });
  const linkedModelRoot = path.join(state, 'ifc-links'); await fs.mkdir(linkedModelRoot, { recursive: true });
  const options = { runtimeMode: 'remote', publicOrigin: 'https://preview.example', backlogFile: path.join(state, 'queue.sqlite'), linkedModelRoot, linkedModelSpool: spool } satisfies DemoServerOptions;
  const { request, close } = await listen(t, options);
  const repository = await RoomRepository.createProject({ projectId: randomUUID(), name: 'Native preservation fixture', snapshot: syntheticResidentialFixture().snapshot });
  const other = await RoomRepository.createProject({ projectId: randomUUID(), name: 'Other project', snapshot: repository.view(repository.root()).snapshot });
  for (const project of [repository.serialize(), other.serialize()]) {
    const imported = await request('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }) });
    assert.equal(imported.status, 200, imported.body);
  }
  const baseline = await request(`/api/projects/${repository.projectId}/baselines`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commandId: 'server-ifc-as-is', name: 'As-is', from: repository.freezeDesignTarget({ kind: 'main' }) }) });
  assert.equal(baseline.status, 200, baseline.body);
  const native = object(baseline.body).project; assert.equal(typeof native, 'string');
  const endpoint = `/api/projects/${repository.projectId}/ifc-links`;
  const foreign = `/api/projects/${other.projectId}/ifc-links`;
  const bytes = await fs.readFile(fixture);
  const upload = { method: 'POST', headers: { 'Content-Type': 'application/x-step', 'X-Source-Name': 'synthetic.ifc' }, body: bytes };
  assert.equal(object((await request('/api/health')).body).ifcLinks, 'configured');
  assert.equal((await request(endpoint, { ...upload, headers: { ...upload.headers, Host: 'attacker.example' } })).status, 403);
  assert.equal((await request(`/api/projects/${randomUUID()}/ifc-links`, upload)).status, 404);
  assert.deepEqual(object((await request(endpoint)).body), { links: [] });
  for (const suffix of ['', `/${randomUUID()}`, `/${randomUUID()}/original`, `/${randomUUID()}/prepared`, `/${randomUUID()}/cancel`]) {
    for (const headers of [{ Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      const denied = await request(endpoint + suffix, { method: suffix.endsWith('/cancel') ? 'POST' : 'GET', headers });
      assert.equal(denied.status, 400); assert.match(denied.body, /same-origin|Cross-origin|Cross-site/);
      assert.equal(denied.headers['x-content-type-options'], 'nosniff'); assert.equal(denied.headers['cache-control'], 'no-store');
      assert.match(String(denied.headers['content-security-policy']), /frame-ancestors 'none'/);
    }
  }
  assert.equal((await request(endpoint, { ...upload, headers: { ...upload.headers, Origin: '' } })).status, 400);
  assert.equal((await request(`${endpoint}?path=/private/secret`, upload)).status, 400);
  assert.deepEqual(object((await request(endpoint)).body), { links: [] });
  const attached = await request(endpoint, upload); assert.equal(attached.status, 202, attached.body);
  const link = parseLinkedJob(object(attached.body).link);
  for (const suffix of [`/${link.id}`, `/${link.id}/original`, `/${link.id}/prepared`, `/${link.id}/cancel`]) {
    const denied = await request(foreign + suffix, { method: suffix.endsWith('/cancel') ? 'POST' : 'GET' });
    assert.equal(denied.status, 400); assert.match(denied.body, /unavailable in this project/);
  }
  assert.deepEqual(object((await request(foreign)).body), { links: [] });
  let ready = false;
  for (let i = 0; i < 500; i++) {
    const current = parseLinkedJob(object((await request(`${endpoint}/${link.id}`)).body).link);
    if (current.kind === 'failed') assert.fail(current.error);
    if (current.kind === 'ready') { ready = true; break; }
    await delay(100);
  }
  assert.equal(ready, true, 'Isolated converter must finish before the bound.');
  const prepared = await request(`${endpoint}/${link.id}/prepared`); assert.equal(prepared.status, 200);
  assert.equal(parseLinkedPrepared(JSON.parse(prepared.body)).geometry.meshes.length, 4);
  assert.equal((await request(`${endpoint}/${link.id}/original`)).body, bytes.toString());
  const nativeEndpoint = `/api/projects/${repository.projectId}`;
  assert.equal(object((await request(nativeEndpoint)).body).project, native);
  const pending = await request(endpoint, upload); assert.equal(pending.status, 202);
  const pendingId = parseLinkedJob(object(pending.body).link).id;
  await close();
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(spool, pendingId, 'cancel.json'), 'utf8')), { cancelled: true });
  const recovered = await listen(t, options);
  assert.equal(parseLinkedJob(object((await recovered.request(`${endpoint}/${link.id}`)).body).link).kind, 'ready');
  assert.equal(parseLinkedJob(object((await recovered.request(`${endpoint}/${pendingId}`)).body).link).kind, 'cancelled');
  assert.equal((await recovered.request(`${endpoint}/${link.id}/original`)).body, bytes.toString());
  assert.equal(object((await recovered.request(nativeEndpoint)).body).project, native);
  assert.equal(object((await recovered.request(`/api/projects/${other.projectId}`)).body).project, other.serialize());
  assert.equal(await fs.stat(path.join(state, 'ifc-links', 'links.sqlite')).then(info => info.isFile()), true);
});

test('unconfigured local/test mode creates no IFC jobs and reports unavailable', async t => {
  const { request } = await listen(t, {});
  const repository = await RoomRepository.createProject({ projectId: randomUUID(), name: 'Local fixture', snapshot: syntheticResidentialFixture().snapshot });
  const headers = { Host: 'localhost', Origin: 'http://localhost' };
  assert.equal((await request('/api/projects', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ project: repository.serialize() }) })).status, 200);
  const endpoint = `/api/projects/${repository.projectId}/ifc-links`;
  assert.equal(object((await request('/api/health', { headers })).body).ifcLinks, 'unavailable');
  for (const method of ['GET', 'POST']) {
    const response = await request(endpoint, { method, headers }); assert.equal(response.status, 503); assert.match(response.body, /not configured/);
    assert.equal((await request(endpoint, { method, headers: { ...headers, Origin: 'http://attacker.example' } })).status, 400);
  }
  assert.equal((await request(`/api/projects/${randomUUID()}/ifc-links`, { headers })).status, 404);
});

test('spool configuration refuses memory state, relative paths and private-state aliases', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ifc-config-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const state = path.join(directory, 'state'); await fs.mkdir(state);
  const backlogFile = path.join(state, 'queue.sqlite');
  await assert.rejects(createDemoServer({ linkedModelSpool: directory }), /persistent server state/);
  await assert.rejects(createDemoServer({ backlogFile, linkedModelSpool: 'relative' }), /absolute dedicated spool/);
  await assert.rejects(createDemoServer({ backlogFile, linkedModelSpool: state }), /separate/);
  await assert.rejects(createDemoServer({ backlogFile, linkedModelSpool: directory }), /separate/);
  const child = path.join(state, 'spool'); await fs.mkdir(child);
  await assert.rejects(createDemoServer({ backlogFile, linkedModelSpool: child }), /separate/);
  const alias = path.join(directory, 'alias'); await fs.symlink(state, alias);
  await assert.rejects(createDemoServer({ backlogFile, linkedModelSpool: alias }), /separate/);
  assert.deepEqual(await fs.readdir(state), ['spool']);
});
