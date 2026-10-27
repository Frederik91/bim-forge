import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import type { TestContext } from 'node:test';
import { ProjectEvidenceStore, evidenceAnchor } from '../demo/project-evidence-store.ts';
import { RequestSourceStore } from '../demo/request-source-store.ts';
import { evidenceCanonical } from './model-evidence.ts';
import type { EvidenceEntry, EvidenceUse } from './model-evidence.ts';
import { prepareModelProposal } from './model-proposal.ts';
import type { ModelWorker, ModelWorkerSession, ProposalEvidenceContext } from './model-proposal.ts';
import { ModelScripts } from './model-script.ts';
import { RoomRepository, diffSnapshots, validateSnapshot } from './room-model.ts';
import { syntheticResidentialFixture } from './synthetic-residential-fixture.ts';
import { previewWallShift } from './wall-dependencies.ts';

const scripts = new ModelScripts();
after(() => scripts.dispose());
const reviewText = {
  summary: 'Preview a 200 mm shared-wall shift using an explicit evidence assumption.',
  rationale: 'Use the selected synthetic measurement for this bounded design study.',
  constraints: 'Retain contents, hosted openings and the competing evidence.',
  uncertainty: 'Conflicting synthetic facts remain unresolved; human approval is required.',
  intent: { interpretation: 'Shift the living/kitchen partition.', assumptions: ['Use the selected fact for this proposal only.'],
    certainty: 10, basis: 'Known competing synthetic facts require an explicit review assumption.' },
};
const shift = "await model.previewWallShift({wallId:'wall-living-kitchen',offsetMetres:0.2});";
function worker(run: (session: ModelWorkerSession) => Promise<void>): ModelWorker {
  return { identity: { provider: 'test', model: 'evidence-review-real-wasm' }, run };
}

