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
import { RoomRepository, rectangleLayout } from '../src/room-model.ts';
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
  serverOptions: Pick<DemoServerOptions, 'runtimeMode' | 'publicOrigin'> = {},
): Promise<TestRequester> {
  const server = createDemoServer({ modelWorker, codex, ...serverOptions });
  const directory = process.platform === 'linux' ? fs.mkdtempSync(path.join(os.tmpdir(), 'bim-room-http-')) : null;
  const socketPath = directory && path.join(directory, 'test.sock');
  await new Promise<void>((resolve) => {
    if (socketPath) server.listen(socketPath, () => resolve());
    else server.listen(0, '127.0.0.1', () => resolve());
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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
  assert.match(page.body, /BIM Forge/); assert.match(page.body, /Get sign-in code/); assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(String(page.headers['content-security-policy']), /connect-src 'self'/);
  assert.equal((await request('/room-app.mjs')).status, 200);
  assert.equal((await request('/', { method: 'HEAD' })).body, '');
  assert.equal((await request('/', { method: 'POST' })).status, 405);
  const auth = await request('/api/auth/session'); assert.equal(auth.status, 200); assert.equal(jsonObject(auth.body).connected, false);
  assert.equal(jsonObject((await request('/api/health')).body).status, 'ok');
  assert.equal((await request('/api/auth/start', { method: 'POST' })).status, 503);
  assert.equal((await request('/api/proposals')).status, 405);
  assert.equal((await request('/api/proposals', { method: 'POST' })).status, 503);
  for (const target of ['/../../.ssh/id_ed25519', '/package.json', '/.env', '/src/room-model.ts', '/%2e%2e/AGENTS.md']) {
    assert.equal((await request(target)).status, 404);
  }
  assert.equal((await request('/', { headers: { Host: 'attacker.example' } })).status, 403);
});

test('remote runtime starts device authorization without exposing credentials', async (t) => {
  let signIns = 0;
  const session = {
    status: 'disconnected' as const, connected: false as const, account: null, models: [], selectedModel: null,
  };
  const pending = {
    status: 'pending' as const, connected: false as const, account: null, models: [], selectedModel: null,
    device: { verificationUrl: 'https://auth.openai.com/codex/device' as const, userCode: 'ABCD-1234', expiresAt: 10_000 },
  };
  const codex: TestCodex = {
    publicSession: () => session,
    async startDeviceLogin() { signIns += 1; return pending; },
    async cancelDeviceLogin() { return session; },
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
  const start = await request('/api/auth/start', { method: 'POST', headers });
  assert.equal(start.status, 200);
  const started = jsonObject(start.body);
  assert.equal(started.status, 'pending');
  assert.equal(JSON.stringify(started).includes('token'), false);
  assert.equal(signIns, 1);
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
      const inspected = await session.executeTool('inspect_model', {}); assert.equal(inspected.ok, true);
      const visualIntent = jsonObject(JSON.stringify(requestInput.visualIntent));
      const previewed = await session.executeTool('preview_rectangle', visualIntent.layout); assert.equal(previewed.ok, true);
      await session.executeTool('submit_proposal', {
        summary: 'Entrance widened to 1200 mm.',
        rationale: 'The visual request fits the hosted wall and preserves stable object identities.',
        constraints: 'The host relationship, wall properties and stable identifiers remain unchanged.',
        uncertainty: 'Concept-only geometry; no construction checks.',
      });
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
  const response = await request('/api/proposals', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  assert.equal(response.status, 200);
  const result = jsonObject(response.body); assert.equal(result.status, 'ready');
  const proposed = await RoomRepository.restore(result.project);
  assert.equal(proposed.head('main'), repo.head('main'));
  assert.equal(proposed.view(proposed.head('ai-entry-study')).parentId, repo.head('main'));
  const resultReview = jsonObject(JSON.stringify(result.review));
  assert.equal(resultReview.baseRevisionId, repo.head('main'));
  assert.deepEqual(resultReview.selectedObjectIds, ['door-entry']);
  assert.equal(proposed.review('ai-entry-study').constraints, resultReview.constraints);
  assert.equal(proposed.review('ai-entry-study').worker.model, 'http-scripted-worker');

  const stale = { ...payload, request: { ...payload.request, baseRevisionId: '0'.repeat(64) } };
  assert.equal((await request('/api/proposals', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stale),
  })).status, 400);
  const failed = { ...payload, request: { ...payload.request, instruction: 'provider failure' } };
  assert.equal((await request('/api/proposals', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(failed),
  })).status, 502);
  assert.equal((await request('/api/proposals', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
  })).status, 400);
});
