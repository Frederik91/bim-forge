import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCodingSpec, prepareCodingPackage, materializeCodingFiles, sha256, codingProfile } from './coding.mjs';
import { coderCommand } from './code-generate.mjs';
import { openCodingRun, readProtectedCodingFile } from './coding-store.mjs';
import { assertCodingObservation, healthAcceptanceCases, scheduleAcceptanceCases } from './code-acceptance.mjs';
import './schedule-approval.test.mjs';
import './scheduled-publication.test.mjs';
import './schedule-job.test.mjs';
import './application-profile.test.mjs';
import './change-review.test.mjs';

const paths = ['factory/health.ts', 'factory/health.test.ts'];
const spec = () => ({ version: 1, repository: 'Frederik91/bim-forge', baseSha: 'a'.repeat(40),
  issue: { number: 17, title: 'Run health', body: 'Summarize disposable runs only.', updated_at: '2026-10-21T00:00:00Z' },
  plan: { outcome: 'Summarize runs', changeClass: 'read-only', paths, steps: ['Implement the command'],
    acceptanceChecks: ['Fixed independent stdin cases'], reviewers: ['Frederik91'], questions: [] },
  paths, acceptanceCases: healthAcceptanceCases,
});
const bytes = (value = spec()) => Buffer.from(JSON.stringify(value));
const answer = () => ({ summary: 'A bounded read-only utility.', questions: [],
  files: paths.map((file) => ({ path: file, content: 'export const example = true;\n' })) });
const policy = JSON.parse(fs.readFileSync(new URL('../policy/gate.json', import.meta.url)));
const manifest = JSON.stringify({ scripts: { validate: 'node scripts/validate-policy.mjs', test: 'node --test factory/baseline.test.mjs' } });
const temporary = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-code-')); fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('ready coding scope binds exact issue, source, paths, plan and independent cases', () => {
  assert.equal(readCodingSpec(bytes()).issue.number, 17);
  const changed = spec(); changed.plan.questions = ['Unresolved'];
  assert.throws(() => readCodingSpec(bytes(changed)), /ready/);
  for (const value of [{ ...spec(), command: 'untrusted' }, { ...spec(), baseSha: 'main' },
    { ...spec(), paths: ['factory/../secrets.mjs'] }, { ...spec(), acceptanceCases: [] },
    { ...spec(), plan: { ...spec().plan, changeClass: 'security' } }]) {
    assert.throws(() => readCodingSpec(bytes(value)));
  }
});

test('only two complete fixed profiles are available and their contracts are immutable', () => {
  const schedulePaths = ['factory/schedule-check.mjs', 'factory/schedule-check.test.mjs'];
  const profile = codingProfile(schedulePaths.slice().reverse());
  assert.equal(profile.exportName, 'checkSchedule');
  assert.equal(profile.errorText, 'Invalid schedule snapshot');
  assert.equal(profile.paths[0], 'factory/schedule-check.mjs');
  assert.equal(codingProfile(paths).exportName, 'summarizeRunHealth');
  assert.equal(codingProfile(paths).errorText, 'Invalid run records');
  assert.throws(() => { profile.paths[0] = 'factory/code-job.mjs'; });
  assert.throws(() => { profile.exportName = 'exec'; });
  for (const invalid of [null, [], ['factory/health.ts'],
    ['factory/health.ts', 'factory/schedule-check.test.mjs'],
    ['factory/schedule-check.mjs', 'factory/schedule-check.mjs'],
    ['factory/unknown.mjs', 'factory/unknown.test.mjs'], [...paths, 'factory/extra.mjs']]) {
    assert.throws(() => codingProfile(invalid), /fixed coding profile/);
  }
});

