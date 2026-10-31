import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { CodexAccountConnection } from '../src/codex-app-server.ts';
import { createDemoServer } from '../demo/server.ts';
import { RoomRepository, diffSnapshots } from '../src/room-model.ts';
import { parseTaskPlacement } from '../src/task-placement.ts';
import { spatialExpectedDoorSnapshot, spatialFixtureManifest, spatialDoorFacts } from '../tests/fixtures/spatial-workspace/fixture.ts';

if (process.argv.slice(2).join(' ') !== '--run-one-provider-request') {
  throw new Error('Explicit live qualification only: pass --run-one-provider-request. Never include this script in ordinary tests.');
}
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-forge-provider-251-'));
const artifacts = path.join(directory, 'evidence');
await fs.mkdir(artifacts);
const started = new Date().toISOString();
const ledger = { source, started, workerRequestLimit: 1, workerTimeoutMs: 180_000,
  fixture: 'new disposable house', instruction: 'Widen this door from 900 mm to 1100 mm, preserving its centre and existing host. Keep every other object unchanged.',
  expected: { widthMetres: 1.1, offsetMetres: 2.9, centreMetres: [4, 3.45, 0] } };
await fs.writeFile(path.join(artifacts, 'budget.json'), JSON.stringify(ledger, null, 2));
process.stdout.write(`${JSON.stringify({ event: 'budget-recorded', directory, source, workerRequestLimit: 1 })}\n`);
let invocations = 0;
const connection = await CodexAccountConnection.open({ workingDirectory: path.join(directory, 'agent-workspace'), turnTimeoutMs: 180_000 });
const session = connection.publicSession();
assert.equal(session.connected, true, 'Existing AI account must be connected');
const realWorker = connection.modelWorker();
const server = await createDemoServer({ codex: connection, backlogFile: path.join(directory, 'queue.sqlite'), modelWorker: {
  identity: realWorker.identity,
  async run(input) {
    invocations += 1;
    assert.equal(invocations, 1, 'Qualification permits exactly one worker request');
    process.stdout.write(`${JSON.stringify({ event: 'provider-request-started', at: new Date().toISOString() })}\n`);
    await realWorker.run(input);
  },
} });
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert.ok(address && typeof address === 'object');
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => { void dialog.accept(); });
let outcome = 'not-submitted';
let terminalState = 'unknown';
let id: string | undefined;
let projectId: string | undefined;
try {
  await page.goto(base);
  await page.locator('#project-template').selectOption('house');
  await page.locator('#project-name').fill('Disposable connected spatial qualification');
  await page.locator('#create-project').click();
  await page.locator('#open-chat').click();
  await page.waitForFunction(() => document.getElementById('workspace-shell')?.dataset.spatialView === 'inside');
  await page.evaluate(async () => { const url = '/room-app.mjs'; const api = await import(url); const pose = api.captureWorkspaceInsidePose();
    if (!pose || !api.returnWorkspaceToPose({ ...pose, eye: [2, 3.45, 1.6], forward: [1, 0, 0], up: [0, 0, 1], motion: 'fly' })) throw new Error('Cannot set fixture view'); });
  await page.locator('#new-chat').click();
  await page.locator('.model-object-picker').selectOption(spatialFixtureManifest.doorId);
  await page.locator('#request-text').fill(ledger.instruction);
  const responsePromise = page.waitForResponse(response => response.url() === `${base}/api/change-requests` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const acknowledgement = await responsePromise; assert.equal(acknowledgement.status(), 202);
  const ack: unknown = await acknowledgement.json();
  assert.ok(ack && typeof ack === 'object' && 'ticket' in ack && ack.ticket && typeof ack.ticket === 'object'
    && 'id' in ack.ticket && typeof ack.ticket.id === 'string' && 'projectId' in ack.ticket && typeof ack.ticket.projectId === 'string');
  id = ack.ticket.id; projectId = ack.ticket.projectId;
  const project = async () => { const data: unknown = await (await page.request.get(`${base}/api/projects/${projectId}`)).json();
    assert.ok(data && typeof data === 'object' && 'project' in data && typeof data.project === 'string'); return RoomRepository.restore(data.project); };
  const before = await project(); const baseRevision = before.head('main'); const snapshot = before.view(baseRevision).snapshot;
  assert.equal(spatialDoorFacts(snapshot).width, .9);
  outcome = 'submitted';
  const deadline = Date.now() + 180_000;
  let proposedProject: string | undefined;
  let proposalName: string | undefined;
  let placement: unknown;
  while (Date.now() < deadline) {
    const data: unknown = await (await page.request.get(`${base}/api/change-requests/${id}`)).json();
    assert.ok(data && typeof data === 'object' && 'ticket' in data && data.ticket && typeof data.ticket === 'object' && 'state' in data.ticket && typeof data.ticket.state === 'string');
    terminalState = data.ticket.state; const ticket = data.ticket;
    if (['ready', 'needs-input', 'failed', 'cancelled'].includes(terminalState)) {
      if ('taskPlacement' in ticket) placement = ticket.taskPlacement;
      if ('request' in ticket && ticket.request && typeof ticket.request === 'object' && 'proposalName' in ticket.request && typeof ticket.request.proposalName === 'string') proposalName = ticket.request.proposalName;
      if ('result' in ticket && ticket.result && typeof ticket.result === 'object' && 'project' in ticket.result && typeof ticket.result.project === 'string') proposedProject = ticket.result.project;
      await fs.writeFile(path.join(artifacts, 'terminal-ticket.private.json'), JSON.stringify(ticket, null, 2));
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal((await project()).head('main'), baseRevision, 'No provider result may publish before explicit acceptance');
  if (terminalState !== 'ready') { outcome = `stopped-${terminalState}`; throw new Error(`Bounded real worker ended ${terminalState}; no retry or acceptance performed.`); }
  assert.ok(proposedProject && proposalName);
  const proposed = await RoomRepository.restore(proposedProject); const review = proposed.review(proposalName);
  const proposedSnapshot = proposed.view(review.proposalRevisionId).snapshot;
  const expected = spatialExpectedDoorSnapshot(snapshot);
  assert.deepEqual(proposedSnapshot, expected, 'Real provider result must match the full independent oracle');
  assert.equal(review.decision.status, 'pending');
  const parsedPlacement = parseTaskPlacement(placement); assert.equal(parsedPlacement.kind, 'placed');
  const tray = page.getByRole('region', { name: 'Canvas proposal review' }); await tray.waitFor({ timeout: 15_000 });
  await page.screenshot({ path: path.join(artifacts, 'proposal.png'), fullPage: true });
  const decision = page.waitForResponse(response => response.url().endsWith('/decision') && response.request().method() === 'POST');
  await tray.getByRole('button', { name: /^Accept into/ }).click(); assert.equal((await decision).status(), 200);
  const accepted = await project(); assert.deepEqual(accepted.view(accepted.head('main')).snapshot, expected);
  assert.notEqual(accepted.head('main'), baseRevision);
  assert.equal(invocations, 1); assert.deepEqual(errors, []);
  await fs.writeFile(path.join(artifacts, 'delta.json'), JSON.stringify(diffSnapshots(snapshot, proposedSnapshot), null, 2));
  await fs.writeFile(path.join(artifacts, 'facts.json'), JSON.stringify({ before: spatialDoorFacts(snapshot), proposed: spatialDoorFacts(proposedSnapshot), accepted: spatialDoorFacts(accepted.view(accepted.head('main')).snapshot), placement: parsedPlacement, scriptValidations: review.scriptExecutions?.map(item => item.validation) }, null, 2));
  outcome = 'passed-proposal-and-explicit-acceptance';
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Qualification failed'}\n`);
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ source, started, finished: new Date().toISOString(), outcome, terminalState, invocations, id, projectId, browserErrors: errors }, null, 2));
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await server.closeModelWorkers(); connection.close();
  process.stdout.write(`${JSON.stringify({ event: 'qualification-finished', outcome, terminalState, invocations, evidence: artifacts })}\n`);
}
