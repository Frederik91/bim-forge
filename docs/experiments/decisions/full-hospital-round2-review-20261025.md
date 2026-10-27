# Second full hospital qualification review

QVM-01, issues #142 and #130. Coordinator review, 25 October 2026. The second full admission failed its unchanged two-hour target. The design remains unadopted.

## Full admission missed its target

[EX-13 `hospital-full-20261025b`](../results/EX-13/hospital-full-20261025b/result.json) ran from 15:13:54 to 17:13:59 UTC, including termination. Runtime `c0ad96765e8fee8088188894dc484f3a81704dda` recorded `Predeclared load wall-time limit exceeded`. The outer wait returned 124. The container exited zero after recording that failure. A zero container exit does not establish successful admission.

The unchanged source requires 6,777,445 entities, 18,742,644 relationships and 1,500,000 parameters. Those are 27,020,089 version records and 145,118,512 logical entity-property values. Manifest SHA-256 is `efd1ef057d1f4513b0b89cf380c1fcd6cf0bdc31bd468ce466d3302734484737`.

Exact inspection found 23,791,755 staged versions. The entity counts match the full inventory. The remaining 17,014,310 records are relationships. No parameter records were present. There were zero revisions, branch heads, visible memberships, changes and receipts. Complete source/body/property readback never completed. The partial database occupied 32,218,002,223 bytes, which is not the size of a complete hospital model or its history.

| Retained full attempt | Exact staged records | Published revisions | Admission outcome |
| --- | --- | --- | --- |
| `hospital-full-20261025a` | 13,602,755 | 0 | Two-hour timeout |
| `hospital-full-20261025b` | 23,791,755 | 0 | Two-hour timeout |

These are different single trials, not an alternating throughput comparison. More staged records do not establish complete fidelity or a full-scale speedup. The [first review](full-hospital-review-20261025.md) and its terminal record remain unchanged.

The producer and client shared one CPU and 1 GiB. PostgreSQL retained 1.5 CPUs and 3 GiB, fsync, synchronous commit and full-page writes. Actual images and CPU/RAM settings matched the declaration. No client or PostgreSQL OOM kill, or aggregate disk-budget stop, was recorded. Existing host services remained active. Sampled PostgreSQL activity includes WAL synchronization and data-file reads, but does not isolate one overall bottleneck. This result cannot choose a language or storage architecture.

The [exact state](round2-20261025/full-final-state.json) and [execution facts](round2-20261025/full-execution-facts.json) distinguish the measured admission from state inspection at 17:14:14 to 17:15:38 UTC. The full working-set and durable-change stage was skipped because its complete-admission gate failed. The partial database was not resumed, resized or relabelled.

## Additional reduced stage completed

[EX-13 `hospital-reduced-20261025d-qualification`](../results/EX-13/hospital-reduced-20261025d-qualification/result.json) separately tested the preserved, previously verified 270,205-record reduced admission. It used runner `962d6023119baf070bd6c2a8c599e2cf0ea3186e` and retained admission source `c0ad967`. The [manifest correction](round2-manifest-review-20261025.md) and bounded inspector therefore ran against real PostgreSQL data after their pure tests.

All original admission/config/table/body/property bindings passed. Independent W4 oracles matched the exact counts and ordered numeric-ID hashes for 13,522 hot-space members, 160 shared-type members and 2,779 system members including ports. No full branch copy or complete admission rescan was part of this stage.

Five samples each of page, detail and one-hop reads completed without errors. Two single-object metadata accepts completed, with reconnect, idempotent replay, exact one-object deltas and known three-revision history checks. The second commit restored the original body and reused its immutable version. Separate read-only inspection verified both command receipts, revision parents, selected deltas, initial/changed/restored body hashes and the final head. [Stage facts](round2-20261025/reduced-qualification-facts.json), [metadata facts](round2-20261025/reduced-metadata-facts.json), [original result](round2-20261025/reduced-qualification-result.json) and [raw samples](round2-20261025/reduced-qualification-samples.ndjson) are retained.

The page returned 50 objects. Detail and both metadata edits used the first source entity, and the sampled one-hop result had one relationship. These are bounded correctness and exploratory latency checks, not representative hospital interaction coverage. The stage passed its checks, but its overall conclusion remains inconclusive. Five read samples and two accepts do not qualify tail latency, concurrency, deep history, spatial dependencies or engineering authority. The delta check was verified but not separately timed. This reduced result does not substitute for full admission.

## Improvements and remaining work

The [reduced comparison review](round2-reduced-review-20261025.md) records five alternating fresh admissions per variant with complete fidelity. Median complete job time was 138 seconds for control and 113 seconds for the prepared path. That comparison used `1146065` and `76b0bbf`. Later decoder/reference diagnostics and the profiled `c0ad967` admission remain separate measurements.

The implemented path reuses prepared canonical bodies and hashes, stages each batch atomically and validates changed references without a whole-branch scan during acceptance. Initial imports retain full reference checks. Negative tests preserve every reference column, incoming deletion rejection, retargeting, rollback, CAS, replay and command ownership. Final runtime checks passed root validation, strict storage/qualification checking, 42 storage tests, 13 runner tests and five W0 tests with zero skips.

The current full limit occurs before publication and source readback. Further bulk-path and database-plan/resource investigation must precede another declared full trial. Full publication cost, working-set latency, aged history, branch copies, contention and offered-load sweeps remain unqualified. Separate IFC preservation, kernel/reference and authority gaps from the first assessment also remain open. No production schema, accepted project or preview changed.

## Evidence and review state

W0 verified and published both new terminal records. Their bytes, hashes, source bindings, orchestration, errors, resource series and original observations are immutable. The private roots are `/ssd1/bim-forge-qualification/qvm-20261025/artifacts/hospital-full-20261025b-terminal-evidence` and `/ssd1/bim-forge-qualification/qvm-20261025/artifacts/hospital-reduced-20261025d-qualification-terminal-evidence`. Original databases and artifacts remain retained under server filesystem access. The terminal-sequence directory records the skipped full stage and the order of capture, publication and reduced execution.

The 26 first-round records remain unchanged. The reduced comparison and these two records bring the collection to 29 terminal records, including multiple experiment views of shared physical runs. This is not 29 independent benchmarks. Source PRs #143, #144, #145, #146, #149 and #150, and evidence PR #147 remain draft. No merge, deployment or architecture adoption is implied.
