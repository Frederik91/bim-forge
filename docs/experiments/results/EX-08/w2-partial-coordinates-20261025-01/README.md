# EX-08: published partial terminal record, inconclusive

`result.json` and `summary.md` were published through W0 `publishRun`; `input.json` remains the original verified pre-publication input. W0 `29583f735c1803872ace3fa663dcf6d7a145434a` verified exact registry assertions, source/runner Git objects, all artifact hashes and the required `observationsArtifact` equality again during publication. The actual observations and failed checks were unchanged. This is metadata publication, not reviewed qualification or approval.

The historical run has 36 EX-08 observations: 32 passed / 4 failed. Sixteen independent coordinate cases and sixteen real IfcOpenShell geometry cases passed. Four exact-canonical-hash checks could not execute because unnamed IFC root fields remained STEP sentinels instead of JSON null. Their actual failed observations remain unchanged, and that assertion is `not-covered`. The terminal input has `executionStatus: failed`, `conclusion: inconclusive`. No certified survey, general exchange or viewer-origin behavior is qualified.

The latest null-name/hash fix passed its source-unit regression at `c30979d640a22ef8b4dc83f7307e111cd5d6546a`; the latest full IFC preparation was not run. No fourth preparation attempt occurred. The separately authorized EX-02 downstream task adds no new EX-08 cases.

See the [EX-02 evidence package](../../EX-02/w2-partial-exchange-20261025-01/README.md) for the complete artifact roots, source bundle, logs, validation commands and eight paired-export contribution pointers. Both records resolve their artifact paths against this retained server root:

```text
/ssd1/bim-forge-qualification/qvm-20261025/w2-runs/w2-terminal-package-20261025-01/evidence/
```

Inside the leased container, this metadata-only verification already passed:

```sh
PACKAGE=/qualification/w2-runs/w2-terminal-package-20261025-01
node experiments/contracts/cli.ts verify "$PACKAGE/inputs/EX-08.input.json" "$PACKAGE/evidence"
```

Terminal publication completed once at `/qualification/w2-runs/w2-terminal-package-20261025-01/published/EX-08/w2-partial-coordinates-20261025-01/result.json`; the shared EX-02 `publication/` directory contains commands, time and result hashes. No registry or design change was performed. The coordinator owns evidence review and any adoption decision. No engine/database/performance job was relaunched.
