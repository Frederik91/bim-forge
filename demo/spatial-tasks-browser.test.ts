import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createDemoServer } from './server.ts';
import { conversationWorker } from './fixtures/conversation-agent.ts';
import { RoomRepository } from '../src/room-model.ts';

test('shipped task controller keeps independent attachments and drafts, appends to one ticket and rejects a late poll', { timeout: 90_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-tasks-253-'));
  const server = await createDemoServer({ modelWorker: conversationWorker, backlogFile: path.join(directory, 'queue.sqlite') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const artifacts = process.env.QUAL_ARTIFACTS;
  if (artifacts) { await fs.mkdir(artifacts, { recursive: true }); await page.context().tracing.start({ screenshots: true, snapshots: true }); }
  async function waitForDraft(text: string): Promise<void> {
    await page.waitForFunction(expected => { const field = document.getElementById('request-text'); return field instanceof HTMLTextAreaElement && field.value === expected; }, text);
  }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { void dialog.accept(); });
  t.after(async () => {
    t.diagnostic(JSON.stringify({ errors, status: await page.locator('#status').textContent(), error: await page.locator('#error').textContent(), text: await page.locator('#request-text').inputValue() }));
    if (artifacts) {
      await page.screenshot({ path: path.join(artifacts, 'task-controller-fixed.png'), fullPage: true });
      await page.context().tracing.stop({ path: path.join(artifacts, 'task-controller-fixed-trace.zip') });
    }
    await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await server.closeModelWorkers();
    await fs.rm(directory, { recursive: true, force: true });
  });
  await page.goto(base); await page.locator('#project-template').selectOption('room');
  await page.locator('#project-name').fill('Task controller fixture'); await page.locator('#create-project').click();
  await page.locator('#open-chat').click();
  await page.locator('#request-source-files').setInputFiles({ name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('First task source') });
  await page.getByText('1 of 4 files ready', { exact: true }).waitFor();
  await page.locator('#request-text').fill('First independent door task');
  await page.locator('#new-chat').click();
  await waitForDraft('');
  assert.equal(await page.locator('#request-text').inputValue(), '');
  assert.equal(await page.locator('#request-source-list a').count(), 0);
  await page.locator('#request-text').fill('Second independent door task');
  await page.locator('#request-source-files').setInputFiles({ name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('Second task source') });
  await page.getByText('1 of 4 files ready', { exact: true }).waitFor();
  await page.locator('#chat-switcher-button').click();
  await page.locator('#chat-list button').filter({ hasText: 'First independent door task' }).click();
  await waitForDraft('First independent door task');
  assert.equal(await page.locator('#request-text').inputValue(), 'First independent door task');
  assert.match(await page.locator('#request-source-list').textContent() ?? '', /first.txt/);
  assert.doesNotMatch(await page.locator('#request-source-list').textContent() ?? '', /second.txt/);
  const submittedBodies: (string | null)[] = [];
  page.on('request', request => {
    if (request.url() === `${base}/api/change-requests` && request.method() === 'POST') submittedBodies.push(request.postData());
  });
  await page.route(`${base}/api/change-requests`, async route => {
    await route.fetch(); await route.abort('failed');
  }, { times: 1 });
  const lostAcknowledgement = page.waitForEvent('requestfailed', request => request.url() === `${base}/api/change-requests`);
  await page.getByRole('button', { name: 'Send message', exact: true }).click(); await lostAcknowledgement;
  await page.locator('#error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#request-text').inputValue(), 'First independent door task');
  assert.match(await page.locator('#request-source-list').textContent() ?? '', /first.txt/);
  const firstAck = page.waitForResponse(response => response.url().endsWith('/api/change-requests') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const response = await firstAck; assert.equal(response.status(), 202, await response.text());
  const value: unknown = await response.json();
  assert.ok(value && typeof value === 'object' && 'ticket' in value && value.ticket && typeof value.ticket === 'object'
    && 'id' in value.ticket && typeof value.ticket.id === 'string' && 'projectId' in value.ticket && typeof value.ticket.projectId === 'string');
  const firstId = value.ticket.id; const projectId = value.ticket.projectId;
  await waitForDraft('');
  assert.equal(submittedBodies.length, 2); assert.equal(submittedBodies[0], submittedBodies[1]);
  assert.equal(await page.locator('#error').isVisible(), false);
  const backlog: unknown = await (await page.request.get(`${base}/api/projects/${projectId}/change-requests`)).json();
  assert.ok(backlog && typeof backlog === 'object' && 'tickets' in backlog && Array.isArray(backlog.tickets));
  assert.equal(backlog.tickets.length, 1, 'An uncertain acknowledgement and exact retry create one durable task.');
  const initial: unknown = await (await page.request.get(`${base}/api/projects/${projectId}`)).json();
  assert.ok(initial && typeof initial === 'object' && 'project' in initial && typeof initial.project === 'string');
  const initialRepository = await RoomRepository.restore(initial.project); const acceptedHead = initialRepository.head('main');
  await page.locator('#request-chat-mount').getByText('What width should the selected desk have?', { exact: true }).waitFor();
  await page.locator('#chat-switcher-button').click();
  await page.locator('#chat-list button').filter({ hasText: 'Second independent door task' }).click();
  await waitForDraft('Second independent door task');
  assert.equal(await page.locator('#request-text').inputValue(), 'Second independent door task');
  assert.match(await page.locator('#request-source-list').textContent() ?? '', /second.txt/);
  await page.locator('#chat-switcher-button').click();
  await page.locator('#chat-list button').filter({ hasText: 'First independent door task' }).click();
  await waitForDraft('');
  assert.equal(await page.locator('#request-text').inputValue(), '');
  let releaseSameTask = () => {};
  const sameTaskGate = new Promise<void>(resolve => { releaseSameTask = resolve; }); t.after(() => releaseSameTask());
  let heldSameTask = () => {}; const sameTaskHeld = new Promise<void>(resolve => { heldSameTask = resolve; });
  let deliveredSameTask = () => {}; const sameTaskDelivered = new Promise<void>(resolve => { deliveredSameTask = resolve; });
  await page.route(`${base}/api/change-requests/${firstId}`, async route => {
    const saved = await route.fetch(); heldSameTask(); await sameTaskGate;
    await route.fulfill({ response: saved }); deliveredSameTask();
  }, { times: 1 });
  await sameTaskHeld;
  await page.locator('#request-text').fill('Retain first source and clarify this task');
  const appended = page.waitForResponse(reply => reply.url().endsWith(`/api/change-requests/${firstId}/messages`));
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const reply = await appended; assert.equal(reply.status(), 202, await reply.text());
  await page.locator('#request-chat-mount').getByText('Retain first source and clarify this task', { exact: true }).waitFor();
  releaseSameTask(); await sameTaskDelivered;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.equal(await page.locator('#request-chat-mount').getByText('Retain first source and clarify this task', { exact: true }).count(), 1);
  assert.equal(await page.locator('.request-chat-status[data-status="offline"]').count(), 0);
  assert.equal(await page.locator('#error').isVisible(), false);

  let hold = true; let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  let ready = () => {}; const held = new Promise<void>(resolve => { ready = resolve; });
  let delivered = () => {}; const delivery = new Promise<void>(resolve => { delivered = resolve; });
  await page.route(`${base}/api/change-requests/${firstId}`, async route => {
    if (!hold) { await route.continue(); return; } hold = false;
    const saved = await route.fetch(); ready(); await gate; await route.fulfill({ response: saved }); delivered();
  });
  await held; await page.locator('#new-chat').click(); await waitForDraft(''); await page.locator('#request-text').fill('Keep this unsent draft after the delayed reply');
  release(); await delivery;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.equal(await page.locator('#request-text').inputValue(), 'Keep this unsent draft after the delayed reply');
  assert.equal(await page.locator('#request-chat-mount').getByText('Retain first source and clarify this task', { exact: true }).count(), 0);
  const final: unknown = await (await page.request.get(`${base}/api/projects/${projectId}`)).json();
  assert.ok(final && typeof final === 'object' && 'project' in final && typeof final.project === 'string');
  assert.equal((await RoomRepository.restore(final.project)).head('main'), acceptedHead);
  await page.locator('#request-source-files').setInputFiles({ name: 'late-draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep this project-bound attachment') });
  await page.getByText('1 of 4 files ready', { exact: true }).waitFor();
  await page.locator('.workspace-file-menu summary').click(); await page.locator('#new-project').click();
  await page.locator('#project-template').selectOption('room'); await page.locator('#project-name').fill('Other project fixture');
  await page.locator('#create-project').click();
  await page.locator('#project-title').filter({ hasText: /^Other project fixture$/ }).waitFor();
  await waitForDraft(''); await page.locator('#request-text').fill('Keep the other project separate');
  await page.locator('.workspace-file-menu summary').click(); await page.locator('#new-project').click();
  await page.locator('#saved-projects').selectOption(projectId);
  await page.locator('#open-saved-project').click();
  await page.locator('#project-title').filter({ hasText: /^Task controller fixture$/ }).waitFor();
  await page.locator('#open-chat').click(); await page.locator('#chat-switcher-button').click();
  await page.locator('#chat-list button').filter({ hasText: 'Keep this unsent draft after the delayed reply' }).click();
  await waitForDraft('Keep this unsent draft after the delayed reply');
  assert.match(await page.locator('#request-source-list').textContent() ?? '', /late-draft.txt/);
  assert.equal(await page.locator('#error').isVisible(), false);
  assert.deepEqual(errors, []);
});
