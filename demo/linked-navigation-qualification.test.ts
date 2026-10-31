import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { linkPoint, parseLinkedPrepared } from '../src/linked-model.ts';

test('actual converted IFC remains pickable through Inside and Overview with source-bound poses and one FXAA camera', { timeout: 120_000 }, async t => {
  const spool = process.env.IFC_EXTERNAL_SPOOL; const fixture = process.env.IFC_FIXTURE;
  assert.ok(spool && fixture, 'Run after the real linked workspace test against its retained spool.');
  const jobs = await fs.readdir(spool); assert.equal(jobs.length, 1);
  const job = jobs[0]; assert.ok(job);
  const directory = path.join(spool, job);
  const terminal: unknown = JSON.parse(await fs.readFile(path.join(directory, 'terminal.json'), 'utf8'));
  assert.deepEqual(terminal, { kind: 'complete' });
  const read = async (name: string): Promise<unknown> => JSON.parse(await fs.readFile(path.join(directory, 'output', name), 'utf8'));
  const prepared = parseLinkedPrepared({ manifest: await read('manifest.json'), index: await read('index.json'), geometry: await read('geometry.json') });
  assert.equal(prepared.manifest.source.originalSha256, createHash('sha256').update(await fs.readFile(fixture)).digest('hex'));
  for (const [name, artifact] of Object.entries(prepared.manifest.artifacts)) {
    const bytes = await fs.readFile(path.join(directory, 'output', name));
    assert.equal(bytes.length, artifact.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
  }
  const wall = prepared.geometry.meshes.find(mesh => prepared.index.objects.some(object => object.ref.globalId === mesh.ref.globalId && object.ifcClass === 'IfcWall'));
  assert.ok(wall);
  const vertex = (index: number): Vector3 => {
    const point = linkPoint(prepared.manifest.occurrence.sourceToProjectMetres, linkPoint(wall.productToSourceMetres, wall.verticesMetres.slice(index * 3, index * 3 + 3)));
    return Vector3.FromArray(point);
  };
  const faces: { normal: Vector3; target: Vector3 }[] = [];
  for (let i = 0; i < wall.triangles.length; i += 3) {
    const [a, b, c]: Vector3[] = wall.triangles.slice(i, i + 3).map(vertex); assert.ok(a && b && c);
    const normal = Vector3.Cross(b.subtract(a), c.subtract(a)).normalize();
    faces.push({ normal, target: a.add(b).add(c).scale(1 / 3) });
  }
  const face = faces.find(value => Math.abs(value.normal.z) < .01); assert.ok(face);
  const { normal, target } = face; const eye = target.add(normal.scale(2));
  const pose = { kind: 'inside', projectId: null, sourcePin: JSON.stringify([prepared.manifest.source, prepared.manifest.occurrence]), levelId: null,
    eye: eye.asArray(), forward: normal.negate().asArray(), up: [0, 0, 1], motion: 'fly' };
  const source = `
import { ModelViewer } from './demo/model-viewer.ts';
import { multiStoreySnapshot } from './src/multi-storey-house.ts';
import { EngineStore } from '@babylonjs/core/Engines/engineStore.js';
const prepared = ${JSON.stringify(prepared)}; const pose = ${JSON.stringify(pose)};
const snapshot = multiStoreySnapshot(); const original = JSON.stringify(snapshot); let selected = null;
const viewer = new ModelViewer({ select() {}, inspect() {}, reference() {}, keyboardReference() {},
  linkedReference(value) { selected = value; viewer.selectLinkedReference(value); update(); } });
viewer.show(document.querySelector('#host'), { snapshot, navigationPin: pose.sourcePin, comparison: null,
  selectedId: 'level-ground-wall-north', focusId: null, mode: 'basic', cutaway: false, interactive: true, reference: null });
viewer.setLinkedModels([{ id: prepared.manifest.occurrence.id, prepared, visible: true }]);
viewer.frameLinkedModels(); let firstScene = EngineStore.LastCreatedScene;
function update(result = null) {
  const scene = EngineStore.LastCreatedScene;
  document.querySelector('#result').textContent = JSON.stringify({ result, selected, pose: viewer.captureInsidePose(),
    state: viewer.navigationState, engines: EngineStore.Instances.length, sameScene: firstScene === scene,
    fxaa: scene.activeCamera._postProcesses.filter(item => item?.name === 'model-antialiasing').length,
    nativeUnchanged: JSON.stringify(snapshot) === original });
}
document.querySelector('#inside').onclick = () => update(viewer.returnToPose(pose));
document.querySelector('#overview').onclick = () => { viewer.frameLinkedModels(); update(); };
document.querySelector('#plan').onclick = () => update(viewer.changeView({kind: 'plan'}));
document.querySelector('#resume').onclick = () => update(viewer.changeView({kind: 'inside', motion: 'fly'}));
document.querySelector('#stale').onclick = () => update(viewer.returnToPose({...pose, sourcePin: 'stale'}));
document.querySelector('#dispose').onclick = () => { viewer.dispose(); document.querySelector('#result').textContent = JSON.stringify({engines: EngineStore.Instances.length}); };
update();
`;
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', write: false });
  const server = http.createServer((request, response) => {
    if (request.url === '/harness.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0]?.text); return; }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><button id="inside">Inside</button><button id="overview">Overview</button><button id="plan">Plan</button><button id="resume">Resume</button><button id="stale">Stale</button><button id="dispose">Dispose</button><pre id="result"></pre><div id="host" style="width:1000px;height:650px"></div><style>pre{max-width:1000px;max-height:130px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.babylon-viewer{width:100%;height:100%;position:relative}canvas{width:100%;height:100%}</style><script type="module" src="/harness.mjs"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(async () => { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + address.port);
  await page.waitForFunction(() => document.querySelector('.babylon-viewer')?.getAttribute('data-scene-ready') === 'true');
  const state = async () => {
    const value: unknown = JSON.parse(await page.locator('#result').innerText());
    assert.ok(value && typeof value === 'object'); return value;
  };
  const assertScene = async () => {
    const value = await state();
    assert.ok('engines' in value && value.engines === 1); assert.ok('sameScene' in value && value.sameScene === true);
    assert.ok('fxaa' in value && value.fxaa === 1); assert.ok('nativeUnchanged' in value && value.nativeUnchanged === true);
    assert.equal(await page.locator('canvas:visible').count(), 1);
  };
  await assertScene(); await page.locator('#inside').click(); await assertScene();
  assert.match(await page.locator('#result').innerText(), /"kind":"changed"/);
  const canvas = page.locator('.babylon-viewer canvas'); const box = await canvas.boundingBox(); assert.ok(box);
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByText('Read-only IFC reference · ' + wall.ref.globalId, { exact: true }).waitFor();
  assert.match(await page.locator('#result').innerText(), new RegExp(prepared.manifest.source.originalSha256));
  const artifacts = process.env.QUAL_ARTIFACTS;
  if (artifacts) await page.screenshot({ path: path.join(artifacts, 'linked-inside-seam.png'), fullPage: true });
  for (let i = 0; i < 4; i++) {
    await page.locator('#plan').click(); await assertScene();
    await page.locator('#overview').click(); await assertScene();
    await page.locator('#resume').click(); await assertScene();
    assert.match(await page.locator('#result').innerText(), /"kind":"changed"/);
  }
  await page.locator('#stale').click(); assert.match(await page.locator('#result').innerText(), /"kind":"unsupported"/);
  await assertScene(); assert.deepEqual(errors, []);
  if (artifacts) await fs.writeFile(path.join(artifacts, 'linked-navigation-seam.json'), JSON.stringify(await state(), null, 2));
  await page.locator('#dispose').click(); assert.deepEqual(await state(), { engines: 0 });
});
