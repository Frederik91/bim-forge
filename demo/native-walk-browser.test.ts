import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createDemoServer } from './server.ts';
import { parseTaskPlacement } from '../src/task-placement.ts';
import { spatialFixtureWorker } from '../tests/fixtures/spatial-workspace/worker.ts';
import type { InsidePose } from './view-navigation.ts';

declare global { interface Window { walk284Pose: () => InsidePose | null } }

test('native doorway and stair walking retains the saved chat, selection, draft and fixed origin through real floor arrivals', { timeout: 150_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-walk-284-'));
  const artifacts = process.env.NATIVE_WALK_ARTIFACTS ?? path.join(directory, 'artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  const server = await createDemoServer({ modelWorker: spatialFixtureWorker({ mode: 'region-context' }), backlogFile: path.join(directory, 'queue.sqlite') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let submissions = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/change-requests')) submissions += 1; });
  t.after(async () => {
    await page.screenshot({ path: path.join(artifacts, 'last.png'), fullPage: true });
    t.diagnostic(JSON.stringify({ errors, status: await page.locator('#status').textContent(), error: await page.locator('#error').textContent() }));
    await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await server.closeModelWorkers();
    assert.equal(path.dirname(directory), os.tmpdir()); assert.ok(path.basename(directory).startsWith('native-walk-284-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const pose = () => page.evaluate(async () => { const url = '/room-app.mjs'; return (await import(url)).captureWorkspaceInsidePose(); });
  const face = async (eye: readonly [number, number, number], forward: readonly [number, number, number]) => {
    await page.evaluate(async ({ eye, forward }) => {
      const url = '/room-app.mjs'; const api = await import(url); const current = api.captureWorkspaceInsidePose();
      if (!current || !api.returnWorkspaceToPose({ ...current, eye, forward, up: [0, 0, 1], motion: 'walk' })) throw new Error('Cannot place the walker on the supported fixture floor');
    }, { eye, forward });
  };
  const walkTo = async (target: number, direction: 1 | -1) => {
    await page.locator('canvas.model-canvas').focus(); await page.keyboard.down('w');
    try {
      await page.waitForFunction(({ target, direction }) => {
        const current = window.walk284Pose();
        return current && direction * (current.eye[0] - target) >= 0;
      }, { target, direction }, { timeout: 15_000 });
    } finally { await page.keyboard.up('w'); }
  };
  await page.goto(base); await page.locator('#project-template').selectOption('house');
  await page.locator('#project-name').fill('Native walking qualification'); await page.locator('#create-project').click();
  await page.locator('#open-chat').click();
  await page.waitForFunction(() => document.getElementById('workspace-shell')?.dataset.spatialView === 'inside');
  await page.evaluate(async () => { const url = '/room-app.mjs'; window.walk284Pose = (await import(url)).captureWorkspaceInsidePose; });
  // Exercise real navigation without the Realistic software-rendering bottleneck in CPU-limited Linux QA.
  await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await face([3, 3.45, 1.6], [1, 0, 0]);
  await page.locator('#new-chat').click(); await page.locator('.model-object-picker').selectOption('level-ground-door-inner');
  await page.locator('#request-text').fill('Keep this door as the reference for my building walk.');
  const response = page.waitForResponse(r => r.url() === `${base}/api/change-requests` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const acknowledged = await response; assert.equal(acknowledged.status(), 202, await acknowledged.text());
  const value: unknown = await acknowledged.json();
  assert.ok(value && typeof value === 'object' && 'ticket' in value && value.ticket && typeof value.ticket === 'object'
    && 'id' in value.ticket && typeof value.ticket.id === 'string' && 'projectId' in value.ticket && typeof value.ticket.projectId === 'string');
  const id = value.ticket.id; const projectId = value.ticket.projectId;
  const placement = async () => {
    const data: unknown = await (await page.request.get(`${base}/api/change-requests/${id}`)).json();
    assert.ok(data && typeof data === 'object' && 'ticket' in data && data.ticket && typeof data.ticket === 'object' && 'taskPlacement' in data.ticket);
    return parseTaskPlacement(data.ticket.taskPlacement);
  };
  const workerDeadline = Date.now() + 15_000;
  for (;;) {
    const current = await (await page.request.get(`${base}/api/change-requests/${id}`)).json();
    if (current.ticket.state === 'needs-input') break;
    assert.ok(Date.now() < workerDeadline, 'Offline clarification worker must finish');
    await page.waitForTimeout(50);
  }
  const originalPlacement = await placement(); assert.equal(originalPlacement.kind, 'placed');
  const originalProject = await (await page.request.get(`${base}/api/projects/${projectId}`)).json();
  await page.locator('#request-text').fill('Unsent refinement stays with this conversation.');
  const canvas = await page.locator('canvas.model-canvas').elementHandle(); assert.ok(canvas);
  const initial = await pose(); assert.ok(initial);
  await walkTo(4.6, 1); assert.ok(Math.abs((await pose()).eye[2] - 1.6) < .01, 'The actual 900 mm doorway is traversed on the same floor');
  const east = await pose(); await face(east.eye, [-1, 0, 0]); await walkTo(3.0, -1);
  await face([4.6, 1.5, 1.6], [1, 0, 0]); await walkTo(6.05, 1);
  await page.locator('#request-text').focus();
  const middle = await pose(); assert.ok(middle.walk && middle.eye[2] > 2 && middle.eye[2] < 4.6,
    JSON.stringify({ eye: middle.eye, motion: middle.motion, levelId: middle.levelId, checkpoint: Boolean(middle.walk) })); assert.equal(middle.levelId, 'level-ground');
  await page.locator('#view-plan').click(); await page.locator('#view-inside').click();
  assert.deepEqual((await pose()).eye, middle.eye, 'View changes restore the actual mid-step eye and support');
  await page.screenshot({ path: path.join(artifacts, 'stair-flight.png'), fullPage: true });
  await walkTo(7.35, 1);
  await page.waitForFunction(() => { const p = window.walk284Pose(); return p?.levelId === 'level-attic' && Math.abs(p.eye[2] - 4.6) < .01; });
  const top = await pose(); assert.equal(top.levelId, 'level-attic');
  assert.match(await page.locator('#selected-title').textContent() ?? '', /Attic/);
  assert.equal(await page.locator('.model-object-picker').inputValue(), 'level-ground-door-inner');
  assert.equal(await page.locator('#selected-object').inputValue(), 'level-ground-door-inner');
  assert.equal(await page.locator('#request-text').inputValue(), 'Unsent refinement stays with this conversation.');
  assert.deepEqual(await placement(), originalPlacement);
  await face(top.eye, [-1, 0, 0]);
  await page.screenshot({ path: path.join(artifacts, 'attic-arrival.png'), fullPage: true });
  await walkTo(4.6, -1);
  await page.waitForFunction(() => { const p = window.walk284Pose(); return p?.levelId === 'level-ground' && Math.abs(p.eye[2] - 1.6) < .01; });
  assert.equal(await page.locator('#request-text').inputValue(), 'Unsent refinement stays with this conversation.');
  assert.deepEqual(await placement(), originalPlacement);
  assert.deepEqual(await (await page.request.get(`${base}/api/projects/${projectId}`)).json(), originalProject, 'Walking changes no accepted model bytes');
  assert.equal(submissions, 1, 'Floor arrivals never submit or continue a chat');
  assert.equal(await canvas.evaluate(node => node.isConnected), true); assert.equal(await page.locator('canvas').count(), 1);
  assert.equal(await page.locator('[data-chat-framework="assistant-ui"]').count(), 1); assert.deepEqual(errors, []);
});
