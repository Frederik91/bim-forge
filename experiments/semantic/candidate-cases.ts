import { personInstance } from '../../src/asset-fixture.ts';
import { identifier, previewAssets, previewRectangle, rectangleLayout, validateSnapshot } from '../../src/room-model.ts';
import type { ModelSnapshot } from '../../src/room-model.ts';
import { SemanticCandidate, canonical } from './candidate.ts';
import type { Draft, Lineage, Predicate } from './candidate.ts';
import { attempt, change, current, entity, fixture, furniture, move } from './fixture.ts';
import type { Attempt } from './fixture.ts';
import type { CaseResult } from './protocol.ts';

export function candidateDraft(state: SemanticCandidate, id: string, snapshot: ModelSnapshot,
  options: { predicates?: Predicate[]; lineage?: Lineage[]; fieldRule?: Draft['fieldRule'] } = {}): Draft {
  return state.draft({ id, snapshot, predicates: options.predicates ?? [], lineage: options.lineage ?? [],
    fieldRule: options.fieldRule ?? 'whole-entity' });
}
export const candidateCommand = (draft: Draft) => ({ commandId: `w1-fixture-${draft.id}`, actor: 'W1 fixture actor - not human approval', draft });
type Application = ReturnType<SemanticCandidate['apply']>;
function inspect(outcome: Attempt<Application>): unknown {
  return outcome.kind === 'rejected' ? outcome : { kind: outcome.kind, state: outcome.value.state.serialize(), receipt: outcome.value.receipt };
}
const candidateLimitations = [
  'VM-C1 semantic prototype only: synchronous in-memory single-room state, native validator, no database, process concurrency or durable replay.',
  'Predicates cover native floor furnishings and one north-wall gap; accepted predicates persist conservatively without a removal protocol.',
  'Field independence is restricted to an isolated chair/plant name and classification rule with unchanged native shape and placement.',
  'Lineage is a validated declared relationship between native deltas; it does not prove physical split/merge equivalence or IFC identity.',
  'Fixture decisions are not human approvals. W0 multilevel operations, shared property dictionaries, and real exports remain unqualified.',
];

