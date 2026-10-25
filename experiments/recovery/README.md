# W6 recovery preparation

Issue [#129](https://github.com/Frederik91/bim-forge/issues/129), parent [#122](https://github.com/Frederik91/bim-forge/issues/122). Scope is `experiments/recovery/**`. No builds, tests, database jobs or crash cases have run for this source delivery. No experiment result or approval is claimed.

The module is based on W0 foundation `cfdf363c9227c35534ad5ad9c6d507e99e627824` and imports the actual W5 implementation supplied as `f390f042b3af2ec0d5d2e425d8561955ee2cff0d`. W5 is a separate dependency commit. `protocol.ts` reexports W0's authoritative observation schema, parser and type. Hashes use W0's `records.ts`. W0's tiny fixture is read directly. W6 does not write a competing terminal result format or edit the shared registry.

## Files and acceptance plan

| File | Purpose and acceptance evidence |
| --- | --- |
| `protocol.ts` | TypeBox boundaries for portable manifests, interpretation pins and CLI input. Refuse duplicate identity, incomplete ancestry and absent required artifacts. |
| `package.ts` | Verify exact bytes, lengths and SHA-256; retain immutable history; copy to independent artifact roots; publish a complete-copy pointer only after verification and fsync. |
| `authority.ts` | Pure prepublication oracle for two distinct discipline actors, candidate-bound decisions, conflict resolution and expected head. Actors are explicitly simulated. |
| `scenarios.ts` | Expected database outcomes for EX-09, EX-11 and EX-12. Unexecuted database cases produce `passed: false` with an explicit missing-coverage explanation. |
| `runner.ts` | Execute portable package cases and preserve raw manifests, deltas, observations and hashes. Exit 1 while database coverage is missing. |
| `faults.ts` | Kill only its own dedicated package-writer child at an observed checkpoint, under a coordinator-issued lease. Preserve process and checkpoint logs. |
| `exports.ts` | Query every revision of a retained copy in a fresh process; export full W0 model data, exact original bytes, ancestry, branch heads and hashes. Verify the exported query against the exported bytes. |
| `history.ts` | Execute two experimental representation formats, owner dictionaries and serializations; retain a strict v1 reader and an upgraded reader. No geometry engine simulation. |
| `postgres.ts` | Actual W5 API, dedicated database writer SIGKILL, fresh-connection exports, pg_dump/restore, disconnected branch exchange and governed acceptance with persisted simulated discipline evidence. |
| `records.ts` | Prepare or publish EX-09/11/12 records from retained evidence through the latest W0 contract. No database connection or correctness rerun. Missing execution metadata stays explicit. |
| `recovery.test.ts` | Filesystem behavior, W0 fixture retention, missing/corrupt transfer rejection, immutable retry, ancestry, simulated discipline policy and partial-result honesty. No database mocks. |
| `tsconfig.json` | Root strict TypeScript settings plus checked indexed access. |

The portable manifest is a W6 transport envelope around opaque artifacts, not another BIM entity schema. Each revision pins its model hash, complete ancestry, required artifacts and the version/hash of its schema, dictionary, canonicalizer and kernel descriptors. Those descriptors and all referenced artifacts must be in the package. Old revision metadata and bytes cannot be replaced during an upgrade. A branch can advance while its earlier contributions remain in history.

An import writes immutable files to a unique staging directory, verifies their hashes, renames the complete package, then atomically renames a small complete-copy pointer. The coordinator supplies one writer per root. The pointer is not a database accepted head. Missing/corrupt transfers leave the old pointer untouched. Repeating the same package reuses its manifest hash. Interrupted staging directories remain available for inspection.

## Server checks for the coordinator

Run these commands only inside the allocated disposable server container, from a checkout of the prepared source commit. `/evidence` must bind a unique directory on `/ssd1`, for example `/ssd1/bim-forge-qualification/qvm-20261025/w6/<run-id>`. Use the coordinator's pinned Node image with Node 24 or later. Record the actual image digest and limits. Install dependencies inside that disposable environment if they are not already present.

```sh
cd /workspace
npm ci --ignore-scripts
mkdir -p /evidence/w6-tmp
node node_modules/typescript/bin/tsc --noEmit -p experiments/recovery/tsconfig.json
npm run validate
TMPDIR=/evidence/w6-tmp node --test experiments/recovery/recovery.test.ts
git -c core.whitespace=cr-at-eol diff --check
```

The focused suite creates small real temporary artifact roots and removes them after its assertions. It uses a real subprocess to export retained W0 model data after both source package paths are removed. It does not connect to PostgreSQL. Its opaque transport fixtures do not count as EX-09 engine upgrades or EX-11 database crash evidence. The W0 fixture case opens retained model bytes after removing the package source and queries its wall and opening relationship through W0's reader.

To run package cases, provide two valid packages at distinct read-only input paths. The upgraded package must retain the complete old history and exercise changed versions and bytes for all four interpretation descriptors. Each input package contains `manifest.json` and `objects/<sha256>` files. `PackageSchema` and `createPackage` define the transport contract. Package sources and output roots must be independent.

Example `/evidence/package-input.json` supplied by the coordinator:

```json
{
  "sourcePackage": "/inputs/before",
  "upgradedPackage": "/inputs/after",
  "outputRoot": "/evidence/package-cases",
  "runId": "w6-package-unique-run-id"
}
```

```sh
node experiments/recovery/runner.ts /evidence/package-input.json
node experiments/contracts/cli.ts observations /evidence/package-cases/w6-package-unique-run-id/observations.json
```

The first command intentionally exits 1 because storage cases are uncovered. Preserve its observation array and raw files even when it exits 1. A successful package subcase does not imply a passed experiment. W0 terminal records require exact assertion coverage and remain inconclusive when these limitations apply. The coordinator creates any terminal record using W0's writer and actual environment bindings.

## Leased package-writer crash cases

Use another unique `runId` in `/evidence/fault-input.json`, with the same input packages. Main supplies `/evidence/coordinator-lease.json` with this shape and an actual future expiry:

```json
{
  "leaseId": "main-issued-w6-slot-id",
  "artifactRoot": "/evidence",
  "expiresAt": "<coordinator-issued ISO UTC expiry>",
  "permittedHelper": "w6-package-writer"
}
```

```sh
node experiments/recovery/faults.ts /evidence/fault-input.json /evidence/coordinator-lease.json
```

This driver spawns its own Node child, waits for the child's checkpoint marker and sends SIGKILL through that child handle. It observes the retained pointer after staging and the new pointer after publication, then retries. It cannot target an arbitrary PID or PostgreSQL container. Do not supply a lease or invoke this command until main allocates the execution slot. These are POSIX process-crash checks on the portable copy, not database commit or host power-loss checks.

Main can exercise this driver through the actual subprocess test as well:

```sh
QVM_W6_LEASE_FILE=/evidence/coordinator-lease.json TMPDIR=/evidence/w6-tmp node --test experiments/recovery/recovery.test.ts
```

Without that environment variable the termination test reports an explicit skip. With it, the test retains process logs and a separate array proving that all seven database placeholders remain unqualified. Process evidence is kept in a unique `w6-process-evidence-*` directory below the leased artifact root. A skipped test is never qualification evidence.

## Actual PostgreSQL runner for main

The actual W5 source is now imported from `../storage/store.ts` and `../storage/contract.ts`. W6 defines no database tables or schema copies. W0 `cfdf363` supplies the pinned PostgreSQL client as development tooling. Run root `npm ci --ignore-scripts` inside the disposable server checkout before validation. The supplied tools image is `bim-qvm-tools:20261025`; main must record its actual image ID/digest and retain the Git bundle clone on `/ssd1`.

Main must precreate two empty dedicated databases owned by `qvm`. The runner refuses a preexisting `qvm_storage` schema and never drops or resets it. Names must be `qvm_w5_recovery` or start with `qvm_w5_recovery_`. Database URLs must use `qvm@bim-qvm-db` without a password or URL options. The shared `qvm` measurement database is always refused by W6.

Example `/evidence/postgres-input.json`:

```json
{
  "sourceUrl": "postgres://qvm@bim-qvm-db/qvm_w5_recovery",
  "restoreUrl": "postgres://qvm@bim-qvm-db/qvm_w5_recovery_restore",
  "outputRoot": "/evidence/postgres",
  "runId": "w6-pg-unique-run-id",
  "imageDigest": "sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff"
}
```

Main supplies a separate database lease at `/evidence/database-lease.json`. Its expiry must be in the future, its artifact root must contain the run output, and it must explicitly authorize both dedicated databases and the temporary connection block on the source database:

```json
{
  "leaseId": "main-issued-w6-database-slot",
  "expiresAt": "<main-issued ISO UTC expiry>",
  "artifactRoot": "/evidence",
  "databaseNames": ["qvm_w5_recovery", "qvm_w5_recovery_restore"],
  "permittedHelper": "w6-database-writer",
  "allowSourceConnectionBlock": true
}
```

Only main runs these commands in the allocated tools container attached to `bim-qvm-20261025`, with `/workspace` as its real Git checkout and `/evidence` bound to the unique `/ssd1` run root:

```sh
cd /workspace
npm ci --ignore-scripts
npm run validate
node node_modules/typescript/bin/tsc --noEmit -p experiments/recovery/tsconfig.json
TMPDIR=/evidence/w6-tmp node --test experiments/recovery/recovery.test.ts
node experiments/recovery/postgres.ts /evidence/postgres-input.json /evidence/database-lease.json
node experiments/contracts/cli.ts observations /evidence/postgres/w6-pg-unique-run-id/observations.json
```

The PostgreSQL command intentionally exits 1 while complete EX-09 kernel-upgrade coverage remains false. Preserve its output and inspect every case. The six actual PostgreSQL crash/restore/divergence/authority cases must produce real observations; their preparation does not count as execution. A failed database case records its actual error and retains the failed attempt.

The runner requires committed Git bytes for the design, registry, W0 fixture/reader, W5 schema/store/contract and W6 runner/history reader. It refuses missing or dirty bindings rather than inventing `sourceGit`. It records bindings, PostgreSQL durability settings, actual pg_dump/restore versions, process checkpoint markers, SIGKILL outcomes, complete table exports, canonical version checks, all paginated branch/historical queries, deltas, command payloads, dump hashes, review artifacts and explicit rejection errors.

The governed wrapper verifies full artifact bytes and their model state before W5 publication. Its fixed simulated policy requires mechanical and electrical actors. Candidate-bound review artifacts, an acceptance descriptor and model changes are inserted through a single W5 acceptance transaction. The short W5 head CAS rejects a changed head after preparation. Identical replay uses the same complete enriched payload; changed command-ID reuse must be rejected. The acceptance descriptor binds the immutable candidate revision and required artifacts, so transferring a larger portable package does not rewrite the acceptance receipt.

For restore, the runner copies the complete database with pg_dump/pg_restore and copies artifacts into a separate root. It closes its source connections, temporarily sets only the dedicated source database to `ALLOW_CONNECTIONS false`, observes a rejected source connection, and hides the source artifact path. It then exports the restored database through new connections and compares every table, canonical entity hash and full paginated query with the source export. The source connection setting and artifact path are restored in `finally`. A database container is never stopped or killed.

For divergence, the two databases edit the same pump property on separate local branches from a common head before exchanging their new data. Portable packages retain both contributions. Declared commands are replayed under the governed wrapper on the receiving database. Their stable revision IDs, complete source documents, ancestry, receipts and review evidence must agree. The scalar conflict oracle compares the actual branch values. Reconciliation requires declared resolution and current approvals from both disciplines. These actors and decisions are test simulations, and W5 continues to have single-parent ancestry.

History execution changes a real W6 representation shape, property dictionary and serialization, then queries the exact old bytes from PostgreSQL through the pinned and upgraded readers. This is additional partial EX-09 evidence. Full EX-09 stays false because no old/new geometry kernel has run. The original assertion is retained without weakening it.

## Boundaries and remaining qualification

W5's candidate uses real PostgreSQL 15 in schema `qvm_storage`. Its `accept` performs expected-head and read-assumption CAS and writes a receipt in the same transaction. It explicitly does not implement geometry checks, discipline authority or artifact completeness. Those test policies are supplied by W6's governed wrapper. Direct W5 calls do not become an engineering acceptance API.

Main has supplied container `bim-qvm-db`, network `bim-qvm-20261025`, user/database `qvm`, private with no published ports. W6 must not run against W5's measurement database or terminate this shared container. Main allocates dedicated `qvm_w5_recovery*` databases and separate artifact roots. This runner terminates dedicated writer children only. The shared PG container is never a crash target.

The standalone package runner still outputs unqualified placeholders for the PostgreSQL cases. Only the actual `postgres.ts` run can replace those with execution observations. It creates its own observation array and raw evidence; neither runner changes the shared registry.

The PostgreSQL runner uses a dedicated writer around W5's real transaction. Its `after-database-commit` marker is emitted only after `Storage.accept` has returned from COMMIT. The package driver's `after-publish` checkpoint remains a separate filesystem event.

A shared PostgreSQL server and test role do not prove independent authentication, key services or host failure domains. Those limitations remain on the restore observation. No full network service, external IFC interpretation, multi-parent database revision, production permission system or cryptographic human approval is claimed.

Historical interpretation needs a pinned executable reader and original representation, not only version strings. The package cases verify retention of descriptor bytes. They do not execute an old geometry engine, migrate a real schema, prove key/authentication independence or implement semantic conflict detection. W5 currently specifies single-parent revisions. Portable exchange is sufficient for initial transport scope; no full network synchronization service is included.

Only main runs validation and supplies evidence before a draft PR. The original W6 commits stack on W0. The actual PostgreSQL runner additionally requires the separately supplied W5 commit. Main integrates W6 module commits on a base containing both dependencies so the review diff stays under `experiments/recovery/**`. No preview deployment, production data change, auto-merge or shared registry edit is part of this module.

## Metadata-only result preparation

The actual correctness run is complete and retained in `docs/experiments/results/EX-11/w6-pg-0247bdd-02/`. No further database writes are needed for those cases. While the coordinator reserves the database for hospital work, `records.ts` can prepare the three records in a network-disabled container against a read-only mount of the retained PostgreSQL evidence. It uses W0's updated observation-artifact verification supplied at `fb61d97706f3a2cfa27bd2b74da0ab0912472f9b`.

Example metadata input:

```json
{
  "repository": "/work",
  "evidence": "/raw",
  "results": "/work/docs/experiments/results",
  "mode": "prepare",
  "runId": "w6-pg-0247bdd-02-terminal-prep-v1",
  "diskBudget": { "kind": "unrecorded" }
}
```

```sh
node experiments/recovery/records.ts /metadata/record-preparation-input.json
```

The preparer uses the actual executed observation array without editing it, hashes each referenced artifact, verifies the executed historical Git bindings, and accounts for every exact assertion in the executed registry. Each experiment is conservatively inconclusive. EX-09 has partial geometry-engine coverage; EX-12 has partial authentication/key independence coverage; EX-11 retains its shared-host and process-crash scope limits.

The retained correctness lease recorded CPU and memory limits but no numeric disk budget. W0 requires a positive `environment.diskBudgetBytes`. Preparation therefore writes `draft.json` with `recordKind: draft`, a null disk budget and a separate audit. These are deliberately not terminal W0 records. Disk capacity and observed bytes are not substituted for an unrecorded execution budget.

Once the coordinator supplies a supported value and provenance, use `diskBudget: { "kind": "recorded", "bytes": <number>, "provenance": "<source and meaning of the value>" }`, a new unique run ID and `mode: publish`. Publication invokes W0's `parseRun`, `verifyRun` and `publishRun`, including exact observation-artifact equality and hash checks. It never edits earlier evidence, shared definitions or registry status. No database job is required for publication.
