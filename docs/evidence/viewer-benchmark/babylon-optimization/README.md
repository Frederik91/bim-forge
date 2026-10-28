# Babylon optimization work plan — issue #192

Authorized scope: benchmark-only Babylon optimization and focused visual review
evidence, building on draft PR #214 at `dbe817f`. Accepted production model delta
is zero. West Riverside remains a local, unqualified dataset: rights, physical
project identity, area, source conversion and coordination gaps from the
[initial report](../west-riverside-initial/README.md) still apply.

## Implementation and acceptance (frozen before coding)

- Keep `adapters/babylon.ts` unchanged as the baseline. Add an experimental
  spatial/material batch adapter with stable per-element identities, per-face
  picking, bounded batch rebuilds and explicit resource counters.
- Extend `browser.ts`, `metrics.ts`, `runner.ts` and `runner-candidate.ts` to
  select the optimized variant, split validation/diff/apply/readback timings,
  and capture deterministic close-ups of moves, additions, removals, comparison
  and discard. Keep the existing Fragments path available.
- Add deterministic behavior tests for bounds, identity, selection, filtering,
  clipping, incremental resource preservation, geometry changes and disposal.
  No model/schema/production viewer files change.
- Correctness first: unchanged input SHA, all seven discipline counts, all source
  triangles and IDs, unchanged accepted revision, exact discard restoration,
  zero page errors and zero invalid WebGL warnings. Validate focused images by
  actual pixels and inspect them locally. Model images remain private.
- Optimization target: at least 50% fewer overview draw calls than the baseline.
  Bounded updates rebuild only touched batches; retain untouched resources and
  count the actual uploaded geometry. Report unmet targets without moving them.
- Profile separately, then run five independent, interleaved full executions per
  Babylon variant. Preserve failed runs and report median/range, actual renderer
  work versus end-to-end review cost, and environmental limits. This is neither
  a laptop qualification nor an engine adoption verdict.
- Run `npm run validate`, `npm run test:viewer-benchmark` and the new adapter tests
  before publishing a dependent draft PR. Human review controls adoption.

## Run ledger

- 2026-10-28: inspected #192, open draft #214 and policy; created dedicated
  `codex/issue-192-babylon-optimization` worktree from `dbe817f`; froze this plan
  and issue acceptance checks before implementation.
- Implemented 20 m spatial/material groups, capped at 128 parts and 100,000
  vertices per batch (a single oversized part remains intact). Batch-local origins
  retain coordinate precision; face ranges retain picking identities. Hidden
  elements retain vertices/readback identity, but contribute no draw indices.
  Selected parts move into a separate material batch. Metadata updates retain all
  buffers; geometry/position/color changes rebuild only source/destination
  batches. This expands repeated geometry into batch buffers: memory qualification
  remains open. Materials are the existing opaque, unlit engineering profile.
- Smoke and deterministic tests passed. CPU-profiled full diagnostic
  `profile-batched-001` completed with zero recorded errors and all source parts/
  triangles. Close-up move/add/remove pixel checks passed; local inspection shows
  previous/proposed positions and comparison colors, with exact discard recovery.
  Profiling overlaps small validation tasks; these timings are diagnostic only.
- Root validation passed; benchmark suite: 30 pass, one optional browser skip.
  The optional browser watchdog test was also executed explicitly with Chrome
  and passed. Its first launch using absent bundled Chromium failed; selecting
  the installed Chrome channel resolved the environment dependency.
- Freeze implementation before repeated runs. Five fresh browser processes per
  variant, in A/B, B/A, A/B, B/A, A/B pair order. No tracing/profiling in those
  runs. A is the unchanged `BabylonAdapter`, not the production application.
  B is `BatchedBabylonAdapter`; all seven disciplines remain loaded.

## Repeated local results (2026-10-28)

**Verdict:** bounded Babylon batching meets the frozen draw-call reduction target
and improves measured renderer work in this local configuration. It does not
qualify the production application or establish an engine winner. Full overview
pixel equivalence remains open, and the neutral benchmark proposal path remains
slow. All ten candidate lifecycles completed; zero recorded browser errors,
WebGL warnings or stderr output. Each session used all seven disciplines.

