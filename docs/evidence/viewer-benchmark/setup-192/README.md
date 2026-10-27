# Viewer benchmark setup evidence

Issue #192. One bounded implementation attempt on dedicated branch
`codex/issue-192-viewer-benchmark`. Tested implementation commit:
`91346cd0434982ec72bf473161db10240338feee`. The evidence commit adds reports only.
Input and source hashes are in [run.json](run.json).

## Completed checks

| Check | Result |
| --- | --- |
| `npm run validate` | Passed. Lint scans the new benchmark directory and root typecheck includes its sources. See [output](validate.txt). |
| `node --test benchmarks/viewer/contract.test.ts demo/model-scene.test.ts` | 29 passed, zero failures. Includes eight new benchmark tests. See [output](benchmark-and-scene-tests.txt). |
| Real Chrome Babylon replay | Completed 100 proposal/compare/discard cycles, geometry bounds/identity checks, selection/properties, picking, filtering, sectioning, and stale rejection. Zero page errors. |
| Real Chrome Fragments replay | Same checks and 100 cycles completed. Zero page errors. |
| Browser launch failure | A deliberately unavailable browser channel returns exit code 1 and retains failed/unqualified completion plus an error file. See [output](launch-failure.txt). |

The browser command was:

```sh
npm run benchmark:viewer -- --channel chrome --cycles 100 --timeout-ms 600000 --output artifacts/private/viewer-benchmark/setup-192-final
```

The source tree was clean at run start. The synthetic fixture contains 24
elements. Chrome 155.0.8059.80 used the NVIDIA RTX 4080 SUPER hardware renderer.
This is workstation setup verification, not the specified laptop qualification.
Other correctness work ran on the host during the replay. There was no exclusive
performance lease, resource instrumentation, network shaping, or memory test.

Raw measurements are in [babylon.json](babylon.json) and
[fragments.json](fragments.json). Both report `qualified: false` and enumerate
missing coverage. The replay covers bounded sizes 1 and 10. Sizes 100 and 1,000
are explicitly not run because this fixture is too small. No engine speedup,
memory-retention result, or performance winner is claimed.

Baseline/comparison screenshots and review readback are committed beside this
file. `artifact-hashes.json` binds published artifacts and the local-only
Playwright traces. The traces remain in the ignored local run directory and are
not downloadable from this PR. Screenshots were visually inspected for the
moved element, previous geometry, addition, removal, and stable selection.

## Repository test limitation

`npm test` did not complete successfully on this Windows host. It encountered
SQLite/temp cleanup failures and the remaining run was stopped. No validator or
test was disabled.

A focused run of the eight benchmark tests, 21 existing scene tests, and ten
proposal-reconciliation tests finished with **37 passed and 2 failed**. Both
failures are existing proposal test cleanup hooks returning `EPERM` from
`rmSync` on temporary SQLite directories. See [current output](focused-tests.txt).

Running the proposal file alone in an untouched detached worktree at base commit
`71e54b2` produced the same **8 passed and 2 failed** result and the same named
cleanup failures. See [baseline output](baseline-proposal-tests.txt). An
additional existing source-store test was reproduced before/after with `EBUSY`
when unlinking a SQLite file. These failures need a supported-platform regression
run or a separate cleanup fix. This PR does not claim a green full test suite.

## Integration observations

Early smoke runs caught incorrect picking/filtering of Fragments delta models,
deletion of shared material/geometry records, and an invalid bounds oracle on an
empty editable base model. Those runs remain under the ignored development run
directories. The corrected run checks actual runtime geometry. Selection
screenshots also caught a missing Babylon highlight and verified its correction.

## Dataset status and review

Real 200,000+ m² project: **not supplied and not qualified**. See the
[acquisition checklist](../../../../benchmarks/viewer/dataset-requirements.md).
The hospital database workload does not fill this gap. All real-project targets
and the engine adoption decision remain open in #192.

Model delta: zero production changes. Human review is required for benchmark
geometry representation, result interpretation, and any later engine adoption.
No production deployment, source-model conversion, or merge occurred.
