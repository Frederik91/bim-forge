import { diffSnapshots, furnitureFootprint, previewRectangle, rectangleLayout, validateSnapshot } from '../../src/room-model.ts';
import type { ModelSnapshot } from '../../src/room-model.ts';
import { attempt, change, current, decision, entity, fixture, furniture, inspectAttempt, move, propose } from './fixture.ts';
import { BASELINE_LIMITATIONS, result } from './protocol.ts';
import type { CaseResult } from './protocol.ts';

export function emptyReservedRegion(snapshot: ModelSnapshot): boolean {
  const reserved = { minX: .6, minY: .7, maxX: 2, maxY: 2.5 };
  return !snapshot.entities.some((item) => {
    if (item.type !== 'Furniture' || item.id === 'desk-one') return false;
    const box = furnitureFootprint(item);
    return box.minX < reserved.maxX && box.maxX > reserved.minX && box.minY < reserved.maxY && box.maxY > reserved.minY;
  });
}

export function northWallGap(snapshot: ModelSnapshot): number {
  const wall = entity(snapshot, 'wall-north'); const desk = entity(snapshot, 'desk-one');
  if (wall.type !== 'Wall' || desk.type !== 'Furniture') throw new Error('Expected wall and desk.');
  return wall.start[1] - wall.thickness / 2 - furnitureFootprint(desk).maxY;
}

