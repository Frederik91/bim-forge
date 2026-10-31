# Native Plan and live view integration — #256

Base: `d6f078d`, shared `codex/spatial-workspace-components`. Construction-model delta: **zero**. This integration changes read-only drawing, picking, view intent, and local UI reset timing. It does not change model schemas, the worker queue, acceptance, exports, or publication. Draft review only; no merge, readiness change, issue closure, provider call, or deployment.

## Plan and implementation

`demo/room-app.ts` now routes request, review, original and floor-overview Plan callers through #262 `createModelPlan` / `renderModelPlan` / `hitTestModelPlan`, with #252 `spatialTokens`. The old `drawPlan`, its manual projection, and its manual inverse writers are deleted in the same change. Native walls, opening swings, rooms/areas, stairs, slabs, roof projections and furniture/equipment/asset footprint proxies come from the actual selected snapshot and explicit native level. Existing geometry-request handles and location marking use the shared projection/inverse. Wheel zoom and Shift-drag pan update engineering bounds and rerender at actual stage width/height, preserving 13 px annotations.

Current and existing hit candidates retain project, design target, revision, entity and level. Existing geometry opens read-only properties against its comparison graph, without replacing the current selected native identity. Comparison ghosts include changed geometry only. Native Plan and Section limitations are explicit; linked IFC cuts remain unsupported, and Section is disabled until true source-derived cuts exist.

The live view controls consume #255 `ModelViewer.changeView`, capture/return pose, stop and explicit mouse-look APIs. Supported native projects begin Inside Walk on a position checked by `walkElevation` against their actual level/slab. Unsupported Walk shows a persistent explanation and Fly alternative. Inside returns with its saved motion/pose through Plan and Overview. Overview and Frame model remain explicit. Fly uses facing direction, Shift up and Ctrl down; Space does not ascend. Selecting an object or changing focus/level no longer calls `model.frame`. The existing viewer/canvas survives all shell switches.

`beginRequest` saves the old draft, clears old conversation/visual/source content, starts exactly one local draft and renders the cleared context before awaiting the accepted-model read. The same-project accepted refresh does not create another draft. Sending remains disabled while this read is busy. This removes a demonstrated interval where New chat still displayed the previous task's saved regions.

Read-only model entities: Wall, Door, Window, Space, Slab, Stair, Roof, Furniture, Equipment, AssetInstance; Level/AssetFamily supply context. No fixture or production construction entity is mutated by navigation or rendering.

## Evidence

| Journey | Observed result |
| --- | --- |
| Actual house, Inside → Plan → Overview → Inside | Real native slab Walk by default, WASD changes the actual eye, exact saved pose returns, selection and unsent text remain, identical canvas node survives. |
| Navigation inputs | Typing leaves eye unchanged; explicit mouse-look and Escape run; Fly Shift increases elevation; Space leaves it unchanged. |
| Actual saved native proposal | `RoomRepository` creates and imports a real 1100 mm proposal from a 900 mm accepted door. History selects its real revision hash. Plan shows `900 → 1100 mm`; current and existing Door DOM hits carry different real hashes; existing properties report 0.9 m; unchanged north wall has no ghost. Accepted snapshot remains 0.9 m. This drawing fixture changes width only; the separate #264/#270 centred-door acceptance fixture independently qualifies its width+offset delta. |
| Plan interaction and narrow layout | Actual wheel zoom changes pixels/metre while viewBox screen dimensions and 13 px text remain; Shift-drag changes project bounds. At 390 px, the SVG screen transform confirms 13 px rendered text, without page overflow. |
| Existing production markup | Rectangle, circle, line, polyline, undo/Escape, real submission, saved chat replay, zero accidental object IDs, attic elevation, unchanged accepted model and immediate New chat reference clearing pass. |
| Existing task/controller and review chrome | Independent attachments/drafts, follow-up in one task, delayed poll exclusion, offline decision disabling and Revise-to-composer behavior pass. |

Screenshots were visually inspected against the approved Inside-first study and shared drafting language. The actual native building is used; no study geometry or synthetic chat implementation is copied. #257 owns the later task figures and anchored conversation placement.

- [Desktop Inside](spatial-plan-integration-256/desktop-inside.png)
- [Desktop native Plan](spatial-plan-integration-256/desktop-plan.png)
- [390 px Plan](spatial-plan-integration-256/narrow-plan.png)
- [Actual 900 → 1100 mm comparison and existing properties](spatial-plan-integration-256/native-1100-comparison.png)

