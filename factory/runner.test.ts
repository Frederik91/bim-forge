import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import type { TestContext } from 'node:test';
import { listRuns, recoverInterrupted, runFixturePlan } from './runner.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const issueFixture = JSON.parse(fs.readFileSync(new URL('./fixtures/issue.json', import.meta.url), 'utf8'));
const planFixture = JSON.parse(fs.readFileSync(new URL('./fixtures/plan.json', import.meta.url), 'utf8'));

function requiredMessage(message: string | undefined): string {
  if (message === undefined) throw new Error('Expected the run to include a message');
  return message;
}

function setup(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-forge-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repoRoot = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repoRoot, 'policy'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'STATE.md'), '# State\n\n```yaml\npaused: false\n```\n');
  fs.writeFileSync(path.join(repoRoot, 'policy', 'gate.json'), JSON.stringify({ version: 1, maxAttemptsPerIssue: 3 }));
  return {
    repoRoot, dataDir: path.join(dir, 'runs'), sourceRevision: 'a'.repeat(40),
    issue: structuredClone(issueFixture), plan: structuredClone(planFixture), pollMs: 10,
  };
}

async function waitForPlanner(dataDir: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (listRuns(dataDir).some((run) => run.plannerPid)) return;
    await delay(10);
  }
  throw new Error('Fixture process did not start');
}

test('saves a validated report, pinned inputs, event history, and explicit unknown usage', async (t) => {
  const options = setup(t);
  const run = await runFixturePlan(options);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.mode, 'fixture');
  assert.equal(run.usage, null);
  assert.equal(run.cost, null);
  assert.equal(run.sourceRevision, options.sourceRevision);
  const runDir = path.join(options.dataDir, run.id);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runDir, 'plan.json'), 'utf8')), planFixture);
  assert.match(fs.readFileSync(path.join(runDir, 'plan.md'), 'utf8'), /Simulation: fixture planner/);
  const events: unknown[] = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => typeof event === 'object' && event !== null ? Reflect.get(event, 'status') : undefined), ['running', 'succeeded']);
  assert.equal(listRuns(options.dataDir)[0].status, 'succeeded');
  assert.equal(fs.existsSync(path.join(options.dataDir, 'worker.lock')), false);
});

test('duplicate delivery reuses a result, but changed issue content creates a new input', async (t) => {
  const options = setup(t);
  const first = await runFixturePlan(options);
  const duplicate = await runFixturePlan(options);
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.reused, true);
  const next = await runFixturePlan({ ...options, issue: { ...options.issue, body: 'Changed request' } });
  assert.notEqual(next.id, first.id);
  assert.equal(listRuns(options.dataDir).length, 2);
  await assert.rejects(runFixturePlan({ ...options, retry: true }), /already has a validated result/);
});

