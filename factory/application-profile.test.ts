import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codingProfile, readCodingSpec, prepareCodingPackage, materializeCodingFiles, sha256,
  type CodingAcceptanceCase, type CodingSpec } from './coding.ts';
import { approvePackage } from './publish-request.ts';
import { coderCommand } from './code-generate.ts';
import { assertCodingObservation } from './code-acceptance.ts';

const paths = ['src/model-summary.ts', 'src/model-summary.test.ts'];
const acceptanceModes: ('cli' | 'api')[] = ['cli', 'api'];
const acceptanceCases: CodingAcceptanceCase[] = acceptanceModes.flatMap((mode) => [
  { mode, name: `${mode}-valid`, input: '{"elements":[]}', output: { total: 0 } },
  { mode, name: `${mode}-invalid`, input: '{}', output: null },
]);
const spec = (): CodingSpec => ({ version: 1, repository: 'Frederik91/bim-forge', baseSha: 'a'.repeat(40),
  issue: { number: 30, title: 'Read-only model summary', body: 'Count supplied element metadata without changing a model.', updated_at: '2026-10-22T10:00:00Z' },
  paths, acceptanceCases, plan: { outcome: 'Describe supplied model metadata', changeClass: 'read-only', paths,
    steps: ['Implement the JSON contract'], acceptanceChecks: ['Independent valid and invalid CLI and API cases'],
    reviewers: ['Frederik91'], questions: [] } });
const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const policy: unknown = JSON.parse(fs.readFileSync(new URL('../policy/gate.json', import.meta.url), 'utf8'));
const baseline = JSON.stringify({ scripts: { test: 'node --test factory/coding.test.ts', validate: 'node scripts/validate-policy.ts' } });
const answer = () => ({ summary: 'Summarize supplied metadata without changing it.', questions: [],
  files: paths.map((file) => ({ path: file, content: 'export const evaluate = () => ({ total: 0 });\n' })) });
const temporary = (t: TestContext): string => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-application-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('application profiles reuse a fixed contract for a matched new module and test', () => {
  const profile = codingProfile(paths.slice().reverse());
  assert.equal(profile.exportName, 'evaluate');
  assert.equal(profile.errorText, 'Invalid application input');
  assert.deepEqual(profile.paths, paths);
  assert.throws(() => { Object.defineProperty(profile.paths, '0', { value: 'factory/code-job.ts' }); });
  assert.throws(() => { Object.defineProperty(profile, 'exportName', { value: 'exec' }); });
  assert.equal(readCodingSpec(bytes(spec())).issue.number, 30);
  const prompt = coderCommand('/fixed/job', spec(), {}).input;
  assert.ok(prompt.includes('evaluate'));
  assert.ok(prompt.includes('Invalid application input'));
});

test('application profiles reject mixed, nested, unsafe, and unpaired paths', () => {
  for (const invalid of [[], ['src/a.ts'], ['src/a.ts', 'src/b.test.ts'],
    ['src/a.test.ts', 'src/a.test.test.ts'], ['src/a.ts', 'src/a.ts'],
    ['factory/a.ts', 'factory/a.test.ts'], ['src/a.ts', 'factory/a.test.ts'],
    ['src/../a.ts', 'src/a.test.ts'], ['src/auth/a.ts', 'src/auth/a.test.ts'],
    ['src/a_b.ts', 'src/a_b.test.ts'], ['src/A.ts', 'src/A.test.ts'],
    ['src/.a.ts', 'src/.a.test.ts'], ['src/a.mjs', 'src/a.test.mjs'], [...paths, 'src/extra.ts']]) {
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
  const manifest = prepared.proposal.files.at(-1);
  assert.ok(manifest);
  const parsedManifest = JSON.parse(manifest.content);
  assert.equal(parsedManifest.scripts.test,
    'node --test factory/coding.test.ts src/model-summary.test.ts');
  assert.equal(parsedManifest.scripts.validate,
    'node scripts/validate-policy.ts');
  assert.equal(approvePackage(prepared.bytes, prepared.digest).proposal.files[0].path, paths[0]);
  for (const file of ['AGENTS.md', '.github/workflows/test.yml', 'src/AGENTS.md',
    'src/auth/token.ts', 'src/a/../../factory/code-job.ts', 'src/production/model.ts']) {
    const bad = bytes({ ...prepared.proposal, files: [{ path: file, content: 'not allowed\n' }] });
    assert.throws(() => approvePackage(bad, sha256(bad)));
  }
});

test('application materialization creates a fixed directory but never overwrites source', (t) => {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'package.json'), baseline);
  const prepared = prepareCodingPackage(spec(), answer(), policy, baseline);
  materializeCodingFiles(dir, prepared.proposal);
  const firstPath = paths[0];
  const firstFile = prepared.proposal.files[0];
  assert.ok(firstPath && firstFile);
  assert.equal(fs.readFileSync(path.join(dir, firstPath), 'utf8'), firstFile.content);
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