test('schedule scope fixes paths and cases while packaging preserves all existing tests', () => {
  const schedulePaths = ['factory/schedule-check.mjs', 'factory/schedule-check.test.mjs'];
  const value = { ...spec(), paths: schedulePaths, plan: { ...spec().plan, paths: schedulePaths },
    acceptanceCases: scheduleAcceptanceCases };
  const parsed = readCodingSpec(bytes(value));
  assert.equal(parsed.acceptanceCases.length, 32);
  assert.equal(healthAcceptanceCases.length, 24);
  const baseline = JSON.stringify({ scripts: { test: 'node --test factory/coding.test.mjs factory/health.test.ts',
    validate: 'node scripts/validate-policy.mjs' } });
  const response = { summary: 'Read-only scheduling advice.', questions: [],
    files: schedulePaths.map((file) => ({ path: file, content: 'export const example = true;\n' })) };
  const prepared = prepareCodingPackage(parsed, response, policy, baseline);
  assert.equal(JSON.parse(prepared.proposal.files.at(-1).content).scripts.test,
    'node --test factory/coding.test.mjs factory/health.test.ts factory/schedule-check.test.mjs');
  assert.throws(() => readCodingSpec(bytes({ ...value, exportName: 'exec' })));
  assert.throws(() => readCodingSpec(bytes({ ...value, errorText: 'Forged' })));
  assert.throws(() => readCodingSpec(bytes({ ...value, paths: ['factory/health.ts', schedulePaths[1]],
    plan: { ...value.plan, paths: ['factory/health.ts', schedulePaths[1]] } })), /fixed coding profile/);
});

test('independent profile errors cannot be swapped or supplied by a candidate', () => {
  const schedulePaths = ['factory/schedule-check.mjs', 'factory/schedule-check.test.mjs'];
  const rejected = scheduleAcceptanceCases.find((item) => item.output === null);
  const observation = { exitCode: 1, stdout: '', stderr: 'Invalid schedule snapshot\n' };
  assert.doesNotThrow(() => assertCodingObservation(rejected, observation, schedulePaths));
  assert.throws(() => assertCodingObservation(rejected, { ...observation, stderr: 'Invalid run records\n' }, schedulePaths));
  assert.throws(() => assertCodingObservation(rejected, observation));
  assert.throws(() => assertCodingObservation(rejected, observation, ['factory/unknown.mjs']));
  const accepted = scheduleAcceptanceCases.find((item) => item.output?.eligible);
  assert.doesNotThrow(() => assertCodingObservation(accepted,
    { exitCode: 0, stdout: `${JSON.stringify(accepted.output)}\n`, stderr: '' }, schedulePaths));
  assert.throws(() => assertCodingObservation(accepted,
    { exitCode: 0, stdout: '{"status":"verified"}\n', stderr: '' }, schedulePaths));
});

test('model source cannot select operations, existing validators, file modes or extra paths', () => {
  for (const bad of [{ ...answer(), questions: ['Need context'] }, { ...answer(), command: 'run' },
    { ...answer(), files: [{ path: 'package.json', content: '{}' }] },
    { ...answer(), files: answer().files.map((file) => ({ ...file, mode: '100755' })) }]) {
    assert.throws(() => prepareCodingPackage(spec(), bad, policy, manifest));
  }
  const protectedPolicy = { ...policy, denylist: ['factory/health.ts'] };
  assert.throws(() => prepareCodingPackage(spec(), answer(), protectedPolicy, manifest), /protected/);
});

test('only the controller appends approved new tests to the pinned manifest', () => {
  const prepared = prepareCodingPackage(spec(), answer(), policy, manifest);
  assert.equal(prepared.proposal.files.length, 3);
  const candidate = JSON.parse(prepared.proposal.files.at(-1).content);
  assert.equal(candidate.scripts.test, 'node --test factory/baseline.test.mjs factory/health.test.ts');
  assert.equal(candidate.scripts.validate, JSON.parse(manifest).scripts.validate);
  assert.equal(prepared.digest, sha256(prepared.bytes));
});

test('materialization adds approved bytes but refuses existing files and symlink parents', (t) => {
  const dir = temporary(t); fs.mkdirSync(path.join(dir, 'factory')); fs.writeFileSync(path.join(dir, 'package.json'), manifest);
  const prepared = prepareCodingPackage(spec(), answer(), policy, manifest);
  materializeCodingFiles(dir, prepared.proposal);
  assert.equal(fs.readFileSync(path.join(dir, paths[0]), 'utf8'), prepared.proposal.files[0].content);
  assert.throws(() => materializeCodingFiles(dir, prepared.proposal), /additions only/);
});

