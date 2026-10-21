import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePlan, renderPlan } from './plan.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const workerPath = fileURLToPath(new URL('./fixture-worker.mjs', import.meta.url));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const activeStates = new Set(['running']);

function writeJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
}

function validateStore(repoRoot, dataDir) {
  const repo = fs.realpathSync(repoRoot);
  // Resolve existing ancestors before creating a directory, including symlinks.
  let ancestor = path.resolve(dataDir);
  const tail = [];
  while (!fs.existsSync(ancestor)) {
    tail.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  const resolved = path.join(fs.realpathSync(ancestor), ...tail);
  const relative = path.relative(repo, resolved);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Run storage must be outside the repository checkout');
  }
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  return resolved;
}

function lockStore(dataDir) {
  const file = path.join(dataDir, 'worker.lock');
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Worker store is locked. Stop the worker and use recover for an interrupted run.');
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, host: os.hostname(), token: randomUUID() }));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return () => fs.unlinkSync(file);
}

export function listRuns(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[0-9a-f-]{36}$/.test(entry.name))
    .map((entry) => readJson(path.join(dataDir, entry.name, 'run.json')))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.attempt - right.attempt);
}

function transition(dataDir, run, status, message) {
  run.status = status;
  run.message = message;
  if (!activeStates.has(status)) run.finishedAt = new Date().toISOString();
  const runDir = path.join(dataDir, run.id);
  writeJson(path.join(runDir, 'run.json'), run);
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), status, message })}\n`, { mode: 0o600 });
}

export function isPaused(stateFile) {
  const text = fs.readFileSync(stateFile, 'utf8');
  const matches = [...text.matchAll(/^paused:\s*(true|false)\s*$/gm)];
  if (matches.length !== 1) throw new Error('STATE.md must contain exactly one explicit paused boolean');
  return matches[0][1] === 'true';
}

function validateInput(issue, sourceRevision) {
  if (!issue || typeof issue !== 'object' || !/^[\w.-]+\/[\w.-]+$/.test(issue.repository)) throw new Error('Invalid fixture repository');
  if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error('Invalid fixture issue number');
  for (const field of ['title', 'body', 'updatedAt']) {
    if (typeof issue[field] !== 'string' || !issue[field].trim()) throw new Error(`Fixture issue needs ${field}`);
  }
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) throw new Error('A full source commit is required');
}

function executeFixture({ plan, delayMs, timeoutMs, pollMs, stateFile, signal, onSpawn }) {
  return new Promise((resolve, reject) => {
    // Do not inherit GitHub credentials, model credentials, or user configuration.
    const env = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {};
    const child = spawn(process.execPath, [workerPath], { env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let output = '';
    let errorOutput = '';
    let stopped;
    let timer;
    let poll;
    const stop = (status, message) => {
      if (!stopped) stopped = { status, message };
      child.kill('SIGKILL');
    };
    const cancel = () => stop('cancelled', 'Cancelled by operator');
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(poll);
      signal?.removeEventListener('abort', cancel);
    };
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > 65536) stop('failed', 'Planner output exceeded 64 KiB');
    });
    child.stderr.on('data', (chunk) => { errorOutput = (errorOutput + chunk).slice(-4096); });
    child.stdin.on('error', () => {}); // Child termination can close stdin before the write completes.
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('close', (code) => {
      cleanup();
      if (stopped) return resolve(stopped);
      if (code !== 0) return resolve({ status: 'failed', message: `Fixture process exited ${code}: ${errorOutput}` });
      try {
        // Recheck immediately before accepting output, even if the polling interval has not elapsed.
        if (signal?.aborted || isPaused(stateFile)) return resolve({ status: 'cancelled', message: 'Paused or cancelled before accepting output' });
        const result = validatePlan(JSON.parse(output));
        resolve({ status: result.questions.length ? 'needs-input' : 'succeeded', message: 'Fixture output validated', plan: result });
      } catch (error) {
        resolve({ status: 'failed', message: error.message });
      }
    });
    timer = setTimeout(() => stop('timed-out', 'Planning wall-clock limit reached'), timeoutMs);
    poll = setInterval(() => {
      try {
        if (isPaused(stateFile)) stop('cancelled', 'Paused during planning');
      } catch (error) {
        stop('cancelled', `Cannot verify pause state: ${error.message}`);
      }
    }, pollMs);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      onSpawn(child.pid);
      if (signal?.aborted) cancel();
      child.stdin.end(JSON.stringify({ plan, delayMs }));
    } catch (error) {
      stop('failed', error.message);
    }
  });
}

export async function runFixturePlan({ repoRoot, dataDir, issue, sourceRevision, plan, timeoutMs = 600000, delayMs = 0, pollMs = 250, retry = false, signal }) {
  validateInput(issue, sourceRevision);
  for (const [name, value] of Object.entries({ timeoutMs, pollMs })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 600000) throw new Error(`Invalid ${name}`);
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60000) throw new Error('Invalid fixture delay');
  const payload = JSON.stringify({ plan, delayMs });
  if (Buffer.byteLength(payload) > 131072) throw new Error('Fixture input too large');
  const store = validateStore(repoRoot, dataDir);
  const unlock = lockStore(store);
  try {
    const runs = listRuns(store);
    if (runs.some((run) => activeStates.has(run.status))) throw new Error('Interrupted run requires explicit recovery before another job');
    const policyText = fs.readFileSync(path.join(repoRoot, 'policy', 'gate.json'), 'utf8');
    const policy = JSON.parse(policyText);
    if (policy.version !== 1 || !Number.isSafeInteger(policy.maxAttemptsPerIssue) || policy.maxAttemptsPerIssue < 1) throw new Error('Invalid attempt policy');
    const policyHash = hash(policyText);
    const issueSnapshot = { repository: issue.repository, number: issue.number, title: issue.title, body: issue.body, updatedAt: issue.updatedAt, approved: issue.approved === true };
    const fingerprint = hash(JSON.stringify({ issue: issueSnapshot, sourceRevision, policyHash }));
    const attempts = runs.filter((run) => run.fingerprint === fingerprint && run.status !== 'blocked');
    const previous = attempts.at(-1);
    if (previous && !retry) return { ...previous, reused: true };
    if (previous && ['succeeded', 'needs-input'].includes(previous.status)) throw new Error('This input already has a validated result');
    if (attempts.length >= policy.maxAttemptsPerIssue) throw new Error('Attempt limit reached; escalate to the maintainer');
    const run = {
      id: randomUUID(), fingerprint, mode: 'fixture', planner: 'fixed-fixture-process-v1',
      sourceRevision, policyHash, issue: issueSnapshot, attempt: attempts.length + 1,
      host: os.hostname(), workerPid: process.pid, plannerPid: null,
      startedAt: new Date().toISOString(), finishedAt: null, status: 'running',
      timeoutMs, usage: null, cost: null,
    };
    fs.mkdirSync(path.join(store, run.id), { mode: 0o700 });
    const stateFile = path.join(repoRoot, 'STATE.md');
    try {
      if (!issueSnapshot.approved) {
        transition(store, run, 'blocked', 'Fixture scope is not explicitly approved; no planner started');
        return run;
      }
      if (isPaused(stateFile) || signal?.aborted) {
        transition(store, run, 'blocked', 'Paused or cancelled before planning; no planner started');
        return run;
      }
      transition(store, run, 'running', 'Starting simulated planning process');
      const result = await executeFixture({ plan, delayMs, timeoutMs, pollMs, stateFile, signal,
        onSpawn(pid) {
          run.plannerPid = pid;
          writeJson(path.join(store, run.id, 'run.json'), run);
        },
      });
      if (result.plan) {
        writeJson(path.join(store, run.id, 'plan.json'), result.plan);
        fs.writeFileSync(path.join(store, run.id, 'plan.md'), renderPlan(result.plan), { mode: 0o600 });
      }
      transition(store, run, result.status, result.message);
    } catch (error) {
      transition(store, run, 'failed', error.message);
    }
    return run;
  } finally {
    unlock();
  }
}

function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid owner PID; inspect the lock manually');
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

// Operator-only action: stop the service before invoking recovery. Never reclaim automatically.
export function recoverInterrupted(repoRoot, dataDir) {
  const store = validateStore(repoRoot, dataDir);
  const lockFile = path.join(store, 'worker.lock');
  const pending = listRuns(store).filter((run) => activeStates.has(run.status));
  if (fs.existsSync(lockFile)) {
    const owner = readJson(lockFile);
    if (owner.host !== os.hostname() || isAlive(owner.pid)) throw new Error('Cannot recover a live worker or a store from another host');
    for (const run of pending) {
      if (run.host !== os.hostname() || (run.plannerPid && isAlive(run.plannerPid))) throw new Error('Stop the remaining planner process before recovery');
    }
    fs.unlinkSync(lockFile);
  }
  const unlock = lockStore(store);
  try {
    for (const run of pending) {
      if (run.host !== os.hostname() || isAlive(run.workerPid) || (run.plannerPid && isAlive(run.plannerPid))) throw new Error('A run process is still alive; stop it before recovery');
      transition(store, run, 'interrupted', 'Recovered after worker interruption; no automatic retry');
    }
    return pending;
  } finally { unlock(); }
}
