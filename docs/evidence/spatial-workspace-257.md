# Live spatial workspace — #257

## Change review

The existing native model remains present while an engineer starts or reopens a spatial conversation. A real hovering 3D agent represents the durable task at its captured origin. Picking its body opens the existing conversation and highlights exact source-bound targets without moving the eye. Two tasks at one point open a chooser. The original chat/composer is mounted once as a short, expandable overlay; closing it does not cancel work. Tasks remain accessible from a compact list, including unplaced and offscreen conversations.

Construction-model delta outside disposable fixtures: **zero**. This change adds no storage schema, worker queue, model-edit API, acceptance authority, provider call or deployment configuration. Human review controls readiness and merge.

## Plan and owning files

- `room-app.ts`: capture one pinned origin per stable existing draft, bind object/region targets separately, reconcile the confirmed ticket, retain drafts/attachments and source context, preserve exact existing proposal inspection/decision controls.
- `spatial-tasks.ts`: parse placement and recovery DTOs through their schemas; expose server placement resolution beside existing readonly state. Preserve the existing sequence and causal response ordering.
- `model-viewer.ts` / `model-scene.ts`: borrow the existing Scene/engine, route agent ray picks separately, project anchors in the existing render loop, exclude agents from construction membership, and retain compatible Inside poses.
- `spatial-task-layer.ts`: add the actual torso projection beside the label anchor. No graphics, origin, worker or camera authority changes.
- `spatial-workspace-presentation.ts` / `canvas-studio.css`: one floating chat mount, measured/clamped labels, same-place chooser, truthful task list, explicit Return and draft-context refresh.
- `spatial-workspace-browser.test.ts`: shipped UI and real native worker journey, plus actual batched ModelScene construction/pick/frame/export qualification.

Read-only native context includes Wall, Door, Window, Space, Slab, Stair, Roof, Furniture, Equipment, AssetInstance and Level. No task mesh becomes a native entity. Requests contain explicit visual IDs or the selected native object; browsing floor/room context is not automatically added as an object target. Region-only requests submit zero implicit native IDs.

## Behavior and provenance

Inside captures a point in air in the current facing direction; selection supplies independent targets. Native Plan uses its qualified inverse at the visible plan centre. Overview without a trustworthy point remains unplaced. An existing origin never follows later selections or movement. Source changes under an unsent draft require explicit **Refresh draft context**, which retains the point, text and attachments.

Native highlights require project, target and revision equality and a present entity. Original regions also require their exact saved source. Server current/stale/missing/unavailable resolution is read on open. A missing source does not become a nearby current object with the same bare ID. Linked references and their retained evidence remain under their existing owners; new linked-source browser qualification belongs to #258.

Compatible native proposal/current snapshot changes retain the actual Inside eye, forward, up and motion. If a source/level or supported Walk position is incompatible, the workspace exposes an Overview fallback and explanation. **Return to task** is the explicit task action that navigates: local unsent creation pose when available, otherwise the saved point in Overview. Durable placement has no server-saved eye pose, so a restarted task does not claim one.

Only server states are shown: queued, working, needs-input, ready, completed (Accepted), failed, rejected and cancelled. Connection freshness is separate. No voice, team presence, privacy audience or provider-cleanup state is invented.

## Before / after evidence

| Check | Observed result |
| --- | --- |
| Actual agent body | The browser clicks `bodyX/bodyY`, and asserts the viewer's actual ray result is `task`; opening preserves eye, forward, up, project, level and motion. A displayed proposal can truthfully change the source pin. |
| Same point / separate histories | Two independent UI submissions retain identical original points and different ticket IDs. An actual body hit opens the two-ID chooser, then the first durable conversation. Selection does not move the camera. |
| Actual proposal and explicit acceptance | #264 offline worker executes the real ScriptBox WASM host. Accepted 900 mm door remains unchanged until an explicit existing decision. The 1100 mm result is compared against the independent full-snapshot oracle: one Door width and its hosted-by offset change, preserving the centre. |
| Revision and proposal review | Revise focuses the original retained composer without accepting. Existing Canvas Studio checks retain exact proposal controls, offline decision exclusion, Sources & checks and explicit acceptance. |
| Reload and unplaced | Original placement/targets survive acceptance and reload. Server resolution reports historical pins. A legacy request without placement is list-accessible, creates no label/figure, and disables Return. |
| Explicit Return | The saved task point opens in Overview only after the explicit action. |
| Attachments, drafts and late results | Existing controller browser journey retains independent task/project drafts and attachments, identical uncertain-ack replay, continuation in one task and delayed-poll exclusion. |
| Region context | Existing production markup journey passes through actual submission and saved replay, native attic elevation, no accidental door target, and immediate new-chat reference clearing. |
| Real batched scene | An authored native fixture with 48 additional validated equipment objects activates the shipped batching path. Its actual wall occludes a task. Task meshes do not enter construction picks, framing bounds or scene serialization; a task far outside the building does not expand model framing. |
| Responsive presentation | Desktop 1440×1000 and phone 390×900 / 320×900 captures inspected directly. No horizontal document overflow. Short conversation is 44% of the phone stage, expandable to 88%; model and composer remain available. Labels wrap/clamp inside an 8 px stage inset while body projections remain unchanged. |

