import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { bindingFor, describeArtifact, sha256, verifyRun } from '../contracts/records.ts';
import { parseObservations, parseRun } from '../contracts/schema.ts';
import type { Run } from '../contracts/schema.ts';
import { coverageFor } from './observations.ts';

const text = Type.String({ minLength: 1 });
const commit = Type.String({ pattern: '^[a-f0-9]{40}$' });
const MetadataSchema = Type.Object({
  sourceCommit: commit, latestSourceCommit: commit, preparationStartedAt: text, downstreamStartedAt: text, downstreamFinishedAt: text,
  imageDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  diskBudgetBytes: Type.Integer({ minimum: 1 }), diskBudgetProcedure: text,
  latestRootValidate: Type.Literal('passed'), latestScopedTypecheck: Type.Literal('passed'),
  latestNativeTests: Type.Literal(3), latestPythonTests: Type.Literal(8),
  preparationRerun: Type.Literal(false), latestFullIfcPreparationValidated: Type.Literal(false),
  commands: Type.Array(text, { minItems: 1 }),
}, { additionalProperties: false });
const EnvironmentSchema = Type.Object({ sourceCommit: commit, python: text, packages: Type.Record(text, text), limitations: Type.Array(text) });
const RegistrySchema = Type.Object({ experiments: Type.Array(Type.Object({ id: text, assertions: Type.Array(text) })) });

async function metadataAt(root: string): Promise<Static<typeof MetadataSchema>> {
  const input: unknown = JSON.parse(await readFile(resolve(root, 'metadata.json'), 'utf8'));
  if (!Check(MetadataSchema, input)) throw new Error('Invalid finalization metadata; actual latest unit-check evidence is required');
  return input;
}

async function pathsUnder(root: string, directory = ''): Promise<string[]> {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Evidence must contain retained files, not symlinks');
    return entry.isDirectory() ? pathsUnder(root, path) : [path];
  }));
  return nested.flat().sort();
}

function mediaType(path: string): string {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.ifc')) return 'application/x-step';
  return 'text/plain';
}

