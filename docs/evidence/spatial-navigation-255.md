# Spatial navigation #255 work-in-progress evidence

## Status

This draft is not ready to merge. Navigation checks pass, but the existing production markup browser test failed three attempts. Work stopped on that item under AGENTS.md. The parent requested a reviewable WIP commit and draft PR. No merge, readiness change, deployment, provider call or production model edit occurred.

## Plan and implemented scope

- Add `demo/view-navigation.ts` for camera sessions, source-pinned eye poses and stoppable input.
- Reuse one engine and canvas. `ModelScene.camera` remains the Overview orbit camera. `activeCamera` selects that camera or one reusable perspective Inside camera.
- Move camera-dependent motion detection, native picking, surface rays, markup and FXAA to the active camera.
- Keep room-app, global tokens, task transport, Plan drawing, graphics and model schemas outside this change.
- Verify with real Babylon scenes, real Chromium input, existing scene/batching tests and the production markup flow.

The construction-model delta is zero. Navigation tests compare the native snapshot bytes before and after repeated view changes. No authoring API is called.

## Public integration methods

`ModelViewer` exports these methods and state:

- `changeView(intent): NavigationResult`
- `captureInsidePose(): InsidePose | null`
- `returnToPose(pose): NavigationResult`
- `stopNavigation(): void`
- `activateMouseLook(): Promise<'locked' | 'drag' | 'unavailable'>`
- `navigationState: ViewSession`

`ViewIntent` is `{ kind: 'overview' | 'plan' | 'section' }` or `{ kind: 'inside', motion: 'walk' | 'fly', entry?: [x,y,z] }`. Points use project X-east, Y-north, Z-elevation metres. Initial Inside entry requires an explicit point. Later entry can restore the matching saved pose.

`InsidePose` carries `kind`, `projectId`, `sourcePin`, `levelId`, `eye`, `forward`, `up` and `motion`. Capture produces independent values. Return rejects project, source or level mismatch and invalid orientation. Caller-owned `ViewerState.navigationPin` should identify the actual revision and linked source context. The compatibility fallback is exact snapshot serialization on `show`, never per render frame. Pose state belongs to this viewer/tab and survives Plan and Overview without persistent/shared storage.

Plan intent preserves the Inside pose and stops navigation. The shell adapter still owns hiding the canvas and displaying Plan. Section returns an explicit unsupported result and does not simulate a cut plane. Task transitions must call `stopNavigation`; opening a task must not call `returnToPose` implicitly. Shell controls and persisted task-view adaptation belong to #256/#257.

## Qualified navigation behavior

Chromium drives the real ModelViewer and asserts facing-relative WASD, pitched-gaze Fly, Shift ascent, Ctrl descent, no Space ascent, and Escape stopping held and repeat keys. It checks composer typing, modal isolation, blur, hidden-document notification, pointer cancellation, repeated Plan/Overview return, pointer lock when granted, denied-lock drag fallback, source rejection and disposal. The same test walks a real native slab at 1.6 m and stops before a wall; Shift does not lift Walk.

Native Walk requires an explicit level and actual Slab solids from `slabPieces`. Clearance excludes slab edges, stair voids, all stairs, walls and conservative furniture/equipment footprints. AssetInstance-bearing levels are unsupported. Basement, ground and attic elevation checks pass. Floors inferred from bounding boxes, rendered room proxies and linked IFC meshes cannot qualify entry. Door crossing, stair traversal and exact collision are unqualified. Fly remains a separate unconstrained motion mode and does not claim those guarantees.

## Passing checks

- `npm ci --ignore-scripts`: 203 packages installed, audit reported zero vulnerabilities.
- `npm run validate`: lint, TypeScript and policy validation passed on the current source.
- `npm run build:demo`: passed.
- `node --test demo/view-navigation.test.ts demo/view-navigation-browser.test.ts`: 3 passed, 0 failed.
- Expanded browser check after hidden/modal/Walk assertions: 1 passed, 0 failed.
- Existing `demo/model-scene.test.ts` and `demo/model-scene-batches.test.ts`: all 36 tests passed. They cover comparison, linked-independent native framing, batching, selection, floor rays, cutaway and disposal.
- `git diff --check`: passed.

The new scene tests assert active-perspective native picks, preserved forward/up orientation, explicit return, mismatched source/project/level rejection, one scene/two retained cameras, unchanged meshes and unchanged model bytes. These passing tests do not establish that the blocked production markup flow works.

## Markup attempt ledger and escalation

The existing test and its assertions were not edited. Each attempt rebuilt the production bundle where source changed. No validator was weakened.

| Attempt | Result | Evidence and action |
| --- | --- | --- |
| 1 | Timeout at `demo/spatial-markup-browser.test.ts:68:34` after first Rectangle, waiting for count 1 | Shared navigation stop ran on ordinary inactive pointer/focus events and cleared markup. Narrowed the navigation listener conditions before the next attempt. |
| 2 | Timeout at `demo/spatial-markup-browser.test.ts:85:91` after Finish polyline, waiting for count 3 | Rectangle, Circle, Line, Undo and Escape progressed. Narrowed focus-stop behavior to active navigation input. |
| 3 | Same timeout at line 85 after Finish polyline | Stopped further markup fixes and retries. Parent notified and requested this WIP draft. Cause remains unproven; instrument the actual gesture/tool and toolbar path before another fix. |

Latest exact failure:

```text
page.waitForFunction: Timeout 15000ms exceeded.
  at count (demo/spatial-markup-browser.test.ts:60:58)
  at TestContext.<anonymous> (demo/spatial-markup-browser.test.ts:85:91)
tests 1; pass 0; fail 1
```

Local browser evidence directories, in attempt order:

1. `C:/Users/Frederik Tegnander/AppData/Local/Temp/markup-browser-KXEQ5C`
2. `C:/Users/Frederik Tegnander/AppData/Local/Temp/markup-browser-rqSBe3`
3. `C:/Users/Frederik Tegnander/AppData/Local/Temp/markup-browser-dX0bBu`

The latest directory retains `rectangle.png`, `browser-errors.json` and the disposable queue database. The latest browser-errors file is `[]`. No completed final screenshot or Playwright trace was produced by the existing test. Tool execution session IDs were 35906, 89996 and 2040. Local summarized logs and current validation output are under `C:/Users/Frederik Tegnander/AppData/Local/Temp/navigation-255-evidence`.

## Unavailable linked-model qualification

The combined regression invocation also included `demo/linked-workspace-browser.test.ts`. It failed immediately at line 12 because `IFC_EXTERNAL_SPOOL` and `IFC_FIXTURE` were unset. The application/converter flow did not run. No retry or converter setup was attempted. Real linked-mesh picking and FXAA resource behavior across Inside transitions still need combined browser evidence; existing native scene tests cannot certify these.

## Decision and next work

Keep this PR in draft. A scoped renewed attempt must diagnose the polyline failure without changing the expected markup behavior. Then rerun the unchanged production markup suite and the navigation tests. Combined integration must provide actual IFC converter prerequisites and qualify linked picking, comparison, antialiasing, framing and shell/task transitions. Human review retains readiness and merge authority.
