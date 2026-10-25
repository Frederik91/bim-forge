# W6 server execution receipt

Tested source: `0247bdd381e565a9e885c62bbcbd85fbc3108c0d`. Issue #129, parent #122. These are actual correctness observations for EX-09, EX-11 and EX-12. This receipt is not a terminal W0 result, review approval, registry update or experiment-level pass.

Execution was authorized by the coordinator's instruction permitting W6 recovery correctness tests on independent `qvm_w5_recovery*` databases. The client containers used at most 0.5 CPU and 1536 MiB. No full performance workload ran. No shared database container, preview or full benchmark branch was stopped or modified.

## Completed checks

| Check | Actual result |
| --- | --- |
| `npm run validate` | Passed; 134 TypeScript sources; root typecheck and policy validation passed. |
| W6 strict typecheck | Passed. |
| Recovery test suite | 13 passed, 0 failed, 0 skipped. Includes actual SIGKILL and fresh-process export checks. |
| W0 observation-array validation | Passed; eight observations, one explicitly unqualified case. |
| EX-11 before-publication crash | Writer PID 40 ended with SIGKILL after staging. Every exported database table remained unchanged; retry produced one acceptance and receipt. |
| EX-11 after-commit crash | Writer PID 51 ended with SIGKILL after COMMIT. Identical retry replayed one receipt without changing tables; changed payload reuse was rejected. |
| EX-11 incomplete artifacts | Missing and corrupt artifacts each prevented publication. SQL exports remained unchanged and the last complete package reopened. |
| EX-11 independent restore | Complete pg_dump/pg_restore into another database and separate artifact root. All tables, canonical version hashes, paginated current/historical queries, ancestry, deltas and receipts matched while source connections were rejected and the source artifact path was unavailable. |
| EX-12 divergence | Separate database edits and portable exchange preserved both branches, stable revision IDs, documents and discipline evidence. |
| EX-12 atomic discipline acceptance | Actual conflicting property values were compared. Unresolved/missing resolution, incomplete authority, stale candidate and racing head were rejected. Two simulated discipline decisions, model delta, evidence, receipt and head committed together. |
| EX-09 format/dictionary/serialization | Experimental representation changes executed against PostgreSQL. Exact old bytes remained queryable through both pinned and upgraded readers. |
| Full EX-09 | Unqualified. No old/new geometry kernel ran. The original acceptance assertion remains unchanged. |

The database runner returned exit 1 because full EX-09 remains false. Its six EX-11/EX-12 cases and partial EX-09 representation case passed. Case limitations remain in `observations.json`; these do not establish complete experiment qualification.

## Retained server evidence

Host: `fun-server`. Tools image: `bim-qvm-tools:20261025`, image ID `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`. Actual runtime: Node v24.22.1, PostgreSQL 15.14. `fsync`, `synchronous_commit` and `full_page_writes` were all on.

Server checkout with source Git objects:

`/ssd1/bim-forge-qualification/qvm-20261025/sources/w6-0247bdd-checks-01`

Validation and subprocess evidence root:

`/ssd1/bim-forge-qualification/qvm-20261025/artifacts/w6-0247bdd-checks-01/`

This root retains `validate.log`, `recovery-typecheck.log`, `recovery-tests.log`, the execution authorization, source commit, Node version and actual process evidence under `w6-process-evidence-Om4UmW/`. Its `MANIFEST.sha256` has SHA-256 `e3c2aa871fee4197733c160d7e2655dd338dfcf2848750dfd52d46bdc77ddfd6`.

Database evidence root:

`/ssd1/bim-forge-qualification/qvm-20261025/artifacts/w6-0247bdd-postgres-02/`

Its `MANIFEST.sha256` has SHA-256 `486338154349660e799fb0e1decbefb66349a26cbafe39d71030722493dfd1a7`. It retains the actual input and lease, exit code, stdout/stderr, post-run database state and W0 observation validation. Detailed raw evidence is under `postgres/w6-pg-0247bdd-02/`, including:

- `source-bindings.json` and `environment.json`.
- Both checkpoint/process logs.
- Before/after table and paginated-query exports.
- `recovery.dump`, its SHA-256 and pg_dump/restore output/version logs.
- Rejected source connection, missing/corrupt artifacts, changed payload, authority and racing-head errors.
- Divergence exports, command payloads and simulated review artifacts.
- Original/upgraded historical bytes and query evidence.
- The final observation array and checksum.

The committed `observations.json` is an exact copy of the server array. SHA-256: `4943184977e3d910ae8cb062764a0cee516eb3299bffd6489e24ea6c14261e7c`.

An earlier container setup failure is retained under `artifacts/w6-0247bdd-postgres-01/`. It failed to resolve `pg-types` before running database cases. The dependency mount was corrected for attempt 02 without changing source or weakening checks.

## Executed commands

These commands are run history. Do not repeat completed runs or reuse the retained databases for another experiment. The two database names are `qvm_w5_recovery_w6_0247bdd_01` and `qvm_w5_recovery_w6_0247bdd_01_restore`. Both allow connections again after the restore check. The shared `bim-qvm-db` container remains running.

Inside the isolated validation container, with the checkout at `/work`, evidence at `/evidence`, and installed tool dependencies available:

```sh
cd /work
npm run validate
node node_modules/typescript/bin/tsc --noEmit -p experiments/recovery/tsconfig.json
QVM_W6_LEASE_FILE=/evidence/package-lease.json TMPDIR=/evidence/tmp node --test experiments/recovery/recovery.test.ts
```

The PostgreSQL container additionally used private network `bim-qvm-20261025`. The read-only PostgreSQL dependency directory was mounted at `/pgdeps/node_modules` and linked into the container's `/app/node_modules`. Its actual runner command was:

```sh
cd /work
node experiments/recovery/postgres.ts /evidence/postgres-input.json /evidence/database-lease.json
node experiments/contracts/cli.ts observations /evidence/postgres/w6-pg-0247bdd-02/observations.json
```

The runner's exact `pg_dump` and `pg_restore` argument construction is pinned in the tested source. Resolved inputs and raw command output are retained in the database evidence root.

## Remaining qualification limits

Full EX-09 requires an actual geometry-kernel upgrade. Restore used separate databases and artifact roots on one PostgreSQL host with the same test role; independent identity providers, encryption keys and host failure domains remain unqualified. Discipline actors are explicitly simulated, conflict detection covers the fixture's scalar property, and W5 has single-parent ancestry. Portable package exchange does not establish a full network synchronization service. W0 terminal records and W7 review remain coordinator work.
