import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RoomRepository, diffSnapshots } from '../src/room-model.ts';
import { syntheticResidentialFixture } from '../src/synthetic-residential-fixture.ts';
import { evidenceCanonical } from '../src/model-evidence.ts';
import type { EvidenceEntry, EvidencePin, EvidenceReadSet, EvidenceSubject, EvidenceUse } from '../src/model-evidence.ts';
import { RequestSourceStore } from './request-source-store.ts';
import { ProjectEvidenceStore, evidenceAnchor, evidenceApplicable, evidenceHash } from './project-evidence-store.ts';

async function setup(t: TestContext, filename = ':memory:') {
  const db = new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON');
  t.after(() => { if (db.isOpen) db.close(); });
  const sources = new RequestSourceStore(db); const store = new ProjectEvidenceStore(db, sources);
  const fixture = syntheticResidentialFixture();
  const repository = await RoomRepository.createProject({ projectId: fixture.projectId, name: 'Synthetic evidence', snapshot: fixture.snapshot });
  const anchor = evidenceAnchor(repository, repository.head('main'), 'wall-living-kitchen');
  const bytes = Buffer.from(fixture.sources.plan.text);
  const source = await sources.add({ projectId: repository.projectId, id: randomUUID(), name: 'synthetic-plan.txt', mediaType: 'text/plain', bytes,
    signal: new AbortController().signal });
  sources.retainProject(repository.projectId, source);
  const entry = (id: string, value = .15): EvidenceEntry => ({ id, anchor,
    property: { definitionId: 'geometry-thickness', valueKind: 'length' }, predecessor: null,
    assertion: { kind: 'measured', value: { kind: 'length', value, unit: 'm' },
      citations: [{ sourceId: source.id, sha256: source.sha256, locator: 'Synthetic plan wall-living-kitchen. Not a survey.' }] } });
  const append = (value: EvidenceEntry, commandId = `cmd-${value.id}`, actor = 'engineer') => store.append({ repository, commandId, actor, entry: value });
  const subject: EvidenceSubject = { anchor, property: entry('shape').property };
  const freeze = (pins: EvidencePin[], subjects: EvidenceSubject[] = []) => store.freezeReadSet({ repository, revisionId: repository.head('main'), pins, subjects });
  return { db, sources, store, fixture, repository, source, bytes, entry, append, subject, freeze };
}

function reviewUse(readSet: EvidenceReadSet, pin: EvidencePin): EvidenceUse {
  const subject = readSet.subjects[0]?.subject; assert.ok(subject);
  return { pin, subject, rationale: 'Use this synthetic observation as the design assumption; human approval is required.' };
}

async function advanceTarget(repository: RoomRepository, target: EvidenceReadSet['target'], name: string, entityId = 'main-bed'): Promise<RoomRepository> {
  const frozen = repository.freezeDesignTarget(target);
  const snapshot = structuredClone(repository.view(frozen.revisionId).snapshot);
  const entity = snapshot.entities.find(item => item.id === entityId); assert.ok(entity); entity.name = `Changed ${name}`;
  const proposed = await repository.proposeReviewedModel({ name, from: frozen.revisionId, target: frozen, snapshot,
    review: { requestId: `request-${name}`, selectedObjectIds: [entityId], instruction: 'Change only this synthetic entity name.',
      summary: 'Deterministic unrelated entity change.', rationale: 'Exercise native target lineage.', constraints: 'Keep other bodies unchanged.',
      uncertainty: 'Synthetic fixture.', worker: { provider: 'fixture', model: 'lineage-test', responseIds: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      toolCalls: [{ name: 'preview_furnishings', status: 'accepted', error: null }], validator: 'room-graph-v1' } });
  return proposed.accept(name, { decisionId: `accept-${name}`, actor: 'engineer' }, frozen);
}

test('superseded consumed roots and inference bases fail strict/review checks while historical predecessors remain in closure', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const original = append(entry('root-original'));
  const before = freeze([original]);
  const inference = append({ ...entry('inference-root'), property: { definitionId: 'inference-value', valueKind: 'length' },
    assertion: { kind: 'inferred', value: { kind: 'length', value: 1, unit: 'm' }, rationale: 'Consumes exact original basis.', basis: [original] } });
  const corrected = append({ ...entry('root-corrected', .16), predecessor: original });
  assert.equal(store.verifyReadSet({ repository, readSet: before }).ready, false);
  const supersededRoot = freeze([original]);
  assert.match(store.verifyReadSet({ repository, readSet: supersededRoot }).reasons.join(' '), /Superseded consumed evidence/);
  assert.equal(store.verifyForReview({ repository, readSet: supersededRoot, uses: [] }).ready, false);
  const supersededBasis = freeze([inference]);
  assert.match(store.verifyReadSet({ repository, readSet: supersededBasis }).reasons.join(' '), /Superseded consumed evidence/);
  assert.equal(store.verifyForReview({ repository, readSet: supersededBasis, uses: [] }).ready, false);
  const correctedRead = freeze([corrected]);
  assert.equal(store.verifyReadSet({ repository, readSet: correctedRead }).ready, true);
  assert.deepEqual(new Set(store.bundleClosure({ repository, pins: [corrected] }).entries.map(item => item.pin.entryId)), new Set([original.entryId, corrected.entryId]));
});

