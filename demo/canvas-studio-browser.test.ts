import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createDemoServer } from './server.ts';
import { RoomRepository, diffSnapshots } from '../src/room-model.ts';
import type { ModelWorker } from '../src/model-proposal.ts';

const worker: ModelWorker = {
  identity: { provider: 'fixture', model: 'canvas-studio-review' },
  async run(session) {
    const result = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const view = await model.inspect();
      const layout = view.placement.layout;
      if (!layout) throw new Error('The fixture requires a single-room layout.');
      await model.previewRectangle({...layout,door:{...layout.door,widthMm:1000}});
      return {kind:'propose',review:{summary:'Widen the entry door to 1000 mm.',rationale:'Use the requested width.',
        constraints:'Preserve other model objects.',uncertainty:'Synthetic UI fixture; not a surveyed building.',
        intent:{interpretation:'Widen the selected door.',assumptions:[],certainty:100,basis:'Explicit fixture request.'}}};
    ` });
    assert.equal(result.ok, true, JSON.stringify(result));
  },
};

test('Canvas Studio ships one viewer, side panels and backend-authoritative custom chat/tray review', { timeout: 120_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-studio-241-'));
  const artifacts = process.env.QUAL_ARTIFACTS ?? directory;
  await fs.mkdir(artifacts, { recursive: true });
  const server = await createDemoServer({ modelWorker: worker, backlogFile: path.join(directory, 'requests.sqlite') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { void dialog.accept(); });
  await context.tracing.start({ screenshots: true, snapshots: true });
  t.after(async () => {
    await page.screenshot({ path: path.join(artifacts, 'canvas-studio-last.png'), fullPage: true });
    await context.tracing.stop({ path: path.join(artifacts, 'canvas-studio-trace.zip') });
    await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await server.closeModelWorkers();
    await fs.rm(directory, { recursive: true, force: true });
  });
  await page.goto(base);
  await page.locator('#project-template').selectOption('room');
  await page.locator('#project-name').fill('Canvas Studio fixture');
  await page.locator('#create-project').click();
  await page.locator('#view-3d').click();
  await page.locator('canvas').waitFor();
  const canvas = await page.locator('canvas').elementHandle(); assert.ok(canvas);
  assert.equal(await page.locator('canvas').count(), 1);
  for (const [command, panel] of [['workspace-navigation-toggle', 'workspace-explorer-content'], ['nav-history', 'history-page'],
    ['open-project-evidence', 'evidence-page'], ['nav-backlog', 'backlog-page']] satisfies [string, string][]) {
    await page.locator(`#${command}`).click();
    await page.locator(`#${panel}`).waitFor({ state: 'visible' });
    assert.equal(await page.locator(`#${panel}`).evaluate(el => !!el.closest('#workspace-navigation')), true, `${command} opens the left dock`);
    assert.equal(await page.locator('dialog[open]').count(), 0, 'Rail navigation never opens a popup.');
    assert.equal(await canvas.evaluate(el => el.isConnected), true, 'Panel routing preserves the same canvas.');
    assert.equal(await page.locator('canvas').count(), 1);
  }
  await page.locator('#workspace-navigation-close').click();
  await page.locator('#open-chat').click();
  await page.screenshot({ path: path.join(artifacts, 'canvas-studio-desktop.png'), fullPage: true });
  await page.locator('#request-source-files').setInputFiles({ name: 'door-requirement.txt', mimeType: 'text/plain', buffer: Buffer.from('Entry door width: 1000 mm. Preserve existing room.') });
  await page.getByText('1 of 4 files ready', { exact: true }).waitFor();
  await page.locator('#request-text').fill('Set the entry door width to 1000 mm. Preserve the other objects.');
  const submitted = page.waitForResponse(response => response.url().endsWith('/api/change-requests') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const submission = await submitted; assert.equal(submission.status(), 202, await submission.text());
  const body: unknown = await submission.json();
  assert.ok(body && typeof body === 'object' && 'ticket' in body && body.ticket && typeof body.ticket === 'object'
    && 'projectId' in body.ticket && typeof body.ticket.projectId === 'string'
    && 'id' in body.ticket && typeof body.ticket.id === 'string');
  const projectId = body.ticket.projectId;
  const ticketId = body.ticket.id;
  async function project(): Promise<RoomRepository> {
    const value: unknown = await (await page.request.get(`${base}/api/projects/${projectId}`)).json();
    assert.ok(value && typeof value === 'object' && 'project' in value && typeof value.project === 'string');
    return RoomRepository.restore(value.project);
  }
  const before = await project(); const baseline = before.head('main');
  for (let attempt = 0; attempt < 200; attempt++) {
    const response: unknown = await (await page.request.get(`${base}/api/change-requests/${encodeURIComponent(ticketId)}`)).json();
    assert.ok(response && typeof response === 'object' && 'ticket' in response && response.ticket && typeof response.ticket === 'object' && 'state' in response.ticket);
    assert.notEqual(response.ticket.state, 'failed', JSON.stringify(response.ticket));
    if (response.ticket.state === 'ready') break;
    await new Promise<void>(resolve => setTimeout(resolve, 100));
  }
  const inspect = page.getByRole('button', { name: 'Inspect proposal', exact: true }).last();
  const tray = page.getByRole('region', { name: 'Canvas proposal review' });
  await inspect.or(tray).first().waitFor({ timeout: 30_000 });
  if (await inspect.isVisible()) await inspect.click();
  await tray.waitFor({ state: 'visible' });
  assert.equal((await project()).head('main'), baseline, 'A displayed proposal leaves accepted Main unchanged.');
  assert.equal(await page.locator('[data-chat-framework="assistant-ui"]').count(), 1);
  assert.equal(await page.locator('#request-chat-mount').getByRole('link', { name: /door-requirement.txt/ }).count(), 1);
  await page.screenshot({ path: path.join(artifacts, 'canvas-studio-proposal.png'), fullPage: true });
  await t.test('a controls refresh cannot restore offline proposal actions', async () => {
    const retainedAccept = await tray.getByRole('button', { name: /^Accept into/ }).elementHandle();
    assert.ok(retainedAccept);
    const endpoint = `${base}/api/change-requests/${encodeURIComponent(ticketId)}`;
    const decisionRequests: string[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/decision')) decisionRequests.push(request.url());
    });
    await page.route(endpoint, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture conversation disconnect' }) }));
    try {
      await page.locator('.request-chat-status[data-status="offline"]').waitFor({ state: 'visible' });
      await page.locator('#request-text').fill('Keep the unsent revision draft.');
      assert.equal(await tray.count(), 0, 'Unrelated controls refresh must not republish an offline tray.');
      await retainedAccept.evaluate(button => button.click());
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      assert.deepEqual(decisionRequests, [], 'Retained offline controls cannot send decisions.');
      assert.equal((await project()).head('main'), baseline);
    } finally {
      await page.unroute(endpoint);
      await page.locator('.request-chat-status[data-status="offline"]').waitFor({ state: 'detached' });
      await page.locator('#request-text').fill('');
      await tray.waitFor({ state: 'visible' });
    }
  });
  await t.test('Revise returns from Sources & checks to the focused composer', async () => {
    await page.locator('#request-text').fill('Preserve this unsent refinement.');
    await tray.getByRole('button', { name: 'Sources & checks', exact: true }).click();
    assert.equal(await page.locator('#editor-panel').isHidden(), true);
    await tray.getByRole('button', { name: 'Revise', exact: true }).click();
    assert.equal(await page.locator('#editor-panel').isVisible(), true);
    assert.equal(await page.locator('#request-text').isEnabled(), true);
    assert.equal(await page.locator('#request-text').evaluate(element => element === document.activeElement), true);
    assert.equal(await page.locator('#request-text').inputValue(), 'Preserve this unsent refinement.');
    assert.equal((await project()).head('main'), baseline, 'Opening a refinement does not accept the proposal.');
    await page.locator('#request-text').fill('');
  });
  const decision = page.waitForResponse(response => response.url().endsWith('/decision') && response.request().method() === 'POST');
  await tray.getByRole('button', { name: /^Accept into/ }).click();
  const accepted = await decision; assert.equal(accepted.status(), 200, await accepted.text());
  const after = await project();
  assert.notEqual(after.head('main'), baseline);
  const delta = diffSnapshots(before.view(baseline).snapshot, after.view(after.head('main')).snapshot);
  assert.deepEqual(delta.entities.modified.map(change => change.id), ['door-entry']);
  assert.equal(delta.entities.added.length, 0); assert.equal(delta.entities.removed.length, 0);
  assert.equal(await page.locator('canvas').count(), 1);
  assert.equal(await canvas.evaluate(el => el.isConnected), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#open-chat').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(artifacts, 'canvas-studio-phone.png'), fullPage: true });
  assert.deepEqual(errors, []);
});
