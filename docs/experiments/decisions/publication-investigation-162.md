# Initial publication investigation, issue #162

ISSUES. Static SQL review and retained telemetry identify constraint, index, and working-set risks worth separating in a bounded diagnostic. They do not establish an overall limiter, a speedup, or full admission. Live query plans and comparisons remain pending the coordinator's exclusive measurement lease. No live database experiment was executed.

This is the investigation child of [#161](https://github.com/Frederik91/bim-forge/issues/161), scoped by [#162](https://github.com/Frederik91/bim-forge/issues/162). The only repository changes are this report and [the offline evidence reader](publication-investigation-162.py). The model delta is empty. Product implementation, shared registries, packages, validators, and trial sources are unchanged.

## Source and evidence identity

| Role | Exact identity |
| --- | --- |
| Investigation branch base and evidence review | `2e65ae825eb9542de02b54f197eede4de0906a56` |
| Measured trial source | `3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098` |
| Trial's own recorded decision commit | `093b6b76bf0854604eebc2c6b531d7bc281cd3a3` |
| Full manifest SHA-256 | `efd1ef057d1f4513b0b89cf380c1fcd6cf0bdc31bd468ce466d3302734484737` |
| Trial | `r3-hospital-full-20261025a` |
| Host and retained root | `frederik@192.168.1.17:/ssd1/bim-forge-qualification/qvm-20261025/round3` |
| Worker artifacts | `/ssd1/bim-forge-qualification/house-161/issue162-publication-investigation-20261026a` |

The measured source is distinct from the evidence review base. Its storage files are absent from the base's working tree. Review used `git show 3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098:<path>`, without restoring or editing those files. Source links below pin that SHA.

The report's raw inputs are relative to the retained root:

- `artifacts/r3-hospital-full-20261025a/`: `source-commit.txt`, `decision-commit.txt`, `config.json`, `source-manifest.json`, `execution-facts.json`, `coordinator-full-facts.json`, `exact-state.json`, `metrics-before.json`, `metrics-after.json`, `postgres-cgroup-before.json`, `postgres-cgroup-after.json`, `progress.ndjson`, `resources.ndjson`, and job timestamps.
- `artifacts/monitor-stop-diagnostic-20261026a/`: both `publication-observation-*.json` files, `diagnostic.json`, the original monitor, its output, and its last budget sample.
- `cgroup-resources.ndjson`, `cgroups.py`, `trial.py`, and `cleanup-report.json`.

BatchMode SSH read files. `docker inspect` confirmed `bim-qvm-r3-db` was exited and `bim-qvm-db` was running during this investigation. Neither cluster was started, stopped, queried, or mutated. Preview was untouched. The offline reader ran in the pinned tools image with no network and both inputs mounted read-only. Its JSON output records SHA-256 and byte counts for every file it consumes, verifies the diagnostic's retained hashes, and rejects source, query, database-identity, or statistics-reset mismatches.

## Publication work in the measured source

[load.ts](https://github.com/Frederik91/bim-forge/blob/3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098/experiments/storage/load.ts#L66) and [store.ts](https://github.com/Frederik91/bim-forge/blob/3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098/experiments/storage/store.ts#L129) perform this sequence:

```text
CREATE TEMP w5_load_stage(entity_id PRIMARY KEY, version_id NOT NULL)
stage batches: durable immutable versions + session-local staging identities
ANALYZE stage; ANALYZE versions
BEGIN
  insert branch with NULL head; insert initial revision
  INSERT changes SELECT revision,entity_id,version_id FROM stage
  INSERT visibility SELECT branch,version fields FROM stage JOIN versions
  ANALYZE visibility
  validate full branch references
  check deadline/reserves; update branch head; insert receipt
COMMIT
ANALYZE changes
```

Batch staging commits before publication. `Storage.transaction` rolls back the complete publication transaction on error. Staged immutable versions can survive a later publication failure without an accepted revision. The temporary table belongs to the loader session and is dropped in `finally` or at session end. A later connection cannot inspect that vanished staging table.

`phasesMs.publication` starts before both prepublication `ANALYZE` statements and ends after commit. It includes changes, visibility, reference validation, and the in-transaction checkpoint callback. It is not a timer for the sampled insert alone. `phasesMs.analyze` covers the subsequent changes analyze and callback. The full trial produced no completed `load.json` phase record. End-to-end execution also includes setup and readback. This timing boundary follows [workload.ts](https://github.com/Frederik91/bim-forge/blob/3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098/experiments/storage/workload.ts).

The [exact schema](https://github.com/Frederik91/bim-forge/blob/3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098/experiments/storage/schema.sql) defines these costs:

| Statement | Index work | Constraint work |
| --- | --- | --- |
| Stage versions | Hash-text `versions` primary key and stage entity primary key | Version checks, JSON identity/kind checks, duplicate entity rejection. `ON CONFLICT(version_id)` preserves deduplication. |
| Insert changes | Primary key `(revision_id,entity_id)` and `changes_entity_history(entity_id,revision_id)` | Non-null identity fields, immediate FK to one revision, and immediate FK to the version for each initial non-null version ID. |
| Insert visibility | Primary key `(branch,entity_id)`, kind index, and five partial indexes for populated type/container/system/from/to fields | FK to branch and FK to version. Partial indexes skip null fields. |
| Full reference validator | Reads visibility and matches references within the branch | Checks type, container, system, and relationship endpoints before advancing the head. |

The immutability triggers reject updates and deletes. They are not the insert triggers behind FK checks. PostgreSQL creates primary-key indexes automatically. Adding another index to `changes.version_id` would not remove the child-insert lookup into the existing `versions` primary key. Such an index would add write work. [PostgreSQL 15 CREATE TABLE](https://www.postgresql.org/docs/15/sql-createtable.html) documents these index and constraint rules.

The sampled changes SQL has no join, sort, filter, or reference-validation CTE. The input is a full stage scan; the actual scan plan was not retained. FK checks use internal SQL beyond the visible insert plan. PostgreSQL 15.14's [referential-integrity implementation](https://github.com/postgres/postgres/blob/REL_15_14/src/backend/utils/adt/ri_triggers.c#L337) constructs parent existence checks with `FOR KEY SHARE`. This requires parent tuple access as well as finding the key. A large parent index alone does not describe the complete FK working set. The revision key repeats across rows and may stay hot. The content-derived version keys have a different access pattern.

## Proven observations and their limits

The two original query observations are:

| UTC observation | Query age | Exact statement | Wait |
| --- | --- | --- | --- |
| 2026-10-25 22:31:24.392199 | `00:38:54.713466` | `INSERT INTO qvm_storage.changes SELECT $1,entity_id,version_id FROM w5_load_stage` | `IO / DataFileRead` |
| 2026-10-25 23:48:13.019476 | `01:55:43.340743` | Same statement and application | `IO / DataFileRead` |

Both timestamp-minus-age calculations give 21:52:29.678733 UTC. This is consistent with the same long-running statement at both points. These files have no backend PID/start identity or continuous query trace. They do not establish uninterrupted waiting, the relation being read, trigger versus index cost, or the fraction of total runtime spent here. PostgreSQL defines [DataFileRead](https://www.postgresql.org/docs/15/monitoring-stats.html) as a wait for a relation-file read. It is not a disk-throughput saturation measurement.

The reader also examines periodic activity observations from `progress.ndjson`. Those observations record application and wait, but omit query text. Counts of those observations cannot be converted to exact durations or assigned wholesale to publication.

The following are arithmetic differences of retained counters from this one failed trial. They are not new benchmark runs or comparative performance claims:

| Scope | Retained counter difference |
| --- | --- |
| Whole-job PostgreSQL cgroup snapshots, including cleanup | `8:16`: 334,487,883,776 read bytes and 453,829,401,600 write bytes |
| Same cgroup snapshots | 75,726,942 file working-set refaults; 136,016,192 direct page scans; `memory.events.max` +862,186; no OOM or OOM-kill increment |
| Same cgroup snapshots | 4,497.831923 CPU seconds; 1.688644 throttled seconds |
| Cgroup samples inside the two query observations, 22:31:28.934230 to 23:48:04.114387 UTC | 302 samples; `8:16` +144,014,282,752 read bytes; +32,221,763 file refaults; +40,635,560 direct page scans; no CPU-throttle or OOM increment |
| Client `docker stats` observations between the two query observations | 459 CPU samples, each displayed as `0.00%` |
| Target-database before/after snapshots, including observer sessions | +66,909,313 block reads; +7,318,351,971 temporary bytes across 1,024 temporary files; +8,877,757.188 ms cumulative read time |

The container limit was 3,221,225,472 bytes, shared buffers 256 MiB, and `work_mem` 8 MiB. The cgroup readings around both query observations were close to the memory limit. Refaults, reclaim, and limit events support investigating cache pressure. Zero sampled client CPU is consistent with the client awaiting database work; rounded `docker stats` is not a process profiler. The PG cgroup includes backends, checkpointer, WAL writer, and observer work. It does not isolate one process or SQL statement.

The periodic cgroup file contains 961 samples inside the job bounds with a largest observed gap of 15.382742 seconds. Its collector reads cgroup files sequentially, so a row is not an atomic snapshot. Whole-job snapshots also bracket ingestion, publication, termination, and observer work. The IO counters report device accounting, not device bandwidth limits. Device-mapper and underlying-device counters must not be summed as independent physical IO. PostgreSQL block reads may be satisfied by the OS cache. Cumulative read times can overlap across processes. Neither those times nor physical-byte counters give a publication-only wait fraction.

Post-stop inspection found exactly 27,020,089 versions and zero logical rows in revisions, changes, visibility, and receipts, with no branch heads. The allocated versions primary-key index occupied 3,364,020,224 bytes. That exceeds the entire PG cgroup limit, before heap pages, buffers, and other processes. It identifies a working-set risk, not a requirement that every index page be resident or a proof that more RAM alone fixes admission.

Changes and visibility still had allocated physical space despite zero logical rows. Allocation can survive rollback. Source order makes the visibility allocation consistent with progress beyond changes before termination, but the retained trace does not timestamp that transition. It does not show a committed publication or completed reference validation.

The monitor stopped on a disappearing `base/pgsql_tmp/pgsql_tmp22922.929` during `du`. The independent guard stopped the client; the retained exit code is 143. There was no successful admission or runner terminal result. This was monitoring failure, not a capacity threshold breach, six-hour timeout, or proof that the query itself failed. [The existing full review](full-hospital-round3-review-20261026.md) retains that outcome.

## Planner and working-set risks still open

1. The versions FK can revisit a parent index and heap larger than cache while changes maintains its own two indexes. Content-hash ordering, generated entity order, and heap order differ. Retained IO cannot assign reads among those relations. Sorting by version ID might improve parent-index locality while worsening parent-heap and changes-index locality. Its sort can spill. No net improvement is asserted.
2. The subsequent stage-to-versions visibility join may choose hash, merge, or nested-loop access. The prepublication stage and versions analyze calls already exist. A proposed fix based on their complete absence would contradict the source. Temporary tables need session-local analyze because autovacuum cannot analyze them. [PostgreSQL temporary-table behavior](https://www.postgresql.org/docs/15/sql-createtable.html) explains that restriction.
3. Hash batching, sort spill, estimates, and FK work need an actual plan at a controlled size. `work_mem` applies per operation; hash operations also depend on `hash_mem_multiplier`, which the retained fixed settings do not record. A memory limit does not force a predictable plan. [PostgreSQL memory settings](https://www.postgresql.org/docs/15/runtime-config-resource.html) define these controls.
4. Visibility writes maintain all applicable indexes before full reference validation. A bottleneck found in changes would leave this later work intact.
5. [fullReferencesSql](https://github.com/Frederik91/bim-forge/blob/3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098/experiments/storage/reference-validation.ts#L7) expands up to five references per visible row and checks an anti-existence predicate. `WITH missing AS MATERIALIZED` separates planning of the validity check from its diagnostic `LIMIT 1`; it does not itself prove eager evaluation of every row when an early witness exists. A valid branch needs the complete no-missing-reference result. Plan shape, estimates, hash batches, and temporary IO are unmeasured here.
6. Default nondeferrable FK triggers and index insertion can dominate work absent from a plain scan plan. `EXPLAIN ANALYZE` reports trigger timings separately, but its instrumentation adds overhead. Its insert-node timing alone excludes AFTER-trigger time. Deferred-trigger work has a different timing boundary. [PostgreSQL EXPLAIN guidance](https://www.postgresql.org/docs/15/using-explain.html) documents these limits. No constraint deferral or removal is proposed.

## Bounded next comparison, pending a lease

This is a concrete proposed contract for the coordinator. No part authorizes accessing either existing cluster. The first useful question is whether a reduced publication spends material time in FK triggers, target insertion, or later visibility/reference work. Only then is a locality comparison worth running. Reduced results cannot resolve the full working set.

| Resource | Exact proposal |
| --- | --- |
| New artifact root | `/ssd1/bim-forge-qualification/house-161/issue162-publication-diagnostic-LEASEID`; replace `LEASEID` with the coordinator-issued unique lease ID before execution |
| New objects | `bim-issue162-pg-LEASEID`, `bim-issue162-net-LEASEID`, and a PG data directory inside that new root; names and resolved paths recorded before creation |
| PostgreSQL | The retained PG image `sha256:1493afd6cc99c05d611913cd5731aa0a081aefd9ff0b805552e66dc150b17ccc`; verify server 15.14; 1.5 CPU, 3 GiB, memory-swap equal to memory, no published ports |
| Client and generator | `bim-qvm-tools:20261025`, verified image `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`; combined 1 CPU, 1 GiB, no swap |
| Source | A new immutable copy of measured SHA `3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098`; interception code and its hash retained separately; no edits to trial sources |
| Data | Exact retained `round3/manifests/reduced.json`, SHA-256 `6214eed2616670c697fa0a90b7a3c3257c116faaeca0591b32cab58c5a4aa3ca`, 270,205 records, seed `bim-forge-hospital-200k-v1`, and its pinned generator/profile; verify every table hash/count before use; no partial full-stage reuse |
| Fixed settings | fsync, synchronous_commit, full_page_writes on; shared_buffers 256 MiB; work_mem 8 MiB; maintenance_work_mem 256 MiB; max_wal_size 8 GiB; one parallel worker per gather; track_io_timing and track_wal_io_timing on |
| Admission bounds | Additional allocated bytes at most 10 GiB; all retained qualification data still count toward 200 GiB aggregate; preserve 100 GiB SSD free, 4 GiB root free, and 1 GiB available host memory |
| Time bounds | 60 minutes total: up to 5 minutes setup, 8 minutes instrumented diagnostic, 40 minutes comparison, and 7 minutes evidence/cleanup. Each of ten comparison jobs has a four-minute wall cap including readback. No case is extended on timeout. |

The ordered work is:

1. Obtain the coordinator's exclusive measurement schedule, including endpoint ownership and an expiry. Record `uptime`, `nproc`, host memory, active processes, device identity, free space, and aggregate qualification allocation. Unrelated existing services remain active and are recorded. If the host or reserves cannot support this envelope, return BLOCKED before creation. Record old-cluster states without connecting to them.
2. Create only the new isolated resources. Fail if any name/path exists. Capture actual container limits, image hashes, PostgreSQL version, collation, settings including `hash_mem_multiplier`, DDL, constraint definitions, trigger flags, and index sizes. Install an independent observer/watchdog before starting work. It must stop owned work if telemetry is unavailable for 15 seconds, a budget fails, or the lease expires.
3. Run one instrumented reduced case in a fresh `qvm_w5_issue162_profile` database. Preserve the exact source's staging, publication transaction, validator, and commit sequence. Intercept the two insert statements on that same session with `EXPLAIN (ANALYZE, BUFFERS, WAL, VERBOSE, FORMAT JSON)`. These statements really execute. Run the full reference validator once under the same instrumentation, consuming and checking its witness result. Do not execute an insert twice. Retain trigger time/calls, actual rows, estimates, buffer counters, WAL, hash batches, sort method, and temporary IO. A plain `EXPLAIN` of a representative parent-key `SELECT ... FOR KEY SHARE` can document the internal lookup shape but cannot replace trigger timing.
4. Retain UTC phase timestamps for analyze, changes, visibility, full-reference validation, head/receipt, commit, and complete readback. Observe exact backend PID, backend_start, application, query text/age, and wait every second. Record cgroup CPU/memory/IO and per-process CPU every five seconds, plus relation/index IO and database/WAL/checkpoint deltas at phase boundaries. Record collection overhead. Preserve errors and successful work counts. This diagnostic is excluded from timing comparisons.
5. If instrumentation does not isolate a useful locality question, stop with its evidence. Otherwise run five alternating pairs, `A1 B1 A2 B2 A3 B3 A4 B4 A5 B5`, one fresh database per job. A executes exact measured SQL. B changes only the changes input to `SELECT $1,entity_id,version_id FROM w5_load_stage ORDER BY version_id`. Retain every FK, index, validator, and durability setting. Include B's sort in timing. Do not force planner methods. Capture actual input-order behavior in the profile rather than assuming an unspecified A scan order.
6. Keep instrumented results apart from uninstrumented comparison times. Both arms include staging, analyze, publication, commit, and complete body/hash/kind/property readback. Assert the exact expected fingerprint and logical row counts, branch head, receipt, and no missing references. Compare publication and whole-job medians/ranges only after all ten cases pass. A speedup requires a measured mechanism and an improvement larger than variation. Otherwise report inconclusive. A toy-size result cannot qualify full admission or justify a production schema change.
7. Save outputs, source/interception hashes, logs, container inspection, counters, and terminal errors before cleanup. Remove each completed new case database only after its complete oracle and evidence hashes are saved, keeping allocation bounded. On failure, stop the sequence immediately. At expiry cancel/terminate only the new recorded database/application/PID/backend_start identities, allow at most 15 seconds for client termination, and stop the new cluster. Verify no owned work survives. Resolve and check the new data path inside the declared root before removing it. Remove only the new cluster/network/data directory after evidence retention. Preserve raw evidence and verify old-cluster states again.

The instrumented case discriminates FK-trigger cost from main insert/index work and later join/validator work at reduced size. The A/B pairs test whether explicit version-key ordering changes reduced publication and end-to-end time while preserving behavior. They do not independently isolate heap versus index cache effects, change the RAM budget, or establish a full-size capacity limit. Any pressure-scale memory comparison needs a separate lease and declaration. A fourth full admission remains unauthorized.

## Rerun and acceptance evidence

The narrow diagnostic is the offline reader, not a live DB runner. It accepts only a retained root and emits JSON. The final container invocation uses a read-only root filesystem, `--network none`, 0.25 CPU, 1 GiB memory with no swap, the retained round3 mounted read-only at `/retained`, and this worker's script mounted read-only at `/worker/publication-investigation-162.py`. Its command is:

```sh
python3 /worker/publication-investigation-162.py /retained
```

Actual output is `house-161/issue162-publication-investigation-20261026a/telemetry-summary.json` under `/ssd1/bim-forge-qualification`. Its SHA-256 is `16d5fb3150cefe849ec652543ca94a30d95a367c7093af6112b233d50413002d`. It includes raw input hashes and explicit scope caveats. The original retained input files are unchanged. The script's `ISSUES` field reports the admission evidence status; a successful script exit verifies its arithmetic and identity checks, not admission success.

An initial offline execution and source-only validation used 0.5 CPU before the coordinator's workspace/resource correction. Their worker-owned outputs remain in the earlier `qvm-20261025/issue162-publication-investigation-20261026a` directory. Subsequent work uses `house-161` and 0.25 CPU. Historical evidence was never written. The initial validation container exited zero, but its outer SSH launcher exited nonzero because PowerShell appended a carriage return to the final shell `exit`. The final launcher records both statuses and checks the two actual changed paths explicitly.

The benchmark checklist was applied before reporting counters. The measurement/collector sources and error/completion evidence were read. There are no new timings to rank: one failed full trial, two exact SQL observations, and periodic counters. No profiler, source-equivalent repeated comparison, disk limit measurement, or publication-specific trigger trace exists in these inputs. Configuration and source identity are pinned; full correctness failed at publication. Overall-limiter and speedup verdicts remain inconclusive.

Root `npm run validate` passed in the server tools container at 0.25 CPU and 1 GiB, with no network. The final invocation appends `-- --changed-files docs/experiments/decisions/publication-investigation-162.md docs/experiments/decisions/publication-investigation-162.py` so the policy validator checks this exact scope. Strict source validation checked 114 TypeScript files, root typechecking passed, and policy validation accepted both changed files. The container and outer launcher exited zero. Raw evidence is `root-validate-final.log`, `root-validate-final-exit-code.txt`, and `root-validate-final-container.json` in the worker artifact directory. The final offline reader execution at the same resource cap produced byte-identical JSON to the first run. `git diff --cached --check` passed. No local build/test, DB experiment, merge, deployment, or issue closure is part of this change. The only outstanding contract decision is whether the coordinator wants to lease the optional live diagnostic.