test('sibling target claims stay isolated at shared root and after different body advances, including corrupt irrelevant sources', async t => {
  const { db, sources, store, repository, entry } = await setup(t);
  const a = { kind: 'alternative', id: 'study-a' } satisfies EvidenceReadSet['target'];
  const b = { kind: 'alternative', id: 'study-b' } satisfies EvidenceReadSet['target'];
  let latest = repository.captureBaseline({ id: 'as-is', name: 'As-is', from: repository.freezeDesignTarget({ kind: 'main' }) })
    .forkAlternative({ id: a.id, name: 'Study A', baselineId: 'as-is' }).forkAlternative({ id: b.id, name: 'Study B', baselineId: 'as-is' });
  const anchorA = evidenceAnchor(latest, repository.root(), 'wall-living-kitchen', a);
  const subject: EvidenceSubject = { anchor: anchorA, property: entry('shape').property };
  const frozen = store.freezeReadSet({ repository: latest, revisionId: repository.root(), target: a, pins: [], subjects: [subject] });
  const sourceB = await sources.add({ projectId: repository.projectId, id: randomUUID(), name: 'sibling-b.txt', mediaType: 'text/plain',
    bytes: Buffer.from('Private sibling B observation.'), signal: new AbortController().signal });
  sources.retainProject(repository.projectId, sourceB);
  const sibling = (id: string): EvidenceEntry => ({ ...entry(id),
    anchor: evidenceAnchor(latest, latest.freezeDesignTarget(b).revisionId, 'wall-living-kitchen', b),
    assertion: { kind: 'observed', value: { kind: 'length', value: .2, unit: 'm' }, citations: [{ sourceId: sourceB.id, sha256: sourceB.sha256, locator: 'Study B only.' }] } });
  const first = store.append({ repository: latest, commandId: 'b-first', actor: 'engineer', entry: sibling('b-shared-root') });
  assert.equal(store.verifyReadSet({ repository: latest, readSet: frozen }).ready, true);
  assert.throws(() => store.freezeReadSet({ repository: latest, revisionId: repository.root(), target: a, pins: [first], subjects: [] }), /Inapplicable/);
  latest = await advanceTarget(latest, b, 'different-wall-body', 'wall-living-kitchen');
  store.append({ repository: latest, commandId: 'b-later', actor: 'engineer', entry: sibling('b-different-body') });
  db.prepare('UPDATE request_source_blobs SET bytes=zeroblob(byte_length) WHERE id=?').run(sourceB.id);
  assert.equal(store.verifyReadSet({ repository: latest, readSet: frozen }).ready, true);
  assert.deepEqual(store.freezeReadSet({ repository: latest, revisionId: repository.root(), target: a, pins: [], subjects: [subject] }), frozen);
  assert.deepEqual(store.reviewContext({ repository: latest, readSet: frozen }).entries, []);
});

test('a sibling resolution cannot resolve another target inherited conflict at the same native root', async t => {
  const { store, repository, entry, append } = await setup(t);
  const one = append(entry('parent-one')); const two = append(entry('parent-two', .2));
  const a = { kind: 'alternative', id: 'study-a' } satisfies EvidenceReadSet['target'];
  const b = { kind: 'alternative', id: 'study-b' } satisfies EvidenceReadSet['target'];
  const latest = repository.captureBaseline({ id: 'root-pin', name: 'Root pin', from: repository.freezeDesignTarget({ kind: 'main' }) })
    .forkAlternative({ id: a.id, name: 'Study A', baselineId: 'root-pin' }).forkAlternative({ id: b.id, name: 'Study B', baselineId: 'root-pin' });
  const readSet = store.freezeReadSet({ repository: latest, revisionId: repository.root(), target: a, pins: [one, two], subjects: [] });
  const before = store.verifyReadSet({ repository: latest, readSet }); assert.equal(before.ready, false);
  store.append({ repository: latest, commandId: 'resolve-only-b', actor: 'engineer', entry: { ...entry('resolution-in-b'),
    anchor: evidenceAnchor(latest, repository.root(), 'wall-living-kitchen', b),
    assertion: { kind: 'resolution', candidateIds: [one.entryId, two.entryId], selectedEntryId: one.entryId, rationale: 'Only B selects parent-one.' } } });
  assert.deepEqual(store.verifyReadSet({ repository: latest, readSet }), before);
  assert.equal(store.verifyForReview({ repository: latest, readSet, uses: [reviewUse(readSet, one)] }).ready, true);
  assert.ok(!store.reviewContext({ repository: latest, readSet }).entries.some(item => item.entry.id === 'resolution-in-b'));
});

test('same-destination later native ancestor facts invalidate old read sets after an unrelated bed change', async t => {
  const { store, repository, entry } = await setup(t);
  const originalAnchor = evidenceAnchor(repository, repository.root(), 'office-chair');
  const chair: EvidenceEntry = { ...entry('chair-r'), anchor: originalAnchor, property: { definitionId: 'geometry-width', valueKind: 'length' } };
  const original = store.append({ repository, commandId: 'chair-r', actor: 'engineer', entry: chair });
  const readSet = store.freezeReadSet({ repository, revisionId: repository.root(), pins: [original], subjects: [] });
  const latest = await advanceTarget(repository, { kind: 'main' }, 'bed-change');
  assert.equal(store.verifyReadSet({ repository: latest, readSet }).ready, true);
  const newer: EvidenceEntry = { ...chair, id: 'chair-r-two', anchor: evidenceAnchor(latest, latest.head('main'), 'office-chair') };
  assert.equal(newer.anchor.bodyHash, originalAnchor.bodyHash); assert.notEqual(newer.anchor.revisionId, originalAnchor.revisionId);
  store.append({ repository: latest, commandId: 'chair-r-two', actor: 'engineer', entry: newer });
  assert.match(store.verifyReadSet({ repository: latest, readSet }).reasons.join(' '), /candidate set changed/);
  assert.equal(store.verifyForReview({ repository: latest, readSet, uses: [reviewUse(readSet, original)] }).ready, false);
});

