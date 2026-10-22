import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCodingSpec, prepareCodingPackage, sha256 } from './coding.mjs';
import { readProtectedCodingFile, saveCodingJson } from './coding-store.mjs';
import { parseScheduleApproval } from './schedule-approval.mjs';
import { parseActivation, createScheduledPermit } from './scheduled-publication.mjs';
import { measureDeployment, assertUnitDeployment } from './coding-identity.mjs';
import { runCodingJob, runUnit } from './code-job.mjs';
import { assertCodingObservation } from './code-acceptance.mjs';
import { approvePackage } from './publish-request.mjs';

const root = '/var/lib/bim-forge-coding';
const approvals = '/var/lib/bim-forge-approvals';
const scheduleRoot = `${root}/schedule`;
const durationNs = 1200000000000n;
const isId = (value) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const isSha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exists = (file) => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const recovery = (message) => Object.assign(new Error(message), { requiresRecovery: true });
const clock = () => ({ now: new Date(), monotonicNs: process.hrtime.bigint(),
  bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() });
const command = (file, args, maximum = 2 * 1024 * 1024) => execFileSync(file, args, {
  encoding: 'utf8', timeout: 15000, maxBuffer: maximum,
  env: { PATH: '/usr/bin:/bin', LANG: 'C', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
});
const git = (...args) => command('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-C', '/opt/bim-forge/coding-source', ...args]);
const protectedJson = (file, maximum) => JSON.parse(readProtectedCodingFile(file, 0, maximum));