export async function concurrencyCases(): Promise<CaseResult[]> {
  const cases: CaseResult[] = [];
  const repo = await fixture(); const base = current(repo); const untouched = repo.serialize();
  const desk = await propose(repo, 'move-desk', move(base, 'desk-one', [1.4, 2]));
  const bed = await propose(repo, 'move-bed', move(base, 'bed-one', [4.2, 2.5]));
  const deskFirst = await repo.acceptFrom(desk, 'move-desk', decision('move-desk'));
  const bedFirst = await repo.acceptFrom(bed, 'move-bed', decision('move-bed'));
  const ab = await deskFirst.acceptFrom(bed, 'move-bed', decision('move-bed'));
  const ba = await bedFirst.acceptFrom(desk, 'move-desk', decision('move-desk'));
  const abDelta = diffSnapshots(base, current(ab)); const baDelta = diffSnapshots(base, current(ba));
  const deskTarget = desk.view(desk.head('move-desk')).snapshot;
  const bedTarget = bed.view(bed.head('move-bed')).snapshot;
  const expectedCombined = validateSnapshot({ ...base, entities: base.entities.map((item) => item.id === 'desk-one'
    ? entity(deskTarget, item.id) : item.id === 'bed-one' ? entity(bedTarget, item.id) : item) });
  for (const [order, applied, delta] of [
    ['desk-then-bed', ab, abDelta], ['bed-then-desk', ba, baDelta],
  ] satisfies Array<[string, typeof repo, typeof abDelta]>) {
    cases.push(result({ experimentId: 'EX-04', caseId: `independent-${order}`,
      expected: 'Both remote object deltas survive acceptance in either order with unchanged proposal records.',
      observed: JSON.stringify({ snapshot: current(applied), delta, reviews: applied.reviews() }),
      passed: JSON.stringify(current(applied)) === JSON.stringify(expectedCombined)
        && delta.entities.modified.length === 2 && repo.serialize() === untouched
        && applied.review('move-desk').proposalRevisionId === desk.head('move-desk')
        && applied.review('move-bed').proposalRevisionId === bed.head('move-bed'),
      limitations: [...BASELINE_LIMITATIONS, 'Equal final snapshots do not imply equal revision hashes; acceptance ancestry differs by order.'],
      operations: [`acceptFrom(${order})`, 'diffSnapshots'],
      raw: { before: untouched, desk: desk.serialize(), bed: bed.serialize(), applied: applied.serialize(),
        delta, expectedCombined, applicationDelta: applied.compare(applied.view(applied.head('main')).parentId ?? repo.head('main'), applied.head('main')),
        approvalReuseBasis: { product: 'entity conflict check and combined snapshot validator only',
          oracle: 'Neither edit changes the other entity or overlaps its footprint; original proposal snapshots and IDs retained.',
          humanApproval: false } } }));
  }

  const meetingDesk = await propose(repo, 'desk-meeting', move(base, 'desk-one', [2.2, 2]));
  const meetingChair = await propose(repo, 'chair-meeting', move(base, 'chair-two', [2.2, 2]));
  for (const [first, firstName, second, secondName] of [
    [meetingDesk, 'desk-meeting', meetingChair, 'chair-meeting'],
    [meetingChair, 'chair-meeting', meetingDesk, 'desk-meeting'],
  ] satisfies Array<[typeof repo, string, typeof repo, string]>) {
    const accepted = await repo.acceptFrom(first, firstName, decision(firstName));
    const before = accepted.serialize();
    const outcome = await attempt(() => accepted.acceptFrom(second, secondName, decision(secondName)));
    cases.push(result({ experimentId: 'EX-04', caseId: `cross-object-overlap-${firstName}`,
      expected: 'Distinct IDs do not permit overlapping final occupancy; rejection preserves current head bytes.',
      observed: JSON.stringify(inspectAttempt(outcome)), passed: outcome.kind === 'rejected'
        && /combined changes fail model validation.*overlap/i.test(outcome.error.message) && accepted.serialize() === before,
      limitations: [...BASELINE_LIMITATIONS, 'This tests axis-aligned native furnishing footprints, not engineering geometry.'],
      operations: [`acceptFrom(${firstName})`, `acceptFrom(${secondName})`],
      raw: { initial: untouched, first: first.serialize(), second: second.serialize(), before, outcome: inspectAttempt(outcome), after: accepted.serialize() } }));
  }

  const reservedDesk = await propose(repo, 'reserved-desk', move(base, 'desk-one', [1.4, 2]),
    ['Region x=[0.6,2.0], y=[0.7,2.5] remains empty except desk-one.']);
  const insertSnapshot = validateSnapshot({ ...base, entities: [...base.entities,
    furniture({ id: 'phantom-chair', kind: 'chair', position: [1, 1] })] });
  const insertion = await propose(repo, 'insert-chair', insertSnapshot);
  const inserted = await repo.acceptFrom(insertion, 'insert-chair', decision('insert-chair'));
  const phantom = await attempt(() => inserted.acceptFrom(reservedDesk, 'reserved-desk', decision('reserved-desk')));
  cases.push(result({ experimentId: 'EX-04', caseId: 'phantom-empty-region-assumption',
    expected: 'A new non-overlapping occupant invalidates the declared empty-region predicate and requires renewed review.',
    observed: JSON.stringify({ beforePredicate: emptyReservedRegion(base), afterInsertionPredicate: emptyReservedRegion(current(inserted)),
      outcome: inspectAttempt(phantom) }),
    passed: phantom.kind === 'rejected' && /assumption|predicate|review/i.test(phantom.error.message),
    limitations: [...BASELINE_LIMITATIONS, 'The predicate is an independent test oracle. Baseline stores the assumption as text and exposes no predicate contract.'],
    operations: ['proposeReviewedModel(reserved region intent)', 'acceptFrom(insert)', 'acceptFrom(reserved desk)'],
    raw: { base: untouched, reserved: reservedDesk.serialize(), insertion: insertion.serialize(), inserted: inserted.serialize(),
      predicate: { bounds: { minX: .6, minY: .7, maxX: 2, maxY: 2.5 }, before: emptyReservedRegion(base),
        afterInsertion: emptyReservedRegion(current(inserted)) }, outcome: inspectAttempt(phantom),
      approvalReuseBasis: 'Baseline validates combined geometry but does not re-evaluate the recorded empty-region assumption.' } }));

  const retryInput = decision('move-desk');
  const retry = await attempt(() => deskFirst.acceptFrom(desk, 'move-desk', retryInput));
  const changedDecision = { ...retryInput, actor: 'Different fixture actor - not human approval' };
  const alteredRetry = await attempt(() => deskFirst.accept('move-desk', changedDecision));
  cases.push(result({ experimentId: 'EX-04', caseId: 'acceptance-command-payload-retry',
    expected: 'Exact retry returns the identical receipt; changed payload under the same decision ID is rejected.',
    observed: JSON.stringify({ exact: inspectAttempt(retry), altered: inspectAttempt(alteredRetry) }),
    passed: retry.kind === 'returned' && retry.value.serialize() === deskFirst.serialize() && alteredRetry.kind === 'rejected',
    limitations: [...BASELINE_LIMITATIONS, 'Tests acceptFrom and accept directly; no persistent command receipt or crash recovery is implemented here.'],
    operations: ['acceptFrom(exact retry)', 'accept(same decision ID, changed actor)'],
    raw: { before: deskFirst.serialize(), retryInput, changedDecision, exact: inspectAttempt(retry), altered: inspectAttempt(alteredRetry) } }));

  const nearWallSnapshot = move(base, 'desk-one', [3.3, 3.2]);
  const nearWall = await propose(repo, 'desk-near-north', nearWallSnapshot, ['Desk north edge remains 0.4 m from wall-north interior.']);
  const layout = rectangleLayout(base);
  const expandedSnapshot = previewRectangle(base, { ...layout, boundsMm: { ...layout.boundsMm, maxY: 5000 } });
  const wall = await propose(repo, 'move-north-wall', expandedSnapshot);
  const wallApplied = await repo.acceptFrom(wall, 'move-north-wall', decision('move-north-wall'));
  const changedWall = await attempt(() => wallApplied.acceptFrom(nearWall, 'desk-near-north', decision('desk-near-north')));
  const afterGap = changedWall.kind === 'returned' ? northWallGap(current(changedWall.value)) : null;
  cases.push(result({ experimentId: 'EX-05', caseId: 'changed-destination-wall-valid-geometry',
    expected: 'Moving the destination wall invalidates the 0.4 m placement assumption despite valid combined geometry.',
    observed: JSON.stringify({ originalGap: northWallGap(nearWallSnapshot), afterGap, outcome: inspectAttempt(changedWall) }),
    passed: changedWall.kind === 'rejected' && /assumption|intent|review/i.test(changedWall.error.message),
    limitations: [...BASELINE_LIMITATIONS, 'Wall distance is an independent oracle; baseline review text is not an executable dependency.'],
    operations: ['previewRectangle(move north wall)', 'acceptFrom(wall)', 'acceptFrom(near-wall desk)'],
    raw: { before: untouched, proposal: nearWall.serialize(), movedWall: wallApplied.serialize(), outcome: inspectAttempt(changedWall),
      originalGap: northWallGap(nearWallSnapshot), afterGap,
      approvalReuseBasis: 'Baseline applies object-disjoint deltas without a declared approval-equivalence check.' } }));
  cases.push(result({ experimentId: 'EX-05', caseId: 'unrelated-change-approval-equivalence',
    expected: 'Approval reuse after unrelated changes records an explicit equivalence rule and new application evidence.',
    observed: JSON.stringify({ review: ab.review('move-bed'), appliedRevision: ab.view(ab.head('main')), delta: abDelta }),
    passed: Object.hasOwn(ab.review('move-bed'), 'approvalEquivalence'),
    limitations: [...BASELINE_LIMITATIONS, 'New applied revision and exact deltas exist; the baseline review schema has no approval-equivalence record.',
      'The test actor supplies a decision. This case does not create or reuse a real human approval.'],
    operations: ['acceptFrom(remote desk)', 'acceptFrom(remote bed)', 'review', 'compare'],
    raw: { before: untouched, applied: ab.serialize(), delta: abDelta,
      oracleEquivalence: 'Object-disjoint, non-overlapping native edits preserve both proposal deltas.',
      productEquivalence: 'Not recorded as a named rule or evidence record.' } }));

  const named = await propose(repo, 'rename-chair', change(base, 'chair-one', (item) => ({ ...item, name: 'Occurrence alpha' })));
  const classified = await propose(repo, 'classify-chair', change(base, 'chair-one', (item) => {
    if (item.type !== 'Furniture') throw new Error('Expected furniture.');
    return { ...item, kind: 'plant' };
  }));
  const namedApplied = await repo.acceptFrom(named, 'rename-chair', decision('rename-chair'));
  const fieldIndependent = await attempt(() => namedApplied.acceptFrom(classified, 'classify-chair', decision('classify-chair')));
  cases.push(result({ experimentId: 'EX-06', caseId: 'declared-independent-metadata-fields',
    expected: 'A declared rule permits cosmetic name plus classification edits only when dimensions, placement, support, and dependencies stay unchanged.',
    observed: JSON.stringify(inspectAttempt(fieldIndependent)), passed: fieldIndependent.kind === 'returned'
      && entity(current(fieldIndependent.value), 'chair-one').name === 'Occurrence alpha'
      && JSON.stringify(entity(current(fieldIndependent.value), 'chair-one')) === JSON.stringify({ ...entity(base, 'chair-one'), name: 'Occurrence alpha', kind: 'plant' }),
    limitations: [...BASELINE_LIMITATIONS, 'Rule is a proposed bounded oracle, not an installed product rule. Baseline conservatively conflicts at entity granularity.',
      'General typed metadata properties are not represented by this native schema.'],
    operations: ['proposeReviewedModel(name)', 'proposeReviewedModel(classification)', 'acceptFrom(name)', 'acceptFrom(classification)'],
    raw: { before: untouched, name: named.serialize(), classification: classified.serialize(),
      declaredRule: { independent: ['name', 'kind'], unchanged: ['dimensions', 'position', 'rotationDeg', 'supportId'],
        scope: 'isolated floor chair to plant, same footprint and height, no dependants' }, outcome: inspectAttempt(fieldIndependent) } }));

  const divergent = await propose(repo, 'rename-chair-other', change(base, 'chair-one', (item) => ({ ...item, name: 'Occurrence beta' })));
  const divergence = await attempt(() => namedApplied.acceptFrom(divergent, 'rename-chair-other', decision('rename-chair-other')));
  cases.push(result({ experimentId: 'EX-06', caseId: 'divergent-same-property',
    expected: 'Two divergent names on one object conflict and preserve the accepted value.',
    observed: JSON.stringify(inspectAttempt(divergence)), passed: divergence.kind === 'rejected'
      && /Conflicting changes to chair-one/.test(divergence.error.message) && entity(current(namedApplied), 'chair-one').name === 'Occurrence alpha',
    limitations: BASELINE_LIMITATIONS, operations: ['acceptFrom(name alpha)', 'acceptFrom(name beta)'],
    raw: { before: namedApplied.serialize(), divergent: divergent.serialize(), outcome: inspectAttempt(divergence), after: namedApplied.serialize() } }));

  const tallDesk = await propose(repo, 'tall-desk', change(base, 'desk-one', (item) => {
    if (item.type !== 'Furniture') throw new Error('Expected furniture.');
    return { ...item, height: 2.7 };
  }));
  const lowShell = validateSnapshot({ ...base, entities: base.entities.map((item) => item.type === 'Wall' ? { ...item, height: 2.5 } : item) });
  const lowCeiling = await propose(repo, 'lower-ceiling', lowShell);
  const lowApplied = await repo.acceptFrom(lowCeiling, 'lower-ceiling', decision('lower-ceiling'));
  const dependency = await attempt(() => lowApplied.acceptFrom(tallDesk, 'tall-desk', decision('tall-desk')));
  const units = await attempt(() => validateSnapshot({ ...base, units: 'mm' }));
  cases.push(result({ experimentId: 'EX-06', caseId: 'units-and-dependent-values',
    expected: 'Units cannot merge as text; individually valid authored heights must recheck the dependent clearance after combination.',
    observed: JSON.stringify({ dependency: inspectAttempt(dependency), units }), passed: dependency.kind === 'rejected'
      && /combined changes fail model validation.*ceiling/i.test(dependency.error.message) && units.kind === 'rejected'
      && /Unsupported model snapshot/.test(units.error.message),
    limitations: [...BASELINE_LIMITATIONS, 'Only canonical native metres and a ceiling inequality are tested; dictionary units and derived property regeneration are absent.'],
    operations: ['acceptFrom(lower ceiling)', 'acceptFrom(tall desk)', 'validateSnapshot(units mm)'],
    raw: { base: untouched, tall: tallDesk.serialize(), low: lowApplied.serialize(), outcome: inspectAttempt(dependency),
      invalidUnitsInput: { ...base, units: 'mm' }, units } }));
  return cases;
}