test('immutable baseline ancestry inherits only requested parent chain and caps parent target claims at fork revisions', async t => {
  const { store, repository, entry, append } = await setup(t);
  const parent = append(entry('main-before-fork'));
  const a = { kind: 'alternative', id: 'parent-a' } satisfies EvidenceReadSet['target'];
  const child = { kind: 'alternative', id: 'child-a' } satisfies EvidenceReadSet['target'];
  let latest = repository.captureBaseline({ id: 'main-pin', name: 'Main pin', from: repository.freezeDesignTarget({ kind: 'main' }) })
    .forkAlternative({ id: a.id, name: 'Parent A', baselineId: 'main-pin' });
  const baseline = store.append({ repository: latest, commandId: 'baseline-fact', actor: 'engineer', entry: { ...entry('baseline-fact'),
    anchor: evidenceAnchor(latest, repository.root(), 'wall-living-kitchen', { kind: 'baseline', id: 'main-pin' }) } });
  const inherited = store.append({ repository: latest, commandId: 'a-before-fork', actor: 'engineer', entry: { ...entry('a-before-fork'),
    anchor: evidenceAnchor(latest, repository.root(), 'wall-living-kitchen', a) } });
  latest = latest.captureBaseline({ id: 'a-pin', name: 'A pin', from: latest.freezeDesignTarget(a) })
    .forkAlternative({ id: child.id, name: 'Child A', baselineId: 'a-pin' });
  const readSet = store.freezeReadSet({ repository: latest, revisionId: repository.root(), target: child, pins: [parent, baseline, inherited], subjects: [] });
  assert.equal(store.verifyReadSet({ repository: latest, readSet }).ready, true);
  latest = await advanceTarget(latest, a, 'parent-a-advance');
  store.append({ repository: latest, commandId: 'a-after-fork', actor: 'engineer', entry: { ...entry('a-after-fork'),
    anchor: evidenceAnchor(latest, latest.freezeDesignTarget(a).revisionId, 'wall-living-kitchen', a) } });
  latest = await advanceTarget(latest, { kind: 'main' }, 'main-after-fork');
  store.append({ repository: latest, commandId: 'main-after-fork', actor: 'engineer', entry: { ...entry('main-after-fork'),
    anchor: evidenceAnchor(latest, latest.head('main'), 'wall-living-kitchen') } });
  assert.equal(store.verifyReadSet({ repository: latest, readSet }).ready, true);
  const ids = new Set(store.reviewContext({ repository: latest, readSet }).entries.map(item => item.entry.id));
  assert.ok(ids.has(parent.entryId) && ids.has(baseline.entryId) && ids.has(inherited.entryId));
  assert.ok(!ids.has('a-after-fork') && !ids.has('main-after-fork'));
});

test('explicit review use accepts an unchanged known conflict while strict validation and global originals remain unchanged', async t => {
  const { db, store, repository, entry, append, freeze } = await setup(t);
  const a = append(entry('chosen')); const b = append({ ...entry('competing'), assertion: { kind: 'assumed',
    value: { kind: 'length', value: .2, unit: 'm' }, rationale: 'A competing synthetic assumption.', basis: [] } });
  const readSet = freeze([a, b]); const originalReadSet = evidenceCanonical(readSet);
  const originals = store.page({ projectId: repository.projectId }); const native = repository.serialize();
  const use = reviewUse(readSet, a);
  const strictBefore = store.verifyReadSet({ repository, readSet }); assert.equal(strictBefore.ready, false);
  assert.equal(store.verifyForReview({ repository, readSet, uses: [] }).ready, false);
  const readiness = store.verifyForReview({ repository, readSet, uses: [use] });
  assert.equal(readiness.ready, true); assert.deepEqual(readiness.reasons, []);
  assert.equal(readiness.warnings.length, 1); assert.match(readiness.warnings.join(' '), /human approval.*chosen.*Competing evidence remains unresolved/);
  assert.ok(readiness.warnings[0]?.includes(use.rationale));
  assert.deepEqual(store.verifyReadSet({ repository, readSet }), strictBefore);
  assert.deepEqual(store.page({ projectId: repository.projectId }), originals);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_evidence_receipts').get()?.n, 2);
  assert.equal(repository.serialize(), native); assert.equal(evidenceCanonical(readSet), originalReadSet);
  // A source-backed observation and an assumption are both selectable without promoting either.
  assert.equal(store.verifyForReview({ repository, readSet, uses: [reviewUse(readSet, b)] }).ready, true);
  assert.equal(store.get({ projectId: repository.projectId, pin: b }).entry.assertion.kind, 'assumed');
});

test('review uses refuse new contradictions and changed absence sets after freeze while unrelated facts stay harmless', async t => {
  const { store, repository, entry, append, freeze, subject } = await setup(t);
  const absent = freeze([], [subject]);
  assert.deepEqual(store.verifyForReview({ repository, readSet: absent, uses: [] }), { ready: true, reasons: [], warnings: [] });
  const a = append(entry('chosen')); append(entry('competing', .2));
  assert.equal(store.verifyForReview({ repository, readSet: absent, uses: [] }).ready, false);
  const readSet = freeze([a]); const uses = [reviewUse(readSet, a)];
  append({ ...entry('unrelated'), anchor: evidenceAnchor(repository, repository.root(), 'door-living-kitchen') });
  assert.equal(store.verifyForReview({ repository, readSet, uses }).ready, true);
  append(entry('new-contradiction', .25));
  const readiness = store.verifyForReview({ repository, readSet, uses });
  assert.equal(readiness.ready, false); assert.deepEqual(readiness.warnings, []);
  assert.match(readiness.reasons.join(' '), /candidate set changed/);
});

test('review uses refuse duplicate logical choices, wrong hashes/subjects, unpinned facts and inactive corrected claims', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const a = append(entry('chosen')); const b = append(entry('other', .2));
  const readSet = freeze([a]); const use = reviewUse(readSet, a);
  for (const uses of [[use, { ...use, rationale: 'A second choice on the same subject.', pin: b }],
    [{ ...use, pin: { ...a, hash: '0'.repeat(64) } }], [{ ...use, pin: b }],
    [{ ...use, subject: { ...use.subject, property: { ...use.subject.property, definitionId: 'wrong-property' } } }],
    [{ ...use, subject: { ...use.subject, anchor: { ...use.subject.anchor, revisionId: '0'.repeat(64) } } }]]) {
    assert.equal(store.verifyForReview({ repository, readSet, uses }).ready, false);
  }
  const wrongRootHash: EvidenceReadSet = { ...readSet, pins: [{ ...a, hash: '0'.repeat(64) }] };
  assert.equal(store.verifyForReview({ repository, readSet: wrongRootHash, uses: [{ ...use, pin: wrongRootHash.pins[0] ?? a }] }).ready, false);
  append({ ...entry('correction', .16), predecessor: a });
  const refrozen = freeze([a]);
  assert.equal(store.verifyForReview({ repository, readSet: refrozen, uses: [reviewUse(refrozen, a)] }).ready, false);
});

