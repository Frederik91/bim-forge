# Single reduced publication profile preparation

This is preparation for issue #162, after review of immutable draft PR #166. It does not replace that report or record a diagnostic outcome. The only authorized future run is one reduced instrumented diagnostic. There is no locality comparison, full admission, retry, resume, or existing-database mode.

The new branch owns only this diagnostic directory. It changes no model entity, product source, package, registry, validator, persistence schema, or durability control. A separate diagnostic record/review is due only after actual terminal execution.

## Exact inputs and instrumentation

Measured source is `3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098`, exported by `git archive`. The reduced manifest SHA-256 is `6214eed2616670c697fa0a90b7a3c3257c116faaeca0591b32cab58c5a4aa3ca`. It declares 270,205 records with seed `bim-forge-hospital-200k-v1`. Admission table hashes and counts come from the retained reduced case; the original W4 generator checks each produced table's complete bytes and row count. The fixed expected canonical fingerprint is asserted independently after the source's complete body/hash/kind/property readback.

`instrument.py` reads measured files and creates additional `load-profile.ts` and `workload-profile.ts` modules. Exact statement anchors must occur once. The original modules are never overwritten. The workload copy changes only its load-module import. The load copy adds before/after phase hooks around the original statements. Both inserts and `store.validateReferences(branch)` still execute once on the original publication transaction/session.

The hooks enable session-local `auto_explain` only for changes, visibility, and full-reference validation. Settings are analyze/buffers/WAL/triggers/timing/verbose on, JSON output, sample rate one, and nested logging off. Plans arrive as client notices and are saved separately. Both FK trigger sets must report 270,205 calls per constraint; the reference plan must report zero missing-reference rows. The original validator still consumes and rejects its actual witness result. Missing plans, extra plans, or incomplete trigger counts fail the diagnostic.

This uses the [PostgreSQL 15 auto_explain facility](https://www.postgresql.org/docs/15/auto-explain.html), which supplies EXPLAIN ANALYZE instrumentation without executing a statement twice. It differs from wrapping the validator in an explicit EXPLAIN that suppresses the witness result. Profiling, phase snapshots, and observation add overhead. No whole-admission speedup or full-size limiter follows from this single case.

Phase snapshots include database, WAL, checkpoint, relation/index IO, and transaction-local table counters. Cumulative statistics may lag; they are not query-exclusive times. The independent observer records actual backend PID/start, application, SQL, query age, state, and wait about every second. Every fifth observation also captures cgroups and per-process CPU. Collection duration and gaps are retained. The same client records analyze, changes, visibility, reference, head, receipt, commit, and complete-readback boundaries.

## Preparation and resource contract

Prepared files live at `/ssd1/bim-forge-qualification/house-161/issue162-reduced-profile-prep-20261026a`. A successful single network-none preparation check produces `checks.log`, container inspection, generated-module hashes, and `ready.json`. The ready file seals every runtime input. The launcher refuses a missing success marker or a changed input hash. That check uses tools image `bim-qvm-tools:20261025`, .25 CPU, 1 GiB, and no swap. It runs root validation, diagnostic style/strict compilation against the measured source, shell syntax, and safety tests. It starts no DB. Mocked Docker-boundary safety tests do not prove live watchdog termination.

The future run root is `/ssd1/bim-forge-qualification/house-161/issue162-reduced-profile-20261026a`. It must not exist. Fixed new names are `bim-issue162-profile-20261026a-{pg,client,budget}` and `bim-issue162-profile-20261026a-net`. Each resource also carries a fresh ownership nonce. Cleanup checks both name and nonce, then signals exact container IDs. Existing `bim-qvm-db` and `bim-qvm-r3-db` are inspected only for state, never queried or signaled. All historical mounts are read-only. Preview is untouched.

PostgreSQL is pinned to `sha256:1493afd6cc99c05d611913cd5731aa0a081aefd9ff0b805552e66dc150b17ccc`, server 15.14, 1.5 CPUs/3 GiB/no swap, on a new internal network without host ports. Client and generator together use tools image `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`, 1 CPU/1 GiB/no swap. The budget collector uses that image separately at .25 CPU/256 MiB, with no network.

Fixed PG settings are shared_buffers 256 MiB, work_mem 8 MiB, maintenance_work_mem 256 MiB, max_wal_size 8 GiB, max_connections 80, one parallel worker per gather, IO/WAL timing on, and fsync/synchronous_commit/full_page_writes on. Actual version/settings, constraints, trigger enablement, indexes, and sizes are retained. The source's own isolation, execution-envelope, schema, reference, checksum, count, property, and transaction checks remain enabled.

The lease is at most 15 minutes total. Setup has at most three minutes; the instrumented job, including source setup and complete readback, has at most eight minutes. Inspection stops with at least two minutes left. The independent watchdog enters cleanup no later than 90 seconds before lease expiry. No deadline is extended. The exact ready command adds an external 885-second timeout with a 15-second kill grace, while the independent watchdog survives controller termination.

Absolute limits remain additional allocation at most 10 GiB, all old and new qualification allocation at most 200 GiB, SSD free at least 100 GiB, root free at least 4 GiB, and host MemAvailable at least 1 GiB. The collector scans the entire `/ssd1/bim-forge-qualification` tree, including all older trials and this preparation/run. It stops proactively at 8 GiB additional, 198 GiB aggregate, SSD below 101 GiB, root below 5 GiB, or host memory below 1.25 GiB. It records disappearing-file races and tolerates only the corresponding ENOENT scan diagnostic. All other scan failures fail closed. This is a sampled allocation guard with headroom, not a filesystem quota. If scan speed/freshness or remaining headroom cannot support it, the run stops and retains the gap.

A separate watchdog process stops only owned containers if controller, budget, or activity telemetry is stale for 15 seconds, a guard fails, the eight-minute job ends, or lease cleanup time begins. Its own heartbeat is checked by the controller. A host marker at `/ssd1/bim-forge-qualification/house-161/loop-pause-all` also stops the run. The coordinator checks repository/GitHub pause state before issuing the lease. Missing initial allocation telemetry prevents database creation.

Normal cleanup stops the client, allows PostgreSQL five seconds to stop, and stops the budget collector. Emergency cleanup kills only owned container IDs. Containers, the new data directory, network, raw evidence, and hashes are retained for review. No recursive deletion is needed. The final record must verify no owned process remains and that prior cluster states match. A failure never launches another case.

## Ready command for the coordinator

After `ready.json` exists and the coordinator grants start and expiry UTC timestamps, run this exact command on the server, substituting only those three lease values:

```sh
timeout --signal=TERM --kill-after=15s 885s python3 /ssd1/bim-forge-qualification/house-161/issue162-reduced-profile-prep-20261026a/control.py run --lease-id LEASE_ID --starts-at START_UTC --expires-at EXPIRY_UTC
```

For example, timestamps have the form `2026-10-26T08:00:00Z`. This is not a granted lease or a scheduled start. The launcher rejects a future start, expired lease, non-UTC timestamp, overlong lease, insufficient remaining time, changed prepared input, existing run root, or existing resource name. It never waits for permission internally.

Expected scheduling cost is one slot of at most 15 minutes, including setup, one job, inspection, and cleanup. Current preparation is not evidence that live auto_explain capture or watchdog termination works; those are checked during the leased diagnostic, with any failure reported as a gap.
