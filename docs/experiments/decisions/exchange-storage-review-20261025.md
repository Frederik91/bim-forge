# Exchange, history and initial storage review

QVM-01 / issue #130. Coordinator review, 25 October 2026. These results do not adopt a production model or storage schema.

## IFC preservation and coordinates

EX-02 `w2-partial-exchange-20261025-01` is failed. The executed historical preparation plus downstream roundtrip retained every observation: an unfamiliar `IfcPropertyBoundedValue` was actually lost through the experimental native scalar/list conversion. Other schema-dependent failures were caused by the historical environment missing pytest; those failures do not establish invalid IFC. Latest preparation fixes passed source-unit tests but the full engine preparation was not repeated after retry escalation. Original failures remain immutable.

EX-08 `w2-partial-coordinates-20261025-01` is inconclusive. Sixteen independent coordinate cases and sixteen real IfcOpenShell geometry cases passed. Four exact-hash cases could not execute because unnamed root fields retained STEP sentinels instead of JSON null. The subsequent source regression tests cover the fix but do not replace an unexecuted latest-source engine run. Synthetic map transforms do not establish survey accuracy or viewer-origin behavior.

[Draft PR #137](https://github.com/Frederik91/bim-forge/pull/137) retains the controlled IFC files, latest validated source and exact limitations. Relative terminal artifact paths resolve against `/ssd1/bim-forge-qualification/qvm-20261025/w2-runs/w2-terminal-package-20261025-01/evidence`. The coordinator published unchanged executed observations through W0, using null for the unrecorded original disk budget. The separately checked packaging budget is not treated as an original execution limit.

Eight controlled paired-export contribution cases are available in the W2 package. They are generated IFC files, not independent Revit/vendor exports. They supplement identity evidence without qualifying general source-ID churn or cross-vendor lineage.

Preserving unknown IFC content must be an explicit exchange contract. Retaining only recognized scalar/list values is insufficient. Both experimental routes share IfcOpenShell serialization/geometry, so these results do not select an IFC-native or native-authoring winner.

## Bounded history

EX-10 `native-history-20261025b` completed with no unexpected operation errors. The actual native product fixture contains six source records. Its aging phase created 1,000 revisions before mixed traffic, and the initial revision still reconstructed identically. Five alternating full-snapshot-reference/candidate materializations executed within existing native bounds. The snapshot comparator is a PostgreSQL reference layout, not the existing runtime persistence adapter.

The run used a separate `qvm_w5_history_20261025b` database and a shared correctness slot. It records source fingerprints, counts, immutable deltas, indexes, versions, visibility, snapshots, raw timings and resource settings separately. Cluster-wide WAL deltas can include other correctness activity. There is no isolated relative winner, paced offered-load qualification or full hospital/history Cartesian result. Overall conclusion remains inconclusive.

Private artifact root: `/ssd1/bim-forge-qualification/qvm-20261025/artifacts`; relative history paths are under `native-history-20261025b/run`. [Draft PR #136](https://github.com/Frederik91/bim-forge/pull/136) contains the experimental store and diagnostic runners.

## Initial hospital admission

The first unoptimized smoke run preserved 27,075 records but exceeded the predeclared page target. Profiling identified repeated interpreted schema validation; cached compiled validators retain the same schemas and rejection behavior. Five alternating CPU-side diagnostic pairs retain identical source and output hashes. This is diagnostic evidence, not a product speedup claim.

The next reduced run was cancelled by the coordinator after its reference-validation query stalled. Captured SQL plans show a nested-loop anti join materializing branch targets instead of binding each reference lookup. The subsequent query structurally bounds each target lookup by its indexed branch/entity key, while retaining the dangling-reference validator and atomic rollback behavior. Root validation and all 24 combined tests passed before replay.

The final preflight `hospital-reduced-20261025c` preserved 270,205 records, passed source/database fingerprints and property counts, reconstructed its initial revision after edits, and had no unexpected operation errors. Its exploratory component targets were met, with only one bounded acceptance/delta sample; that is insufficient to establish tail latency. Correctness retries reused staged immutable versions in the shared database, so their ingest times cannot establish a fair throughput comparison. Full initial loading therefore uses a fresh database.

The full manifest was generated from 6,777,445 entities, 18,742,644 relationships and 1,500,000 parameter records. It contains exact stream hashes and 145,118,512 logical entity-property values. Generation took 8:41.13 at one CPU, with maximum RSS 181,612 KiB. These are generator measurements, not completed database admission. Full loading remains running under its separately declared two-hour envelope.

Retain raw evidence and failed attempts through the architecture decision. Private artifacts follow server SSH/filesystem access; no automatic cleanup is configured. The production preview and accepted model remain unchanged.