test('review use does not waive corrupt/missing originals, missing entries, wrong-project or changed native anchors', async t => {
  for (const failure of ['corrupt-source', 'missing-source', 'missing-pin', 'changed-anchor', 'wrong-project']) {
    await t.test(failure, async inner => {
      const { db, store, repository, source, entry, append, freeze } = await setup(inner);
      const a = append(entry('chosen')); append(entry('competing', .2));
      const readSet = freeze([a]); const uses = [reviewUse(readSet, a)];
      let latest = repository;
      if (failure === 'corrupt-source') db.prepare('UPDATE request_source_blobs SET bytes=zeroblob(byte_length) WHERE id=?').run(source.id);
      if (failure === 'missing-source') {
        db.prepare('DELETE FROM request_source_project_retention WHERE source_id=?').run(source.id);
        db.prepare('DELETE FROM request_source_blobs WHERE id=?').run(source.id);
      }
      if (failure === 'missing-pin') db.prepare('DELETE FROM project_evidence_entries WHERE id=?').run(a.entryId);
      if (failure === 'changed-anchor' || failure === 'wrong-project') {
        const graph = repository.view(repository.root()).snapshot;
        latest = await RoomRepository.createProject({ projectId: failure === 'wrong-project' ? randomUUID() : repository.projectId, name: 'Invalid review context',
          snapshot: { ...graph, entities: graph.entities.map(entity => entity.id === entry('shape').anchor.entityId ? { ...entity, name: 'Changed body' } : entity) } });
      }
      const readiness = store.verifyForReview({ repository: latest, readSet, uses });
      assert.equal(readiness.ready, false); assert.deepEqual(readiness.warnings, []);
      assert.throws(() => store.reviewContext({ repository: latest, readSet }));
    });
  }
});

test('review uses cannot waive required unknown facts or contrary resolutions, even when conflicts are acknowledged', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const a = append(entry('chosen')); append(entry('competing', .2));
  const unknown = append({ ...entry('unknown'), property: { definitionId: 'unknown-height', valueKind: 'length' },
    assertion: { kind: 'unknown', reason: 'Height was not observed.' } });
  const withUnknown = freeze([a, unknown]);
  assert.equal(store.verifyForReview({ repository, readSet: withUnknown, uses: [reviewUse(withUnknown, a)] }).ready, false);
  const inference = append({ ...entry('inference'), property: { definitionId: 'derived-unknown', valueKind: 'length' },
    assertion: { kind: 'inferred', value: { kind: 'length', value: 1, unit: 'm' }, rationale: 'Unknown basis remains required.', basis: [unknown] } });
  const withUnknownBasis = freeze([a, inference]);
  assert.equal(store.verifyForReview({ repository, readSet: withUnknownBasis, uses: [reviewUse(withUnknownBasis, a)] }).ready, false);
  append({ ...entry('resolution-a'), assertion: { kind: 'resolution', candidateIds: ['chosen', 'competing'], selectedEntryId: 'chosen', rationale: 'Pick chosen.' } });
  append({ ...entry('resolution-b'), assertion: { kind: 'resolution', candidateIds: ['chosen', 'competing'], selectedEntryId: 'competing', rationale: 'Contrary choice.' } });
  const resolutions = freeze([a]);
  assert.equal(store.verifyReadSet({ repository, readSet: resolutions }).ready, false);
  const readiness = store.verifyForReview({ repository, readSet: resolutions, uses: [reviewUse(resolutions, a)] });
  assert.equal(readiness.ready, false); assert.match(readiness.reasons.join(' '), /Conflicting evidence resolutions/);
  const context = store.reviewContext({ repository, readSet: resolutions });
  assert.ok(context.issues.some(issue => issue.kind === 'conflicting-resolutions'));
  assert.ok(context.entries.some(item => item.entry.id === 'resolution-b'));
  append(entry('third', .25));
  const partialResolutions = freeze([a]);
  assert.equal(store.verifyForReview({ repository, readSet: partialResolutions, uses: [reviewUse(partialResolutions, a)] }).ready, false);
});

test('review context exposes unpinned competitors, unknowns and complete inference/correction dependencies as bounded data', async t => {
  const { store, repository, source, entry, append, freeze } = await setup(t);
  const a = append(entry('chosen')); const competing = append(entry('unpinned-competitor', .2));
  const unknown = append({ ...entry('unknown'), property: { definitionId: 'unknown-property', valueKind: 'length' },
    assertion: { kind: 'unknown', reason: 'Unknown observation remains visible to the model.' } });
  const basisUnknown = append({ ...entry('old-basis'), property: { definitionId: 'basis-property', valueKind: 'length' },
    assertion: { kind: 'unknown', reason: 'Historical basis was unknown.' } });
  const basis = append({ ...entry('corrected-basis'), property: { definitionId: 'basis-property', valueKind: 'length' }, predecessor: basisUnknown });
  const inference = append({ ...entry('inference'), property: { definitionId: 'inference-property', valueKind: 'length' },
    assertion: { kind: 'inferred', value: { kind: 'length', value: 1, unit: 'm' }, rationale: 'Inference basis must be inspectable.', basis: [basis] } });
  const readSet = freeze([a, inference, unknown]);
  const context = store.reviewContext({ repository, readSet });
  assert.equal(context.entries.length, 6);
  assert.deepEqual(new Set(context.entries.map(item => item.pin.entryId)), new Set([a.entryId, competing.entryId, unknown.entryId,
    basisUnknown.entryId, basis.entryId, inference.entryId]));
  assert.ok(!readSet.pins.some(pin => pin.entryId === competing.entryId));
  assert.ok(context.issues.some(issue => issue.kind === 'value-conflict'));
  assert.ok(context.issues.some(issue => issue.kind === 'unknown-required' && issue.entryId === unknown.entryId));
  assert.deepEqual(context.sources, [source]); assert.deepEqual(context.readSet, readSet);
  assert.ok(!evidenceCanonical(context).includes('"bytes"')); assert.ok(Buffer.byteLength(evidenceCanonical(context)) <= 64 * 1024);
  assert.equal(store.verifyReadSet({ repository, readSet }).ready, false);
  assert.equal(store.verifyForReview({ repository, readSet, uses: [reviewUse(readSet, a)] }).ready, false);
  assert.deepEqual(store.page({ projectId: repository.projectId }).entries.length, 6);
});

