import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { bindingFor, describeArtifact } from '../contracts/records.ts';
import { parseFixture } from '../fixtures/fixture.ts';
import { coverageFor } from './coverage.ts';
import { W0_CONTRACT_COMMIT } from './protocol.ts';
import { runCandidateCases, runSemanticCases } from './runner.ts';

const ArgumentsSchema = Type.Union([
  Type.Tuple([Type.Literal('--artifacts'), Type.String({ minLength: 1 })]),
  Type.Tuple([Type.Literal('--candidate-only'), Type.Literal('--baseline-observations'), Type.String({ minLength: 1 }),
    Type.Literal('--artifacts'), Type.String({ minLength: 1 })]),
]);

async function main(): Promise<void> {
  const args: unknown = process.argv.slice(2);
  if (!Check(ArgumentsSchema, args)) throw new Error('Usage: cli.ts [--candidate-only --baseline-observations <retained-file>] --artifacts <new-directory>');
  const candidateOnly = args[0] === '--candidate-only';
  const output = path.resolve(args[0] === '--candidate-only' ? args[4] : args[1]);
  const baselineBytes = args[0] === '--candidate-only' ? await readFile(args[2], 'utf8') : null;
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const bindings = {
    design: await bindingFor(root, 'docs/design/versioned-model-candidate.md'),
    definition: await bindingFor(root, 'docs/experiments/registry.json'),
    sharedFixture: await bindingFor(root, 'experiments/fixtures/tiny-building.json'),
    observationSchema: await bindingFor(root, 'experiments/contracts/schema.ts'),
    recordWriter: await bindingFor(root, 'experiments/contracts/records.ts'),
    runner: await bindingFor(root, 'experiments/semantic/runner.ts'),
    candidate: await bindingFor(root, 'experiments/semantic/candidate.ts'),
  };
  const registry: unknown = JSON.parse((await readFile(path.join(root, bindings.definition.path), 'utf8')).replace(/^\uFEFF/, ''));
  const referenceInput: unknown = JSON.parse(await readFile(path.join(root, bindings.sharedFixture.path), 'utf8'));
  const referenceFixture = parseFixture(referenceInput);
  // Reserve before execution; an existing run directory is never overwritten.
  await mkdir(output);
  const baselineInput: unknown = baselineBytes === null ? null : JSON.parse(baselineBytes);
  const { observations, artifacts } = candidateOnly ? await runCandidateCases(baselineInput) : await runSemanticCases();
  const coverage = [...(candidateOnly ? [] : coverageFor(registry, observations)), ...coverageFor(registry, observations, 'VM-C1-semantic-prototype')];
  const raw = JSON.stringify({ format: 'w1-standalone-raw-v2',
    variants: candidateOnly ? ['VM-C1-semantic-prototype'] : ['baseline-room-model', 'VM-C1-semantic-prototype'],
    baselineReferenceCommit: 'f6a7db7c1366eea48a3c677e518efe0f2816383b',
    authoritativeW0ContractCommit: W0_CONTRACT_COMMIT, bindings,
    sourceGit: { commit: bindings.runner.commit, repositoryRoot: root,
      verification: 'bindingFor verified committed bytes using the available Git object database.' },
    sharedFixture: { fixture: referenceFixture,
      difference: 'W0 fixture is parsed and bound for comparison; operation cases execute the existing native single-room fixtures, not an adapter of the W0 multilevel graph.' },
    artifacts }, null, 2) + '\n';
  await writeFile(path.join(output, 'raw.json'), raw, { flag: 'wx' });
  await writeFile(path.join(output, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n', { flag: 'wx' });
  const observedBytes = JSON.stringify(observations, null, 2) + '\n';
  await writeFile(path.join(output, 'observations.json'), observedBytes, { flag: 'wx' });
  if (baselineBytes !== null) await writeFile(path.join(output, 'baseline-reference.json'), baselineBytes, { flag: 'wx' });
  const rawArtifact = await describeArtifact(output, 'raw.json', 'application/json');
  const coverageArtifact = await describeArtifact(output, 'coverage.json', 'application/json');
  const observationsArtifact = await describeArtifact(output, 'observations.json', 'application/json');
  const baselineArtifacts = baselineBytes === null ? [] : [await describeArtifact(output, 'baseline-reference.json', 'application/json')];
  const manifest = { ...rawArtifact, observationsArtifact: 'observations.json', evidence: [rawArtifact, coverageArtifact, observationsArtifact, ...baselineArtifacts],
    caseIds: observations.map((item) => item.caseId),
    meaning: 'Standalone case evidence only. Coordinator supplies the actual environment, execution times and run ID to W0 verifyRun/publishRun.' };
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  // Exit zero means collection completed. Each actual qualification assertion remains in passed.
  process.stdout.write(observedBytes);
}

await main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + '\n');
  process.exitCode = 1;
});
