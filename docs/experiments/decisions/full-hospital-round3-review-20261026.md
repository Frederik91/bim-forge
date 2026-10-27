# Third full admission and constrained-resource review

QVM-01, issue #151. Reviewed on 26 October 2026 after the complete sequence reached terminal outcomes. This review preserves both earlier two-hour failures. The new full admission failed because budget monitoring became unavailable; it is not a six-hour timeout or a disk/RAM capacity verdict.

## Completed comparisons

The [execution declaration](round3-execution-envelope-20261025.md) predates the run. All tests retain source bodies, hashes, kind/property counts, reference validation and durability.

| Experiment | Actual result | Scope |
| --- | --- | --- |
| [WAL comparison](round3-checkpoint-review-20261025.md) | Ten reduced admissions passed full fidelity; requested checkpoints changed from one per control to zero per tuned case | Timing ranges overlap; no general speedup claim |
| [CPU/RAM comparison and continuation](round3-resource-review-20261025.md) | Twenty reduced admissions passed; five per resource arm. Separate continuation passed independent selection, two durable edits and point inspection | Ranges overlap; no full-memory conclusion |
| [Batch comparison](round3-batch-review-20261025.md) | Ten reduced admissions passed; candidate median 91.842 s versus 106.019 s, non-overlapping ranges | Declared selection gate passed; about 13.4% lower reduced whole-job median |
| [Medium pressure diagnostic](round3-medium-review-20261025.md) | Complete admission and fidelity for 2,702,011 records in 1,527.484 s | One case, no comparative or full-capacity claim |

Root/strict source checks, 59 candidate storage tests, 22 qualification tests and five W0 tests passed in the documented server scopes. These implementation checks do not replace full admission or qualify production storage. The completed sources remain draft [#155](https://github.com/Frederik91/bim-forge/pull/155) and [#157](https://github.com/Frederik91/bim-forge/pull/157).

## Actual full outcome

[EX-13 r3-hospital-full-20261025a](../results/EX-13/r3-hospital-full-20261025a/result.json) binds source `3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098` and unchanged full manifest `efd1ef057d1f4513b0b89cf380c1fcd6cf0bdc31bd468ce466d3302734484737`. It used loader plus generator 1 CPU / 1 GiB, PostgreSQL 1.5 CPUs / 3 GiB, max_wal_size 8 GiB, no container swap and synchronous durability. The fresh database is `qvm_w5_r3_hospital_full_20261025a`.

The measured client started at 19:56:39.843 UTC on 25 October and finished at 00:01:15.812 UTC on 26 October: 14,675.969 seconds, or 4 h 04 m 36 s. It crossed the original two-hour target. It stopped before the separate six-hour deadline, with exit 143 and an independent stop marker. Complete source/database readback and property oracles did not finish. There were no client or PostgreSQL OOM kills and no frequent-checkpoint warnings. Client process-group CPU was 2,627.986 seconds; peak cgroup memory was 264,540,160 bytes. Neither CPU/wall difference nor one process peak identifies a whole-system bottleneck fraction.

Separate read-only exact state inspection ran from 00:01:20.223 to 00:04:51.361 UTC. The [initial-state facts](round3-20261025/full-initial-state.json) show:

| Retained state | Exact count |
| --- | --- |
| Immutable versions | 27,020,089 |
| Entity records | 6,777,445 |
| Relationship records | 18,742,644 |
| Parameter records | 1,500,000 |
| Published revisions / changes / visibility / receipts / branches | 0 / 0 / 0 / 0 / 0 |
| Database bytes | 48,977,482,543 |

The unfinished publication rolled back. Physical bytes in the changes/visibility tables do not imply accepted rows; exact visible counts are zero. Full selection and durable-change qualification was explicitly skipped. No reduced result substitutes for it. The [execution facts](round3-20261025/full-execution-facts.json) retain the missing runner-terminal evidence and failed admission verdict rather than converting complete staging into success.

## Monitoring failure and correction

The original budget script ran `du -sb` with `set -euo pipefail`. During the scan, PostgreSQL deleted `round3/postgres/base/pgsql_tmp/pgsql_tmp22922.929`. `du` returned nonzero, the monitor wrote `BUDGET-MONITOR-FAILED`, and the independent guard stopped its owned client. The final complete budget sample was below every declared threshold. This was loss of monitoring, not an observed allocation/free-space/RAM breach.

The [separate diagnostic](round3-20261025/monitor-stop-diagnostic-20261026a/diagnostic.json) hashes the original monitor, stderr, failure marker, last complete budget sample and point observations. It does not edit the original full result or frozen evidence. Raw full evidence remains under `/ssd1/bim-forge-qualification/qvm-20261025/round3/artifacts/r3-hospital-full-20261025a-terminal-evidence`.

Issue [#159](https://github.com/Frederik91/bim-forge/issues/159), draft [#160](https://github.com/Frederik91/bim-forge/pull/160), adds a separate operational allocation reader. It requires a fresh successful complete scan, retries at most three times, bounds each attempt by ten seconds plus one-second termination grace, and fails closed without an estimate on persistent errors, timeout or malformed accounting. Thresholds, stale-monitor stopping and the original failed script are unchanged. Root validation and [six server-container probes](round3-20261025/allocation-reader-probe.txt) passed at source `13dba63`. This correction is prepared for a newly declared monitor; it was not retroactively applied to the failed run.

The first and second full attempts timed out, and the third stopped on monitoring failure. In accordance with the repository's three-attempt escalation, no fourth full admission was launched. A new attempt needs review of the monitoring correction, publication evidence and a fresh declaration. This record does not establish whether full completion would have fit the six-hour envelope.

## Implications and next bounded work

Two read-only point observations at 22:31 and 23:48 UTC caught the same `INSERT INTO qvm_storage.changes ... FROM w5_load_stage`, waiting on `DataFileRead`. Its observed query ages were 38 min 55 s and 1 h 55 min 43 s. These are point samples, not an exhaustive wait profile. They identify a material publication operation to investigate. The medium run also spent 811.887 s in publication versus 439.615 s in ingestion. Inspect publication plans, index/foreign-key access and working sets before choosing a further optimization; preserve atomic visibility and all validation.

Permanent resource constraints support bounded working sets and native ownership for new heavy computation now. The [separate proposal #154](https://github.com/Frederik91/bim-forge/pull/154) assigns established native kernels to engineering geometry, prefers Rust for new application-owned spatial/numerical kernels, and retains TypeScript for UI, agents, review policy and transaction orchestration. It adds no empty adapters or speculative Rust service. No Rust performance advantage or inevitable whole-backend rewrite was measured. Changing the producer language would not remove the observed SQL publication work.

Overall EX-13 remains failed and production adoption unqualified. Full working-set latency, deep history, branch copies, contention, paced traffic, IFC fidelity, kernel upgrades and independent authority remain open. All PRs remain draft; no merge, deployment, production schema or accepted model changed.
