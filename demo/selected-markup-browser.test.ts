import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { createDemoServer } from './server.ts';
import type { ModelWorker } from '../src/model-proposal.ts';
import { RoomRepository } from '../src/room-model.ts';
import { parseConversationVisual } from '../src/request-conversation.ts';

const worker: ModelWorker = { identity: { provider: 'test', model: 'proposal-markup-fixture' }, async run(session) {
  const result = await session.executeTool('run_model_script', { language: 'typescript', source: `
    const layout = (await model.inspect()).placement.layout;
    if (!layout) throw new Error('Missing fixture room');
    await model.previewRectangle({...layout,door:{...layout.door,widthMm:1200}});
    return {kind:'propose',review:{summary:'Widen entry to 1200 mm.',rationale:'Explicit fixture request.',
      constraints:'Retain the room.',uncertainty:'Synthetic test only.',intent:{interpretation:'Widen entry.',assumptions:[],certainty:99,basis:'Explicit fixture request.'}}};` });
  assert.equal(result.ok, true, JSON.stringify(result));
} };

async function fixture(t: TestContext, name: string) {
  const output = process.env.SELECTED_MARKUP_EVIDENCE ?? os.tmpdir();
  await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, name + '-'));
  const backend = await createDemoServer({ backlogFile: path.join(directory, 'queue.sqlite'), modelWorker: worker });
  await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
  const backendAddress = backend.address(); assert.ok(backendAddress && typeof backendAddress === 'object');
  const assets = path.resolve('dist/demo');
  const front = http.createServer((request, response) => {
    if (request.url?.startsWith('/api/')) {
      const proxy = http.request({ host: '127.0.0.1', port: backendAddress.port, method: request.method, path: request.url,
        headers: request.headers }, incoming => { response.writeHead(incoming.statusCode ?? 502, incoming.headers); incoming.pipe(response); });
      proxy.on('error', () => { response.writeHead(502); response.end(); }); request.pipe(proxy); return;
    }
    const name = request.url === '/' ? 'index.html' : request.url?.slice(1);
    if (!name || !['index.html', 'room-app.mjs', 'room.css', 'request-chat.css'].includes(name)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', name.endsWith('.mjs') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    void fs.readFile(path.join(assets, name)).then(bytes => response.end(bytes), () => { response.writeHead(404); response.end(); });
  });
  await new Promise<void>(resolve => front.listen(0, '127.0.0.1', resolve));
  const address = front.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.screenshot({ path: path.join(directory, 'final.png') }).catch(() => {});
    await fs.writeFile(path.join(directory, 'errors.json'), JSON.stringify(errors));
    await browser.close(); await new Promise<void>(resolve => front.close(() => resolve()));
    await new Promise<void>(resolve => backend.close(() => resolve())); await backend.closeModelWorkers(); });
  await page.goto(base);
  await page.locator('#project-template').selectOption('room');
  await page.locator('#project-name').fill(name);
  const created = page.waitForResponse(response => response.url() === base + '/api/projects' && response.request().method() === 'POST');
  await page.locator('#create-project').click();
  const value: unknown = await (await created).json();
  assert.ok(value && typeof value === 'object' && 'project' in value && typeof value.project === 'string');
  const repository = await RoomRepository.restore(value.project);
  await page.locator('#view-3d').click();
  await page.waitForFunction(() => document.querySelector('.babylon-viewer')?.getAttribute('data-scene-ready') === 'true');
  return { page, base, directory, project: value.project, projectId: repository.projectId, errors };
}

async function wallPoint(page: Page) {
  const canvas = page.locator('.babylon-viewer canvas'); const box = await canvas.boundingBox(); assert.ok(box);
  for (const y of [.40, .35, .45, .30, .50]) for (const x of [.50, .40, .60, .30, .70]) {
    const point = { x: box.x + box.width * x, y: box.y + box.height * y };
    await page.mouse.move(point.x, point.y);
    const id = await page.locator('.babylon-viewer').getAttribute('data-hovered-id');
    if (id?.startsWith('wall-')) return { ...point, id };
  }
  assert.fail('Fixture has no visible wall face.');
}
async function draw(page: Page, point: { x: number; y: number }, count = 1) {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 65, point.y + 40, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(n => document.querySelector('.model-markup-controls')?.getAttribute('data-markup-count') === String(n), count);
}