test('review context refuses signature drift and invalid dependencies, including unpinned competitor basis sources', async t => {
  const { db, store, repository, source, entry, append, freeze } = await setup(t);
  const a = append(entry('chosen')); const readSet = freeze([a]);
  append(entry('new-competitor', .2));
  assert.throws(() => store.reviewContext({ repository, readSet }), /candidate set changed/);
  const fresh = freeze([a]);
  const basis = append({ ...entry('outside-basis'), property: { definitionId: 'outside-property', valueKind: 'length' } });
  append({ ...entry('inferred-competitor'), assertion: { kind: 'inferred', value: { kind: 'length', value: .3, unit: 'm' }, rationale: 'Competing inference.', basis: [basis] } });
  const withInference = freeze([a]);
  assert.ok(store.reviewContext({ repository, readSet: withInference }).entries.some(item => item.pin.entryId === basis.entryId));
  db.prepare('DELETE FROM project_evidence_entries WHERE id=?').run(basis.entryId);
  assert.throws(() => store.reviewContext({ repository, readSet: withInference }), /Missing/);
  assert.throws(() => store.reviewContext({ repository, readSet: fresh }), /candidate set changed/);
  db.prepare('UPDATE request_source_blobs SET bytes=zeroblob(byte_length) WHERE id=?').run(source.id);
  assert.throws(() => store.reviewContext({ repository, readSet: withInference }), /integrity/);
});

test('review context contains 32 complete entries but fails explicitly instead of truncating entry33', async t => {
  const { store, repository, entry, append, freeze, subject } = await setup(t);
  for (let i = 0; i < 32; i++) append({ ...entry(`context-${i}`), assertion: { kind: 'unknown', reason: `Unknown synthetic input ${i}.` } });
  const first = store.reviewContext({ repository, readSet: freeze([], [subject]) });
  assert.equal(first.entries.length, 32);
  append({ ...entry('context-33'), assertion: { kind: 'unknown', reason: 'Must not be silently omitted.' } });
  assert.throws(() => store.reviewContext({ repository, readSet: freeze([], [subject]) }), /Narrow evidence context.*32 entries/);
});

test('review context admits exactly64KiB serialized and fails explicitly on a larger complete context', async t => {
  const { store, repository, entry, append, freeze, subject } = await setup(t);
  const entries: EvidenceEntry[] = Array.from({ length: 16 }, (_, index) => ({ ...entry(`byte-context-${index}`),
    assertion: { kind: 'unknown', reason: 'x'.repeat(3000) } }));
  const placeholder: EvidenceReadSet = { version: 1, projectId: repository.projectId, revisionId: repository.root(), pins: [],
    target: { kind: 'main' }, subjects: [{ subject, signature: '0'.repeat(64) }] };
  const planned = () => ({ entries: entries.map(value => ({ entry: value, pin: { entryId: value.id, hash: evidenceHash(value) } })),
    readSet: placeholder, sources: [], issues: [] });
  let remaining = 64 * 1024 - Buffer.byteLength(evidenceCanonical(planned()));
  assert.ok(remaining > 0);
  for (const value of entries) {
    if (value.assertion.kind !== 'unknown') throw new Error('Expected unknown test input.');
    const extra = Math.min(4096 - value.assertion.reason.length, remaining);
    value.assertion.reason += 'x'.repeat(extra); remaining -= extra;
  }
  assert.equal(remaining, 0); assert.equal(Buffer.byteLength(evidenceCanonical(planned())), 64 * 1024);
  for (const value of entries) append(value);
  const context = store.reviewContext({ repository, readSet: freeze([], [subject]) });
  assert.equal(Buffer.byteLength(evidenceCanonical(context)), 64 * 1024);
  append({ ...entry('one-more-input'), assertion: { kind: 'unknown', reason: 'One more complete input exceeds the serialized limit.' } });
  assert.throws(() => store.reviewContext({ repository, readSet: freeze([], [subject]) }), /Narrow evidence context.*64 KiB/);
});

test('retained synthetic evidence survives request expiry and exposes an inspectable provenance delta without changing geometry', async t => {
  const { db, sources, store, repository, source, bytes, entry, append, freeze } = await setup(t);
  const before = repository.serialize();
  const measured = append(entry('survey'));
  const assumption: EvidenceEntry = { ...entry('assumption', .2), assertion: { kind: 'assumed', value: { kind: 'length', value: .2, unit: 'm' },
    rationale: 'Explicit synthetic conflicting assumption.', basis: [] } };
  const assumed = append(assumption);
  db.prepare('UPDATE request_source_blobs SET created_at=?').run(Date.now() - 25 * 60 * 60 * 1000);
  const restartedSources = new RequestSourceStore(db);
  assert.deepEqual(restartedSources.get(repository.projectId, source.id), { source, bytes });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM request_source_bindings').get()?.n, 0);
  const readSet = freeze([measured]);
  assert.equal(store.verifyReadSet({ repository, readSet }).ready, false);
  const resolution = append({ ...entry('resolution'), assertion: { kind: 'resolution', candidateIds: ['survey', 'assumption'], selectedEntryId: 'survey',
    rationale: 'Engineer chose documented synthetic source; original assumption retained.' } });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([measured, resolution]) }).ready, true);
  const closure = store.bundleClosure({ repository, pins: [resolution] });
  assert.equal(closure.complete, true);
  assert.deepEqual(closure.entries.map(item => ({ id: item.entry.id, kind: item.entry.assertion.kind })), [
    { id: 'resolution', kind: 'resolution' }, { id: 'survey', kind: 'measured' }, { id: 'assumption', kind: 'assumed' }]);
  assert.deepEqual(closure.sources, [source]); assert.ok(!evidenceCanonical(closure).includes('bytes'));
  assert.deepEqual(store.get({ projectId: repository.projectId, pin: assumed }).entry, assumption);
  assert.equal(repository.serialize(), before);
  assert.deepEqual(diffSnapshots(repository.view(repository.head('main')).snapshot, repository.view(repository.root()).snapshot), {
    entities: { added: [], removed: [], modified: [] }, relationships: { added: [], removed: [], modified: [] } });
  assert.deepEqual(sources.retained(repository.projectId, source.id), source);
});

