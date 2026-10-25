import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import type { Static, TSchema } from 'typebox';
import { Check } from 'typebox/value';
import { describeArtifact, publishRun, sha256, verifyRun } from '../contracts/records.ts';
import { parseObservations, parseRun } from '../contracts/schema.ts';
import type { Coverage, Observation, Run } from '../contracts/schema.ts';

const text = Type.String({ minLength: 1 });
const digest = Type.String({ pattern: '^[a-f0-9]{64}$' });
const commit = Type.String({ pattern: '^[a-f0-9]{40}$' });
const BindingSchema = Type.Object({ commit, path: text, sha256: digest }, { additionalProperties: false });
const InputSchema = Type.Object({ repository: text, evidence: text, results: text,
  mode: Type.Union([Type.Literal('prepare'), Type.Literal('publish')]),
  runId: Type.String({ pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$' }),
  diskBudget: Type.Union([
    Type.Object({ kind: Type.Literal('unrecorded') }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal('recorded'), bytes: Type.Integer({ minimum: 1 }), provenance: text }, { additionalProperties: false }),
  ]),
}, { additionalProperties: false });
const EnvironmentSchema = Type.Object({ version: text, fsync: text, synchronous_commit: text, full_page_writes: text,
  host: text, node: text, imageDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), imageDigestSource: text,
  leaseId: text, databaseNames: Type.Array(text), measurementKind: text,
}, { additionalProperties: false });
const RegistrySchema = Type.Object({ experiments: Type.Array(Type.Object({ id: text, assertions: Type.Array(text) })) });
type Input = Static<typeof InputSchema>;
type DraftRun = Omit<Run, 'recordKind' | 'environment'> & {
  recordKind: 'draft'; environment: Omit<Run['environment'], 'diskBudgetBytes'> & { diskBudgetBytes: number | null };
};

function parse<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Check(schema, value)) throw new Error('Invalid recovery record-preparation input.');
  return value;
}

async function readJson(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(filename, 'utf8'));
}

const prefix = 'postgres/w6-pg-0247bdd-02/';
const coverage: Record<string, Coverage[]> = {
  'EX-09': [
    { assertion: 'Old immutable bytes and hashes remain retrievable.', caseIds: ['postgres-history-format-dictionary-upgrade'], coverage: 'covered' },
    { assertion: 'Schema, dictionary, canonicalization and geometry-engine changes have pinned interpretation.',
      caseIds: ['pinned-historical-query', 'postgres-history-format-dictionary-upgrade'], coverage: 'partial' },
    { assertion: 'An upgraded reader does not silently replace a historical accepted representation.',
      caseIds: ['postgres-history-format-dictionary-upgrade'], coverage: 'covered' },
  ],
  'EX-11': [
    { assertion: 'Interrupt staging and publication without exposing an incomplete accepted revision.',
      caseIds: ['database-stage-crash', 'database-after-commit-retry'], coverage: 'covered' },
    { assertion: 'Retry produces one logical acceptance and preserves evidence.', caseIds: ['database-after-commit-retry'], coverage: 'covered' },
    { assertion: 'Restore to a fresh instance verifies required content and hashes.', caseIds: ['independent-database-restore'], coverage: 'covered' },
    { assertion: 'Missing artifacts preserve the last complete usable revision.', caseIds: ['database-incomplete-artifacts'], coverage: 'covered' },
  ],
  'EX-12': [
    { assertion: "A retained project package opens without the original host's keys or authentication.",
      caseIds: ['disconnected-database-branches'], coverage: 'partial' },
    { assertion: 'Disconnected edits preserve both branches, ancestry and evidence.', caseIds: ['disconnected-database-branches'], coverage: 'covered' },
    { assertion: 'Reconciliation checks semantic conflicts and all required discipline decisions.', caseIds: ['discipline-atomic-acceptance'], coverage: 'covered' },
  ],
};
const artifacts: Record<string, string[]> = {
  'EX-09': ['history-original.json', 'history-upgraded.json', 'history-query-evidence.json', 'final-source.json'],
  'EX-11': ['stage-before.json', 'stage-killed.json', 'stage-crash/process.json', 'stage-crash/checkpoint.json',
    'after-commit-killed.json', 'after-commit-retried.json', 'after-commit-crash/process.json', 'after-commit-crash/checkpoint.json',
    'changed-payload-rejected.txt', 'missing-before.json', 'missing-after.json', 'missing-artifact-rejected.txt',
    'corrupt-before.json', 'corrupt-after.json', 'corrupt-artifact-rejected.txt', 'dump-source.json', 'restore-independent.json',
    'recovery.dump', 'source-connection-rejected.txt', 'pg-dump-version.stdout.txt', 'pg-restore-version.stdout.txt'],
  'EX-12': ['divergence-source.json', 'divergence-restored.json', 'denied-authority-inputs.json', 'authority-before.json',
    'authority-denied.json', 'authority-accepted.json', 'authority-0-rejected.txt', 'authority-1-rejected.txt',
    'authority-2-rejected.txt', 'authority-3-rejected.txt', 'authority-4-rejected.txt', 'racing-head-rejected.txt'],
};

