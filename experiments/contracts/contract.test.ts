import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRun, parseObservations } from './schema.ts';
import type { Run } from './schema.ts';
import { bindingFor, describeArtifact, publishRun, sha256, verifyRun } from './records.ts';
import { parseFixture } from '../fixtures/fixture.ts';

const repository = process.cwd();
test('the tiny building preserves two distinct chair occurrences and valid shared relationships', async () => {
  const fixture = parseFixture(JSON.parse(await readFile(new URL('../fixtures/tiny-building.json', import.meta.url), 'utf8')));
  assert.equal(fixture.entities.filter(item => item.kind === 'chair').length, 2);
  assert.equal(fixture.relationships.filter(item => item.kind === 'instanceOf' && item.target === 'chair-type').length, 2);
  assert.throws(() => parseFixture({ ...fixture, entities: fixture.entities.filter(item => item.id !== 'shared-wall') }), /Dangling/);
});

test('draft templates and missing evidence cannot become terminal qualification runs', async () => {
  const template: unknown = JSON.parse(await readFile('docs/experiments/templates/run-result.json', 'utf8'));
  assert.throws(() => parseRun(template), /terminal run/);
  assert.throws(() => parseObservations([{ experimentId: 'EX-04', caseId: 'missing-behavior' }]), /Invalid/);
});

test('binding a repository with a trailing separator resolves to the same committed bytes', async () => {
  const path = 'docs/design/versioned-model-candidate.md';
  assert.deepEqual(await bindingFor(`${repository}/`, path), await bindingFor(repository, path));
});

async function example(evidence: string): Promise<Run> {
  const observations = [{ experimentId: 'EX-04', caseId: 'contract-check', expected: 'typed and bound', observed: 'typed and bound', passed: true, limitations: [] }];
  await writeFile(join(evidence, 'raw.json'), `${JSON.stringify(observations)}\n`);
  const design = await bindingFor(repository, 'docs/design/versioned-model-candidate.md');
  const definition = await bindingFor(repository, 'docs/experiments/registry.json');
  const raw: unknown = JSON.parse((await readFile(definition.path, 'utf8')).replace(/^\uFEFF/, ''));
  const { Check } = await import('typebox/value');
  const { Type } = await import('typebox');
  const schema = Type.Object({ experiments: Type.Array(Type.Object({ id: Type.String(), assertions: Type.Array(Type.String()) })) });
  if (!Check(schema, raw)) throw new Error('Invalid test registry.');
  const required = raw.experiments.find(item => item.id === 'EX-04');
  if (required === undefined) throw new Error('Missing test experiment.');
  return parseRun({
    schemaVersion: 1, recordKind: 'run', experimentId: 'EX-04', runId: 'test-run-0001',
    executionStatus: 'completed', conclusion: 'passed', startedAt: '2026-10-25T00:00:00Z', finishedAt: '2026-10-25T00:00:01Z',
    hypothesis: 'Contract behavior test only; this is not experiment evidence.', variant: 'contract-test',
    design: { candidateId: 'VM-C1', ...design }, definition,
    implementation: { sourceCommit: design.commit, runnerCommit: design.commit, validators: ['contract-v1'] },
    dataset: { name: 'contract-test', seed: 'fixed', manifestSha256: sha256('contract-test') },
    environment: { host: 'disposable-test-container', software: { node: process.version }, imageDigests: [`sha256:${sha256('test-only')}`],
      cpuLimit: 1, memoryLimitBytes: 1024, diskBudgetBytes: 4096, storage: 'temporary', cacheProcedure: 'not a benchmark', measurementSlot: 'test-only' },
    commands: ['node --test experiments/contracts/contract.test.ts'],
    observations,
    coverage: required.assertions.map(assertion => ({ assertion, caseIds: ['contract-check'], coverage: 'covered' })),
    evidence: [await describeArtifact(evidence, 'raw.json', 'application/json')], observationsArtifact: 'raw.json', errors: [], limitations: [], decisionImplications: [],
  });
}

test('publication verifies exact bindings and artifacts and never overwrites an existing run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qvm-contract-'));
  try {
    const run = await example(root);
    const roots = { repository, evidence: root, results: join(root, 'results') };
    const target = await publishRun(run, roots);
    const before = await readFile(target, 'utf8');
    await assert.rejects(publishRun(run, roots), /EEXIST/);
    assert.equal(await readFile(target, 'utf8'), before);
    await assert.rejects(verifyRun(parseRun({ ...run, observations: run.observations.map(item => ({ ...item, observed: 'invented' })) }), roots), /executed artifact/);
    await writeFile(join(root, 'raw.json'), 'changed');
    await assert.rejects(verifyRun(run, roots), /integrity/);
    await assert.rejects(describeArtifact(root, '../outside.txt', 'text/plain'), /within/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing assertions, failed observations and partial coverage cannot be reported passed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qvm-contract-'));
  try {
    const run = await example(root);
    assert.throws(() => parseRun({ ...run, observations: run.observations.map(item => ({ ...item, passed: false })) }), /Passed/);
    assert.throws(() => parseRun({ ...run, coverage: run.coverage.map(item => ({ ...item, coverage: 'partial' })) }), /Passed/);
    await assert.rejects(verifyRun(parseRun({ ...run, coverage: [] , conclusion: 'inconclusive' }), { repository, evidence: root }), /every bound/);
    assert.throws(() => parseRun({ ...run, recordKind: 'template' }), /terminal run/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