test('corrections append with predecessor CAS; original claims and receipts remain immutable after advance', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const original = entry('original'); const pin = append(original);
  const corrected: EvidenceEntry = { ...entry('correction', .16), predecessor: pin };
  const correction = append(corrected);
  assert.deepEqual(append(original), pin);
  assert.deepEqual(append({ property: original.property, assertion: original.assertion, anchor: original.anchor, predecessor: null, id: original.id }), pin);
  assert.throws(() => append({ ...original, assertion: { kind: 'unknown', reason: 'Changed command payload.' } }), /payload or actor/);
  assert.throws(() => append(original, 'cmd-original', 'different-actor'), /payload or actor/);
  assert.throws(() => append({ ...entry('racing-correction'), predecessor: pin }), /CAS/);
  assert.deepEqual(store.get({ projectId: repository.projectId, pin }).entry, original);
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([correction]) }).ready, true);
  assert.equal(store.page({ projectId: repository.projectId }).entries.length, 2);
  const snapshot = repository.view(repository.root()).snapshot;
  const lostOriginalRevision = await RoomRepository.createProject({ projectId: repository.projectId, name: 'Same project new graph',
    snapshot: { ...snapshot, entities: snapshot.entities.map(entity => entity.id === original.anchor.entityId ? { ...entity, name: 'Changed anchor body' } : entity) } });
  assert.notEqual(lostOriginalRevision.root(), original.anchor.revisionId);
  assert.equal(evidenceApplicable(lostOriginalRevision, original.anchor, lostOriginalRevision.root()), false);
  assert.deepEqual(store.append({ repository: lostOriginalRevision, actor: 'engineer', commandId: 'cmd-original', entry: original }), pin);
});

test('absence and source/body applicability are frozen; unrelated subject facts preserve readiness', async t => {
  const { db, store, repository, entry, append, freeze, subject } = await setup(t);
  const absent = freeze([], [subject]);
  assert.equal(store.verifyReadSet({ repository, readSet: absent }).ready, true);
  append({ ...entry('unrelated'), anchor: evidenceAnchor(repository, repository.head('main'), 'door-living-kitchen') });
  assert.equal(store.verifyReadSet({ repository, readSet: absent }).ready, true);
  const pin = append(entry('new-fact'));
  assert.match(store.verifyReadSet({ repository, readSet: absent }).reasons.join(' '), /previously absent/);
  const reviewed = freeze([pin]);
  append(entry('contradiction', .18));
  const status = store.verifyReadSet({ repository, readSet: reviewed });
  assert.equal(status.ready, false); assert.match(status.reasons.join(' '), /conflict/);
  const refrozen = freeze([pin]);
  assert.match(store.verifyReadSet({ repository, readSet: refrozen }).reasons.join(' '), /conflict/);
  db.prepare('UPDATE request_source_blobs SET bytes=zeroblob(byte_length)').run();
  assert.equal(store.verifyReadSet({ repository, readSet: refrozen }).ready, false);
  assert.equal(store.bundleClosure({ repository, pins: [pin] }).complete, false);
});

test('equivalent engineering units are not conflicts; assumptions remain assumptions', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const m = append(entry('metres'));
  const mm = append({ ...entry('millimetres'), assertion: { kind: 'assumed', value: { kind: 'length', value: 150, unit: 'mm' },
    rationale: 'Same value; no promotion.', basis: [] } });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([m, mm]) }).ready, true);
  assert.equal(store.get({ projectId: repository.projectId, pin: mm }).entry.assertion.kind, 'assumed');
});

test('inferred facts freeze their basis subjects and cannot hide a later basis contradiction', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const basis = append(entry('basis'));
  const inferred = append({ ...entry('inferred'), property: { definitionId: 'estimated-width', valueKind: 'length' },
    assertion: { kind: 'inferred', value: { kind: 'length', value: 2, unit: 'm' }, rationale: 'Synthetic derivation.', basis: [basis] } });
  const readSet = freeze([inferred]);
  assert.equal(readSet.subjects.length, 2);
  append(entry('basis-conflict', .2));
  assert.equal(store.verifyReadSet({ repository, readSet }).ready, false);
});

test('sources require explicit same-project retention and exact hashes; stale native anchors are rejected', async t => {
  const { sources, store, repository, source, entry, append } = await setup(t);
  const upload = await sources.add({ projectId: repository.projectId, id: randomUUID(), name: 'not-retained.txt', mediaType: 'text/plain',
    bytes: Buffer.from('unretained'), signal: new AbortController().signal });
  const cited = (id: string, sourceId: string, sha256 = source.sha256): EvidenceEntry => ({ ...entry(id),
    assertion: { kind: 'documented', value: { kind: 'length', value: .15, unit: 'm' }, citations: [{ sourceId, sha256, locator: 'Original input' }] } });
  assert.throws(() => append(cited('unretained', upload.id, upload.sha256)), /not retained/);
  assert.throws(() => append(cited('missing', randomUUID())), /not retained/);
  assert.throws(() => append(cited('hash-mismatch', source.id, '0'.repeat(64))), /hash mismatch/);
  assert.throws(() => append({ ...entry('bad-body'), anchor: { ...entry('x').anchor, bodyHash: '0'.repeat(64) } }), /anchor/);
  assert.throws(() => append({ ...entry('bad-revision'), anchor: { ...entry('x').anchor, revisionId: '0'.repeat(64) } }), /anchor/);
  const foreign = await RoomRepository.createProject({ projectId: randomUUID(), name: 'Other project', snapshot: repository.view(repository.root()).snapshot });
  assert.throws(() => store.append({ repository: foreign, entry: entry('foreign'), commandId: 'cmd-foreign', actor: 'engineer' }), /anchor/);
  assert.throws(() => sources.retained(foreign.projectId, source.id), /not retained/);
  assert.throws(() => sources.retainProject(foreign.projectId, source), /Unknown/);
  const foreignSource = await sources.add({ projectId: foreign.projectId, id: randomUUID(), name: 'other-project.txt', mediaType: 'text/plain',
    bytes: Buffer.from('Private other project fact.'), signal: new AbortController().signal });
  sources.retainProject(foreign.projectId, foreignSource);
  assert.throws(() => append(cited('foreign-source', foreignSource.id, foreignSource.sha256)), /not retained/);
  const pin = append(entry('private'));
  assert.throws(() => store.get({ projectId: foreign.projectId, pin }), /Missing/);
  assert.equal(store.bundleClosure({ repository: foreign, pins: [pin] }).complete, false);
  assert.equal(store.verifyReadSet({ repository: foreign, readSet: store.freezeReadSet({ repository, revisionId: repository.root(), pins: [pin], subjects: [] }) }).ready, false);
});

