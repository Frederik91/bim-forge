# Initial publication investigation, issue #162

ISSUES overall. One authorized instrumented reduced diagnostic completed at 270,205 records with client exit zero, original readback/property oracles passing, and all three plans captured. Controller log collection then failed after ownership cleanup, leaving no native terminal/done record. The watchdog subsequently reported stale budget telemetry because the collector had already been stopped. This is profile-work PASS and harness-finalization ISSUES, not a clean benchmark pass.

The [actual reduced-case review](publication-profile-review-20261026c.md) separates that outcome from the historical failed full admission and the earlier offline analysis. Main independently verified stopped owned resources and unchanged protected clusters and released the lease at 06:04:20 UTC. No further database case, comparison, full admission, or performance claim is authorized. Overall full-run limiter, speedup, and full capacity remain inconclusive.

Issue [#162](https://github.com/Frederik91/bim-forge/issues/162), parent [#161](https://github.com/Frederik91/bim-forge/issues/161). Repository changes are investigation documents, selected raw plans/facts, and read-only evidence readers. Model delta is empty. Product sources, registries, packages, production schema, validators, durability controls, and preview 9443 are unchanged.

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

The historical offline inputs are relative to the retained round3 root:

- `artifacts/r3-hospital-full-20261025a/`: `source-commit.txt`, `decision-commit.txt`, `config.json`, `source-manifest.json`, `execution-facts.json`, `coordinator-full-facts.json`, `exact-state.json`, `metrics-before.json`, `metrics-after.json`, `postgres-cgroup-before.json`, `postgres-cgroup-after.json`, `progress.ndjson`, `resources.ndjson`, and job timestamps.
- `artifacts/monitor-stop-diagnostic-20261026a/`: both `publication-observation-*.json` files, `diagnostic.json`, the original monitor, its output, and its last budget sample.
- `cgroup-resources.ndjson`, `cgroups.py`, `trial.py`, and `cleanup-report.json`.

During the initial offline investigation, BatchMode SSH read files. `docker inspect` confirmed `bim-qvm-r3-db` was exited and `bim-qvm-db` was running during this investigation. Neither cluster was started, stopped, queried, or mutated. Preview was untouched. The offline reader ran in the pinned tools image with no network and both inputs mounted read-only. Its JSON output records SHA-256 and byte counts for every file it consumes, verifies the diagnostic's retained hashes, and rejects source, query, database-identity, or statistics-reset mismatches.

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

## Historical full-trial observations and their limits

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

## Historical hypotheses and remaining full-scale gaps

1. The versions FK can revisit a parent index and heap larger than cache while changes maintains its own two indexes. Content-hash ordering, generated entity order, and heap order differ. Retained IO cannot assign reads among those relations. Sorting by version ID might improve parent-index locality while worsening parent-heap and changes-index locality. Its sort can spill. No net improvement is asserted.
2. The historical full trial retained no stage-to-versions visibility plan. Hash, merge, and nested-loop access were candidate risks; the later reduced profile captured a spilling hash join. The prepublication stage and versions analyze calls already exist. A proposed fix based on their complete absence would contradict the source. Temporary tables need session-local analyze because autovacuum cannot analyze them. [PostgreSQL temporary-table behavior](https://www.postgresql.org/docs/15/sql-createtable.html) explains that restriction.
3. The reduced profile now provides actual hash-batch, estimate, and FK observations at one controlled size. Full-size plan and working-set behavior remain unmeasured. `work_mem` applies per operation; hash operations also depend on `hash_mem_multiplier`, which the retained fixed settings do not record. A memory limit does not force a predictable plan. [PostgreSQL memory settings](https://www.postgresql.org/docs/15/runtime-config-resource.html) define these controls.
4. Visibility writes maintain all applicable indexes before full reference validation. A bottleneck found in changes would leave this later work intact.
5. [fullReferencesSql](https://github.com/Frederik91/bim-forge/blob/3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098/experiments/storage/reference-validation.ts#L7) expands up to five references per visible row and checks an anti-existence predicate. `WITH missing AS MATERIALIZED` separates planning of the validity check from its diagnostic `LIMIT 1`; it does not itself prove eager evaluation of every row when an early witness exists. A valid branch needs the complete no-missing-reference result. The historical full trial retained no reference-validator plan; the reduced profile below documents its separate plan and temporary-IO counters.
6. Default nondeferrable FK triggers and index insertion can dominate work absent from a plain scan plan. `EXPLAIN ANALYZE` reports trigger timings separately, but its instrumentation adds overhead. Its insert-node timing alone excludes AFTER-trigger time. Deferred-trigger work has a different timing boundary. [PostgreSQL EXPLAIN guidance](https://www.postgresql.org/docs/15/using-explain.html) documents these limits. No constraint deferral or removal is proposed.

## Actual authorized reduced diagnostic

Exactly one dataset case ran under lease `house161-profile-20261026c`, 05:58:30 through 06:13:30 UTC. Its declared job cap was 480 seconds and the external cap 885 seconds. It used new private resources only, with PostgreSQL 1.5 CPU/3 GiB and tools client/generator 1 CPU/1 GiB, no swap, unchanged synchronous durability and validators. The reduced manifest was `6214eed2616670c697fa0a90b7a3c3257c116faaeca0591b32cab58c5a4aa3ca`; measured source remained `3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098`.

Session-local auto_explain captured each changes insert, visibility insert, and original full-reference query as it actually executed once. Phase hooks were additional source-bound modules; original source modules were retained. The original validator consumed its normal result. This was an instrumented diagnostic, with no A/B arm or repeated comparison. The earlier multi-case proposal was superseded and was never authorized for execution.

At reduced size, changes used a staging sequential scan. Visibility used a hash join with eight batches and temporary IO. Each of the four FK constraints fired 270,205 times. The reference anti-join returned zero witnesses. These plans show material FK and main-insert costs at this size. They do not assign the historical full-run DataFileRead waits or identify an overall full-size limiter. Node times include their children, AFTER-trigger times are separate, and phase boundaries include collection overhead. The linked review gives exact values and raw plans.

Native `profile-result.json` reports PASS and `run/errors.json` is empty. Exact counts are 270,205 versions, changes, and visible rows, with one revision and receipt. Full source/readback and property-count comparisons passed. The client exited zero at 06:00:22.150488 UTC. No restart/recovery durability experiment was performed.

The original controller stopped the owned client, PG, and budget containers before collecting logs. Its host-side attempt to overwrite the root-owned `client.stdout.log` raised PermissionError. It therefore never wrote `terminal.json` or `controller-done.json`. The stale-budget watchdog event at 06:00:37 followed that finalization failure and collector shutdown. All 47 in-run budget samples show no breach. The native missing-terminal gap remains preserved; `recovered-terminal.json` is explicitly a post hoc observation, never a replacement controller terminal.

## Guard preparations and preflight are separate evidence

| Preparation | Commit | Actual outcome |
| --- | --- | --- |
| Initial preparation | `bb73761d5ccacde7d7a78aa851ace8b1fce5f341` | Static review rejected partial ENOENT accounting. No dataset execution. |
| Complete-only guard, prep-b | `a2a5ae9dcdea41bbc33607ac1319c229b6006cf4` | Fresh complete scans with at most three eight-second attempts; malformed/failed accounting fails closed. Its one launcher invocation failed on Docker capitalization before creating a run directory or DB. |
| Verified absence handling, prep-c | `de4762f48d33365ea499e229dfb71c00031711fe` | Sealed source actually used for the single reduced case. Ready seal `dc4ba4a156edf1a79ff3b306665f7ccc67ee1a00275b9fd7805aa785996e9080`. |
| Future finalization fix | `73b096a08cdc76844ec969678c905454cc0e8f60` | Separate host log names, per-capture errors, terminal preservation, and verified-cleanup watchdog acknowledgement. Root/strict checks and 19 safety tests passed without DB use. Unsealed and not executed against a dataset. |

Preparation files, the failed preflight record, the actual run, and recovery evidence remain separate directories under `/ssd1/bim-forge-qualification/house-161`. No original seal, retained trial, raw plan, or source oracle was changed to make a verdict pass. The finalization fix is separately pinned source, not part of the measured harness.

## Rerun means offline analysis only

[publication-investigation-162.py](publication-investigation-162.py) still reads the historical round3 evidence only. Its original output remains at `house-161/issue162-publication-investigation-20261026a/telemetry-summary.json`, SHA-256 `16d5fb3150cefe849ec652543ca94a30d95a367c7093af6112b233d50413002d`. The first offline execution used 0.5 CPU before the resource correction; the final replay used .25 CPU/1 GiB, network disabled, and produced byte-identical JSON. Neither invocation was a database experiment.

[publication-profile-162.py](publication-profile-162.py) verifies the separate post hoc collection hashes, source/lease identity, canonical fingerprint, original oracles, per-row FK calls, schema enablement, and stopped ownership state. It summarizes retained files without Docker, database, or subprocess access:

```sh
python3 publication-profile-162.py /ssd1/bim-forge-qualification/house-161/issue162-profile-review-20261026c
```

Actual raw run: `house-161/issue162-reduced-profile-20261026a`. Post hoc recovery and deterministic summary: `house-161/issue162-profile-review-20261026c`. Future-fix checks: `house-161/issue162-finalization-check-20261026c/checks.log`. Selected raw plans and source-bound facts are [retained in this PR](publication-profile-20261026c/facts.json).

The benchmark checklist supports only within-case phase findings here. One instrumented case cannot establish repeatability, a comparative improvement, a disk saturation limit, an overall full-run limiter, or full capacity. Profile instrumentation and observer work add overhead. The historical full admission remains failed and overall qualification remains incomplete.

Root validation for this final report passed in the server tools image at .25 CPU/1 GiB, network disabled: 114 strict source files, root typecheck, and all eight changed-file policy paths. The offline profile reader replay produced byte-identical facts. Raw log is `/ssd1/bim-forge-qualification/house-161/issue162-profile-review-20261026c/report-validate.log`, with exit code zero in `report-validate-exit-code.txt` and actual container limits in `report-validate-container.json`. No additional DB run, merge, deployment, or issue closure is part of this finalization.
