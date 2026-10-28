import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { createDemoServer } from './server.ts';
import { RoomRepository, validateSnapshot, diffSnapshots } from '../src/room-model.ts';
import type { ModelWorker } from '../src/model-proposal.ts';
import { sourceFloorImage, sourceFloorPdf } from '../scripts/fixtures/source-floor.ts';

const floor = { level: { id: 'reference-level', name: 'Reference level' }, wallThicknessMm: 150, heightMm: 2700,
  rooms: [{ id: 'living', name: 'Living room', boundsMm: { minX: 0, minY: 0, maxX: 3000, maxY: 4000 } },
    { id: 'office', name: 'Office', boundsMm: { minX: 3000, minY: 0, maxX: 6000, maxY: 4000 } }],
  openings: [{ id: 'entry', name: 'Entry', type: 'Door', roomId: 'living', side: 'south', offsetMm: 600, widthMm: 900, heightMm: 2100 },
    { id: 'connection', name: 'Internal door', type: 'Door', roomId: 'living', side: 'east', offsetMm: 850, widthMm: 900, heightMm: 2100 }] };
const summary = 'Reconstruct the referenced two-room floor.';
const review = { summary, rationale: 'Confirmed drawing dimension: 6000 mm between wall centrelines.',
  constraints: 'Retain unrelated contents and wait for explicit acceptance.',
  uncertainty: 'The 4000 mm depth, 150 mm walls and 2700 mm height come from drawing labels, not a site survey. Other proportions are inferred; no construction accuracy.',
  intent: { interpretation: 'Reconstruct one storey from the source.', assumptions: ['Rectangular two-room tiling.'], certainty: 90, basis: 'Synthetic drawing and user-confirmed width.' } };

/** Deterministic provider fixture; the real queue, source preparation, ScriptBox and validators run. */
const worker: ModelWorker = { identity: { provider: 'test', model: 'guided-floor-fixture' }, async run(session) {
  const edit = JSON.stringify(session.input).includes('Move shared partition 200 mm east.');
  if (!edit) {
    assert.ok(session.images?.length, 'Drawing pixels reach the provider.');
    assert.ok(JSON.stringify(session.input).includes('User-confirmed floor-plan dimension'));
    assert.ok(JSON.stringify(session.input).includes('wall-centrelines'));
  }
  const source = edit ? `const view=await model.inspect();
    const wall=view.model.entities.find(e=>e.type==='Wall'&&e.start[0]===3&&e.end[0]===3);
    if(!wall)throw new Error('Missing shared partition');
    await model.previewWallShift({wallId:wall.id,offsetMetres:.2});
    return {kind:'propose',review:${JSON.stringify({ ...review, summary: 'Move the partition 200 mm east in the alternative.' })}};`
    : `await model.inspect();await model.previewFloor(${JSON.stringify(floor)});return {kind:'propose',review:${JSON.stringify(review)}};`;
  const result = await session.executeTool('run_model_script', { language: 'typescript', source });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.done, true);
} };