Measured implementation: `0dbaf6183db5e52ded175516263ea8c9243a535a`. All repetitions started from a clean
checkout, without tracing or CPU profiling. Source file hashes in
[aggregate.json](aggregate.json) bind every run to that implementation. The
unchanged `BabylonAdapter` is A; `BatchedBabylonAdapter` is B. A is an
experimental application baseline, not the production viewer. Neither adapter
changes accepted production model data.

Five fresh Chrome processes per configuration, in A/B, B/A, A/B, B/A, A/B order.
Chrome 155.0.8059.80, Windows, AMD Ryzen 7 7700X (16 logical CPUs),
RTX 4080 SUPER via ANGLE/D3D11, 64 GB workstation, default browser heap and a
12 GB Node heap ceiling. Viewport/DPR, input, cameras, clipping and the opaque
unlit material profile are matched. Delivery is loopback, unshaped and no-store;
OS/driver caches were not flushed. This is a shared workstation, not an exclusive
measurement host or the required 16 GB integrated-GPU laptop.

Overview draw calls: **97,590 → 1,676
(98.28% fewer)** in every repetition. Both initial
overviews report 15,334,885 rendered triangles and 97,590 element records. The
canonical input SHA is
`99ca530d28d01f8a906af7b2ebb3cfa020af62226968c937fa3fcd4dbdd96a30`.

Timings below are milliseconds: median of five sessions (minimum–maximum).

| Observation | A: unchanged adapter | B: bounded batches |
| --- | ---: | ---: |
| Adapter load + initial camera | 5064.9 (4771.0–6637.0) | 851.6 (794.2–950.8) |
| Select + frame | 531.6 (444.4–584.4) | 18.0 (16.8–26.0) |
| Hide all + restore | 530.9 (464.7–641.0) | 1018.8 (968.4–1221.4) |
| Enter comparison, complete checked path | 1375.6 (1175.1–1383.4) | 795.9 (671.1–951.0) |
| 1,000-part proposal, complete checked path | 19497.3 (18513.7–20095.9) | 19584.3 (17321.2–22900.2) |
| 1,000-part proposal: validation only | 18357.9 (17630.5–18956.5) | 19076.7 (16898.3–22300.6) |
| 1,000-part proposal: renderer apply + frame | 521.8 (453.9–629.8) | 21.3 (17.0–26.0) |
| 1,000-part proposal: diff only | 174.3 (155.5–234.3) | 191.1 (125.2–198.9) |
| 1,000-part proposal: readback + oracle | 290.2 (250.5–345.5) | 314.6 (280.6–378.4) |
| Camera route, median of each session's 30 intervals | 371.6 (330.9–475.0) | 6.5 (6.0–10.9) |

Load excludes dataset delivery, JSON parsing, common model validation, module
loading and adapter construction. Renderer apply includes completion and the
following requestAnimationFrame, not a GPU presentation fence. Camera intervals
are not presented FPS. Five selection/update samples do not establish interaction
p95; per-session camera p95 stays null. Phase timings are disjoint; the exact
accepted-state immutability audit runs after each timed review operation.

Filtering is reported alongside the improvements: batching rebuilds index
buffers when membership visibility changes. B's 1,000-part move rebuilds 80
batches, retains 1,599 others, and uploads 186,951 vertices and 216,081 indices.
Resource counters describe the last mutating adapter call; readback, properties
and camera operations do not reset them. Do not sum these repeated counters
across samples. The deterministic tests verify untouched GPU buffer identity,
exact triangle coordinates/winding, stable picking IDs, hidden/clipped picking, scale/color/
spatial changes, metadata-only zero-upload behavior, repeated comparison/discard
and disposal. Batch expansion and memory/lifetime behavior still need full
primary-device and 100-cycle measurement; this is not a memory-capacity claim.

### Visible review evidence

