import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { RoomRepository, identifier, validateSnapshot } from '../../src/room-model.ts';
import { concurrencyCases, emptyReservedRegion, northWallGap } from './concurrency.ts';
import { change, current, entity, fixture, furniture, move } from './fixture.ts';
import { coverageFor } from './coverage.ts';
import { identityCases } from './identity.ts';
import { parseObservations } from './protocol.ts';
import type { CaseResult, Observation } from './protocol.ts';
import { runCandidateCases, runSemanticCases } from './runner.ts';
import { SemanticCandidate, canonical } from './candidate.ts';
import type { Predicate } from './candidate.ts';
import { candidateCases, candidateCommand, candidateDraft } from './candidate-cases.ts';

function caseById(cases: CaseResult[], caseId: string): CaseResult {
  const value = cases.find((item) => item.observation.caseId === caseId);
  assert.ok(value, `Missing ${caseId}`);
  return value;
}

async function baselineForComparison(): Promise<Observation[]> {
  const filename = process.env.W1_BASELINE_OBSERVATIONS;
  if (filename) {
    const input: unknown = JSON.parse(await readFile(filename, 'utf8'));
    return parseObservations(input);
  }
  return [...await identityCases(), ...await concurrencyCases()].map((item) => item.observation);
}

test('native identity, distinct chairs, and occurrence isolation retain exact real baseline evidence', async () => {
  const cases = await identityCases();
  for (const id of ['native-identity-restore', 'identical-chair-occurrences', 'duplicate-native-id',
    'occurrence-edit-isolation', 'explicit-family-fork-scope']) {
    assert.equal(caseById(cases, id).observation.passed, true, id);
    assert.ok(caseById(cases, id).artifact.operations.length > 0);
  }
  for (const id of ['native-id-churn-lineage', 'native-split-merge-lineage', 'paired-real-exports-not-covered', 'general-shared-properties-not-covered']) {
    assert.equal(caseById(cases, id).observation.passed, false, id);
    assert.ok(caseById(cases, id).observation.limitations.length > 0);
  }
  const gap = caseById(cases, 'native-split-merge-lineage');
  assert.match(gap.observation.observed, /person-split-a/);
  assert.match(gap.observation.observed, /person-merged/);
  assert.match(gap.observation.observed, /Unexpected model fields/);
});

test('concurrency evidence distinguishes supported rejection from qualification gaps', async () => {
  const cases = await concurrencyCases();
  for (const id of ['independent-desk-then-bed', 'independent-bed-then-desk',
    'cross-object-overlap-desk-meeting', 'cross-object-overlap-chair-meeting',
    'divergent-same-property', 'units-and-dependent-values']) {
    assert.equal(caseById(cases, id).observation.passed, true, id);
  }
  for (const id of ['phantom-empty-region-assumption', 'acceptance-command-payload-retry',
    'changed-destination-wall-valid-geometry', 'unrelated-change-approval-equivalence', 'declared-independent-metadata-fields']) {
    assert.equal(caseById(cases, id).observation.passed, false, id);
  }
  assert.match(caseById(cases, 'declared-independent-metadata-fields').observation.observed, /Conflicting changes to chair-one/);
  assert.match(caseById(cases, 'acceptance-command-payload-retry').observation.observed, /already has a decision/);
});

const AppliedRawSchema = Type.Object({ applied: Type.String() });
const OutcomeRawSchema = Type.Object({ outcome: Type.Object({ kind: Type.Literal('returned'), repository: Type.String() }) });

