import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RoomRepository, identifier, validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';
import { parseDesignTarget, parseFrozenDesignTarget, parseWritableDesignTarget } from './design-targets.ts';
import type { FrozenDesignTarget } from './design-targets.ts';
import { createResidentialProject } from './residential-floor.ts';
import { freezeModelScope } from './model-scope.ts';

const main = { kind: 'main' } satisfies { kind: 'main' };
const kitchen = { kind: 'alternative', id: identifier('kitchen') } satisfies { kind: 'alternative'; id: string };
const bedroom = { kind: 'alternative', id: identifier('bedroom') } satisfies { kind: 'alternative'; id: string };

function details(name: string, selectedObjectIds = ['door-entry']): unknown {
  return { requestId: `request-${name}`, selectedObjectIds, instruction: 'Prepare a fixture proposal.',
    summary: 'Inspectable model delta.', rationale: 'Compare the named design.', constraints: 'Preserve unrelated contents.',
    uncertainty: 'Synthetic fixture only.', worker: { provider: 'fixture', model: 'target-tests', responseIds: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    toolCalls: [{ name: 'preview_furnishings', status: 'accepted', error: null }], validator: 'room-graph-v1' };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}
function records(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map(record);
}
async function fixture(): Promise<RoomRepository> {
  const repository = await RoomRepository.create();
  return repository.captureBaseline({ id: 'as-is', name: 'As-is', from: repository.freezeDesignTarget(main) })
    .forkAlternative({ id: 'kitchen', name: 'Wider kitchen', baselineId: 'as-is' })
    .forkAlternative({ id: 'bedroom', name: 'Bedroom study', baselineId: 'as-is' });
}
async function study(repository: RoomRepository, name: string, target: FrozenDesignTarget,
  change: (snapshot: ModelSnapshot) => void): Promise<RoomRepository> {
  const snapshot = structuredClone(repository.view(target.revisionId).snapshot); change(snapshot);
  return repository.proposeReviewedModel({ name, from: target.revisionId, target, snapshot, review: details(name) });
}
function rename(snapshot: ModelSnapshot, id: string, name: string): void {
  const item = snapshot.entities.find(entity => entity.id === id); assert.ok(item); item.name = name;
}

test('target parsers reject accessors, symbols and prototypes without executing getters', async () => {
  let invoked = 0;
  const accessor = { get kind(): string { invoked += 1; return 'main'; } };
  assert.throws(() => parseDesignTarget(accessor), /accessors/);
  assert.throws(() => parseFrozenDesignTarget({ projectId: 'x', target: accessor, revisionId: 'a'.repeat(64) }), /accessors/);
  const repository = await fixture();
  assert.throws(() => repository.freezeDesignTarget(accessor), /accessors/);
  assert.throws(() => repository.designView(accessor), /accessors/);
  assert.throws(() => parseDesignTarget({ kind: 'main', [Symbol('hidden')]: true }), /symbols/);
  assert.throws(() => parseDesignTarget(Object.create({ kind: 'main' })), /plain/);
  assert.equal(invoked, 0);
});

test('baseline capture and forks share immutable revisions and reject writable baseline authority', async () => {
  const repository = await fixture(); const original = repository.serialize();
  assert.equal(repository.persistence().revisions.length, 1);
  assert.equal(repository.designTargets().length, 4);
  assert.equal(repository.designView(kitchen).revisionId, repository.head('main'));
  assert.equal(repository.designView({ kind: 'baseline', id: 'as-is' }).revisionId, repository.root());
  assert.deepEqual(repository.designView(kitchen).delta.entities.modified, []);
  assert.throws(() => repository.freezeDesignTarget({ kind: 'baseline', id: 'as-is' }), /immutable baseline/);
  assert.throws(() => parseWritableDesignTarget({ kind: 'baseline', id: 'as-is' }), /immutable baseline/);
  assert.throws(() => repository.captureBaseline({ id: 'as-is', name: 'Overwrite', from: repository.freezeDesignTarget(main) }), /immutable/);
  assert.throws(() => repository.forkAlternative({ id: 'kitchen', name: 'Overwrite', baselineId: 'as-is' }), /already exists/);
  assert.equal(repository.serialize(), original);
});

test('alternative acceptance advances only its native head, retaining baseline, main and sibling decisions on restart', async () => {
  const repository = await fixture(); const target = repository.freezeDesignTarget(kitchen);
  const proposed = await study(repository, 'wider', target, snapshot => rename(snapshot, 'door-entry', 'Wider entry'));
  assert.deepEqual(proposed.review('wider').target, target);
  const decision = { decisionId: 'decision-wider', actor: 'human-engineer' };
  const accepted = proposed.accept('wider', decision, target);
  assert.equal(accepted.head('main'), repository.root());
  assert.equal(accepted.designView(bedroom).revisionId, repository.root());
  assert.equal(accepted.designView({ kind: 'baseline', id: 'as-is' }).revisionId, repository.root());
  assert.equal(accepted.designView(kitchen).revisionId, proposed.head('wider'));
  assert.equal(accepted.review('wider').decision.status, 'accepted');
  assert.deepEqual(accepted.designView(kitchen).delta.entities.modified.map(item => item.id), ['door-entry']);
  assert.deepEqual(validateSnapshot(accepted.designView(kitchen).snapshot), accepted.designView(kitchen).snapshot);
  const restored = await RoomRepository.restore(accepted.serialize()); assert.equal(restored.serialize(), accepted.serialize());
  assert.equal(restored.accept('wider', decision, target), restored);
  assert.throws(() => restored.accept('wider', { ...decision, actor: 'another-person' }, target), /different human decision/);
  const siblingTarget = restored.freezeDesignTarget(bedroom);
  const sibling = await study(restored, 'bedroom-door', siblingTarget, snapshot => rename(snapshot, 'wall-north', 'Bedroom wall'));
  const both = await restored.acceptFrom(sibling, 'bedroom-door', { decisionId: 'decision-bedroom', actor: 'human' }, siblingTarget);
  assert.equal(both.review('wider').decision.status, 'accepted');
  assert.equal(both.review('bedroom-door').decision.status, 'accepted');
  assert.equal(both.designView(kitchen).revisionId, accepted.designView(kitchen).revisionId);
  assert.equal((await RoomRepository.restore(both.serialize())).serialize(), both.serialize());
});

test('frozen dispatch cannot retarget on navigation, another project, missing binding or mismatched source', async () => {
  const repository = await fixture(); const target = repository.freezeDesignTarget(kitchen);
  const proposed = await study(repository, 'bound', target, snapshot => rename(snapshot, 'door-entry', 'Bound edit'));
  const before = repository.serialize();
  assert.throws(() => repository.proposalSnapshot(proposed, 'bound', repository.freezeDesignTarget(bedroom)), /mismatch/);
  await assert.rejects(repository.acceptFrom(proposed, 'bound', { decisionId: 'wrong', actor: 'human' }, repository.freezeDesignTarget(main)), /mismatch/);
  assert.throws(() => proposed.accept('bound', { decisionId: 'wrong', actor: 'human' }), /Invalid design target|Scope|plain JSON/);
  const other = await fixture();
  assert.throws(() => repository.proposalSnapshot(proposed, 'bound', other.freezeDesignTarget(kitchen)), /another project/);
  await assert.rejects(repository.propose({ name: 'implicit', from: repository.root(), doorWidthM: 1.1 }), /explicit frozen/);
  await assert.rejects(repository.propose({ name: 'mismatch', from: proposed.head('bound'), target, doorWidthM: 1.1 }), /Unknown revision|source revision/);
  assert.equal(repository.serialize(), before);
});

test('same-target unrelated changes reconcile and supersede only target-local decisions', async () => {
  const repository = await fixture(); const target = repository.freezeDesignTarget(kitchen);
  const left = await study(repository, 'left', target, snapshot => rename(snapshot, 'door-entry', 'Left'));
  const right = await study(repository, 'right', target, snapshot => rename(snapshot, 'wall-north', 'Right'));
  const first = await repository.acceptFrom(left, 'left', { decisionId: 'accept-left', actor: 'human' }, target);
  const final = await first.acceptFrom(right, 'right', { decisionId: 'accept-right', actor: 'human' }, target);
  assert.equal(final.designView(kitchen).snapshot.entities.find(item => item.id === 'door-entry')?.name, 'Left');
  assert.equal(final.designView(kitchen).snapshot.entities.find(item => item.id === 'wall-north')?.name, 'Right');
  assert.equal(final.review('left').decision.status, 'superseded');
  assert.equal(final.review('right').decision.status, 'accepted');
  assert.deepEqual(final.review('right').target, target);
  assert.equal(final.head('main'), repository.root());
  assert.equal((await RoomRepository.restore(final.serialize())).serialize(), final.serialize());
  const conflict = await study(repository, 'conflict', target, snapshot => rename(snapshot, 'door-entry', 'Conflict'));
  await assert.rejects(final.acceptFrom(conflict, 'conflict', { decisionId: 'accept-conflict', actor: 'human' }, target), /Conflicting changes/);
  await assert.rejects(final.propose({ name: 'stale', from: target.revisionId, target, doorWidthM: 1.1 }), /advanced/);
});

test('main remains explicitly writable with alternatives and baseline capture can pin accepted alternative ancestry', async () => {
  const repository = await fixture(); const target = repository.freezeDesignTarget(main);
  const proposed = await study(repository, 'main-edit', target, snapshot => rename(snapshot, 'door-entry', 'Main entry'));
  const accepted = proposed.accept('main-edit', { decisionId: 'accept-main', actor: 'human' }, target);
  assert.equal(accepted.designView(kitchen).revisionId, repository.root());
  const altTarget = accepted.freezeDesignTarget(kitchen);
  const alt = await study(accepted, 'alt-edit', altTarget, snapshot => rename(snapshot, 'door-entry', 'Alt entry'));
  const next = alt.accept('alt-edit', { decisionId: 'accept-alt', actor: 'human' }, altTarget);
  const nested = next.captureBaseline({ id: 'alt-as-is', name: 'Alternative baseline', from: next.freezeDesignTarget(kitchen) })
    .forkAlternative({ id: 'nested', name: 'Nested study', baselineId: 'alt-as-is' });
  assert.equal(nested.designView({ kind: 'alternative', id: 'nested' }).revisionId, alt.head('alt-edit'));
  assert.equal(nested.review('main-edit').decision.status, 'accepted');
  assert.equal((await RoomRepository.restore(nested.serialize())).serialize(), nested.serialize());
});

test('portable targets reject forged heads, pending-as-accepted status, swapped review targets and unknown refs', async () => {
  const repository = await fixture(); const target = repository.freezeDesignTarget(kitchen);
  const proposed = await study(repository, 'portable', target, snapshot => rename(snapshot, 'door-entry', 'Portable'));
  const accepted = proposed.accept('portable', { decisionId: 'accept-portable', actor: 'human' }, target);
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    value => { const targets = record(value.designTargets); const alternatives = records(targets.alternatives);
      const sibling = alternatives.find(item => item.id === 'bedroom'); assert.ok(sibling); sibling.revisionId = proposed.head('portable'); },
    value => { const review = records(value.reviews)[0]; assert.ok(review); review.decision = { status: 'pending', actor: null, decisionId: null }; },
    value => { const review = records(value.reviews)[0]; assert.ok(review); record(review.target).target = bedroom; },
    value => { const targets = record(value.designTargets); const alternative = records(targets.alternatives)[0]; assert.ok(alternative); alternative.baselineId = 'missing'; },
    value => { const targets = record(value.designTargets); const baseline = records(targets.baselines)[0]; assert.ok(baseline); record(baseline.from).revisionId = proposed.head('portable'); },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(accepted.persistence());
    // Keep references while navigating the JSON object; mutations never author a live repository.
    mutate(record(value));
    await assert.rejects(RoomRepository.restore(JSON.stringify(value)));
  }
  const downgraded = { ...accepted.persistence(), version: 2 };
  await assert.rejects(RoomRepository.restore(JSON.stringify(downgraded)), /fields/);
});

