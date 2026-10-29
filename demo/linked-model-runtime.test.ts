import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { LinkedModelStore } from './linked-model-store.ts';
import { handleLinkedModelRoute } from './linked-model-routes.ts';
import { parseLinkedPrepared } from '../src/linked-model.ts';
import { LinkedModelLayer } from './linked-model-render.ts';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';

const python = process.env.IFC_PYTHON ?? '/qualification/python/bin/python';
const fixture = process.env.IFC_FIXTURE;
if (!fixture) throw new Error('Run with IFC_FIXTURE pointing at the generated synthetic.ifc inside the isolated server container.');
const bytes = fs.readFileSync(fixture);
async function terminal(store: LinkedModelStore, project: string, id: string) {
  for (let i = 0; i < 300; i++) { const job = store.get(project, id); if (job.kind !== 'queued' && job.kind !== 'running') return job; await delay(100); }
  throw new Error('IFC job did not finish.');
}
function setup(t: test.TestContext, start = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ifc218-')); const spool = path.join(root, 'spool'); const data = path.join(root, 'private');
  const store = LinkedModelStore.open({ root: data, spool });
  const worker = start ? spawn(python, ['experiments/ifc-link/runtime_worker.py', spool], { stdio: 'inherit' }) : null;
  t.after(async () => { store.close(); if (worker && worker.exitCode === null) { worker.kill('SIGKILL'); await new Promise(resolve => worker.once('exit', resolve)); } });
  return { root, spool, data, store, worker, project: randomUUID() };
}

test('actual bounded converter retains original, binds properties and derived geometry, refuses tampering and cross-project reads', async t => {
  const { store, project, data } = setup(t);
  const job = store.attach({ projectId: project, name: 'synthetic.ifc', bytes });
  assert.equal(job.kind, 'queued'); assert.deepEqual(store.original(project, job.id), bytes);
  assert.throws(() => store.original(randomUUID(), job.id), /unavailable/);
  const done = await terminal(store, project, job.id); assert.equal(done.kind, 'ready', JSON.stringify(done));
  const result = store.prepared(project, job.id);
  assert.equal(result.manifest.source.originalSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.geometry.meshes.length, 4); assert.equal(result.index.objects.length, 9); assert.ok(result.index.spatial.length > 0);
  assert.match(JSON.stringify(result.index.objects), /IfcPropertyBoundedValue/); assert.equal(result.index.georeferencing.applied, false);
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 256, deterministicLockstep: true, lockstepMaxSteps: 4 });
  const scene = new Scene(engine); const layer = new LinkedModelLayer(scene);
  try {
    layer.setLinks([{ id: job.id, prepared: result, visible: true }]); const meshes = [...scene.meshes];
    assert.equal(meshes.length, 4);
    assert.throws(() => layer.setLinks([{ id: randomUUID(), prepared: result, visible: false }]), /display\/job ID must match/);
    assert.deepEqual(scene.meshes, meshes, 'Reject mismatched display/occurrence IDs before changing existing geometry');
    for (let repeat = 0; repeat < 3; repeat++) {
      layer.setLinks([{ id: job.id, prepared: result, visible: false }]); assert.ok(meshes.every(mesh => !mesh.isEnabled()));
      layer.setLinks([{ id: job.id, prepared: result, visible: true }]); assert.ok(meshes.every(mesh => mesh.isEnabled()));
      assert.deepEqual(scene.meshes, meshes, 'Repeated setLinks/hide/show preserves the same owned meshes');
    }
  } finally { layer.dispose(); scene.dispose(); engine.dispose(); }
  const corrupt = structuredClone(result); const mesh = corrupt.geometry.meshes[0]; assert.ok(mesh); mesh.ref.originalSha256 = 'a'.repeat(64);
  assert.throws(() => parseLinkedPrepared(corrupt), /identity/);
  fs.chmodSync(path.join(data, 'prepared', job.id, 'geometry.json'), 0o600); fs.appendFileSync(path.join(data, 'prepared', job.id, 'geometry.json'), ' ');
  assert.throws(() => store.prepared(project, job.id), /integrity/);
});

test('cancelled and restarted jobs cannot publish late results; original source survives', async t => {
  const { store, project, spool, data } = setup(t, false);
  const job = store.attach({ projectId: project, name: 'cancel.ifc', bytes });
  assert.equal(store.cancel(project, job.id).kind, 'cancelled');
  fs.writeFileSync(path.join(spool, job.id, 'terminal.json'), JSON.stringify({ kind: 'complete' })); store.refresh();
  assert.equal(store.get(project, job.id).kind, 'cancelled'); assert.throws(() => store.prepared(project, job.id), /not ready/);
  const interrupted = store.attach({ projectId: project, name: 'restart.ifc', bytes });
  // A second application process cannot claim that the first process has restarted.
  const recovered = LinkedModelStore.open({ root: data, spool }); t.after(() => recovered.close());
  assert.equal(recovered.get(project, interrupted.id).kind, 'queued');
  fs.writeFileSync(path.join(spool, interrupted.id, 'terminal.json'), JSON.stringify({ kind: 'failed', error: 'Converter interrupted by restart.' })); recovered.refresh();
  assert.equal(recovered.get(project, interrupted.id).kind, 'failed');
  fs.writeFileSync(path.join(spool, interrupted.id, 'terminal.json'), JSON.stringify({ kind: 'complete' })); recovered.refresh();
  assert.equal(recovered.get(project, interrupted.id).kind, 'failed'); assert.deepEqual(recovered.original(project, interrupted.id), bytes);
});

