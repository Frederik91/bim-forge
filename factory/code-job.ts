import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { readCodingSpec, prepareCodingPackage, materializeCodingFiles, sha256, codingScope, type CodingSpec } from './coding.ts';
import { readProtectedCodingFile, openCodingRun, saveCodingJson, type CodingRun } from './coding-store.ts';
import { issueFingerprint, approvePackage } from './publish-request.ts';
import { generateCodingAnswer } from './code-generate.ts';
import { verifyCodingCandidate } from './code-verify.ts';
import { codingSchema } from './coding.ts';
import { randomUUID } from 'node:crypto';
import { assertCodingObservation } from './code-acceptance.ts';
import { renderChangeReview } from './change-review.ts';

const root = '/var/lib/bim-forge-coding';
const source = '/opt/bim-forge/coding-source';
const git = (...args: string[]): string => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-C', source, ...args],
  { encoding: 'utf8', timeout: 15000, env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, maxBuffer: 2 * 1024 * 1024 });
const api = async (endpoint: string): Promise<unknown> => {
  const response = await fetch(`https://api.github.com/repos/Frederik91/bim-forge/${endpoint}`, {
    redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'bim-forge-manual-coder' },
  });
  if (!response.ok) throw new Error(`Coding intake failed: HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 128 * 1024) throw new Error('Coding intake exceeded its limit');
  return JSON.parse(text);
};

interface UnitExecution extends Record<string, unknown> {
  readonly exitCode: number | null;
  readonly signal: number | null;
  readonly result: string;
  readonly execMainCode?: number;
  readonly invocationId?: string;
}

interface UnitGuardContext {
  readonly unit: string;
}

type UnitGuard = (context?: UnitGuardContext) => Promise<void> | void;

interface RunUnitOptions {
  readonly fresh?: boolean;
  readonly allowNonzero?: boolean;
  readonly guard?: UnitGuard;
}

interface RunCodingJobOptions {
  readonly schedule?: unknown;
  readonly guard?: UnitGuard;
  readonly onAdmitted?: (run: CodingRun) => Promise<void> | void;
  readonly onVerified?: (run: CodingRun) => Promise<unknown> | unknown;
  readonly onCleanup?: () => Promise<void> | void;
}

interface GenerationResponse {
  readonly answer: unknown;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
  readonly warnings: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown coding failure';
}

function requiresRecovery(error: unknown): boolean {
  return isRecord(error) && error.requiresRecovery === true;
}

function executionOf(error: unknown): UnitExecution | undefined {
  return isRecord(error) && isUnitExecution(error.execution) ? error.execution : undefined;
}

function isUnitExecution(value: unknown): value is UnitExecution {
  return isRecord(value) && (typeof value.exitCode === 'number' || value.exitCode === null)
    && (typeof value.signal === 'number' || value.signal === null) && typeof value.result === 'string';
}

function parseGenerationResponse(value: unknown): GenerationResponse {
  if (!isRecord(value) || !isRecord(value.usage) || typeof value.usage.input_tokens !== 'number'
      || typeof value.usage.output_tokens !== 'number') {
    throw new Error('Coding usage exceeds the supported budget');
  }
  return {
    answer: value.answer,
    usage: { input_tokens: value.usage.input_tokens, output_tokens: value.usage.output_tokens },
    warnings: value.warnings,
  };
}

let remoteCheckedAt = 0;
async function gates(spec: CodingSpec, fresh = true): Promise<void> {
  if (fs.existsSync(path.join(root, 'PAUSED'))) throw new Error('Coding is locally paused');
  if (!fresh && Date.now() - remoteCheckedAt < 30000) return;
  const main = await api('git/ref/heads/main');
  const issue = await api(`issues/${spec.issue.number}`);
  const paused = await api('issues?state=open&labels=loop-pause-all&per_page=1');
  if (!isRecord(main) || !isRecord(main.object) || main.object.sha !== spec.baseSha
      || !isRecord(issue) || issue.state !== 'open' || issue.pull_request
      || issue.updated_at !== spec.issue.updated_at || typeof issue.number !== 'number'
      || typeof issue.title !== 'string' || typeof issue.body !== 'string'
      || issueFingerprint({ number: issue.number, title: issue.title, body: issue.body }) !== issueFingerprint(spec.issue)
      || !Array.isArray(paused) || paused.length) throw new Error('Coding source, issue or pause gate changed');
  const flags = [...git('show', `${spec.baseSha}:STATE.md`).matchAll(/^paused:\s*(true|false)\s*$/gm)];
  if (flags.length !== 1 || flags[0]?.[1] !== 'false') throw new Error('Coding repository state is paused or unknown');
  if (fs.existsSync(path.join(root, 'PAUSED'))) throw new Error('Coding was locally paused during gate checks');
  remoteCheckedAt = Date.now();
}

const recoveryError = (message: string): Error => Object.assign(new Error(message), { requiresRecovery: true });

export function createCodingInput(filename: string, content?: string | NodeJS.ArrayBufferView): void {
  if (content === undefined) fs.mkdirSync(filename, { mode: 0o755 });
  else fs.writeFileSync(filename, content, { mode: 0o644, flag: 'wx' });
  fs.chmodSync(filename, content === undefined ? 0o755 : 0o644);
}

export function exposeCodingCandidate(directory: string): void {
  const visit = (filename: string): void => {
    const stat = fs.lstatSync(filename);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      fs.chmodSync(filename, 0o755);
      for (const name of fs.readdirSync(filename)) visit(path.join(filename, name));
    } else if (stat.isFile() && stat.nlink === 1) fs.chmodSync(filename, 0o644);
    else throw new Error('Unsupported candidate entry');
  };
  visit(directory);
}

export async function stageWithEvidence<Result>(
  execute: () => Promise<Result> | Result,
  collect: () => Promise<void> | void,
): Promise<Result> {
  let failure: unknown;
  let outcome: { readonly value: Result } | undefined;
  try { outcome = { value: await execute() }; } catch (error) { failure = error; }
  try { await collect(); } catch (error) { if (!failure) throw error; }
  if (failure) throw failure;
  if (!outcome) throw new Error('Coding stage produced no result');
  return outcome.value;
}

export function collectVerifierEvidence(
  unit: string,
  execution: unknown,
  journal: (args: string[]) => string | Buffer = (args) => execFileSync('/usr/bin/journalctl', args,
    { timeout: 10000, maxBuffer: 2 * 1024 * 1024 }),
) {
  if (!/^bim-forge-code-verify@[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.service$/.test(unit)
      || !isRecord(execution) || typeof execution.invocationId !== 'string'
      || !/^[a-f0-9]{32}$/.test(execution.invocationId)) throw new Error('Verifier journal identity is unknown');
  const verification = journal([`_SYSTEMD_INVOCATION_ID=${execution.invocationId}`, `_SYSTEMD_UNIT=${unit}`,
    '_TRANSPORT=stdout', '--no-pager', '-o', 'cat']);
  const diagnostic = journal(['-u', unit, '--no-pager', '-o', 'cat']);
  return { verification, diagnostic };
}

export async function runUnit(
  unit: string,
  spec: CodingSpec,
  signal: AbortSignal,
  { fresh = true, allowNonzero = false, guard = async () => {} }: RunUnitOptions = {},
): Promise<UnitExecution> {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function' || process.getuid() !== 0) {
    throw new Error('Unit supervision requires the VM administrator');
  }
  if (signal.aborted) throw new Error('Coding cancelled by operator');
  await guard({ unit });
  await gates(spec, fresh);
  await guard({ unit });
  signal.throwIfAborted();
  let exited = false;
  let failure: unknown;
  let pendingGuard: Promise<void> | null = null;
  let pendingRemote: Promise<void> | null = null;
  let lastRemote = Date.now();
  const stop = (): void => {
    execFileSync('/usr/bin/systemctl', ['stop', unit], { timeout: 15000, stdio: 'ignore' });
  };
  const execution = new Promise<void>((resolve, reject) => {
    const child = spawn('/usr/bin/systemctl', ['start', unit], { stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } });
    child.once('error', reject);
    child.once('close', (code) => {
      exited = true;
      if (failure || (code !== 0 && !allowNonzero)) reject(failure ?? new Error(`Coding service failed: ${unit}`));
      else resolve();
    });
  });
  const failedCheck = (error: unknown): void => {
    if (requiresRecovery(failure)) return;
    failure = error;
    try { stop(); } catch { failure = recoveryError('Coding service cleanup failed'); }
  };
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
  let observed: UnitExecution | undefined;
  const observe = (): UnitExecution => {
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
    const caught = error instanceof Error ? error : new Error('Unknown coding service failure');
    try { observed ??= observe(); }
    catch { observed = { exitCode: null, signal: null, result: 'unobserved' }; }
    Object.defineProperty(caught, 'execution', { value: observed, enumerable: true });
    throw caught;
  } finally {
    clearInterval(poll); clearTimeout(timer);
    await Promise.all([pendingGuard, pendingRemote]);
    try {
      stop();
      const group = execFileSync('/usr/bin/systemctl', ['show', unit, '-p', 'ControlGroup', '--value'], { encoding: 'utf8', timeout: 10000 }).trim();
      if (group) throw new Error('Control group remains');
    } catch {
      const cleanupError = recoveryError('Coding service cleanup requires administrator recovery');
      Object.defineProperty(cleanupError, 'execution', { value: observed, enumerable: true });
      throw cleanupError;
    }
  }
}

export async function runCodingJob(
  filename: unknown,
  retry: unknown,
  signal: AbortSignal,
  options: RunCodingJobOptions = {},
): Promise<Record<string, unknown>> {
  if (typeof filename !== 'string' || typeof retry !== 'boolean') throw new Error('Coding dispatch requires a scope and retry flag');
  if (process.platform !== 'linux' || typeof process.getuid !== 'function' || process.getuid() !== 0) {
    throw new Error('Coding dispatch requires the VM administrator');
  }
  const { schedule, onAdmitted = async () => {}, onVerified } = options;
  const guard: UnitGuard = options.guard ?? (async () => {});
  const onCleanup = options.onCleanup ?? (async () => {});
  if (schedule && (retry || !options.guard || !onVerified || !options.onCleanup)) {
    throw new Error('Scheduled coding requires a guarded completion handler and no retry');
  }
  await guard();
  const bytes = readProtectedCodingFile(filename);
  const spec = readCodingSpec(bytes);
  const scope = codingScope(spec);
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
    const policy: unknown = JSON.parse(policyText);
    if (!isRecord(policy) || policy.maxAttemptsPerIssue !== 3
        || !isRecord(policy.autoMerge) || policy.autoMerge.enabled !== false) {
      throw new Error('Unsupported coding policy');
    }
    const manifest = git('show', `${spec.baseSha}:package.json`);
    const inventory = git('ls-tree', '-r', '-l', '-z', spec.baseSha).split('\0').filter(Boolean);
    let sourceBytes = 0;
    for (const entry of inventory) {
      const match = /^(100644) blob [a-f0-9]{40}\s+(\d+)\t/.exec(entry);
      if (!match) throw new Error('Unsupported pinned source object');
      sourceBytes += Number(match[2] ?? Number.NaN);
    }
    if (inventory.length > 512 || sourceBytes > 8 * 1024 * 1024) throw new Error('Pinned source exceeds coding limits');
    const pinnedPaths = new Set(git('ls-tree', '-r', '--name-only', spec.baseSha).split('\n').filter(Boolean));
    const approvedFiles = Object.fromEntries(spec.paths.map((file) => [
      file, pinnedPaths.has(file) ? git('show', `${spec.baseSha}:${file}`) : null,
    ]));
    const context = {
      repository: Object.fromEntries(['README.md', 'AGENTS.md', 'package.json', 'policy/gate.json']
        .map((file) => [file, git('show', `${spec.baseSha}:${file}`)])),
      approvedFiles,
    };
    createCodingInput(path.join(job, 'context.json'), JSON.stringify(context));
    const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
    const runtimeInventory = fs.readdirSync(runtimeDirectory).filter((name) => name.endsWith('.ts')).sort()
      .map((name) => [name, sha256(fs.readFileSync(path.join(runtimeDirectory, name)))]);
    store.record({ policySha256: sha256(policyText), workerSha256: sha256(JSON.stringify(runtimeInventory)),
      generatorUnitSha256: sha256(readProtectedCodingFile('/etc/systemd/system/bim-forge-code-generate@.service')),
      verifierUnitSha256: sha256(readProtectedCodingFile('/etc/systemd/system/bim-forge-code-verify@.service')),
      caseUnitSha256: sha256(readProtectedCodingFile('/etc/systemd/system/bim-forge-code-case@.service')),
      runtimeSha256: sha256(fs.readFileSync('/opt/bim-forge/node/bin/node')),
      generatorSha256: sha256(fs.readFileSync('/var/lib/bim-forge/tools/bin/codex')) });
    const output = `/var/lib/bim-forge/coding/${run.id}`;
    fs.mkdirSync(output, { mode: 0o700 }); fs.chownSync(output, 999, 988);
    let response: GenerationResponse | undefined;
    store.record({ phase: 'generation', activeUnit: `bim-forge-code-generate@${run.id}.service` });
    await stageWithEvidence(() => runUnit(`bim-forge-code-generate@${run.id}.service`, spec, signal, { guard }), () => {
      if (fs.existsSync(path.join(output, 'answer.json'))) {
        response = parseGenerationResponse(JSON.parse(readProtectedCodingFile(path.join(output, 'answer.json'), 999, 256 * 1024).toString('utf8')));
        store.record({ usage: response.usage, warnings: response.warnings, answerSha256: sha256(JSON.stringify(response)) });
      }
    });
    if (!response || response.usage.input_tokens + response.usage.output_tokens > 60000) throw new Error('Coding usage exceeds the supported budget');
    const prepared = prepareCodingPackage(spec, response.answer, policy, manifest);
    git('worktree', 'add', '--detach', path.join(job, 'candidate'), spec.baseSha);
    materializeCodingFiles(path.join(job, 'candidate'), prepared.proposal,
      scope.kind === 'repository-change' ? 'replace-approved' : 'additions-only');
    exposeCodingCandidate(path.join(job, 'candidate'));
    createCodingInput(path.join(job, 'preliminary.json'), prepared.bytes);
    const observations: Record<string, unknown>[] = [];
    await gates(spec);
    for (const acceptance of spec.acceptanceCases) {
      if (scope.kind !== 'fixed-contract') throw new Error('Repository changes cannot execute fixed-contract cases');
      const caseId = randomUUID();
      const caseDir = path.join(root, 'cases', caseId);
      createCodingInput(caseDir);
      fs.symlinkSync(path.join(job, 'candidate'), path.join(caseDir, 'candidate'));
      createCodingInput(path.join(caseDir, 'input'), acceptance.input);
      createCodingInput(path.join(caseDir, 'mode'), acceptance.mode);
      createCodingInput(path.join(caseDir, 'paths.json'), JSON.stringify(scope.profile.paths));
      for (const name of ['stdout', 'stderr']) fs.writeFileSync(path.join(caseDir, name), '', { mode: 0o600, flag: 'wx' });
      const unit = `bim-forge-code-case@${caseId}.service`;
      store.record({ phase: 'acceptance', activeUnit: unit });
      let observation: Record<string, unknown> | undefined;
      let execution: UnitExecution | undefined;
      await stageWithEvidence(async () => {
        try { execution = await runUnit(unit, spec, signal, { fresh: false, allowNonzero: true, guard }); }
        catch (error) { execution = executionOf(error); throw error; }
      }, () => {
        observation = { name: acceptance.name, mode: acceptance.mode, unit, ...(execution ?? {}),
          stdout: readProtectedCodingFile(path.join(caseDir, 'stdout'), 0, 128 * 1024).toString('utf8'),
          stderr: readProtectedCodingFile(path.join(caseDir, 'stderr'), 0, 128 * 1024).toString('utf8') };
        observations.push(observation);
        saveCodingJson(path.join(job, 'observations.json'), observations);
      });
      assertCodingObservation(acceptance, observation, scope.profile.paths);
    }
    store.record({ phase: 'supplemental-checks', activeUnit: `bim-forge-code-verify@${run.id}.service` });
    let verification: string | Buffer | undefined;
    let verifierExecution: UnitExecution | undefined;
    await stageWithEvidence(async () => {
      try { verifierExecution = await runUnit(`bim-forge-code-verify@${run.id}.service`, spec, signal, { guard }); }
      catch (error) { verifierExecution = executionOf(error); throw error; }
    }, () => {
      const evidence = collectVerifierEvidence(`bim-forge-code-verify@${run.id}.service`, verifierExecution);
      verification = evidence.verification;
      fs.writeFileSync(path.join(job, 'verification.log'), verification, { mode: 0o600, flag: 'wx' });
      fs.writeFileSync(path.join(job, 'verification-journal.log'), evidence.diagnostic, { mode: 0o600, flag: 'wx' });
    });
    if (verification === undefined) throw new Error('Fixed coding verification produced no evidence');
    const proposal = prepared.proposal;
    proposal.body = renderChangeReview({
      outcome: spec.plan.outcome,
      why: spec.issue.title,
      profile: { ...(scope.kind === 'fixed-contract' ? scope.profile : scope), paths: proposal.files.map((file) => file.path) },
      observations,
      run: { ...run, issueSha256: proposal.issueSha256, verifierExecution },
      verificationSha256: sha256(verification),
    });
    const finalBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
    const digest = sha256(finalBytes);
    approvePackage(finalBytes, digest);
    await new Promise<void>((resolve) => setImmediate(resolve));
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
    preserveLock = requiresRecovery(error);
    if (!store.reused) {
      store.record({ status: preserveLock ? 'interrupted' : run.status === 'verified' ? 'verified' : 'failed',
        finishedAt: new Date().toISOString(), message: messageOf(error),
        ...(preserveLock ? { phase: 'recovery-required' } : {}) });
    }
    throw error;
  } finally {
    try { await onCleanup(); }
    catch {
      preserveLock = true;
      try { if (!store.reused) store.record({ status: 'interrupted', phase: 'recovery-required' }); }
      catch { /* Keep the lease even if recording fails. */ }
      throw recoveryError('Coding final cleanup requires administrator recovery');
    } finally { store.close({ preserveLock }); }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { spec: { type: 'string' }, retry: { type: 'boolean', default: false },
    generate: { type: 'string' }, verify: { type: 'string' } } });
  if (Number(Boolean(values.spec)) + Number(Boolean(values.generate)) + Number(Boolean(values.verify)) !== 1) throw new Error('Select one coding stage');
  if (values.generate) { await generateCodingAnswer(values.generate); return; }
  if (values.verify) { verifyCodingCandidate(values.verify); return; }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { console.log(JSON.stringify(await runCodingJob(values.spec, values.retry, controller.signal))); }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ status: 'stopped', message: messageOf(error) }));
    process.exitCode = 1;
  });
}