Screenshots: [Desktop](spatial-workspace-257/desktop.png), [390 px](spatial-workspace-257/narrow-390.png), [320 px](spatial-workspace-257/narrow-320.png).

## Validation

- `npm ci --ignore-scripts`: passed; 0 dependency vulnerabilities reported.
- `npm run validate`: passed — `Strict TypeScript valid. 381 source file(s) checked.` Typecheck and policy passed.
- `npm run build:demo`: passed.
- Controller, task-layer, ModelScene, navigation and #264 fixture/queue source batch: **71 passed, 0 failed/skipped**.
- Existing Canvas Studio (including offline and Revise subtests), controller, markup and Plan browser journeys passed. The combined run also passed the new native live journey; its later new batching proof initially rejected the oversized test fixture as recorded below.
- Final `node --test --test-concurrency=1 demo/spatial-workspace-browser.test.ts demo/model-scene-batches.test.ts`: **10 passed, 0 failed/skipped**. This includes the expanded native body/chooser/accept/reload/Return/unplaced journey and the real batched occlusion/export proof.
- `node --test demo/preview-build.test.ts`: **2 passed, 0 failed/skipped**; hashed browser release and runtime packaging remain valid.
- Impeccable detector over changed UI targets: `[]`. No validator or acceptance assertion was disabled.

Replay source batch:

```powershell
node --test demo/spatial-tasks.test.ts demo/spatial-task-layer.test.ts demo/model-scene.test.ts demo/view-navigation.test.ts demo/spatial-workspace-fixture.test.ts demo/spatial-workspace-journey.test.ts
node --test --test-concurrency=1 demo/spatial-workspace-browser.test.ts demo/spatial-plan-integration-browser.test.ts demo/spatial-tasks-browser.test.ts demo/spatial-markup-browser.test.ts demo/canvas-studio-browser.test.ts
```

## Run ledger and corrections

1. 2026-10-31: checked AGENTS, policy, live issue #257 (no pause label), STATE paused false, contracts, DESIGN.md and owning component evidence. Exclusive isolated branch from `a008d802`. Maintainer renewed execution with “Continue with as many attempts as you need”; failures remain visible here.
2. Initial strict check rejected nullable project ID passed to the nonnullable graphics API. Corrected the empty-layer sentinel; validation/build then passed.
3. Browser regression exposed compact-panel flex shrink, toolbar overlap, a Tasks button blocking markup, and working bob moving conversation controls. Fixed panel sizing, moved Tasks into the model header and held panel placement stable during input. Existing controller, markup and Canvas Studio assertions pass unchanged.
4. Immediate projection observation exposed a transient cleared origin under an unchanged draft identity. The fixed-origin graphics guard correctly rejected it. Projection updates now coalesce after the synchronous draft transition; the origin guard remains intact.
5. Initial browser fixture used a hidden legacy selection control; switched to the shipped visible 3D picker. A full-pose assertion also included the source pin while the real proposal changed the displayed source. The corrected assertion checks every camera-pose field independently of source provenance.
6. Stronger same-place proof exposed that label anchors project above the head. Reopening a chat alone was insufficient evidence of a body pick. Added separate actual torso coordinates, required actual `task` ray results, and qualified the real two-task chooser. Preserve chooser identities across projection refreshes; collapse coincident labels into one chooser label.
7. Direct phone inspection caught inherited high-specificity split-row rules still shrinking the model. Replaced the spatial shell layout with one stage, retained a bounded short conversation and inspected both widths. No overflow check was weakened.
8. A final provenance refinement found the schema's unbranded target ID at the existing branded design-key boundary. Parsed it through the owning target parser; final strict validation passes.
9. Added a real batching proof. The original small native fixture did not activate batching; additions of 128 and 64 equipment objects correctly failed the existing 100-entity model bound. A validated 48-object addition activates batching within the bound. All occlusion/picking/framing/serialization assertions pass without changing the validator.

## Remaining #258 gates and local handoff

This is deterministic native/offline-worker qualification. It does not establish connected-provider interpretation accuracy or the final linked-IFC source/occurrence journey. Human visual acceptance and the combined local-release qualification remain #258 work. The parent lane already records Linux-only PDF preparation/socket prerequisites; this change does not weaken those checks or change source preparation.

The existing `createDemoServer` and demo build remain the local-server seams. Browser tests run that real server on an ephemeral local port with a disposable SQLite queue and `spatialFixtureWorker`. Production deployment, provider connection, ready flags, merges and issue closure were not performed here.


## Parent change-review repair

Runtime repair: `e4c56e970d791df6d7d26af47e5f1972f84ef594`, following `14117e3`. The parent requested a presentation repair after reviewing the captures, and independently observed an incidental floor ID in the provider-lane payload. No server, queue, review authority or provider behavior changes were made.