async function setup(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sourceStore = new RequestSourceStore(db);
  const store = new ProjectEvidenceStore(db, sourceStore);
  const fixture = syntheticResidentialFixture();
  const repository = await RoomRepository.createProject({ projectId: fixture.projectId, name: 'Bounded evidence review', snapshot: fixture.snapshot });
  const baseRevisionId = repository.head('main');
  const anchor = evidenceAnchor(repository, baseRevisionId, 'wall-living-kitchen');
  const source = await sourceStore.add({ projectId: repository.projectId, id: randomUUID(), name: 'synthetic-plan.txt',
    mediaType: 'text/plain', bytes: Buffer.from(fixture.sources.plan.text), signal: new AbortController().signal });
  sourceStore.retainProject(repository.projectId, source);
  const entry = (id: string, value: number): EvidenceEntry => ({ id, anchor,
    property: { definitionId: 'geometry-thickness', valueKind: 'length' }, predecessor: null,
    assertion: { kind: 'measured', value: { kind: 'length', value, unit: 'm' },
      citations: [{ sourceId: source.id, sha256: source.sha256, locator: 'Generated synthetic input, not a survey.' }] } });
  const one = entry('synthetic-plan', .15); const two = entry('synthetic-measurement', .2);
  const pins = [one, two].map(claim => store.append({ repository, commandId: `append-${claim.id}`, actor: 'test-engineer', entry: claim }));
  const readSet = store.freezeReadSet({ repository, revisionId: baseRevisionId, pins, subjects: [] });
  const context = store.reviewContext({ repository, readSet });
  const evidenceContext: ProposalEvidenceContext = { ...context, entries: context.entries.map(item => item.entry) };
  const pin = pins[0]; const subject = readSet.subjects[0]?.subject;
  assert.ok(pin && subject);
  const use: EvidenceUse = { pin, subject, rationale: 'Use the generated plan value only for this design; retain the conflicting measurement for human review.' };
  const input = { requestId: 'evidence-assumption', proposalName: 'evidence-assumption', baseRevisionId,
    selectedObjectIds: ['wall-living-kitchen'], instruction: 'Preview a 200 mm shared-wall shift using the plan as a design assumption.',
    visualIntent: { kind: 'selection' }, evidencePins: pins };
  const base = repository.view(baseRevisionId).snapshot;
  const preview = previewWallShift(base, { wallId: 'wall-living-kitchen', offsetMetres: .2 });
  const native = { name: input.proposalName, from: baseRevisionId, snapshot: preview.snapshot,
    review: { requestId: input.requestId, selectedObjectIds: input.selectedObjectIds, instruction: input.instruction,
      ...reviewText, worker: { provider: 'test', model: 'native', responseIds: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      toolCalls: [{ name: 'inspect_model', status: 'accepted', error: null }], validator: 'room-graph-v1', evidence: readSet, evidenceUses: [use] } };
  return { repository, store, fixture, input, readSet, evidenceContext, use, base, preview, native };
}
function source(review: unknown): string { return `${shift} return {kind:'propose',review:${JSON.stringify(review)}};`; }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function tamper(repository: RoomRepository, change: (review: Record<string, unknown>) => void): string {
  const value: unknown = JSON.parse(repository.serialize());
  assert.ok(object(value) && Array.isArray(value.reviews) && object(value.reviews[0]));
  change(value.reviews[0]);
  return JSON.stringify(value);
}

test('real WASM carries a chosen competing fact into a bounded wall delta and exact human-reviewed native restore', async t => {
  const data = await setup(t); const original = data.repository.serialize();
  assert.equal(data.store.verifyReadSet({ repository: data.repository, readSet: data.readSet }).ready, false);
  const readiness = data.store.verifyForReview({ repository: data.repository, readSet: data.readSet, uses: [data.use] });
  assert.equal(readiness.ready, true); assert.match(readiness.warnings.join(' '), /Competing evidence remains unresolved/);
  const result = await prepareModelProposal(data.repository, data.input, worker(async session => {
    assert.match(session.instructions, /review\.evidenceUses/);
    assert.match(session.instructions, /never promotes a claim to global truth/);
    assert.match(session.instructions, /model\.previewWallShift/);
    assert.ok(object(session.input)); assert.deepEqual(session.input.sourceEvidence, data.evidenceContext);
    assert.equal(data.evidenceContext.entries.length, 2); assert.ok(data.evidenceContext.sources?.length);
    assert.equal(data.evidenceContext.issues?.[0]?.kind, 'value-conflict');
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: source({ ...reviewText, evidenceUses: [data.use] }) });
    assert.equal(output.ok, true, JSON.stringify(output)); assert.equal(output.done, true);
  }), () => {}, { scripts, evidenceContext: data.evidenceContext });
  assert.equal(result.status, 'ready'); assert.equal(data.repository.serialize(), original);
  assert.equal(result.repository.head('main'), data.repository.head('main'));
  const review = result.repository.review(data.input.proposalName);
  assert.deepEqual(review.evidenceUses, [data.use]); assert.deepEqual(review.evidence, data.readSet);
  assert.equal(review.intent?.certainty, 10, 'self-rating grants no acceptance authority and does not block a valid proposal');
  assert.equal(review.decision.status, 'pending');
  assert.equal(review.scriptExecutions?.[0]?.runtime.guestAbi, 2);
  assert.equal(review.scriptExecutions?.[0]?.validation, 'passed');
  const snapshot = result.repository.view(review.proposalRevisionId).snapshot;
  assert.deepEqual(validateSnapshot(snapshot), data.preview.snapshot);
  assert.deepEqual(diffSnapshots(data.base, snapshot), data.preview.delta);
  assert.deepEqual(data.preview.delta.entities.modified.map(item => item.id).sort(), ['room-kitchen', 'room-living', 'wall-living-kitchen']);
  assert.deepEqual(snapshot.entities.find(item => item.id === 'door-living-kitchen'), data.base.entities.find(item => item.id === 'door-living-kitchen'));
  assert.deepEqual(snapshot.relationships, data.base.relationships);
  const pending = await RoomRepository.restore(result.repository.serialize());
  assert.equal(pending.serialize(), result.repository.serialize());
  const accepted = pending.accept(data.input.proposalName, { decisionId: 'human-assumption', actor: 'Human reviewer' });
  assert.deepEqual((await RoomRepository.restore(accepted.serialize())).review(data.input.proposalName).evidenceUses, [data.use]);
  assert.equal(data.store.verifyReadSet({ repository: data.repository, readSet: data.readSet }).ready, false, 'proposal acceptance does not resolve the global conflict');
  assert.deepEqual(data.store.reviewContext({ repository: data.repository, readSet: data.readSet }),
    { ...data.evidenceContext, entries: data.evidenceContext.entries.map(entry => ({ entry,
      pin: { entryId: entry.id, hash: createHash('sha256').update(evidenceCanonical(entry)).digest('hex') } })) });
});