test('source generator retains tools-disabled policy, fixed auth home and bounded prompt', () => {
  const command = coderCommand('/fixed/job', spec(), { instructions: 'Context only' });
  assert.ok(command.args.includes('read-only'));
  assert.ok(command.args.includes('--ignore-user-config'));
  assert.ok(command.args.includes('shell_tool'));
  assert.ok(command.args.includes('code_mode_host'));
  assert.equal(command.env.GH_TOKEN, undefined);
  assert.equal(command.env.OPENAI_API_KEY, undefined);
  assert.throws(() => coderCommand('/fixed/job', spec(), { text: 'x'.repeat(150000) }), /limit/);
});

test('independent comparisons reject forged success, missing output and abnormal termination', () => {
  const acceptance = healthAcceptanceCases[0];
  const observed = { exitCode: 0, stdout: `${JSON.stringify(acceptance.output)}\n`, stderr: '' };
  assert.doesNotThrow(() => assertCodingObservation(acceptance, observed));
  for (const changed of [{ stdout: '{"status":"verified"}\n' }, { stdout: '' }, { exitCode: 1 }, { signal: 'SIGKILL' }]) {
    assert.throws(() => assertCodingObservation(acceptance, { ...observed, ...changed }));
  }
  assert.throws(() => assertCodingObservation(healthAcceptanceCases.at(-1), observed));
  const rejected = healthAcceptanceCases.find((item) => item.output === null);
  assert.doesNotThrow(() => assertCodingObservation(rejected, { exitCode: 1, stdout: '', stderr: 'Invalid run records\n' }));
  assert.throws(() => assertCodingObservation(rejected, { exitCode: 1, stdout: '', stderr: 'Private input was bad\n' }));
  assert.ok(healthAcceptanceCases.some((item) => item.mode === 'api' && item.output !== null));
});

test('non-admin dispatch refuses before contacting GitHub or starting a model', { skip: process.platform === 'linux' && process.getuid() === 0 }, () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./code-job.mjs', import.meta.url)), '--spec', '/missing'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /administrator/);
});

