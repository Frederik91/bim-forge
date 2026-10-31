import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { spatialTokens } from './ui/design-tokens.ts';
import { createDemoServer } from './server.ts';

function luminance(hex: string): number {
  const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}

test('shared text, action and drawing foregrounds retain readable contrast', () => {
  const c = spatialTokens.color;
  for (const [foreground, background] of [[c.ink, c.paper], [c.muted, c.paper], [c.muted, c.canvas],
    [c.white, c.primary], [c.primary, c.selectionFill], [c.warning, c.warningFill], [c.error, c.errorFill],
    [c.success, c.successFill], [c.proposedText, c.proposedFill], [c.drawingInk, c.drawingPaper],
    [c.drawingMuted, c.drawingPaper], [c.selection, c.drawingPaper]]) {
    const a = luminance(foreground), b = luminance(background);
    const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
  }
});

test('the built gallery preserves draft, keyboard access, truthful fixture states and narrow layout', { timeout: 60_000 }, async t => {
  const artifacts = process.env.QUAL_ARTIFACTS ?? await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-design-252-'));
  await fs.mkdir(artifacts, { recursive: true });
  const root = new URL('../dist/design-system/', import.meta.url);
  const assets = new Map([['/', ['index.html', 'text/html']], ['/gallery.css', ['gallery.css', 'text/css']], ['/gallery.mjs', ['gallery.mjs', 'text/javascript']]]);
  const server = http.createServer(async (request, response) => {
    const asset = assets.get(request.url ?? '/');
    if (!asset) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': asset[1] }); response.end(await fs.readFile(new URL(asset[0], root)));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(async () => { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByRole('heading', { name: 'The model stays present.' }).waitFor();
  assert.equal(await page.getByText('6 000 mm · wall axes', { exact: true }).count(), 1);
  assert.equal(await page.getByText('D · 800 mm', { exact: true }).count(), 1);
  for (const label of ['Queued', 'Working', 'Needs input', 'Failed', 'Ready for review', 'Accepted', 'Rejected', 'Cancelled']) {
    assert.ok((await page.locator('.spatial-state-label').allTextContents()).includes(label), label);
  }
  for (const title of ['Source revision changed', 'No tasks here', 'Loading conversation', 'Conversation could not load']) {
    assert.equal(await page.getByText(title, { exact: true }).count(), 1);
  }
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Skip to controls');
  assert.equal(await page.locator('.gallery-header a').evaluate(element => getComputedStyle(element).outlineWidth), '3px');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'gallery-draft');
  await page.getByLabel('Follow-up message').fill('Retain my unsent fixture draft.');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Open next task');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.gallery-conversation-meta strong').textContent(), 'T-25');
  assert.equal(await page.getByLabel('Follow-up message').inputValue(), 'Retain my unsent fixture draft.');
  assert.equal(await page.getByRole('button', { name: 'Accept unavailable' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Send unavailable in gallery' }).isDisabled(), true);
  await page.screenshot({ path: path.join(artifacts, 'gallery-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Explain this gallery' }).click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'gallery-help');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForFunction(() => {
      const label = document.querySelector('.gallery-drawing text');
      return label instanceof SVGGraphicsElement
        && parseFloat(getComputedStyle(label).fontSize) * (label.getScreenCTM()?.a ?? 1) >= 12.9;
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No overflow at ${width}px`);
    const dimensionSize = await page.getByText('6 000 mm · wall axes', { exact: true }).evaluate(element => {
      if (!(element instanceof SVGGraphicsElement)) throw new Error('Expected a drawing label.');
      const scale = element.getScreenCTM();
      return parseFloat(getComputedStyle(element).fontSize) * (scale?.a ?? 1);
    });
    assert.ok(dimensionSize >= 12.9, `Dimensions stay 13px at ${width}px: ${dimensionSize}`);
    const targets = await page.locator('button').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    assert.ok(targets.every(height => height >= 44), `44px actions at ${width}px: ${targets}`);
    await page.screenshot({ path: path.join(artifacts, `gallery-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ forcedColors: 'active' });
  assert.match(await page.locator('.gallery-task-list [aria-pressed="true"]').innerText(), /T-25[\s\S]*Selected/);
  await page.screenshot({ path: path.join(artifacts, 'gallery-high-contrast.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
});

test('shared CSS ships in actual native Plan and the existing single viewer', { timeout: 90_000 }, async t => {
  const artifacts = process.env.QUAL_ARTIFACTS ?? await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-native-252-'));
  await fs.mkdir(artifacts, { recursive: true });
  const server = await createDemoServer({ codex: null, modelWorker: null, backlogFile: ':memory:' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(async () => { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await server.closeModelWorkers(); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { void dialog.accept(); });
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.locator('#project-template').selectOption('room');
  await page.locator('#project-name').fill('Design-system native fixture');
  await page.locator('#create-project').click();
  await page.locator('#view-plan').click();
  await page.locator('#proposal-drawing svg').waitFor();
  const cssColor = await page.locator('body').evaluate(element => getComputedStyle(element).getPropertyValue('--primary').trim());
  assert.equal(cssColor, spatialTokens.color.primary);
  await page.screenshot({ path: path.join(artifacts, 'native-plan-desktop.png'), fullPage: true });
  await page.locator('#view-3d').click();
  await page.locator('canvas').waitFor();
  assert.equal(await page.locator('canvas').count(), 1);
  await page.screenshot({ path: path.join(artifacts, 'native-viewer-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#view-plan').click();
  await page.screenshot({ path: path.join(artifacts, 'native-plan-narrow.png'), fullPage: true });
  assert.deepEqual(errors, []);
});
