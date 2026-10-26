# Reduced resource sensitivity and continuation review

QVM-01, issue #151. Reviewed after the 20-case resource sequence and separate continuation preflight completed on 25 October 2026. These results do not establish full-model hardware needs.

[EX-13 resource-sensitivity-20261025a](../results/EX-13/resource-sensitivity-20261025a/result.json) contains five fresh reduced admissions per arm, in a rotating order. Every admission preserved all 270,205 records and complete source/body/kind/property fidelity. All arms used source `d3160be232eabbb99e371b427c8bfb422b41d490`, 8 GiB max_wal_size and the explicit resource-sensitivity purpose. Only the named resource changed. Loader memory remained 1 GiB.

| Arm | Loader CPU | PostgreSQL CPU / memory | Job median | Observed range |
| --- | --- | --- | --- | --- |
| Baseline | 1 | 1.5 / 3 GiB | 109.7 s | 99.5–127.0 s |
| Database CPU | 1 | 2.5 / 3 GiB | 108.7 s | 103.5–109.1 s |
| Database memory | 1 | 1.5 / 6 GiB | 102.8 s | 100.4–103.9 s |
| Loader CPU | 2 | 1.5 / 3 GiB | 99.7 s | 99.5–109.2 s |

The ranges overlap. This sequence does not establish a clear timing benefit from extra resources at the reduced scale. It cannot establish that 3 GiB is enough for full-model caches or expensive global queries. The [summary and raw measurements](round3-20261025/resource-sensitivity-summary.json) retain phase timing, client process-group CPU/peak, WAL counters and failures. No CPU/RAM hardware winner is selected.

The [round-three declaration](round3-execution-envelope-20261025.md) keeps the later full completion trial at the original loader 1 CPU / 1 GiB and PostgreSQL 1.5 CPUs / 3 GiB. The ordinary execution contract remains unchanged. Draft [#155](https://github.com/Frederik91/bim-forge/pull/155) adds explicit opt-ins for resource sensitivity and the separate six-hour full-completion purpose, with negative admission tests. It also keeps the remaining load deadline through readback, property counts and exact final metrics. Interactive limits start only on the interactive path.

## Real continuation preflight

After the resource evidence was frozen and published, [EX-13 r3-handoff-reduced-20261025a](../results/EX-13/r3-handoff-reduced-20261025a/result.json) ran against the preserved baseline-1 database. It accepted the matching resource-purpose observation and exact original artifact/source bindings. All independent space/type/system selection counts and ordered-ID hashes passed. Five samples per read completed without errors. Two durable single-object metadata commits passed reconnect/replay, exact delta and known-history checks, and restored the original body.

Separate read-only point inspection verified the initial revision, both receipts and parents, selected deltas, initial/changed/restored body hashes and final head. [Execution facts](round3-20261025/reduced-handoff-facts.json) and [metadata facts](round3-20261025/reduced-handoff-metadata.json) retain the actual result. The baseline-1 test branch now has those two additional revisions and one additional immutable version. Its original initial-admission record and frozen evidence describe the earlier state and remain unchanged.

This checks the actual continuation/inspection code before a full-size stage. It does not qualify general historical reconstruction or tail latency. The sampled detail/edit target is the first source entity, pages contain 50 objects, and the sampled one-hop result contains one relationship. A successful reduced preflight never substitutes for failed or incomplete full admission.

## Source and monitoring gates

The initial broader source preflight failed before publication: its launcher used an invalid issue141 database prefix and omitted the new fixture artifact/root-mount inputs. Two new tests also assumed repository-root cwd. Original failure output is retained. Module-relative fixture resolution fixed the test paths; the launcher now supplies the required isolated database, artifact paths, source commit and read-only root mount. No validator was weakened.

The corrected control and initial batch-candidate source checks passed 52 storage tests, 22 qualification tests and five W0 tests without skips. The separate [batch-boundary output](round3-20261025/batch-boundary-tests.txt) passes 59 storage tests at candidate `3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098`. These include 4,999/5,000/5,001-row fidelity, byte-triggered staging and late failure atomicity. Actual batching timing is a separate comparison in draft [#157](https://github.com/Frederik91/bim-forge/pull/157).

The independent monitor now derives the database from a verified private-cluster URL, retaining exact application/PID/backend-start cleanup. A [cross-database-name probe](round3-20261025/enforcer-cross-database-probe.json) stopped its owned client/backend while preserving an unrelated one. This proves the ownership/cleanup case needed when a continuation stage uses its own request ID against an existing database. It is not an admission benchmark.

W0 verified and published both new records. Raw roots are `round3/artifacts/resource-sensitivity-20261025a-terminal-evidence` and `round3/artifacts/r3-handoff-reduced-20261025a-terminal-evidence` below `/ssd1/bim-forge-qualification/qvm-20261025`. Source checks, failed preparations, databases and monitoring evidence remain retained. All PRs remain draft. No production schema, accepted project or preview changed. Native computation ownership remains a separate [proposal #154](https://github.com/Frederik91/bim-forge/pull/154).
