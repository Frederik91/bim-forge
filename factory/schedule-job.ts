import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCodingSpec, prepareCodingPackage, sha256, type CodingSpec } from './coding.ts';
import { readProtectedCodingFile, saveCodingJson, type CodingRun } from './coding-store.ts';
import { parseScheduleApproval, type ScheduleApproval } from './schedule-approval.ts';
import { parseActivation, createScheduledPermit } from './scheduled-publication.ts';
import { measureDeployment, assertUnitDeployment } from './coding-identity.ts';
import { runCodingJob, runUnit } from './code-job.ts';
import { assertCodingObservation } from './code-acceptance.ts';
import { approvePackage } from './publish-request.ts';

const root = '/var/lib/bim-forge-coding';
const approvals = '/var/lib/bim-forge-approvals';
const scheduleRoot = `${root}/schedule`;
const durationNs = 1200000000000n;
export interface ScheduleClock {
  readonly now: Date;
  readonly monotonicNs: bigint;
  readonly bootId: string;
}

export interface ActiveDispatch extends Record<string, unknown> {
  version: 1;
  id: string;
  approvalSha256: string;
  scopeSha256: string;
  invocationId: string | null;
  bootId: string;
  startedNs: string;
  deadlineNs: string;
  runId: string | null;
  units: string[];
  publicationSha256: string | null;
}

export interface DispatchResult extends Record<string, unknown> {
  readonly status: string;
}

export interface ScheduleGuardContext {
  readonly unit?: string;
  readonly measure?: boolean;
}

export type ScheduleGuard = (context?: ScheduleGuardContext) => Promise<void>;

export interface ScheduleCodeOptions {
  readonly schedule: Record<string, unknown>;
  readonly guard: ScheduleGuard;
  readonly onAdmitted: (run: CodingRun) => Promise<void>;
  readonly onCleanup: () => Promise<void>;
  readonly onVerified: (run: CodingRun) => Promise<unknown>;
}

export interface ScheduleIo {
  readonly clock: () => ScheduleClock;
  readonly activation: () => Buffer | null;
  readonly assertNoActive: () => void;
  readonly receipt: (digest: string) => DispatchResult | null;
  readonly approval: (digest: string) => Buffer;
  readonly scope: (digest: string) => Buffer;
  readonly measure: () => string;
  readonly assertUnit: (unit: string) => void;
  readonly assertUnpaused: () => void;
  readonly assertResources: () => void;
  readonly pathsAbsent: (spec: CodingSpec) => boolean;
  readonly invocationId: () => string | null;
  readonly claim: (active: ActiveDispatch) => ActiveDispatch;
  readonly saveActive: (active: ActiveDispatch) => void;
  readonly recordUnit: (active: ActiveDispatch, unit: string) => void;
  readonly code: (spec: CodingSpec, bytes: Buffer, options: ScheduleCodeOptions) => Promise<Record<string, unknown>>;
  readonly verifiedPackage: (
    run: CodingRun,
    spec: CodingSpec,
    approval: Readonly<ScheduleApproval>,
    approvedSha256: string,
  ) => Buffer;
  readonly stage: (digest: string, bytes: Buffer, permit: Buffer) => void;
  readonly publish: (digest: string, spec: CodingSpec, guard: ScheduleGuard) => Promise<unknown>;
  readonly cleanup: (active: ActiveDispatch) => void;
  readonly saveInterrupted: (active: ActiveDispatch, result: DispatchResult) => void;
  readonly finish: (active: ActiveDispatch, receipt: DispatchResult) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isId = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const isSha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exists = (file: string): boolean => {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (isRecord(error) && error.code === 'ENOENT') return false; throw error; }
};
const recovery = (message: string): Error => Object.assign(new Error(message), { requiresRecovery: true });
const requiresRecovery = (error: unknown): boolean => isRecord(error) && error.requiresRecovery === true;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Unknown scheduled failure';
const clock = (): ScheduleClock => ({ now: new Date(), monotonicNs: process.hrtime.bigint(),
  bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() });
const command = (file: string, args: string[], maximum = 2 * 1024 * 1024): string => execFileSync(file, args, {
  encoding: 'utf8', timeout: 15000, maxBuffer: maximum,
  env: { PATH: '/usr/bin:/bin', LANG: 'C', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
});
const git = (...args: string[]): string => command('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-C', '/opt/bim-forge/coding-source', ...args]);
const protectedJson = (file: string, maximum: number): unknown => JSON.parse(readProtectedCodingFile(file, 0, maximum).toString('utf8'));

