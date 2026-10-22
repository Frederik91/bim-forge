import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDemoServer } from './server.mjs';

test('local demo serves only explicit assets, with no write API or private file access', async (t) => {
  const server = createDemoServer();
  const directory = process.platform === 'linux' ? fs.mkdtempSync(path.join(os.tmpdir(), 'bim-room-http-')) : null;
  const socketPath = directory && path.join(directory, 'test.sock');
  await new Promise((resolve) => socketPath ? server.listen(socketPath, resolve) : server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });
  const endpoint = socketPath ? { socketPath } : { host: '127.0.0.1', port: server.address().port };
  const request = (target, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ ...endpoint, path: target, ...options }, (response) => {
      let body = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on('error', reject); req.end();
  });
  const page = await request('/'); assert.equal(page.status, 200);
  assert.match(page.body, /BIM Forge/); assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.headers['content-security-policy'], /connect-src 'none'/);
  assert.equal((await request('/src/room-model.mjs')).status, 200);
  assert.equal((await request('/', { method: 'HEAD' })).body, '');
  assert.equal((await request('/', { method: 'POST' })).status, 405);
  for (const target of ['/../../.ssh/id_ed25519', '/package.json', '/.env', '/src/room-model.mjs?download=1', '/%2e%2e/AGENTS.md']) {
    assert.equal((await request(target)).status, 404);
  }
  assert.equal((await request('/', { headers: { Host: 'attacker.example' } })).status, 403);
});
