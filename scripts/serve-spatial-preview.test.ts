import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RoomRepository, rectangleLayout } from '../src/room-model.ts';
import { parseSpatialPreviewConfig, startSpatialPreview } from './serve-spatial-preview.ts';
import type { SpatialPreviewDependencies } from './serve-spatial-preview.ts';

const offline = { connection: null };
const root = fileURLToPath(new URL('../', import.meta.url));
const marker = '.bim-forge-local-preview.json';

async function temporary(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-local-preview-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('bim-local-preview-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function availablePort(): Promise<number> {
  const server = http.createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

function config(directory: string, port: number) {
  return parseSpatialPreviewConfig(['--data-dir', directory, '--port', String(port), '--offline']);
}

test('configuration requires explicit absolute storage and a valid localhost port', () => {
  const directory = path.join(os.tmpdir(), 'bim-preview-config');
  assert.deepEqual(parseSpatialPreviewConfig(['--data-dir', directory]), { dataDirectory: directory, port: 4188, offline: false });
  for (const port of ['0', '-1', '65536', '1.5', 'NaN', '1e3', '']) {
    assert.throws(() => parseSpatialPreviewConfig(['--data-dir', directory, '--port', port]), /port|requires a value/);
  }
  assert.equal(config(directory, 1).port, 1); assert.equal(config(directory, 65535).port, 65535);
  for (const args of [[], ['--data-dir', 'relative'], ['--data-dir', path.parse(directory).root],
    ['--data-dir'], ['--data-dir', directory, '--host', '0.0.0.0'], ['--data-dir', directory, '--port', '4188', '--port', '4189'],
    ['--data-dir', directory, '--ifc-spool', 'relative']]) {
    assert.throws(() => parseSpatialPreviewConfig(args));
  }
});

test('the command provides help and rejects invalid storage before opening an account', () => {
  const launcher = fileURLToPath(new URL('./serve-spatial-preview.ts', import.meta.url));
  const help = spawnSync(process.execPath, [launcher, '--help'], { encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /--data-dir.*--port 4188/);
  const invalid = spawnSync(process.execPath, [launcher, '--data-dir', 'relative'], { encoding: 'utf8', windowsHide: true });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /absolute directory/); assert.equal(invalid.stdout, '');
});

test('unknown directories and foreign databases are refused without adopting or changing bytes', async t => {
  const directory = await temporary(t);
  const foreign = path.join(directory, 'foreign'); await fs.mkdir(foreign);
  const foreignDatabase = path.join(foreign, 'bim-change-requests.sqlite');
  await fs.writeFile(foreignDatabase, 'unrelated user database');
  const port = await availablePort();
  await assert.rejects(startSpatialPreview(config(foreign, port), offline), /unowned/);
  assert.equal(await fs.readFile(foreignDatabase, 'utf8'), 'unrelated user database');
  assert.deepEqual(await fs.readdir(foreign), ['bim-change-requests.sqlite']);
  const invalidMarker = path.join(directory, 'invalid-marker'); await fs.mkdir(invalidMarker);
  await fs.writeFile(path.join(invalidMarker, marker), '{"application":"another-app"}');
  await assert.rejects(startSpatialPreview(config(invalidMarker, port), offline), /not recognized/);
  const dataFile = path.join(directory, 'file'); await fs.writeFile(dataFile, 'foreign file');
  await assert.rejects(startSpatialPreview(config(dataFile, port), offline), /real owned directory/);
  const accountHome = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  await assert.rejects(startSpatialPreview(config(path.join(accountHome, 'forbidden-preview-279'), port), offline), /separate.*account home/);
  await assert.rejects(startSpatialPreview({ ...config(path.join(directory, 'bad-spool'), port), ifcSpool: accountHome }, offline), /separate.*account home/);
  await assert.rejects(startSpatialPreview({ ...config(path.join(directory, 'invalid-port'), port), port: 0 }, offline), /port/);
  await assert.rejects(fs.stat(path.join(directory, 'invalid-port')), { code: 'ENOENT' });
});

test('real health, static assets and exact disposable project survive a clean restart', async t => {
  const directory = path.join(await temporary(t), 'owned');
  const port = await availablePort();
  const first = await startSpatialPreview(config(directory, port), offline);
  const repository = await RoomRepository.create('Local preview persistence fixture');
  try {
    assert.deepEqual(await (await fetch(`${first.receipt.url}/api/health`)).json(),
      { status: 'ok', runtimeMode: 'local', chatgptConnected: false, ifcLinks: 'unavailable' });
    assert.equal(first.receipt.aiConnected, false); assert.equal(first.receipt.ifcConfigured, false);
    assert.equal(first.receipt.pid, process.pid); assert.match(first.receipt.buildSha256, /^[a-f0-9]{64}$/);
    for (const route of ['/', '/room-app.mjs', '/room.css', '/request-chat.css', '/canvas-studio.css']) {
      const response = await fetch(`${first.receipt.url}${route}`);
      assert.equal(response.status, 200, route); assert.ok((await response.text()).length > 0, route);
    }
    const saved = await fetch(`${first.receipt.url}/api/projects`, { method: 'POST',
      headers: { Origin: first.receipt.url, 'Content-Type': 'application/json' }, body: JSON.stringify({ project: repository.serialize() }) });
    assert.equal(saved.status, 200); assert.deepEqual(await saved.json(), { project: repository.serialize() });
    await assert.rejects(startSpatialPreview(config(directory, await availablePort()), offline), /already locked/);
    await Promise.all([first.close(), first.close()]);
    await assert.rejects(fs.stat(path.join(directory, '.preview-running')), { code: 'ENOENT' });
    const alias = path.join(path.dirname(directory), 'alias');
    await fs.symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(startSpatialPreview(config(alias, port), offline), /real owned directory/);
    const restarted = await startSpatialPreview(config(directory, port), offline);
    try {
      const read = await fetch(`${restarted.receipt.url}/api/projects/${repository.projectId}`);
      assert.equal(read.status, 200); assert.deepEqual(await read.json(), { project: repository.serialize() });
      assert.equal(restarted.receipt.buildSha256, first.receipt.buildSha256);
    } finally { await restarted.close(); }
    await fs.writeFile(path.join(directory, '.preview-running'), '{"pid":999999999}');
    await assert.rejects(startSpatialPreview(config(directory, port), offline), /already locked/);
    await fs.unlink(path.join(directory, '.preview-running'));
    await fs.writeFile(path.join(directory, 'foreign.sqlite'), 'another database');
    await assert.rejects(startSpatialPreview(config(directory, port), offline), /foreign files/);
  } finally { await first.close(); }
});

test('port conflicts clean up the account and storage lock, leaving the original listener running', async t => {
  const directory = path.join(await temporary(t), 'owned');
  const listener = http.createServer((_request, response) => response.end('original process'));
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); assert.ok(address && typeof address === 'object');
  let closed = 0;
  const session = { status: 'disconnected', connected: false, account: null, models: [], selectedModel: null } as const;
  const connection: NonNullable<SpatialPreviewDependencies['connection']> = {
    publicSession: () => session,
    async startDeviceLogin() { throw new Error('No provider in this test.'); },
    async cancelDeviceLogin() { return session; }, async refreshModels() { return session; },
    async selectModel() { return session; }, async signOut() { return session; },
    modelWorker() { throw new Error('No provider in this test.'); }, close() { closed += 1; },
  };
  try {
    await assert.rejects(startSpatialPreview(config(directory, address.port), { connection }), /already in use/);
    assert.equal(closed, 1);
    assert.equal(await (await fetch(`http://127.0.0.1:${address.port}`)).text(), 'original process');
    await assert.rejects(fs.stat(path.join(directory, '.preview-running')), { code: 'ENOENT' });
    const retry = await startSpatialPreview(config(directory, await availablePort()), offline);
    await retry.close();
  } finally { await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())); }
});

