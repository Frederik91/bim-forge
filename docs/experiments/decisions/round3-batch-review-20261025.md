# Bounded batch comparison review

QVM-01, issue #151 with implementation #156. Reviewed after five alternating fresh reduced admissions per source completed on 25 October 2026. The [selection declaration](round3-batch-declaration-20261025.md) predates execution. This review selects an import candidate for a fresh medium/full trial; it does not establish full capacity or adopt production storage.

Control `d3160be232eabbb99e371b427c8bfb422b41d490` flushes at 250 records. Candidate `3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098` flushes at 5,000. Both retain the same post-append 4 MiB canonical-body trigger, complete document validation, hashes, references, source/readback/property oracles and durable publication. The byte trigger permits one-record overshoot and does not bound total wire or heap memory. Seven additional PostgreSQL fixtures cover row boundaries, byte-trigger staging, cross-batch duplicates and late failure atomicity; [59 storage tests passed](round3-20261025/batch-boundary-tests.txt).

| Measurement | Control, five samples | Candidate, five samples |
| --- | --- | --- |
| Complete client-job median and range | 106.019 s; 100.449–133.378 s | 91.842 s; 91.655–93.188 s |
| Ingest median | 53.031 s | 42.340 s |
| Publication median | 27.170 s | 26.987 s |
| Client process-group CPU median | 51.576 s | 45.921 s |
| Observed maximum client cgroup peak | 223,526,912 bytes | 236,269,568 bytes |
| Cluster WAL sync median | 1,291 | 291 |
| Complete body/hash/kind/property fidelity | 5/5; 270,205 records each | 5/5; 270,205 records each |

The candidate meets the declared rule: at least 10% lower median complete-job time, non-overlapping observed timing ranges, full fidelity and memory compliance. Its median is about 13.4% lower. The [selection and raw sample summary](round3-20261025/batch-selection.json) binds the sources, timings and verdict. The new medium/full trials therefore use candidate `3a0b1ef`; original two-hour failed trials remain unchanged.

All ten cases used loader plus generator 1 CPU / 1 GiB, PostgreSQL 1.5 CPUs / 3 GiB, no container swap, max_wal_size 8 GiB, synchronous commit, fsync and full-page writes. Each used a fresh database and private checkpoint before the timed job. Timing is actual client start to Docker finish, excluding the polling interval. Existing server services and declared bounded evidence analysis remained active; host caches were not flushed. The PostgreSQL cluster stayed private and the preview was untouched.

Lower WAL sync counts and ingest times support reduced staging/commit overhead as an explanation. They do not isolate every causal contribution: cluster counters also include background maintenance. Similar publication times show that this change does not remove initial publication work. Candidate memory rose modestly in the observed samples and remained below the cap. No full-model, cold-cache, tail-latency, language or architecture winner follows from this reduced comparison.

The immutable result is [EX-13 bounded-batch-comparison-20261025a](../results/EX-13/bounded-batch-comparison-20261025a/result.json). Raw evidence remains under `/ssd1/bim-forge-qualification/qvm-20261025/round3/artifacts/bounded-batch-comparison-20261025a-terminal-evidence`. Source changes remain draft [#157](https://github.com/Frederik91/bim-forge/pull/157), stacked on explicit experimental purposes [#155](https://github.com/Frederik91/bim-forge/pull/155). No merge, deployment or accepted-model change is authorized.