// The I/O seam lets tests exercise real scheduling decisions without credentials,
// root, system services, network, model calls, or candidate code execution.
export async function dispatchOnce(io: ScheduleIo): Promise<DispatchResult> {
  const started = io.clock();
  const activationBytes = io.activation();
  if (activationBytes === null) return { status: 'disabled' };
  const activation = parseActivation(activationBytes);
  io.assertNoActive();
  if (activation.approvalSha256 === null) return { status: 'idle', reason: 'no-approved-scope' };
  const approvedSha256 = activation.approvalSha256;
  const prior = io.receipt(approvedSha256);
  if (prior) return { ...prior, reused: true };
  const approvalBytes = io.approval(approvedSha256);
  const approval = parseScheduleApproval(approvalBytes, approvedSha256, started.now);
  const scopeBytes = io.scope(approval.scopeSha256);
  if (sha256(scopeBytes) !== approval.scopeSha256) throw new Error('Scheduled scope digest changed');
  const spec = readCodingSpec(scopeBytes);
  const deadlineNs = started.monotonicNs + durationNs;
  let lastWall = started.now.getTime();
  let active: ActiveDispatch | null = null;
  let cleanupConfirmed = false;
  const guard: ScheduleGuard = async ({ unit, measure = false } = {}) => {
    const current = io.clock();
    if (current.bootId !== started.bootId || current.monotonicNs < started.monotonicNs
        || current.monotonicNs >= deadlineNs || current.now.getTime() < lastWall) throw new Error('Scheduled whole-job deadline or clock changed');
    lastWall = current.now.getTime();
    parseScheduleApproval(approvalBytes, approvedSha256, current.now);
    if (!io.activation()?.equals(activationBytes)) throw new Error('Scheduled activation changed');
    io.assertUnpaused();
    if (measure || unit) {
      if (io.measure() !== approval.deploymentSha256) throw new Error('Scheduled installed deployment changed');
    }
    if (unit) {
      if (!active) throw new Error('Scheduled unit has no active dispatch');
      io.assertUnit(unit);
      io.recordUnit(active, unit);
    }
  };
  await guard({ measure: true });
  io.assertResources();
  // Existence is checked BEFORE admission consumes a start or invokes the model.
  if (!io.pathsAbsent(spec)) return { status: 'idle', reason: 'profile-already-present' };
  await guard();
  const claimed = io.claim({ version: 1, id: randomUUID(), approvalSha256: approvedSha256,
    scopeSha256: approval.scopeSha256, invocationId: io.invocationId(), bootId: started.bootId,
    startedNs: String(started.monotonicNs), deadlineNs: String(deadlineNs), runId: null, units: [], publicationSha256: null });
  active = claimed;
  let result: DispatchResult;
  try {
    const run = await io.code(spec, scopeBytes, { schedule: { approvalBytes, approvedSha256, deploymentSha256: approval.deploymentSha256 },
      guard,
      onAdmitted: async (run) => { claimed.runId = run.id; io.saveActive(claimed); },
      onCleanup: async () => {
        try { io.cleanup(claimed); cleanupConfirmed = true; }
        catch { throw recovery('Scheduled cleanup requires administrator recovery'); }
      },
      onVerified: async (run) => {
        await guard({ measure: true });
        const bytes = io.verifiedPackage(run, spec, approval, approvedSha256);
        const publicationSha256 = sha256(bytes);
        const permit = createScheduledPermit({ publicationSha256, approvalBytes, approvedSha256,
          activationBytes, runId: run.id, bootId: started.bootId,
          startedNs: String(started.monotonicNs), deadlineNs: String(deadlineNs) }, io.clock());
        claimed.publicationSha256 = publicationSha256; io.saveActive(claimed);
        await guard();
        io.stage(publicationSha256, bytes, permit);
        await guard({ measure: true });
        return io.publish(publicationSha256, spec, guard);
      },
    });
    if (typeof run.id !== 'string') throw new Error('Scheduled coding result is invalid');
    if (run.reused) result = { status: 'recovery-required', reason: 'coding-run-already-recorded', runId: run.id };
    else {
      const publication = run.scheduledPublication;
      if (!isRecord(publication) || publication.status !== 'published' || publication.tokenRevoked !== true
          || publication.digest !== claimed.publicationSha256) throw new Error('Scheduled publication outcome is unknown; reconcile manually');
      result = { status: 'published', runId: run.id, publication };
    }
  } catch (error) {
    result = { status: requiresRecovery(error) ? 'recovery-required' : 'stopped', message: errorMessage(error),
      runId: claimed.runId, publicationSha256: claimed.publicationSha256 };
    if (requiresRecovery(error)) { io.saveInterrupted(claimed, result); throw error; }
  }
  // All known child groups must be empty before freeing orchestration ownership.
  try {
    if (!cleanupConfirmed) {
      if (claimed.runId !== null) throw recovery('Coding controller did not confirm final cleanup while holding its lease');
      io.cleanup(claimed);
    }
  }
  catch { io.saveInterrupted(claimed, result); throw recovery('Scheduled cleanup requires administrator recovery'); }
  const receipt = { version: 1, approvalSha256: approvedSha256, finishedAt: io.clock().now.toISOString(), ...result };
  io.finish(claimed, receipt);
  return receipt;
}