Validation output: `Strict TypeScript valid. 378 source file(s) checked.`; `tsc --noEmit` passed; demo and design-gallery builds passed. Targeted source/acceptance batch: **36 passed, 0 failed**. Combined browser batch: **9 passed, 0 failed**. Final pan/navigation cleanup rerun of the new integration plus existing markup: **2 passed, 0 failed**. No browser page errors in the new live journey.

```powershell
npm ci --ignore-scripts
npm run validate
npm run build:demo
npm run build:design-gallery
node --test demo/model-plan.test.ts demo/view-navigation.test.ts demo/spatial-tasks.test.ts demo/preview-build.test.ts demo/spatial-workspace-fixture.test.ts demo/spatial-workspace-journey.test.ts
node --test --test-concurrency=1 demo/spatial-plan-integration-browser.test.ts demo/spatial-markup-browser.test.ts demo/spatial-tasks-browser.test.ts demo/design-system-browser.test.ts demo/canvas-studio-browser.test.ts
```

The integration browser test writes fresh screenshots under `artifacts/plan-integration-256` or `PLAN_INTEGRATION_ARTIFACTS`. The reviewed captures above are committed separately.

## Attempts and remaining limits

The 2026-10-31 explicit session instruction permits continued attempts; validators remain intact. Initial compile diagnostics were corrected. Visual inspection caught shrinking text from the old SVG contain sizing; the viewport now follows the actual stage, and the browser assertion uses the screen transform. Browser harness reads were made against current DOM nodes during ResizeObserver replacement, and zoom is measured after actual stage layout. The existing markup assertion exposed the New chat ordering issue; app state was corrected instead of adding a wait to that assertion.

The floor-composer browser run progressed through PNG source preparation, proposal/review, explicit acceptance, baseline/alternative, and SQLite restart, then failed at phone PDF upload readiness (`demo/floor-plan-guide-browser.test.ts:170`). Its existing production PDF preparation intentionally executes `/usr/bin/prlimit` and `/usr/bin/pdfinfo|pdftotext|pdftoppm`, unavailable on this Windows host. No test or validator was skipped or weakened to hide that failure. Full PDF qualification and the full platform-dependent suite remain Linux prerequisites for the combined lane.

Impeccable's detector was run once on changed UI targets. Its whole-HTML scan reported inherited legacy index styles (contrast, decorative shadows and hidden kickers); those unrelated templates were not redesigned. Shared-token contrast/gallery checks pass. Human visual acceptance and combined #257/#258 qualification remain outstanding. No connected-provider accuracy claim is made.

## #257 handoff

Exports from `demo/room-app.ts`:

| Adapter | Contract |
| --- | --- |
| `getWorkspaceViewIntent(): ViewIntent` | Copy of the shell intent; navigation remains owned by ModelViewer/#255. |
| `changeWorkspaceView(intent): void` | Explicit view action, cancels active geometry/location/pan input; rejects unsupported Section truthfully. |
| `captureWorkspaceInsidePose(): InsidePose \| null` | Current Inside pose only, with project/source/level pins. |
| `returnWorkspaceToPose(pose): boolean` | Explicit return through existing navigation compatibility checks; false means unsupported/stale context. |
| `getWorkspacePlanContext(svg): ModelPlan \| null` | Actual source/level/projection/inverse and qualified hit context for a currently mounted Plan root. |

Model stage hosts remain `proposal-drawing`, `review-drawing`, and the existing `changes-drawing` dialog host. One viewer moves between them. View IDs: `view-inside`, `view-fly`, `view-plan`, `view-3d` (Overview); review IDs: `review-view-inside`, `review-view-fly`, `review-plan`, `review-3d`. Explicit look: `mouse-look`, `review-mouse-look`. Unsupported-entry notices: `navigation-notice`, `review-navigation-notice`. `workspace-shell[data-spatial-view]` reports inside/plan/overview.

Bind later task origin exactly once to the stable local draft identity. New chat clears previous overlays before its accepted read; while busy, defer any source-dependent submission. The accepted refresh does not call startTask again. If a captured source changes, expose recovery/rebinding explicitly rather than rewriting the historical origin. Opening a figure/list task must not call Frame model or imply acceptance. Existing authoring/composer tools, baselines, alternatives, retained evidence and linked imports remain under their current owners.
