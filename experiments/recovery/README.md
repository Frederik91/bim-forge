# W6 recovery preparation

Issue [#129](https://github.com/Frederik91/bim-forge/issues/129), parent [#122](https://github.com/Frederik91/bim-forge/issues/122). Scope is `experiments/recovery/**`. No builds, tests, database jobs or crash cases have run for this source delivery. No experiment result or approval is claimed.

The module uses W0 contract v1 at `edbfd4c4bddb78720c2be34061b7437d52bdc3bc`. `protocol.ts` reexports W0's authoritative observation schema, parser and type. Hashes use W0's `records.ts`. W0's tiny fixture is read directly in a transport test. W6 does not write a competing terminal result format or edit the shared registry.

## Files and acceptance plan

| File | Purpose and acceptance evidence |
| --- | --- |
| `protocol.ts` | TypeBox boundaries for portable manifests, interpretation pins and CLI input. Refuse duplicate identity, incomplete ancestry and absent required artifacts. |
| `package.ts` | Verify exact bytes, lengths and SHA-256; retain immutable history; copy to independent artifact roots; publish a complete-copy pointer only after verification and fsync. |
| `authority.ts` | Pure prepublication oracle for two distinct discipline actors, candidate-bound decisions, conflict resolution and expected head. Actors are explicitly simulated. |
| `scenarios.ts` | Expected database outcomes for EX-09, EX-11 and EX-12. Unexecuted database cases produce `passed: false` with an explicit missing-coverage explanation. |
| `runner.ts` | Execute portable package cases and preserve raw manifests, deltas, observations and hashes. Exit 1 while database coverage is missing. |
| `faults.ts` | Kill only its own dedicated package-writer child at an observed checkpoint, under a coordinator-issued lease. Preserve process and checkpoint logs. |
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

The focused suite creates small real temporary artifact roots and removes them after its assertions. It never connects to PostgreSQL or terminates a process. Its opaque transport fixtures do not count as EX-09 engine upgrades or EX-11 database crash evidence. The W0 fixture case opens retained model bytes after removing the package source and queries its wall and opening relationship through W0's reader.

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

## W5 integration contract and remaining execution

W5's early interface is committed at `9957223` in `experiments/storage/CONTRACT.md`. No W5 implementation is imported here until main forwards the schema/CLI implementation contract. W5's candidate uses real PostgreSQL 15 in schema `qvm_storage`. Its `accept` performs expected-head and read-assumption CAS and writes a receipt in the same transaction. It explicitly does not implement geometry checks, discipline authority or artifact completeness. W6 must report that behavior as a limitation or a failed required scenario when observed.

Main has supplied container `bim-qvm-db`, network `bim-qvm-20261025`, user/database `qvm`, private with no published ports. W6 must not run against W5's measurement database or terminate this shared container. The current W5 initializer only allows `qvm` or database names prefixed `qvm_w5_`. Main should allocate two separate databases such as `qvm_w5_w6_<run>_source` and `qvm_w5_w6_<run>_restore`, with separate artifact roots. A dedicated W6 database container is required if database-container termination is included in the lease. The existing shared PG container is never a crash target.

After W5 is supplied, implement the seven storage scenarios in `scenarios.ts` against its real CLI/API. Preserve the exact source documents and use fresh connections for independent observations. For restore, capture a complete `pg_dump` including receipts, restore it to the second empty database, verify table counts, canonical version hashes, full paginated documents, ancestry, branch heads, deltas and receipts. Remove source artifact access before the destination query. Record hashes for the dump and required artifacts. Never label an object-file copy as a database restore.

Database crash injection needs W5 checkpoint support or a dedicated writer around its transaction. Kill the dedicated writer after artifact staging and before publication, then after the actual database commit before acknowledgement. Retry with the original command ID and exact payload. Check SQL for one logical revision/receipt/head advance; reuse with different payload must fail. Do not treat the package driver's `after-publish` checkpoint as a database commit.

The divergence case needs real separate databases and distinct changed source documents descended from one common revision. Preserve both branches and review artifacts, query the merged package independently, and apply the discipline oracle to candidate-bound simulated decisions. Eligibility alone is not atomic acceptance. The database scenario must observe the accepted head, delta, evidence and receipt together and verify rejection on a racing head. A missing W5 authority or multi-parent reconciliation feature remains explicit failed or uncovered evidence.

Historical interpretation needs a pinned executable reader and original representation, not only version strings. The package cases verify retention of descriptor bytes. They do not execute an old geometry engine, migrate a real schema, prove key/authentication independence or implement semantic conflict detection. W5 currently specifies single-parent revisions. Portable exchange is sufficient for initial transport scope; no full network synchronization service is included.

Only main runs validation and supplies evidence before a draft PR. The PR stacks on `feature/issue-123-qualification-contracts`. No preview deployment, production data change, auto-merge or shared registry edit is part of this module.
