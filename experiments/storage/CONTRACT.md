# W5 PostgreSQL candidate contract v1

Issue #128; source base `f6a7db7c1366eea48a3c677e518efe0f2816383b`. Experimental only. No qualification results yet.

W6 may depend on this contract while W5 implements and the coordinator validates it.

## Database and schema

The coordinator has created isolated container `bim-qvm-db` on network `bim-qvm-20261025`, database/user `qvm`, no published ports. Available image: `pgvector/pgvector:0.8.0-pg15-trixie`; record the resolved image ID/digest and `SELECT version()` at execution. Container volumes and evidence belong under `/ssd1/bim-forge-qualification/qvm-20261025`, never the root disk or another service. Initial limits: 1.5 CPU/3 GiB, shared_buffers 256 MB, work_mem 8 MB, maintenance_work_mem 256 MB, max_connections 80, max_parallel_workers_per_gather 1. No extension is required. No production adapter or migration is added.

`schema.sql` creates schema `qvm_storage` with immutable `versions`, `revisions`, `changes`, `receipts`; mutable `branches`, current `visibility`; and bounded comparison `snapshots`. Each immutable version stores the entire source document as JSONB plus its canonical SHA-256, identity, kind, type/container/system query projections, and optional relationship endpoints. Properties are kept typed inside the source document, not expanded into EAV rows. Revision changes contain only changed IDs/version hashes and tombstones. Current visibility is one row per live object per branch. Historical reconstruction uses recursive revision ancestry and the closest change per object; no checkpoint acceleration is claimed.

Publication is a transaction: lock branch, compare exact expected head, validate every semantic read assumption against current visible content hashes (null means absent), insert versions and changes, update visibility, revision, branch head and command receipt atomically. An identical command ID/payload returns its receipt; a different payload for that ID is an error. This conservative storage CAS is **not** engineering validation, authority approval or approval equivalence.

## TypeScript API (`store.ts`)

`Storage` accepts a connected `pg.Client`. `initialize()` allows only database `qvm` or prefix `qvm_w5_`. `createBranch({branch, revisionId})` creates an independent visibility copy at an existing revision, or an empty branch at null. `head(branch)`, `accept(command)`, `page({branch, after, limit, kind?})`, `historical({revisionId, after, limit})`, `history(entityId)`, `delta(revisionId)`, `metrics()` are public. `accept` returns `{revisionId, replayed}` or throws; failed transactions leave the head unchanged. W6 can use standard `pg_dump`/`pg_restore` on the complete isolated database; all tables including receipts must be copied.

`detail({branch,entityId})` reads one visible version. `projectOpen({branch,limit})` returns head/parent/command/time, a small revision manifest summary and at most 1,000 visible bodies from one SQL snapshot. It does not scan/materialize the entire model. Current/history keyset ordering follows the database primary-key collation, recorded in metrics. CLI: `open <branch> <limit>`. Workload configuration requires the predeclared execution envelope; standalone low-level loaders do not claim timing qualification.

Envelope (loader NDJSON, one object per line):

```json
{"entityId":"wall-1","kind":"wall","typeId":null,"containerId":null,"systemId":null,"fromId":null,"toId":null,"document":{"properties":[]}}
```

All projection keys are required and nullable. `fromId`/`toId` are both null or both identifiers. `document` retains the full typed W0/W4 source record; adapters must not discard source fields. Relationship records use their own identity and kind with both endpoints. W4 wire adaptation will be implemented when its contract is available. Version ID is SHA-256 of the canonical complete envelope (sorted object keys, ordered arrays). Branch/revision/command IDs are bounded strings.

Acceptance JSON:

```json
{"branch":"main","commandId":"edit-1","expectedHead":null,"assumptions":[{"entityId":"wall-1","versionId":null}],"puts":[{"entityId":"wall-1","kind":"wall","typeId":null,"containerId":null,"systemId":null,"fromId":null,"toId":null,"document":{"properties":[]}}],"deletes":[]}
```

Every written/deleted entity must have a matching read assumption. Additional assumptions may cover read dependencies. New revision ID is SHA-256 of the canonical command. Imported large datasets use staged batched immutable inserts and one atomic initial publication; incomplete ingest never moves a branch.

## CLI (`cli.ts`)

Use `DATABASE_URL` and a coordinator-issued `QVM_EXECUTION_LEASE` string. CLI operations: `init`; `load <envelope.ndjson> <branch>`; `branch <name> <revision-id|empty>`; `head <branch>`; `accept <command.json>`; `page <branch> <after|start> <limit>`; `historical <revision> <after|start> <limit>`; `history <entity-id>`; `delta <revision>`; `metrics`; `workload <config.json> <new-output-directory>`. All output is JSON. Errors exit nonzero. CLI never starts PostgreSQL or acquires an execution slot on its own.

Runner output is the frozen array `{experimentId:"EX-10"|"EX-13",caseId,expected,observed,passed,limitations:string[]}` plus raw artifacts. No shared registry update or terminal W0 record is synthesized. The coordinator supplies W0 bindings and reviews evidence.

Independent selection CLI: `verify-selections <manifest.json> <correctness-branch> [page-size<=1000] [max-rows] [statement-timeout-ms] [wall-time-ms]`. It verifies exactly the three W4 hot-space/shared-type/system-including-ports selections using source-owned parameterized projection SQL in a read-only repeatable-read snapshot. Manifest SQL strings are checked against fixed templates and are never executed. Numeric ID COPY hashes use unpadded decimal IDs plus LF. Result binds manifest hash and branch revision; incomplete/bad counts or hashes cannot pass. Main must supply a correctness lease and retain stdout/stderr. No database test/run is implied by source/type validation.

## Implementation and acceptance plan

Files: `schema.sql`, `contract.ts`, `store.ts`, `cli.ts`, `load.ts`, `workload.ts`, `store.test.ts`, experimental pinned package/tsconfig, `benchmarks/hospital/workloads/README.md` and sample configuration. Model entities: disposable full entity/relationship documents and immutable revision deltas. Validators: TypeBox wire/command/config/result validation, database constraints, semantic CAS, checksums against the same source data, real PostgreSQL integration tests. Evidence: raw timings/errors, actual counts/content checksums, node/OS/process/PG/settings, heap/index/TOAST/WAL measurements and immutable files. Server-only commands will accompany the final code commit.

Snapshot comparison is bounded by an explicit byte/entity limit and does not claim the existing product supports the hospital inventory. Full size, checkpoints, geometry evaluation, engineering authority, predicate read sets, artifact completeness, cross-project references, and production security remain unqualified. Benchmarks need at least five alternating repeats per relative comparison, a declared warm/cache mode and an exclusive full measurement lease from the coordinator.
