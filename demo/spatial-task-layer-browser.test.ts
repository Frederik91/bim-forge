import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('real 3D agent bodies choose same-place conversations, keep target highlights separate and remain usable on narrow screens', { timeout: 90_000 }, async t => {
  const output = process.env.TASK_AGENT_EVIDENCE ?? await fs.mkdtemp(path.join(os.tmpdir(), 'task-agent-263-'));
  await fs.mkdir(output, { recursive: true });
  const result = await build({ entryPoints: ['demo/spatial-task-layer-gallery.ts'], bundle: true, format: 'esm', write: false });
  const bundle = result.outputFiles[0]; assert.ok(bundle);
  const server = http.createServer((request, response) => {
    if (request.url === '/gallery.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.contents); return; }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Task agent graphics</title><body><script type="module" src="/gallery.mjs"></script></body></html>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  t.after(async () => {
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (!process.env.TASK_AGENT_EVIDENCE) await fs.rm(output, { recursive: true, force: true });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.waitForSelector('body[data-ready=true]');
  const marker = page.locator('[data-task="T-01"]'); await marker.waitFor();
  const point = await marker.evaluate(element => ({ x: Number(element.dataset.anchorX), y: Number(element.dataset.anchorY) }));
  const canvas = await page.locator('canvas').boundingBox(); assert.ok(canvas);
  await page.mouse.click(canvas.x + point.x, canvas.y + point.y + 42);
  await page.getByRole('button', { name: 'T-02', exact: true }).waitFor();
  await page.getByRole('button', { name: 'T-02', exact: true }).click();
  assert.match(await page.locator('#conversation').innerText(), /T-02 · Check door clearance/);
  assert.match(await page.locator('#tasks').innerText(), /Needs input · Selected/);
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Report T-01 working' }).click();
  assert.match(await page.locator('#tasks').innerText(), /Working/);
  await page.getByRole('button', { name: 'Report T-01 ready' }).click();
  assert.match(await page.locator('#tasks').innerText(), /Ready for review/);
  await page.getByRole('button', { name: 'Toggle wall occlusion' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.anchor').length === 0);
  assert.match(await page.locator('#tasks').innerText(), /T-04.*Legacy conversation/s);
  await page.getByRole('button', { name: 'Toggle wall occlusion' }).click();
  await marker.waitFor();
  const narrowBounds: unknown[] = [];
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForFunction(value => document.body.dataset.renderWidth === String(value), width);
    await page.getByRole('button', { name: /Draft-03 · Unsent wall question/ }).click();
    assert.match(await page.locator('#conversation').innerText(), /Unsent draft. No worker has started/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const bounds = await page.locator('.anchor').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect(); return { text: element.textContent, left: box.left, right: box.right, width: box.width };
    }));
    assert.equal(bounds.length, 2, 'both same-place and draft labels remain visible');
    assert.ok(bounds.every(box => box.left >= 7.5 && box.right <= width - 7.5), `readable labels fit inside the ${width}px stage: ${JSON.stringify(bounds)}`);
    narrowBounds.push({ viewport: width, bounds });
    // The true body point remains pickable even when its label is clamped at the edge.
    const bodyPoint = await marker.evaluate(element => ({ x: Number(element.dataset.anchorX), y: Number(element.dataset.anchorY) }));
    await page.locator('canvas').scrollIntoViewIfNeeded();
    const stage = await page.locator('canvas').boundingBox(); assert.ok(stage);
    await page.mouse.click(stage.x + bodyPoint.x, stage.y + bodyPoint.y + 26);
    await page.getByRole('button', { name: 'T-02', exact: true }).click();
    assert.match(await page.locator('#conversation').innerText(), /T-02 · Check door clearance/);
    await page.locator('header').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, width === 390 ? 'narrow.png' : 'narrow-320.png'), fullPage: true });
  }
  await page.getByRole('button', { name: /T-04 · Legacy conversation/ }).focus(); await page.keyboard.press('Enter');
  assert.match(await page.locator('#conversation').innerText(), /T-04 · Legacy conversation/);
  await page.getByRole('button', { name: 'Dispose task layer' }).click();
  assert.equal(await page.locator('#tasks button').count(), 0); assert.equal(await page.locator('.anchor').count(), 0);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'browser-result.json'), JSON.stringify({ errors, viewports: ['1440x1000', '390x844', '320x844'], narrowBounds, actualBodyPick: true, samePlaceChooser: true, unplacedKeyboardAccess: true, occlusion: true, constructionModelDelta: 0 }, null, 2));
});
