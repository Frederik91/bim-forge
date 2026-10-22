import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDemoServer } from './server.mjs';
import { RoomRepository, rectangleLayout } from '../src/room-model.mjs';

async function listen(t, modelWorker = null, chatgpt = null) {
  const server = createDemoServer({ modelWorker, chatgpt });
  const directory = process.platform === 'linux' ? fs.mkdtempSync(path.join(os.tmpdir(), 'bim-room-http-')) : null;
  const socketPath = directory && path.join(directory, 'test.sock');
  await new Promise((resolve) => socketPath ? server.listen(socketPath, resolve) : server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });
  const endpoint = socketPath ? { socketPath } : { host: '127.0.0.1', port: server.address().port };
  return (target, options = {}) => new Promise((resolve, reject) => {
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
  assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
  assert.equal((await request('/src/room-model.mjs')).status, 200);
  assert.equal((await request('/', { method: 'HEAD' })).body, '');
  assert.equal((await request('/', { method: 'POST' })).status, 405);
  const auth = await request('/api/auth/session'); assert.equal(auth.status, 200); assert.equal(JSON.parse(auth.body).connected, false);
  assert.equal((await request('/api/auth/start', { method: 'POST' })).status, 503);
  assert.equal((await request('/api/proposals')).status, 405);
  assert.equal((await request('/api/proposals', { method: 'POST' })).status, 503);
  for (const target of ['/../../.ssh/id_ed25519', '/package.json', '/.env', '/src/room-model.mjs?download=1', '/%2e%2e/AGENTS.md']) {
    assert.equal((await request(target)).status, 404);
  }
  assert.equal((await request('/', { headers: { Host: 'attacker.example' } })).status, 403);
});

test('authentication endpoints expose only public connection state and reject cross-origin mutations', async (t) => {
  let session = {
    connected: true, sharing: true, account: { email: 'designer@example.com', name: 'Designer' },
    models: [{ slug: 'gpt-test', displayName: 'GPT Test' }], selectedModel: 'gpt-test',
  };
  const calls = [];
  const chatgpt = {
    publicSession: () => session,
    async signIn() { calls.push('sign-in'); return session; },
    async refreshModels() { calls.push('models'); return session; },
    async selectModel(model) { calls.push(['model', model]); session = { ...session, selectedModel: model }; return session; },
    async signOut() { calls.push('sign-out'); session = { connected: false, sharing: false, account: null, models: [], selectedModel: null }; return session; },
  };
  const request = await listen(t, null, chatgpt);
  const publicState = JSON.parse((await request('/api/auth/session')).body);
  assert.equal(publicState.account.email, 'designer@example.com'); assert.equal(JSON.stringify(publicState).includes('token'), false);
  assert.equal((await request('/api/auth/start', { method: 'POST', headers: { Origin: 'http://attacker.example' } })).status, 400);
  assert.equal((await request('/api/auth/start', { method: 'POST' })).status, 200);
  assert.equal((await request('/api/auth/models', { method: 'POST' })).status, 200);
  const selected = await request('/api/auth/model', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"model":"gpt-other"}',
  });
  assert.equal(selected.status, 200); assert.equal(JSON.parse(selected.body).selectedModel, 'gpt-other');
  assert.equal((await request('/api/auth/signout', { method: 'POST' })).status, 200);
  assert.deepEqual(calls, ['sign-in', 'models', ['model', 'gpt-other'], 'sign-out']);
});

test('proposal endpoint binds request to revision and returns a validated separate AI proposal', async (t) => {
  const modelWorker = {
    identity: { provider: 'test', model: 'http-scripted-worker' },
    async run(session) {
      if (session.input.request.instruction === 'provider failure') throw new Error('provider unavailable');
      const inspected = await session.executeTool('inspect_model', {}); assert.equal(inspected.ok, true);
      const previewed = await session.executeTool('preview_rectangle', session.input.request.visualIntent.layout); assert.equal(previewed.ok, true);
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
  const result = JSON.parse(response.body); assert.equal(result.status, 'ready');
  const proposed = await RoomRepository.restore(result.project);
  assert.equal(proposed.head('main'), repo.head('main'));
  assert.equal(proposed.view(proposed.head('ai-entry-study')).parentId, repo.head('main'));
  assert.equal(result.review.baseRevisionId, repo.head('main'));
  assert.deepEqual(result.review.selectedObjectIds, ['door-entry']);
  assert.equal(proposed.review('ai-entry-study').constraints, result.review.constraints);
  assert.equal(proposed.review('ai-entry-study').worker.model, 'http-scripted-worker');

  const stale = structuredClone(payload); stale.request.baseRevisionId = '0'.repeat(64);
  assert.equal((await request('/api/proposals', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stale),
  })).status, 400);
  const failed = structuredClone(payload); failed.request.instruction = 'provider failure';
  assert.equal((await request('/api/proposals', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(failed),
  })).status, 502);
  assert.equal((await request('/api/proposals', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
  })).status, 400);
});