test('strict guest decisions reject malformed choices before allowing a corrected real WASM proposal', async t => {
  const data = await setup(t);
  const invalid = [null, [{ ...data.use, extra: true }], [{ ...data.use, rationale: ' ' }],
    [{ ...data.use, pin: { ...data.use.pin, hash: 'bad' } }], [data.use, { ...data.use, rationale: 'Duplicate subject.' }]];
  const result = await prepareModelProposal(data.repository, data.input, worker(async session => {
    for (const evidenceUses of invalid) {
      const output = await session.executeTool('run_model_script', { language: 'javascript', source: source({ ...reviewText, evidenceUses }) });
      assert.equal(output.ok, false, JSON.stringify(output));
    }
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: source({ ...reviewText, evidenceUses: [data.use] }) });
    assert.equal(output.ok, true, JSON.stringify(output));
  }), () => {}, { scripts, evidenceContext: data.evidenceContext });
  assert.equal(result.status, 'ready');
  assert.equal(result.repository.review(data.input.proposalName).scriptExecutions?.filter(item => item.validation === 'failed').length, invalid.length);
});

test('host rejects exact-schema choices that forge pins or subjects, even at full intent certainty', async t => {
  const data = await setup(t);
  const other = data.evidenceContext.entries[1]; assert.ok(other);
  const choices = [
    { ...data.use, pin: { ...data.use.pin, hash: 'f'.repeat(64) } },
    { ...data.use, subject: { ...data.use.subject, anchor: { ...data.use.subject.anchor, bodyHash: 'f'.repeat(64) } } },
    { ...data.use, subject: { ...data.use.subject, anchor: { ...data.use.subject.anchor, target: { kind: 'baseline', id: 'other' } } } },
    { ...data.use, subject: { ...data.use.subject, property: { ...data.use.subject.property, definitionId: 'geometry-height' } } },
  ];
  for (const use of choices) {
    await assert.rejects(prepareModelProposal(data.repository, data.input, worker(async session => {
      const output = await session.executeTool('run_model_script', { language: 'typescript',
        source: source({ ...reviewText, intent: { ...reviewText.intent, certainty: 100 }, evidenceUses: [use] }) });
      assert.equal(output.ok, false, JSON.stringify(output)); assert.match(String(output.error), /exact pinned/);
    }), () => {}, { scripts, evidenceContext: data.evidenceContext }), /lost execution authority/);
  }
  const unselected = { ...data.evidenceContext, readSet: { ...data.readSet, pins: [data.use.pin] } };
  const otherUse = { ...data.use, pin: { entryId: other.id, hash: createHash('sha256').update(evidenceCanonical(other)).digest('hex') } };
  await assert.rejects(prepareModelProposal(data.repository, { ...data.input, evidencePins: [data.use.pin] }, worker(async session => {
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: source({ ...reviewText, evidenceUses: [otherUse] }) });
    assert.equal(output.ok, false, 'a real competing entry still requires a selected pin');
  }), () => {}, { scripts, evidenceContext: unselected }), /lost execution authority/);
  assert.equal(data.repository.head('main'), data.input.baseRevisionId);
});

