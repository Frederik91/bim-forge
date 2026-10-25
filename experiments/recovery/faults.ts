import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { importPackage, readCurrent, verifyPackage } from './package.ts';
import { parseRunnerInput, parseObservations } from './protocol.ts';
import type { Observation, RunnerInput } from './protocol.ts';

const text = Type.String({ minLength: 1 });
const LeaseSchema = Type.Object({ leaseId: text, artifactRoot: text, expiresAt: text,
  permittedHelper: Type.Literal('w6-package-writer'),
}, { additionalProperties: false });
const WorkerSchema = Type.Object({ source: text, destination: text, marker: text,
  checkpoint: Type.Union([Type.Literal('after-stage-before-publish'), Type.Literal('after-publish')]),
}, { additionalProperties: false });
type Lease = Static<typeof LeaseSchema>;
type WorkerInput = Static<typeof WorkerSchema>;

function assertLease(lease: Lease, root: string): void {
  const expiry = Date.parse(lease.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('Coordinator execution lease expired or invalid.');
  const relative = path.relative(path.resolve(lease.artifactRoot), path.resolve(root));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('W6 fault run must be inside the leased artifact root.');
}

async function waitForCheckpoint(args: { worker: WorkerInput; lease: Lease; logRoot: string }): Promise<void> {
  assertLease(args.lease, args.logRoot);
  const configPath = path.join(args.logRoot, 'worker-input.json');
  await writeFile(configPath, JSON.stringify(args.worker), { flag: 'wx' });
  const helper = spawn(process.execPath, [fileURLToPath(import.meta.url), '--writer', configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  helper.stdout.on('data', (bytes: Buffer) => { stdout += bytes.toString('utf8'); });
  helper.stderr.on('data', (bytes: Buffer) => { stderr += bytes.toString('utf8'); });
  let finished = false;
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    helper.on('error', reject);
    helper.on('close', (code, signal) => { finished = true; resolve({ code, signal }); });
  });
  // Attach rejection handling immediately, including spawn failures before the first poll.
  const result = ended.then((value) => ({ kind: 'exit', value } satisfies { kind: 'exit'; value: { code: number | null; signal: NodeJS.Signals | null } }),
    (error: unknown) => ({ kind: 'error', error } satisfies { kind: 'error'; error: unknown }));
  let markerObserved = false;
  try {
    const deadline = Date.now() + 30_000;
    while (!finished && Date.now() < deadline) {
      try {
        const marker: unknown = JSON.parse(await readFile(args.worker.marker, 'utf8'));
        if (!Check(WorkerSchema, marker)) throw new Error('Invalid checkpoint marker.');
        assert.deepEqual(marker, args.worker);
        markerObserved = true;
        break;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      await setTimeout(25);
    }
    assert.ok(markerObserved, 'Dedicated writer did not reach the requested checkpoint.');
    assertLease(args.lease, args.logRoot);
    assert.ok(helper.kill('SIGKILL'), 'Dedicated writer could not be killed.');
    const outcome = await result;
    if (outcome.kind === 'error') throw outcome.error;
    assert.equal(outcome.value.signal, 'SIGKILL');
    await writeFile(path.join(args.logRoot, 'process.json'), JSON.stringify({ leaseId: args.lease.leaseId,
      pid: helper.pid, checkpoint: args.worker.checkpoint, markerObserved, ...outcome.value }, null, 2), { flag: 'wx' });
  } finally {
    // This handle owns only this spawned helper. No database/container or unrelated PID is targeted.
    if (!finished) helper.kill('SIGKILL');
    await result;
    await writeFile(path.join(args.logRoot, 'stdout.txt'), stdout, { flag: 'wx' });
    await writeFile(path.join(args.logRoot, 'stderr.txt'), stderr, { flag: 'wx' });
  }
}

export async function runPackageCrashCases(input: RunnerInput, lease: Lease): Promise<Observation[]> {
  const root = path.resolve(input.outputRoot, input.runId);
  assertLease(lease, root);
  await mkdir(input.outputRoot, { recursive: true });
  await mkdir(root);
  const source = await verifyPackage(input.sourcePackage);
  const upgraded = await verifyPackage(input.upgradedPackage);
  assert.notEqual(source.manifestSha256, upgraded.manifestSha256, 'Crash scenarios require a changed package.');
  const observations: Observation[] = [];
  for (const checkpoint of ['after-stage-before-publish', 'after-publish'] satisfies WorkerInput['checkpoint'][]) {
    const logRoot = path.join(root, checkpoint);
    await mkdir(logRoot);
    const destination = path.join(logRoot, 'independent-artifacts');
    await importPackage({ source: source.root, destination });
    const observation: Observation = { experimentId: 'EX-11', caseId: `package-process-${checkpoint}`,
      expected: 'Kill the dedicated package writer at the requested checkpoint, reopen the last complete pointer, then retry without changing immutable package bytes.',
      observed: 'Checkpoint not reached.', passed: false,
      limitations: ['POSIX process termination at a portable-copy pointer only. This does not exercise W5 database commit or power-loss recovery.'],
    };
    try {
      await waitForCheckpoint({ worker: { source: upgraded.root, destination,
        marker: path.join(logRoot, 'checkpoint.json'), checkpoint }, lease, logRoot });
      const reopened = await readCurrent(destination);
      const expected = checkpoint === 'after-publish' ? upgraded.manifestSha256 : source.manifestSha256;
      assert.equal(reopened?.manifestSha256, expected);
      const retry = await importPackage({ source: upgraded.root, destination });
      assert.equal(retry.manifestSha256, upgraded.manifestSha256);
      observation.observed = `Observed SIGKILL at ${checkpoint}; reopened ${expected}; retry published ${retry.manifestSha256}.`;
      observation.passed = true;
    } catch (error) { observation.observed = error instanceof Error ? error.message : String(error); }
    observations.push(observation);
    await writeFile(path.join(root, 'observations-progress.json'), JSON.stringify(observations, null, 2));
  }
  await writeFile(path.join(root, 'observations.json'), JSON.stringify(parseObservations(observations), null, 2), { flag: 'wx' });
  return observations;
}

async function writer(filename: string): Promise<void> {
  const raw: unknown = JSON.parse(await readFile(filename, 'utf8'));
  if (!Check(WorkerSchema, raw)) throw new Error('Invalid dedicated writer input.');
  await importPackage({ source: raw.source, destination: raw.destination, checkpoint: async (stage) => {
    if (stage !== raw.checkpoint) return;
    await writeFile(raw.marker, JSON.stringify(raw), { flag: 'wx' });
    // A timer keeps the dedicated child alive until the leased parent kills it.
    for (;;) await setTimeout(1000);
  } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--writer' && process.argv[3] && process.argv.length === 4) await writer(process.argv[3]);
  else {
    const inputPath = process.argv[2];
    const leasePath = process.argv[3];
    if (!inputPath || !leasePath || process.argv.length !== 4) throw new Error('Usage: node experiments/recovery/faults.ts <input.json> <coordinator-lease.json>');
    const rawInput: unknown = JSON.parse(await readFile(inputPath, 'utf8'));
    const rawLease: unknown = JSON.parse(await readFile(leasePath, 'utf8'));
    if (!Check(LeaseSchema, rawLease)) throw new Error('Invalid coordinator execution lease.');
    const observations = await runPackageCrashCases(parseRunnerInput(rawInput), rawLease);
    process.stdout.write(JSON.stringify(observations, null, 2) + '\n');
    if (observations.some((observation) => !observation.passed)) process.exitCode = 1;
  }
}
