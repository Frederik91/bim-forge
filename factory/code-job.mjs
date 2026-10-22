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

const root = '/var/lib/bim-forge-coding';
const source = '/opt/bim-forge/coding-source';
const git = (...args) => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-C', source, ...args],
  { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, maxBuffer: 2 * 1024 * 1024 });
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

async function runUnit(unit, spec, signal, { fresh = true, allowNonzero = false } = {}) {
  if (signal.aborted) throw new Error('Coding cancelled by operator');
  await gates(spec, fresh);
  let exited = false; let failure; let checking = false; let lastRemote = Date.now();
  const stop = () => {
    execFileSync('/usr/bin/systemctl', ['stop', unit], { timeout: 15000, stdio: 'ignore' });
  };
  const execution = new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/systemctl', ['start', unit], { stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } });
    child.once('error', reject);
    child.once('close', (code) => { exited = true; if (failure || (code !== 0 && !allowNonzero)) reject(failure ?? new Error(`Coding service failed: ${unit}`)); else resolve(); });
  });
  const poll = setInterval(async () => {
    if (checking || exited) return;
    checking = true;
    try {
      if (signal.aborted) throw new Error('Coding cancelled by operator');
      const fresh = Date.now() - lastRemote > 30000;
      await gates(spec, fresh);
      if (fresh) lastRemote = Date.now();
    } catch (error) { failure = error; try { stop(); } catch { failure = new Error('Coding service cleanup failed'); } }
    finally { checking = false; }
  }, 500);
  const timer = setTimeout(() => { failure = new Error('Coding service time budget exceeded'); try { stop(); } catch { failure = new Error('Coding service cleanup failed'); } }, 660000);
  let observed;
  const observe = () => {
    const state = Object.fromEntries(execFileSync('/usr/bin/systemctl', ['show', unit, '-p', 'Result', '-p', 'ExecMainStatus', '-p', 'ExecMainCode'],
      { encoding: 'utf8' }).trim().split('\n').map((line) => line.split('=')));
    return { exitCode: state.ExecMainCode === '1' ? Number(state.ExecMainStatus) : null,
      signal: ['2', '3'].includes(state.ExecMainCode) ? Number(state.ExecMainStatus) : null,
      execMainCode: Number(state.ExecMainCode), result: state.Result };
  };
  try {
    await execution;
    observed = observe();
    if (observed.execMainCode !== 1 || !['success', ...(allowNonzero ? ['exit-code'] : [])].includes(observed.result)
        || (!allowNonzero && observed.exitCode !== 0)) throw new Error('Coding service did not exit normally');
    await gates(spec, fresh);
    return observed;
  } catch (error) {
    try { error.execution = observed ?? observe(); } catch { error.execution = { exitCode: null, signal: null, result: 'unobserved' }; }
    throw error;
  } finally {
    clearInterval(poll); clearTimeout(timer); stop();
    const group = execFileSync('/usr/bin/systemctl', ['show', unit, '-p', 'ControlGroup', '--value'], { encoding: 'utf8' }).trim();
    if (group) throw new Error('Coding service cgroup remains; administrator recovery required');
  }
}