async function savedProject(page: Page, base: string, id: string): Promise<RoomRepository> {
  const result: unknown = await (await page.request.get(`${base}/api/projects/${id}`)).json();
  assert.ok(result && typeof result === 'object' && 'project' in result && typeof result.project === 'string');
  return RoomRepository.restore(result.project);
}
async function send(page: Page): Promise<{ id: string; projectId: string }> {
  const result = page.waitForResponse(response => response.url().endsWith('/api/change-requests') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const response = await result; assert.equal(response.status(), 202, await response.text());
  const body: unknown = await response.json();
  assert.ok(body && typeof body === 'object' && 'ticket' in body && body.ticket && typeof body.ticket === 'object');
  assert.ok('id' in body.ticket && typeof body.ticket.id === 'string' && 'projectId' in body.ticket && typeof body.ticket.projectId === 'string');
  return { id: body.ticket.id, projectId: body.ticket.projectId };
}
async function inspectAndAccept(page: Page, label: string): Promise<void> {
  const inspect = page.getByRole('button', { name: 'Inspect proposal', exact: true }).last();
  const accept = page.getByRole('button', { name: `Accept into ${label}`, exact: true });
  await inspect.or(accept).first().waitFor({ timeout: 30_000 });
  if (await inspect.isVisible()) await inspect.click();
  const decision = page.waitForResponse(response => response.url().endsWith('/decision') && response.request().method() === 'POST');
  await page.getByRole('button', { name: `Accept into ${label}`, exact: true }).click();
  const response = await decision; assert.equal(response.status(), 200, await response.text());
  await page.locator('#request-chat .request-chat-status strong').filter({ hasText: /^Accepted$/ }).waitFor({ state: 'attached', timeout: 20_000 });
  await page.locator('#open-chat').click();
}

test('guided floor reconstruction through shipped desktop/phone UI preserves source, review and target authority', { timeout: 150_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guided-floor-'));
  const artifacts = process.env.QUAL_ARTIFACTS ?? directory; await fs.mkdir(artifacts, { recursive: true });
  let server = await createDemoServer({ modelWorker: worker, backlogFile: path.join(directory, 'queue.sqlite') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); const errors: string[] = [];
  t.after(async () => {
    await page.screenshot({ path: path.join(artifacts, 'last-ui-state.png'), fullPage: true });
    await context.tracing.stop({ path: path.join(artifacts, 'browser-trace.zip') });
    await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await server.closeModelWorkers();
    await fs.rm(directory, { recursive: true, force: true });
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { void dialog.accept(); });
  await page.goto(base); await page.locator('#project-template').selectOption('room');
  await page.locator('#project-name').fill('Guided synthetic floor'); await page.locator('#create-project').click();
  await page.locator('#open-chat').click();
  await page.getByRole('button', { name: 'Reconstruct a floor plan', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), true, 'Unknown scale blocks guided sending.');
  await page.locator('#request-source-files').setInputFiles({ name: 'synthetic-floor.png', mimeType: 'image/png', buffer: await sourceFloorImage() });
  await page.getByText('1 of 4 files ready', { exact: true }).waitFor();
  await page.getByLabel('Known feature', { exact: true }).fill('Overall north width');
  await page.getByLabel('Length · mm', { exact: true }).fill('6000');
  await page.getByLabel('Dimension comes from', { exact: true }).selectOption('documented');
  await page.getByLabel('Dimension measures', { exact: true }).selectOption('wall-centrelines');
  await page.getByRole('button', { name: 'Confirm known dimension', exact: true }).click();
  await page.locator('#floor-plan-guide summary').filter({ hasText: 'Confirmed documented' }).waitFor();
  await page.locator('#request-text').fill('Reconstruct this synthetic floor. Retain all original sources.');
  await page.reload(); await page.locator('#open-chat').click();
  assert.equal(await page.locator('#request-text').inputValue(), 'Reconstruct this synthetic floor. Retain all original sources.');
  assert.match(await page.locator('#floor-plan-guide summary').textContent() ?? '', /6000 mm.*wall-centrelines/);
  await page.screenshot({ path: path.join(artifacts, 'desktop-confirmed.png'), fullPage: true });
  const ticket = await send(page);
  const before = await savedProject(page, base, ticket.projectId);
  const root = before.head('main');
  for (let attempt = 0; attempt < 100; attempt++) {
    const state: unknown = await (await page.request.get(`${base}/api/change-requests/${ticket.id}`)).json();
    assert.ok(state && typeof state === 'object' && 'ticket' in state && state.ticket && typeof state.ticket === 'object' && 'state' in state.ticket);
    if (state.ticket.state === 'ready') break;
    assert.ok(!['failed', 'needs-input'].includes(String(state.ticket.state)), JSON.stringify(state));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await page.getByText(summary, { exact: true }).first().waitFor({ timeout: 30_000 });
  assert.equal((await savedProject(page, base, ticket.projectId)).head('main'), root, 'A proposal is not acceptance.');
  assert.equal(await page.locator('#request-chat-mount').getByText(/6000 mm.*synthetic-floor.png/).count(), 1);
  const sourceLinks = page.locator('#request-chat-mount a').filter({ hasText: 'floor-plan-measurement.txt' });
  assert.ok(await sourceLinks.count());
  const noteUrl = await sourceLinks.first().getAttribute('href'); assert.ok(noteUrl);
  const noteText = await (await page.request.get(base + noteUrl)).text();
  assert.ok(noteText.includes('Overall north width') && noteText.includes('wall-centrelines') && noteText.includes('sha256'));
  await inspectAndAccept(page, 'Main');
  const asIs = await savedProject(page, base, ticket.projectId); validateSnapshot(asIs.view(asIs.head('main')).snapshot);
  assert.equal(asIs.view(asIs.head('main')).snapshot.entities.filter(item => item.type === 'Space').length, 2);
  assert.notEqual(asIs.head('main'), root);
  await page.getByRole('button', { name: '+ Alternative', exact: true }).click();
  await page.getByLabel('Active design', { exact: true }).selectOption({ label: 'Alternative 1' });
  await page.locator('#request-text').fill('Move shared partition 200 mm east.');
  await send(page); await inspectAndAccept(page, 'Alternative 1');
  const accepted = await savedProject(page, base, ticket.projectId);
  const baseline = accepted.designTargets().find(view => view.target.kind === 'baseline');
  const alternative = accepted.designTargets().find(view => view.target.kind === 'alternative'); assert.ok(baseline && alternative);
  assert.equal(baseline.revisionId, asIs.head('main')); assert.equal(accepted.head('main'), asIs.head('main'));
  assert.deepEqual(baseline.revisionId, asIs.head('main')); assert.notEqual(alternative.revisionId, baseline.revisionId);
  const delta = diffSnapshots(accepted.designView(baseline.target).snapshot, accepted.designView(alternative.target).snapshot);
  assert.equal(delta.entities.modified.filter(item => item.after.type === 'Space').length, 2);
  await fs.writeFile(path.join(artifacts, 'model-delta.json'), JSON.stringify({ root, main: accepted.head('main'), baseline,
    alternative, reconstruction: diffSnapshots(before.view(root).snapshot, asIs.view(asIs.head('main')).snapshot), alternativeDelta: delta }, null, 2));
  await page.screenshot({ path: path.join(artifacts, 'desktop-alternative.png'), fullPage: true });
  await page.goto('about:blank');
  await new Promise<void>(resolve => server.close(() => resolve())); await server.closeModelWorkers();
  server = await createDemoServer({ modelWorker: worker, backlogFile: path.join(directory, 'queue.sqlite') });
  await new Promise<void>(resolve => server.listen(address.port, '127.0.0.1', resolve));
  const recovered = await savedProject(page, base, ticket.projectId);
  assert.equal(recovered.head('main'), asIs.head('main')); assert.equal(recovered.designView(alternative.target).revisionId, alternative.revisionId);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(base); await page.locator('#open-chat').click();
  await page.getByLabel('Active design', { exact: true }).selectOption({ label: 'Main' });
  await page.getByRole('button', { name: 'Reconstruct a floor plan', exact: true }).click();
  await page.locator('#request-source-files').setInputFiles({ name: 'synthetic-floor.pdf', mimeType: 'application/pdf', buffer: sourceFloorPdf() });
  await page.getByText('1 of 4 files ready', { exact: true }).waitFor();
  await page.getByLabel('Known feature', { exact: true }).fill('North wall width'); await page.getByLabel('Length · mm', { exact: true }).fill('6000');
  await page.getByLabel('Dimension comes from', { exact: true }).selectOption('documented'); await page.getByLabel('Dimension measures', { exact: true }).selectOption('wall-centrelines');
  await page.getByRole('button', { name: 'Confirm known dimension', exact: true }).click();
  await page.locator('#floor-plan-guide summary').filter({ hasText: 'Confirmed documented' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator('.model-canvas').count(), 1);
  const stage = await page.locator('.workspace-stage').boundingBox(); assert.ok(stage && stage.height > 100);
  await page.screenshot({ path: path.join(artifacts, 'phone-pdf-confirmed.png'), fullPage: true });
  await page.getByRole('button', { name: 'Remove synthetic-floor.pdf from this request', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), true, 'Removing the confirmed source revokes readiness.');
  assert.deepEqual(errors, []);
  t.diagnostic('Deterministic worker only; no live model-provider accuracy claim. PNG/PDF preparation, source-bound confirmation, unsent reload, explicit acceptance, As-is baseline, alternative-only partition delta and SQLite restart verified.');
});