test('native property kinds and changed body applicability cannot be forged; unchanged bodies remain applicable', async t => {
  const { store, repository, entry, append } = await setup(t);
  assert.throws(() => append({ ...entry('wrong-native-kind'), property: { definitionId: 'geometry-thickness', valueKind: 'number' },
    assertion: { kind: 'assumed', value: { kind: 'number', value: .15 }, rationale: 'Wrong engineering type.', basis: [] } }), /native parameter kind/);
  const doorAnchor = evidenceAnchor(repository, repository.root(), 'door-entry');
  const proposed = await repository.propose({ name: 'narrow-entry', from: repository.root(), doorWidthM: .95 });
  assert.equal(evidenceApplicable(proposed, doorAnchor, proposed.head('narrow-entry')), false);
  assert.equal(evidenceApplicable(proposed, entry('same-wall').anchor, proposed.head('narrow-entry')), true);
  assert.throws(() => store.freezeReadSet({ repository: proposed, revisionId: proposed.head('narrow-entry'), pins: [],
    subjects: [{ anchor: doorAnchor, property: { definitionId: 'geometry-width', valueKind: 'length' } }] }), /inapplicable/);
});

test('resolutions retain competing originals, conflict with contrary resolutions and do not cover new contradictions', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const a = append(entry('a')); append(entry('b', .2));
  const resolution: EvidenceEntry = { ...entry('resolution-a'), assertion: { kind: 'resolution', candidateIds: ['a', 'b'], selectedEntryId: 'a', rationale: 'Choose synthetic a.' } };
  const chosen = append(resolution);
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([a, chosen]) }).ready, true);
  const contrary = append({ ...entry('resolution-b'), assertion: { kind: 'resolution', candidateIds: ['a', 'b'], selectedEntryId: 'b', rationale: 'Contrary choice.' } });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([a, chosen, contrary]) }).ready, false);
  const correctedResolution = append({ ...resolution, id: 'resolution-b-corrected', predecessor: contrary });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([a, chosen, correctedResolution]) }).ready, true);
  append(entry('c', .25));
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([a, chosen]) }).ready, false);
  assert.equal(store.get({ projectId: repository.projectId, pin: contrary }).entry.assertion.kind, 'resolution');
});

test('unknown dependencies block readiness while explicit corrections preserve original unknown history', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const unknown = append({ ...entry('unknown'), assertion: { kind: 'unknown', reason: 'No observation available.' } });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([unknown]) }).ready, false);
  const corrected = append({ ...entry('later-observation'), predecessor: unknown });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([corrected]) }).ready, true);
  assert.equal(store.get({ projectId: repository.projectId, pin: unknown }).entry.assertion.kind, 'unknown');
  const inference = append({ ...entry('inference-from-unknown'), property: { definitionId: 'derived-length', valueKind: 'length' },
    assertion: { kind: 'inferred', value: { kind: 'length', value: .15, unit: 'm' }, rationale: 'Unknown basis must stay visible.', basis: [unknown] } });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([inference]) }).ready, false);
});

test('two independent SQLite connections arbitrate predecessor CAS and command replay on one ledger', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-evidence-cas-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const filename = path.join(directory, 'race.sqlite');
  const { store, repository, entry, append } = await setup(t, filename);
  const original = append(entry('original'));
  const otherDb = new DatabaseSync(filename); t.after(() => otherDb.close());
  const other = new ProjectEvidenceStore(otherDb, new RequestSourceStore(otherDb));
  assert.deepEqual(other.get({ projectId: repository.projectId, pin: original }), store.get({ projectId: repository.projectId, pin: original }));
  const correction: EvidenceEntry = { ...entry('winner'), predecessor: original };
  const pin = append(correction);
  assert.throws(() => other.append({ repository, commandId: 'loser', actor: 'engineer', entry: { ...entry('loser'), predecessor: original } }), /CAS/);
  assert.deepEqual(other.append({ repository, commandId: 'cmd-winner', actor: 'engineer', entry: correction }), pin);
});

test('request read sets are immutable and atomic with parent writes, retention and command receipts', async t => {
  const { db, sources, store, repository, entry, append, freeze } = await setup(t);
  const pin = append(entry('durable')); const readSet = freeze([pin]);
  store.pinReadSet({ requestId: 'request', readSet }); store.pinReadSet({ requestId: 'request', readSet });
  assert.deepEqual(store.readPinned({ projectId: repository.projectId, requestId: 'request' }), readSet);
  assert.throws(() => store.pinReadSet({ requestId: 'request', readSet: freeze([]) }), /immutable/);
  const transient = await sources.add({ projectId: repository.projectId, id: randomUUID(), name: 'transient.txt', mediaType: 'text/plain', bytes: Buffer.from('transactional'), signal: new AbortController().signal });
  db.exec('BEGIN IMMEDIATE');
  sources.retainProject(repository.projectId, transient);
  const rolled = append(entry('rolled-back'));
  store.pinReadSet({ requestId: 'rolled-back-request', readSet: freeze([rolled]) });
  db.exec('ROLLBACK');
  assert.throws(() => sources.retained(repository.projectId, transient.id), /not retained/);
  assert.throws(() => store.get({ projectId: repository.projectId, pin: rolled }), /Missing/);
  assert.equal(store.readPinned({ projectId: repository.projectId, requestId: 'rolled-back-request' }), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_evidence_receipts WHERE command_id=?').get('cmd-rolled-back')?.n, 0);
  assert.deepEqual(append(entry('rolled-back')), rolled);
  db.exec(`CREATE TEMP TRIGGER fail_receipt BEFORE INSERT ON project_evidence_receipts BEGIN SELECT RAISE(ABORT,'receipt failure'); END`);
  assert.throws(() => append(entry('failed-receipt')), /receipt failure/);
  assert.equal(store.page({ projectId: repository.projectId }).entries.some(item => item.entry.id === 'failed-receipt'), false);
  db.exec('DROP TRIGGER fail_receipt'); append(entry('failed-receipt'));
});

test('SQLite restart restores receipts, original source bytes and immutable read pins', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-evidence-199-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const filename = path.join(directory, 'evidence.sqlite');
  const { db, repository, source, bytes, entry, append, freeze } = await setup(t, filename);
  const original = entry('original'); const pin = append(original); const readSet = freeze([pin]);
  new ProjectEvidenceStore(db, new RequestSourceStore(db)).pinReadSet({ requestId: 'request', readSet });
  db.prepare('UPDATE request_source_blobs SET created_at=?').run(Date.now() - 48 * 60 * 60 * 1000);
  db.close();
  const reopened = new DatabaseSync(filename); t.after(() => reopened.close());
  const sources = new RequestSourceStore(reopened); const store = new ProjectEvidenceStore(reopened, sources);
  assert.deepEqual(sources.get(repository.projectId, source.id), { source, bytes });
  assert.deepEqual(store.readPinned({ projectId: repository.projectId, requestId: 'request' }), readSet);
  assert.equal(store.verifyReadSet({ repository, readSet }).ready, true);
  assert.deepEqual(store.append({ repository, entry: original, commandId: 'cmd-original', actor: 'engineer' }), pin);
  assert.throws(() => store.append({ repository, entry: { ...original, assertion: { kind: 'unknown', reason: 'different' } }, commandId: 'cmd-original', actor: 'engineer' }), /payload or actor/);
});

