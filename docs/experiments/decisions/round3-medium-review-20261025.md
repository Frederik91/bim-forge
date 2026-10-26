# Medium pressure diagnostic review

QVM-01, issue #151. This is one diagnostic admission, not a repeated comparison or a full-capacity result. The [predeclared sequence](round3-execution-envelope-20261025.md) and [batch selection](round3-batch-review-20261025.md) precede it.

[EX-13 medium-pressure-20261025a](../results/EX-13/medium-pressure-20261025a/result.json) records a complete fresh admission of 2,702,011 records at source `3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098`. Its actual client job ran from 19:31:05.652 to 19:56:33.136 UTC on 25 October 2026: 1,527.484 seconds, or 25 minutes 27 seconds, within the one-hour internal limit. Complete body/hash/kind/property readback passed with no runner errors, OOM, budget stop or frequent-checkpoint warning.

Loader plus generator shared 1 CPU / 1 GiB; PostgreSQL had 1.5 CPUs / 3 GiB. Both disabled container swap. The private database retained max_wal_size 8 GiB, synchronous commit, fsync and full-page writes, and the other fixed controls in the declaration. The exact manifest is `c8b63af86a22e09738fae73e4d6f23238a9f9c1381af64c43acab1555f4350db`. It is generated synthetic data, not an independently validated real hospital model.

| Observed measurement | Value |
| --- | --- |
| Ingest | 439.615 s |
| Initial publication | 811.887 s |
| Analyze | 2.061 s |
| Complete client job | 1,527.484 s |
| Client process-group CPU | 422.291 s |
| Maximum client cgroup memory | 236,937,216 bytes |
| Canonical source body bytes | 3,497,263,141 |
| Logical entity-property values | 14,512,288 |

The [execution facts](round3-20261025/medium-facts.json) retain counts, fingerprint, category distribution, actual source and phase durations. Individual phases do not sum to the complete client job: setup and complete verification are also included. The CPU/wall difference does not isolate database wait, and no exact bottleneck fraction is inferred from it. This single case demonstrates completion at this scale; it cannot establish a speedup over earlier source or predict linear full-size behavior.

Publication exceeds ingestion here and becomes a material full-size qualification concern. It retains transactional visibility and reference checks. Replacing a producer language would still leave that database work, so this result does not justify a whole-backend Rust rewrite. The separately declared full run must complete its own publication and complete oracles before any full working-set test.

W0 verified and published this immutable record. Raw evidence remains under `/ssd1/bim-forge-qualification/qvm-20261025/round3/artifacts/medium-pressure-20261025a-terminal-evidence`; the disposable database is `qvm_w5_r3_medium_20261025a`. Earlier failed trials remain intact. The preview, accepted model data and production configuration are unchanged.
