import { Type } from 'typebox';
import { Check } from 'typebox/value';
import type { Coverage, Observation } from '../contracts/schema.ts';
import { EXPERIMENT_IDS } from './protocol.ts';
import type { CaseArtifact, ExperimentId } from './protocol.ts';

const RegistrySchema = Type.Object({ experiments: Type.Array(Type.Object({
  id: Type.String(), assertions: Type.Array(Type.String()),
})) });

const definitions: Record<ExperimentId, Coverage[]> = {
  'EX-01': [
    { assertion: 'Unchanged objects retain identity across snapshots and paired real exports.',
      caseIds: ['native-identity-restore', 'paired-real-exports-not-covered'], coverage: 'partial' },
    { assertion: 'Two identical occurrences remain distinct.', caseIds: ['identical-chair-occurrences'], coverage: 'covered' },
    { assertion: 'Duplicate/churned source IDs and split/merge lineage are explicit.',
      caseIds: ['duplicate-native-id', 'native-id-churn-lineage', 'native-split-merge-lineage', 'paired-real-exports-not-covered'], coverage: 'partial' },
  ],
  'EX-03': [
    { assertion: 'An occurrence edit leaves other instances and shared definitions unchanged.', caseIds: ['occurrence-edit-isolation'], coverage: 'partial' },
    { assertion: 'An explicit type edit lists all affected instances.', caseIds: ['explicit-family-fork-scope'], coverage: 'partial' },
    { assertion: 'Content deduplication does not couple future edits.', caseIds: ['general-shared-properties-not-covered'], coverage: 'not-covered' },
  ],
  'EX-04': [
    { assertion: 'Desk and remote bed changes accept in either order with both deltas retained.',
      caseIds: ['independent-desk-then-bed', 'independent-bed-then-desk'], coverage: 'covered' },
    { assertion: 'Different object IDs do not allow conflicting clearance occupancy.',
      caseIds: ['cross-object-overlap-desk-meeting', 'cross-object-overlap-chair-meeting', 'phantom-empty-region-assumption'], coverage: 'covered' },
    { assertion: 'New spatial insertions invalidate affected empty-region predicates.', caseIds: ['phantom-empty-region-assumption'], coverage: 'covered' },
    { assertion: 'Acceptance retries preserve command/payload identity and exact decision records.', caseIds: ['acceptance-command-payload-retry'], coverage: 'covered' },
  ],
  'EX-05': [
    { assertion: "Moving the destination wall rechecks the proposal's wall relationship.", caseIds: ['changed-destination-wall-valid-geometry'], coverage: 'covered' },
    { assertion: 'Geometrically valid but intent-invalid candidates do not reuse approval silently.',
      caseIds: ['changed-destination-wall-valid-geometry'], coverage: 'partial' },
    { assertion: 'Unrelated accepted changes retain approval only under declared equivalence rules.',
      caseIds: ['unrelated-change-approval-equivalence'], coverage: 'partial' },
  ],
  'EX-06': [
    { assertion: 'Declared independent metadata edits preserve both values.', caseIds: ['declared-independent-metadata-fields'], coverage: 'partial' },
    { assertion: 'Divergent changes to the same meaning conflict.', caseIds: ['divergent-same-property'], coverage: 'covered' },
    { assertion: 'Units, authored inputs and dependent derived values cannot merge as independent text fields.', caseIds: ['units-and-dependent-values'], coverage: 'partial' },
  ],
};

export function coverageFor(input: unknown, observations: Observation[], variant: CaseArtifact['variant'] = 'baseline-room-model'):
  Array<{ experimentId: ExperimentId; variant: CaseArtifact['variant']; coverage: Coverage[] }> {
  if (!Check(RegistrySchema, input)) throw new Error('Invalid bound experiment registry.');
  return EXPERIMENT_IDS.map((experimentId) => {
    const definition = input.experiments.find((item) => item.id === experimentId);
    const coverage = definitions[experimentId];
    if (!definition || definition.assertions.length !== coverage.length
      || definition.assertions.some((assertion) => !coverage.some((item) => item.assertion === assertion))) {
      throw new Error(`W1 coverage is stale for ${experimentId}; review every bound assertion.`);
    }
    const caseIds = new Set(observations.filter((item) => item.experimentId === experimentId).map((item) => item.caseId));
    if (variant === 'baseline-room-model') {
      if (coverage.some((item) => item.caseIds.some((caseId) => !caseIds.has(caseId)))) throw new Error('Coverage references an unobserved case.');
      return { experimentId, variant, coverage: structuredClone(coverage) };
    }
    const mapped = coverage.map((item): Coverage => {
      const available = item.caseIds.map((id) => `vmc1-${id}`).filter((id) => caseIds.has(id));
      return { assertion: item.assertion, caseIds: available, coverage: available.length === 0 ? 'not-covered'
        : available.length !== item.caseIds.length ? 'partial' : item.coverage };
    });
    return { experimentId, variant, coverage: mapped };
  });
}