test('a dedicated existing IFC spool configures the current linked-model API', async t => {
  const directory = await temporary(t);
  const owned = path.join(directory, 'owned'); const spool = path.join(directory, 'spool'); await fs.mkdir(spool);
  const port = await availablePort();
  await assert.rejects(startSpatialPreview({ ...config(owned, port), ifcSpool: directory }, offline), /separate/);
  const preview = await startSpatialPreview({ ...config(owned, port), ifcSpool: spool }, offline);
  try {
    assert.equal(preview.receipt.ifcConfigured, true);
    const health: unknown = await (await fetch(`${preview.receipt.url}/api/health`)).json();
    assert.deepEqual(health, { status: 'ok', runtimeMode: 'local', chatgptConnected: false, ifcLinks: 'configured' });
    assert.ok((await fs.stat(path.join(owned, 'ifc-links'))).isDirectory());
  } finally { await preview.close(); }
});

test('missing build fails before claiming state and explains how to build', async t => {
  const directory = path.join(await temporary(t), 'owned');
  const bundle = path.join(root, 'dist/demo/room-app.mjs'); const held = `${bundle}.preview-test-held`;
  await fs.rename(bundle, held);
  try {
    await assert.rejects(startSpatialPreview(config(directory, await availablePort()), offline), /asset unavailable:.*npm run build:demo/);
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
  } finally { await fs.rename(held, bundle); }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`${signal} waits for account cleanup before removing the lock and reporting stopped`, { timeout: 20_000 }, async t => {
    const directory = path.join(await temporary(t), 'owned'); const port = await availablePort();
    const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/local-preview-process.ts', import.meta.url)),
      '--data-dir', directory, '--port', String(port), '--offline'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    let output = ''; let errors = '';
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
    const exited = once(child, 'exit');
    try {
      const [ready] = await once(child, 'message');
      assert.ok(typeof ready === 'object' && ready !== null && 'event' in ready && ready.event === 'ready');
      const accountClosing = once(child, 'message');
      if (process.platform === 'win32') child.send(signal); else child.kill(signal);
      assert.deepEqual((await accountClosing)[0], { event: 'account-closing' });
      await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`));
      assert.ok((await fs.stat(path.join(directory, '.preview-running'))).isFile());
      assert.equal(output.includes('"event":"stopped"'), false);
      child.send('release-cleanup');
      const [exitCode] = await exited; assert.equal(exitCode, 0, errors);
      assert.ok(output.includes('"event":"stopped"'));
      await assert.rejects(fs.stat(path.join(directory, '.preview-running')), { code: 'ENOENT' });
      const restarted = await startSpatialPreview(config(directory, port), offline); await restarted.close();
    } finally { if (child.exitCode === null) { child.kill(); await exited; } }
  });
}

test('close drains an actual queued local worker before closing its account', { timeout: 20_000 }, async t => {
  const directory = path.join(await temporary(t), 'owned');
  let workerStarted: (() => void) | undefined;
  const started = new Promise<void>(resolve => { workerStarted = resolve; });
  const order: string[] = [];
  const session = { status: 'connected', connected: true, account: { email: null, planType: 'offline-test' },
    models: [], selectedModel: 'local-lifecycle-fixture' } as const;
  const connection: NonNullable<SpatialPreviewDependencies['connection']> = {
    publicSession: () => session,
    async startDeviceLogin() { throw new Error('No provider in this test.'); },
    async cancelDeviceLogin() { return session; }, async refreshModels() { return session; },
    async selectModel() { return session; }, async signOut() { return session; },
    modelWorker() { return { identity: { provider: 'offline-test', model: 'local-lifecycle-fixture' }, async run({ signal }) {
      workerStarted?.(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      order.push('worker-drained'); throw new Error('Fixture worker cancelled.');
    } }; },
    close() { order.push('account-closed'); },
  };
  const preview = await startSpatialPreview(config(directory, await availablePort()), { connection });
  try {
    const repository = await RoomRepository.create();
    const response = await fetch(`${preview.receipt.url}/api/change-requests`, { method: 'POST',
      headers: { Origin: preview.receipt.url, 'Content-Type': 'application/json' }, body: JSON.stringify({ project: repository.serialize(), request: {
        requestId: 'local-preview-lifecycle', proposalName: 'lifecycle-fixture', baseRevisionId: repository.head('main'),
        selectedObjectIds: ['door-entry'], instruction: 'Inspect this fixture door.',
        visualIntent: { kind: 'rectangle-layout-sketch', layout: rectangleLayout(repository.view(repository.head('main')).snapshot) },
      } }) });
    assert.equal(response.status, 202, await response.text());
    await started; await preview.close();
    assert.deepEqual(order, ['worker-drained', 'account-closed']);
  } finally { await preview.close(); }
});
