import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { RoomRepository, previewAssets } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';
import { DraftContinuation, GeometryEvidenceSession, GeometryEvidenceConflict,
  GeometryProposalValidationError, geometrySnapshotHash, validateGeometryEvidence } from './geometry-evidence.ts';
import type { GeometryEvidence } from './geometry-evidence.ts';
import type { GeometryMeasureRequest } from './geometry-contract.ts';
import { FixtureGeometrySource, evidenceWall } from './geometry-evidence.fixture.ts';

const chatId = 'runtime-lineage-chat';
const removedId = 'runtime-cube-x';
const retainedId = 'runtime-cube-y';
type Native = Parameters<typeof GeometryEvidenceSession.open>[0]['native'];

function native(repository: RoomRepository): Native {
  const history = repository.geometryHistory();
  return { snapshot: history.head.snapshot, revisionId: history.head.id, target: history.target };
}

function cubes(base: ModelSnapshot, options: { x?: number | null; y?: number | null } = {}): ModelSnapshot {
  const positions = [{ id: removedId, x: options.x === undefined ? 1 : options.x },
    { id: retainedId, x: options.y === undefined ? 2 : options.y }];
  return previewAssets(base, {
    families: [{ id: 'runtime-cube-family', type: 'AssetFamily', name: 'Runtime cube', description: 'Lineage fixture cube',
      parts: [{ id: 'body', kind: 'box', min: [0, 0, 0], size: [1, 1, 1], color: '#546778' }] }],
    instances: positions.flatMap(position => position.x === null ? [] : [{ id: position.id, type: 'AssetInstance',
      name: position.id, familyId: 'runtime-cube-family', position: [position.x, 2], rotationDeg: 0,
      size: { width: .5, depth: .5, height: .5 }, placement: { kind: 'single-room' } }]),
    removeInstanceIds: positions.filter(position => position.x === null && base.entities.some(entity => entity.id === position.id))
      .map(position => position.id),
  });
}

function measureBox(id: string, x: number, against: GeometryMeasureRequest['against']): GeometryMeasureRequest {
  return { subject: { kind: 'box', candidateId: id, bounds: { min: [x - .25, 1.75, 0], max: [x + .25, 2.25, .5] },
    localToProject: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] },
    against, operation: 'clearance', clearanceMetres: .5 };
}

async function firstGeneration(queryForRemoved = false) {
  const repository = await RoomRepository.create();
  const source = new FixtureGeometrySource();
  const history = repository.geometryHistory();
  const session = await GeometryEvidenceSession.open({ source, projectId: repository.projectId, requestId: 'runtime-first',
    native: native(repository), history, chatId, signal: new AbortController().signal });
  try {
    const page = await session.query({ query: { classes: ['IfcWall'] } });
    assert.ok(page.kind !== 'unavailable');
    const wall = page.items.find(item => item.ref.kind === 'ifc');
    assert.ok(wall);
    const against = { kind: 'object', ref: wall.ref } satisfies GeometryMeasureRequest['against'];
    const xRequest = measureBox(removedId, 1, queryForRemoved ? { kind: 'query', query: { categories: ['wall'] } } : against);
    const yRequest = measureBox(retainedId, 2, against);
    assert.equal((await session.measure(xRequest)).kind, 'complete');
    assert.equal((await session.measure(yRequest)).kind, 'complete');
    const snapshot = cubes(history.head.snapshot);
    const evidence = await session.seal(snapshot);
    assert.ok(evidence); assert.equal(evidence.version, 2);
    return { repository, source, snapshot, evidence, xRequest, yRequest };
  } finally { await session.close(); }
}

async function continueGeneration(t: TestContext, input: {
  repository: RoomRepository; source: FixtureGeometrySource; snapshot: ModelSnapshot; evidence: GeometryEvidence;
}, requestId: string) {
  const history = input.repository.geometryHistory();
  const continuation = await DraftContinuation.fromPrior({ chatId, history,
    predecessor: { evidence: input.evidence, snapshot: input.snapshot } });
  const session = await GeometryEvidenceSession.open({ source: input.source, projectId: input.repository.projectId, requestId,
    native: native(input.repository), history, chatId, continuation, signal: new AbortController().signal });
  t.after(() => session.close());
  return { session, continuation, history };
}

