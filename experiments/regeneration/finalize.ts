import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { CoverageSchema, parseRun } from '../contracts/schema.ts';
import { bindingFor, describeArtifact, publishRun, sha256, verifyRun } from '../contracts/records.ts';
import { parseObservations } from './contract.ts';

// Retrospective finalization of the retained 915138a evidence, never a rerun.
const { values } = parseArgs({ options: {
  artifacts: { type: 'string' }, evidence: { type: 'string' }, results: { type: 'string' }, 'run-id': { type: 'string' },
} });
if (!values.artifacts || !values.evidence || !values.results || !values['run-id']) {
  throw new Error('Required: --artifacts <retained-server-root> --evidence <new-directory> --results <results-root> --run-id <new-id>');
}
const repository = process.cwd();
const artifacts = resolve(values.artifacts);
const evidence = resolve(values.evidence);
const sourceCommit = '915138a190439a22f31928e43097f9c588415237';
const image = 'sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff';
const retentionBudgetBytes = 64 * 1024 * 1024;

async function json(path: string): Promise<unknown> {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}
async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const children = await Promise.all(entries.map(async (entry) => {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Evidence must not contain symlinks: ${path}`);
    return entry.isDirectory() ? files(path) : [path];
  }));
  return children.flat().sort();
}

const copies = [
  { from: 'w3-debug-final-915138a', to: 'successful-node' },
  { from: 'w3-debug-attempt-3', to: 'successful-kernel' },
  { from: 'w3-first', to: 'failed-kernel-attempt-1' },
  { from: 'w3-debug-attempt-2', to: 'failed-kernel-attempt-2' },
  { from: 'w3-debug-bindings-20261025', to: 'binding-inspection' },
];
let retainedBytes = 0;
for (const item of copies) {
  for (const path of await files(resolve(artifacts, item.from))) retainedBytes += (await stat(path)).size;
}
if (retainedBytes > retentionBudgetBytes) throw new Error('Retained artifacts exceed the predeclared 64 MiB finalization budget');
await mkdir(resolve(evidence, '..'), { recursive: true });
await mkdir(evidence);
for (const item of copies) await cp(resolve(artifacts, item.from), resolve(evidence, item.to), {
  recursive: true, errorOnExist: true, force: false, preserveTimestamps: true,
});

const observationsArtifact = 'successful-node/node/observations.json';
const observations = parseObservations(await json(resolve(evidence, observationsArtifact)));
if (observations.length !== 16 || observations.some((item) => !item.passed)) throw new Error('Expected the retained 16 successful EX-07 observations');
const coverageValue = await json(resolve(evidence, 'successful-node/node/coverage.json'));
if (!Check(Type.Array(CoverageSchema), coverageValue)) throw new Error('Invalid retained assertion coverage');
const metadata = await json(resolve(evidence, 'successful-node/metadata.json'));
const metadataSchema = Type.Object({ sourceCommit: Type.Literal(sourceCommit), runnerSha256: Type.String(),
  'cpu.max': Type.Literal('50000 100000'), 'memory.max': Type.Literal('1073741824') });
if (!Check(metadataSchema, metadata)) throw new Error('Retained source or resource metadata mismatch');
const committedRunner = execFileSync('git', ['show', `${sourceCommit}:experiments/regeneration/topology.py`], { cwd: repository });
if (sha256(committedRunner) !== metadata.runnerSha256) throw new Error('Kernel bytes do not match their actual source commit');
const checks = await json(resolve(evidence, 'successful-node/checks-status.json'));
const checksSchema = Type.Array(Type.Object({ name: Type.String(), command: Type.Array(Type.String()), exitStatus: Type.Literal(0) }), { minItems: 6 });
if (!Check(checksSchema, checks)) throw new Error('Retained validation commands did not all complete successfully');
const topology = await json(resolve(evidence, 'successful-kernel/occt/topology-artifacts.json'));
const topologySchema = Type.Object({ environment: Type.Object({ python: Type.String(), cadqueryOcp: Type.String(),
  cadqueryOcpProxy: Type.String(), vtk: Type.String(), runnerSha256: Type.Literal(metadata.runnerSha256) }) });
if (!Check(topologySchema, topology)) throw new Error('Missing actual topology environment');
const logStart = await stat(resolve(artifacts, 'w3-debug-attempt-3/occt.log'));
const logFinish = await stat(resolve(artifacts, 'w3-debug-final-915138a/observations-contract.log'));
if (logStart.birthtimeMs <= 0 || logStart.birthtimeMs > logFinish.mtimeMs) throw new Error('Retained log creation interval unavailable');
const finalization = {
  publisherCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  recordedAt: new Date().toISOString(), retentionBudgetBytes, retainedBytes,
  timingMethod: 'Retained successful kernel stdout log birthtime through final observation-contract log mtime; retrospective envelope, not measured latency.',
  originalDiskBudget: 'Not captured; the numeric record budget applies only to this bounded evidence finalization.',
  evidenceRoot: relative(repository, evidence).replaceAll('\\', '/'), originalArtifacts: copies,
};
await writeFile(resolve(evidence, 'finalization-provenance.json'), `${JSON.stringify(finalization, null, 2)}\n`, { flag: 'wx' });
const evidenceFiles = await files(evidence);
const manifest = await Promise.all(evidenceFiles.map((path) => describeArtifact(evidence,
  relative(evidence, path).replaceAll('\\', '/'), path.endsWith('.json') ? 'application/json' : path.endsWith('.brep') ? 'application/octet-stream' : 'text/plain')));
const design = await bindingFor(repository, 'docs/design/versioned-model-candidate.md');
const definition = await bindingFor(repository, 'docs/experiments/registry.json');
const run = parseRun({
  schemaVersion: 1, recordKind: 'run', experimentId: 'EX-07', runId: values['run-id'], executionStatus: 'completed', conclusion: 'inconclusive',
  startedAt: logStart.birthtime.toISOString(), finishedAt: logFinish.mtime.toISOString(),
  hypothesis: 'Level and host edits expose the complete dependent delta; fatal/pending regeneration retains the baseline; bounded real OCCT topology changes cannot silently choose an arbitrary attachment.',
  variant: 'W3 deterministic vertical dependency fixture plus actual OCP 8 planar split and adversarial real-face traversal permutation',
  design: { candidateId: 'VM-C1', ...design }, definition,
  implementation: { sourceCommit, runnerCommit: sourceCommit, validators: checks.map((item) => item.name) },
  dataset: { name: 'W0 tiny-building projection and explicit W3 synthetic datums', seed: 'deterministic-no-randomness',
    manifestSha256: sha256(await readFile(resolve(evidence, 'successful-node/node/dataset-manifest.json'))) },
  environment: { host: 'fun-server', software: { nodePublisher: process.version, python: topology.environment.python,
    cadqueryOcp: topology.environment.cadqueryOcp, cadqueryOcpProxy: topology.environment.cadqueryOcpProxy, vtk: topology.environment.vtk },
    imageDigests: [image], cpuLimit: 0.5, memoryLimitBytes: 1073741824, diskBudgetBytes: retentionBudgetBytes,
    storage: 'Retained /ssd1 artifacts; 64 MiB is the finalization retention budget. Original correctness-run disk budget was not captured.',
    cacheProcedure: 'No cache flushing or performance measurement; existing successful artifacts only.',
    measurementSlot: 'W3 leased correctness container; successful kernel attempt 3 plus final source-915138a checks' },
  commands: ['timeout 180s /qualification/python/bin/python /qualification/sources/w3-debug/experiments/regeneration/topology.py --out /qualification/artifacts/w3-debug-attempt-3/occt',
    ...checks.map((item) => item.command.join(' '))],
  observations, observationsArtifact, coverage: coverageValue, evidence: manifest, errors: [],
  limitations: [...new Set(observations.flatMap((item) => item.limitations)),
    'General topology stability remains partially covered; no production acceptance transaction, persistence/reload or general parametric kernel is established.',
    'Two earlier binding failures are retained independently of the 16 successful terminal observations.',
    'Timing is a retrospective retained-log filesystem envelope. Original correctness-run disk budget was not recorded; the numeric budget describes finalization only.'],
  decisionImplications: ['Supports bounded dependency rollback and real-face ambiguity handling only. Does not authorize production adoption, engineering acceptance or merge.'],
});
const inputPath = resolve(evidence, 'result-input.json');
await writeFile(inputPath, `${JSON.stringify(run, null, 2)}\n`, { flag: 'wx' });
await verifyRun(run, { repository, evidence });
const resultPath = await publishRun(run, { repository, evidence, results: resolve(values.results) });
process.stdout.write(`${JSON.stringify({ inputPath, resultPath, conclusion: run.conclusion, observations: observations.length, publisherCommit: finalization.publisherCommit })}\n`);