test('host requires a read set even for empty uses, and rejects changed context or target before running the worker', async t => {
  const data = await setup(t);
  const { evidencePins, ...withoutPins } = data.input; assert.ok(evidencePins.length);
  await assert.rejects(prepareModelProposal(data.repository, withoutPins, worker(async session => {
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: source({ ...reviewText, evidenceUses: [] }) });
    assert.equal(output.ok, false); assert.match(String(output.error), /require a frozen evidence read set/);
  }), () => {}, { scripts }), /lost execution authority/);
  const neverRun = worker(async () => { assert.fail('Invalid context must fail before generation.'); });
  for (const evidenceContext of [
    { ...data.evidenceContext, readSet: { ...data.readSet, target: { kind: 'alternative', id: 'same-root' } } },
    { ...data.evidenceContext, entries: [] },
    { ...data.evidenceContext, entries: data.evidenceContext.entries.map(entry => ({ ...entry, id: 'changed' })) },
    { ...data.evidenceContext, readSet: { ...data.readSet, pins: [] } },
  ] satisfies ProposalEvidenceContext[]) {
    await assert.rejects(prepareModelProposal(data.repository, data.input, neverRun, () => {}, { scripts, evidenceContext }), /evidence|binding/);
  }
});

test('host checks the chosen context claim itself: unknowns, resolutions, superseded values and mismatched subjects cannot become assumptions', async t => {
  const data = await setup(t); const chosen = data.evidenceContext.entries.find(entry => entry.id === data.use.pin.entryId); assert.ok(chosen);
  const invalid: EvidenceEntry[] = [
    { ...chosen, assertion: { kind: 'unknown', reason: 'The value is not known.' } },
    { ...chosen, assertion: { kind: 'resolution', candidateIds: ['synthetic-plan', 'synthetic-measurement'],
      selectedEntryId: 'synthetic-plan', rationale: 'A resolution is not a chosen fact.' } },
    { ...chosen, property: { ...chosen.property, definitionId: 'geometry-height' } },
  ];
  for (const entry of invalid) {
    const pin = { entryId: entry.id, hash: createHash('sha256').update(evidenceCanonical(entry)).digest('hex') };
    const evidenceContext = { ...data.evidenceContext,
      readSet: { ...data.readSet, pins: data.readSet.pins.map(item => item.entryId === pin.entryId ? pin : item) },
      entries: data.evidenceContext.entries.map(item => item.id === entry.id ? entry : item) };
    await assert.rejects(prepareModelProposal(data.repository, { ...data.input, evidencePins: evidenceContext.readSet.pins }, worker(async session => {
      const output = await session.executeTool('run_model_script', { language: 'typescript',
        source: source({ ...reviewText, evidenceUses: [{ ...data.use, pin }] }) });
      assert.equal(output.ok, false); assert.match(String(output.error), /active value claims/);
    }), () => {}, { scripts, evidenceContext }), /lost execution authority/);
  }
  const correction: EvidenceEntry = { ...chosen, id: 'corrected-plan', predecessor: data.use.pin };
  await assert.rejects(prepareModelProposal(data.repository, data.input, worker(async session => {
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: source({ ...reviewText, evidenceUses: [data.use] }) });
    assert.equal(output.ok, false); assert.match(String(output.error), /active value claims/);
  }), () => {}, { scripts, evidenceContext: { ...data.evidenceContext, entries: [...data.evidenceContext.entries, correction] } }), /lost execution authority/);
});

