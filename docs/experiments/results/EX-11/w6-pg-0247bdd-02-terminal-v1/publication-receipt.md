# W6 terminal publication

EX-09, EX-11 and EX-12 terminal records were published through W0 `a98b6cd49c637f40dd7431196bd98349bcc4a466` after the coordinator confirmed root validation and five contract tests passed. All three conclusions are `inconclusive`. The original unrecorded disk budget remains null with an explicit limitation. No budget value, execution result or approval was invented.

| Experiment | Published record | SHA-256 |
| --- | --- | --- |
| EX-09 | [result](../../EX-09/w6-pg-0247bdd-02-terminal-v1/result.json) | `7f26a826ac43ea3c5f015d472ed5961b50615b2fae2579ac1a271ac47da14df6` |
| EX-11 | [result](result.json) | `48ca71edd7a8e438a4bf922ec78555ceddeda4230e76c31a6ef1ec5fcbe4fda5` |
| EX-12 | [result](../../EX-12/w6-pg-0247bdd-02-terminal-v1/result.json) | `a8fea2023156741c68798827c17c720e358b3e474de5b26be0d515c63cf7e8aa` |

The source/runner binding for actual recovery execution remains `0247bdd381e565a9e885c62bbcbd85fbc3108c0d`. Its retained Git bundle and original evidence were not rewritten. Each terminal record references the unchanged executed observation array at `postgres/w6-pg-0247bdd-02/observations.json`, SHA-256 `4943184977e3d910ae8cb062764a0cee516eb3299bffd6489e24ea6c14261e7c`. W0 verification checked exact observation equality, every registry assertion, historical source/runner commits and all referenced artifact hashes.

## Metadata source validation

W6 metadata source `33a459426bb2d934f858d57b9b3bc33872da6c7e` was validated in isolated server integration commit `0d0f93da529fb92713f6147cafe46ee336cb400e`, which adds the validated W0 `a98b6cd` dependency to the W5-stacked W6 source. The source PR itself changes only W6 implementation and unique result paths; it does not duplicate W5 or W0 modules. W5 must incorporate the W0 update before standalone null-budget publication from its branch can work.

- Root `npm run validate` passed, including strict lint over 142 sources, root typecheck and policy validation. See [log](publication/metadata-root-validate.log).
- The W6 strict typecheck passed. Its log is empty because the command returned successfully without diagnostics.
- All three terminal records passed W0 CLI verification. See [verification](publication/published-record-verification.log).

These metadata commands ran with network disabled, at most 0.5 CPU and 1536 MiB, and a read-only mount of original run evidence. No database connection, correctness rerun, performance measurement or hospital generation occurred.

```sh
npm run validate
node node_modules/typescript/bin/tsc --noEmit -p experiments/recovery/tsconfig.json
node experiments/recovery/records.ts /metadata/record-publication-input.json
node experiments/contracts/cli.ts verify docs/experiments/results/EX-09/w6-pg-0247bdd-02-terminal-v1/result.json /raw
node experiments/contracts/cli.ts verify docs/experiments/results/EX-11/w6-pg-0247bdd-02-terminal-v1/result.json /raw
node experiments/contracts/cli.ts verify docs/experiments/results/EX-12/w6-pg-0247bdd-02-terminal-v1/result.json /raw
```

Server publication evidence and resolved input:

`/ssd1/bim-forge-qualification/qvm-20261025/artifacts/w6-publish-33a4594-01/`

Retained source Git and generated terminal directories:

`/ssd1/bim-forge-qualification/qvm-20261025/sources/w6-publish-33a4594-01/`

Original database evidence remains under `artifacts/w6-0247bdd-postgres-02/`; original validation and subprocess evidence remains under `artifacts/w6-0247bdd-checks-01/`, beneath the same `/ssd1/bim-forge-qualification/qvm-20261025` root. The earlier setup failure, immutable preparation drafts, and all retry/rejection evidence remain retained.

## Interpretation and hold

All six actual PostgreSQL recovery/divergence/authority cases passed, and the partial representation-upgrade case passed. Full EX-09 lacks an executed geometry-kernel upgrade. EX-12 does not establish independent authentication/key services. Process-crash, shared-host, simulated-actor and scalar-conflict limits remain explicit. These terminal records grant no architecture adoption or merge approval; W7 review is still required.

All W6 correctness writes finished before the coordinator's full hospital initial-load lease. New database, performance and hospital-generation jobs remain held until coordinator release.
