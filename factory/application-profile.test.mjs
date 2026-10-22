import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codingProfile, readCodingSpec, prepareCodingPackage, materializeCodingFiles, sha256 } from './coding.mjs';
import { approvePackage } from './publish-request.mjs';
import { coderCommand } from './code-generate.mjs';
import { assertCodingObservation } from './code-acceptance.mjs';

const paths = ['src/model-summary.mjs', 'src/model-summary.test.mjs'];
const acceptanceCases = ['cli', 'api'].flatMap((mode) => [
  { mode, name: `${mode}-valid`, input: '{"elements":[]}', output: { total: 0 } },
  { mode, name: `${mode}-invalid`, input: '{}', output: null },
]);
const spec = () => ({ version: 1, repository: 'Frederik91/bim-forge', baseSha: 'a'.repeat(40),
  issue: { number: 30, title: 'Read-only model summary', body: 'Count supplied element metadata without changing a model.', updated_at: '2026-10-22T10:00:00Z' },
  paths, acceptanceCases, plan: { outcome: 'Describe supplied model metadata', changeClass: 'read-only', paths,
    steps: ['Implement the JSON contract'], acceptanceChecks: ['Independent valid and invalid CLI and API cases'],
    reviewers: ['Frederik91'], questions: [] } });
const bytes = (value) => Buffer.from(JSON.stringify(value));
const policy = JSON.parse(fs.readFileSync(new URL('../policy/gate.json', import.meta.url)));
const baseline = JSON.stringify({ scripts: { test: 'node --test factory/coding.test.mjs', validate: 'node scripts/validate-policy.mjs' } });
const answer = () => ({ summary: 'Summarize supplied metadata without changing it.', questions: [],
  files: paths.map((file) => ({ path: file, content: 'export const evaluate = () => ({ total: 0 });\n' })) });
const temporary = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-application-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('application profiles reuse a fixed contract for a matched new module and test', () => {
  const profile = codingProfile(paths.slice().reverse());
  assert.equal(profile.exportName, 'evaluate');
  assert.equal(profile.errorText, 'Invalid application input');
  assert.deepEqual(profile.paths, paths);
  assert.throws(() => { profile.paths[0] = 'factory/code-job.mjs'; });
  assert.throws(() => { profile.exportName = 'exec'; });
  assert.equal(readCodingSpec(bytes(spec())).issue.number, 30);
  const prompt = coderCommand('/fixed/job', spec(), {}).input;
  assert.ok(prompt.includes('evaluate'));
  assert.ok(prompt.includes('Invalid application input'));
});

test('application profiles reject mixed, nested, unsafe, and unpaired paths', () => {
  for (const invalid of [[], ['src/a.mjs'], ['src/a.mjs', 'src/b.test.mjs'],
    ['src/a.test.mjs', 'src/a.test.test.mjs'], ['src/a.mjs', 'src/a.mjs'],
    ['factory/a.mjs', 'factory/a.test.mjs'], ['src/a.mjs', 'factory/a.test.mjs'],
    ['src/../a.mjs', 'src/a.test.mjs'], ['src/auth/a.mjs', 'src/auth/a.test.mjs'],
    ['src/a_b.mjs', 'src/a_b.test.mjs'], ['src/A.mjs', 'src/A.test.mjs'],
    ['src/.a.mjs', 'src/.a.test.mjs'], [...paths, 'src/extra.mjs']]) {
    assert.throws(() => codingProfile(invalid));
  }
});

test('application admission needs valid and invalid evidence for both public entry points', () => {
  for (const missing of acceptanceCases) {
    assert.throws(() => readCodingSpec(bytes({ ...spec(), acceptanceCases: acceptanceCases.filter((item) => item !== missing) })), /application.*cases/i);
  }
  const repeated = [...acceptanceCases, { ...acceptanceCases[0] }];
  assert.throws(() => readCodingSpec(bytes({ ...spec(), acceptanceCases: repeated })), /application.*cases/i);
  for (const changeClass of ['metadata', 'geometry', 'coordination', 'schema-storage', 'security']) {
    assert.throws(() => readCodingSpec(bytes({ ...spec(), plan: { ...spec().plan, changeClass } })), /read-only/);
  }
});

test('application packages add only approved source and append tests without replacing checks', () => {
  const prepared = prepareCodingPackage(readCodingSpec(bytes(spec())), answer(), policy, baseline);
  assert.deepEqual(prepared.proposal.files.map((file) => file.path), [...paths, 'package.json']);
  assert.equal(JSON.parse(prepared.proposal.files.at(-1).content).scripts.test,
    'node --test factory/coding.test.mjs src/model-summary.test.mjs');
  assert.equal(JSON.parse(prepared.proposal.files.at(-1).content).scripts.validate,
    'node scripts/validate-policy.mjs');
  assert.equal(approvePackage(prepared.bytes, prepared.digest).proposal.files[0].path, paths[0]);
  for (const file of ['AGENTS.md', '.github/workflows/test.yml', 'src/AGENTS.md',
    'src/auth/token.mjs', 'src/a/../../factory/code-job.mjs', 'src/production/model.mjs']) {
    const bad = bytes({ ...prepared.proposal, files: [{ path: file, content: 'not allowed\n' }] });
    assert.throws(() => approvePackage(bad, sha256(bad)));
  }
});

test('application materialization creates a fixed directory but never overwrites source', (t) => {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'package.json'), baseline);
  const prepared = prepareCodingPackage(spec(), answer(), policy, baseline);
  materializeCodingFiles(dir, prepared.proposal);
  assert.equal(fs.readFileSync(path.join(dir, paths[0]), 'utf8'), prepared.proposal.files[0].content);
  const after = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  assert.throws(() => materializeCodingFiles(dir, prepared.proposal), /additions only/);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), after);
});

test('application materialization refuses unsafe parents before writing any package bytes', (t) => {
  const dir = temporary(t); const outside = temporary(t);
  fs.writeFileSync(path.join(dir, 'package.json'), baseline);
  const prepared = prepareCodingPackage(spec(), answer(), policy, baseline);
  fs.symlinkSync(outside, path.join(dir, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => materializeCodingFiles(dir, prepared.proposal), /parent/);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), baseline);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('application evidence retains the exact independent result and fixed rejection contract', () => {
  for (const item of acceptanceCases) {
    const observed = item.output === null
      ? { exitCode: 1, signal: null, stdout: '', stderr: 'Invalid application input\n' }
      : { exitCode: 0, signal: null, stdout: `${JSON.stringify(item.output)}\n`, stderr: '' };
    assert.doesNotThrow(() => assertCodingObservation(item, observed, paths));
    assert.throws(() => assertCodingObservation(item, { ...observed, stdout: '{"passed":true}\n' }, paths));
  }
});
