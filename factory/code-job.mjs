import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { readCodingSpec, prepareCodingPackage, materializeCodingFiles, sha256, codingProfile } from './coding.mjs';
import { readProtectedCodingFile, openCodingRun, saveCodingJson } from './coding-store.mjs';
import { issueFingerprint, approvePackage } from './publish-request.mjs';
import { generateCodingAnswer } from './code-generate.mjs';
import { verifyCodingCandidate } from './code-verify.mjs';
import { codingSchema } from './coding.mjs';
import { randomUUID } from 'node:crypto';
import { assertCodingObservation } from './code-acceptance.mjs';
import { renderChangeReview } from './change-review.ts';

const root = '/var/lib/bim-forge-coding';
const source = '/opt/bim-forge/coding-source';
const git = (...args) => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-C', source, ...args],
  { encoding: 'utf8', timeout: 15000, env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, maxBuffer: 2 * 1024 * 1024 });
const api = async (endpoint) => {
  const response = await fetch(`https://api.github.com/repos/Frederik91/bim-forge/${endpoint}`, {
    redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'bim-forge-manual-coder' },
  });
  if (!response.ok) throw new Error(`Coding intake failed: HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 128 * 1024) throw new Error('Coding intake exceeded its limit');
  return JSON.parse(text);
};

let remoteCheckedAt = 0;
async function gates(spec, fresh = true) {
  if (fs.existsSync(path.join(root, 'PAUSED'))) throw new Error('Coding is locally paused');
  if (!fresh && Date.now() - remoteCheckedAt < 30000) return;
  const main = await api('git/ref/heads/main');
  const issue = await api(`issues/${spec.issue.number}`);
  const paused = await api('issues?state=open&labels=loop-pause-all&per_page=1');
  if (main?.object?.sha !== spec.baseSha || issue.state !== 'open' || issue.pull_request
      || issue.updated_at !== spec.issue.updated_at || issueFingerprint(issue) !== issueFingerprint(spec.issue)
      || !Array.isArray(paused) || paused.length) throw new Error('Coding source, issue or pause gate changed');
  const flags = [...git('show', `${spec.baseSha}:STATE.md`).matchAll(/^paused:\s*(true|false)\s*$/gm)];
  if (flags.length !== 1 || flags[0][1] !== 'false') throw new Error('Coding repository state is paused or unknown');
  if (fs.existsSync(path.join(root, 'PAUSED'))) throw new Error('Coding was locally paused during gate checks');
  remoteCheckedAt = Date.now();
}

const recoveryError = (message) => Object.assign(new Error(message), { requiresRecovery: true });

export function createCodingInput(filename, content) {
  if (content === undefined) fs.mkdirSync(filename, { mode: 0o755 });
  else fs.writeFileSync(filename, content, { mode: 0o644, flag: 'wx' });
  fs.chmodSync(filename, content === undefined ? 0o755 : 0o644);
}

export function exposeCodingCandidate(directory) {
  const visit = (filename) => {
    const stat = fs.lstatSync(filename);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      fs.chmodSync(filename, 0o755);
      for (const name of fs.readdirSync(filename)) visit(path.join(filename, name));
    } else if (stat.isFile() && stat.nlink === 1) fs.chmodSync(filename, 0o644);
    else throw new Error('Unsupported candidate entry');
  };
  visit(directory);
}

export async function stageWithEvidence(execute, collect) {
  let failure; let value;
  try { value = await execute(); } catch (error) { failure = error; }
  try { await collect(); } catch (error) { if (!failure) throw error; }
  if (failure) throw failure;
  return value;
}

export function collectVerifierEvidence(unit, execution, journal = (args) => execFileSync('/usr/bin/journalctl', args,
  { timeout: 10000, maxBuffer: 2 * 1024 * 1024 })) {
  if (!/^bim-forge-code-verify@[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.service$/.test(unit)
      || !/^[a-f0-9]{32}$/.test(execution?.invocationId ?? '')) throw new Error('Verifier journal identity is unknown');
  const verification = journal([`_SYSTEMD_INVOCATION_ID=${execution.invocationId}`, `_SYSTEMD_UNIT=${unit}`,
    '_TRANSPORT=stdout', '--no-pager', '-o', 'cat']);
  const diagnostic = journal(['-u', unit, '--no-pager', '-o', 'cat']);
  return { verification, diagnostic };
}

export async function runUnit(unit, spec, signal, { fresh = true, allowNonzero = false, guard = async () => {} } = {}) {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Unit supervision requires the VM administrator');
  if (signal.aborted) throw new Error('Coding cancelled by operator');
  await guard({ unit });
  await gates(spec, fresh);
  await guard({ unit });
  signal.throwIfAborted();
  let exited = false; let failure; let pendingGuard; let pendingRemote; let lastRemote = Date.now();
  const stop = () => {
    execFileSync('/usr/bin/systemctl', ['stop', unit], { timeout: 15000, stdio: 'ignore' });
  };
  const execution = new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/systemctl', ['start', unit], { stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } });
    child.once('error', reject);
    child.once('close', (code) => { exited = true; if (failure || (code !== 0 && !allowNonzero)) reject(failure ?? new Error(`Coding service failed: ${unit}`)); else resolve(); });
  });
  const failedCheck = (error) => { if (failure?.requiresRecovery) return; failure = error; try { stop(); } catch { failure = recoveryError('Coding service cleanup failed'); } };
  const poll = setInterval(() => {
    if (exited) return;
    // Slow remote reads cannot suppress the local expiry/stop guard.
    if (!pendingGuard) pendingGuard = (async () => {
      try {
        signal.throwIfAborted();
        if (fs.existsSync(path.join(root, 'PAUSED'))) throw new Error('Coding is locally paused');
        await guard();
      } catch (error) { failedCheck(error); }
      finally { pendingGuard = null; }
    })();
    if (!pendingRemote && Date.now() - lastRemote > 30000) pendingRemote = (async () => {
      try { await gates(spec, true); lastRemote = Date.now(); }
      catch (error) { failedCheck(error); }
      finally { pendingRemote = null; }
    })();
  }, 500);
  const timer = setTimeout(() => failedCheck(new Error('Coding service time budget exceeded')), 660000);
  let observed;
  const observe = () => {
    const state = Object.fromEntries(execFileSync('/usr/bin/systemctl', ['show', unit, '-p', 'Result', '-p', 'ExecMainStatus', '-p', 'ExecMainCode', '-p', 'InvocationID'],
      { encoding: 'utf8' }).trim().split('\n').map((line) => line.split('=')));
    return { exitCode: state.ExecMainCode === '1' ? Number(state.ExecMainStatus) : null,
      signal: ['2', '3'].includes(state.ExecMainCode) ? Number(state.ExecMainStatus) : null,
      execMainCode: Number(state.ExecMainCode), result: state.Result, invocationId: state.InvocationID };
  };
  try {
    await execution;
    await Promise.all([pendingGuard, pendingRemote]);
    if (failure) throw failure;
    observed = observe();
    if (observed.execMainCode !== 1 || !['success', ...(allowNonzero ? ['exit-code'] : [])].includes(observed.result)
        || (!allowNonzero && observed.exitCode !== 0)) throw new Error('Coding service did not exit normally');
    await gates(spec, fresh);
    await guard();
    signal.throwIfAborted();
    return observed;
  } catch (error) {
    try { observed ??= observe(); error.execution = observed; }
    catch { observed = { exitCode: null, signal: null, result: 'unobserved' }; error.execution = observed; }
    throw error;
  } finally {
    clearInterval(poll); clearTimeout(timer);
    await Promise.all([pendingGuard, pendingRemote]);
    try {
      stop();
      const group = execFileSync('/usr/bin/systemctl', ['show', unit, '-p', 'ControlGroup', '--value'], { encoding: 'utf8', timeout: 10000 }).trim();
      if (group) throw new Error('Control group remains');
    } catch { throw Object.assign(recoveryError('Coding service cleanup requires administrator recovery'), { execution: observed }); }
  }
}

export async function runCodingJob(filename, retry, signal, { schedule, guard, onAdmitted = async () => {}, onVerified, onCleanup } = {}) {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Coding dispatch requires the VM administrator');
  if (schedule && (retry || typeof guard !== 'function' || typeof onVerified !== 'function' || typeof onCleanup !== 'function')) {
    throw new Error('Scheduled coding requires a guarded completion handler and no retry');
  }
  guard ??= async () => {};
  onCleanup ??= async () => {};
  await guard();
  const bytes = readProtectedCodingFile(filename);
  const spec = readCodingSpec(bytes);
  const profile = codingProfile(spec.paths);
  await gates(spec);
  await guard(); signal.throwIfAborted();
  const store = openCodingRun({ root, bytes, retry, schedule });
  const run = store.run;
  let preserveLock = false;
  try {
    if (store.reused) return { ...run, reused: true };
    await onAdmitted(run);
    const job = path.join(root, 'jobs', run.id);
    createCodingInput(job);
    createCodingInput(path.join(job, 'spec.json'), bytes);
    createCodingInput(path.join(job, 'empty'));
    createCodingInput(path.join(job, 'schema.json'), JSON.stringify(codingSchema));
    const policyText = git('show', `${spec.baseSha}:policy/gate.json`);
    const policy = JSON.parse(policyText);
    if (policy.maxAttemptsPerIssue !== 3 || policy.autoMerge?.enabled !== false) throw new Error('Unsupported coding policy');
    const manifest = git('show', `${spec.baseSha}:package.json`);
    const inventory = git('ls-tree', '-r', '-l', '-z', spec.baseSha).split('\0').filter(Boolean);
    let sourceBytes = 0;
    for (const entry of inventory) {
      const match = /^(100644) blob [a-f0-9]{40}\s+(\d+)\t/.exec(entry);
      if (!match) throw new Error('Unsupported pinned source object');
      sourceBytes += Number(match[2]);
    }
    if (inventory.length > 512 || sourceBytes > 8 * 1024 * 1024) throw new Error('Pinned source exceeds coding limits');
    const context = Object.fromEntries(['README.md', 'AGENTS.md', 'package.json', 'policy/gate.json'].map((file) => [file, git('show', `${spec.baseSha}:${file}`)]));
    createCodingInput(path.join(job, 'context.json'), JSON.stringify(context));
    const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
    const runtimeInventory = fs.readdirSync(runtimeDirectory).filter((name) => name.endsWith('.mjs')).sort()
      .map((name) => [name, sha256(fs.readFileSync(path.join(runtimeDirectory, name)))]);
    store.record({ policySha256: sha256(policyText), workerSha256: sha256(JSON.stringify(runtimeInventory)),
      generatorUnitSha256: sha256(readProtectedCodingFile('/etc/systemd/system/bim-forge-code-generate@.service')),
      verifierUnitSha256: sha256(readProtectedCodingFile('/etc/systemd/system/bim-forge-code-verify@.service')),
      caseUnitSha256: sha256(readProtectedCodingFile('/etc/systemd/system/bim-forge-code-case@.service')),
      runtimeSha256: sha256(fs.readFileSync('/opt/bim-forge/node/bin/node')),
      generatorSha256: sha256(fs.readFileSync('/var/lib/bim-forge/tools/bin/codex')) });
    const output = `/var/lib/bim-forge/coding/${run.id}`;
    fs.mkdirSync(output, { mode: 0o700 }); fs.chownSync(output, 999, 988);
    let response;
    store.record({ phase: 'generation', activeUnit: `bim-forge-code-generate@${run.id}.service` });
    await stageWithEvidence(() => runUnit(`bim-forge-code-generate@${run.id}.service`, spec, signal, { guard }), () => {
      if (fs.existsSync(path.join(output, 'answer.json'))) {
        response = JSON.parse(readProtectedCodingFile(path.join(output, 'answer.json'), 999, 256 * 1024));
        store.record({ usage: response.usage, warnings: response.warnings, answerSha256: sha256(JSON.stringify(response)) });
      }
    });
    if (!response || response.usage.input_tokens + response.usage.output_tokens > 60000) throw new Error('Coding usage exceeds the supported budget');
    const prepared = prepareCodingPackage(spec, response.answer, policy, manifest);
    git('worktree', 'add', '--detach', path.join(job, 'candidate'), spec.baseSha);
    materializeCodingFiles(path.join(job, 'candidate'), prepared.proposal);
    exposeCodingCandidate(path.join(job, 'candidate'));
    createCodingInput(path.join(job, 'preliminary.json'), prepared.bytes);
    const observations = [];
    await gates(spec);
    for (const acceptance of spec.acceptanceCases) {
      const caseId = randomUUID();
      const caseDir = path.join(root, 'cases', caseId);
      createCodingInput(caseDir);
      fs.symlinkSync(path.join(job, 'candidate'), path.join(caseDir, 'candidate'));
      createCodingInput(path.join(caseDir, 'input'), acceptance.input);
      createCodingInput(path.join(caseDir, 'mode'), acceptance.mode);
      createCodingInput(path.join(caseDir, 'paths.json'), JSON.stringify(profile.paths));
      for (const name of ['stdout', 'stderr']) fs.writeFileSync(path.join(caseDir, name), '', { mode: 0o600, flag: 'wx' });
      const unit = `bim-forge-code-case@${caseId}.service`;
      store.record({ phase: 'acceptance', activeUnit: unit });
      let observation; let execution;
      await stageWithEvidence(async () => {
        try { execution = await runUnit(unit, spec, signal, { fresh: false, allowNonzero: true, guard }); }
        catch (error) { execution = error.execution; throw error; }
      }, () => {
        observation = { name: acceptance.name, mode: acceptance.mode, unit, ...execution,
          stdout: readProtectedCodingFile(path.join(caseDir, 'stdout'), 0, 128 * 1024).toString('utf8'),
          stderr: readProtectedCodingFile(path.join(caseDir, 'stderr'), 0, 128 * 1024).toString('utf8') };
        observations.push(observation);
        saveCodingJson(path.join(job, 'observations.json'), observations);
      });
      assertCodingObservation(acceptance, observation, profile.paths);
    }
    store.record({ phase: 'supplemental-checks', activeUnit: `bim-forge-code-verify@${run.id}.service` });
    let verification;
    let verifierExecution;
    await stageWithEvidence(async () => {
      try { verifierExecution = await runUnit(`bim-forge-code-verify@${run.id}.service`, spec, signal, { guard }); }
      catch (error) { verifierExecution = error.execution; throw error; }
    }, () => {
      const evidence = collectVerifierEvidence(`bim-forge-code-verify@${run.id}.service`, verifierExecution);
      verification = evidence.verification;
      fs.writeFileSync(path.join(job, 'verification.log'), verification, { mode: 0o600, flag: 'wx' });
      fs.writeFileSync(path.join(job, 'verification-journal.log'), evidence.diagnostic, { mode: 0o600, flag: 'wx' });
    });
    const proposal = prepared.proposal;
    proposal.body = renderChangeReview({
      outcome: spec.plan.outcome,
      why: spec.issue.title,
      profile: { ...profile, paths: proposal.files.map((file) => file.path) },
      observations,
      run: { ...run, issueSha256: proposal.issueSha256, verifierExecution },
      verificationSha256: sha256(verification),
    });
    const finalBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
    const digest = sha256(finalBytes);
    approvePackage(finalBytes, digest);
    await new Promise((resolve) => setImmediate(resolve));
    await gates(spec);
    await guard();
    if (signal.aborted) throw new Error('Coding cancelled before package acceptance');
    fs.writeFileSync(path.join(job, 'publication.json'), finalBytes, { mode: 0o600, flag: 'wx' });
    store.record({ status: 'verified', phase: 'awaiting-publication-approval', activeUnit: null,
      finishedAt: new Date().toISOString(), publicationSha256: digest,
      publicationPath: path.join(job, 'publication.json'), verificationSha256: sha256(verification),
      observationsSha256: sha256(JSON.stringify(observations)), verifierExecution });
    if (onVerified) {
      const publication = await onVerified(run);
      return { ...run, scheduledPublication: publication };
    }
    return run;
  } catch (error) {
    preserveLock = error.requiresRecovery === true;
    store.record({ status: preserveLock ? 'interrupted' : run.status === 'verified' ? 'verified' : 'failed',
      finishedAt: new Date().toISOString(), message: error.message,
      ...(preserveLock ? { phase: 'recovery-required' } : {}) });
    throw error;
  } finally {
    try { await onCleanup(); }
    catch {
      preserveLock = true;
      try { store.record({ status: 'interrupted', phase: 'recovery-required' }); } catch { /* Keep the lease even if recording fails. */ }
      throw recoveryError('Coding final cleanup requires administrator recovery');
    } finally { store.close({ preserveLock }); }
  }
}

async function main() {
  const { values } = parseArgs({ options: { spec: { type: 'string' }, retry: { type: 'boolean', default: false },
    generate: { type: 'string' }, verify: { type: 'string' } } });
  if (Number(Boolean(values.spec)) + Number(Boolean(values.generate)) + Number(Boolean(values.verify)) !== 1) throw new Error('Select one coding stage');
  if (values.generate) return generateCodingAnswer(values.generate);
  if (values.verify) return verifyCodingCandidate(values.verify);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { console.log(JSON.stringify(await runCodingJob(values.spec, values.retry, controller.signal))); }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(JSON.stringify({ status: 'stopped', message: error.message })); process.exitCode = 1; });
}
