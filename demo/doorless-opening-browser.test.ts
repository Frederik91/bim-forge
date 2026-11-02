import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createDemoServer } from './server.ts';
import { RoomRepository, diffSnapshots } from '../src/room-model.ts';
import { previewDoorToOpening } from '../src/hosted-opening.ts';
import type { ModelWorker } from '../src/model-proposal.ts';

test('shipped UI reviews and explicitly accepts a 2 m doorless opening, then restores it through a server restart', { timeout: 120_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'doorless-opening-294-'));
  const artifacts = process.env.OPENING_294_ARTIFACTS ?? 'artifacts/doorless-opening-294'; await fs.mkdir(artifacts, { recursive: true });
  const worker: ModelWorker = { identity: { provider: 'test', model: 'doorless-opening-fixture' }, async run(session) {
    const outcome = await session.executeTool('run_model_script', { language: 'typescript', source: `
      await model.inspect();
      await model.previewDoorToOpening({doorId:'door-entry',widthMetres:2,anchor:'centre'});
      return {kind:'propose',review:{summary:'Remove the entry door leaf and retain a fixed 2 m opening.',
        rationale:'Convert the existing native Door into a permanent Opening with its stable ID and host.',
        constraints:'Retain height and physical centre; only the entity and hosted offset change.',
        uncertainty:'Concept access clearance is not construction or code certification.',
        intent:{interpretation:'Replace this door with a fixed 2 m wide opening.',assumptions:['Retain height and physical centre.'],certainty:100,basis:'Explicit user instruction.'}}};` });
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
  } };
  const backlogFile = path.join(directory, 'queue.sqlite');
  let server = await createDemoServer({ modelWorker: worker, backlogFile });
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
  const faceDoor = () => page.evaluate(async () => {
    const url = '/room-app.mjs'; const api = await import(url); const pose = api.captureWorkspaceInsidePose();
    if (!pose || !api.returnWorkspaceToPose({ ...pose, eye: [2.45, 1.8, 1.3], forward: [0,-1,0], up: [0,0,1], motion: 'fly' })) throw new Error('Cannot face the entry opening');
  });
  await page.goto(base); await page.locator('#project-template').selectOption('house');
  await page.locator('#project-name').fill('Doorless opening review'); await page.locator('#create-project').click();
  await page.locator('#open-chat').click(); await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await page.locator('.babylon-viewer[data-scene-ready="true"]').waitFor();
  await faceDoor(); await page.locator('#new-chat').click(); await page.locator('.model-object-picker').selectOption('door-entry');
  await page.screenshot({ path: path.join(artifacts, 'before-door.png'), fullPage: true });
  await page.locator('#request-text').fill('Remove this door, have it a fixed, 2m wide opening');
  const submitted = page.waitForResponse(response => response.url() === `${base}/api/change-requests` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const acknowledgement = await submitted; assert.equal(acknowledgement.status(), 202, await acknowledgement.text());
  const body: unknown = await acknowledgement.json();
  assert.ok(body && typeof body === 'object' && 'ticket' in body && body.ticket && typeof body.ticket === 'object'
    && 'id' in body.ticket && typeof body.ticket.id === 'string' && 'projectId' in body.ticket && typeof body.ticket.projectId === 'string');
  const ticketId = body.ticket.id; const projectId = body.ticket.projectId;
  const project = async () => {
    const value: unknown = await (await page.request.get(`${base}/api/projects/${projectId}`)).json();
    assert.ok(value && typeof value === 'object' && 'project' in value && typeof value.project === 'string');
    return RoomRepository.restore(value.project);
  };
  const acceptedBefore = await project(); const baseline = acceptedBefore.head('main'); const before = acceptedBefore.view(baseline).snapshot;
  const expected = previewDoorToOpening(before, { doorId: 'door-entry', widthMetres: 2, anchor: 'centre' });
  await page.waitForFunction(async id => { const value = await (await fetch(`/api/change-requests/${id}`)).json();
    if (value.ticket.state === 'failed') throw new Error(value.ticket.error); return value.ticket.state === 'ready'; }, ticketId, { timeout: 30_000 });
  const inspect = page.getByRole('button', { name: 'Inspect proposal', exact: true }).last();
  const tray = page.getByRole('region', { name: 'Canvas proposal review' });
  await inspect.or(tray).first().waitFor({ timeout: 30_000 });
  if (await inspect.isVisible()) await inspect.click(); await tray.waitFor();
  assert.equal((await project()).head('main'), baseline, 'AI proposal does not accept a model change');
  await page.locator('#view-plan').click();
  assert.match(await page.locator('#proposal-drawing').textContent() ?? '', /2000/);
  await page.screenshot({ path: path.join(artifacts, 'review-plan-2000mm.png'), fullPage: true });
  await page.locator('#workspace-context-close').click();
  const accept = tray.getByRole('button', { name: /^Accept into/ }); await accept.waitFor({ state: 'visible' });
  assert.equal(await accept.evaluate(node => {
    const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === node || node.contains(hit);
  }), true, 'The explicit review action must be exposed before clicking');
  const decision = page.waitForResponse(response => response.url().endsWith('/decision') && response.request().method() === 'POST');
  await accept.click(); assert.equal((await decision).status(), 200);
  const acceptedAfter = await project(); const after = acceptedAfter.view(acceptedAfter.head('main')).snapshot;
  assert.deepEqual(after, expected.snapshot); assert.notEqual(acceptedAfter.head('main'), baseline);
  assert.deepEqual(diffSnapshots(before, after), expected.delta);
  await page.locator('#view-inside').click(); await page.getByRole('button', { name: 'Basic', exact: true }).click(); await faceDoor();
  await page.screenshot({ path: path.join(artifacts, 'accepted-opening-no-leaf.png'), fullPage: true });
  await new Promise<void>(resolve => server.close(() => resolve())); await server.closeModelWorkers();
  server = await createDemoServer({ modelWorker: worker, backlogFile });
  await new Promise<void>(resolve => server.listen(address.port, '127.0.0.1', resolve));
  await page.reload(); await page.locator('#view-inside').click(); await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await page.locator('.model-object-picker').selectOption('door-entry');
  await page.locator('#selection-context-label').filter({ hasText: 'Opening' }).waitFor();
  assert.equal(await page.locator('#selected-title').textContent(), 'Ground floor', 'Object conversion retains its floor context');
  assert.deepEqual((await project()).view(acceptedAfter.head('main')).snapshot, expected.snapshot);
  assert.equal(await page.locator('canvas').count(), 1); assert.deepEqual(errors, []);
  await fs.writeFile(path.join(artifacts, 'delta.json'), JSON.stringify({ beforeRevision: baseline, afterRevision: acceptedAfter.head('main'), impact: expected.impact, delta: expected.delta, errors }, null, 2));
});