function assertCoverage(args: { experimentId: string; observations: Observation[]; declared: Coverage[];
  definition: Static<typeof RegistrySchema>['experiments'][number] }): void {
  const expected = new Set(args.definition.assertions);
  if (args.declared.length !== expected.size || args.declared.some((item) => !expected.has(item.assertion))) {
    throw new Error('Coverage does not match the exact executed registry definition.');
  }
  const caseIds = new Set(args.observations.map((item) => item.caseId));
  for (const item of args.declared) for (const caseId of item.caseIds) {
    if (!caseIds.has(caseId)) throw new Error(`Coverage for ${args.experimentId} references an unexecuted case.`);
  }
}

export async function prepareRecoveryRecords(input: Input): Promise<void> {
  const rawObservations = prefix + 'observations.json';
  const observations = parseObservations(await readJson(path.join(input.evidence, rawObservations)));
  const bindings = parse(Type.Array(BindingSchema), await readJson(path.join(input.evidence, prefix + 'source-bindings.json')));
  const environment = parse(EnvironmentSchema, await readJson(path.join(input.evidence, prefix + 'environment.json')));
  const findBinding = (filename: string) => {
    const binding = bindings.find((item) => item.path === filename);
    if (!binding) throw new Error(`Missing executed binding ${filename}`);
    return binding;
  };
  const design = findBinding('docs/design/versioned-model-candidate.md');
  const definition = findBinding('docs/experiments/registry.json');
  const fixture = findBinding('experiments/fixtures/tiny-building.json');
  const runner = findBinding('experiments/recovery/postgres.ts');
  for (const binding of bindings) {
    const committed = execFileSync('git', ['-c', `safe.directory=${path.resolve(input.repository)}`, 'show', `${binding.commit}:${binding.path}`],
      { cwd: input.repository });
    if (sha256(committed) !== binding.sha256) throw new Error(`Executed Git binding does not match ${binding.path}`);
  }
  const registryBytes = execFileSync('git', ['-c', `safe.directory=${path.resolve(input.repository)}`, 'show', `${definition.commit}:${definition.path}`],
    { cwd: input.repository, encoding: 'utf8' });
  const registry = parse(RegistrySchema, JSON.parse(registryBytes.replace(/^\uFEFF/, '')));
  const started = await stat(path.join(input.evidence, prefix + 'source-bindings.json'));
  const finished = await stat(path.join(input.evidence, rawObservations));
  const budget = input.diskBudget.kind === 'recorded' ? input.diskBudget.bytes : null;
  const commonPaths = ['MANIFEST.sha256', 'postgres-input.json', 'database-lease.json', 'database-post-run-state.txt',
    'client-image-id.txt', 'runner.exit-code.txt', prefix + 'source-bindings.json', prefix + 'environment.json',
    prefix + 'execution-input.json', rawObservations];
  const commonLimitations = [
    'Terminal interpretation is retrospective; no database or correctness test was rerun to prepare this record.',
    'Times use retained source-binding and final-observation file mtimes as execution bounds, not instrumented process timings.',
    'Client limits were 0.5 CPU and 1536 MiB. Separate databases and artifact roots used one PostgreSQL server and test role.',
  ];
  for (const experimentId of ['EX-09', 'EX-11', 'EX-12']) {
    const executed = observations.filter((item) => item.experimentId === experimentId);
    const declared = coverage[experimentId];
    const specificPaths = artifacts[experimentId];
    const experiment = registry.experiments.find((item) => item.id === experimentId);
    if (!experiment || !declared || !specificPaths || executed.length === 0) throw new Error('Missing recovery experiment evidence.');
    assertCoverage({ experimentId, observations: executed, declared, definition: experiment });
    const evidence: Run['evidence'] = [];
    for (const filename of [...commonPaths, ...specificPaths.map((item) => prefix + item)]) {
      evidence.push(await describeArtifact(input.evidence, filename,
        filename.endsWith('.json') ? 'application/json' : filename.endsWith('.dump') ? 'application/vnd.postgresql.custom-dump' : 'text/plain'));
    }
    const draft: DraftRun = {
      schemaVersion: 1, recordKind: 'draft', experimentId, runId: input.runId,
      executionStatus: 'completed', conclusion: 'inconclusive',
      startedAt: started.mtime.toISOString(), finishedAt: finished.mtime.toISOString(),
      hypothesis: 'The disposable W5 candidate and governed W6 wrapper preserve immutable history, complete publication, retry receipts and review evidence through the declared recovery cases.',
      variant: 'VM-C1; W5 PostgreSQL 15 candidate plus W6 portable packages and explicitly simulated discipline policy; tiny W0 fixture only.',
      design: { candidateId: 'VM-C1', ...design }, definition,
      implementation: { sourceCommit: runner.commit, runnerCommit: runner.commit,
        validators: ['W0 observation parser and evidence/Git verifier', 'W5 canonical hashes and PostgreSQL constraints', 'W6 case assertions and TypeBox boundaries'] },
      dataset: { name: 'W0 qvm-tiny-building-v1 with deterministic W6 changes', seed: 'No random generator used.', manifestSha256: fixture.sha256 },
      environment: { host: `fun-server; client ${environment.host}`, software: { node: environment.node, postgres: environment.version,
        fsync: environment.fsync, synchronous_commit: environment.synchronous_commit, full_page_writes: environment.full_page_writes },
        imageDigests: [environment.imageDigest], cpuLimit: 0.5, memoryLimitBytes: 1536 * 1024 * 1024, diskBudgetBytes: budget,
        storage: '/ssd1/bim-forge-qualification/qvm-20261025/artifacts/w6-0247bdd-postgres-02; independent qvm_w5_recovery databases and artifact roots.',
        cacheProcedure: 'No shared cache flush; correctness execution only; no performance claim.', measurementSlot: environment.leaseId },
      commands: ['node experiments/recovery/postgres.ts /evidence/postgres-input.json /evidence/database-lease.json'],
      observations: executed, observationsArtifact: rawObservations, coverage: declared, evidence, errors: [],
      limitations: [...commonLimitations, ...executed.flatMap((item) => item.limitations),
        ...(input.diskBudget.kind === 'recorded' ? [`Disk-budget provenance: ${input.diskBudget.provenance}`]
          : ['No numeric disk budget was recorded in the correctness execution lease. The required W0 environment field remains unknown; publication is blocked.'])],
      decisionImplications: ['No registry update, architecture adoption or review approval is implied.',
        'EX-09 lacks a real geometry-engine upgrade; EX-12 does not qualify independent identity/key services or a multi-parent/network synchronization service.',
        'W7 must assess scope and limitations against the exact assertion coverage.'],
    };
    if (input.mode === 'publish') {
      if (budget === null) throw new Error('Cannot publish W0 terminal records with an unrecorded disk budget. Draft preparation is available without database work.');
      const run = parseRun({ ...draft, recordKind: 'run', environment: { ...draft.environment, diskBudgetBytes: budget } });
      await verifyRun(run, { repository: input.repository, evidence: input.evidence });
      await publishRun(run, { repository: input.repository, evidence: input.evidence, results: input.results });
    } else {
      const directory = path.join(input.results, experimentId, input.runId);
      await mkdir(path.dirname(directory), { recursive: true });
      await mkdir(directory);
      await writeFile(path.join(directory, 'draft.json'), JSON.stringify(draft, null, 2) + '\n', { flag: 'wx' });
      await writeFile(path.join(directory, 'preparation-audit.json'), JSON.stringify({ recordKind: 'terminal-record-preparation',
        experimentId, sourceCommit: runner.commit, rawObservationsSha256: evidence.find((item) => item.path === rawObservations)?.sha256,
        executedObservationCount: executed.length, exactAssertionCount: declared.length,
        allExecutedGitBindingsVerified: true, hashedArtifactCount: evidence.length,
        observationsArtifact: rawObservations, publicationReady: budget !== null,
        blockers: budget === null ? ['Missing recorded environment.diskBudgetBytes; no numeric value has been invented.'] : [],
        authority: 'Prepared for coordinator review; not a terminal W0 result or approval.',
      }, null, 2) + '\n', { flag: 'wx' });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filename = process.argv[2];
  if (!filename || process.argv.length !== 3) throw new Error('Usage: node experiments/recovery/records.ts <record-preparation-input.json>');
  await prepareRecoveryRecords(parse(InputSchema, await readJson(filename)));
}
