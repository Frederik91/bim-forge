# Unaccepted geometry in request conversations

Issue: https://github.com/Frederik91/bim-forge/issues/240. This is a separate follow-up to spatial markup PR239.

## Behavior

A conversation can add two trial cubes, then remove one without accepting either. The remaining cube must still satisfy its measured clearance. Accepted elements, source observations, IFC references and accepted Main/baselines retain their existing checks. Removing a trial cube must never erase the earlier turn or its evidence.

## Decision

Keep a bounded, self-contained proof of predecessor drafts in geometry evidence. Each ancestor binds its exact accepted origin, proposal snapshot digest, evidence digest and receipt/measurement prefix lengths. Canonical ID-based remove/upsert deltas reconstruct its native snapshot. Native validation remains owned by RoomRepository. The full original arrays are immutable append-only prefixes; derived final measurements are separate.

We compared retained pending proposal branches with self-contained proofs. Both can preserve provenance and replay history. Retained branches also import private conversation proposals into accepted model history and repeatedly store overlapping evidence, consuming the existing 32-revision/256 KiB project limits. Self-contained proofs retain one accepted proposal and consume the existing geometry evidence limits. Neither representation raises limits: 64 KiB, 128 receipts, 64 measurements and 20 ancestors still apply. Two same-model design workers proposed the alternatives; a different-model judge was unavailable under the tool policy, so the parent evaluates the design and executable evidence independently.

## Native authority

`RoomRepository.geometryHistory(target, through?)` returns a nominal `GeometryNativeHistory` capability, not an object assembled from a projected graph. It exposes the exact project root, writable target, accepted head, complete `acceptedPath(fromRevisionId)`, batch `validateSnapshots(values)` and native `reconcile(baseRevisionId, snapshot)`. Accepted-path validation shares the repository's existing target authority walk. Batch snapshot validation reuses the native parser and one invocation-local AssetFamily identity registry seeded by native history.

Original bases are frozen reconstruction inputs. Current accepted state is a separate freshness and reconciliation input. An unrelated accepted edit must not produce a blanket stale-base refusal. Historical accepted reviews use their decision-time accepted parent; later accepted state must not reinterpret an old decision.

## Ownership and boundary

- Portable contract/lineage: versioned schemas, canonical patches, exact prefix replay, hashes and derived obligation plan. Browser-safe; type-only imports of native authority.
- Geometry session: trusted continuation admission, append-only observations, current source validation and final measurement enforcement.
- Native repository: accepted ancestry, model validity, family identity and portable review binding.
- Proposal/queue: one coupled exact predecessor plus reconciled draft seed. The durable ticket and exact stored evidence row establish live predecessor provenance. Legacy history recovery is bounded and all-or-nothing.

Only inherited box-subject measurements can become inactive for a genuinely removed trial addition: the exact predecessor proves the candidate existed, its own complete origin and relevant accepted path prove it was not accepted, and the final candidate omits it. Accepted/current/source endpoints never qualify. Current-generation measurements remain active even if their text duplicates an older call. Reintroducing the candidate reactivates its old obligations. Original against-object/query members and all source receipts remain checked.

Portable hashes prove internal consistency, not the historical identity of a completely forged project author. Live continuation additionally requires the trusted queue row and same ticket; no signing secrets or second provenance store are introduced.

## Acceptance evidence

The initial server-container regression at 2d0ca24 passes strict validation and fails at the expected missing final endpoint after removing the second cube. The follow-up must prove deletion, retained-clearance failure, reintroduction, current duplicate calls, concurrent acceptance, unrelated reconciliation, scoped hidden accepted IDs, legacy recovery, portable restore, repeated turns and decision-time accepted history. Runtime/provider/browser evidence will be reported separately from source checks. No fix or deployment is qualified by this design document.