test('bounded indexed keyset paging and entry/project/pin caps reject overflow without hydration', async t => {
  const { db, store, repository, entry, append, freeze, subject } = await setup(t);
  const pins: EvidencePin[] = [];
  for (let i = 0; i < 256; i++) pins.push(append(entry(`entry-${i}`)));
  assert.throws(() => append(entry('overflow')), /256 entries or 4 MiB/);
  assert.equal(store.page({ projectId: repository.projectId, limit: 20 }).entries.length, 20);
  const found: string[] = []; let after = 0;
  for (let page = 0; page < 13; page++) {
    const value = store.page({ projectId: repository.projectId, after, limit: 20 });
    found.push(...value.entries.map(item => item.entry.id));
    if (value.next === null) break;
    after = value.next;
  }
  assert.equal(found.length, 256); assert.equal(new Set(found).size, 256);
  assert.throws(() => store.page({ projectId: repository.projectId, limit: 21 }), /limit/);
  assert.throws(() => store.page({ projectId: repository.projectId, after: -1 }), /cursor/);
  assert.equal(freeze(pins.slice(0, 32)).pins.length, 32);
  assert.throws(() => freeze(pins.slice(0, 33)), /32 pins/);
  assert.throws(() => freeze([], Array.from({ length: 33 }, () => subject)), /32 pins/);
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT body FROM project_evidence_entries WHERE project_id=? AND entity_id=? AND property_id=? ORDER BY sequence LIMIT 257')
    .all(repository.projectId, subject.anchor.entityId, subject.property.definitionId);
  assert.match(JSON.stringify(plan), /project_evidence_subject/);
  const pagePlan = db.prepare('EXPLAIN QUERY PLAN SELECT body FROM project_evidence_entries WHERE project_id=? AND sequence>? ORDER BY sequence LIMIT 21').all(repository.projectId, 0);
  assert.match(JSON.stringify(pagePlan), /project_evidence_page/);
});

test('UTF-8 byte admission and stored hashes detect oversized or corrupted facts', async t => {
  const { db, store, repository, source, entry, append } = await setup(t);
  const tooLarge: EvidenceEntry = { ...entry('too-large'), assertion: { kind: 'documented', value: { kind: 'length', value: .15, unit: 'm' },
    citations: [{ sourceId: source.id, sha256: source.sha256, locator: 'ø'.repeat(4096) },
      { sourceId: source.id, sha256: source.sha256, locator: 'å'.repeat(4096) }] } };
  assert.throws(() => append(tooLarge), /16 KiB/);
  const pin = append(entry('intact'));
  const original = store.get({ projectId: repository.projectId, pin });
  assert.equal(pin.hash, evidenceHash(original.entry));
  db.prepare('UPDATE project_evidence_entries SET body=? WHERE id=?').run(evidenceCanonical({ ...original.entry, assertion: { kind: 'unknown', reason: 'tampered' } }), pin.entryId);
  assert.throws(() => store.get({ projectId: repository.projectId, pin }), /integrity/);
});

test('exact 16 KiB entry and 4 MiB project boundaries are admitted; one more UTF-8 byte or entry is refused', async t => {
  const { db, source, store, repository, entry, append } = await setup(t);
  const largeEntry = (index: number): EvidenceEntry => {
    const value: EvidenceEntry = { ...entry(`large-${index}`), property: { definitionId: `custom-evidence-${index}`, valueKind: 'length' },
      assertion: { kind: 'documented', value: { kind: 'length', value: .15, unit: 'm' }, citations: ['a'.repeat(4096), 'b'.repeat(4096), 'c'.repeat(4096), 'x']
        .map(locator => ({ sourceId: source.id, sha256: source.sha256, locator })) } };
    const remaining = 16 * 1024 - Buffer.byteLength(evidenceCanonical(value));
    assert.ok(remaining > 0 && remaining < 4096);
    if (value.assertion.kind !== 'documented') throw new Error('Expected documented test entry.');
    const final = value.assertion.citations.at(-1); assert.ok(final);
    final.locator += 'x'.repeat(remaining);
    assert.equal(Buffer.byteLength(evidenceCanonical(value)), 16 * 1024);
    return value;
  };
  const exact = largeEntry(0); append(exact);
  if (exact.assertion.kind !== 'documented') throw new Error('Expected documented test entry.');
  const locator = exact.assertion.citations.at(-1); assert.ok(locator); locator.locator += 'x';
  assert.throws(() => append(exact), /16 KiB/);
  for (let i = 1; i < 256; i++) append(largeEntry(i));
  assert.equal(db.prepare('SELECT SUM(byte_length) AS bytes FROM project_evidence_entries WHERE project_id=?').get(repository.projectId)?.bytes, 4 * 1024 * 1024);
  assert.throws(() => append(entry('one-too-many')), /256 entries or 4 MiB/);
  assert.equal(store.page({ projectId: repository.projectId, limit: 1 }).entries.length, 1);
});