test('refuses storage inside the checkout, including a symlink alias', async (t) => {
  const options = setup(t);
  await assert.rejects(runFixturePlan({ ...options, dataDir: path.join(options.repoRoot, 'runs') }), /outside the repository/);
  const alias = path.join(path.dirname(options.repoRoot), 'alias');
  fs.symlinkSync(options.repoRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(runFixturePlan({ ...options, dataDir: path.join(alias, 'runs') }), /outside the repository/);
});

test('pause and missing fixture approval block before spawning a planner', async (t) => {
  const options = setup(t);
  fs.writeFileSync(path.join(options.repoRoot, 'STATE.md'), 'paused: true\n');
  const paused = await runFixturePlan(options);
  assert.equal(paused.status, 'blocked');
  assert.equal(paused.plannerPid, null);
  fs.writeFileSync(path.join(options.repoRoot, 'STATE.md'), 'paused: false\n');
  const unapproved = await runFixturePlan({ ...options, issue: { ...options.issue, approved: false } });
  assert.equal(unapproved.status, 'blocked');
  assert.equal(unapproved.plannerPid, null);
});

test('missing or ambiguous pause state fails closed', async (t) => {
  const options = setup(t);
  fs.writeFileSync(path.join(options.repoRoot, 'STATE.md'), 'paused: false\npaused: true\n');
  const result = await runFixturePlan(options);
  assert.equal(result.status, 'failed');
  assert.equal(result.plannerPid, null);
  assert.match(requiredMessage(result.message), /exactly one/);
});

test('timeout kills the simulated planner before returning and records its outcome', async (t) => {
  const options = setup(t);
  const result = await runFixturePlan({ ...options, timeoutMs: 100, delayMs: 5000 });
  assert.equal(result.status, 'timed-out');
  const plannerPid = result.plannerPid;
  if (plannerPid === null) throw new Error('Expected the planner to start');
  assert.throws(() => process.kill(plannerPid, 0), { code: 'ESRCH' });
  assert.equal(fs.existsSync(path.join(options.dataDir, result.id, 'plan.json')), false);
});

test('a pause during planning terminates the planner and persists cancellation', async (t) => {
  const options = setup(t);
  const active = runFixturePlan({ ...options, delayMs: 5000 });
  await waitForPlanner(options.dataDir);
  fs.writeFileSync(path.join(options.repoRoot, 'STATE.md'), 'paused: true\n');
  const run = await active;
  assert.equal(run.status, 'cancelled');
  assert.match(requiredMessage(run.message), /Paused/);
  const plannerPid = run.plannerPid;
  if (plannerPid === null) throw new Error('Expected the planner to start');
  assert.throws(() => process.kill(plannerPid, 0), { code: 'ESRCH' });
});

test('loss of pause state during a run cancels work', async (t) => {
  const options = setup(t);
  const active = runFixturePlan({ ...options, delayMs: 5000 });
  await waitForPlanner(options.dataDir);
  fs.unlinkSync(path.join(options.repoRoot, 'STATE.md'));
  const run = await active;
  assert.equal(run.status, 'cancelled');
  assert.match(requiredMessage(run.message), /Cannot verify pause state/);
});

test('only one job can use a store; operator cancellation releases it', async (t) => {
  const options = setup(t);
  const controller = new AbortController();
  const active = runFixturePlan({ ...options, delayMs: 5000, signal: controller.signal });
  await waitForPlanner(options.dataDir);
  await assert.rejects(runFixturePlan(options), /store is locked/);
  assert.throws(() => recoverInterrupted(options.repoRoot, options.dataDir), /live worker/);
  controller.abort();
  const result = await active;
  assert.equal(result.status, 'cancelled');
  assert.equal(fs.existsSync(path.join(options.dataDir, 'worker.lock')), false);
});

test('invalid output fails rather than creating a successful report', async (t) => {
  const options = setup(t);
  const result = await runFixturePlan({ ...options, plan: { outcome: 'Missing acceptance checks' } });
  assert.equal(result.status, 'failed');
  assert.equal(fs.existsSync(path.join(options.dataDir, result.id, 'plan.json')), false);
});

test('a valid clarification request is distinct from a ready plan', async (t) => {
  const options = setup(t);
  const result = await runFixturePlan({ ...options, plan: { ...options.plan, steps: [], acceptanceChecks: [], reviewers: [], questions: ['Which discipline owns this change?'] } });
  assert.equal(result.status, 'needs-input');
  assert.equal(listRuns(options.dataDir)[0].status, 'needs-input');
});

test('plan text retains Unicode through process pipes', async (t) => {
  const options = setup(t);
  const plan = { ...options.plan, outcome: 'Kontrollér føringen ☀ '.repeat(1800) };
  const run = await runFixturePlan({ ...options, plan });
  assert.equal(run.status, 'succeeded');
  const saved = JSON.parse(fs.readFileSync(path.join(options.dataDir, run.id, 'plan.json'), 'utf8'));
  assert.equal(saved.outcome, plan.outcome);
});

test('oversized process output fails and leaves no accepted plan', async (t) => {
  const options = setup(t);
  const run = await runFixturePlan({ ...options, plan: { ...options.plan, outcome: 'x'.repeat(70000) } });
  assert.equal(run.status, 'failed');
  assert.match(requiredMessage(run.message), /exceeded/);
  assert.equal(fs.existsSync(path.join(options.dataDir, run.id, 'plan.json')), false);
});

test('failed runs do not retry automatically, and explicit retries stop at the ceiling', async (t) => {
  const options = { ...setup(t), plan: null };
  const first = await runFixturePlan(options);
  assert.equal(first.status, 'failed');
  assert.equal((await runFixturePlan(options)).id, first.id);
  assert.equal((await runFixturePlan({ ...options, retry: true })).attempt, 2);
  assert.equal((await runFixturePlan({ ...options, retry: true })).attempt, 3);
  await assert.rejects(runFixturePlan({ ...options, retry: true }), /Attempt limit/);
});

test('restart recovery marks abandoned work interrupted and never retries it', async (t) => {
  const options = setup(t);
  const first = await runFixturePlan(options);
  const file = path.join(options.dataDir, first.id, 'run.json');
  // Simulate persisted state left by a crashed worker, using a known exited process PID.
  const exited = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  assert.equal(exited.status, 0);
  const record = { ...first, status: 'running', finishedAt: null, workerPid: exited.pid, plannerPid: null };
  fs.writeFileSync(file, JSON.stringify(record));
  fs.writeFileSync(path.join(options.dataDir, 'worker.lock'), JSON.stringify({ pid: exited.pid, host: os.hostname(), token: randomUUID() }));
  await assert.rejects(runFixturePlan(options), /store is locked/);
  const recovered = recoverInterrupted(options.repoRoot, options.dataDir);
  assert.equal(recovered[0].status, 'interrupted');
  const duplicate = await runFixturePlan(options);
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.status, 'interrupted');
  assert.equal(duplicate.reused, true);
  const retry = await runFixturePlan({ ...options, retry: true });
  assert.equal(retry.status, 'succeeded');
  assert.equal(retry.attempt, 2);
});

test('shell-looking issue text remains recorded data and does not execute', async (t) => {
  const options = setup(t);
  const marker = path.join(options.dataDir, 'injected.txt');
  const injection = `$(touch '${marker}') & echo hostile;`;
  const run = await runFixturePlan({ ...options, issue: { ...options.issue, body: injection } });
  assert.equal(run.status, 'succeeded');
  assert.equal(run.issue.body, injection);
  assert.equal(fs.existsSync(marker), false);
});

test('CLI fails clearly on missing arguments and reports an empty store', (t) => {
  const options = setup(t);
  const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
  const missing = spawnSync(process.execPath, [cli, 'run'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Usage:/);
  const status = spawnSync(process.execPath, [cli, 'status', '--data-dir', options.dataDir], { encoding: 'utf8' });
  assert.equal(status.status, 0);
  assert.deepEqual(JSON.parse(status.stdout), []);
});
