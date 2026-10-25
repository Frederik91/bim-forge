# W2 server debug evidence: qualification remains failed/incomplete

This is raw debug evidence, **not a W0 terminal run or approval**. It includes EX-02 and EX-08 observations in one raw array. The coordinator must split experiments, bind the exact definition/design and actual environment, verify artifact hashes, and publish with W0 before any reviewed result is recorded. No registry or design files were changed.

Tested source: `be6e71b2cc641d669de9f2e57dec49623744100a`, based on final W0 root `19118447930f41218bc732466b55442e5d83adf5`. Subsequent pytest/JSON-null fixes are not covered by this evidence.

Server: `fun-server` (`192.168.1.17`), container `bim-qvm-w2-debug`; tools image `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`; CPU quota 50000/100000 µs (0.5 CPU), memory 1610612736 bytes (1536 MiB). `/qualification` binds `/ssd1/bim-forge-qualification/qvm-20261025`; original `sources/w2` was mounted read-only at `/workspace`. Execution used the independent clone `sources/w2-debug`. Shared preview/database/model data was not accessed. The container was stopped after evidence collection.

Python 3.11 used `/qualification/python/bin/python`, with W2's pinned dependencies installed into `/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps` and exposed through `PYTHONPATH`. The shared venv was unchanged. That dependency set predates the follow-up pytest pins.

| Executed stage | Exit / outcome |
| --- | --- |
| `npm run validate` | 0; strict lint checked 117 TypeScript sources, root typecheck and policy validation passed |
| W2 strict project typecheck | 0 |
| Native TypeScript tests | 0; 3 passed |
| Python checks, including actual TS-generated schema boundary | 0; 7 passed |
| Native fixture generation | 0 |
| IFC preparation | 1; 85 observations, 65 passed / 20 failed |
| Property import / roundtrip / W0 coverage bundle | Not executed after failed prepare |

EX-02: 49 observations, 33 passed and 16 failed. All 16 released-schema cases failed to execute EXPRESS rules because `_pytest` was absent. The semantic checks (16), stable successive-export checks (8), candidate parity checks (8), and bounded-property detection check (1) passed. EX-08: 36 observations, 32 passed and 4 failed. All real-kernel checks (16) and coordinate checks (16) passed; exact-hash comparisons failed on non-JSON STEP sentinels for absent root names. These are observed harness failures; validators and tolerances were not weakened.

`combined-core-observations.json` is the actual failed run array. `environment.json`, `server-artifact-manifest.json` and `logs/` are copied raw from the server. The manifest hashes artifact paths relative to the retained server run root below; those IFC/snapshot/mesh files are not all vendored here. `logs/commands.sh` records the complete planned command sequence, but `logs/status.tsv` is authoritative about which stages actually executed. There is no finished-at marker because the harness stopped at prepare failure.

Retained server evidence:

- `/ssd1/bim-forge-qualification/qvm-20261025/w2-runs/w2-debug-378c0ad-attempt2/`: first repair's validation log, unit import failure and isolated dependency install logs.
- `/ssd1/bim-forge-qualification/qvm-20261025/w2-runs/w2-debug-378c0ad-ifc-attempt1/`: failed Draft 2020-12 validation of actual Draft 7 TypeBox tuples; source `378c0ad62fca8abe59df15b74e95d1d715477d3b`.
- `/ssd1/bim-forge-qualification/qvm-20261025/w2-runs/w2-debug-378c0ad-ifc-attempt1-logs/`: commands/status for that attempt.
- `/ssd1/bim-forge-qualification/qvm-20261025/w2-runs/w2-debug-be6e71b-ifc-attempt2/`: raw IFC exports, input bytes, snapshots, real-kernel measurements, paired deltas and loss inventory for the run summarized here.
- `/ssd1/bim-forge-qualification/qvm-20261025/w2-runs/w2-debug-be6e71b-ifc-attempt2-logs/`: raw command logs/status for that run.

The coordinator-reported initial TypeScript failure was fixed with a schema-derived typed boundary parser, without casts or suppressions. The next source fixed the JSON Schema dialect mismatch. Follow-up code pins pytest's runtime dependency closure for EXPRESS rules, represents optional root names as JSON null, and adds a real IFC hash regression check. Those follow-up changes await a renewed debug lease and a fresh run ID. Retry failures were initially treated per stage; server execution is now stopped and escalated rather than continuing beyond the issue-level retry cap.

The bounded-property full-preservation case remains in the runner with its original expectation. Since roundtrip did not run here, this evidence does not invent its expected false observation. Controlled generated exports, a shared IfcOpenShell writer/kernel, narrow independent STEP parsing, a partial space boundary, synthetic survey values, no viewer and no Revit/vendor export coverage remain explicit limits.
