import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePlan, renderPlan } from './plan.mjs';

type RunStatus = 'running' | 'blocked' | 'cancelled' | 'failed' | 'timed-out' | 'needs-input' | 'succeeded' | 'interrupted';
type PlannerMode = 'fixture' | 'live';
type PauseCheck = (options?: { fresh?: boolean }) => boolean | Promise<boolean>;

export interface PlanningIssue {
  repository: string;
  number: number;
  title: string;
  body: string;
  updatedAt: string;
  approved?: boolean;
}

interface PlanningIssueSnapshot extends Omit<PlanningIssue, 'approved'> {
  approved: boolean;
}

export interface PlanningPlan {
  outcome: string;
  changeClass: string;
  paths: string[];
  steps: string[];
  acceptanceChecks: string[];
  reviewers: string[];
  questions: string[];
}

interface PlannerCommand {
  executable: string;
  args: string[];
  input: string;
  env: NodeJS.ProcessEnv;
  processGroup?: boolean;
  maxOutputBytes?: number;
  parse(output: string): unknown;
}

interface Planner {
  mode: PlannerMode;
  id: string;
  contextHash?: string;
  build(runDirectory: string): unknown;
}

export interface PlanningRun {
  id: string;
  fingerprint: string;
  mode: PlannerMode;
  planner: string;
  contextHash: string | null;
  sourceRevision: string;
  policyHash: string;
  issue: PlanningIssueSnapshot;
  attempt: number;
  host: string;
  workerPid: number;
  plannerPid: number | null;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  timeoutMs: number;
  usage: unknown;
  cost: unknown;
  message?: string;
  warnings?: string[];
  reused?: boolean;
}

interface RunPlanOptions {
  repoRoot: string;
  dataDir: string;
  issue: unknown;
  sourceRevision: string;
  planner: unknown;
  timeoutMs?: number;
  pollMs?: number;
  retry?: boolean;
  signal?: AbortSignal;
  pauseCheck?: PauseCheck;
}

interface FixtureRunOptions extends Omit<RunPlanOptions, 'planner'> {
  plan: unknown;
  delayMs?: number;
}

interface ExecutionResult {
  status: Exclude<RunStatus, 'running' | 'blocked' | 'interrupted'>;
  message: string;
  plan?: PlanningPlan;
  usage?: unknown;
  warnings?: string[];
}

const workerPath = fileURLToPath(new URL('./fixture-worker.ts', import.meta.url));
const activeStates = new Set<RunStatus>(['running']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file: string, value: unknown): void {
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

function isIssue(value: unknown): value is PlanningIssue {
  return isRecord(value)
    && typeof value.repository === 'string' && /^[\w.-]+\/[\w.-]+$/.test(value.repository)
    && typeof value.number === 'number' && Number.isSafeInteger(value.number) && value.number > 0
    && typeof value.title === 'string' && Boolean(value.title.trim())
    && typeof value.body === 'string' && Boolean(value.body.trim())
    && typeof value.updatedAt === 'string' && Boolean(value.updatedAt.trim())
    && (value.approved === undefined || typeof value.approved === 'boolean');
}

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && [
    'running', 'blocked', 'cancelled', 'failed', 'timed-out', 'needs-input', 'succeeded', 'interrupted',
  ].includes(value);
}

function isPlannerMode(value: unknown): value is PlannerMode {
  return value === 'fixture' || value === 'live';
}

function isPlanningRun(value: unknown): value is PlanningRun {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.fingerprint === 'string'
    && isPlannerMode(value.mode)
    && typeof value.planner === 'string'
    && (value.contextHash === null || typeof value.contextHash === 'string')
    && typeof value.sourceRevision === 'string'
    && typeof value.policyHash === 'string'
    && isIssue(value.issue) && typeof value.issue.approved === 'boolean'
    && typeof value.attempt === 'number' && Number.isSafeInteger(value.attempt)
    && typeof value.host === 'string'
    && typeof value.workerPid === 'number' && Number.isSafeInteger(value.workerPid)
    && (value.plannerPid === null || (typeof value.plannerPid === 'number' && Number.isSafeInteger(value.plannerPid)))
    && typeof value.startedAt === 'string'
    && (value.finishedAt === null || typeof value.finishedAt === 'string')
    && isRunStatus(value.status)
    && typeof value.timeoutMs === 'number' && Number.isSafeInteger(value.timeoutMs)
    && (value.message === undefined || typeof value.message === 'string')
    && (value.warnings === undefined || (Array.isArray(value.warnings) && value.warnings.every((warning) => typeof warning === 'string')))
    && (value.reused === undefined || typeof value.reused === 'boolean');
}