// The I/O seam lets tests exercise real scheduling decisions without credentials,
// root, system services, network, model calls, or candidate code execution.
export async function dispatchOnce(io) {
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
  let active;
  let cleanupConfirmed = false;
  const guard = async ({ unit, measure = false } = {}) => {
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
  active = io.claim({ version: 1, id: randomUUID(), approvalSha256: approvedSha256,
    scopeSha256: approval.scopeSha256, invocationId: io.invocationId(), bootId: started.bootId,
    startedNs: String(started.monotonicNs), deadlineNs: String(deadlineNs), runId: null, units: [], publicationSha256: null });
  let result;
  try {
    const run = await io.code(spec, scopeBytes, { schedule: { approvalBytes, approvedSha256, deploymentSha256: approval.deploymentSha256 },
      guard,
      onAdmitted: async (run) => { active.runId = run.id; io.saveActive(active); },
      onCleanup: async () => {
        try { io.cleanup(active); cleanupConfirmed = true; }
        catch { throw recovery('Scheduled cleanup requires administrator recovery'); }
      },
      onVerified: async (run) => {
        await guard({ measure: true });
        const bytes = io.verifiedPackage(run, spec, approval, approvedSha256);
        const publicationSha256 = sha256(bytes);
        const permit = createScheduledPermit({ publicationSha256, approvalBytes, approvedSha256,
          activationBytes, runId: run.id, bootId: started.bootId,
          startedNs: String(started.monotonicNs), deadlineNs: String(deadlineNs) }, io.clock());
        active.publicationSha256 = publicationSha256; io.saveActive(active);
        await guard();
        io.stage(publicationSha256, bytes, permit);
        await guard({ measure: true });
        return io.publish(publicationSha256, spec, guard);
      },
    });
    if (run.reused) result = { status: 'recovery-required', reason: 'coding-run-already-recorded', runId: run.id };
    else {
      const publication = run.scheduledPublication;
      if (publication?.status !== 'published' || publication.tokenRevoked !== true
          || publication.digest !== active.publicationSha256) throw new Error('Scheduled publication outcome is unknown; reconcile manually');
      result = { status: 'published', runId: run.id, publication };
    }
  } catch (error) {
    result = { status: error.requiresRecovery ? 'recovery-required' : 'stopped', message: error.message,
      runId: active.runId, publicationSha256: active.publicationSha256 };
    if (error.requiresRecovery) { io.saveInterrupted(active, result); throw error; }
  }
  // All known child groups must be empty before freeing orchestration ownership.
  try {
    if (!cleanupConfirmed) {
      if (active.runId !== null) throw recovery('Coding controller did not confirm final cleanup while holding its lease');
      io.cleanup(active);
    }
  }
  catch { io.saveInterrupted(active, result); throw recovery('Scheduled cleanup requires administrator recovery'); }
  const receipt = { version: 1, approvalSha256: approvedSha256, finishedAt: io.clock().now.toISOString(), ...result };
  io.finish(active, receipt);
  return receipt;
}

export function assertVerifiedEvidence({ run, spec, approval, approvedSha256, bytes, observations,
  verification, files, policy, baselinePackage }) {
  if (run.status !== 'verified' || !isId(run.id) || run.scheduleApprovalSha256 !== approvedSha256
      || run.specSha256 !== approval.scopeSha256 || run.issue !== spec.issue.number || run.baseSha !== spec.baseSha
      || run.planSha256 !== sha256(JSON.stringify(spec.plan)) || run.acceptanceSha256 !== sha256(JSON.stringify(spec.acceptanceCases))
      || run.publicationSha256 !== sha256(bytes) || run.verificationSha256 !== sha256(verification)
      || run.observationsSha256 !== sha256(JSON.stringify(observations))
      || run.verifierExecution?.exitCode !== 0 || run.verifierExecution?.signal !== null
      || run.verifierExecution?.result !== 'success' || run.verifierExecution?.execMainCode !== 1
      || !/^[a-f0-9]{32}$/.test(run.verifierExecution?.invocationId ?? '')) throw new Error('Scheduled verified ledger bindings changed');
  if (!Array.isArray(observations) || observations.length !== spec.acceptanceCases.length) throw new Error('Scheduled acceptance evidence is incomplete');
  observations.forEach((observation, index) => {
    const acceptance = spec.acceptanceCases[index];
    if (observation.name !== acceptance.name || observation.mode !== acceptance.mode
        || !/^[a-f0-9]{32}$/.test(observation.invocationId ?? '')
        || observation.execMainCode !== 1 || !['success', 'exit-code'].includes(observation.result)) throw new Error('Scheduled acceptance evidence identity changed');
    assertCodingObservation(acceptance, observation, spec.paths);
  });
  const proposal = approvePackage(bytes, sha256(bytes)).proposal;
  const expected = prepareCodingPackage(spec, { summary: 'Verified scheduled profile addition.', questions: [],
    files: spec.paths.map((file) => ({ path: file, content: files[file] })) }, policy, baselinePackage).proposal;
  if (proposal.repository !== expected.repository || proposal.issue !== expected.issue || proposal.baseSha !== expected.baseSha
      || proposal.issueUpdatedAt !== expected.issueUpdatedAt || proposal.issueSha256 !== expected.issueSha256
      || proposal.title !== expected.title || JSON.stringify(proposal.files) !== JSON.stringify(expected.files)) {
    throw new Error('Scheduled publication contains unapproved bytes or manifest changes');
  }
  const lines = verification.toString('utf8').trim().split('\n').map((line) => { try { return JSON.parse(line); } catch { return null; } });
  const final = lines.at(-1);
  if (lines.length !== 3 || lines[0]?.command !== 'node' || lines[0]?.exitCode !== 0
      || JSON.stringify(lines[0]?.args) !== JSON.stringify(['scripts/validate-policy.mjs', '--changed-files', ...expected.files.map((file) => file.path)])
      || lines[1]?.command !== 'npm' || lines[1]?.exitCode !== 0 || JSON.stringify(lines[1]?.args) !== '["test"]'
      || final?.status !== 'supplemental-checks-passed' || final.acceptanceSha256 !== run.acceptanceSha256
      || JSON.stringify(final.paths) !== JSON.stringify(expected.files.map((file) => file.path))) throw new Error('Scheduled verifier evidence changed');
  return bytes;
}

function protectedDirectory(directory, privateMode = false) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & (privateMode ? 0o077 : 0o022))) throw new Error('Scheduled state directory is not protected');
}