export interface VerifiedEvidenceInput {
  readonly run: unknown;
  readonly spec: CodingSpec;
  readonly approval: Readonly<ScheduleApproval>;
  readonly approvedSha256: string;
  readonly bytes: unknown;
  readonly observations: unknown;
  readonly verification: unknown;
  readonly files: Record<string, string>;
  readonly policy: unknown;
  readonly baselinePackage: unknown;
}

export function assertVerifiedEvidence({
  run, spec, approval, approvedSha256, bytes, observations,
  verification, files, policy, baselinePackage,
}: VerifiedEvidenceInput): Buffer {
  if (!isRecord(run) || run.status !== 'verified' || !isId(run.id) || run.scheduleApprovalSha256 !== approvedSha256
      || run.specSha256 !== approval.scopeSha256 || run.issue !== spec.issue.number || run.baseSha !== spec.baseSha
      || run.planSha256 !== sha256(JSON.stringify(spec.plan)) || run.acceptanceSha256 !== sha256(JSON.stringify(spec.acceptanceCases))
      || !Buffer.isBuffer(bytes) || (typeof verification !== 'string' && !Buffer.isBuffer(verification))
      || run.publicationSha256 !== sha256(bytes) || run.verificationSha256 !== sha256(verification)
      || run.observationsSha256 !== sha256(JSON.stringify(observations))
      || !isRecord(run.verifierExecution) || run.verifierExecution.exitCode !== 0 || run.verifierExecution.signal !== null
      || run.verifierExecution.result !== 'success' || run.verifierExecution.execMainCode !== 1
      || typeof run.verifierExecution.invocationId !== 'string'
      || !/^[a-f0-9]{32}$/.test(run.verifierExecution.invocationId)) {
    throw new Error('Scheduled verified ledger bindings changed');
  }
  if (!Array.isArray(observations) || observations.length !== spec.acceptanceCases.length) throw new Error('Scheduled acceptance evidence is incomplete');
  observations.forEach((observation, index) => {
    const acceptance = spec.acceptanceCases[index];
    if (!acceptance || !isRecord(observation) || observation.name !== acceptance.name || observation.mode !== acceptance.mode
        || typeof observation.invocationId !== 'string' || !/^[a-f0-9]{32}$/.test(observation.invocationId)
        || observation.execMainCode !== 1 || typeof observation.result !== 'string'
        || !['success', 'exit-code'].includes(observation.result)) throw new Error('Scheduled acceptance evidence identity changed');
    assertCodingObservation(acceptance, observation, spec.paths);
  });
  const proposal = approvePackage(bytes, sha256(bytes)).proposal;
  if (spec.paths.some((file) => typeof files[file] !== 'string')) {
    throw new Error('Scheduled publication contains unapproved bytes or manifest changes');
  }
  const expected = prepareCodingPackage(spec, { summary: 'Verified scheduled profile addition.', questions: [],
    files: spec.paths.map((file) => ({ path: file, content: files[file] })) }, policy, baselinePackage).proposal;
  if (proposal.repository !== expected.repository || proposal.issue !== expected.issue || proposal.baseSha !== expected.baseSha
      || proposal.issueUpdatedAt !== expected.issueUpdatedAt || proposal.issueSha256 !== expected.issueSha256
      || proposal.title !== expected.title || JSON.stringify(proposal.files) !== JSON.stringify(expected.files)) {
    throw new Error('Scheduled publication contains unapproved bytes or manifest changes');
  }
  const verificationText = typeof verification === 'string' ? verification : verification.toString('utf8');
  const lines: unknown[] = verificationText.trim().split('\n').map((line) => { try { return JSON.parse(line); } catch { return null; } });
  const first = lines[0];
  const second = lines[1];
  const final = lines.at(-1);
  if (lines.length !== 3 || !isRecord(first) || first.command !== 'node' || first.exitCode !== 0
      || JSON.stringify(first.args) !== JSON.stringify(['scripts/validate-policy.ts', '--changed-files', ...expected.files.map((file) => file.path)])
      || !isRecord(second) || second.command !== 'npm' || second.exitCode !== 0 || JSON.stringify(second.args) !== '["test"]'
      || !isRecord(final) || final.status !== 'supplemental-checks-passed' || final.acceptanceSha256 !== run.acceptanceSha256
      || JSON.stringify(final.paths) !== JSON.stringify(expected.files.map((file) => file.path))) {
    throw new Error('Scheduled verifier evidence changed');
  }
  return bytes;
}

