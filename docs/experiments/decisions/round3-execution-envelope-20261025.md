# Third qualification execution declaration

Issue #151, QVM-01. Recorded before execution. This tests checkpoint tuning, limited resource sensitivity and separately bounded full completion. Original two-hour failures and all evidence remain unchanged.

## Work and completion criteria

Main owns the exclusive database schedule, server orchestration and evidence. Issue #152 owns explicit opt-in execution purposes. Issue #153 owns the native-computation proposal. Workers use separate worktrees. Completion requires actual terminal outcomes, independent W0 verification, a source-bound review and draft PRs. No merge, production configuration, accepted project or preview change is authorized.

The underlying inventory, generator, canonical bodies, hashes, reference validation, schema checks, durability and complete source/readback/property oracles remain enabled. The full manifest remains `efd1ef057d1f4513b0b89cf380c1fcd6cf0bdc31bd468ce466d3302734484737`. The full inventory is 27,020,089 version records and 145,118,512 logical entity-property values. Success under a longer limit cannot pass or replace the original two-hour target.

## Isolation and fixed controls

Use a new private PostgreSQL 15.14 container and volume under `/ssd1/bim-forge-qualification/qvm-20261025/round3`. No published database port. Retain the prior private qualification cluster and databases. It may be stopped while idle to release resources, after verifying its identity and lack of clients. Existing preview and unrelated services remain active.

Node image is `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`. PostgreSQL image is `sha256:1493afd6cc99c05d611913cd5731aa0a081aefd9ff0b805552e66dc150b17ccc`. Each successful comparison sample uses a fresh database. Source code and generator/profile/manifest bytes are pinned. Database creation and an explicit private-cluster checkpoint finish before the timed client job. No host cache flush or cold-cache claim.

All arms retain fsync, synchronous commit, full-page writes, shared_buffers 256 MiB, work_mem 8 MiB, maintenance_work_mem 256 MiB and one parallel worker per gather. Enable I/O and WAL timing consistently in this new cluster. Docker swap is disabled for the new benchmark containers. This differs from earlier trials and prevents treating this matrix as a direct timing comparison with them.

Aggregate allocation across all old and new qualification data, WAL, temporary files and artifacts stays at most 200 GiB. Preserve 100 GiB SSD free and 4 GiB root free. Stop the active trial if those limits fail or monitoring becomes unavailable. Also stop if host available memory falls below 1 GiB. Never drop retained trial databases to make the budget pass. Short-lived client containers may be removed after inspect/log/cgroup evidence is saved; data and artifacts remain.

## Sequential measurement stages

1. Five alternating reduced admissions per WAL setting. Control uses max_wal_size 1 GiB; candidate uses 8 GiB. Both use loader 1 CPU / 1 GiB and PostgreSQL 1.5 CPUs / 3 GiB. Same source per comparison. Each admission must pass full fidelity. Compare phase times, complete client-job duration, WAL bytes/timing, checkpoint counts, CPU, memory and I/O. No general database or language winner follows.
2. Five reduced admissions per resource arm, interleaved in a rotating order: tuned baseline; only PostgreSQL CPU raised to 2.5; only PostgreSQL memory raised to 6 GiB; only loader CPU raised to 2. All use the same explicit resource-sensitivity purpose, source and 8 GiB WAL allowance. Loader memory remains 1 GiB. These reduced results reveal sensitivity only at this size. In particular, no RAM conclusion about a full model can follow from a working set that fits the smaller allocation.
3. One medium admission at the tuned original CPU/RAM caps, with a separately labelled pressure diagnostic. It is not a repeated timing comparison or capacity winner. Preserve actual checkpoint and memory evidence to show whether reduced behavior survives the larger working set.
4. A fresh full initial admission at tuned WAL allowance and the original CPU/RAM caps. Use the separately implemented extended purpose, load-only, one revision, exclusive lease, six-hour cooperative and external deadline plus termination grace. Record whether it crossed two hours. Preserve any complete revision after a later verification failure, but do not call it a successful admission. No resume of prior partial staging.
5. Only after complete full admission and exact initial-state capture, run the existing independently checked full selection and bounded durable-change stage. Keep its 15-minute external limit and original small-sample/authority limitations. Capture initial evidence before this stage advances the disposable branch.

Reduced loads have a 15-minute internal limit and 16-minute external limit. Medium has a 60-minute internal limit and 61-minute external limit. Full has a six-hour limit plus at most 30 seconds for termination. Unexpected failure stops the measurement sequence for investigation. Each new attempt uses a distinct ID. No more than three failed attempts on one item.

## Reporting and native computation

Raw samples and actual failures are retained. Comparative summaries use medians and ranges, five samples per arm and actual error/fidelity counts. Component diagnostics do not imply end-to-end improvements. Sampled resource data, exact counters, post-run inspection and timed operations have distinct scopes. Overall EX-13 remains unqualified until its missing history, contention, authority and geometry/exchange gates are met.

Issue #153 proposes native ownership for CPU-heavy geometry/spatial work and explicit bounded data contracts. The current checkpoint failure is not evidence that rewriting TypeScript would fix it. A language migration needs workload-equivalent correctness and end-to-end CPU/memory evidence, including transfer costs. No speculative compatibility layer or duplicate authoritative graph is added in this experiment.
