# Babylon optimization work plan — issue #192

Authorized scope: benchmark-only Babylon optimization and focused visual review
evidence, building on draft PR #214 at `dbe817f`. Accepted production model delta
is zero. West Riverside remains a local, unqualified dataset: rights, area,
source conversion and coordination gaps from the initial report still apply.

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
