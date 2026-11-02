import assert from 'node:assert/strict';
import { clickConversationControl } from '../tests/fixtures/spatial-workspace/browser.ts';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createDemoServer } from './server.ts';
import { spatialFixtureWorker } from '../tests/fixtures/spatial-workspace/worker.ts';

test('floating assistant resizes by pointer and keyboard, retains size and keeps advanced permissions explicit', { timeout: 120_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-card-293-'));
  const artifacts = process.env.ASSISTANT_CARD_ARTIFACTS ?? 'artifacts/assistant-card-293'; await fs.mkdir(artifacts, { recursive: true });
  const server = await createDemoServer({ modelWorker: spatialFixtureWorker(), backlogFile: path.join(directory, 'queue.sqlite') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    await page.screenshot({ path: path.join(artifacts, 'last.png'), fullPage: true });
    t.diagnostic(JSON.stringify({ errors, status: await page.locator('#status').textContent(), error: await page.locator('#error').textContent() }));
    await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await server.closeModelWorkers();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const capture = () => page.evaluate(async () => { const url = '/room-app.mjs'; return (await import(url)).captureWorkspaceInsidePose(); });
  const panel = page.locator('#workspace-context'); const handle = page.getByRole('button', { name: 'Resize assistant', exact: true });
  const bounds = async () => { const box = await panel.boundingBox(); assert.ok(box); return box; };
  await page.goto(base); await page.locator('#project-template').selectOption('house');
  await page.locator('#project-name').fill('Resizable assistant fixture'); await page.locator('#create-project').click();
  await page.locator('#open-chat').click(); await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await page.locator('.babylon-viewer[data-scene-ready="true"]').waitFor();
  const canvas = await page.locator('canvas.model-canvas').elementHandle(); assert.ok(canvas);
  const initial = await bounds(); const pose = await capture();
  const grip = await handle.boundingBox(); assert.ok(grip);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 160, grip.y + grip.height / 2 + 70, { steps: 8 }); await page.mouse.up();
  const dragged = await bounds();
  assert.ok(dragged.width > initial.width + 150); assert.ok(dragged.height > initial.height + 60);
  assert.deepEqual(await capture(), pose, 'Resizing never moves the eye or facing');
  await page.locator('#request-text').fill('Keep this unsent context while resizing.');
  await page.locator('.model-object-picker').selectOption('door-entry');
  assert.deepEqual(await bounds(), dragged, 'A model selection/render retains the chosen rectangle');
  await handle.focus(); await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('ArrowUp');
  const keyboard = await bounds(); assert.ok(keyboard.width > dragged.width + 30); assert.ok(keyboard.height < dragged.height - 14);
  await page.keyboard.press('Home'); const restored = await bounds(); assert.ok(Math.abs(restored.width - initial.width) < 1);
  assert.ok(Math.abs(restored.height - initial.height) < 1);
  const heading = panel.locator(':scope > .workspace-panel-heading');
  const move = page.getByRole('button', { name: 'Move assistant', exact: true });
  const dragHeader = async (dx: number, dy: number): Promise<void> => {
    const box = await heading.boundingBox(); assert.ok(box);
    const start = { x: box.x + 40, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 }); await page.mouse.up();
  };
  await dragHeader(-240, -100); const moved = await bounds();
  assert.ok(Math.abs(moved.x - restored.x + 240) < 1 && Math.abs(moved.y - restored.y + 100) < 1, 'Dragging the actual title bar moves the card');
  assert.equal(moved.width, restored.width); assert.equal(moved.height, restored.height);
  assert.deepEqual(await capture(), pose, 'Dragging the card cannot turn or move the camera');
  await move.focus(); await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('ArrowUp');
  const nudged = await bounds(); assert.equal(nudged.x, moved.x - 32); assert.equal(nudged.y, moved.y - 16);
  await page.locator('#workspace-context-close').click(); await page.locator('#open-chat').click();
  assert.deepEqual(await bounds(), nudged, 'Closing and reopening the personal assistant retains its chosen position');
  assert.equal(await page.locator('#request-text').inputValue(), 'Keep this unsent context while resizing.');
  await page.locator('.model-object-picker').selectOption('level-ground-wall-inner');
  assert.deepEqual(await bounds(), nudged, 'A new model reference does not re-anchor a manually moved card');
  await dragHeader(-2000, -2000); const topLeft = await bounds();
  const stage = await page.locator('.spatial-workspace-stage').boundingBox(); assert.ok(stage);
  assert.ok(Math.abs(topLeft.x - stage.x - 8) < 1 && Math.abs(topLeft.y - stage.y - 8) < 1, 'The header stays reachable at the upper bounds');
  await dragHeader(3000, 2000); const bottomRight = await bounds();
  assert.ok(Math.abs(bottomRight.x + bottomRight.width - stage.x - stage.width + 8) < 1 && Math.abs(bottomRight.y + bottomRight.height - stage.y - stage.height + 8) < 1, 'The whole card stays within the lower bounds');
  await move.focus(); await page.keyboard.press('Home');
  assert.deepEqual(await capture(), pose, 'Keyboard movement and edge clamping cannot change the camera');
  await page.screenshot({ path: path.join(artifacts, 'moved-personal.png'), fullPage: true });
  await handle.focus();
  await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowDown'); const chosen = await bounds();
  await page.locator('#new-chat').click(); assert.deepEqual(await bounds(), chosen, 'An independent chat retains manual dimensions');

  const options = page.locator('#request-options'); assert.equal(await options.getAttribute('open'), null);
  await clickConversationControl(page, '#chat-request-settings');
  assert.equal(await options.getAttribute('open'), '');
  await page.getByText('For most tasks, select an object or draw markup and describe the change.', { exact: false }).waitFor();
  assert.equal(await page.locator('#composer-scope-options').getAttribute('open'), null);
  assert.equal(await page.locator('.request-reconstruction-options').getAttribute('open'), null);
  assert.equal(await page.locator('.request-naming-options').getAttribute('open'), null);
  assert.equal(await page.locator('#request-reconstruct').isChecked(), false);
  assert.equal(await page.locator('#reconstruction-scope').inputValue(), 'floor-plan-reconstruction');
  await page.locator('.request-reconstruction-options > summary').click();
  await page.locator('#request-reconstruct').check(); await page.locator('#reconstruction-scope').selectOption('building-reconstruction');
  assert.equal(await page.locator('#request-reconstruct').isChecked(), true, 'Broader reconstruction still needs explicit permission');
  await page.locator('#request-reconstruct').uncheck();
  await options.locator(':scope > summary').click();
  await page.locator('.model-object-picker').selectOption('door-entry');
  await page.locator('#request-text').fill('Widen this door to 1100 mm, keeping its centre.');
  const response = page.waitForResponse(r => r.url() === `${base}/api/change-requests` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click(); const submitted = await response;
  assert.equal(submitted.status(), 202, await submitted.text());
  const data: unknown = submitted.request().postDataJSON(); assert.ok(data && typeof data === 'object' && 'request' in data);
  const request = data.request; assert.ok(request && typeof request === 'object' && 'selectedObjectIds' in request);
  assert.deepEqual(request.selectedObjectIds, ['door-entry']); assert.equal('authoringScope' in request, false); assert.equal('scope' in request, false);
  assert.equal(await canvas.evaluate(node => node.isConnected), true); assert.equal(await page.locator('canvas').count(), 1);
  await page.screenshot({ path: path.join(artifacts, 'desktop.png'), fullPage: true });

  await handle.focus(); await page.keyboard.press('Shift+ArrowLeft'); const desktop = await bounds();
  for (const width of [800, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (!await panel.isVisible()) await page.locator('#open-chat').click();
    await handle.scrollIntoViewIfNeeded();
    const box = await bounds(); const stage = await page.locator('.spatial-workspace-stage').boundingBox(); assert.ok(stage);
    assert.ok(box.x >= stage.x + 7 && box.x + box.width <= stage.x + stage.width - 7);
    assert.ok(box.y >= stage.y + 7 && box.y + box.height <= stage.y + stage.height - 7);
    assert.equal(await handle.evaluate(node => { const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return hit === node || node.contains(hit); }), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(artifacts, `width-${width}.png`), fullPage: true });
  }
  await move.focus(); await page.keyboard.press('ArrowUp');
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (!await panel.isVisible()) await page.locator('#open-chat').click();
  await page.waitForFunction(width => Math.abs((document.getElementById('workspace-context')?.getBoundingClientRect().width ?? 0) - width) < 1, desktop.width);
  assert.equal((await bounds()).width, desktop.width, 'Moving while the phone clamps the card must retain the chosen desktop width');
  assert.ok(Math.abs((await bounds()).height - desktop.height) < 1, 'Desktop dimensions return after a narrow viewport');
  if (await panel.getAttribute('data-assistant-mode') === 'personal') {
    await page.waitForFunction(() => document.getElementById('workspace-context')?.dataset.assistantMode === 'personal' && !document.querySelector<HTMLTextAreaElement>('#request-text')?.disabled);
    await page.getByRole('button', { name: 'Tasks', exact: true }).click();
    await page.locator('#spatial-task-list button[data-task-id]').first().click();
    await page.waitForFunction(() => document.getElementById('workspace-context')?.dataset.assistantMode === 'task' && !document.querySelector<HTMLTextAreaElement>('#request-text')?.disabled);
  }
  const proposalContext = page.locator('.spatial-placement-notice').filter({ hasText: 'Task targets refer to the accepted model. Showing proposal geometry.' });
  await page.getByRole('region', { name: 'Canvas proposal review' }).waitFor();
  await proposalContext.waitFor();
  await proposalContext.locator(':scope > summary').click();
  await proposalContext.locator('p').waitFor();
  await page.locator('#spatial-chat-options-toggle').click();
  await page.locator('#assistant-dispatch-context').waitFor();
  await page.locator('#spatial-delete-agent').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector<HTMLTextAreaElement>('#request-text')?.disabled);
  await page.locator('#request-text').fill('Keep this follow-up reachable while the task is open.');
  await page.setViewportSize({ width: 320, height: 900 });
  if (!await panel.isVisible()) await page.locator('#open-chat').click();
  await handle.focus();
  for (let step = 0; step < 40; step++) await page.keyboard.press('ArrowUp');
  const minimum = await page.evaluate(() => {
    const required = (selector: string) => { const node = document.querySelector<HTMLElement>(selector); if (!node) throw new Error(`Missing ${selector}`); return node; };
    const hit = (selector: string) => { const node = required(selector); const box = node.getBoundingClientRect(); const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return { top: box.top, bottom: box.bottom, height: box.height, hit: at === node || node.contains(at) }; };
    return { panel: hit('#workspace-context'), input: hit('#request-text'), send: hit('#save-proposal'),
      transcript: hit('#request-chat-mount'), content: hit('#workspace-context-content'),
      heading: hit('#workspace-context > .workspace-panel-heading'), footer: hit('.spatial-conversation-resize') };
  });
  t.diagnostic(JSON.stringify({ minimum }));
  await page.screenshot({ path: path.join(artifacts, 'minimum-320.png'), fullPage: true });
  assert.equal(minimum.input.hit, true, 'Shrinking a task conversation keeps the textarea directly reachable');
  assert.equal(minimum.send.hit, true, 'Shrinking a task conversation keeps Send directly reachable');
  assert.ok(minimum.transcript.height >= 64, 'The minimum retains a readable, separately scrolling transcript');
  assert.ok(minimum.input.bottom <= minimum.content.bottom && minimum.send.bottom <= minimum.content.bottom, 'Composer controls stay inside their visible content region');
  await page.setViewportSize({ width: 320, height: 600 });
  if (!await panel.isVisible()) await page.locator('#open-chat').click();
  await page.waitForFunction(() => document.getElementById('workspace-context')?.dataset.scrollFallback === 'true');
  await page.locator('#request-text').scrollIntoViewIfNeeded();
  t.diagnostic(JSON.stringify(await page.evaluate(() => ({ shortViewport: {
    cardHeight: document.getElementById('workspace-context')?.getBoundingClientRect().height,
    cardScrollTop: document.getElementById('workspace-context')?.scrollTop,
    notices: [...document.querySelectorAll('.spatial-placement-notice')].filter(node => node.getBoundingClientRect().height > 0).map(node => node.textContent),
    targets: ['request-text', 'save-proposal'].map(id => { const node = document.getElementById(id); if (!node) throw new Error(`Missing ${id}`); const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return { id, top: box.top, bottom: box.bottom, hit: hit === node || node.contains(hit) }; }),
  } }))));
  for (const selector of ['#request-text', '#save-proposal']) assert.equal(await page.locator(selector).evaluate(node => {
    const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return hit === node || node.contains(hit);
  }), true, 'Short viewport scrolling reaches each composer control');
  await page.locator('#request-chat-mount').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#request-chat-mount').evaluate(node => {
    const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return hit === node || node.contains(hit);
  }), true, 'Short viewport scrolling also reaches the transcript');
  await page.screenshot({ path: path.join(artifacts, 'short-320.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.waitForFunction(() => document.getElementById('workspace-context')?.dataset.scrollFallback === 'false');
  assert.equal(await panel.evaluate(node => node.scrollTop), 0, 'Leaving short-viewport fallback resets its outer scroll offset');
  assert.equal(await handle.evaluate(node => { const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return hit === node || node.contains(hit); }), true);
  const taskBefore = await bounds(); const taskPose = await capture();
  await dragHeader(0, -24); const taskMoved = await bounds();
  assert.ok(Math.abs(taskMoved.y - taskBefore.y + 24) < 1, 'The same header moves a saved task conversation');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const touchHeading = await heading.boundingBox(); assert.ok(touchHeading);
  const touch = { x: touchHeading.x + 40, y: touchHeading.y + touchHeading.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touch.x, y: touch.y - 20 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const touched = await bounds(); assert.ok(Math.abs(touched.y - taskMoved.y + 20) < 1, 'Touch dragging moves the header without scrolling the model');
  assert.deepEqual(await capture(), taskPose); await cdp.detach();
  await page.screenshot({ path: path.join(artifacts, 'moved-task-320.png'), fullPage: true });
  assert.deepEqual(errors, []);
});
