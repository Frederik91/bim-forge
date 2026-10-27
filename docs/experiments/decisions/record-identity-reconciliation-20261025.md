# Reconciliation of duplicate IFC record identities

QVM-01 / issue #130, 25 October 2026. This supplements the earlier exchange review without changing any executed observations.

While W2 finalized its verified inputs, the coordinator also published an interpretation of the same inputs into a separate output root. Both used the planned run IDs `w2-partial-exchange-20261025-01` and `w2-partial-coordinates-20261025-01`. The W2 records describe the checked 1 GiB evidence-packaging budget; the coordinator records use null for the unrecorded original execution budget. These are distinct metadata interpretations and should have received distinct IDs before publication. The coordinator owns this consolidation error.

Both server publication roots remain unchanged. The worker originals are retained at their original Git paths from [PR #137](https://github.com/Frederik91/bim-forge/pull/137); the coordinator's original bytes are additionally retained under `decisions/record-collision-20261025`. Those archival copies are not the latest terminal interpretation. Existing Git commits also preserve every earlier copy.

The following new W0-verified records are authoritative for the registry's current review:

- EX-02: `w2-exchange-review-20261025-02`, failed.
- EX-08: `w2-coordinates-review-20261025-02`, inconclusive.

Their artifact root is `/ssd1/bim-forge-qualification/qvm-20261025/artifacts/w2-coordinator-review-20261025`. Each includes both colliding original records as hashed provenance and the byte-preserved original engine evidence. The corrected environment uses null for the unrecorded original disk budget; neither record can conclude passed. No test, preparation or engine run was repeated.

The bounded-property loss, coordinate passes, unavailable schema/hash checks and all limitations from the earlier exchange review remain unchanged. These records correct metadata identity and interpretation; they do not improve the experimental outcome.

Subsequent consolidation must use the existing W0 publisher against the coordinator's one canonical output root before copying records into Git. Its exclusive directory creation rejects an existing identity. A differing record requires a new ID and a separate reconciliation record; file-copy operations must never choose a winner. This also preserves independent worker evidence when results come from separate installations.