test('selecting a wall then opening Markup uses that face, with an explicit persistent floor override', { timeout: 90_000 }, async t => {
  const f = await fixture(t, 'selected-wall'); const { page } = f;
  const point = await wallPoint(page); await page.mouse.click(point.x, point.y);
  assert.equal(await page.getByLabel('Select 3D object').inputValue(), point.id);
  await page.getByRole('button', { name: '3D markup', exact: true }).click();
  const plane = page.getByLabel('Markup drawing plane');
  assert.match(await plane.locator('option:checked').innerText(), /selected surface/i);
  assert.match(await page.locator('.model-markup-status').innerText(), /Drawing on selected surface/);
  await draw(page, point);
  await plane.selectOption('floor');
  await page.getByRole('button', { name: '3D markup', exact: true }).click();
  await page.getByRole('button', { name: '3D markup', exact: true }).click();
  assert.equal(await plane.inputValue(), 'floor', 'Reopening tools must preserve an explicit floor override.');
  await draw(page, point, 2);
  await page.locator('#request-text').fill('Use this wall rectangle as context.');
  const sent = page.waitForRequest(request => request.url() === f.base + '/api/change-requests' && request.method() === 'POST');
  await page.locator('#save-proposal').click(); const payload: unknown = (await sent).postDataJSON();
  assert.ok(payload && typeof payload === 'object' && 'request' in payload && payload.request && typeof payload.request === 'object' && 'conversationVisual' in payload.request);
  const visual = parseConversationVisual(payload.request.conversationVisual);
  const rectangle = visual.annotations[0]; assert.ok(rectangle?.kind === 'rectangle');
  assert.ok(Math.max(...rectangle.corners.map(p => p[2])) - Math.min(...rectangle.corners.map(p => p[2])) > .1, 'Wall markup must have vertical extent.');
  const floor = visual.annotations[1]; assert.ok(floor?.kind === 'rectangle');
  assert.ok(floor.corners.every(p => Math.abs(p[2]) < .00001), 'Floor override must use the level elevation.');
  const accepted: unknown = await (await page.request.get(f.base + '/api/projects/' + f.projectId)).json();
  assert.ok(accepted && typeof accepted === 'object' && 'project' in accepted); assert.equal(accepted.project, f.project);
  assert.deepEqual(f.errors, []);
});

test('changing selection without a picked face requires that element and never projects onto a floor', { timeout: 90_000 }, async t => {
  const f = await fixture(t, 'missing-face'); const { page } = f;
  const point = await wallPoint(page); await page.mouse.click(point.x, point.y);
  const picker = page.getByLabel('Select 3D object');
  const ids = await picker.locator('option').evaluateAll(items => items.flatMap(item => item instanceof HTMLOptionElement ? [item.value] : []));
  const other = ids.find(id => id.startsWith('wall-') && id !== point.id); assert.ok(other);
  await picker.selectOption(other);
  await page.getByRole('button', { name: '3D markup', exact: true }).click();
  assert.match(await page.getByLabel('Markup drawing plane').locator('option:checked').innerText(), /selected surface/i);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 65, point.y + 40, { steps: 8 }); await page.mouse.up();
  assert.equal(await page.locator('.model-markup-controls').getAttribute('data-markup-count'), '0');
  assert.match(await page.locator('.model-markup-status').innerText(), /selected element/);
  await page.locator('.babylon-viewer canvas').press('Escape');
  assert.deepEqual(f.errors, []);
});

test('a validated proposal preview permits markup and sends its exact proposal binding with the next reply', { timeout: 90_000 }, async t => {
  const f = await fixture(t, 'proposal-wall'); const { page } = f;
  await page.locator('#request-text').fill('Widen entry to 1200 mm.');
  const sent = page.waitForResponse(response => response.url() === f.base + '/api/change-requests' && response.request().method() === 'POST');
  await page.locator('#save-proposal').click(); const value: unknown = await (await sent).json();
  assert.ok(value && typeof value === 'object' && 'ticket' in value && value.ticket && typeof value.ticket === 'object' && 'id' in value.ticket && typeof value.ticket.id === 'string');
  const ticketId = value.ticket.id;
  await page.getByRole('button', { name: 'Accept into Main', exact: true }).waitFor({ timeout: 45_000 });
  const ready: unknown = await (await page.request.get(`${f.base}/api/change-requests/${ticketId}`)).json();
  assert.ok(ready && typeof ready === 'object' && 'ticket' in ready && ready.ticket && typeof ready.ticket === 'object'
    && 'result' in ready.ticket && ready.ticket.result && typeof ready.ticket.result === 'object'
    && 'project' in ready.ticket.result && typeof ready.ticket.result.project === 'string');
  const proposal = await RoomRepository.restore(ready.ticket.result.project);
  const expected = proposal.reviews().find(review => review.decision.status === 'pending'); assert.ok(expected);
  const markup = page.getByRole('button', { name: '3D markup', exact: true });
  assert.ok(await markup.isVisible(), 'The proposal must retain markup controls.');
  const point = await wallPoint(page); await page.mouse.click(point.x, point.y); await markup.click();
  await draw(page, point);
  await page.locator('#request-text').fill('Use this marked wall area for the revision.');
  const reply = page.waitForResponse(response => response.url() === `${f.base}/api/change-requests/${ticketId}/messages` && response.request().method() === 'POST');
  await page.locator('#save-proposal').click(); const response = await reply;
  assert.equal(response.status(), 202, await response.text());
  const payload: unknown = response.request().postDataJSON();
  assert.ok(payload && typeof payload === 'object' && 'visual' in payload);
  const visual = parseConversationVisual(payload.visual); assert.equal(visual.snapshot.kind, 'proposal');
  assert.deepEqual(visual.snapshot, { kind: 'proposal', revisionId: expected.proposalRevisionId, proposalName: expected.proposalName });
  const rectangle = visual.annotations[0]; assert.ok(rectangle?.kind === 'rectangle');
  assert.ok(Math.max(...rectangle.corners.map(p => p[2])) - Math.min(...rectangle.corners.map(p => p[2])) > .1);
  const accepted: unknown = await (await page.request.get(f.base + '/api/projects/' + f.projectId)).json();
  assert.ok(accepted && typeof accepted === 'object' && 'project' in accepted); assert.equal(accepted.project, f.project);
  assert.deepEqual(f.errors, []);
});