Every session captures move/add/remove baseline, preview, comparison and discard
at deterministic close-up cameras. Each preview/comparison changes at least 100
pixels; every discard restores the baseline with zero differing pixels. Local
inspection shows old/new positions and addition/removal colors. These cases use
one source part in an isolated scope; they do not qualify full engineering edits,
host/opening dependencies or every discipline's representation fidelity.

Across the five paired sessions, all 12 focused images per pair are pixel-exact
between A and B (maximum difference 0 pixels). Whole overview images
remain different at 1822 / 1,025,280
pixels (0.178%). Fine geometry/edge
rasterization and draw ordering need further isolation. Counts and bounds alone
are not proof of pixel-identical engineering content. The discrepancy is retained;
no Fragments comparison or engine adoption verdict is drawn from these timings.

Model images, source data, traces and CPU profiles remain in ignored local storage.
The public aggregate contains metrics, inventory, source bindings and artifact/
pixel hashes, without model meshes or image content. It retains the raw session
samples, execution order, resource counters and failures/limitations.

### What limits the proposal path

A separate CPU-profiled diagnostic is excluded from repeated timing statistics.
About 82.9% of its weighted sampling interval is inside `CheckSchema`;
`applyProposal` reparses the complete shared tessellation for element-only
changes. The benchmark's neutral validation work dominates its complete proposal
latency. This is a harness finding, not a measurement of the production validator
or evidence that any required check should be removed. The profiled run overlaps
small development checks and is diagnostic only; manifest/source and profile
hashes are retained in the aggregate.

Next: measure prevalidated delta arrival separately from full admission while
retaining the full validation/audit coverage, then test the batching strategy
against actual production viewer/proposal contracts. Preserve accepted state
outside the renderer. Repeated memory/device qualification, matched full-scene
fidelity and a rights-cleared verified 200k+ m² dataset remain open in #192.

### Reproduction

Use the existing West Riverside conversion from the initial report. Obtain local
use authorization and the exact seven-source manifest first. Choose a new output
root: the runner refuses to overwrite evidence directories.

```powershell
$taskDataset = 'D:/Codex/issue-192/west-riverside/artifacts/private/west-riverside/prepared-v2/model.json'
$taskRoot = 'artifacts/private/babylon-optimization/new-repetition-set'
$env:TEMP = 'D:/Codex/temp'; $env:TMP = 'D:/Codex/temp'
for ($taskPair = 1; $taskPair -le 5; $taskPair++) {
  $taskOrder = if ($taskPair % 2 -eq 1) { @('babylon','babylon-batched') } else { @('babylon-batched','babylon') }
  foreach ($taskCandidate in $taskOrder) {
    node --max-old-space-size=12288 benchmarks/viewer/runner.ts --candidate $taskCandidate --dataset $taskDataset --channel chrome --cycles 1 --timeout-ms 600000 --no-trace --output "$taskRoot/pair-$taskPair-$taskCandidate"
    if ($LASTEXITCODE -ne 0) { throw 'Retained failed benchmark; inspect evidence before continuing' }
  }
}
```

For a separate diagnostic, add `--profile` and use a new directory. Omit
`--no-trace` only when collecting a diagnostic trace. Native Fragments remains
available through the existing `--candidate fragments --fragments PATH.frag`
path, with its existing manifest/hash admission. This follow-up measures A/B only.

Root validation and benchmark tests passed before the implementation commit:
30 pass, one optional browser skip; the optional browser watchdog test passed
separately with installed Chrome. Final publication validation and an additional
Fragments smoke are recorded below after evidence collection.

Final publication: root lint/typecheck/policy passed (266 TypeScript files; all
12 changed paths checked). Benchmark suite passed 30 tests with one optional
browser skip; the browser watchdog passed separately with Chrome. Both raw-edit
and native preprocessed Fragments two-cycle smoke runs passed, including all
focused pixel checks, with zero recorded errors or stderr. These are synthetic
compatibility checks, excluded from the West Riverside timing statistics.
Validation output tails, hashes and smoke source bindings are in the aggregate.
Accepted production model delta remains zero. #192 remains open.
