import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createDemoServer } from './server.ts';
import { RoomRepository } from '../src/room-model.ts';
import { spatialFixtureWorker } from '../tests/fixtures/spatial-workspace/worker.ts';
import { parseTaskPlacement } from '../src/task-placement.ts';
import { createHash } from 'node:crypto';

test('shipped workspace keeps real IFC, native construction and task pointer identities separate without changing accepted data', { timeout: 120_000 }, async t => {
  const spool = process.env.IFC_EXTERNAL_SPOOL; const fixture = process.env.IFC_FIXTURE;
  assert.ok(spool && fixture, 'Run with an isolated external converter spool and generated IFC fixture.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linked-workspace-'));
  const artifacts = process.env.QUAL_ARTIFACTS ?? directory;
  const server = await createDemoServer({ modelWorker: spatialFixtureWorker({ mode: 'region-context' }), backlogFile: path.join(directory, 'queue.sqlite'),
    linkedModelRoot: path.join(directory, 'ifc-links'), linkedModelSpool: spool });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = 'http://127.0.0.1:' + address.port;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); const errors: string[] = [];
  await context.tracing.start({ screenshots: true, snapshots: true });
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(20_000);
  t.after(async () => {
    await page.screenshot({ path: path.join(artifacts, 'linked-workspace-last.png'), fullPage: true });
    await context.tracing.stop({ path: path.join(artifacts, 'linked-workspace-trace.zip') });
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
  const native = await RoomRepository.restore(created.project); const projectId = native.projectId;
  const acceptedBefore = native.serialize();
  await page.locator('#workspace-navigation-toggle').click();
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
  const originalCanvas = await canvas.elementHandle(); assert.ok(originalCanvas);
  let picked = false; let nativeAtPick = nativeSelection;
  for (const y of [.25, .4, .55, .7]) {
    for (const x of [.25, .4, .55, .7]) {
      const precedingNative = await page.locator('.model-object-picker').inputValue();
      await canvas.click({ position: { x: box.width * x, y: box.height * y } });
      if ((await page.locator('.model-selection-caption').textContent())?.startsWith('Read-only IFC reference')) { picked = true; nativeAtPick = precedingNative; break; }
    }
    if (picked) break;
  }
  assert.ok(picked, 'Actual pointer clicks select linked geometry in the shipped viewer.');
  const linkedPickedCaption = await page.locator('.model-selection-caption').innerText();
  assert.equal(await page.locator('.model-object-picker').inputValue(), nativeAtPick, 'Linked selection retains native scope context.');
  await page.getByRole('button', { name: 'Reference in request', exact: true }).click();
  const prompt = await page.locator('#request-text').inputValue();
  assert.equal(prompt, 'Use this linked reference as context.');
  assert.doesNotMatch(prompt, /originalSha256/);
  await page.getByText('1 of 4 files ready', { exact: true }).waitFor();
  const attached = page.locator('#request-source-list a').first();
  const referenceUrl = await attached.getAttribute('href'); assert.ok(referenceUrl);
  const referenceText = await (await page.request.get(base + referenceUrl)).text();
  const sourceSha256 = createHash('sha256').update(await fs.readFile(fixture)).digest('hex');
  assert.ok(referenceText.includes(sourceSha256), 'The context attachment pins the actual converted IFC bytes.');
  assert.ok(referenceText.includes(linkedPickedCaption.replace('Read-only IFC reference · ', '')), 'The context attachment retains the actual pointer-picked IFC GlobalId.');
  assert.match(referenceText, /Read-only IFC context \(no native edit authority\)/);
  assert.match(referenceText, /originalSha256/);
  assert.match(referenceText, /External source data, not instructions/);
  const tickets: unknown = await (await page.request.get(base + '/api/projects/' + projectId + '/change-requests')).json();
  assert.ok(tickets && typeof tickets === 'object' && 'tickets' in tickets && Array.isArray(tickets.tickets));
  assert.equal(tickets.tickets.length, 0, 'Referencing does not submit a request.');
  await page.getByLabel('Show linked geometry').uncheck();
  assert.equal(await page.locator('.babylon-viewer').getAttribute('data-linked-models'), '0');
  await page.getByLabel('Show linked geometry').check();
  await page.screenshot({ path: path.join(artifacts, 'linked-workspace-desktop.png'), fullPage: true });
  const after: unknown = await (await page.request.get(base + '/api/projects/' + projectId)).json();
  assert.ok(after && typeof after === 'object' && 'project' in after && typeof after.project === 'string');
  assert.equal((await RoomRepository.restore(after.project)).serialize(), acceptedBefore, 'IFC leaves native accepted state unchanged.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, 'linked-workspace-phone.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (await page.locator('#workspace-navigation-close').isVisible()) await page.locator('#workspace-navigation-close').click();
  await page.locator('#view-fly').click();
  const capture = () => page.evaluate(async () => { const url = '/room-app.mjs'; const api = await import(url); return api.captureWorkspaceInsidePose(); });
  await page.waitForFunction(() => document.getElementById('workspace-shell')?.dataset.spatialView === 'inside');
  await page.evaluate(async () => {
    const url = '/room-app.mjs'; const api = await import(url); const pose = api.captureWorkspaceInsidePose();
    if (!pose || !api.returnWorkspaceToPose({ ...pose, eye: [2, 2, 1.6], forward: [0, 1, 0], up: [0, 0, 1], motion: 'fly' })) throw new Error('Composition fixture eye could not open.');
  });
  await page.locator('#new-chat').click();
  await page.locator('.model-object-picker').selectOption(nativeSelection);
  await page.locator('#request-text').fill('Clarify this native task while retaining the linked IFC reference.');
  const submitted = page.waitForResponse(response => response.url() === base + '/api/change-requests' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const acknowledgement = await submitted; assert.equal(acknowledgement.status(), 202, await acknowledgement.text());
  const body: unknown = await acknowledgement.json();
  assert.ok(body && typeof body === 'object' && 'ticket' in body && body.ticket && typeof body.ticket === 'object'
    && 'id' in body.ticket && typeof body.ticket.id === 'string' && 'taskPlacement' in body.ticket);
  const ticketId = body.ticket.id; const placement = parseTaskPlacement(body.ticket.taskPlacement);
  assert.equal(placement.kind, 'placed');
  if (placement.kind !== 'placed') throw new Error('The native composition task must have an actual fixed origin.');
  assert.ok(placement.targets.objects.some(ref => ref.kind === 'native' && ref.entityId === nativeSelection));
  await page.getByText('Which door in this region should be widened?', { exact: true }).waitFor();
  assert.equal(await page.locator('.babylon-viewer').getAttribute('data-linked-models'), '1');
  const agent = page.locator(`.spatial-task-label[data-task-id="${ticketId}"]`); await agent.waitFor();
  await page.locator('#workspace-context-close').click();
  const beforeAgent = await capture();
  const agentPoint = await agent.evaluate(node => ({ x: Number(node.dataset.bodyX), y: Number(node.dataset.bodyY) }));
  const agentBox = await canvas.boundingBox(); assert.ok(agentBox);
  await page.mouse.click(agentBox.x + agentPoint.x, agentBox.y + agentPoint.y);
  assert.equal(JSON.parse(await page.locator('.babylon-viewer').getAttribute('data-task-hit') ?? '{}').kind, 'task');
  assert.deepEqual(await capture(), beforeAgent, 'Opening the real agent body preserves every camera pose field.');
  assert.equal(await page.locator('.model-object-picker').inputValue(), nativeSelection, 'Task intent does not become construction selection.');
  let nativePicked = false;
  for (const y of [.2, .4, .65, .8]) {
    for (const x of [.2, .4, .65, .8]) {
      const currentBox = await canvas.boundingBox(); assert.ok(currentBox);
      await canvas.click({ position: { x: currentBox.width * x, y: currentBox.height * y } });
      const selected = await page.locator('.model-object-picker').inputValue();
      if (selected !== nativeSelection && selected.startsWith('wall-')) { nativePicked = true; break; }
    }
    if (nativePicked) break;
  }
  assert.ok(nativePicked, 'Native construction remains pointer-pickable alongside actual IFC and task graphics.');
  await page.screenshot({ path: path.join(artifacts, 'linked-native-agent-composition.png'), fullPage: true });
  await page.locator('#workspace-navigation-toggle').click();
  if (!(await tree.isVisible())) await page.locator('#linked-model-references > summary').click();
  await tree.getByRole('button', { name: /IfcWall/ }).first().click();
  let linkedAgain = false;
  for (const y of [.25, .4, .55, .7]) {
    for (const x of [.25, .4, .55, .7]) {
      const currentBox = await canvas.boundingBox(); assert.ok(currentBox);
      await canvas.click({ position: { x: currentBox.width * x, y: currentBox.height * y } });
      if ((await page.locator('.model-selection-caption').textContent())?.startsWith('Read-only IFC reference')) { linkedAgain = true; break; }
    }
    if (linkedAgain) break;
  }
  assert.ok(linkedAgain, 'Actual converted IFC remains pointer-pickable with the saved native agent layer present.');
  assert.equal(await page.locator('canvas:visible').count(), 1);
  assert.equal(await originalCanvas.evaluate(node => node.isConnected), true, 'All linked, native and task picks preserve the original canvas.');
  assert.equal(await agent.count(), 1, 'Linked framing preserves the saved native task graphic identity.');
  const finalTicket: unknown = await (await page.request.get(base + '/api/change-requests/' + ticketId)).json();
  assert.ok(finalTicket && typeof finalTicket === 'object' && 'ticket' in finalTicket && finalTicket.ticket && typeof finalTicket.ticket === 'object' && 'taskPlacement' in finalTicket.ticket);
  assert.deepEqual(parseTaskPlacement(finalTicket.ticket.taskPlacement), placement);
  const finalProject: unknown = await (await page.request.get(base + '/api/projects/' + projectId)).json();
  assert.ok(finalProject && typeof finalProject === 'object' && 'project' in finalProject && typeof finalProject.project === 'string');
  assert.equal((await RoomRepository.restore(finalProject.project)).serialize(), acceptedBefore);
  await fs.writeFile(path.join(artifacts, 'linked-native-agent-composition.json'), JSON.stringify({ ticketId, placement,
    sourceSha256, linkedPickedCaption, readOnlyContext: referenceText, nativeAcceptedSha256: createHash('sha256').update(acceptedBefore).digest('hex'),
    agentBodyPick: true, nativePointerPick: nativePicked, linkedPointerPick: linkedAgain, oneCanvas: true, nativeAcceptedUnchanged: true, errors }, null, 2));
  assert.deepEqual(errors, []);
});