function parseRunRecord(value: unknown): PlanningRun {
  if (!isPlanningRun(value)) throw new Error('Stored run record is invalid');
  return value;
}

function parsePlan(value: unknown): PlanningPlan {
  return validatePlan(value);
}

function validateStore(repoRoot: string, dataDir: string): string {
  const repo = fs.realpathSync(repoRoot);
  let ancestor = path.resolve(dataDir);
  const tail: string[] = [];
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

function lockStore(dataDir: string): () => void {
  const file = path.join(dataDir, 'worker.lock');
  let descriptor: number;
  try {
    descriptor = fs.openSync(file, 'wx', 0o600);
  } catch (error) {
    if (errorCode(error) === 'EEXIST') throw new Error('Worker store is locked. Stop the worker and use recover for an interrupted run.');
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

export function listRuns(dataDir: string): PlanningRun[] {
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[0-9a-f-]{36}$/.test(entry.name))
    .map((entry) => parseRunRecord(readJson(path.join(dataDir, entry.name, 'run.json'))))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.attempt - right.attempt);
}

function transition(dataDir: string, run: PlanningRun, status: RunStatus, message: string): void {
  run.status = status;
  run.message = message;
  if (!activeStates.has(status)) run.finishedAt = new Date().toISOString();
  const runDir = path.join(dataDir, run.id);
  writeJson(path.join(runDir, 'run.json'), run);
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), status, message })}\n`, { mode: 0o600 });
}

export function isPaused(stateFile: string): boolean {
  const text = fs.readFileSync(stateFile, 'utf8');
  const matches = [...text.matchAll(/^paused:\s*(true|false)\s*$/gm)];
  if (matches.length !== 1) throw new Error('STATE.md must contain exactly one explicit paused boolean');
  return matches[0]?.[1] === 'true';
}

function validateInput(issue: unknown, sourceRevision: string): asserts issue is PlanningIssue {
  if (!isIssue(issue)) throw new Error('Invalid fixture issue');
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) throw new Error('A full source commit is required');
}

function isPlanner(value: unknown): value is Planner {
  return isRecord(value)
    && isPlannerMode(value.mode)
    && typeof value.id === 'string'
    && typeof value.build === 'function'
    && (value.contextHash === undefined || typeof value.contextHash === 'string');
}

function isEnvironment(value: unknown): value is NodeJS.ProcessEnv {
  return isRecord(value) && Object.values(value).every((entry) => entry === undefined || typeof entry === 'string');
}

function isPlannerCommand(value: unknown): value is PlannerCommand {
  return isRecord(value)
    && typeof value.executable === 'string'
    && Array.isArray(value.args) && value.args.every((argument) => typeof argument === 'string')
    && typeof value.input === 'string'
    && isEnvironment(value.env)
    && typeof value.parse === 'function'
    && (value.processGroup === undefined || typeof value.processGroup === 'boolean')
    && (value.maxOutputBytes === undefined || (typeof value.maxOutputBytes === 'number' && Number.isSafeInteger(value.maxOutputBytes)));
}

function parseWarnings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((warning) => typeof warning === 'string')) throw new Error('Planner warnings are invalid');
  return value;
}

interface ExecutePlannerOptions {
  planner: Planner;
  runDir: string;
  timeoutMs: number;
  pollMs: number;
  stateFile: string;
  pauseCheck: PauseCheck | undefined;
  signal: AbortSignal | undefined;
  onSpawn(pid: number): void;
}

function executePlanner({ planner, runDir, timeoutMs, pollMs, stateFile, pauseCheck, signal, onSpawn }: ExecutePlannerOptions): Promise<ExecutionResult> {
  return new Promise((resolve, reject) => {
    const builtCommand = planner.build(runDir);
    if (!isPlannerCommand(builtCommand)) {
      reject(new Error('Planner produced an invalid command'));
      return;
    }
    const command = builtCommand;
    const child = spawn(command.executable, command.args, {
      env: command.env, shell: false, detached: command.processGroup === true,
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let output = '';
    let errorOutput = '';
    let stopped: ExecutionResult | undefined;
    let ended = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const stop = (status: ExecutionResult['status'], message: string): void => {
      if (ended) return;
      stopped ??= { status, message };
      try {
        if (command.processGroup && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (error) {
        if (errorCode(error) !== 'ESRCH') reject(error);
      }
    };
    const cancel = (): void => stop('cancelled', 'Cancelled by operator');
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      if (poll !== undefined) clearInterval(poll);
      signal?.removeEventListener('abort', cancel);
    };
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > (command.maxOutputBytes ?? 65536)) stop('failed', 'Planner output exceeded its byte limit');
    });
    child.stderr.on('data', (chunk: string) => { errorOutput = (errorOutput + chunk).slice(-4096); });
    child.stdin.on('error', () => {});
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('close', async (code) => {
      ended = true;
      cleanup();
      if (stopped !== undefined) {
        resolve(stopped);
        return;
      }
      if (code !== 0) {
        resolve({ status: 'failed', message: `Planner process exited ${code}: ${errorOutput}` });
        return;
      }
      try {
        if (planner.mode === 'live') fs.writeFileSync(path.join(runDir, 'planner-output.jsonl'), output, { mode: 0o600 });
        if (signal?.aborted || isPaused(stateFile) || await pauseCheck?.({ fresh: true })) {
          resolve({ status: 'cancelled', message: 'Paused or cancelled before accepting output' });
          return;
        }
        if (signal?.aborted || isPaused(stateFile)) {
          resolve({ status: 'cancelled', message: 'Paused or cancelled while verifying output' });
          return;
        }
        const parsed = command.parse(output);
        if (!isRecord(parsed) || !Object.hasOwn(parsed, 'plan')) throw new Error('Planner response is invalid');
        const result = parsePlan(parsed.plan);
        resolve({
          status: result.questions.length ? 'needs-input' : 'succeeded',
          message: 'Planner output validated',
          plan: result,
          usage: parsed.usage ?? null,
          warnings: parseWarnings(parsed.warnings),
        });
      } catch (error) {
        const usage = isRecord(error) ? error.usage ?? null : null;
        resolve({ status: 'failed', message: errorMessage(error), usage });
      }
    });
    timer = setTimeout(() => stop('timed-out', 'Planning wall-clock limit reached'), timeoutMs);
    let checking = false;
    poll = setInterval(async () => {
      if (checking || stopped !== undefined) return;
      checking = true;
      try {
        if (isPaused(stateFile) || await pauseCheck?.()) stop('cancelled', 'Paused during planning');
      } catch (error) {
        stop('cancelled', `Cannot verify pause state: ${errorMessage(error)}`);
      } finally {
        checking = false;
      }
    }, pollMs);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (child.pid === undefined) throw new Error('Planner process did not receive a PID');
      onSpawn(child.pid);
      if (signal?.aborted) cancel();
      child.stdin.end(command.input);
    } catch (error) {
      stop('failed', errorMessage(error));
    }
  });
}

export function runFixturePlan({ plan, delayMs = 0, ...options }: FixtureRunOptions): Promise<PlanningRun> {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60000) throw new Error('Invalid fixture delay');
  const input = JSON.stringify({ plan, delayMs });
  if (Buffer.byteLength(input) > 131072) throw new Error('Fixture input too large');
  const env: NodeJS.ProcessEnv = {};
  if (process.platform === 'win32' && process.env.SystemRoot !== undefined) env.SystemRoot = process.env.SystemRoot;
  return runPlan({
    ...options,
    planner: {
      mode: 'fixture',
      id: 'fixed-fixture-process-v1',
      build() {
        return {
          executable: process.execPath, args: [workerPath], input, env,
          parse(output: string) { return { plan: JSON.parse(output), usage: null }; },
        };
      },
    },
  });
}

export async function runPlan({
  repoRoot, dataDir, issue, sourceRevision, planner, timeoutMs = 600000, pollMs = 250,
  retry = false, signal, pauseCheck,
}: RunPlanOptions): Promise<PlanningRun> {
  validateInput(issue, sourceRevision);
  for (const [name, value] of Object.entries({ timeoutMs, pollMs })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 600000) throw new Error(`Invalid ${name}`);
  }
  if (!isPlanner(planner)) throw new Error('Invalid trusted planner adapter');
  const store = validateStore(repoRoot, dataDir);
  const unlock = lockStore(store);
  try {
    const runs = listRuns(store);
    if (runs.some((run) => activeStates.has(run.status))) throw new Error('Interrupted run requires explicit recovery before another job');
    const policyText = fs.readFileSync(path.join(repoRoot, 'policy', 'gate.json'), 'utf8');
    const policy: unknown = JSON.parse(policyText);
    if (!isRecord(policy) || policy.version !== 1 || typeof policy.maxAttemptsPerIssue !== 'number'
        || !Number.isSafeInteger(policy.maxAttemptsPerIssue) || policy.maxAttemptsPerIssue < 1) {
      throw new Error('Invalid attempt policy');
    }
    const policyHash = hash(policyText);
    const issueSnapshot: PlanningIssueSnapshot = {
      repository: issue.repository, number: issue.number, title: issue.title, body: issue.body,
      updatedAt: issue.updatedAt, approved: issue.approved === true,
    };
    const fingerprint = hash(JSON.stringify({
      issue: issueSnapshot, sourceRevision, policyHash, mode: planner.mode,
      planner: planner.id, contextHash: planner.contextHash ?? null,
    }));
    const attempts = runs.filter((run) => run.fingerprint === fingerprint && run.status !== 'blocked');
    const previous = attempts.at(-1);
    if (previous && !retry) return { ...previous, reused: true };
    if (previous && ['succeeded', 'needs-input'].includes(previous.status)) throw new Error('This input already has a validated result');
    if (attempts.length >= policy.maxAttemptsPerIssue) throw new Error('Attempt limit reached; escalate to the maintainer');
    const run: PlanningRun = {
      id: randomUUID(), fingerprint, mode: planner.mode, planner: planner.id,
      contextHash: planner.contextHash ?? null, sourceRevision, policyHash, issue: issueSnapshot,
      attempt: attempts.length + 1, host: os.hostname(), workerPid: process.pid, plannerPid: null,
      startedAt: new Date().toISOString(), finishedAt: null, status: 'running',
      timeoutMs, usage: null, cost: null,
    };
    const stagingDir = path.join(store, `${run.id}.pending`);
    fs.mkdirSync(stagingDir, { mode: 0o700 });
    writeJson(path.join(stagingDir, 'run.json'), run);
    fs.renameSync(stagingDir, path.join(store, run.id));
    const stateFile = path.join(repoRoot, 'STATE.md');
    try {
      if (!issueSnapshot.approved) {
        transition(store, run, 'blocked', 'Scope is not explicitly approved; no planner started');
        return run;
      }
      if (isPaused(stateFile) || signal?.aborted || await pauseCheck?.({ fresh: true })) {
        transition(store, run, 'blocked', 'Paused or cancelled before planning; no planner started');
        return run;
      }
      transition(store, run, 'running', `Starting ${planner.mode} planning process`);
      const result = await executePlanner({
        planner, runDir: path.join(store, run.id), timeoutMs, pollMs, stateFile, pauseCheck, signal,
        onSpawn(pid) {
          run.plannerPid = pid;
          writeJson(path.join(store, run.id, 'run.json'), run);
        },
      });
      if (result.plan !== undefined) {
        writeJson(path.join(store, run.id, 'plan.json'), result.plan);
        fs.writeFileSync(path.join(store, run.id, 'plan.md'), renderPlan(result.plan, planner.mode), { mode: 0o600 });
      }
      run.usage = result.usage ?? null;
      run.warnings = result.warnings ?? [];
      transition(store, run, result.status, result.message);
    } catch (error) {
      transition(store, run, 'failed', errorMessage(error));
    }
    return run;
  } finally {
    unlock();
  }
}

function isAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid owner PID; inspect the lock manually');
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false;
    throw error;
  }
}

export function recoverInterrupted(repoRoot: string, dataDir: string): PlanningRun[] {
  const store = validateStore(repoRoot, dataDir);
  const lockFile = path.join(store, 'worker.lock');
  const pending = listRuns(store).filter((run) => activeStates.has(run.status));
  if (fs.existsSync(lockFile)) {
    const owner = readJson(lockFile);
    if (!isRecord(owner) || typeof owner.host !== 'string' || typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid)) {
      throw new Error('Worker lock is invalid; inspect it manually');
    }
    if (owner.host !== os.hostname() || isAlive(owner.pid)) throw new Error('Cannot recover a live worker or a store from another host');
    for (const run of pending) {
      if (run.host !== os.hostname() || (run.plannerPid !== null && isAlive(run.plannerPid))) {
        throw new Error('Stop the remaining planner process before recovery');
      }
    }
    fs.unlinkSync(lockFile);
  }
  const unlock = lockStore(store);
  try {
    for (const run of pending) {
      if (run.host !== os.hostname() || isAlive(run.workerPid) || (run.plannerPid !== null && isAlive(run.plannerPid))) {
        throw new Error('A run process is still alive; stop it before recovery');
      }
      transition(store, run, 'interrupted', 'Recovered after worker interruption; no automatic retry');
    }
    return pending;
  } finally {
    unlock();
  }
}