async function acceptSnapshot(repository: RoomRepository, snapshot: ModelSnapshot, name: string): Promise<RoomRepository> {
  const proposed = await repository.proposeReviewedModel({ name, from: repository.head('main'), snapshot,
    review: { requestId: name, selectedObjectIds: [], instruction: 'Accept this deterministic fixture change.',
      summary: 'Fixture change', rationale: 'Establish accepted native history.', constraints: 'Preserve unrelated model data.',
      uncertainty: 'Synthetic fixture only.', worker: { provider: 'fixture', model: 'native-history', responseIds: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      toolCalls: [{ name: 'inspect_model', status: 'accepted', error: null }], validator: 'room-graph-v1' } });
  return proposed.accept(name, { decisionId: `${name}-decision`, actor: 'fixture-human' });
}

function unrelatedSnapshot(repository: RoomRepository): ModelSnapshot {
  const history = repository.geometryHistory();
  const snapshot = history.validateSnapshots([{ ...history.head.snapshot,
    entities: history.head.snapshot.entities.map(entity => entity.id === 'wall-north'
      ? { ...entity, name: 'Unrelated accepted wall name' } : entity) }])[0];
  assert.ok(snapshot);
  return snapshot;
}

test('inherited box removal retains original history and independently replays the remaining candidate', async t => {
  const first = await firstGeneration();
  const acceptedBefore = first.repository.serialize();
  const { session, continuation, history } = await continueGeneration(t, first, 'runtime-second');
  const snapshot = cubes(continuation.initialDraft, { x: null });
  const evidence = await session.seal(snapshot);
  assert.ok(evidence); assert.equal(evidence.version, 2);
  assert.deepEqual(evidence.receipts, first.evidence.receipts);
  assert.deepEqual(evidence.measurements, first.evidence.measurements);
  const proof = await validateGeometryEvidence({ evidence, source: first.source, native: native(first.repository), history,
    authoredSnapshot: snapshot, candidate: snapshot, signal: new AbortController().signal });
  assert.ok(proof.finalMeasurements.some(measurement => measurement.request.subject.kind === 'object'
    && measurement.request.subject.ref.kind === 'native' && measurement.request.subject.ref.entityId === retainedId));
  assert.equal(proof.finalMeasurements.some(measurement => measurement.request.subject.kind === 'object'
    && measurement.request.subject.ref.kind === 'native' && measurement.request.subject.ref.entityId === removedId), false);
  assert.equal(first.repository.serialize(), acceptedBefore);
});

test('retained candidate clearance is still enforced when another inherited box becomes inactive', async t => {
  const first = await firstGeneration();
  const { session, continuation } = await continueGeneration(t, first, 'runtime-retained-gap');
  await assert.rejects(session.seal(cubes(continuation.initialDraft, { x: null, y: .75 })), error => {
    assert.ok(error instanceof GeometryProposalValidationError);
    assert.equal(error.diagnostic.code, 'clearance-violated'); return true;
  });
});

test('repeated continuations keep removal history and reactivate old clearance when the same ID returns', async t => {
  const first = await firstGeneration();
  const second = await continueGeneration(t, first, 'runtime-second');
  const one = cubes(second.continuation.initialDraft, { x: null });
  const secondEvidence = await second.session.seal(one); assert.ok(secondEvidence);
  const third = await continueGeneration(t, { ...first, snapshot: one, evidence: secondEvidence }, 'runtime-third');
  const thirdEvidence = await third.session.seal(one); assert.ok(thirdEvidence);
  assert.equal(thirdEvidence.version, 2);
  if (thirdEvidence.version !== 2) assert.fail('Expected portable v2 lineage.');
  assert.equal(thirdEvidence.lineage.ancestors.length, 2);
  const fourth = await continueGeneration(t, { ...first, snapshot: one, evidence: thirdEvidence }, 'runtime-fourth');
  await assert.rejects(fourth.session.seal(cubes(fourth.continuation.initialDraft, { x: .75 })), error => {
    assert.ok(error instanceof GeometryProposalValidationError);
    assert.equal(error.diagnostic.code, 'clearance-violated'); return true;
  });
  const reintroduced = await fourth.session.seal(cubes(fourth.continuation.initialDraft));
  assert.ok(reintroduced); assert.deepEqual(reintroduced.measurements, first.evidence.measurements);
});

test('a current duplicate box call cannot inherit the inactive status of an identical older call', async t => {
  const first = await firstGeneration();
  const { session, continuation } = await continueGeneration(t, first, 'runtime-duplicate');
  const current = await session.measure(first.xRequest);
  assert.deepEqual(current, first.evidence.measurements[0]?.result);
  await assert.rejects(session.seal(cubes(continuation.initialDraft, { x: null })), /complete final geometry/);
});

test('inactive box history cannot erase source freshness or original query-member native endpoints', async t => {
  const first = await firstGeneration(true);
  const members = first.evidence.measurements[0]?.result.receipt.reads.flatMap(read => read.kind === 'query' ? read.members : []) ?? [];
  assert.ok(members.some(ref => ref.kind === 'native' && ref.entityId === 'wall-north'));
  const { session, continuation, history } = await continueGeneration(t, first, 'runtime-query-members');
  const one = cubes(continuation.initialDraft, { x: null });
  const changedIdentity = history.validateSnapshots([{ ...one, entities: one.entities.map(entity => entity.id === 'wall-north'
    ? { ...entity, id: 'wall-north-replacement' } : entity) }])[0];
  assert.ok(changedIdentity);
  await assert.rejects(session.seal(changedIdentity), /complete final geometry/);
  first.source.replace([evidenceWall({ x: .1 })]);
  await assert.rejects(session.seal(one), /changed|projection|correspondence|membership/);
});

test('unrelated accepted edits reconcile into the seed without resetting origin evidence', async t => {
  const first = await firstGeneration();
  const repository = await acceptSnapshot(first.repository, unrelatedSnapshot(first.repository), 'unrelated-change');
  const { session, continuation } = await continueGeneration(t, { ...first, repository }, 'runtime-after-unrelated');
  assert.equal(continuation.initialDraft.entities.find(entity => entity.id === 'wall-north')?.name, 'Unrelated accepted wall name');
  const snapshot = cubes(continuation.initialDraft, { x: null });
  const evidence = await session.seal(snapshot); assert.ok(evidence);
  assert.deepEqual(evidence.measurements, first.evidence.measurements);
  assert.deepEqual(evidence.receipts, first.evidence.receipts);
  assert.equal(evidence.baseRevisionId, repository.head('main'));
  assert.equal(evidence.version, 2);
  if (evidence.version !== 2) assert.fail('Expected portable v2 lineage.');
  assert.equal(evidence.lineage.ancestors[0]?.baseRevisionId, first.repository.head('main'));
});

test('an in-flight generation follows a paired current head while retaining its original authored binding', async t => {
  const first = await firstGeneration();
  let current = first.repository;
  const history = first.repository.geometryHistory();
  const continuation = await DraftContinuation.fromPrior({ chatId, history,
    predecessor: { evidence: first.evidence, snapshot: first.snapshot } });
  const session = await GeometryEvidenceSession.open({ source: first.source, projectId: first.repository.projectId,
    requestId: 'runtime-inflight', native: native(first.repository), history, chatId, continuation,
    current: async () => ({ native: native(current), history: current.geometryHistory() }), signal: new AbortController().signal });
  t.after(() => session.close());
  current = await acceptSnapshot(current, unrelatedSnapshot(current), 'inflight-unrelated');
  const original = cubes(continuation.initialDraft, { x: null });
  const evidence = await session.seal(original); assert.ok(evidence);
  assert.equal(evidence.baseRevisionId, first.repository.head('main'));
  assert.equal(evidence.proposalSnapshotSha256, geometrySnapshotHash(original));
  const currentHistory = current.geometryHistory();
  const reconciled = currentHistory.reconcile(evidence.baseRevisionId, original);
  assert.notDeepEqual(reconciled, original);
  await validateGeometryEvidence({ evidence, source: first.source, native: native(current), history: currentHistory,
    authoredSnapshot: original, candidate: reconciled, signal: new AbortController().signal });
  await assert.rejects(validateGeometryEvidence({ evidence, source: first.source, native: native(current), history: currentHistory,
    authoredSnapshot: original, candidate: original, signal: new AbortController().signal }), /differs from native reconciliation/);
});

test('concurrent acceptance prevents omission of the accepted candidate and replays its original constraint', async t => {
  const first = await firstGeneration();
  const second = await continueGeneration(t, first, 'runtime-before-acceptance');
  const one = cubes(second.continuation.initialDraft, { x: null });
  const evidence = await second.session.seal(one); assert.ok(evidence);
  const repository = await acceptSnapshot(first.repository, cubes(native(first.repository).snapshot, { y: null }), 'accept-candidate');
  const history = repository.geometryHistory();
  await assert.rejects(validateGeometryEvidence({ evidence, source: first.source, native: native(repository), history,
    authoredSnapshot: one, candidate: one, signal: new AbortController().signal }), /differs from native reconciliation/);
  const candidate = history.reconcile(evidence.baseRevisionId, one);
  assert.ok(candidate.entities.some(entity => entity.id === removedId));
  const proof = await validateGeometryEvidence({ evidence, source: first.source, native: native(repository), history,
    authoredSnapshot: one, candidate, signal: new AbortController().signal });
  assert.ok(proof.finalMeasurements.some(measurement => measurement.request.subject.kind === 'object'
    && measurement.request.subject.ref.kind === 'native' && measurement.request.subject.ref.entityId === removedId));
});

test('current snapshot and native capability must describe the same accepted head', async t => {
  const first = await firstGeneration();
  const repository = await acceptSnapshot(first.repository, unrelatedSnapshot(first.repository), 'mismatched-context');
  const history = first.repository.geometryHistory();
  const continuation = await DraftContinuation.fromPrior({ chatId, history,
    predecessor: { evidence: first.evidence, snapshot: first.snapshot } });
  const session = await GeometryEvidenceSession.open({ source: first.source, projectId: first.repository.projectId,
    requestId: 'runtime-mismatched', native: native(first.repository), history, chatId, continuation,
    current: async () => ({ native: native(first.repository), history: repository.geometryHistory() }), signal: new AbortController().signal });
  t.after(() => session.close());
  await assert.rejects(session.seal(cubes(continuation.initialDraft, { x: null })), error => {
    assert.ok(error instanceof GeometryEvidenceConflict); assert.match(error.message, /complete accepted history/); return true;
  });
});
