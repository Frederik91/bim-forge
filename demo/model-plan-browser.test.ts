import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

test('real browser native Plan at 320/390/desktop, source selection and level changes', async t => {
  const result = await build({ entryPoints: ['demo/model-plan-gallery.ts'], bundle: true, platform: 'browser', format: 'iife', write: false });
  const bundle = result.outputFiles[0]; assert.ok(bundle);
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir('artifacts/plan-core-262', { recursive: true });
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.setContent('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Native Plan qualification</title></head><body></body></html>');
    await page.addScriptTag({ content: bundle.text });
    const svg = page.locator('svg'); await svg.waitFor();
    assert.equal(await svg.getAttribute('data-level-id'), 'level-ground');
    assert.equal(await svg.getAttribute('data-revision-id'), 'b'.repeat(64));
    assert.ok(await page.getByText('900 → 1100 mm', { exact: true }).count());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'no horizontal overflow');
    const texts = await svg.locator('text').evaluateAll(nodes => nodes.map(node => {
      const b = node.getBoundingClientRect(); return { text: node.textContent, x: b.x, right: b.right, size: getComputedStyle(node).fontSize };
    }));
    assert.ok(texts.every(node => Number.parseFloat(node.size) >= 13));
    assert.ok(texts.every(node => node.x >= 0 && node.right <= width), JSON.stringify(texts.filter(node => node.x < 0 || node.right > width)));
    const currentDoor = svg.locator('[data-entity-id="door-entry"][data-revision-role="current"]');
    await currentDoor.click({ force: true });
    await page.getByRole('status').filter({ hasText: 'door-entry · current · bbbbbbbb' }).waitFor();
    await page.screenshot({ path: `artifacts/plan-core-262/ground-${width}.png`, fullPage: true });
    await page.getByRole('combobox', { name: 'Plan level' }).selectOption('level-attic');
    assert.equal(await page.locator('[data-entity-id="door-entry"]').count(), 0);
    assert.ok(await page.locator('[data-representation="roof-projection"]').count());
    if (width === 320) await page.screenshot({ path: `artifacts/plan-core-262/attic-${width}.png`, fullPage: true });
    await page.getByRole('checkbox').uncheck();
    assert.equal(await page.locator('[data-revision-role="existing"]').count(), 0);
  }
  assert.deepEqual(errors, []);
  await writeFile('artifacts/plan-core-262/browser-result.json', JSON.stringify({ widths: [1024, 390, 320], errors, nativeGeometry: true, sourceSelection: true, levelFiltering: true }, null, 2));
});