function protectedDirectory(directory: string, privateMode = false): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & (privateMode ? 0o077 : 0o022))) throw new Error('Scheduled state directory is not protected');
}

export function assertRecordedUnit(
  active: unknown,
  unit: unknown,
  candidateTarget: (id: string) => string = (id) => {
  const directory = `${root}/cases/${id}`; protectedDirectory(directory);
  const filename = `${directory}/candidate`; const stat = fs.lstatSync(filename);
  if (!stat.isSymbolicLink() || stat.uid !== 0) throw new Error('Unprotected recorded candidate link');
  return fs.readlinkSync(filename);
  },
): void {
  if (!isRecord(active) || typeof unit !== 'string') throw new Error('Recorded unit lacks a coding run');
  if (!isId(active.runId)) throw new Error('Recorded unit lacks a coding run');
  if (unit === `bim-forge-code-generate@${active.runId}.service`
      || unit === `bim-forge-code-verify@${active.runId}.service`) return;
  if (isSha(active.publicationSha256) && unit === `bim-forge-scheduled-publish@${active.publicationSha256}.service`) return;
  const match = /^bim-forge-code-case@([a-f0-9-]{36})\.service$/.exec(unit);
  if (!match || !isId(match[1]) || candidateTarget(match[1]) !== `${root}/jobs/${active.runId}/candidate`) throw new Error('Recorded unit is not owned by this dispatch');
}

function readActive(): ActiveDispatch {
  protectedDirectory(root); protectedDirectory(scheduleRoot, true);
  const active = protectedJson(`${scheduleRoot}/active.json`, 64 * 1024);
  if (!isRecord(active) || active.version !== 1 || !isId(active.id) || !isSha(active.approvalSha256) || !isSha(active.scopeSha256)
      || !(active.runId === null || isId(active.runId)) || !(active.publicationSha256 === null || isSha(active.publicationSha256))
      || !(active.invocationId === null || (typeof active.invocationId === 'string' && /^[a-f0-9]{32}$/.test(active.invocationId)))
      || !isId(active.bootId) || !isRecord(active) || typeof active.startedNs !== 'string' || typeof active.deadlineNs !== 'string'
      || !Array.isArray(active.units) || !active.units.every((unit) => typeof unit === 'string')
      || active.units.length > 66 || new Set(active.units).size !== active.units.length) {
    throw recovery('Corrupt dispatch record; recovery required');
  }
  return {
    ...active,
    version: 1,
    id: active.id,
    approvalSha256: active.approvalSha256,
    scopeSha256: active.scopeSha256,
    invocationId: active.invocationId,
    bootId: active.bootId,
    startedNs: active.startedNs,
    deadlineNs: active.deadlineNs,
    runId: active.runId,
    units: active.units,
    publicationSha256: active.publicationSha256,
  };
}

function cleanup(active: ActiveDispatch): void {
  for (const unit of active.units) {
    assertRecordedUnit(active, unit);
    command('/usr/bin/systemctl', ['stop', unit]);
    if (command('/usr/bin/systemctl', ['show', unit, '-p', 'ControlGroup', '--value']).trim()) throw recovery('Recorded unit cleanup could not be confirmed');
  }
}