test('invalid IFC fails visibly and admission/queue bounds stay enforced', async t => {
  const { store, project } = setup(t);
  assert.throws(() => store.attach({ projectId: project, name: 'huge.ifc', bytes: Buffer.alloc(2 * 1024 * 1024 + 1) }), /2 MiB/);
  const job = store.attach({ projectId: project, name: 'invalid.ifc', bytes: Buffer.from('not an IFC') });
  const done = await terminal(store, project, job.id); assert.equal(done.kind, 'failed'); assert.deepEqual(store.original(project, job.id), Buffer.from('not an IFC'));
});

test('real Chromium uploads, browses, inspects, picks and hides bounded derived meshes beside preserved native baseline', async t => {
  const { store, project, root } = setup(t);
  const bundle = await build({ entryPoints: ['demo/linked-model-browser-fixture.ts'], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2023' });
  const script = bundle.outputFiles[0]?.text; assert.ok(script);
  const server = http.createServer((request, response) => {
    void (async () => {
      if (await handleLinkedModelRoute({ request, response, store, hasProject: id => id === project, authorize: req => {
        const origin = req.headers.origin; if (origin && origin !== `http://${req.headers.host}`) throw new Error('Cross-origin request refused.');
      } })) return;
      if (request.url === '/poll-fixture') {
        const job = store.list(project).find(link => link.kind === 'ready'); assert.ok(job);
        const clone = (name: string) => { const id = randomUUID(); return { ...job, id, name, occurrence: id, source: { ...job.source, namespace: id } }; };
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ readyA: { ...job, name: 'Healthy A.ifc' }, readyB: clone('Broken B.ifc'),
          runningC: { ...clone('Running C.ifc'), kind: 'running', progress: 'index' }, mismatchedD: clone('Mismatched D.ifc'), prepared: store.prepared(project, job.id) })); return;
      }
      if (request.url === '/test.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); return; }
      response.setHeader('Content-Type', 'text/html');
      response.end(`<body data-project="${project}" data-poll-fixture="${request.url === '/?panel-poll'}" style="display:flex;gap:16px;font-family:sans-serif"><main style="width:800px;flex:none"><canvas width="800" height="600"></canvas><pre id="context" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></main><aside id="links" style="width:480px;flex:none"></aside><script type="module" src="/test.mjs"></script></body>`);
    })().catch(error => { response.statusCode = 500; response.end(String(error)); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ...(executablePath ? { executablePath } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } }); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.getByLabel('Attach IFC reference').setInputFiles({ name: 'synthetic.ifc', mimeType: 'application/x-step', buffer: bytes });
  await page.locator('canvas[data-link-meshes="4"]').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /wall-a/i }).click();
  assert.match(await page.getByLabel('Original IFC properties and conversion losses').innerText(), /IfcPropertyBoundedValue/);
  await page.getByRole('button', { name: 'Reference in request' }).click(); assert.match(await page.locator('#context').innerText(), /no native edit authority.*originalSha256/);
  assert.equal(await page.locator('canvas').getAttribute('data-native-preserved'), 'true');
  await page.screenshot({ path: path.join(process.env.IFC_EVIDENCE ?? root, 'ifc218-inspection.png'), fullPage: true });
  const picked = await page.locator('canvas').evaluate(canvas => {
    const raw: unknown = JSON.parse(canvas.getAttribute('data-pick-points') ?? '[]');
    if (!Array.isArray(raw)) throw new Error('Missing mesh pick locations.');
    const point: unknown = raw[0];
    if (typeof point !== 'object' || point === null || !('x' in point) || !('y' in point) || typeof point.x !== 'number' || typeof point.y !== 'number') throw new Error('Invalid mesh pick location.');
    return { x: point.x, y: point.y };
  });
  await page.locator('canvas').click({ position: picked });
  assert.match(await page.locator('canvas').getAttribute('data-picked-source') ?? '', /ifc-reference.*originalSha256/);
  assert.equal(await page.getByLabel('Original IFC properties and conversion losses').count(), 1);
  await page.getByLabel('Show linked geometry').uncheck(); assert.equal(await page.locator('canvas').getAttribute('data-link-meshes'), '0');
  await page.getByLabel('Show linked geometry').check(); assert.equal(await page.locator('canvas').getAttribute('data-link-meshes'), '4');
  assert.equal(await page.locator('canvas').count(), 1); assert.deepEqual(errors, []);
  const wrong = await fetch(`${base}/api/projects/${randomUUID()}/ifc-links`); assert.equal(wrong.status, 404);
  const denied = await fetch(`${base}/api/projects/${project}/ifc-links`, { headers: { Origin: 'https://elsewhere.invalid' } }); assert.equal(denied.status, 400);
  await page.goto(`${base}/?panel-poll`);
  await page.getByText('Artifacts unavailable · Ready B artifact read failed.', { exact: true }).waitFor();
  await page.getByText('Artifacts unavailable · IFC display/job ID must match its source occurrence ID.', { exact: true }).waitFor();
  await page.getByText('Converting · index', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Healthy A.ifc spatial hierarchy').count(), 1);
  assert.equal(await page.getByLabel('Mismatched D.ifc spatial hierarchy').count(), 0);
  await page.getByRole('button', { name: /wall-a/i }).click();
  await page.getByRole('button', { name: 'Reference in request' }).click(); assert.match(await page.locator('#context').innerText(), /no native edit authority/);
  await page.getByRole('button', { name: 'Advance running C' }).click();
  await page.getByText('Converting · geometry', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Healthy A.ifc spatial hierarchy').count(), 1, 'A stays usable while B keeps failing and C advances');
  assert.equal(await page.getByRole('button', { name: 'Cancel conversion' }).count(), 1, 'Running C keeps its cancel action');
  assert.match(await page.locator('#links').getAttribute('data-selected') ?? '', /^[0-3][0-9A-Za-z_$]{21}$/);
  assert.deepEqual(errors, []);
});