export async function candidateCases(baseline: CaseResult[]): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const record = (baselineId: string, passed: boolean, raw: unknown, operations: string[]): void => {
    const reference = baseline.find((item) => item.observation.caseId === baselineId);
    if (!reference) throw new Error(`Candidate case has no baseline comparison: ${baselineId}`);
    const caseId = `vmc1-${baselineId}`;
    results.push({ observation: { ...reference.observation, caseId, passed, observed: JSON.stringify(raw), limitations: candidateLimitations },
      artifact: { caseId, variant: 'VM-C1-semantic-prototype', operations, raw: { baselineCaseId: baselineId, evidence: raw } } });
  };
  const source = await fixture(); const snapshot = current(source); const root = SemanticCandidate.create(snapshot);
  const original = root.serialize();
  const desk = candidateDraft(root, 'move-desk', move(snapshot, 'desk-one', [1.4, 2]));
  const bed = candidateDraft(root, 'move-bed', move(snapshot, 'bed-one', [4.2, 2.5]));
  const deskFirst = root.apply(candidateCommand(desk)); const bedFirst = root.apply(candidateCommand(bed));
  const ab = deskFirst.state.apply(candidateCommand(bed)); const ba = bedFirst.state.apply(candidateCommand(desk));
  for (const [order, applied] of [['desk-then-bed', ab], ['bed-then-desk', ba]] satisfies Array<[string, Application]>) {
    const expected = validateSnapshot({ ...snapshot, entities: snapshot.entities.map((item) => item.id === 'desk-one'
      ? entity(desk.snapshot, item.id) : item.id === 'bed-one' ? entity(bed.snapshot, item.id) : item) });
    record(`independent-${order}`, canonical(applied.state.head().snapshot) === canonical(expected)
      && root.serialize() === original && applied.state.receipts().length === 2,
    { before: original, desk, bed, applied: applied.state.serialize(), receipt: applied.receipt, expected }, ['candidate.apply independent deltas', 'validateSnapshot', 'diffSnapshots']);
  }

  const overlapDesk = candidateDraft(root, 'desk-meeting', move(snapshot, 'desk-one', [2.2, 2]));
  const overlapChair = candidateDraft(root, 'chair-meeting', move(snapshot, 'chair-two', [2.2, 2]));
  for (const [first, second] of [[overlapDesk, overlapChair], [overlapChair, overlapDesk]]) {
    const applied = root.apply(candidateCommand(first)); const before = applied.state.serialize();
    const outcome = await attempt(() => applied.state.apply(candidateCommand(second)));
    record(`cross-object-overlap-${first.id}`, outcome.kind === 'rejected' && /overlap/i.test(outcome.error.message)
      && applied.state.serialize() === before, { first, second, before, outcome: inspect(outcome), after: applied.state.serialize() },
    ['candidate.apply first delta', 'candidate.apply overlapping delta', 'validateSnapshot']);
  }

  const empty: Predicate = { kind: 'empty-region', bounds: { minX: .6, minY: .7, maxX: 2, maxY: 2.5 }, exceptId: 'desk-one' };
  const reserved = candidateDraft(root, 'reserved-desk', desk.snapshot, { predicates: [empty] });
  const insertion = candidateDraft(root, 'insert-chair', validateSnapshot({ ...snapshot, entities: [...snapshot.entities,
    furniture({ id: 'phantom-chair', kind: 'chair', position: [1, 1] })] }));
  const inserted = root.apply(candidateCommand(insertion)); const reservedFirst = root.apply(candidateCommand(reserved));
  const phantom = await attempt(() => inserted.state.apply(candidateCommand(reserved)));
  const reversePhantom = await attempt(() => reservedFirst.state.apply(candidateCommand(insertion)));
  record('phantom-empty-region-assumption', phantom.kind === 'rejected' && reversePhantom.kind === 'rejected'
    && /predicate/.test(phantom.error.message) && /predicate/.test(reversePhantom.error.message),
  { before: original, reserved, insertion, inserted: inserted.state.serialize(), outcome: inspect(phantom),
    reversedBefore: reservedFirst.state.serialize(), reversedOutcome: inspect(reversePhantom) },
  ['candidate.apply insertion', 'candidate.apply reserved desk with predicate recheck', 'repeat in reverse order']);

  const exact = ab.state.apply(candidateCommand(desk));
  const changed = await attempt(() => ab.state.apply({ ...candidateCommand(desk), actor: 'Different fixture actor - not human approval' }));
  const changedPredicate = await attempt(() => ab.state.apply({ ...candidateCommand(desk), draft: { ...desk, predicates: [empty] } }));
  record('acceptance-command-payload-retry', exact.state === ab.state && canonical(exact.receipt) === canonical(deskFirst.receipt)
    && changed.kind === 'rejected' && changedPredicate.kind === 'rejected' && /changed payload/.test(changed.error.message),
  { before: ab.state.serialize(), command: candidateCommand(desk), exactReceipt: exact.receipt, originalReceipt: deskFirst.receipt,
    changedActor: inspect(changed), changedPredicate: inspect(changedPredicate), after: exact.state.serialize() },
  ['candidate.apply exact retry after unrelated acceptance', 'candidate.apply changed actor', 'candidate.apply changed predicate payload']);

  const near = candidateDraft(root, 'desk-near-north', move(snapshot, 'desk-one', [3.3, 3.2]), {
    predicates: [{ kind: 'north-wall-gap', wallId: 'wall-north', furnitureId: 'desk-one', metres: .4 }],
  });
  const layout = rectangleLayout(snapshot);
  const wall = candidateDraft(root, 'move-north-wall', previewRectangle(snapshot, { ...layout, boundsMm: { ...layout.boundsMm, maxY: 5000 } }));
  const movedWall = root.apply(candidateCommand(wall)); const nearFirst = root.apply(candidateCommand(near));
  const wallOutcome = await attempt(() => movedWall.state.apply(candidateCommand(near)));
  const reverseWall = await attempt(() => nearFirst.state.apply(candidateCommand(wall)));
  record('changed-destination-wall-valid-geometry', wallOutcome.kind === 'rejected' && reverseWall.kind === 'rejected'
    && /predicate/.test(wallOutcome.error.message), { near, wall, before: movedWall.state.serialize(), outcome: inspect(wallOutcome),
    reversedBefore: nearFirst.state.serialize(), reversedOutcome: inspect(reverseWall) },
  ['candidate.apply moved wall', 'candidate.apply wall-gap predicate', 'repeat in reverse order']);
  record('unrelated-change-approval-equivalence', ab.receipt.equivalence.reconciled
    && ab.receipt.equivalence.rule === 'native-delta-and-predicates-v1' && ab.receipt.baseRevisionId === root.head().id
    && ab.state.head().parentId === deskFirst.state.head().id && ab.receipt.delta.entities.modified.length === 1,
  { proposal: bed, receipt: ab.receipt, applied: ab.state.serialize(), humanApproval: false },
  ['candidate.apply remote desk', 'candidate.apply remote bed', 'record named equivalence and application receipt']);

  const options = { fieldRule: 'isolated-furniture-name-kind-v1' } satisfies { fieldRule: Draft['fieldRule'] };
  const nameSnapshot = change(snapshot, 'chair-one', (item) => ({ ...item, name: 'Occurrence alpha' }));
  const kindSnapshot = change(snapshot, 'chair-one', (item) => {
    if (item.type !== 'Furniture') throw new Error('Expected chair fixture.');
    return { ...item, kind: 'plant' };
  });
  const name = candidateDraft(root, 'rename-chair', nameSnapshot, options);
  const kind = candidateDraft(root, 'classify-chair', kindSnapshot, options);
  const named = root.apply(candidateCommand(name)); const classified = root.apply(candidateCommand(kind));
  const merged = named.state.apply(candidateCommand(kind)); const reversedFields = classified.state.apply(candidateCommand(name));
  const expectedChair = { ...entity(snapshot, 'chair-one'), name: 'Occurrence alpha', kind: 'plant' };
  record('declared-independent-metadata-fields', canonical(entity(merged.state.head().snapshot, 'chair-one')) === canonical(expectedChair)
    && canonical(merged.state.head().snapshot) === canonical(reversedFields.state.head().snapshot),
  { name, kind, expectedChair, applied: merged.state.serialize(), reversed: reversedFields.state.serialize(),
    receipt: merged.receipt, reversedReceipt: reversedFields.receipt },
  ['candidate.apply name then classification with explicit rule', 'candidate.apply classification then name', 'validateSnapshot']);
  const divergent = candidateDraft(root, 'rename-chair-other', change(snapshot, 'chair-one', (item) => ({ ...item, name: 'Occurrence beta' })), options);
  const divergence = await attempt(() => named.state.apply(candidateCommand(divergent)));
  record('divergent-same-property', divergence.kind === 'rejected' && /Divergent field conflict/.test(divergence.error.message),
    { before: named.state.serialize(), divergent, outcome: inspect(divergence), after: named.state.serialize() }, ['candidate.apply divergent names']);

  const tall = candidateDraft(root, 'tall-desk', change(snapshot, 'desk-one', (item) => {
    if (item.type !== 'Furniture') throw new Error('Expected desk fixture.');
    return { ...item, height: 2.7 };
  }));
  const lower = candidateDraft(root, 'lower-ceiling', validateSnapshot({ ...snapshot, entities: snapshot.entities.map((item) =>
    item.type === 'Wall' ? { ...item, height: 2.5 } : item) }));
  const lowered = root.apply(candidateCommand(lower));
  const clearance = await attempt(() => lowered.state.apply(candidateCommand(tall)));
  const nativeUnits = await attempt(() => SemanticCandidate.create({ ...snapshot, units: 'mm' }));
  record('units-and-dependent-values', clearance.kind === 'rejected' && /ceiling/.test(clearance.error.message)
    && nativeUnits.kind === 'rejected' && /Unsupported model snapshot/.test(nativeUnits.error.message),
  { tall, lower, lowered: lowered.state.serialize(), outcome: inspect(clearance), invalidUnits: nativeUnits },
  ['candidate.apply lower ceiling', 'candidate.apply tall desk', 'candidate.create unsupported units']);

  const churn = candidateDraft(root, 'recreate-chair', change(snapshot, 'chair-one', (item) => ({ ...item, id: identifier('chair-recreated') })), {
    lineage: [{ kind: 'replace', sources: ['chair-one'], targets: ['chair-recreated'] }],
  });
  const churned = root.apply(candidateCommand(churn));
  record('native-id-churn-lineage', canonical(churned.state.head().lineage) === canonical(churn.lineage)
    && churned.receipt.delta.entities.removed[0]?.id === 'chair-one'
    && churned.receipt.delta.entities.added[0]?.id === 'chair-recreated',
  { draft: churn, applied: churned.state.serialize(), receipt: churned.receipt }, ['candidate.apply replacement with explicit lineage']);

  const assetRoot = SemanticCandidate.create(current(await fixture('assets')));
  const a = personInstance('person-split-a'); a.position = [1, 1.7];
  const b = personInstance('person-split-b'); b.position = [1, 2.4];
  const split = candidateDraft(assetRoot, 'split-occurrence', previewAssets(assetRoot.head().snapshot, {
    families: [], instances: [a, b], removeInstanceIds: ['person-187'],
  }), { lineage: [{ kind: 'split', sources: ['person-187'], targets: [a.id, b.id] }] });
  const splitApplied = assetRoot.apply(candidateCommand(split));
  const merge = candidateDraft(splitApplied.state, 'merge-occurrences', previewAssets(splitApplied.state.head().snapshot, {
    families: [], instances: [personInstance('person-merged')], removeInstanceIds: [a.id, b.id],
  }), { lineage: [{ kind: 'merge', sources: [a.id, b.id], targets: ['person-merged'] }] });
  const mergeApplied = splitApplied.state.apply(candidateCommand(merge));
  record('native-split-merge-lineage', canonical(splitApplied.state.head().lineage) === canonical(split.lineage)
    && canonical(mergeApplied.state.head().lineage) === canonical(merge.lineage)
    && mergeApplied.receipt.delta.entities.removed.length === 2 && mergeApplied.receipt.delta.entities.added[0]?.id === 'person-merged',
  { before: assetRoot.serialize(), split, splitApplied: splitApplied.state.serialize(), splitReceipt: splitApplied.receipt,
    merge, merged: mergeApplied.state.serialize(), mergeReceipt: mergeApplied.receipt },
  ['candidate.apply split with validated lineage endpoints', 'candidate.apply merge with validated lineage endpoints']);
  return results;
}
