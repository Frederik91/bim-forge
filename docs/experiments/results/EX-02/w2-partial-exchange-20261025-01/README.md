# EX-02: verified partial evidence input, failed exchange preservation

`input.json` is a W0 terminal-record **input**, not a published result or engineering approval. W0 `29583f735c1803872ace3fa663dcf6d7a145434a` verified the input, exact committed registry assertions, source/runner Git objects, every retained artifact's byte count/SHA-256, and the required `observationsArtifact` equality. EX-09 is not part of W2.

The record contains 53 EX-02 observations: 33 passed / 20 failed, with `executionStatus: failed` and `conclusion: failed`. The unfamiliar `IfcPropertyBoundedValue` was actually lost from the native scalar/list re-export. That failed preservation check is retained. Other schema-dependent failures report unavailable `_pytest`; they do not establish a schema violation. The original preparation's complete 85-row array remains unchanged: 65 passed / 20 failed across EX-02/EX-08.

The separately authorized downstream task verified all 74 original artifacts against their manifest and copied them to a fresh output directory. Both TS property imports succeeded. The historical `be6e71b2cc641d669de9f2e57dec49623744100a` runner executed roundtrip once, adding four actual failed observations: one bounded-property loss and three schema-dependent checks unavailable because pytest was absent. `all-observations.json` has the original 85 rows plus those four rows, 65 passed / 24 failed. There was no fourth preparation run and no retry of the downstream task.

Source `c30979d640a22ef8b4dc83f7307e111cd5d6546a` separately passed server `npm run validate` (118 TS sources), scoped W2 typechecking, 3 TS tests and 8 Python tests. Its pinned dependency installation also passed. The added null-name/hash regression passed. **The latest full IFC preparation and EXPRESS path remain unvalidated.** The final PR head adds evidence/documentation to that tested source; it must not claim a latest-source end-to-end pass.

All server work used `bim-qvm-w2-debug`, 0.5 CPU / 1536 MiB, tools image `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`. Shared preview/database/model data was untouched. No full performance work ran.

## Retained artifact roots and commands

Complete, checksummed private evidence is retained on `fun-server`:

```text
/ssd1/bim-forge-qualification/qvm-20261025/w2-runs/w2-terminal-package-20261025-01/
  evidence/                   # complete evidence root for both inputs
    preparation/              # original failed run, byte-preserved
    downstream/               # fresh copied inputs and actual roundtrip outputs
    preparation-logs/
    downstream-logs/
    latest-source-unit-logs/
    latest-ifc-preparation-fixes/
    metadata.json
  inputs/EX-02.input.json
  inputs/EX-08.input.json
  inputs/EX-01-paired-export-contribution.json
  commands.sh
  finalize.log
  verify-EX-02.log
  verify-EX-08.log
```

The files committed here are small copies of the inputs, combined observations, metadata and command logs. `input.json` artifact paths resolve against the complete server `evidence/` root, not this Git directory. Each record carries artifact hashes and exact registry coverage; unavailable exact-hash cases in EX-08 are `not-covered`. The original prepare did not record a disk budget; the 1 GiB record value is explicitly the checked evidence-packaging budget defined at finalization, not a historical enforced run quota.

Historical source Git objects are retained in `/qualification/sources/w2-debug`, including branch `w2-downstream-tested`. The retained bundle `/ssd1/bim-forge-qualification/qvm-20261025/sources/w2-finalization-source.bundle` contains current W0/source and the historical runner; SHA-256 `850cb120f873cbac0d71c92b5d5857e8695b12ec92ab19f7dfbaa6a6ce483e47`. Retain that bundle and evidence package through review; a fresh clone of only the rebased PR branch does not necessarily contain the historical runner object.

These metadata-only verification commands already passed in the leased container. They do not execute preparation or publish a terminal result:

```sh
PACKAGE=/qualification/w2-runs/w2-terminal-package-20261025-01
node experiments/ifc/finalize-partial.ts /qualification/sources/w2-debug "$PACKAGE/evidence" "$PACKAGE/inputs"
node experiments/contracts/cli.ts verify "$PACKAGE/inputs/EX-02.input.json" "$PACKAGE/evidence"
node experiments/contracts/cli.ts verify "$PACKAGE/inputs/EX-08.input.json" "$PACKAGE/evidence"
```

Do not repeat the first command with the existing input directory: creation is exclusive. Actual source-only validation commands are in `latest-source-unit-logs/commands.sh`, with exit statuses in `status.tsv`. Actual downstream commands/status are in `downstream-logs/`. `EX-01-paired-export-contribution.json` describes eight paired controlled-generated exports; W1 owns their interpretation and terminal EX-01 record. These are not vendor/Revit exports or guarantees of vendor identity stability.
