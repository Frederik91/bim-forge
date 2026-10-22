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

const paths = ['factory/health.mjs', 'factory/health.test.mjs'];
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
  for (const invalid of [null, [], ['factory/health.mjs'],
    ['factory/health.mjs', 'factory/schedule-check.test.mjs'],
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
  const baseline = JSON.stringify({ scripts: { test: 'node --test factory/coding.test.mjs factory/health.test.mjs',
    validate: 'node scripts/validate-policy.mjs' } });
  const response = { summary: 'Read-only scheduling advice.', questions: [],
    files: schedulePaths.map((file) => ({ path: file, content: 'export const example = true;\n' })) };
  const prepared = prepareCodingPackage(parsed, response, policy, baseline);
  assert.equal(JSON.parse(prepared.proposal.files.at(-1).content).scripts.test,
    'node --test factory/coding.test.mjs factory/health.test.mjs factory/schedule-check.test.mjs');
  assert.throws(() => readCodingSpec(bytes({ ...value, exportName: 'exec' })));
  assert.throws(() => readCodingSpec(bytes({ ...value, errorText: 'Forged' })));
  assert.throws(() => readCodingSpec(bytes({ ...value, paths: ['factory/health.mjs', schedulePaths[1]],
    plan: { ...value.plan, paths: ['factory/health.mjs', schedulePaths[1]] } })), /fixed coding profile/);
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
  const protectedPolicy = { ...policy, denylist: ['factory/health.mjs'] };
  assert.throws(() => prepareCodingPackage(spec(), answer(), protectedPolicy, manifest), /protected/);
});

test('only the controller appends approved new tests to the pinned manifest', () => {
  const prepared = prepareCodingPackage(spec(), answer(), policy, manifest);
  assert.equal(prepared.proposal.files.length, 3);
  const candidate = JSON.parse(prepared.proposal.files.at(-1).content);
  assert.equal(candidate.scripts.test, 'node --test factory/baseline.test.mjs factory/health.test.mjs');
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
