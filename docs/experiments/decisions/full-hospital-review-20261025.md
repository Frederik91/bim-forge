# Full hospital load review

QVM-01 / issue #130. Coordinator review, 25 October 2026. This closes the first execution round with a failed full-load capacity trial and an unadopted design candidate.

## Observed limit

[EX-13 `hospital-full-20261025a`](../results/EX-13/hospital-full-20261025a/result.json) timed out. Runner `612dd75192d4605096efd3ed52f02c4abd913de1` did not admit, publish and verify the full inventory inside the predeclared two-hour envelope. Execution ran from 12:25:42 to 14:25:46 UTC, including termination. The outer timer returned 124. The runner also retained its cooperative wall-limit failure. Neither is a successful load sample.

The source manifest contains 6,777,445 entities, 18,742,644 relationships and 1,500,000 parameters, totaling 27,020,089 version records. Exact post-run inspection found 13,602,755 staged versions. All entity records were present, followed by 6,825,310 relationship records. No parameter records were present. The source/database full-body oracle did not complete.

There were zero revisions, branch heads, visible memberships, changes and acceptance receipts. Incomplete staged versions remained unpublished. PostgreSQL database size was 24,974,684,975 bytes. That size describes partial staging, not a complete hospital or its history. State inspection ran separately from 14:28:11 to 14:29:15 UTC and is excluded from the load duration.

The client and producer shared one CPU and 1 GiB. PostgreSQL had 1.5 CPUs and 3 GiB. No client or PostgreSQL OOM kill, or disk-budget stop, was recorded. Existing host services remained active. The run establishes failure of this implementation and envelope. It cannot select a language or storage architecture, establish an isolated throughput comparison, or qualify full-scale interactive latency.

## Evidence and retention

The terminal record binds actual observations, source and definition commits, manifest SHA-256, every retained artifact's bytes/hash, resource series, process phases, errors and orchestration scripts. W0 `a98b6cd` verified and published it. Private evidence root:

`/ssd1/bim-forge-qualification/qvm-20261025/artifacts/hospital-full-20261025a-terminal-evidence`

Small review copies of [execution facts](full-hospital-20261025/execution-facts.json) and [exact state](full-hospital-20261025/final-state.json) are retained beside this review. Their original hashes remain in the terminal record. Raw files, failed attempts and the separate disposable database remain available under server filesystem access. No automatic cleanup is configured.

The 25 earlier consolidated records remain immutable. Adding this terminal record makes 26 records, including separate experiment views and interpretations of shared physical runs. It does not mean 26 independent benchmark executions. The earlier source-retention audit and IFC metadata reconciliation remain applicable.

## Subsequent transport verification

The full run retained its original transport. After the run and exact state capture, integration source `1146065ebabab93bdaef932402fb796b9f82cc4e` passed seven storage checks in a new PostgreSQL database, `qvm_w5_postfull_20261025a`. The [test output](full-hospital-20261025/postfull-transport-tests.txt) and [source binding](full-hospital-20261025/postfull-source-commit.txt) are retained. This includes typed-document readback, CAS races, reference rejection, retries, branch divergence and history checks, plus boundary/decoder cases. No tests were skipped.

That source removes a duplicate outer document from insert arguments while preserving complete bodies, SQL-visible fields and version hashes. Its separate 65-entity byte diagnostic and tests do not establish a full-load speedup. The full trial was not rerun with this change. Selection utility unit tests passed earlier, but its full working-set queries were not run against an unpublished partial graph.

## Next bounded experiments

1. Measure the bulk path after reusing one verified canonical serialization/hash per prepared record and removing duplicate transport. Retain schema validation, byte/count hashes and complete database readback. Use alternating reduced runs before declaring a speedup or spending another full-load slot.
2. Qualify atomic publication and scoped validation at larger sizes. Current whole-branch reference scans, branch-visibility copies and recursive history remain limitations. Test incoming references, query assumptions, evaluated dependants and rollback explicitly.
3. Repeat full admission under a new declared run ID only after the reduced evidence supports it. Run full working-set oracles, updates and history/client sweeps only after complete publication and source fidelity succeed.

The IFC bounded-property loss and latest complete engine rerun remain separate blockers. General topological naming, kernel upgrades and independent authentication/host failures remain unqualified. Combined adoption requires those results as well as capacity evidence. All PRs remain draft. No production schema, accepted model or preview deployment changed.