function createIo(signal: AbortSignal): ScheduleIo {
  const assertState = () => { protectedDirectory(root); protectedDirectory(scheduleRoot, true); protectedDirectory(approvals); };
  const saveActive = (active: ActiveDispatch): void => {
    assertState();
    const stored = readActive();
    if (stored.id !== active.id) throw recovery('Dispatch ownership changed');
    saveCodingJson(`${scheduleRoot}/active.json`, active);
  };
  return {
    clock,
    activation() { protectedDirectory(approvals); return exists(`${approvals}/SCHEDULED`) ? readProtectedCodingFile(`${approvals}/SCHEDULED`, 0, 4096) : null; },
    assertNoActive() { assertState(); if (exists(`${scheduleRoot}/active.json`)) throw recovery('Scheduled dispatch is busy or interrupted; manual recovery required'); },
    receipt(digest) {
      const filename = `${scheduleRoot}/result-${digest}.json`;
      if (!exists(filename)) return null;
      const value = protectedJson(filename, 64 * 1024);
      if (!isRecord(value) || value.version !== 1 || value.approvalSha256 !== digest
          || typeof value.status !== 'string' || !['published', 'stopped', 'recovery-required'].includes(value.status)) {
        throw recovery('Corrupt dispatch receipt');
      }
      return { ...value, status: value.status };
    },
    approval: (digest) => readProtectedCodingFile(`${scheduleRoot}/approval-${digest}.json`, 0, 16384),
    scope: (digest) => readProtectedCodingFile(`${scheduleRoot}/scope-${digest}.json`),
    measure: () => measureDeployment().sha256,
    assertUnit: assertUnitDeployment,
    assertUnpaused() { signal.throwIfAborted(); if (exists(`${root}/PAUSED`) || exists(`${approvals}/PAUSED`)) throw new Error('Scheduled work is locally paused'); },
    assertResources() {
      const space = fs.statfsSync(root);
      if (os.freemem() < 3 * 1024 ** 3 || Number(space.bavail) * Number(space.bsize) < 8 * 1024 ** 3) throw new Error('Scheduled VM headroom is insufficient');
      if (exists(`${root}/ledger/coding.lock`) || exists('/var/lib/bim-forge-publisher/publisher.lock')) throw recovery('A shared factory lease is busy or interrupted');
    },
    pathsAbsent(spec) {
      const inventory = git('ls-tree', '-r', '--name-only', spec.baseSha).trim().split('\n').map((file) => file.toLowerCase());
      return spec.paths.every((file) => !inventory.includes(file.toLowerCase()));
    },
    invocationId() { const value = process.env.INVOCATION_ID ?? null; if (value !== null && !/^[a-f0-9]{32}$/.test(value)) throw new Error('Invalid scheduler invocation'); return value; },
    claim(active) {
      assertState();
      const fd = fs.openSync(`${scheduleRoot}/active.json`, 'wx', 0o600);
      try { fs.writeFileSync(fd, `${JSON.stringify(active)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const directory = fs.openSync(scheduleRoot, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      return active;
    },
    saveActive,
    recordUnit(active, unit) { assertRecordedUnit(active, unit); if (!active.units.includes(unit)) { active.units.push(unit); saveActive(active); } },
    code: (spec, bytes, options) => runCodingJob(`${scheduleRoot}/scope-${sha256(bytes)}.json`, false, signal, options),
    verifiedPackage(run, spec, approval, approvedSha256) {
      const job = `${root}/jobs/${run.id}`;
      protectedDirectory(`${root}/ledger`, true); protectedDirectory(`${root}/jobs`); protectedDirectory(job);
      protectedDirectory(`${job}/candidate`); protectedDirectory(`${job}/candidate/factory`);
      for (const directory of new Set(spec.paths.map((file) => path.dirname(file)))) {
        protectedDirectory(`${job}/candidate/${directory}`);
      }
      const recorded = protectedJson(`${root}/ledger/${run.id}.json`, 256 * 1024);
      const scope = readProtectedCodingFile(`${job}/spec.json`);
      if (!isRecord(recorded) || sha256(scope) !== approval.scopeSha256 || recorded.id !== run.id
          || recorded.publicationPath !== `${job}/publication.json`) throw new Error('Scheduled verified job identity changed');
      const files = Object.fromEntries([...spec.paths, 'package.json'].map((file) => [file, readProtectedCodingFile(`${job}/candidate/${file}`).toString('utf8')]));
      const bytes = readProtectedCodingFile(`${job}/publication.json`, 0, 512 * 1024);
      const checked = assertVerifiedEvidence({ run: recorded, spec, approval, approvedSha256, bytes,
        observations: protectedJson(`${job}/observations.json`, 512 * 1024), verification: readProtectedCodingFile(`${job}/verification.log`, 0, 2 * 1024 * 1024),
        files, policy: JSON.parse(git('show', `${spec.baseSha}:policy/gate.json`)), baselinePackage: git('show', `${spec.baseSha}:package.json`) });
      const proposal = approvePackage(bytes, sha256(bytes)).proposal;
      if (proposal.files.some((file) => file.content !== files[file.path])) throw new Error('Scheduled candidate bytes changed after verification');
      return checked;
    },
    stage(digest, bytes, permit) {
      protectedDirectory(approvals); protectedDirectory(`${approvals}/scheduled`);
      const gid = Number(command('/usr/bin/id', ['-g', 'bimforge-github']).trim());
      if (!Number.isSafeInteger(gid) || gid < 1) throw new Error('Scheduled publisher group is unknown');
      const stagedFiles: [string, Buffer][] = [['json', bytes], ['permit.json', permit]];
      for (const [suffix, content] of stagedFiles) {
        const fd = fs.openSync(`${approvals}/scheduled/${digest}.${suffix}`, 'wx', 0o640);
        try { fs.fchownSync(fd, 0, gid); fs.fchmodSync(fd, 0o640); fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
      const directory = fs.openSync(`${approvals}/scheduled`, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    },
    async publish(digest, spec, guard) {
      const unit = `bim-forge-scheduled-publish@${digest}.service`;
      const execution = await runUnit(unit, spec, signal, { guard });
      if (!/^[a-f0-9]{32}$/.test(execution.invocationId ?? '')) throw new Error('Scheduled publisher invocation is unknown');
      const lines = command('/usr/bin/journalctl', [`_SYSTEMD_INVOCATION_ID=${execution.invocationId}`, '--no-pager', '-o', 'cat'], 128 * 1024).trim().split('\n');
      const result: unknown = JSON.parse(lines.at(-1) ?? 'null');
      if (!isRecord(result) || result.status !== 'published' || result.tokenRevoked !== true || result.digest !== digest
          || typeof result.pullRequestUrl !== 'string'
          || !/^https:\/\/github\.com\/Frederik91\/bim-forge\/pull\/[1-9]\d*$/.test(result.pullRequestUrl)) {
        throw new Error('Scheduled draft publication is unconfirmed');
      }
      return result;
    },
    cleanup,
    saveInterrupted(active, result) { saveActive({ ...active, recoveryRequired: true, lastOutcome: result }); },
    finish(active, receipt) {
      const stored = readActive(); if (stored.id !== active.id) throw recovery('Dispatch ownership changed');
      const filename = `${scheduleRoot}/result-${active.approvalSha256}.json`;
      if (exists(filename)) throw recovery('Dispatch outcome already exists');
      saveCodingJson(filename, receipt);
      fs.unlinkSync(`${scheduleRoot}/active.json`);
      const directory = fs.openSync(scheduleRoot, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    },
  };
}

async function main(): Promise<void> {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function' || process.getuid() !== 0 || process.argv.length !== 3
      || !['--once', '--cleanup', '--measure'].includes(process.argv[2])) throw new Error('Use one fixed administrator scheduler operation on Linux');
  if (process.argv[2] === '--measure') return console.log(JSON.stringify(measureDeployment()));
  if (process.argv[2] === '--cleanup') {
    if (!exists(`${scheduleRoot}/active.json`)) return;
    const active = readActive();
    if (process.env.INVOCATION_ID && process.env.INVOCATION_ID !== active.invocationId) throw recovery('Cleanup invocation does not own this dispatch');
    cleanup(active);
    // Cleanup NEVER removes stale dispatch/coding/publisher leases or resumes work.
    saveCodingJson(`${scheduleRoot}/active.json`, { ...active, recoveryRequired: true });
    return console.log(JSON.stringify({ status: 'recovery-required', id: active.id, cleanup: 'groups-empty' }));
  }
  const controller = new AbortController(); const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = await dispatchOnce(createIo(controller.signal));
    console.log(JSON.stringify(result));
    if (['stopped', 'recovery-required'].includes(result.status)) process.exitCode = 1;
  }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ status: requiresRecovery(error) ? 'recovery-required' : 'stopped', message: errorMessage(error) }));
    process.exitCode = 1;
  });
}