test('legacy geometry hashes and review preimages survive target adoption and unmodified legacy restore', async () => {
  const original = await RoomRepository.create();
  const snapshot = structuredClone(original.view(original.root()).snapshot); rename(snapshot, 'door-entry', 'Legacy entry');
  const proposed = await original.proposeReviewedModel({ name: 'legacy', from: original.root(), snapshot, review: details('legacy') });
  const accepted = proposed.accept('legacy', { decisionId: 'accept-legacy', actor: 'human' });
  const bytes = accepted.serialize(); assert.equal((await RoomRepository.restore(bytes)).serialize(), bytes);
  const reviewHash = createHash('sha256').update(JSON.stringify(accepted.review('legacy'))).digest('hex');
  const targetAware = accepted.captureBaseline({ id: 'legacy-pin', name: 'Legacy baseline', from: accepted.freezeDesignTarget(main) });
  assert.deepEqual(targetAware.persistence().revisions, accepted.persistence().revisions);
  assert.equal(createHash('sha256').update(JSON.stringify(targetAware.review('legacy'))).digest('hex'), reviewHash);
  assert.equal((await RoomRepository.restore(targetAware.serialize())).head('main'), accepted.head('main'));
});

test('native wall proposal enforces wall AND changed-space authority and reports stored versus derived impacts', async () => {
  const original = await createResidentialProject('Native wall authority fixture');
  const repository = original.captureBaseline({ id: 'as-is', name: 'As-is', from: original.freezeDesignTarget(main) })
    .forkAlternative({ id: 'kitchen', name: 'Wider kitchen', baselineId: 'as-is' });
  const target = repository.freezeDesignTarget(kitchen); const base = repository.view(target.revisionId).snapshot;
  const scope = (ids: string[]) => freezeModelScope({ graph: base, baseRevisionId: target.revisionId,
    query: { version: 1, allOf: [{ kind: 'ids', ids }], anyOf: [], excludeIds: [] } });
  const review = record(details('wall-study', ['wall-living-kitchen']));
  await assert.rejects(repository.proposeWallShift({ name: 'outside-spaces', from: target.revisionId, target,
    shift: { wallId: 'wall-living-kitchen', offsetMetres: .3 }, review: { ...review, scope: scope(['wall-living-kitchen']) } }), /scope/i);
  const result = await repository.proposeWallShift({ name: 'wall-study', from: target.revisionId, target,
    shift: { wallId: 'wall-living-kitchen', offsetMetres: .3 }, review: { ...review,
      scope: scope(['wall-living-kitchen', 'room-kitchen', 'room-living']) } });
  assert.deepEqual(result.delta.entities.modified.map(item => item.id), ['room-kitchen', 'room-living', 'wall-living-kitchen']);
  assert.ok(result.impacts.some(item => item.changed)); assert.ok(result.impacts.some(item => !item.changed));
  const accepted = result.repository.accept('wall-study', { decisionId: 'accept-wall', actor: 'human' }, target);
  assert.equal(accepted.head('main'), original.root());
  const wall = accepted.designView(kitchen).delta.entities.modified.find(item => item.id === 'wall-living-kitchen');
  assert.ok(wall?.before.type === 'Wall' && wall.after.type === 'Wall');
  assert.deepEqual(wall.before.start, [5, 0]); assert.deepEqual(wall.after.start, [5.3, 0]);
  assert.equal((await RoomRepository.restore(accepted.serialize())).serialize(), accepted.serialize());
});
