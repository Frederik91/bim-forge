# Disposable PostgreSQL qualification candidate

W5 / [#128](https://github.com/Frederik91/bim-forge/issues/128). API: [CONTRACT.md](CONTRACT.md). No production adapter, deployment or migration. No experimental pass is asserted by this source delivery. W0 supplies the authoritative observation schema and result writer; this runner emits observations and raw files only. Main must bind, verify and publish terminal records using W0 and report uncovered assertions honestly.

## Source and model

`schema.sql` stores each complete typed source document in one JSONB version row. `versions` deduplicates canonical envelope SHA-256; `changes` stores deltas/tombstones; immutable `revisions.payload` retains the command and semantic assumptions; `receipts` retain idempotent acceptance outcomes. `visibility` indexes the current state per branch. `historical` resolves nearest changes along single-parent ancestry. No property EAV expansion or full membership copy per revision. A branch fork does copy its current visibility.

`accept` locks a branch, verifies exact head and every declared object hash/absence, persists versions and delta, verifies references, then atomically publishes the head/receipt. Every changed ID requires an assumption. All writes roll back on failure. This is conservative storage publication, not engineering validation or permission approval. Failed staged imports can retain unreferenced immutable versions; no branch is published. There is no unattended cleanup.

Canonicalization sorts object keys, preserves arrays and explicit JSON null/state/unit fields, and hashes the entire envelope including its indexes. Bigint IDs from W4 remain lossless decimal strings in the source document and use `entity:`, `relationship:` and `parameter:` namespaces with 19-digit zero-padded IDs. Parameters are independently versioned records with owner/dependency references. W4 is synthetic metadata; no engine is simulated.

## Inputs

- `load <file.ndjson> <new-branch>` reads bounded envelopes.
- `load-fixture <tiny-building.json> <new-branch>` validates W0's actual fixture, including endpoints and kind restrictions, and preserves every field.
- `load-native <snapshot.json> <new-branch>` calls the existing product `validateSnapshot`. Existing limits remain: 100 entities, 100 relationships, and the saved-project 256 KiB bound.
- `load-w4 <admission.json> <new-branch>` decodes W4 headerless COPY-text TSV incrementally. It verifies file hashes before ingestion and row counts before publication.
- `load-w4-generator <admission.json> <new-branch>` spawns W4 sequential table producers and streams stdout through a hashing Transform and batched ingestion. It checks every exit code, exact-byte hash and row count. No table is buffered as a complete document or input file. The generator CLI/profile and the authoritative W4 manifest must already be present in the coordinator's combined checkout.

The direct-stream admission format is in [w4-generator-admission.example.json](../../benchmarks/hospital/workloads/w4-generator-admission.example.json). Copy the exact hashes/counts from the W4 manifest; placeholders deliberately fail schema validation. The file transport uses the same shape without `generator`, adding `file` to each table descriptor. `sourceManifest.file` is hashed for provenance. W5 does not reinterpret or claim coverage of W4's full manifest/query oracle schema. All paths in admission files resolve relative to that file. Runtime bounds: 4 MiB per source row, ingestion batches of at most 250 records or approximately 4 MiB (one bounded row can cross the threshold), at most 2,000 puts and 2,000 deletes / 8 MiB per acceptance command. Large imports stage immutable versions in batches, then perform one publication transaction. Full initial visibility still needs one large transaction and WAL capacity.

## Coordinator-only server checks

Do not run these locally. Do not start a database. Main already owns isolated `bim-qvm-db`, network `bim-qvm-20261025`, database/user `qvm`. Use a real Git clone made from the supplied source bundle on `/ssd1/bim-forge-qualification/qvm-20261025`, checked out at the source commit. Never mount the parent agent's working tree.

After main allocates a correctness slot, set these **host** paths to fresh W5 directories; run the container command on `frederik@192.168.1.17`:

```bash
set -euo pipefail
QVM_SOURCE=/ssd1/bim-forge-qualification/qvm-20261025/w5/source
QVM_DEPS=/ssd1/bim-forge-qualification/qvm-20261025/w5/deps
QVM_EVIDENCE=/ssd1/bim-forge-qualification/qvm-20261025/w5/checks-RUN_ID
QVM_EXECUTION_LEASE=MAIN_ASSIGNED_CORRECTNESS_LEASE
mkdir -p "$QVM_DEPS" "$QVM_EVIDENCE"
docker inspect bim-qvm-db > "$QVM_EVIDENCE/postgres-container.json"
docker image inspect pgvector/pgvector:0.8.0-pg15-trixie > "$QVM_EVIDENCE/postgres-image.json"
docker run --rm --name bim-qvm-w5-checks --network bim-qvm-20261025 \
  --cpus=1 --memory=1g \
  -e DATABASE_URL=postgresql://qvm@bim-qvm-db/qvm \
  -e QVM_EXECUTION_LEASE="$QVM_EXECUTION_LEASE" \
  -v "$QVM_SOURCE:/work" -v "$QVM_DEPS:/deps" -v "$QVM_EVIDENCE:/evidence" \
  -w /work sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff \
  bash experiments/storage/server-check.sh
```

The script installs only experimental dependencies outside the source checkout, records its resolved lock/tree, links module resolution, then runs `npm run validate`, strict experimental typecheck, seven real PostgreSQL/wire behavior tests and captures database metrics. Direct package versions are pinned. The first server-resolved lock file is an evidence artifact; transitive dependencies are not yet source-locked. W0's lint skips installed dependency sources. No local check success or server success is claimed.

Once that passes, use the same container/mount/network/environment for these individual commands (each with a coordinator slot):

```bash
node experiments/storage/cli.ts init
node experiments/storage/cli.ts load-fixture experiments/fixtures/tiny-building.json w5-tiny-RUN_ID
node experiments/storage/cli.ts fingerprint w5-tiny-RUN_ID
node experiments/storage/cli.ts property-counts w5-tiny-RUN_ID
node experiments/storage/cli.ts load-w4-generator /evidence/w4-admission.json w5-smoke-RUN_ID
node experiments/storage/cli.ts workload /evidence/workload-config.json /evidence/new-workload-RUN_ID
```

The workload output directory must not exist; its parent must exist. The database must be initialized; workload branches must be new. `QVM_EXECUTION_LEASE` records main's authorization, not a distributed lease implementation. Main enforces scheduling; a string alone cannot establish resource exclusivity. No heavy jobs have been prepared as an automatic continuation.

For the predeclared 2026-10-25 envelope, workload configuration now **requires** `execution`, binding the coordinator's decision file and SHA-256. Use the updated example. Mount the shared `/ssd1` qualification directory at `execution.space.dataPath` and the host root filesystem read-only at `execution.space.hostRootPath` (for example `-v /:/host-root:ro`). The runner checks the 100 GiB data / 4 GiB root reserves before load batches and measured operations. Node plus generator share a container capped at 1 CPU / 1 GiB; PostgreSQL remains 1.5 CPU / 3 GiB. The shared 200 GiB data/WAL/tmp/artifact allocation is enforced by main's watchdog, named in `monitorEvidence`; free-space checks cannot account for each stream's directory consumption. The supplied debug-test lease is a separate correctness allocation, not the benchmark envelope.

Full execution is staged: first `execution.mode={"kind":"load-only"}`, `purpose="initial-inventory"`, `historyRevisions=1`; later use `mode={"kind":"measure-existing","loadRecord":".../load.json"}`, `purpose="bounded-updates"`, and a predeclared `maxBoundedUpdates` on the same branch. The branch must still match the saved initial revision. An existing-branch measurement verifies source fingerprints/property counts again. A 1,000-revision run uses `purpose="smaller-fixture-history"` at a smaller scale. No full Cartesian inventory/history claim is supported. Bare loader/API calls remain low-level integration operations; use the workload configuration and main's watchdog for admitted full runs.

`loadWallTimeLimitMs` cannot exceed 7,200,000 ms. Batch/publication checkpoints reject an expired load deadline and cap SQL statement timeouts by the remaining time. Main must enforce the hard two-hour limit externally as well, for example `timeout --signal=TERM --kill-after=30s 2h docker run ...`. Cooperative checks cannot interrupt a stalled producer immediately. Failure during statistics/finalization can leave a complete published initial revision; inspect the recorded branch head before any recovery. Do not label that failure a completed run.

The runner writes `exploratory-budgets.json` and observations against predeclared warm single-client p95 limits: detail 300 ms, page/one-hop 1,000 ms, bounded delta 2,000 ms, small acceptance 4,000 ms. Detail and one-hop have separate samples; bounded-delta timing is separate from acceptance. Missing samples, errors and budget breaches cannot pass. Non-exploratory scenarios retain budgets as unqualified. These thresholds are exploratory, not product SLOs. Five alternating repetitions and an exclusive slot are required for comparative configurations only. No winner is emitted without limiter/tuning evidence.

## Measurement and supported conclusions

[Workload configuration](../../benchmarks/hospital/workloads/README.md) declares exact resource envelope, disk budget, scale and cache label. The runner explicitly warms queries and never flushes host caches. Full/detail-stress requires an exclusive measurement lease. It refuses an existing output directory and uses exclusive file creation, preserving failures. Raw samples are append-only during a run, checksummed and made read-only at completion; filesystem permissions are not a tamper-proof archive. Main must retain every raw artifact on durable storage.

Source and database use independent canonical-document sum/XOR/count fingerprints plus counts by kind. This constant-memory multiset checksum is probabilistic, not a proof. SQL separately counts logical properties with `jsonb_object_keys` / array lengths and compares loader counts before timing. `load.json` records phase times, bytes and a log2 record-size histogram (quantile upper bounds, not exact percentiles). Indexes/FKs exist throughout ingestion; ingest time includes their maintenance. Reference scans are part of publication.

Operations include full open/materialization checksum, bounded page, initial-revision reconstruction, bounded directed graph traversal, indexed type fanout lookup, bounded metadata acceptance, immutable history, revision aging and concurrent closed-loop reads/writes with visible CAS outcomes. At least five repeats are required. A native product snapshot enables alternating PostgreSQL full-snapshot-reference/candidate open measurements within existing bounds, plus full snapshots retained during history aging. This reference is product-validated, but it is **not the existing runtime persistence adapter**. Samples do not justify a generalized speedup. Comparisons against hospital data remain explicitly unsupported. Existing `validateSnapshot` and `diffSnapshots` are used by integration tests; limits are not raised.

Artifacts include configuration/source/input bindings, OS/node/cgroup/process settings, raw timings/errors/checksums, percentiles with sample counts, achieved closed-loop attempt rate, startup/ready/aged/final PG statistics, exact row counts, heap/index/TOAST/total bytes and cluster WAL generated/retained. PG/WAL metrics can include parallel correctness activity. `metrics-aged.json` separates history growth before contention. Main must additionally retain Docker inspect data for CPU/RAM, bind mounts, PostgreSQL process settings and image IDs. Capacity and timeout failures remain failures. Raw errors are authoritative; sample summaries exclude failed latency samples, whose rows remain available.

Unsupported: geometry/IFC fidelity, engineering authority, approval equivalence, read predicates, checkpoint acceleration, multi-parent merging, source pin/artifact completeness, role security, production deployment, 64-client traffic, independently swept branch/churn matrices, real shared-type regeneration and paced offered-load/latency budgets. Full 6,777,445-entity admission is not established by this implementation; relationships/parameters add millions more records. Initial publication, per-acceptance full-branch reference scans and history reconstruction can exceed this host's envelope. The runner emits an explicitly unqualified capacity observation even if executed SQL operations succeed. W0 must not mark EX-10/13 passed on partial coverage.

## Backup/restore handoff to W6

Main/W6 own execution and admission. Measure backup/restore against a newly named database, retain timings, and compare `fingerprint` on the same branch before/after. Do not replace `qvm` or touch other services. Example **server host** commands, only after a main-issued recovery slot:

```bash
set -euo pipefail
QVM_RESTORE_DB=qvm_w5_restore_RUN_ID
case "$QVM_RESTORE_DB" in qvm_w5_restore_*) ;; *) exit 1 ;; esac
/usr/bin/time -v -o "$QVM_EVIDENCE/backup-time.txt" \
  docker exec bim-qvm-db pg_dump -U qvm -d qvm -Fc > "$QVM_EVIDENCE/database.dump"
sha256sum "$QVM_EVIDENCE/database.dump" > "$QVM_EVIDENCE/database.dump.sha256"
docker exec bim-qvm-db createdb -U qvm "$QVM_RESTORE_DB"
/usr/bin/time -v -o "$QVM_EVIDENCE/restore-time.txt" \
  docker exec -i bim-qvm-db pg_restore -U qvm -d "$QVM_RESTORE_DB" --exit-on-error --single-transaction \
  < "$QVM_EVIDENCE/database.dump"
```

Use the prepared Node container with `DATABASE_URL=postgresql://qvm@bim-qvm-db/$QVM_RESTORE_DB` to run `fingerprint <original-branch>` and retry the exact preserved `accept` command; compare against the source database. Dump includes all schema tables/receipts and candidate version documents. It does not back up external artifact bytes. No backup/restore measurement has run in W5; W6 supplies recovery evidence. An unverified dump is not a successful restore.