export function assertRecordedUnit(active, unit, candidateTarget = (id) => {
  const directory = `${root}/cases/${id}`; protectedDirectory(directory);
  const filename = `${directory}/candidate`; const stat = fs.lstatSync(filename);
  if (!stat.isSymbolicLink() || stat.uid !== 0) throw new Error('Unprotected recorded candidate link');
  return fs.readlinkSync(filename);
}) {
  if (!isId(active.runId)) throw new Error('Recorded unit lacks a coding run');
  if (unit === `bim-forge-code-generate@${active.runId}.service`
      || unit === `bim-forge-code-verify@${active.runId}.service`) return;
  if (isSha(active.publicationSha256) && unit === `bim-forge-scheduled-publish@${active.publicationSha256}.service`) return;
  const match = /^bim-forge-code-case@([a-f0-9-]{36})\.service$/.exec(unit);
  if (!match || !isId(match[1]) || candidateTarget(match[1]) !== `${root}/jobs/${active.runId}/candidate`) throw new Error('Recorded unit is not owned by this dispatch');
}

function readActive() {
  protectedDirectory(root); protectedDirectory(scheduleRoot, true);
  const active = protectedJson(`${scheduleRoot}/active.json`, 64 * 1024);
  if (active.version !== 1 || !isId(active.id) || !isSha(active.approvalSha256) || !isSha(active.scopeSha256)
      || !(active.runId === null || isId(active.runId)) || !(active.publicationSha256 === null || isSha(active.publicationSha256))
      || !(active.invocationId === null || /^[a-f0-9]{32}$/.test(active.invocationId))
      || !Array.isArray(active.units) || active.units.length > 66 || new Set(active.units).size !== active.units.length) throw recovery('Corrupt dispatch record; recovery required');
  return active;
}

function cleanup(active) {
  for (const unit of active.units) {
    assertRecordedUnit(active, unit);
    command('/usr/bin/systemctl', ['stop', unit]);
    if (command('/usr/bin/systemctl', ['show', unit, '-p', 'ControlGroup', '--value']).trim()) throw recovery('Recorded unit cleanup could not be confirmed');
  }
}

function createIo(signal) {
  const assertState = () => { protectedDirectory(root); protectedDirectory(scheduleRoot, true); protectedDirectory(approvals); };
  const saveActive = (active) => { assertState(); const stored = readActive(); if (stored.id !== active.id) throw recovery('Dispatch ownership changed'); saveCodingJson(`${scheduleRoot}/active.json`, active); };
  return {
    clock,
    activation() { protectedDirectory(approvals); return exists(`${approvals}/SCHEDULED`) ? readProtectedCodingFile(`${approvals}/SCHEDULED`, 0, 4096) : null; },
    assertNoActive() { assertState(); if (exists(`${scheduleRoot}/active.json`)) throw recovery('Scheduled dispatch is busy or interrupted; manual recovery required'); },
    receipt(digest) {
      const filename = `${scheduleRoot}/result-${digest}.json`;
      if (!exists(filename)) return null;
      const value = protectedJson(filename, 64 * 1024);
      if (value.version !== 1 || value.approvalSha256 !== digest || !['published', 'stopped', 'recovery-required'].includes(value.status)) throw recovery('Corrupt dispatch receipt');
      return value;
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
      const recorded = protectedJson(`${root}/ledger/${run.id}.json`);
      const scope = readProtectedCodingFile(`${job}/spec.json`);
      if (sha256(scope) !== approval.scopeSha256 || recorded.id !== run.id
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
      for (const [suffix, content] of [['json', bytes], ['permit.json', permit]]) {
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
      const result = JSON.parse(lines.at(-1));
      if (result.status !== 'published' || result.tokenRevoked !== true || result.digest !== digest
          || !/^https:\/\/github\.com\/Frederik91\/bim-forge\/pull\/[1-9]\d*$/.test(result.pullRequestUrl ?? '')) throw new Error('Scheduled draft publication is unconfirmed');
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

async function main() {
  if (process.platform !== 'linux' || process.getuid() !== 0 || process.argv.length !== 3
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
  main().catch((error) => { console.error(JSON.stringify({ status: error.requiresRecovery ? 'recovery-required' : 'stopped', message: error.message })); process.exitCode = 1; });
}
