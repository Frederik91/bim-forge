# #263 task-agent layer run

## Plan

Own `demo/spatial-task-layer.ts`, focused Babylon tests, an isolated browser gallery/test, and this evidence. Consume `RequestState` and `SpatialTokens`; no construction entities, schemas, queues, transport or production viewer lifecycle changes. Preserve the approved study's tapered blue torso, pale spherical head, two eyes, hands and hover ring, using actual meshes at the captured project origin.

Validate fixed origins with nonzero engineering elevation/XYZ axis conversion, real ray picks separated from construction/markup/navigation, same-place chooser identities, unplaced list fallback, state text, perspective/orthographic projection and occlusion, repeated replacement/project switch/disposal and borrowed resource survival. Run strict validation, demo build, focused tests and desktop/narrow Chromium captures. Construction-model delta: zero.

## Run ledger

- Attempt 1, 2026-10-31: inspected issue #263, AGENTS/policy, shared contracts, implementation plan, DESIGN.md, token authority and approved study 9f5802d. Implementation underway. No provider calls or model changes.

## Initial result and preserved stop

The standalone layer is implemented and all seven NullEngine behavior tests pass. Strict validation passes. The browser exercises a real head/body ray hit, same-place chooser, task selection, separate door highlighting, state updates and occlusion successfully. Desktop evidence is `spatial-agent-layer-263/desktop.png`.

The browser stops at the 390px horizontal-overflow assertion (line 53 of `demo/spatial-task-layer-browser.test.ts`). Narrow acceptance and final cleanup/browser-error assertions have not completed. Absolute projected labels are the likely overflow source; this is not yet independently diagnosed. No fix or retry follows the third failed verification iteration. Work was preserved as WIP draft PR #276 before the maintainer renewed authorization below.

### Attempt history

1. Initial check: test helper union typing, exact float comparison, and an invalid material disposal property failed. Corrected the helper's return type, used a numeric position tolerance, and checked borrowed material membership.
2. Follow-up check: seven NullEngine tests passed; gallery compilation failed on Set<Mesh> vs AbstractMesh, DOM narrowing in functions, and Babylon's null matrix argument. Corrected these compile errors.
3. `npm run validate` passed (357 TypeScript source files). Browser reached actual 3D selection and desktop capture, then failed the narrow horizontal-overflow assertion. The same combined run passed all seven NullEngine tests. Stopped as required by AGENTS.md and policy/loop-constraints.md.

## Integration API

`SpatialTaskLayer` accepts an existing Scene, injected `TaskAgentTokens` derived from `SpatialTokens['color']`, an explicit construction-mesh predicate, and a reduced-motion preference. It creates no engine/camera, observers, listeners, transport, queue or model entity. The isolated gallery owns its own test engine only.

- `replace(projectId, descriptors)` consumes readonly confirmed task/unsent draft descriptors, clones the projection, rejects identity/project conflicts and unsafe coordinates atomically, retains captured origins and disposes removed/project-switched figures.
- `pick(ray, interaction)` returns none, one task identity, or explicit same-place candidates. Markup/navigation suppress activation. Construction occludes task bodies.
- `anchors(camera, width, height)` returns visible canvas-coordinate anchors or hidden/unplaced/offscreen/occluded reasons. CSS overlays must convert render units when needed and prevent viewport overflow.
- `listEntries()` supplies stable identity, title, textual reported state, Selected and unplaced context for accessible caller controls. `completed` reads Accepted. Drafts read Unsent draft and use a wire torso.
- `renderFrame(timeMs)` belongs in the existing render loop; only reported `working` bobs by 18 mm, and reduced motion disables bobbing. No animation changes authoritative state.
- `ownsMesh(mesh)` identifies all task graphics. `dispose()` is idempotent. Integration must dispose the layer before the borrowed Scene, and exclude owned meshes from generic building picks, framing and floor/collision queries. The metadata discriminator is `spatial-task-overlay`; meshes/materials/transforms also set `doNotSerialize`.

#257 alone wires production picking/lifecycle, opening conversations, target resolution/highlights and separate Return to task navigation. The layer returns identity rather than storing a second target/proposal authority. Unplaced tasks create disabled graphics and remain list-accessible. Export tests prove scene serialization contains no task-agent resources. Native construction data, accepted/proposed geometry, IFC export inputs and geometry-query inputs are untouched. Construction-model delta: zero.

## Replay

- `npm ci --ignore-scripts`
- `npm run validate`
- `node --test demo/spatial-task-layer.test.ts`
- Browser evidence: `$env:TASK_AGENT_EVIDENCE='docs/evidence/spatial-agent-layer-263'; node --test --test-concurrency=1 demo/spatial-task-layer-browser.test.ts`

No provider calls, production integration, merge, readiness change, issue closure or deployment occurred. Full demo build and final design detector were pending at the initial stop; both pass in the renewed run below.

## Renewed run: narrow label overflow resolved

The maintainer explicitly renewed execution: **"Continue with as many attempts as you need."** The original failures remain recorded above. No overflow assertion, validator or other acceptance gate was weakened.

### Root cause and repair

DOM bounds isolated the overflow to absolutely positioned HTML labels, rather than the model canvas or conversation layout. Before repair, the 181.45px same-place label extended to x=393.13 in the 390px viewport and x=358.13 at 320px. At 320px the draft label also began at x=-17.97.

The isolated gallery's adapter now measures each label at its intrinsic `max-content` width, caps/wraps labels to the available stage width, and clamps their centre/top to an 8px stage inset. The first renewed browser check exposed a second sizing detail: absolute shrink-to-fit width changes after setting `left`, so measuring before placement alone was insufficient. Explicit intrinsic width makes measurement and final placement agree. Only label presentation moves. The true projected point remains separate in `data-anchor-x/y` for real body picking. Task origins, scene geometry and the `SpatialTaskLayer` API remain unchanged.

After repair, the same-place label ends at x=381.99 at 390px and x=311.99 at 320px; the narrow draft label starts at x=8. Both labels remain readable. The original document-overflow assertion passes at both widths. Additional assertions require both labels and their measured bounds to remain within the stage; body picks still use the unchanged true projection and reopen the same-place chooser at each width.

### Final acceptance evidence

- Seven real Babylon NullEngine checks pass.
- Full Chromium journey passes at 1440×1000, 390×844 and 320×844: body picks, same-place chooser, independent selection, target highlight, truthful state samples, occluded labels, unsent draft, unplaced keyboard access and disposal. Browser errors: zero.
- `npm run validate` passes (357 TypeScript source files); `npm run build:demo` passes.
- Impeccable detector over layer/gallery returns `[]`. Desktop and both narrow captures were inspected directly.
- `spatial-agent-layer-263/browser-result.json` records label bounds, viewports and browser outcome. `validation.txt` records validator output. Captures: `desktop.png`, `narrow.png`, `narrow-320.png`.

### #257 handoff

The core API is unchanged. `anchors()` supplies the projected agent location in the caller's canvas units, not the bounds of a DOM label. The production label adapter owns render-to-CSS conversion, intrinsic measurement, wrapping, an inset clamp and any dense-label collision policy. Keep the true projected point for leader attachment and body hit testing. Never move the task's project-space origin to fit a label, and keep the task list accessible when an agent or anchor is offscreen/occluded.

Construction-model delta remains zero. This is isolated graphics/browser qualification with explicit reported-state fixtures. Production wiring and the connected-provider journey remain owned by #257/#258. The PR remains a draft for human change review; no readiness change, merge, issue closure, provider call or deployment occurred.
