# W6 terminal record preparation

Recovery execution is complete. No additional correctness database writes are required for the retained run, and no new database job ran while preparing these records. New database work is held until the coordinator releases its full-run lease.

The tested recovery source remains `0247bdd381e565a9e885c62bbcbd85fbc3108c0d`. All six real PostgreSQL EX-11/EX-12 cases passed, as did the partial EX-09 representation upgrade. The [execution receipt](../w6-pg-0247bdd-02/README.md) contains the actual commands, artifact roots, checksums and limitations.

The metadata preparer is committed at `b6720120ebb1947b38af8f8c93d4d6f351e12323`, using W0's observation-artifact contract supplied as `fb61d97706f3a2cfa27bd2b74da0ab0912472f9b`. It ran inside a network-disabled server container capped at 0.5 CPU and 1536 MiB, with the executed evidence mounted read-only. Strict lint passed for 135 sources and the W6 strict typecheck passed. The completed recovery tests were not repeated.

## Drafts

| Experiment | Executed cases | Exact definition assertions | Hashed evidence references | Draft |
| --- | --- | --- | --- | --- |
| EX-09 | 2 | 3 | 14 | [draft](../../EX-09/w6-pg-0247bdd-02-terminal-prep-v1/draft.json) |
| EX-11 | 4 | 4 | 31 | [draft](draft.json) |
| EX-12 | 2 | 3 | 22 | [draft](../../EX-12/w6-pg-0247bdd-02-terminal-prep-v1/draft.json) |

Each draft has a sibling `preparation-audit.json`. Every executed historical Git binding was checked. Each record uses the same exact, unmodified observation artifact, filtered only by experiment ID. The observation artifact SHA-256 is `4943184977e3d910ae8cb062764a0cee516eb3299bffd6489e24ea6c14261e7c`.

Proposed conclusions are inconclusive. EX-09 lacks an actual geometry-engine upgrade. EX-12 has partial independent authentication/key-service coverage. EX-11 retains the observed process-crash and shared-host scope limits. Successful observations and full covered assertions remain visible rather than being relabeled as failures.

## Publication blocker

The retained correctness execution lease recorded CPU and memory limits but no numeric disk budget. Latest W0 requires a positive `environment.diskBudgetBytes`. The drafts therefore retain a null value and `recordKind: draft`; they are deliberately not terminal W0 results. Neither free disk capacity nor actual artifact usage has been presented as a historical execution budget.

A supported value and its provenance, or a W0 representation for unrecorded metadata, is needed before authoritative publication. After that, `experiments/recovery/records.ts` can invoke W0's `parseRun`, `verifyRun` and `publishRun` using a new unique run ID. It requires no database access or correctness rerun. No shared registry or definition has been edited.

## Server artifacts and command

Preparation logs and resolved input:

`/ssd1/bim-forge-qualification/qvm-20261025/artifacts/w6-records-b672012-01/`

The generated drafts are also retained in the dedicated Git checkout:

`/ssd1/bim-forge-qualification/qvm-20261025/sources/w6-records-b672012-01/docs/experiments/results/<EX-ID>/w6-pg-0247bdd-02-terminal-prep-v1/`

Actual command, with `/raw` mounted read-only from the existing database evidence root:

```sh
node scripts/validate-typescript.ts
node node_modules/typescript/bin/tsc --noEmit -p experiments/recovery/tsconfig.json
node experiments/recovery/records.ts /metadata/record-preparation-input.json
```

This preparation changes no acceptance policy and grants no adoption, merge or experiment-review approval.
