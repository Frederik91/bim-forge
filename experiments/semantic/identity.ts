import { RoomRepository, diffSnapshots, identifier, previewAssets, validateSnapshot } from '../../src/room-model.ts';
import { assetFixtureEdit, personInstance } from '../../src/asset-fixture.ts';
import { attempt, change, current, decision, entity, fixture, inspectAttempt, propose } from './fixture.ts';
import { BASELINE_LIMITATIONS, result } from './protocol.ts';
import type { CaseResult } from './protocol.ts';

export async function identityCases(): Promise<CaseResult[]> {
  const repo = await fixture();
  const before = repo.serialize();
  const snapshot = current(repo);
  const renamed = change(snapshot, 'desk-one', (item) => ({ ...item, name: 'Renamed occurrence' }));
  const proposed = await propose(repo, 'rename-desk', renamed);
  const accepted = await repo.acceptFrom(proposed, 'rename-desk', decision('rename-desk'));
  const restored = await RoomRepository.restore(accepted.serialize());
  const delta = diffSnapshots(snapshot, current(accepted));
  const one = entity(snapshot, 'chair-one'); const two = entity(snapshot, 'chair-two');
  const identicalContent = one.type === 'Furniture' && two.type === 'Furniture'
    && one.name === two.name && one.kind === two.kind && one.width === two.width
    && one.depth === two.depth && one.height === two.height && one.rotationDeg === two.rotationDeg;
  const stable = JSON.stringify(snapshot.entities.map((item) => item.id)) === JSON.stringify(current(accepted).entities.map((item) => item.id));

  const duplicates = await attempt(() => validateSnapshot({ ...snapshot, entities: [...snapshot.entities, one] }));
  const churned = change(snapshot, 'chair-one', (item) => ({ ...item, id: identifier('chair-recreated') }));
  const churnProposal = await propose(repo, 'recreate-chair', churned);
  const churnApplied = await repo.acceptFrom(churnProposal, 'recreate-chair', decision('recreate-chair'));
  const churnDelta = diffSnapshots(snapshot, current(churnApplied));

  const assets = await fixture('assets'); const assetsBefore = current(assets);
  const a = personInstance('person-split-a'); a.position = [1, 1.7];
  const b = personInstance('person-split-b'); b.position = [1, 2.4];
  const splitSnapshot = previewAssets(assetsBefore, { families: [], instances: [a, b], removeInstanceIds: ['person-187'] });
  const split = await propose(assets, 'split-occurrence', splitSnapshot);
  const splitApplied = await assets.acceptFrom(split, 'split-occurrence', decision('split-occurrence'));
  const merged = personInstance('person-merged');
  const mergeSnapshot = previewAssets(current(splitApplied), { families: [], instances: [merged], removeInstanceIds: [a.id, b.id] });
  const merge = await propose(splitApplied, 'merge-occurrences', mergeSnapshot);
  const mergeApplied = await splitApplied.acceptFrom(merge, 'merge-occurrences', decision('merge-occurrences'));
  const splitDelta = diffSnapshots(assetsBefore, current(splitApplied));
  const mergeDelta = diffSnapshots(current(splitApplied), current(mergeApplied));
  const lineageInput = { ...splitSnapshot, lineage: [{ kind: 'split', source: 'person-187', targets: [a.id, b.id] }] };
  const lineage = await attempt(() => validateSnapshot(lineageInput));
  const edit = assetFixtureEdit();
  const occurrenceSnapshot = previewAssets(assetsBefore, { families: [], instances: edit.instances.map((item) =>
    item.id === 'person-187' ? { ...item, size: { ...item.size, height: 1.9 } } : item), removeInstanceIds: [] });
  const occurrence = await propose(assets, 'resize-occurrence', occurrenceSnapshot);
  const occurrenceApplied = await assets.acceptFrom(occurrence, 'resize-occurrence', decision('resize-occurrence'));
  const occurrenceDelta = diffSnapshots(assetsBefore, current(occurrenceApplied));
  const family = entity(assetsBefore, 'standing-person');
  if (family.type !== 'AssetFamily') throw new Error('Expected source fixture family.');
  const rewriteSnapshot = change(assetsBefore, family.id, (item) => ({ ...item, name: 'Rewritten family' }));
  const rewrite = await attempt(() => propose(assets, 'rewrite-family', rewriteSnapshot));
  const revisedFamily = { ...family, id: identifier('standing-person-revised'), name: 'Revised shared family' };
  const affected = edit.instances.filter((item) => item.familyId === family.id).map((item) => item.id);
  const typeSnapshot = previewAssets(assetsBefore, { families: [revisedFamily], instances: edit.instances
    .filter((item) => item.familyId === family.id).map((item) => ({ ...item, familyId: revisedFamily.id })), removeInstanceIds: [] });
  const typeProposal = await propose(assets, 'explicit-type-fork', typeSnapshot);
  const typeApplied = await assets.acceptFrom(typeProposal, 'explicit-type-fork', decision('explicit-type-fork'));
  const typeDelta = diffSnapshots(assetsBefore, current(typeApplied));
  const typedPropertiesInput = { ...assetsBefore, entities: assetsBefore.entities.map((item) => item.id === family.id
    ? { ...item, propertyDefinitions: [{ id: 'height', unit: 'm', dictionaryVersion: 'w1-fixture-v1' }] } : item) };
  const typedProperties = await attempt(() => validateSnapshot(typedPropertiesInput));

  return [
    result({ experimentId: 'EX-01', caseId: 'native-identity-restore',
      expected: 'Rename preserves all native IDs, immutable base, ancestry, exact one-object delta, and restore bytes.',
      observed: JSON.stringify({ stable, immutableBase: repo.serialize() === before, delta, parent: proposed.view(proposed.head('rename-desk')).parentId,
        restoredExactly: restored.serialize() === accepted.serialize() }),
      passed: stable && repo.serialize() === before && restored.serialize() === accepted.serialize()
        && proposed.view(proposed.head('rename-desk')).parentId === repo.head('main')
        && delta.entities.modified.length === 1 && delta.entities.modified[0]?.id === 'desk-one'
        && delta.entities.added.length === 0 && delta.entities.removed.length === 0,
      limitations: BASELINE_LIMITATIONS, operations: ['proposeReviewedModel(rename)', 'acceptFrom', 'restore', 'diffSnapshots'],
      raw: { before, proposed: proposed.serialize(), applied: accepted.serialize(), delta } }),
    result({ experimentId: 'EX-01', caseId: 'identical-chair-occurrences',
      expected: 'Chairs with identical shape and metadata retain distinct native occurrence IDs and local placements.',
      observed: JSON.stringify({ identicalContent, one, two }), passed: identicalContent && one.id !== two.id,
      limitations: [...BASELINE_LIMITATIONS, 'Positions differ to keep both real occurrences valid; shared mesh deduplication is not implemented.'],
      operations: ['RoomRepository.createProject', 'validateSnapshot'], raw: { snapshot } }),
    result({ experimentId: 'EX-01', caseId: 'duplicate-native-id', expected: 'A duplicated native ID is rejected.',
      observed: JSON.stringify(duplicates), passed: duplicates.kind === 'rejected' && /duplicate/i.test(duplicates.error.message),
      limitations: [...BASELINE_LIMITATIONS, 'Native ID rejection does not qualify duplicate external source IDs.'],
      operations: ['validateSnapshot(duplicate chair ID)'], raw: { input: { ...snapshot, entities: [...snapshot.entities, one] }, outcome: duplicates } }),
    result({ experimentId: 'EX-01', caseId: 'native-id-churn-lineage',
      expected: 'Replacement of a geometrically identical occurrence has explicit old/new identity lineage.',
      observed: JSON.stringify(churnDelta), passed: Object.hasOwn(current(churnApplied), 'lineage') && Object.hasOwn(churnDelta, 'lineage'),
      limitations: [...BASELINE_LIMITATIONS, 'Baseline records removal and addition; no object-lineage field exists. Revision ancestry is not object lineage.'],
      operations: ['proposeReviewedModel(recreate)', 'acceptFrom', 'diffSnapshots'],
      raw: { before: repo.serialize(), applied: churnApplied.serialize(), delta: churnDelta } }),
    result({ experimentId: 'EX-01', caseId: 'native-split-merge-lineage',
      expected: 'Applied split and merge operations retain explicit source-to-result object lineage.',
      observed: JSON.stringify({ splitDelta, mergeDelta, lineageInputOutcome: lineage }),
      passed: lineage.kind === 'returned' && Object.hasOwn(current(mergeApplied), 'lineage'),
      limitations: [...BASELINE_LIMITATIONS, 'Split and merge execute as asset removal/addition; baseline rejects explicit lineage metadata.'],
      operations: ['previewAssets(split)', 'proposeReviewedModel', 'acceptFrom', 'previewAssets(merge)', 'proposeReviewedModel', 'acceptFrom', 'validateSnapshot(lineage field)'],
      raw: { before: assets.serialize(), split: splitApplied.serialize(), merged: mergeApplied.serialize(), splitDelta, mergeDelta,
        lineageInput, outcome: lineage } }),
    result({ experimentId: 'EX-01', caseId: 'paired-real-exports-not-covered',
      expected: 'W2 paired real exports demonstrate unchanged, duplicate, and churned source identities.',
      observed: 'Not covered: no paired real export artifacts have been supplied to W1.', passed: false,
      limitations: ['W2 artifact dependency pending. No IFC parser, exporter, or simulated engine is substituted.'],
      operations: [], raw: { coverage: 'not-covered', reason: 'W2 paired real exports pending' } }),
    result({ experimentId: 'EX-03', caseId: 'occurrence-edit-isolation',
      expected: 'Resize one occurrence without changing the shared family, other occurrence, or old snapshot.',
      observed: JSON.stringify(occurrenceDelta), passed: occurrenceDelta.entities.modified.length === 1
        && occurrenceDelta.entities.modified[0]?.id === 'person-187' && occurrenceDelta.entities.added.length === 0
        && occurrenceDelta.entities.removed.length === 0
        && JSON.stringify(entity(current(occurrenceApplied), family.id)) === JSON.stringify(family)
        && JSON.stringify(entity(current(occurrenceApplied), 'person-165')) === JSON.stringify(entity(assetsBefore, 'person-165')),
      limitations: [...BASELINE_LIMITATIONS, 'Asset family recipes stand in for existing shared definitions; general typed property dictionaries are absent.'],
      operations: ['previewAssets(occurrence resize)', 'proposeReviewedModel', 'acceptFrom', 'diffSnapshots'],
      raw: { before: assets.serialize(), proposed: occurrence.serialize(), applied: occurrenceApplied.serialize(), delta: occurrenceDelta } }),
    result({ experimentId: 'EX-03', caseId: 'explicit-family-fork-scope',
      expected: 'In-place family rewrite is rejected; explicit new family ID rebinds exactly the declared instances.',
      observed: JSON.stringify({ rewrite: inspectAttempt(rewrite), affected, typeDelta }),
      passed: rewrite.kind === 'rejected' && /immutable/.test(rewrite.error.message)
        && typeDelta.entities.modified.length === affected.length && typeDelta.entities.modified.every((item) => affected.includes(item.id))
        && typeDelta.entities.added.length === 1 && typeDelta.entities.added[0]?.id === revisedFamily.id
        && JSON.stringify(entity(current(typeApplied), family.id)) === JSON.stringify(family),
      limitations: [...BASELINE_LIMITATIONS, 'The declared affected list is built from fixture membership and compared with the actual delta; no product-level type-edit declaration protocol exists.',
        'Immutable recipes and explicit rebinds qualify this narrow path only; shared property sets and content deduplication remain unqualified.'],
      operations: ['proposeReviewedModel(in-place rewrite)', 'previewAssets(new family and explicit rebinds)', 'proposeReviewedModel', 'acceptFrom', 'diffSnapshots'],
      raw: { before: assets.serialize(), rewriteSnapshot, rewrite: inspectAttempt(rewrite), declaredAffected: affected,
        applied: typeApplied.serialize(), delta: typeDelta } }),
    result({ experimentId: 'EX-03', caseId: 'general-shared-properties-not-covered',
      expected: 'Shared property definitions retain units and dictionary versions, and content deduplication permits isolated future edits.',
      observed: JSON.stringify({ propertyDefinitionInput: typedProperties }), passed: false,
      limitations: [...BASELINE_LIMITATIONS, 'Baseline family schema rejects general property definitions. Asset recipe isolation does not qualify shared property dictionaries or deduplication.'],
      operations: ['validateSnapshot(shared property definition input)'], raw: { input: typedPropertiesInput, outcome: typedProperties } }),
  ];
}
