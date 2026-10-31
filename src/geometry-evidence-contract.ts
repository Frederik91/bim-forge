import { parseGeometryEvidence, assertGeometrySnapshotBound, inactiveInheritedBoxMeasurements } from './geometry-draft-lineage.ts';
import type { GeometryEvidence, GeometryDraftBinding } from './geometry-draft-lineage.ts';
import type { ModelSnapshot } from './room-model.ts';

export { GeometryEvidenceSchema, MAX_GEOMETRY_EVIDENCE_BYTES, GeometryEvidenceLimitError,
  parseGeometryEvidence, readGeometryEvidence } from './geometry-draft-lineage.ts';
export type { GeometryEvidence, GeometryEvidenceV1, GeometryEvidenceV2, GeometryDraftLineage,
  GeometryEvidenceLimitDiagnostic } from './geometry-draft-lineage.ts';

/** V2 requires complete native authority. The snapshot-only form reads historical v1 bindings only. */
export async function assertGeometryEvidenceBound(evidence: GeometryEvidence, snapshot: ModelSnapshot,
  binding?: GeometryDraftBinding): Promise<void> {
  const parsed = parseGeometryEvidence(evidence);
  if (parsed.version === 2 && !binding) throw new Error('Geometry evidence v2 requires a complete native history binding.');
  await assertGeometrySnapshotBound(parsed, snapshot);
  if (!binding) return;
  await assertGeometrySnapshotBound(parsed, binding.snapshot);
  const inactive = await inactiveInheritedBoxMeasurements({ evidence: parsed, binding });
  if (parsed.version !== 2) return;
  const original = binding.history.validateSnapshots([binding.snapshot])[0];
  if (!original) throw new Error('Missing original geometry snapshot.');
  const final = binding.history.validateSnapshots([binding.history.reconcile(binding.baseRevisionId, original)])[0];
  if (!final) throw new Error('Missing reconciled geometry snapshot.');
  const present = new Set(final.entities.map(entity => entity.id.toString()));
  const suppressed = new Set(inactive);
  for (const [index, measurement] of parsed.measurements.entries()) {
    if (measurement.request.subject.kind === 'box' && !suppressed.has(index)
        && !present.has(measurement.request.subject.candidateId)) {
      throw new Error('An active geometry box candidate is absent from the final native model.');
    }
  }
}
