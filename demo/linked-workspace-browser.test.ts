import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createDemoServer } from './server.ts';
import { RoomRepository } from '../src/room-model.ts';

test('shipped workspace links IFC into one viewer and adds only unsent source context', { timeout: 120_000 }, async t => {
  const spool = process.env.IFC_EXTERNAL_SPOOL; const fixture = process.env.IFC_FIXTURE;
  assert.ok(spool && fixture, 'Run with an isolated external converter spool and generated IFC fixture.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linked-workspace-'));
  const artifacts = process.env.QUAL_ARTIFACTS ?? directory;
  const server = await createDemoServer({ backlogFile: path.join(directory, 'queue.sqlite'),
    linkedModelRoot: path.join(directory, 'ifc-links'), linkedModelSpool: spool });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = 'http://127.0.0.1:' + address.port;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(20_000);
  t.after(async () => {
    await page.screenshot({ path: path.join(artifacts, 'linked-workspace-last.png'), fullPage: true });
    await context.close(); await browser.close(); await server.closeModelWorkers();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await page.goto(base); await page.locator('#project-template').selectOption('room');
  await page.locator('#project-name').fill('Disposable linked-reference workspace');
  const creation = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
  await page.locator('#create-project').click();
  const created: unknown = await (await creation).json();
  assert.ok(created && typeof created === 'object' && 'project' in created && typeof created.project === 'string');
  const native = RoomRepository.restore(created.project); const projectId = native.projectId;
  const acceptedBefore = native.serialize();
  await page.locator('#linked-model-references > summary').click();
  await page.getByLabel('Attach IFC reference', { exact: true }).setInputFiles({ name: 'Linked context fixture.ifc', mimeType: 'application/x-step', buffer: await fs.readFile(fixture) });
  const tree = page.getByRole('list', { name: 'Linked context fixture.ifc spatial hierarchy', exact: true });
  await tree.waitFor({ timeout: 60_000 });
  await tree.getByRole('button', { name: /IfcWall/ }).first().click();
  await page.locator('.babylon-viewer[data-linked-models="1"] canvas').waitFor();
  assert.equal(await page.locator('canvas:visible').count(), 1);
  await page.getByLabel('Original IFC properties and conversion losses', { exact: true }).waitFor();
  const nativeSelection = await page.locator('.model-object-picker').inputValue();
  await page.locator('.model-object-picker').selectOption(nativeSelection);
  assert.equal(await page.getByLabel('Original IFC properties and conversion losses', { exact: true }).count(), 0);
  const canvas = page.locator('.babylon-viewer canvas'); const box = await canvas.boundingBox(); assert.ok(box);
  let picked = false;
  for (const y of [.25, .4, .55, .7]) {
    for (const x of [.25, .4, .55, .7]) {
      await canvas.click({ position: { x: box.width * x, y: box.height * y } });
      if ((await page.locator('.model-selection-caption').textContent())?.startsWith('Read-only IFC reference')) { picked = true; break; }
    }
    if (picked) break;
  }
  assert.ok(picked, 'Actual pointer clicks select linked geometry in the shipped viewer.');
  assert.equal(await page.locator('.model-object-picker').inputValue(), nativeSelection, 'Linked selection retains native scope context.');
  await page.getByRole('button', { name: 'Reference in request', exact: true }).click();
  const prompt = await page.locator('#request-text').inputValue();
  assert.match(prompt, /Read-only IFC context \(no native edit authority\)/);
  assert.match(prompt, /originalSha256/);
  const tickets: unknown = await (await page.request.get(base + '/api/projects/' + projectId + '/change-requests')).json();
  assert.ok(tickets && typeof tickets === 'object' && 'tickets' in tickets && Array.isArray(tickets.tickets));
  assert.equal(tickets.tickets.length, 0, 'Referencing does not submit a request.');
  await page.getByLabel('Show linked geometry').uncheck();
  assert.equal(await page.locator('.babylon-viewer').getAttribute('data-linked-models'), '0');
  await page.getByLabel('Show linked geometry').check();
  await page.screenshot({ path: path.join(artifacts, 'linked-workspace-desktop.png'), fullPage: true });
  const after: unknown = await (await page.request.get(base + '/api/projects/' + projectId)).json();
  assert.ok(after && typeof after === 'object' && 'project' in after && typeof after.project === 'string');
  assert.equal(RoomRepository.restore(after.project).serialize(), acceptedBefore, 'IFC leaves native accepted state unchanged.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, 'linked-workspace-phone.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
});