test('native reviews enforce exact choices, fields, readable rationale and read-set target during creation and restore', async t => {
  const data = await setup(t); const proposal = await data.repository.proposeReviewedModel(data.native);
  assert.deepEqual(proposal.review(data.input.proposalName).evidenceUses, [data.use]);
  assert.equal((await RoomRepository.restore(proposal.serialize())).serialize(), proposal.serialize());
  const invalidUses: unknown[] = [null, [{ ...data.use, extra: true }], [{ ...data.use, rationale: '' }],
    [{ ...data.use, pin: { ...data.use.pin, hash: 'bad' } }], [{ ...data.use, pin: { ...data.use.pin, hash: 'e'.repeat(64) } }],
    [{ ...data.use, subject: { ...data.use.subject, anchor: { ...data.use.subject.anchor, bodyHash: 'e'.repeat(64) } } }],
    [{ ...data.use, subject: { ...data.use.subject, anchor: { ...data.use.subject.anchor, target: { kind: 'alternative', id: 'sibling' } } } }],
    [data.use, { ...data.use, rationale: 'Duplicate.' }]];
  for (const evidenceUses of invalidUses) {
    await assert.rejects(data.repository.proposeReviewedModel({ ...data.native, review: { ...data.native.review, evidenceUses } }));
    await assert.rejects(RoomRepository.restore(tamper(proposal, review => { review.evidenceUses = evidenceUses; })));
  }
  for (const evidenceUses of [[], [data.use]]) {
    const { evidence, ...review } = data.native.review; assert.ok(evidence);
    await assert.rejects(data.repository.proposeReviewedModel({ ...data.native, review: { ...review, evidenceUses } }), /require a frozen/);
    await assert.rejects(RoomRepository.restore(tamper(proposal, review => { delete review.evidence; review.evidenceUses = evidenceUses; })), /require a frozen/);
  }
  await assert.rejects(data.repository.proposeReviewedModel({ ...data.native, review: { ...data.native.review,
    evidence: { ...data.readSet, target: { kind: 'alternative', id: 'other' } } } }), /target must match/);
  await assert.rejects(RoomRepository.restore(tamper(proposal, review => {
    assert.ok(object(review.evidence)); review.evidence.target = { kind: 'alternative', id: 'other' };
  })), /target must match/);
});

test('read-set and review targets match explicitly on alternatives while inherited main subjects retain their exact target', async t => {
  const data = await setup(t);
  const repository = data.repository.captureBaseline({ id: 'original', name: 'Original', from: data.repository.freezeDesignTarget({ kind: 'main' }) })
    .forkAlternative({ id: 'study', name: 'Study', baselineId: 'original' });
  const target = repository.freezeDesignTarget({ kind: 'alternative', id: 'study' });
  const evidence = { ...data.readSet, target: target.target };
  const proposed = await repository.proposeReviewedModel({ ...data.native, target, review: { ...data.native.review, evidence } });
  assert.equal((await RoomRepository.restore(proposed.serialize())).serialize(), proposed.serialize());
  assert.deepEqual(proposed.review(data.input.proposalName).evidenceUses?.[0]?.subject.anchor.target, { kind: 'main' });
  await assert.rejects(repository.proposeReviewedModel({ ...data.native, target }), /target must match/);
});

test('review identity includes exact evidence assumptions and rationale on acceptance', async t => {
  const data = await setup(t); const proposal = await data.repository.proposeReviewedModel(data.native);
  const altered = await RoomRepository.restore(tamper(proposal, review => {
    assert.ok(Array.isArray(review.evidenceUses) && object(review.evidenceUses[0]));
    review.evidenceUses[0].rationale = 'A changed assumption that was not reviewed.';
  }));
  await assert.rejects(proposal.acceptFrom(altered, data.input.proposalName, { decisionId: 'changed-use', actor: 'reviewer' }), /review evidence changed/);
  assert.equal(proposal.head('main'), data.input.baseRevisionId);
});

test('legacy no-evidence reviews retain serialization, version and revision hash preimages', async t => {
  const data = await setup(t);
  const { evidence, evidenceUses, ...review } = data.native.review; assert.ok(evidence && evidenceUses);
  const proposed = await data.repository.proposeReviewedModel({ ...data.native, review });
  assert.equal(proposed.persistence().version, 2);
  assert.equal(Object.hasOwn(proposed.review(data.input.proposalName), 'evidence'), false);
  assert.equal(Object.hasOwn(proposed.review(data.input.proposalName), 'evidenceUses'), false);
  assert.equal(proposed.head(data.input.proposalName), createHash('sha256').update(evidenceCanonical({ version: 1,
    parentId: data.input.baseRevisionId, snapshot: data.preview.snapshot })).digest('hex'));
  assert.equal((await RoomRepository.restore(proposed.serialize())).serialize(), proposed.serialize());
  const accepted = proposed.accept(data.input.proposalName, { decisionId: 'legacy-decision', actor: 'reviewer' });
  assert.equal((await RoomRepository.restore(accepted.serialize())).serialize(), accepted.serialize());
});
