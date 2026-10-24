import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  codingScope, materializeCodingFiles, prepareCodingPackage, readCodingSpec,
  type CodingSpec,
} from './coding.ts';
import { coderCommand } from './code-generate.ts';

const paths = ['demo/room-app.ts', 'demo/room.css'];
const spec = (overrides: Partial<CodingSpec> = {}): CodingSpec => ({
  version: 1,
  repository: 'Frederik91/bim-forge',
  baseSha: 'a'.repeat(40),
  issue: {
    number: 74,
    title: 'Approved application change',
    body: 'Update an existing room experience in an exact path scope.',
    updated_at: '2026-10-24T10:00:00Z',
  },
  plan: {
    outcome: 'Update the approved room experience',
    changeClass: 'geometry',
    paths,
    steps: ['Modify only the pinned application files'],
    acceptanceChecks: ['Run repository validation and tests'],
    reviewers: ['Frederik91'],
    questions: [],
  },
  paths,
  acceptanceCases: [],
  ...overrides,
});
const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const policy = (maximum = 12): unknown => ({
  version: 1,
  maxAutomatedPublicationFiles: maximum,
  maxAttemptsPerIssue: 3,
  denylist: ['**/.env', '**/secrets/**', '**/schema/**'],
  autoMerge: { enabled: false },
});
const temporary = (t: TestContext): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-repository-change-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test('approved repository changes admit normal change classes and exact existing paths', () => {
  for (const changeClass of ['read-only', 'metadata', 'geometry', 'coordination', 'schema-storage', 'security'] as const) {
    const value = spec({ plan: { ...spec().plan, changeClass } });
    const parsed = readCodingSpec(bytes(value));
    assert.equal(parsed.plan.changeClass, changeClass);
    assert.deepEqual(parsed.paths, paths);
    assert.deepEqual(parsed.acceptanceCases, []);
    assert.equal(codingScope(parsed).kind, 'repository-change');
  }
});

test('repository-change generation receives pinned contents and cannot invent paths', () => {
  const command = coderCommand('/fixed/job', spec(), {
    approvedFiles: { 'demo/room-app.ts': 'export const existing = true;\n', 'demo/room.css': '.room {}\n' },
  });
  assert.match(command.input, /complete final UTF-8 contents of every approved path/);
  assert.match(command.input, /export const existing = true/);
  assert.doesNotMatch(command.input, /fixed contract exports/);
  assert.throws(() => prepareCodingPackage(spec(), {
    summary: 'Changed one unapproved path.', questions: [], files: [{ path: 'demo/server.ts', content: 'export {};\n' }],
  }, policy(), '{}'), /unapproved paths/);
});

test('repository changes replace only approved regular files in a disposable candidate', (t) => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, 'demo'));
  fs.writeFileSync(path.join(root, 'demo', 'room-app.ts'), 'old app\n');
  fs.writeFileSync(path.join(root, 'demo', 'room.css'), 'old css\n');
  const answer = {
    summary: 'Update the approved room files.',
    questions: [],
    files: [
      { path: 'demo/room-app.ts', content: 'new app\n' },
      { path: 'demo/room.css', content: 'new css\n' },
    ],
  };
  const prepared = prepareCodingPackage(spec(), answer, policy(), '{}');
  assert.throws(() => materializeCodingFiles(root, prepared.proposal), /additions only/);
  materializeCodingFiles(root, prepared.proposal, 'replace-approved');
  assert.equal(fs.readFileSync(path.join(root, 'demo', 'room-app.ts'), 'utf8'), 'new app\n');
  assert.equal(fs.readFileSync(path.join(root, 'demo', 'room.css'), 'utf8'), 'new css\n');
});

test('repository changes retain policy limits and reject executable cases for consequential work', () => {
  const manyPaths = Array.from({ length: 5 }, (_, index) => `docs/factory-change-${index}.md`);
  const many = spec({
    paths: manyPaths,
    plan: { ...spec().plan, paths: manyPaths },
  });
  const parsed = readCodingSpec(bytes(many));
  assert.equal(parsed.paths.length, 5);
  const answer = {
    summary: 'Five approved documentation files.',
    questions: [],
    files: manyPaths.map((file) => ({ path: file, content: '# Approved\n' })),
  };
  assert.throws(() => prepareCodingPackage(parsed, answer, policy(3), '{}'), /policy/);
  const executable = spec({ acceptanceCases: [{ mode: 'cli', name: 'forged', input: '{}', output: {} }] });
  assert.throws(() => readCodingSpec(bytes(executable)), /read-only fixed contracts/);
});

test('repository changes reject stale plans, unsafe paths and unresolved questions', () => {
  for (const invalid of [
    spec({ paths: ['demo/room-app.ts'], plan: { ...spec().plan, paths } }),
    spec({ paths: ['src/auth/token.ts'], plan: { ...spec().plan, paths: ['src/auth/token.ts'] } }),
    spec({ plan: { ...spec().plan, questions: ['Which behavior should change?'] } }),
  ]) {
    assert.throws(() => readCodingSpec(bytes(invalid)));
  }
});
