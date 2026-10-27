# Second hospital execution envelope

QVM-01, issue #142. Recorded before the second full execution on 25 October 2026. The first trial and its failed admission remain immutable under `hospital-full-20261025a`.

## Question and gates

Can the prepared-record import and scoped acceptance candidate admit the unchanged complete hospital inventory within the original envelope, preserve every source body, and execute independently checked bounded working-set queries and durable changes?

The control is integration `1146065`. The prepared bulk candidate is `76b0bbf`. Five alternating reduced pairs use fresh databases, identical W4 source tables, unchanged host caches and the same resource limits. Every sample must complete producer byte/count hashes, source/database fingerprint, kind counts and logical-property oracles without unexpected errors. A failed comparison preflight caused by host filesystem permissions is retained separately. Budget inspection runs as root inside a bounded container so it can inspect the private PostgreSQL directory.

Full execution requires those fidelity gates, strict/root source validation, complete scoped-reference negative cases, CAS/receipt/history regressions and the integrated runner's rejection tests. The full runtime source is pinned in its actual artifact record before launch. A profiler run, if used, is separate from measured repetitions. No language or database winner follows from these experiments.

## Fixed limits

Use the existing private PostgreSQL 15.14 container at 1.5 CPUs and 3 GiB, and a fresh named `qvm_w5_hospital_*` database. The combined producer and loader use one CPU and 1 GiB. Keep fsync, synchronous commit, full-page writes, validators, indexes and complete bodies enabled. Existing host services remain active. No isolated whole-host or cold-cache claim is made.

Keep total qualification data, WAL, temporary data and retained artifacts at most 200 GiB. Preserve at least 100 GiB free on `/ssd1` and 4 GiB on the host root. The dedicated aggregate watchdog stops only this round's client if a budget is breached or monitoring fails. Earlier artifacts and databases are retained and count against the aggregate limit.

The hard initial admission limit remains two hours and includes generation, staging, atomic publication, analyze and complete source/readback/property verification. Termination and separately timestamped state inspection are reported explicitly. Failure remains a failed attempt. Do not resume partial data, publish a smaller inventory or extend the budget under the same run ID.

## Full workload and interpretation

The immutable full manifest binds 6,777,445 entities, 18,742,644 relationships and 1,500,000 parameters, totaling 27,020,089 version records and 145,118,512 logical entity-property values. The generator streams the same exact source bytes. No geometry or real hospital engineering inventory is simulated.

After complete admission, a separate bounded qualification stage verifies the preserved admission artifacts, published head and revision payload, then checks hot-space, shared-type and system selection counts and ordered-ID hashes against W4. The hot-space oracle expects 1,352,042 entities. Configure an explicit two-million-row bound per selection while retaining 1,000-row keyset pages.

Use one connection at a time, at most five read samples per operation, two durable metadata commits with an intervening reconnect/replay check, and at most fifteen minutes for this stage. Restore the edited document through the second commit. Retain the initial revision, both deltas, original bodies and receipt evidence. A failure can leave the first test commit on the disposable branch and must be recorded. No full branch copy or repeated complete admission scan is required by this stage.

The initial exploratory targets remain 300 ms for detail, 1,000 ms for a bounded page or one-hop query, 2,000 ms for a bounded delta and 4,000 ms for small durable acceptance. Record actual sample counts, failures and raw durations. Two acceptance samples cannot qualify tail latency. Deep full-model history, contention, paced offered load, independent authority, geometry and production adoption remain outside this bounded second trial.

All terminal observations, source bindings, resource samples, orchestration scripts and errors are hashed through the W0 result contract. The coordinator publishes a separate review without changing earlier terminal records. All PRs remain draft. No production schema, accepted project or preview is changed.
