import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { IncomingHttpHeaders, RequestOptions } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDemoServer, parseDemoServerConfig } from './server.ts';
import type { DemoServerOptions } from './server.ts';
import { RoomRepository, rectangleLayout, previewRectangle } from '../src/room-model.ts';
import type { ModelWorker, ModelWorkerSession } from '../src/model-proposal.ts';

interface TestResponse { status: number | undefined; headers: IncomingHttpHeaders; body: string }
interface TestRequestOptions extends RequestOptions { body?: string }
type TestRequester = (target: string, options?: TestRequestOptions) => Promise<TestResponse>;
type TestCodex = NonNullable<DemoServerOptions['codex']>;

function jsonObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error('Expected a JSON object.');
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function listen(
  t: TestContext,
  modelWorker: ModelWorker | null = null,
  codex: TestCodex | null = null,
  serverOptions: Pick<DemoServerOptions, 'runtimeMode' | 'publicOrigin' | 'backlogFile'> = {},
): Promise<TestRequester> {
  const server = await createDemoServer({ modelWorker, codex, ...serverOptions });
  const directory = process.platform === 'linux' ? fs.mkdtempSync(path.join(os.tmpdir(), 'bim-room-http-')) : null;
  const socketPath = directory && path.join(directory, 'test.sock');
  await new Promise<void>((resolve) => {
    if (socketPath) server.listen(socketPath, () => resolve());
    else server.listen(0, '127.0.0.1', () => resolve());
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await server.closeModelWorkers();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });
  const address = server.address();
  let endpoint: { socketPath: string } | { host: string; port: number };
  if (socketPath) endpoint = { socketPath };
  else {
    if (typeof address !== 'object' || address === null) throw new Error('Expected a TCP server address.');
    endpoint = { host: '127.0.0.1', port: address.port };
  }
  return (target: string, options: TestRequestOptions = {}) => new Promise<TestResponse>((resolve, reject) => {
    const { body, ...requestOptions } = options;
    const req = http.request({ ...endpoint, path: target, ...requestOptions }, (response) => {
      let body = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('local demo serves only explicit assets and exposes only the bounded proposal endpoint', async (t) => {
  const request = await listen(t);
  const page = await request('/'); assert.equal(page.status, 200);
  assert.match(page.body, /BIM Forge/); assert.match(page.body, /Continue with ChatGPT/); assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(String(page.headers['content-security-policy']), /connect-src 'self'/);
  assert.equal((await request('/room-app.mjs')).status, 200);
  assert.equal((await request('/', { method: 'HEAD' })).body, '');
  assert.equal((await request('/', { method: 'POST' })).status, 405);
  const auth = await request('/api/auth/session'); assert.equal(auth.status, 200); assert.equal(jsonObject(auth.body).connected, false);
  assert.equal(jsonObject((await request('/api/health')).body).status, 'ok');
  assert.equal((await request('/api/auth/start', { method: 'POST' })).status, 503);
  assert.equal((await request('/api/change-requests')).status, 405);
  assert.equal((await request('/api/change-requests', { method: 'POST' })).status, 400);
  assert.equal((await request('/api/proposals')).status, 404);
  for (const target of ['/../../.ssh/id_ed25519', '/package.json', '/.env', '/src/room-model.ts', '/%2e%2e/AGENTS.md']) {
    assert.equal((await request(target)).status, 404);
  }
  assert.equal((await request('/', { headers: { Host: 'attacker.example' } })).status, 403);
});

test('server projects recover in a fresh session, imports preserve authority and history refuses invalid cursors', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-project-http-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const backlogFile = path.join(directory, 'projects.sqlite');
  const request = await listen(t, null, null, { backlogFile });
  const repo = await RoomRepository.create('Durable browser project');
  const post = (project: string) => request('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }) });
  assert.equal((await post(repo.serialize())).status, 200);
  assert.equal(jsonObject((await post(repo.serialize())).body).project, repo.serialize());
  assert.equal(jsonObject((await request(`/api/projects/${repo.projectId}`)).body).project, repo.serialize());
  const projects = jsonObject((await request('/api/projects')).body).projects;
  assert.ok(Array.isArray(projects)); assert.equal(projects.length, 1);
  const history = jsonObject((await request(`/api/projects/${repo.projectId}/history?limit=1`)).body);
  assert.ok(Array.isArray(history.entries)); assert.equal(history.entries.length, 1); assert.equal(history.nextCursor, null);
  for (const query of ['limit=0', 'limit=51', 'limit=1.5', 'limit=1&limit=2', `before=${'f'.repeat(64)}`, 'before=', 'other=x']) {
    assert.equal((await request(`/api/projects/${repo.projectId}/history?${query}`)).status, 400, query);
  }
  assert.equal((await request(`/api/projects/${crypto.randomUUID()}`)).status, 404);
  assert.equal((await request(`/api/projects/${crypto.randomUUID()}/history`)).status, 404);
  assert.equal((await post('{bad project')).status, 400);
  const layout = structuredClone(rectangleLayout(repo.view(repo.root()).snapshot)); layout.door.widthMm = 1200;
  const mismatch = await RoomRepository.createProject({ projectId: repo.projectId, name: repo.name, snapshot: previewRectangle(repo.view(repo.root()).snapshot, layout) });
  assert.equal((await post(mismatch.serialize())).status, 409);
  assert.equal(jsonObject((await request(`/api/projects/${repo.projectId}`)).body).project, repo.serialize());
  const fresh = await listen(t, null, null, { backlogFile });
  assert.equal(jsonObject((await fresh(`/api/projects/${repo.projectId}`)).body).project, repo.serialize());
  assert.deepEqual(jsonObject((await fresh(`/api/projects/${repo.projectId}/history?limit=1`)).body), history);
  for (const target of ['/api/projects', `/api/projects/${repo.projectId}`, `/api/projects/${repo.projectId}/history`]) {
    assert.equal((await request(target, { headers: { Origin: 'https://attacker.example' } })).status, 400);
    assert.equal((await request(target, { headers: { Host: 'attacker.example' } })).status, 403);
  }
  assert.equal((await request('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'x'.repeat(384 * 1024) }) })).status, 400);
});

test('remote runtime starts device authorization without exposing credentials', async (t) => {
  let signIns = 0;
  const session = {
    status: 'disconnected' as const, connected: false as const, account: null, models: [], selectedModel: null,
  };
  const pending = {
    status: 'pending' as const, connected: false as const, account: null, models: [], selectedModel: null,
    device: { verificationUrl: 'https://auth.openai.com/codex/device' as const, userCode: 'ABCD-1234', expiresAt: Date.now() + 60_000 },
  };
  let current: ReturnType<TestCodex['publicSession']> = session;
  const codex: TestCodex = {
    publicSession: () => current,
    async startDeviceLogin() { signIns += 1; current = pending; return current; },
    async cancelDeviceLogin() { current = session; return current; },
    async refreshModels() { return session; },
    async selectModel() { return session; },
    async signOut() { return session; },
    modelWorker() { throw new Error('not connected'); },
  };
  const request = await listen(t, null, codex, {
    runtimeMode: 'remote', publicOrigin: 'https://preview.example:9443',
  });
  const headers = { Host: 'preview.example:9443', Origin: 'https://preview.example:9443', 'Sec-Fetch-Site': 'same-origin' };
  const publicState = jsonObject((await request('/api/auth/session', { headers })).body);
  assert.equal(publicState.status, 'disconnected');
  assert.equal((await request('/api/auth/qr', { headers })).status, 404);
  const start = await request('/api/auth/start', { method: 'POST', headers });
  assert.equal(start.status, 200);
  const started = jsonObject(start.body);
  assert.equal(started.status, 'pending');
  assert.equal(JSON.stringify(started).includes('token'), false);
  assert.equal(signIns, 1);
  const qr = await request('/api/auth/qr', { headers });
  assert.equal(qr.status, 200);
  assert.equal(qr.headers['content-type'], 'image/svg+xml');
  assert.equal(qr.headers['cache-control'], 'no-store');
  assert.match(qr.body, /<svg/);
  assert.doesNotMatch(qr.body, /ABCD-1234|token/);
  assert.equal((await request('/api/auth/qr', { method: 'POST', headers })).status, 405);
  assert.equal((await request('/api/auth/start', { method: 'POST', headers: { Host: headers.Host } })).status, 400);
  assert.equal((await request('/api/auth/cancel', { method: 'POST', headers })).status, 200);
  assert.equal((await request('/api/auth/qr', { headers })).status, 404);
  assert.equal((await request('/api/auth/start', {
    method: 'POST', headers: { ...headers, Origin: 'https://attacker.example' },
  })).status, 400);
  assert.equal((await request('/api/health', { headers: { Host: 'attacker.example' } })).status, 403);
  const health = jsonObject((await request('/api/health', { headers })).body);
  assert.equal(health.runtimeMode, 'remote');
});

test('server configuration parses local TCP and bounded remote Unix socket modes', () => {
  assert.deepEqual(parseDemoServerConfig({ PORT: '4180' }), {
    runtimeMode: 'local', publicOrigin: null, codexHome: undefined, workingDirectory: undefined,
    listen: { kind: 'tcp', host: '127.0.0.1', port: 4180 },
  });
  assert.deepEqual(parseDemoServerConfig({
    BIM_FORGE_RUNTIME: 'remote',
    BIM_FORGE_PUBLIC_ORIGIN: 'https://192.168.1.17:9443',
    BIM_FORGE_SOCKET: '/run/bim-preview/api.sock',
    CODEX_HOME: '/var/lib/bim-forge/codex', BIM_FORGE_AGENT_WORKDIR: '/tmp/bim-forge-agent',
  }), {
    runtimeMode: 'remote', publicOrigin: 'https://192.168.1.17:9443',
    codexHome: '/var/lib/bim-forge/codex', workingDirectory: '/tmp/bim-forge-agent',
    listen: { kind: 'socket', path: '/run/bim-preview/api.sock' },
  });
  assert.throws(() => parseDemoServerConfig({ BIM_FORGE_RUNTIME: 'remote' }), /PUBLIC_ORIGIN/);
  assert.throws(() => parseDemoServerConfig({
    BIM_FORGE_RUNTIME: 'remote', BIM_FORGE_PUBLIC_ORIGIN: 'http://preview.example',
    BIM_FORGE_SOCKET: '/tmp/app.sock', CODEX_HOME: '/tmp/codex', BIM_FORGE_AGENT_WORKDIR: '/var/tmp/agent',
  }), /HTTPS origin/);
});

test('authentication endpoints expose only public connection state and reject cross-origin mutations', async (t) => {
  let session: ReturnType<TestCodex['publicSession']> = {
    status: 'connected', connected: true, account: { email: 'designer@example.com', planType: 'plus' },
    models: [{ slug: 'gpt-test', displayName: 'GPT Test' }], selectedModel: 'gpt-test',
  };
  const calls: Array<string | [string, string]> = [];
  const codex: TestCodex = {
    publicSession: () => session,
    async startDeviceLogin() { calls.push('sign-in'); return session; },
    async cancelDeviceLogin() { calls.push('cancel'); return session; },
    async refreshModels() { calls.push('models'); return session; },
    async selectModel(model: string) { calls.push(['model', model]); session = { ...session, selectedModel: model }; return session; },
    async signOut() {
      calls.push('sign-out');
      session = { status: 'disconnected', connected: false, account: null, models: [], selectedModel: null };
      return session;
    },
    modelWorker() { throw new Error('not used'); },
  };
  const request = await listen(t, null, codex);
  const publicState = jsonObject((await request('/api/auth/session')).body);
  assert.equal(jsonObject(JSON.stringify(publicState.account)).email, 'designer@example.com'); assert.equal(JSON.stringify(publicState).includes('token'), false);
  assert.equal((await request('/api/auth/start', { method: 'POST', headers: { Origin: 'http://attacker.example' } })).status, 400);
  assert.equal((await request('/api/auth/start', { method: 'POST' })).status, 200);
  assert.equal((await request('/api/auth/models', { method: 'POST' })).status, 200);
  const selected = await request('/api/auth/model', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"model":"gpt-other"}',
  });
  assert.equal(selected.status, 200); assert.equal(jsonObject(selected.body).selectedModel, 'gpt-other');
  assert.equal((await request('/api/auth/signout', { method: 'POST' })).status, 200);
  assert.deepEqual(calls, ['sign-in', 'models', ['model', 'gpt-other'], 'sign-out']);
});

test('proposal endpoint binds request to revision and returns a validated separate AI proposal', async (t) => {
  const modelWorker: ModelWorker = {
    identity: { provider: 'test', model: 'http-scripted-worker' },
    async run(session: ModelWorkerSession) {
      const input = jsonObject(JSON.stringify(session.input));
      const requestInput = jsonObject(JSON.stringify(input.request));
      if (requestInput.instruction === 'provider failure') throw new Error('provider unavailable');
      const visualIntent = jsonObject(JSON.stringify(requestInput.visualIntent));
      const result = await session.executeTool('run_model_script', { language: 'javascript', source: `
        await model.inspect();
        await model.previewRectangle(${JSON.stringify(visualIntent.layout)});
        return { kind: 'propose', review: {
          intent: {interpretation:'Apply the requested entry edit.',assumptions:[],certainty:90,basis:'The fixture supplies the entry layout.'},
          summary: 'Entrance widened to 1200 mm.',
          rationale: 'The visual request fits the hosted wall and preserves stable object identities.',
          constraints: 'The host relationship, wall properties and stable identifiers remain unchanged.',
          uncertainty: 'Concept-only geometry; no construction checks.'
        } };
      ` });
      assert.equal(result.done, true);
    },
  };
  const request = await listen(t, modelWorker);
  const repo = await RoomRepository.create();
  const layout = structuredClone(rectangleLayout(repo.view(repo.head('main')).snapshot)); layout.door.widthMm = 1200;
  const payload = {
    project: repo.serialize(),
    request: {
      requestId: 'http-request-40', proposalName: 'ai-entry-study', baseRevisionId: repo.head('main'),
      selectedObjectIds: ['door-entry'], instruction: 'Widen the selected entrance to match the sketch.',
      visualIntent: { kind: 'rectangle-layout-sketch', layout },
    },
  };
  const response = await request('/api/change-requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  assert.equal(response.status, 202);
  const jobId = jsonObject(JSON.stringify(jsonObject(response.body).ticket)).id;
  const complete = await pollProposal(request, jobId);
  const ticket = jsonObject(JSON.stringify(jsonObject(complete.body).ticket));
  assert.ok(Array.isArray(ticket.executions));
  assert.equal(ticket.executions.length, 1);
  const execution = jsonObject(JSON.stringify(ticket.executions[0]));
  assert.equal(execution.ticketId, jobId);
  assert.equal(execution.requestId, payload.request.requestId);
  assert.equal(execution.attempt, 1);
  assert.equal(jsonObject(JSON.stringify(execution.evidence)).status, 'completed');
  const result = jsonObject(JSON.stringify(jsonObject(JSON.stringify(jsonObject(complete.body).ticket)).result)); assert.equal(result.status, 'ready');
  const proposed = await RoomRepository.restore(result.project);
  assert.equal(proposed.head('main'), repo.head('main'));
  assert.equal(proposed.view(proposed.head('ai-entry-study')).parentId, repo.head('main'));
  const resultReview = jsonObject(JSON.stringify(result.review));
  assert.equal(resultReview.baseRevisionId, repo.head('main'));
  assert.deepEqual(resultReview.selectedObjectIds, ['door-entry']);
  assert.equal(proposed.review('ai-entry-study').constraints, resultReview.constraints);
  assert.equal(proposed.review('ai-entry-study').worker.model, 'http-scripted-worker');

  const stale = { ...payload, request: { ...payload.request, baseRevisionId: '0'.repeat(64) } };
  assert.equal((await request('/api/change-requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stale),
  })).status, 400);
  const failed = { ...payload, request: { ...payload.request, requestId: 'http-failure', proposalName: 'failure-entry', instruction: 'provider failure' } };
  const failedStart = await request('/api/change-requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(failed),
  });
  const failure = await pollProposal(request, jsonObject(JSON.stringify(jsonObject(failedStart.body).ticket)).id);
  assert.equal(jsonObject(JSON.stringify(jsonObject(failure.body).ticket)).state, 'failed');
  assert.equal((await request('/api/change-requests', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
  })).status, 400);
});

async function pollProposal(request: TestRequester, id: unknown): Promise<TestResponse> {
  assert.equal(typeof id, 'string');
  for (let count = 0; count < 4000; count += 1) {
    const response = await request(`/api/change-requests/${id}`);
    const state = jsonObject(JSON.stringify(jsonObject(response.body).ticket)).state;
    if (state !== 'working' && state !== 'queued') return response;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Proposal did not finish.');
}

test('slow proposals return a job immediately, are idempotent, and expose readable failures', async (t) => {
  let release: (() => void) | undefined;
  let runs = 0;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const request = await listen(t, {
    identity: { provider: 'test', model: 'slow-worker' },
    async run() { runs += 1; await waiting; throw new Error('Controlled model failure.'); },
  });
  const repo = await RoomRepository.create();
  const payload = { project: repo.serialize(), request: {
    requestId: 'slow-request', proposalName: 'slow-office', baseRevisionId: repo.head('main'),
    selectedObjectIds: ['door-entry'], instruction: 'Build an office.',
    visualIntent: { kind: 'rectangle-layout-sketch', layout: rectangleLayout(repo.view(repo.head('main')).snapshot) },
  } };
  const post = (body = payload) => request('/api/change-requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const response = await post();
  assert.equal(response.status, 202);
  const job = jsonObject(JSON.stringify(jsonObject(response.body).ticket)).id;
  assert.equal(jsonObject(JSON.stringify(jsonObject((await request(`/api/change-requests/${job}`)).body).ticket)).state, 'working');
  assert.equal(jsonObject(JSON.stringify(jsonObject((await post()).body).ticket)).id, job);
  for (let i = 0; runs < 1 && i < 4000; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.equal(runs, 1);
  assert.equal((await post({ ...payload, request: { ...payload.request, instruction: 'Different input.' } })).status, 409);
  release?.();
  const failure = await pollProposal(request, job);
  assert.equal(failure.status, 200);
  assert.equal(jsonObject(JSON.stringify(jsonObject(failure.body).ticket)).error, 'Controlled model failure.');
  assert.equal((await request('/api/change-requests/unknown')).status, 400);
});

test('HTTP cancellation aborts the worker and retains execution evidence without changing the accepted project', async (t) => {
  let runningSignal: AbortSignal | undefined;
  const request = await listen(t, { identity: { provider: 'test', model: 'http-cancel-worker' }, async run(session) {
    await session.executeTool('run_model_script', { language: 'javascript',
      source: "return { kind: 'observe', observation: await model.inspect() };" });
    runningSignal = session.signal;
    await new Promise<void>((resolve) => {
      session.signal.addEventListener('abort', () => resolve(), { once: true });
      if (session.signal.aborted) resolve();
    });
  } });
  const repo = await RoomRepository.create();
  const payload = { project: repo.serialize(), request: {
    requestId: 'http-cancel', proposalName: 'http-cancel', baseRevisionId: repo.head('main'),
    selectedObjectIds: ['door-entry'], instruction: 'Inspect before changing the door.',
    visualIntent: { kind: 'selection' },
  } };
  assert.equal((await request('/api/change-requests', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 202);
  for (let i = 0; !runningSignal && i < 4000; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.ok(runningSignal);
  const decision = await request('/api/change-requests/http-cancel/decision', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel', decisionId: 'http-cancel-decision', expectedRequestId: 'http-cancel' }) });
  assert.equal(decision.status, 200);
  assert.equal(runningSignal.aborted, true);
  const detail = jsonObject((await request('/api/change-requests/http-cancel')).body);
  const ticket = jsonObject(JSON.stringify(detail.ticket));
  assert.equal(ticket.state, 'cancelled');
  assert.equal(ticket.result, null);
  assert.ok(Array.isArray(ticket.executions)); assert.equal(ticket.executions.length, 1);
  const project = jsonObject((await request(`/api/projects/${repo.projectId}/change-requests`)).body);
  assert.equal(project.project, repo.serialize());
});