The DOM diagnosis found two competing scroll boundaries: a 508 px outer content area contained a 521 px min-content editor, while the transcript independently scrolled in a fixed 220 px viewport. The repair reserves non-shrinking header/navigation space and makes the transcript the dedicated conversation scrollport. The composer is bounded separately. The repaired outer content and editor both measure 455 px with zero outer overflow; the transcript starts exactly below the 51 px Chats navigation. The old bottom Assistant toggle remains in the existing controller seam but is hidden on phones, leaving one visible Assistant rail entry.

The focused live test now opens Sources & checks and returns through Revise before inspecting the actual proposal controls. Each action is deliberately scrolled into the transcript viewport and checked for complete bounds and a real centre pointer hit. Transcript scrolling must leave the fixed navigation bounds unchanged. This preserves usable scrolling instead of requiring every proposal action to fit simultaneously in a compact conversation. Phone checks require the primary Assistant entry to remain visible and the redundant toggle to be hidden. Fresh desktop, 390 px and 320 px captures above were inspected after repair. Compact phone presentation prioritizes fixed navigation and composer; Expand conversation provides more transcript room.

The request adapter also previously added browsing level/room IDs for ordinary object requests. It now keeps only explicit visual IDs or the selected native object. A deliberately selected Level still remains a valid object selection. The actual HTTP request and persisted placement are both asserted to contain exactly `[level-ground-door-inner]` in the door journey. Region-only behavior remains unchanged. The existing view/origin level metadata retains browsing context.

The gold wall in the door-only capture is derived comparison geometry, not a broader object target. Executing `modelChanges(base, independentExpected)` returns exactly the Door with reason `object` and its inner host Wall with reason `placement`. The viewer paints modified geometry gold and selection outlines blue. The independent accepted-model oracle still changes only Door width and the existing hosted-by offset.

Repair verification:

- `npm run validate`: passed, 381 source files; demo build passed.
- Focused actual browser/batched-source journey: **2 passed, 0 failed/skipped**, including exact door-only HTTP/placement IDs, body hit, same-place chooser, acceptance/reload, unplaced fallback and the new scroll-boundary/action-hit checks.
- `node --test --test-concurrency=1 demo/canvas-studio-browser.test.ts demo/spatial-tasks-browser.test.ts demo/spatial-markup-browser.test.ts demo/spatial-plan-integration-browser.test.ts`: **6 passed, 0 failed/skipped**. Existing assertions were preserved.
- Changed CSS detector: `[]`; whitespace check passed.

Repair attempt notes: the initial diagnostic run encountered the existing guarded “workspace changed while this response arrived” path while a worker result arrived; the unchanged rerun completed. An intentionally stricter first layout assertion required all actions to fit simultaneously and failed because the last row legitimately crossed the dedicated scrollport bottom by 17 px. The parent clarified that usable scrolling was required. The final test proves every action is reachable, fully visible and hittable after deliberate transcript scrolling, with no header overlap. No queue or causal guard was weakened.

The final evidence-only follow-up changes this document and the three captures. Runtime qualification can pin `e4c56e9`; the parent owns the final combined server/provider/release SHA and deployment.


## Final combined-lane boundary repairs

Linux qualification at parent `df0e094` exposed two boundaries that the narrower shipped journey did not exercise. The isolated #257 worktree merged that parent before repair. Neither failing fixture nor its assertions changed.

First, generic selectors in the spatial CSS also affected consumers that mount `WorkspaceShell` and chrome without `SpatialWorkspacePresentation`. The docked fixture lost its third desktop column, phone history could collapse to zero, and its legitimate phone toggle disappeared. All spatial-only shell rows/columns, overlaid phone navigation, phone header layout and redundant-toggle hiding now require the existing `.spatial-workspace-stage` mount. The original non-spatial mobile sheet rows are restored. The unchanged fixture again proves its 320 px desktop stage floor, 120 px readable phone history and usable toggle; the actual shipped spatial mount still proves the model, anchored conversation and single phone Assistant entry.

Second, `undefined === undefined` previously allowed two omitted `navigationTarget` fields to authorize rebinding an Inside pose to another source pin. Cross-pin retention now requires an explicit matching target. Callers that omit it retain the original source-pin invalidation behavior. The fallback notice is emitted only after navigation actually falls back to Overview, so unchanged contexts do not acquire a false warning. The original `context('r2')` assertion remains intact; the shipped app supplies its explicit design target and still preserves compatible native proposal/current poses.

Verification after both repairs: `npm run validate` passed (385 sources), the production demo build passed, and the unchanged shell/navigation plus shipped Plan/spatial batch passed **12 tests, 0 failures/skips**:

```powershell
node --test --test-concurrency=1 demo/workspace-shell.test.ts demo/view-navigation-browser.test.ts demo/spatial-plan-integration-browser.test.ts demo/spatial-workspace-browser.test.ts
```

The changed-CSS detector returned `[]`; whitespace and explicit changed-path policy checks passed. This patch changes presentation scoping and the existing camera compatibility boundary only. The parent owns final Linux rerun, accepted qualification SHA and local server restart; no readiness or deployment claim follows from the local checks alone.