test('the installed symlink entry cannot silently skip administrator dispatch', { skip: process.platform !== 'linux' || process.getuid() === 0 }, (t) => {
  const dir = temporary(t); const alias = path.join(dir, 'code-job.mjs');
  fs.symlinkSync(fileURLToPath(new URL('./code-job.mjs', import.meta.url)), alias);
  const result = spawnSync(process.execPath, [alias, '--spec', '/missing'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /administrator/);
});

const linux = { skip: process.platform !== 'linux' };
test('coding lease, completed reuse and failed reuse never silently start another attempt', linux, (t) => {
  const root = temporary(t); const options = { root, bytes: bytes(), ownerUid: process.getuid() };
  const first = openCodingRun(options);
  assert.throws(() => openCodingRun(options), /EEXIST/);
  first.record({ status: 'verified' }); first.close();
  const second = openCodingRun(options);
  assert.equal(second.reused, true); assert.equal(second.run.id, first.run.id); second.close();
});

test('issue-wide coding starts remain capped across changed spec hashes', linux, (t) => {
  const root = temporary(t);
  for (let index = 0; index < 3; index += 1) {
    const value = spec(); value.issue.body += String(index);
    const run = openCodingRun({ root, bytes: bytes(value), ownerUid: process.getuid() });
    assert.equal(run.run.attempt, index + 1); run.record({ status: 'failed' }); run.close();
  }
  assert.throws(() => openCodingRun({ root, bytes: bytes(), ownerUid: process.getuid() }), /attempt limit/);
});

test('interrupted runs and unsafe spec files require explicit administrator recovery', linux, (t) => {
  const root = temporary(t); const options = { root, bytes: bytes(), ownerUid: process.getuid() };
  const interrupted = openCodingRun(options); interrupted.close();
  assert.throws(() => openCodingRun(options), /Interrupted/);
  const input = path.join(root, 'input.json'); fs.writeFileSync(input, bytes(), { mode: 0o600 });
  const alias = path.join(root, 'alias'); fs.symlinkSync(input, alias);
  assert.throws(() => readProtectedCodingFile(alias, process.getuid()), /ELOOP/);
  fs.chmodSync(input, 0o666);
  assert.throws(() => readProtectedCodingFile(input, process.getuid()), /protected/);
});

const scheduled = (scopeBytes, overrides = {}) => {
  const now = Date.now();
  const approval = { version: 1, repository: 'Frederik91/bim-forge', scopeSha256: sha256(scopeBytes),
    deploymentSha256: 'b'.repeat(64), notBefore: new Date(now - 3600000).toISOString(),
    expiresAt: new Date(now + 3600000).toISOString(), dailyLimit: 3, ...overrides };
  const approvalBytes = Buffer.from(`${JSON.stringify(approval)}\n`);
  return { approvalBytes, approvedSha256: sha256(approvalBytes), deploymentSha256: 'b'.repeat(64) };
};

test('scheduled admission consumes one approval with its durable run and reuses failed delivery', linux, (t) => {
  const root = temporary(t); const scopeBytes = bytes(); const schedule = scheduled(scopeBytes);
  const options = { root, bytes: scopeBytes, ownerUid: process.getuid(), schedule };
  const first = openCodingRun(options);
  const persisted = JSON.parse(fs.readFileSync(path.join(root, 'ledger', `${first.run.id}.json`)));
  assert.equal(persisted.scheduleApprovalSha256, schedule.approvedSha256);
  assert.equal(persisted.status, 'running');
  assert.throws(() => openCodingRun(options), /EEXIST/);
  first.record({ status: 'failed' }); first.close();
  const duplicate = openCodingRun(options);
  assert.equal(duplicate.reused, true); assert.equal(duplicate.run.id, first.run.id);
  assert.equal(duplicate.run.status, 'failed'); duplicate.close();
  assert.throws(() => openCodingRun({ ...options, retry: true }), /no retry/);
  assert.throws(() => openCodingRun({ ...options, schedule: scheduled(scopeBytes, { dailyLimit: 2 }) }), /already attempted/);
});

test('scheduled daily admission counts manual starts and a fresh approval cannot reset issue attempts', linux, (t) => {
  const root = temporary(t); const manualBytes = bytes();
  const manual = openCodingRun({ root, bytes: manualBytes, ownerUid: process.getuid() });
  manual.record({ status: 'verified' }); manual.close();
  const next = spec(); next.issue.number = 20; const nextBytes = bytes(next);
  const options = { root, bytes: nextBytes, ownerUid: process.getuid(), schedule: scheduled(nextBytes, { dailyLimit: 1 }) };
  assert.throws(() => openCodingRun(options), /UTC-day start limit/);
  assert.throws(() => openCodingRun({ ...options, bytes: manualBytes, schedule: scheduled(manualBytes) }), /already attempted/);
  for (let index = 0; index < 2; index += 1) {
    const changed = spec(); changed.issue.body += index;
    const run = openCodingRun({ root, bytes: bytes(changed), ownerUid: process.getuid() });
    run.record({ status: 'failed', startedAt: '2026-01-01T00:00:00.000Z' }); run.close();
  }
  const fourth = spec(); fourth.issue.body += 'fourth'; const fourthBytes = bytes(fourth);
  assert.throws(() => openCodingRun({ root, bytes: fourthBytes, ownerUid: process.getuid(), schedule: scheduled(fourthBytes) }), /issue attempt limit/);
});

test('six-start setup approval counts existing manual and scheduled starts and blocks the seventh', linux, (t) => {
  const root = temporary(t);
  for (let index = 0; index < 6; index += 1) {
    const value = spec(); value.issue.number = 100 + index;
    const scopeBytes = bytes(value);
    const options = { root, bytes: scopeBytes, ownerUid: process.getuid() };
    if (index >= 3) options.schedule = scheduled(scopeBytes, { dailyLimit: 6 });
    const run = openCodingRun(options);
    assert.equal(run.reused, false);
    run.record({ status: index % 2 ? 'failed' : 'verified' }); run.close();
    if (index === 5) {
      const duplicate = openCodingRun(options);
      assert.equal(duplicate.reused, true);
      assert.equal(duplicate.run.id, run.run.id); duplicate.close();
    }
  }
  const ledger = path.join(root, 'ledger');
  const before = fs.readdirSync(ledger).sort().map((name) => [name, fs.readFileSync(path.join(ledger, name), 'utf8')]);
  assert.equal(before.length, 6);
  const next = spec(); next.issue.number = 106; const nextBytes = bytes(next);
  for (const dailyLimit of [3, 6]) {
    assert.throws(() => openCodingRun({ root, bytes: nextBytes, ownerUid: process.getuid(),
      schedule: scheduled(nextBytes, { dailyLimit }) }), /UTC-day start limit/);
  }
  assert.deepEqual(fs.readdirSync(ledger).sort().map((name) => [name, fs.readFileSync(path.join(ledger, name), 'utf8')]), before);
});

test('six-start setup approval cannot reset the cumulative three-start issue limit', linux, (t) => {
  const root = temporary(t);
  for (let index = 0; index < 3; index += 1) {
    const value = spec(); value.issue.body += index;
    const run = openCodingRun({ root, bytes: bytes(value), ownerUid: process.getuid() });
    run.record({ status: 'failed' }); run.close();
  }
  const changed = spec(); changed.issue.body += 'clarified'; const scopeBytes = bytes(changed);
  assert.throws(() => openCodingRun({ root, bytes: scopeBytes, ownerUid: process.getuid(),
    schedule: scheduled(scopeBytes, { dailyLimit: 6 }) }), /issue attempt limit/);
  assert.equal(fs.readdirSync(path.join(root, 'ledger')).length, 3);
});

test('scheduled admission rejects changed bindings, unexpected authority and corrupt time without clearing history', linux, (t) => {
  const root = temporary(t); const scopeBytes = bytes();
  const options = { root, bytes: scopeBytes, ownerUid: process.getuid(), schedule: scheduled(scopeBytes) };
  for (const schedule of [null, { ...options.schedule, command: 'run' },
    { ...options.schedule, deploymentSha256: 'c'.repeat(64) },
    scheduled(scopeBytes, { scopeSha256: 'a'.repeat(64) })]) {
    assert.throws(() => openCodingRun({ ...options, schedule }));
    assert.equal(fs.existsSync(path.join(root, 'ledger', 'coding.lock')), false);
  }
  const manual = openCodingRun({ root, bytes: scopeBytes, ownerUid: process.getuid() });
  manual.record({ status: 'verified', startedAt: '2999-01-01T00:00:00.000Z' }); manual.close();
  const changed = spec(); changed.issue.number = 22; const changedBytes = bytes(changed);
  assert.throws(() => openCodingRun({ ...options, bytes: changedBytes, schedule: scheduled(changedBytes) }), /future-dated/);
  assert.equal(fs.readdirSync(path.join(root, 'ledger')).filter((name) => name.endsWith('.json')).length, 1);
});

test('scheduled admission refuses malformed approval metadata anywhere in history', linux, (t) => {
  for (const invalid of [['a'.repeat(64)], null, {}, 123]) {
    const root = temporary(t); const manual = openCodingRun({ root, bytes: bytes(), ownerUid: process.getuid() });
    manual.record({ status: 'failed', scheduleApprovalSha256: invalid }); manual.close();
    const next = spec(); next.issue.number = 20; const nextBytes = bytes(next);
    assert.throws(() => openCodingRun({ root, bytes: nextBytes, ownerUid: process.getuid(), schedule: scheduled(nextBytes) }), /corrupt/);
  }
});

test('scheduled admission refuses duplicate consumption of any older approval', linux, (t) => {
  const root = temporary(t);
  for (let index = 0; index < 2; index += 1) {
    const value = spec(); value.issue.body += index;
    const manual = openCodingRun({ root, bytes: bytes(value), ownerUid: process.getuid() });
    manual.record({ status: 'failed', scheduleApprovalSha256: 'a'.repeat(64) }); manual.close();
  }
  const next = spec(); next.issue.number = 20; const nextBytes = bytes(next);
  assert.throws(() => openCodingRun({ root, bytes: nextBytes, ownerUid: process.getuid(), schedule: scheduled(nextBytes) }), /corrupt/);
});
