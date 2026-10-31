import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomRepository, previewAssets, validateSnapshot } from './room-model.ts';
import type { ModelSnapshot, GeometryNativeHistory } from './room-model.ts';
import { geometryDigest } from './geometry-query.ts';
import type { GeometryMeasureRequest, GeometryMeasureResult, GeometryRef } from './geometry-contract.ts';
import { assertGeometryEvidenceBound, GeometryEvidenceLimitError, parseGeometryEvidence, readGeometryEvidence } from './geometry-evidence-contract.ts';
import type { GeometryEvidence, GeometryEvidenceV1, GeometryEvidenceV2 } from './geometry-evidence-contract.ts';
import { createGeometryDraftLineage, inactiveInheritedBoxMeasurements } from './geometry-draft-lineage.ts';

const family = { id: 'portable-cube', type: 'AssetFamily', name: 'Portable cube', description: 'Deterministic lineage fixture.',
  parts: [{ id: 'body', kind: 'box', min: [0, 0, 0], size: [1, 1, 1], color: '#546778' }] };
function cubes(base: ModelSnapshot, ids: readonly ('cube-a' | 'cube-d')[]): ModelSnapshot {
  return previewAssets(base, { families: [family], instances: ids.map(id => ({ id, type: 'AssetInstance', name: id,
    familyId: family.id, position: [id === 'cube-a' ? 1.5 : 3.5, 2], rotationDeg: 0, size: { width: .3, depth: .3, height: .3 },
    placement: { kind: 'single-room' } })), removeInstanceIds: base.entities.filter(item => item.type === 'AssetInstance'
      && !ids.some(id => id === item.id)).map(item => item.id) });
}
function box(id: string): GeometryMeasureRequest {
  return { subject: { kind: 'box', candidateId: id, bounds: { min: [1, 1, 0], max: [1.3, 1.3, .3] },
    localToProject: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] },
  against: { kind: 'query', query: { role: 'physical' } }, operation: 'clearance', clearanceMetres: .5 };
}
function measurement(projectId: string, request: GeometryMeasureRequest): GeometryEvidence['measurements'][number] {
  const domain = { kind: 'project', digest: geometryDigest('portable-domain') } satisfies GeometryMeasureResult['receipt']['domain'];
  const outcome = { kind: 'complete', value: { nearest: null, distanceMetres: null, witness: null, relation: 'empty-set',
    clearance: 'satisfied-mesh', numericToleranceMetres: 1e-7, sourceErrorMetres: 0,
    exactness: 'prepared-representation', testedObjects: 0, domain } } satisfies Omit<Extract<GeometryMeasureResult, { kind: 'complete' }>, 'receipt'>;
  const result: GeometryMeasureResult = { ...outcome, receipt: { version: 1, projectId, domain, status: 'complete',
    operationDigest: geometryDigest({ method: 'measure', input: request }), resultDigest: geometryDigest(outcome), reads: [] } };
  return { request, result };
}
function original(history: GeometryNativeHistory, snapshot: ModelSnapshot, requestId: string,
  measurements: GeometryEvidence['measurements']): GeometryEvidenceV1 {
  const value = parseGeometryEvidence({ version: 1, projectId: history.projectId, requestId, baseRevisionId: history.head.id,
    proposalSnapshotSha256: geometryDigest(snapshot), measurements,
    receipts: [...new Map(measurements.map(item => [geometryDigest(item.result.receipt), item.result.receipt])).values()] });
  assert.equal(value.version, 1); if (value.version !== 1) throw new Error('Expected v1 fixture.'); return value;
}
function binding(history: GeometryNativeHistory, evidence: GeometryEvidence, snapshot: ModelSnapshot) {
  return { history, projectId: evidence.projectId, requestId: evidence.requestId, baseRevisionId: evidence.baseRevisionId, snapshot };
}
async function fixture() {
  const repository = await RoomRepository.create(); const history = repository.geometryHistory();
  const base = history.head.snapshot; const both = cubes(base, ['cube-a', 'cube-d']); const one = cubes(base, ['cube-d']);
  const measurements = [measurement(repository.projectId, box('cube-a')), measurement(repository.projectId, box('cube-d'))];
  const first = original(history, both, 'generation-one', measurements);
  const lineage = await createGeometryDraftLineage({ history, chatId: 'portable-chat', ancestors: [{ evidence: first, snapshot: both }] });
  const second = parseGeometryEvidence({ ...first, version: 2, requestId: 'generation-two', proposalSnapshotSha256: geometryDigest(one), lineage });
  assert.equal(second.version, 2); if (second.version !== 2) throw new Error('Expected v2 fixture.');
  return { repository, history, base, both, one, measurements, first, second };
}
async function accept(repository: RoomRepository, snapshot: ModelSnapshot, name: string): Promise<RoomRepository> {
  const proposed = await repository.proposeReviewedModel({ name, from: repository.head('main'), snapshot,
    review: { requestId: `request-${name}`, selectedObjectIds: ['door-entry'], instruction: 'Accept a deterministic fixture delta.',
      summary: 'Fixture delta.', rationale: 'Independent native acceptance.', constraints: 'Preserve unrelated contents.', uncertainty: 'Fixture only.',
      worker: { provider: 'fixture', model: 'portable-lineage', responseIds: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      toolCalls: [{ name: 'preview_furnishings', status: 'accepted', error: null }], validator: 'room-graph-v1' } });
  return repository.acceptFrom(proposed, name, { decisionId: `decision-${name}`, actor: 'Fixture human' });
}

test('portable proof suppresses only the removed inherited box and preserves exact original arrays', async () => {
  const f = await fixture(); const bytes = JSON.stringify(f.second);
  assert.deepEqual(await inactiveInheritedBoxMeasurements({ evidence: f.second, binding: binding(f.history, f.second, f.one) }), [0]);
  await assertGeometryEvidenceBound(f.second, f.one, binding(f.history, f.second, f.one));
  assert.equal(JSON.stringify(f.second), bytes);
  assert.deepEqual(f.second.measurements, f.first.measurements); assert.deepEqual(f.second.receipts, f.first.receipts);
  assert.deepEqual(readGeometryEvidence(bytes), f.second);
});

test('repeated generations keep origin witnesses after absence and reactivate reintroduced IDs', async () => {
  const f = await fixture();
  const lineage = await createGeometryDraftLineage({ history: f.history, chatId: 'portable-chat', ancestors: [{ evidence: f.second, snapshot: f.one }] });
  const third: GeometryEvidenceV2 = { ...f.second, requestId: 'generation-three', lineage };
  assert.deepEqual(await inactiveInheritedBoxMeasurements({ evidence: third, binding: binding(f.history, third, f.one) }), [0]);
  const back = { ...third, proposalSnapshotSha256: geometryDigest(f.both) };
  assert.deepEqual(await inactiveInheritedBoxMeasurements({ evidence: back, binding: binding(f.history, back, f.both) }), []);
  await assertGeometryEvidenceBound(back, f.both, binding(f.history, back, f.both));
  const nextLineage = await createGeometryDraftLineage({ history: f.history, chatId: 'portable-chat', ancestors: [{ evidence: back, snapshot: f.both }] });
  const fourth = { ...f.second, requestId: 'generation-four', lineage: nextLineage };
  assert.deepEqual(await inactiveInheritedBoxMeasurements({ evidence: fourth, binding: binding(f.history, fourth, f.one) }), [0]);
});

test('an identical current raw call remains active despite an inherited call being inactive', async () => {
  const f = await fixture(); const duplicate = { ...f.second, measurements: [...f.second.measurements, f.measurements[0]] };
  assert.deepEqual(await inactiveInheritedBoxMeasurements({ evidence: duplicate, binding: binding(f.history, duplicate, f.one) }), [0]);
  await assert.rejects(assertGeometryEvidenceBound(duplicate, f.one, binding(f.history, duplicate, f.one)), /active geometry box/);
  assert.throws(() => parseGeometryEvidence({ ...duplicate, historical: true }), /Invalid bounded/);
  const forged = structuredClone(duplicate); forged.lineage.ancestors[0].measurementCount = 3;
  await assert.rejects(inactiveInheritedBoxMeasurements({ evidence: forged, binding: binding(f.history, forged, f.one) }), /prefix hash/);
});

test('v2 requires original binding and rejects missing active boxes without lineage authority', async () => {
  const f = await fixture();
  await assert.rejects(assertGeometryEvidenceBound(f.second, f.one), /requires a complete native/);
  await assert.rejects(assertGeometryEvidenceBound(f.second, f.both, binding(f.history, f.second, f.one)), /does not match/);
  const empty = await createGeometryDraftLineage({ history: f.history, chatId: 'portable-chat', ancestors: [] });
  const missing = { ...f.second, lineage: empty };
  await assert.rejects(assertGeometryEvidenceBound(missing, f.one, binding(f.history, missing, f.one)), /active geometry box/);
  await assertGeometryEvidenceBound(f.first, f.both);
});

test('unrelated accepted advances reconcile without a chat reset or rewriting sealed model hashes', async () => {
  const f = await fixture(); const renamed = validateSnapshot({ ...f.base, entities: f.base.entities.map(entity =>
    entity.id === 'wall-north' ? { ...entity, name: 'Unrelated accepted name' } : entity) });
  const accepted = await accept(f.repository, renamed, 'unrelated'); const current = accepted.geometryHistory();
  assert.notEqual(current.head.id, f.second.baseRevisionId);
  assert.deepEqual(await inactiveInheritedBoxMeasurements({ evidence: f.second, binding: binding(current, f.second, f.one) }), [0]);
  await assertGeometryEvidenceBound(f.second, f.one, binding(current, f.second, f.one));
  const reconciled = current.reconcile(f.second.baseRevisionId, f.one);
  assert.equal(reconciled.entities.find(entity => entity.id === 'wall-north')?.name, 'Unrelated accepted name');
  assert.notEqual(geometryDigest(reconciled), f.second.proposalSnapshotSha256);
});

test('concurrently accepted candidates reactivate even when absent from the original sealed final', async () => {
  const f = await fixture();
  assert.deepEqual(f.one.entities.find(entity => entity.id === 'cube-d'), f.both.entities.find(entity => entity.id === 'cube-d'));
  const accepted = await accept(f.repository, cubes(f.base, ['cube-a']), 'accept-cube');
  const current = accepted.geometryHistory();
  assert.deepEqual(await inactiveInheritedBoxMeasurements({ evidence: f.second, binding: binding(current, f.second, f.one) }), []);
  await assertGeometryEvidenceBound(f.second, f.one, binding(current, f.second, f.one));
  assert.ok(current.reconcile(f.second.baseRevisionId, f.one).entities.some(entity => entity.id === 'cube-a'));
  const removed = validateSnapshot({ ...current.head.snapshot,
    entities: current.head.snapshot.entities.filter(entity => entity.id !== 'cube-a') });
  const later = await accept(accepted, removed, 'remove-accepted-cube'); const laterHistory = later.geometryHistory();
  assert.deepEqual(await inactiveInheritedBoxMeasurements({ evidence: f.second, binding: binding(laterHistory, f.second, f.one) }), []);
  await assert.rejects(assertGeometryEvidenceBound(f.second, f.one, binding(laterHistory, f.second, f.one)), /active geometry box/);
  await assertGeometryEvidenceBound(f.second, f.one, binding(later.geometryHistory({ kind: 'main' }, f.second.baseRevisionId), f.second, f.one));
});

test('object subjects and source endpoints never become inactive box indices', async () => {
  const f = await fixture();
  const ref: GeometryRef = { kind: 'native', projectId: f.repository.projectId, target: { kind: 'main' },
    revisionId: f.history.head.id, entityId: 'wall-north' };
  const request: GeometryMeasureRequest = { ...box('cube-a'), subject: { kind: 'object', ref }, against: { kind: 'object', ref } };
  const source = measurement(f.repository.projectId, request);
  const first = original(f.history, f.both, 'source-one', [source, ...f.measurements]);
  const lineage = await createGeometryDraftLineage({ history: f.history, chatId: 'source-chat', ancestors: [{ evidence: first, snapshot: f.both }] });
  const second = parseGeometryEvidence({ ...first, version: 2, requestId: 'source-two', proposalSnapshotSha256: geometryDigest(f.one), lineage });
  assert.deepEqual(await inactiveInheritedBoxMeasurements({ evidence: second, binding: binding(f.history, second, f.one) }), [1]);
  assert.deepEqual(second.measurements[0], source); assert.deepEqual(second.receipts, first.receipts);
});

test('a box probe never authored in its sealing generation supplies no retirement authority', async () => {
  const f = await fixture(); const probe = original(f.history, f.one, 'probe-only', [f.measurements[0]]);
  const lineage = await createGeometryDraftLineage({ history: f.history, chatId: 'probe-chat', ancestors: [{ evidence: probe, snapshot: f.one }] });
  const next = parseGeometryEvidence({ ...probe, version: 2, requestId: 'probe-next', lineage });
  assert.deepEqual(await inactiveInheritedBoxMeasurements({ evidence: next, binding: binding(f.history, next, f.one) }), []);
  await assert.rejects(assertGeometryEvidenceBound(next, f.one, binding(f.history, next, f.one)), /active geometry box/);
});

test('legacy recovery verifies all original prefixes and optional inheritedFrom presence', async () => {
  for (const present of [false, true]) {
    const f = await fixture(); const first: GeometryEvidenceV1 = present ? { ...f.first, inheritedFrom: [] } : f.first;
    const second: GeometryEvidenceV1 = { ...first, requestId: 'legacy-two', proposalSnapshotSha256: geometryDigest(f.one),
      inheritedFrom: [{ requestId: first.requestId, baseRevisionId: first.baseRevisionId,
        proposalSnapshotSha256: first.proposalSnapshotSha256, evidenceSha256: geometryDigest(first) }] };
    const lineage = await createGeometryDraftLineage({ history: f.history, chatId: 'legacy-chat',
      ancestors: [{ evidence: first, snapshot: f.both }, { evidence: second, snapshot: f.one }] });
    assert.equal(lineage.ancestors[0].encoding, present ? 'v1-present' : 'v1-absent');
    const third = parseGeometryEvidence({ ...f.second, requestId: 'legacy-three', lineage });
    assert.deepEqual(await inactiveInheritedBoxMeasurements({ evidence: third, binding: binding(f.history, third, f.one) }), [0]);
    await assert.rejects(createGeometryDraftLineage({ history: f.history, chatId: 'legacy-chat',
      ancestors: [{ evidence: second, snapshot: f.one }] }), /ancestors are missing/);
    const changed = structuredClone(third); assert.equal(changed.version, 2);
    if (changed.version !== 2) throw new Error('Expected v2 fixture.');
    changed.lineage.ancestors[0].encoding = present ? 'v1-absent' : 'v1-present';
    await assert.rejects(inactiveInheritedBoxMeasurements({ evidence: changed, binding: binding(f.history, changed, f.one) }), /prefix hash/);
  }
});

test('tampered model patches, original arrays, foreign bindings and noncanonical patches fail closed', async () => {
  const f = await fixture();
  const mutations: Array<(value: GeometryEvidenceV2) => void> = [
    value => { value.lineage.ancestors[0].proposalSnapshotSha256 = 'a'.repeat(64); },
    value => { value.lineage.ancestors[0].evidenceSha256 = 'b'.repeat(64); },
    value => { value.measurements.reverse(); },
    value => { value.receipts.reverse(); },
    value => { value.lineage.root.rootRevisionId = 'c'.repeat(64); },
    value => { value.lineage.ancestors[0].patch.entities.upsert.reverse(); },
    value => { value.lineage.ancestors[0].patch.entities.remove.push('not-in-base'); },
    value => { value.lineage.ancestors[0].encoding = 'v1-present'; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(f.second); mutate(changed);
    await assert.rejects(inactiveInheritedBoxMeasurements({ evidence: changed, binding: binding(f.history, changed, f.one) }));
  }
  await assert.rejects(inactiveInheritedBoxMeasurements({ evidence: f.second,
    binding: { ...binding(f.history, f.second, f.one), requestId: 'foreign-request' } }), /original review binding/);
  await assert.rejects(createGeometryDraftLineage({ history: f.history, chatId: 'foreign-chat',
    ancestors: [{ evidence: f.second, snapshot: f.one }] }), /chat differs/);
});

test('native cross-snapshot family identity checks also cover reconstructed private history', async () => {
  const f = await fixture(); const altered = validateSnapshot({ ...f.one, entities: f.one.entities.map(entity =>
    entity.type === 'AssetFamily' ? { ...entity, description: 'A different body under the same ID.' } : entity) });
  const evidence = { ...f.second, proposalSnapshotSha256: geometryDigest(altered) };
  await assert.rejects(inactiveInheritedBoxMeasurements({ evidence, binding: binding(f.history, evidence, altered) }), /Family IDs are immutable/);
});

test('portable restoration needs accepted origins and inline proofs but no prior pending native revisions', async () => {
  const f = await fixture(); const restored = await RoomRepository.restore(f.repository.serialize());
  assert.equal(restored.persistence().revisions.length, 1);
  const evidence = readGeometryEvidence(JSON.stringify(f.second));
  await assertGeometryEvidenceBound(evidence, f.one, binding(restored.geometryHistory(), evidence, f.one));
  assert.equal(restored.persistence().revisions.length, 1);
});

test('wire bounds remain 20 ancestors, 128 receipts, 64 measurements and 64 KiB total evidence', async () => {
  const f = await fixture();
  assert.throws(() => parseGeometryEvidence({ ...f.second, measurements: Array.from({ length: 65 }, () => f.measurements[0]) }), /Invalid bounded/);
  assert.throws(() => parseGeometryEvidence({ ...f.second, receipts: Array.from({ length: 129 }, () => f.first.receipts[0]) }), /Invalid bounded/);
  assert.throws(() => parseGeometryEvidence({ ...f.second, lineage: { ...f.second.lineage,
    ancestors: Array.from({ length: 21 }, () => f.second.lineage.ancestors[0]) } }), /Invalid bounded/);
  await assert.rejects(createGeometryDraftLineage({ history: f.history, chatId: 'too-long',
    ancestors: Array.from({ length: 21 }, () => ({ evidence: f.first, snapshot: f.both })) }), /Invalid bounded/);
  const firstReceipt = f.first.receipts[0]; assert.ok(firstReceipt);
  const largeReceipt = { ...firstReceipt, reads: Array.from({ length: 8 }, () => ({ kind: 'candidate',
    subject: box('cube-a').subject, digest: geometryDigest(box('cube-a').subject) })) };
  assert.throws(() => parseGeometryEvidence({ ...f.second, receipts: [firstReceipt,
    ...Array.from({ length: 127 }, () => largeReceipt)] }), GeometryEvidenceLimitError);
});