test('both orders contain actual desk and bed values while stale assumptions remain geometrically valid', async () => {
  const cases = await concurrencyCases();
  const snapshots = [];
  for (const id of ['independent-desk-then-bed', 'independent-bed-then-desk']) {
    const raw = caseById(cases, id).artifact.raw;
    assert.ok(Check(AppliedRawSchema, raw));
    const restored = await RoomRepository.restore(raw.applied);
    const snapshot = current(restored);
    const desk = entity(snapshot, 'desk-one'); const bed = entity(snapshot, 'bed-one');
    assert.ok(desk.type === 'Furniture' && bed.type === 'Furniture');
    assert.deepEqual(desk.position, [1.4, 2]); assert.deepEqual(bed.position, [4.2, 2.5]);
    assert.equal(restored.reviews().length, 2);
    assert.ok(restored.reviews().every((item) => item.decision.status !== 'pending'));
    snapshots.push(snapshot);
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
  const phantom = caseById(cases, 'phantom-empty-region-assumption').artifact.raw;
  assert.ok(Check(OutcomeRawSchema, phantom));
  const phantomApplied = await RoomRepository.restore(phantom.outcome.repository);
  assert.equal(emptyReservedRegion(current(phantomApplied)), false);
  assert.deepEqual(phantomApplied.review('reserved-desk').intent?.assumptions,
    ['Region x=[0.6,2.0], y=[0.7,2.5] remains empty except desk-one.']);
  const wall = caseById(cases, 'changed-destination-wall-valid-geometry').artifact.raw;
  assert.ok(Check(OutcomeRawSchema, wall));
  const wallApplied = await RoomRepository.restore(wall.outcome.repository);
  assert.ok(Math.abs(northWallGap(current(wallApplied)) - 1.4) < 1e-9);
});

test('fixture and complete case observations are deterministic across independent runs', async () => {
  const a = await fixture(); const b = await fixture();
  assert.equal(a.serialize(), b.serialize());
  assert.equal(emptyReservedRegion(current(a)), true);
  const first = await runSemanticCases(); const second = await runSemanticCases();
  assert.deepEqual(first, second);
  assert.equal(new Set(first.observations.map((item) => item.experimentId)).size, 5);
  assert.deepEqual(first.observations.map((item) => item.caseId), first.artifacts.map((item) => item.caseId));
  assert.ok(first.observations.some((item) => item.passed));
  assert.ok(first.observations.some((item) => !item.passed));
});

test('observation boundary rejects forged fields, non-booleans and duplicate case identities', () => {
  const observation: Observation = { experimentId: 'EX-01', caseId: 'native', expected: 'stable', observed: 'stable', passed: true, limitations: [] };
  assert.deepEqual(parseObservations([observation]), [observation]);
  assert.throws(() => parseObservations([{ ...observation, approved: true }]), /Invalid/);
  assert.throws(() => parseObservations([{ ...observation, passed: 'true' }]), /Invalid/);
  assert.throws(() => parseObservations([{ ...observation, experimentId: 'EX-13' }]), /Invalid/);
  assert.throws(() => parseObservations([observation, observation]), /unique/);
});

test('coverage accounts for exact W0 definition assertions and refuses stale definitions or unobserved cases', async () => {
  const registry: unknown = JSON.parse(await readFile(new URL('../../docs/experiments/registry.json', import.meta.url), 'utf8'));
  const { observations } = await runSemanticCases();
  const coverage = coverageFor(registry, observations);
  assert.equal(coverage.length, 5);
  assert.equal(coverage.find((item) => item.experimentId === 'EX-01')?.coverage[0]?.coverage, 'partial');
  assert.equal(coverage.find((item) => item.experimentId === 'EX-03')?.coverage[2]?.coverage, 'not-covered');
  assert.throws(() => coverageFor({ experiments: [] }, observations), /stale/);
  assert.throws(() => coverageFor(registry, observations.filter((item) => item.caseId !== 'native-identity-restore')), /unobserved/);
  const candidateCoverage = coverageFor(registry, observations, 'VM-C1-semantic-prototype');
  assert.equal(candidateCoverage.find((item) => item.experimentId === 'EX-03')?.coverage[0]?.coverage, 'not-covered');
  assert.ok(candidateCoverage.flatMap((item) => item.coverage).every((item) => item.caseIds.every((id) => id.startsWith('vmc1-'))));
});

test('VM-C1 compares the same expectations against independently executed native inputs', async () => {
  const baseline = await baselineForComparison();
  const candidate = await candidateCases(baseline);
  for (const item of candidate) {
    const reference = baseline.find((base) => `vmc1-${base.caseId}` === item.observation.caseId);
    assert.ok(reference);
    assert.equal(item.observation.expected, reference.expected);
    assert.equal(item.artifact.variant, 'VM-C1-semantic-prototype');
    assert.equal(item.observation.passed, true, item.observation.caseId);
    assert.ok(item.artifact.operations.length > 0);
    assert.ok(item.observation.limitations.length > 0);
  }
  for (const id of ['native-id-churn-lineage', 'native-split-merge-lineage', 'phantom-empty-region-assumption',
    'changed-destination-wall-valid-geometry', 'acceptance-command-payload-retry', 'declared-independent-metadata-fields']) {
    assert.equal(baseline.find((item) => item.caseId === id)?.passed, false);
    assert.equal(caseById(candidate, `vmc1-${id}`).observation.passed, true);
  }
});

test('candidate-only collection retains partial coverage without executing baseline cases', async () => {
  const baseline = await baselineForComparison();
  const { observations } = await runCandidateCases(baseline);
  assert.equal(observations.length, 13);
  assert.ok(observations.every((item) => item.caseId.startsWith('vmc1-')));
  const registry: unknown = JSON.parse(await readFile(new URL('../../docs/experiments/registry.json', import.meta.url), 'utf8'));
  const coverage = coverageFor(registry, observations, 'VM-C1-semantic-prototype');
  assert.equal(coverage.length, 5);
  assert.equal(coverage.find((item) => item.experimentId === 'EX-03')?.coverage[0]?.coverage, 'not-covered');
  await assert.rejects(runCandidateCases(observations), /requires baseline/);
});

test('candidate-only CLI binds observationsArtifact and retained baseline without rerunning it', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'bim-forge-w1-candidate-'));
  const baselinePath = path.join(parent, 'baseline.json');
  const output = path.join(parent, 'run');
  const { writeFile } = await import('node:fs/promises');
  const baseline = await baselineForComparison();
  const baselineBytes = JSON.stringify(baseline) + '\n';
  await writeFile(baselinePath, baselineBytes);
  const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
  const execute = promisify(execFile);
  const args = [cli, '--candidate-only', '--baseline-observations', baselinePath, '--artifacts', output];
  try {
    const executed = await execute(process.execPath, args, { maxBuffer: 4 * 1024 * 1024 });
    const parsed: unknown = JSON.parse(executed.stdout);
    const observations = parseObservations(parsed);
    assert.equal(observations.length, 13);
    assert.ok(observations.every((item) => item.caseId.startsWith('vmc1-')));
    assert.equal(await readFile(path.join(output, 'baseline-reference.json'), 'utf8'), baselineBytes);
    assert.deepEqual(JSON.parse(await readFile(path.join(output, 'observations.json'), 'utf8')), observations);
    const manifest: unknown = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    const ManifestSchema = Type.Object({ observationsArtifact: Type.Literal('observations.json'),
      evidence: Type.Array(Type.Object({ path: Type.String(), bytes: Type.Integer(), sha256: Type.String() })) });
    assert.ok(Check(ManifestSchema, manifest));
    for (const artifact of manifest.evidence) {
      const bytes = await readFile(path.join(output, artifact.path));
      assert.equal(bytes.length, artifact.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
    }
    await assert.rejects(execute(process.execPath, args), /EEXIST/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('candidate command receipts preserve original payload and head across retries after subsequent edits', async () => {
  const root = SemanticCandidate.create(current(await fixture()));
  const snapshot = root.head().snapshot;
  const draft = candidateDraft(root, 'move-desk', move(snapshot, 'desk-one', [1.4, 2]));
  const command = candidateCommand(draft);
  const first = root.apply(command);
  const later = first.state.apply(candidateCommand(candidateDraft(first.state, 'move-bed', move(first.state.head().snapshot, 'bed-one', [4.2, 2.5]))));
  const before = later.state.serialize();
  const retry = later.state.apply({ draft, actor: command.actor, commandId: command.commandId });
  assert.equal(retry.state, later.state);
  assert.deepEqual(retry.receipt, first.receipt);
  assert.equal(retry.state.serialize(), before);
  assert.throws(() => later.state.apply({ ...command, actor: 'Altered fixture actor' }), /changed payload/);
  assert.throws(() => later.state.apply({ ...command, draft: { ...draft, fieldRule: 'isolated-furniture-name-kind-v1' } }), /changed payload/);
  assert.throws(() => later.state.apply({ ...command, commandId: 'different-command' }), /already has an application receipt/);
  assert.throws(() => later.state.apply({ ...command, approved: true }), /boundary/);
  assert.equal(later.state.serialize(), before);
  assert.throws(() => Object.defineProperty(retry.receipt, 'actor', { value: 'Changed' }), TypeError);
});

test('candidate predicates affect revision identity and reject later phantom insertions without partial publication', async () => {
  const root = SemanticCandidate.create(current(await fixture())); const snapshot = root.head().snapshot;
  const predicate: Predicate = { kind: 'empty-region', bounds: { minX: .6, minY: .7, maxX: 2, maxY: 2.5 }, exceptId: 'desk-one' };
  const moved = move(snapshot, 'desk-one', [1.4, 2]);
  const bare = root.apply(candidateCommand(candidateDraft(root, 'move-desk', moved)));
  const constrained = root.apply(candidateCommand(candidateDraft(root, 'move-desk', moved, { predicates: [predicate] })));
  assert.notEqual(bare.state.head().id, constrained.state.head().id);
  assert.equal(canonical(bare.state.head().snapshot), canonical(constrained.state.head().snapshot));
  assert.equal(constrained.receipt.equivalence.checks[0]?.passed, true);
  const insertion = candidateDraft(root, 'insert-chair', validateSnapshot({ ...snapshot, entities: [...snapshot.entities,
    furniture({ id: 'phantom-chair', kind: 'chair', position: [1, 1] })] }));
  const before = constrained.state.serialize();
  assert.throws(() => constrained.state.apply(candidateCommand(insertion)), /predicate requires renewed review/);
  assert.equal(constrained.state.serialize(), before);
  assert.equal(constrained.state.receipts().length, 1);
  assert.throws(() => candidateDraft(root, 'invalid-region', moved, { predicates: [{ ...predicate,
    bounds: { minX: -1, minY: 0, maxX: 2, maxY: 2 } }] }), /clear native room bounds/);
  assert.throws(() => root.apply({ ...candidateCommand(insertion), draft: { ...insertion,
    baseRevisionId: 'f'.repeat(64) } }), /ancestry/);
});

test('candidate field independence is opt-in, rejects shape edits, and still rejects divergent same-field values', async () => {
  const root = SemanticCandidate.create(current(await fixture())); const snapshot = root.head().snapshot;
  const rule = { fieldRule: 'isolated-furniture-name-kind-v1' } satisfies { fieldRule: 'isolated-furniture-name-kind-v1' };
  const renamedSnapshot = change(snapshot, 'chair-one', (item) => ({ ...item, name: 'Occurrence alpha' }));
  const rename = candidateDraft(root, 'rename-chair', renamedSnapshot, rule);
  const named = root.apply(candidateCommand(rename));
  const classification = change(snapshot, 'chair-one', (item) => {
    if (item.type !== 'Furniture') throw new Error('Expected chair fixture.');
    return { ...item, kind: 'plant' };
  });
  assert.throws(() => named.state.apply(candidateCommand(candidateDraft(root, 'classify-chair', classification))), /Entity conflict/);
  const independent = candidateDraft(root, 'classify-chair', classification, rule);
  const undeclared = root.apply(candidateCommand(candidateDraft(root, 'rename-without-rule', renamedSnapshot)));
  assert.throws(() => undeclared.state.apply(candidateCommand(independent)), /not declared by the prior application/);
  const merged = named.state.apply(candidateCommand(independent));
  const chair = entity(merged.state.head().snapshot, 'chair-one');
  assert.ok(chair.type === 'Furniture');
  assert.equal(chair.name, 'Occurrence alpha'); assert.equal(chair.kind, 'plant');
  const shape = change(snapshot, 'chair-one', (item) => {
    if (item.type !== 'Furniture') throw new Error('Expected chair fixture.');
    return { ...item, width: .5 };
  });
  assert.throws(() => named.state.apply(candidateCommand(candidateDraft(root, 'wide-chair', shape, rule))), /cannot establish independence/);
  const divergent = candidateDraft(root, 'rename-other', change(snapshot, 'chair-one', (item) => ({ ...item, name: 'Occurrence beta' })), rule);
  assert.throws(() => named.state.apply(candidateCommand(divergent)), /Divergent field conflict/);
});

test('candidate lineage binds actual deltas, rejects fabricated endpoints, and prevents resurrection of native identities', async () => {
  const root = SemanticCandidate.create(current(await fixture())); const snapshot = root.head().snapshot;
  const replacement = change(snapshot, 'chair-one', (item) => ({ ...item, id: identifier('chair-recreated') }));
  assert.throws(() => candidateDraft(root, 'recreate-chair', replacement), /complete explicit object lineage/);
  assert.throws(() => candidateDraft(root, 'recreate-chair', replacement, { lineage: [
    { kind: 'replace', sources: ['chair-two'], targets: ['chair-recreated'] },
  ] }), /Lineage endpoints/);
  const draft = candidateDraft(root, 'recreate-chair', replacement, { lineage: [
    { kind: 'replace', sources: ['chair-one'], targets: ['chair-recreated'] },
  ] });
  const before = root.serialize();
  assert.throws(() => root.apply(candidateCommand({ ...draft, lineage: [] })), /complete explicit object lineage/);
  assert.equal(root.serialize(), before);
  const applied = root.apply(candidateCommand(draft));
  assert.deepEqual(applied.receipt.lineage, draft.lineage);
  assert.deepEqual(applied.state.head().lineage, draft.lineage);
  assert.throws(() => candidateDraft(applied.state, 'resurrect-chair', snapshot, { lineage: [
    { kind: 'replace', sources: ['chair-recreated'], targets: ['chair-one'] },
  ] }), /Historical native identity/);
  assert.throws(() => root.apply({ ...candidateCommand(draft), draft: { ...draft, lineage: [
    { kind: 'split', sources: ['chair-one'], targets: ['chair-recreated', 'chair-recreated'] },
  ] } }), /Lineage endpoints/);
});

test('CLI emits the protocol array, binds raw bytes by hash, and refuses to overwrite a run directory', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'bim-forge-w1-'));
  const output = path.join(parent, 'run');
  const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
  const execute = promisify(execFile);
  try {
    const first = await execute(process.execPath, [cli, '--artifacts', output], { maxBuffer: 4 * 1024 * 1024 });
    const parsed: unknown = JSON.parse(first.stdout);
    const observations = parseObservations(parsed);
    assert.ok(observations.some((item) => !item.passed));
    const raw = await readFile(path.join(output, 'raw.json'), 'utf8');
    const manifest: unknown = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    const ManifestSchema = Type.Object({ sha256: Type.String(), bytes: Type.Integer(), caseIds: Type.Array(Type.String()) });
    assert.ok(Check(ManifestSchema, manifest));
    assert.equal(manifest.sha256, createHash('sha256').update(raw).digest('hex'));
    assert.equal(manifest.bytes, Buffer.byteLength(raw));
    assert.deepEqual(manifest.caseIds, observations.map((item) => item.caseId));
    await assert.rejects(execute(process.execPath, [cli, '--artifacts', output]), /EEXIST/);
    assert.equal(await readFile(path.join(output, 'raw.json'), 'utf8'), raw);
    await assert.rejects(execute(process.execPath, [cli, '--artifacts', path.join(parent, 'other'), '--approve']), /Usage/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
