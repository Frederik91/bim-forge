# Second-round reduced admission review

QVM-01, issue #142. Coordinator review, 25 October 2026. This reviews completed reduced admissions and component diagnostics. The second full admission is a separate execution and remains running at this review.

## Prepared import comparison

[EX-13 `prepared-comparison-20261025c`](../results/EX-13/prepared-comparison-20261025c/result.json) completed with an inconclusive overall qualification. It groups ten physical admissions, five alternating fresh databases per variant. Control `1146065` and prepared candidate `76b0bbf` preserved the same 270,205 records, canonical bytes, fingerprint, kind counts and logical-property counts. Every producer and source/readback oracle passed without unexpected errors.

| Measurement | Control median, range | Prepared median, range |
| --- | --- | --- |
| Ingestion | 81.8 s, 75.3–90.7 s | 61.8 s, 60.3–79.3 s |
| Initial publication | 26.5 s, 25.6–27.7 s | 27.3 s, 27.0–27.4 s |
| Client process-group CPU | 85.3 s, 81.7–87.3 s | 58.3 s, 57.2–60.2 s |
| Complete measured job | 138 s, 136–150 s | 113 s, 112–131 s |

The [samples and summary](round2-20261025/reduced-comparison-summary.json) distinguish ingestion, publication, analyze, CPU and job duration. Job timestamps have one-second resolution. They include the client setup and complete admission/readback path after database creation. Loader phase and cgroup CPU measurements have finer resolution.

Canonical serialization/hash work and batch round trips were removed, with identical data retained. Publication did not improve in this comparison. Prepared-stage analysis moved some work into that phase. Existing services and host caches remained active. These results describe this reduced path on this host, and cannot establish full-scale throughput, a general language advantage or a storage architecture decision.

Both variants used a 1 CPU / 1 GiB client and PostgreSQL at 1.5 CPUs / 3 GiB. Each sample had a new database, preventing reuse of staged immutable versions. Allocation was checked before each sample and free-space reserves at loader checkpoints. Full loading uses its own continuous watchdog.

## Later component checks

Final integration source `c0ad967` additionally preserves COPY literal spans, analyzes the actual initial visibility before reference validation, and allows a full-reference anti-join while limiting the diagnostic witness. All five reference columns remain enforced. Scoped acceptance validates outgoing changed references and surviving incoming references to deleted identities, inside the original locked transaction. Commands are copied before awaiting the transaction so caller mutation cannot alter a receipt's content.

Five alternating COPY decoder samples consumed all cells from 6,805 retained actual W4 rows. Output hashes and byte counts matched. Median transform-and-hash time was 440.2 ms for the original decoder and 92.4 ms for the literal-span decoder. This [byte-transform diagnostic](round2-20261025/decoder-timing-summary.json) includes neither database work nor a product throughput claim.

Five alternating read-only reference checks ran on a source-verified 270,205-record graph. Both returned no missing references. Median query time was 1,257.0 ms for the indexed lookup plan and 412.9 ms for the candidate. Separate actual plans showed repeated indexed lookups in the control and a parallel hash anti-join in the candidate. No hash spill occurred at this size. These [query timings](round2-20261025/reference-timing-summary.json) describe the reference check, not the complete publication phase. Full-scale memory, spill and latency remain unqualified by this diagnostic. No runtime planner setting was disabled.

The final source passed root validation, strict storage and qualification checks, 42 storage tests, 13 qualification-runner tests and five W0 tests, with no skips. This includes every initial reference column, incoming deletion rejection, atomic retargeting, staged duplicate rollback, CAS races, replay and command ownership. A separate profiled reduced admission also passed the complete body/count/property oracles. Its instrumented timings are excluded from the comparison.

The [aggregated parent V8 profile](round2-20261025/profile-aggregated.json) includes idle samples as well as canonicalization, hashing and parsing. It covers the loader process, not the generator child, PostgreSQL or the whole host. Idle samples do not establish a whole-system bottleneck. The unaggregated call-tree-node summary is retained for provenance.

## Retention and next gate

Raw roots beneath `/ssd1/bim-forge-qualification/qvm-20261025/artifacts` are `prepared-comparison-20261025c-terminal-evidence`, `decoder-diagnostic-20261025b`, `reference-diagnostic-20261025b`, `round2-final-source` and `round2-final-reduced-profile`. W0 verified and published the consolidated reduced record. Its hashes retain original observations, source bindings, orchestration, validation outputs and the manual-declaration timestamp clarification. The earlier permission-only comparison preflight ran no workload and remains separate raw preparation evidence.

Source PRs [#143](https://github.com/Frederik91/bim-forge/pull/143), [#144](https://github.com/Frederik91/bim-forge/pull/144), [#145](https://github.com/Frederik91/bim-forge/pull/145) and combined [#146](https://github.com/Frederik91/bim-forge/pull/146) remain draft. A fresh full trial tests the unchanged inventory and original two-hour resource envelope. Full selection oracles and durable bounded changes may run only after complete full admission. The first failed full trial and its review remain unchanged. No production model, schema or preview changed.