const [repositoryArg, evidenceArg, outputArg] = process.argv.slice(2);
if (!repositoryArg || !evidenceArg || !outputArg) throw new Error('Usage: finalize-partial.ts REPOSITORY EVIDENCE_ROOT NEW_INPUT_DIRECTORY');
const repository = resolve(repositoryArg);
const evidenceRoot = resolve(evidenceArg);
const output = resolve(outputArg);
const metadata = await metadataAt(evidenceRoot);
const environmentInput: unknown = JSON.parse(await readFile(resolve(evidenceRoot, 'preparation/environment.json'), 'utf8'));
if (!Check(EnvironmentSchema, environmentInput)) throw new Error('Invalid retained preparation environment');
if (environmentInput.sourceCommit !== metadata.sourceCommit) throw new Error('Executed source does not match retained evidence');
const observationsArtifact = 'downstream/roundtrip/all-observations.json';
const raw: unknown = JSON.parse(await readFile(resolve(evidenceRoot, observationsArtifact), 'utf8'));
const all = parseObservations(raw);
const registryInput: unknown = JSON.parse(await readFile(resolve(repository, 'docs/experiments/registry.json'), 'utf8'));
if (!Check(RegistrySchema, registryInput)) throw new Error('Invalid experiment registry');
const definition = await bindingFor(repository, 'docs/experiments/registry.json');
const design = await bindingFor(repository, 'docs/design/versioned-model-candidate.md');
const artifactPaths = await pathsUnder(evidenceRoot);
const evidence = await Promise.all(artifactPaths.map(path => describeArtifact(evidenceRoot, path, mediaType(path))));
const manifestBytes = await readFile(resolve(evidenceRoot, 'preparation/manifest.json'));
const limitations = [...environmentInput.limitations,
  'The original failed prepare was not repeated. A distinct downstream task reused 74 checksum-verified retained artifacts.',
  'Original preparation: 65 passing / 20 failed observations. Downstream adds four actual failed observations; none were removed or changed.',
  'Three downstream schema checks were unavailable because the historical environment lacks pytest; the bounded-value loss is an actual failed preservation check.',
  `Latest source ${metadata.latestSourceCommit}: root validation, scoped typecheck, 3 TS and 8 Python tests passed. Full IFC preparation on that source remains unvalidated.`,
  'Preparation and downstream engine observations used historical source/runner be6e71b2cc641d669de9f2e57dec49623744100a, before the pytest and JSON-null fixes.',
  metadata.diskBudgetProcedure,
  'No terminal result was published. These are verified W0 input records for coordinator review; no PR merge or model approval is implied.',
];
await mkdir(output, { recursive: false });
for (const experimentId of ['EX-02', 'EX-08'] satisfies ('EX-02' | 'EX-08')[]) {
  const experiment = registryInput.experiments.find(item => item.id === experimentId);
  if (!experiment) throw new Error(`Missing definition ${experimentId}`);
  const observations = all.filter(item => item.experimentId === experimentId);
  const coverage = coverageFor(experimentId, observations, experiment.assertions).map(item => {
    const unavailableHashCases = experimentId === 'EX-08'
      && item.assertion === 'Canonical hashes and tolerance-aware geometric comparisons remain distinct.'
      && item.caseIds.every(id => observations.some(row => row.caseId === id && !row.passed && row.observed.includes('TypeError: Object of type Atom is not JSON serializable')));
    return unavailableHashCases ? { ...item, coverage: 'not-covered' } satisfies Run['coverage'][number] : item;
  });
  const run: Run = {
    schemaVersion: 1, recordKind: 'run', experimentId,
    runId: experimentId === 'EX-02' ? 'w2-partial-exchange-20261025-01' : 'w2-partial-coordinates-20261025-01',
    startedAt: metadata.preparationStartedAt, finishedAt: metadata.downstreamFinishedAt,
    hypothesis: experimentId === 'EX-02'
      ? 'Both narrow candidates preserve the declared IFC slice; unfamiliar property losses must be explicit.'
      : 'Metre/mm placements and survey transforms preserve declared coordinates, independently of exact canonical hashing.',
    variant: 'Controlled-generated IFC4 slice; retained failed preparation plus distinct historical-runner downstream task',
    design: { candidateId: 'VM-C1', ...design }, definition,
    implementation: { sourceCommit: metadata.sourceCommit, runnerCommit: metadata.sourceCommit,
      validators: ['Historical npm run validate / strict scoped tsc / 3 TS tests / 7 Python tests at be6e71b',
        'Actual independent STEP semantic/coordinate/identity checks and real IfcOpenShell geometry measurements',
        'EXPRESS validation unavailable in historical environment: missing _pytest; failed checks retained',
        `Latest source-only validation at ${metadata.latestSourceCommit}: npm run validate, scoped tsc, 3 TS tests, 8 Python tests; no fourth prepare`] },
    dataset: { name: 'qvm-tiny-building-v1 with W2 IFC extension', seed: 'W2 UUID namespace 4030656e-22ec-4aaa-80ee-9eaf170a1898', manifestSha256: sha256(manifestBytes) },
    environment: { host: 'fun-server (192.168.1.17), bim-qvm-w2-debug', software: { python: environmentInput.python, node: process.version,
      ...environmentInput.packages, w0Contract: '29583f735c1803872ace3fa663dcf6d7a145434a' },
      imageDigests: [metadata.imageDigest], cpuLimit: 0.5, memoryLimitBytes: 1610612736,
      diskBudgetBytes: metadata.diskBudgetBytes, storage: '/ssd1/bim-forge-qualification/qvm-20261025; retained private local SSD artifacts',
      cacheProcedure: 'No cache flushing or performance claims; deterministic correctness checks only',
      measurementSlot: 'W2 debug lease: preparation historical; distinct downstream task authorized after retry escalation' },
    commands: metadata.commands, observations, coverage, evidence, observationsArtifact,
    errors: observations.filter(item => !item.passed).map(item => `${item.caseId}: ${item.observed.trim().split('\n').at(-1) ?? item.observed}`),
    limitations,
    decisionImplications: experimentId === 'EX-02'
      ? ['Native scalar/list mapping actually loses the unfamiliar bounded property on re-export; retain this failed preservation result.', 'Broader exchange and released-schema qualification remain unavailable; no architecture adoption follows.']
      : ['Physical coordinates and real-kernel cases ran, but exact-hash cases were unavailable in the historical runner.', 'Coordinate/exchange qualification remains inconclusive; no certified survey or viewer-origin claim.'],
    executionStatus: 'failed', conclusion: experimentId === 'EX-02' ? 'failed' : 'inconclusive',
  };
  parseRun(run);
  await verifyRun(run, { repository, evidence: evidenceRoot });
  await writeFile(resolve(output, `${experimentId}.input.json`), `${JSON.stringify(run, null, 2)}\n`, { flag: 'wx' });
}
const pairPaths = artifactPaths.filter(path => path.startsWith('preparation/') && path.endsWith('.pair.json'));
await writeFile(resolve(output, 'EX-01-paired-export-contribution.json'), `${JSON.stringify({ sourceCommit: metadata.sourceCommit,
  provenance: 'controlled-generated; not independent vendor exports or Revit', releasedSchemaQualification: 'unavailable: missing pytest in historical environment',
  pairs: evidence.filter(item => pairPaths.includes(item.path)), evidenceRoot,
  note: 'Raw IFC and snapshot artifacts are retained beside each pair file. W1 owns EX-01 terminal conclusions.' }, null, 2)}\n`, { flag: 'wx' });
process.stdout.write('Verified EX-02 and EX-08 input records; no terminal publication performed.\n');