async function runCodingJob(filename, retry, signal) {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Coding dispatch requires the VM administrator');
  const bytes = readProtectedCodingFile(filename);
  const spec = readCodingSpec(bytes);
  const profile = codingProfile(spec.paths);
  await gates(spec);
  const store = openCodingRun({ root, bytes, retry });
  const run = store.run;
  try {
    if (store.reused) return { ...run, reused: true };
    const job = path.join(root, 'jobs', run.id);
    fs.mkdirSync(job, { mode: 0o755 });
    fs.writeFileSync(path.join(job, 'spec.json'), bytes, { mode: 0o644, flag: 'wx' });
    fs.mkdirSync(path.join(job, 'empty'), { mode: 0o755 });
    fs.writeFileSync(path.join(job, 'schema.json'), JSON.stringify(codingSchema), { mode: 0o644, flag: 'wx' });
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
    fs.writeFileSync(path.join(job, 'context.json'), JSON.stringify(context), { mode: 0o644, flag: 'wx' });
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
    try { await runUnit(`bim-forge-code-generate@${run.id}.service`, spec, signal); }
    finally {
      if (fs.existsSync(path.join(output, 'answer.json'))) {
        response = JSON.parse(readProtectedCodingFile(path.join(output, 'answer.json'), 999, 256 * 1024));
        store.record({ usage: response.usage, warnings: response.warnings, answerSha256: sha256(JSON.stringify(response)) });
      }
    }
    if (!response || response.usage.input_tokens + response.usage.output_tokens > 60000) throw new Error('Coding usage exceeds the supported budget');
    const prepared = prepareCodingPackage(spec, response.answer, policy, manifest);
    git('worktree', 'add', '--detach', path.join(job, 'candidate'), spec.baseSha);
    materializeCodingFiles(path.join(job, 'candidate'), prepared.proposal);
    fs.writeFileSync(path.join(job, 'preliminary.json'), prepared.bytes, { mode: 0o644, flag: 'wx' });
    const observations = [];
    await gates(spec);
    for (const acceptance of spec.acceptanceCases) {
      const caseId = randomUUID();
      const caseDir = path.join(root, 'cases', caseId);
      fs.mkdirSync(caseDir, { mode: 0o755 });
      fs.symlinkSync(path.join(job, 'candidate'), path.join(caseDir, 'candidate'));
      fs.writeFileSync(path.join(caseDir, 'input'), acceptance.input, { mode: 0o644, flag: 'wx' });
      fs.writeFileSync(path.join(caseDir, 'mode'), acceptance.mode, { mode: 0o644, flag: 'wx' });
      fs.writeFileSync(path.join(caseDir, 'paths.json'), JSON.stringify(profile.paths), { mode: 0o644, flag: 'wx' });
      for (const name of ['stdout', 'stderr']) fs.writeFileSync(path.join(caseDir, name), '', { mode: 0o600, flag: 'wx' });
      const unit = `bim-forge-code-case@${caseId}.service`;
      store.record({ phase: 'acceptance', activeUnit: unit });
      let observation; let execution;
      try { execution = await runUnit(unit, spec, signal, { fresh: false, allowNonzero: true }); }
      catch (error) { execution = error.execution; throw error; }
      finally {
        observation = { name: acceptance.name, mode: acceptance.mode, unit, ...execution,
          stdout: readProtectedCodingFile(path.join(caseDir, 'stdout'), 0, 128 * 1024).toString('utf8'),
          stderr: readProtectedCodingFile(path.join(caseDir, 'stderr'), 0, 128 * 1024).toString('utf8') };
        observations.push(observation);
        saveCodingJson(path.join(job, 'observations.json'), observations);
      }
      assertCodingObservation(acceptance, observation, profile.paths);
    }
    store.record({ phase: 'supplemental-checks', activeUnit: `bim-forge-code-verify@${run.id}.service` });
    let verification;
    try { await runUnit(`bim-forge-code-verify@${run.id}.service`, spec, signal); }
    finally {
      verification = execFileSync('/usr/bin/journalctl', ['-u', `bim-forge-code-verify@${run.id}.service`, '--no-pager', '-o', 'cat'], { maxBuffer: 2 * 1024 * 1024 });
      fs.writeFileSync(path.join(job, 'verification.log'), verification, { mode: 0o600, flag: 'wx' });
    }
    const proposal = prepared.proposal;
    proposal.body = `## Summary\n\n${response.answer.summary}\n\n## Evidence\n\nBefore: the approved utility is absent at the pinned revision. After: ${observations.length} independent CLI/API cases passed. Fixed policy validation and the full candidate test command also exited successfully in the credential-free sandbox. Model claims were not used as test evidence.\n\nManual coding run: ${run.id}\nBase: ${spec.baseSha}\nPlan SHA-256: ${run.planSha256}\nAcceptance SHA-256: ${run.acceptanceSha256}\nObservation SHA-256: ${sha256(JSON.stringify(observations))}\nVerifier log SHA-256: ${sha256(verification)}\n\n## Merge Danger\n\nTwo-way change. Read-only ${profile.label}; no BIM mutation. Administrator publication approval is separate from human merge approval. No automatic merge. Tests cover fixed cases, not general correctness. Independent code review remains required.`;
    const finalBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
    const digest = sha256(finalBytes);
    approvePackage(finalBytes, digest);
    await new Promise((resolve) => setImmediate(resolve));
    await gates(spec);
    if (signal.aborted) throw new Error('Coding cancelled before package acceptance');
    fs.writeFileSync(path.join(job, 'publication.json'), finalBytes, { mode: 0o600, flag: 'wx' });
    store.record({ status: 'verified', phase: 'awaiting-publication-approval', activeUnit: null,
      finishedAt: new Date().toISOString(), publicationSha256: digest,
      publicationPath: path.join(job, 'publication.json'), verificationSha256: sha256(verification) });
    return run;
  } catch (error) {
    store.record({ status: 'failed', finishedAt: new Date().toISOString(), message: error.message });
    throw error;
  } finally { store.close(); }
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
