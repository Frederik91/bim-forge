# #263 task-agent layer run

## Plan

Own `demo/spatial-task-layer.ts`, focused Babylon tests, an isolated browser gallery/test, and this evidence. Consume `RequestState` and `SpatialTokens`; no construction entities, schemas, queues, transport or production viewer lifecycle changes. Preserve the approved study's tapered blue torso, pale spherical head, two eyes, hands and hover ring, using actual meshes at the captured project origin.

Validate fixed origins with nonzero engineering elevation/XYZ axis conversion, real ray picks separated from construction/markup/navigation, same-place chooser identities, unplaced list fallback, state text, perspective/orthographic projection and occlusion, repeated replacement/project switch/disposal and borrowed resource survival. Run strict validation, demo build, focused tests and desktop/narrow Chromium captures. Construction-model delta: zero.

## Run ledger

- Attempt 1, 2026-10-31: inspected issue #263, AGENTS/policy, shared contracts, implementation plan, DESIGN.md, token authority and approved study 9f5802d. Implementation underway. No provider calls or model changes.

## Current result and stop

The standalone layer is implemented and all seven NullEngine behavior tests pass. Strict validation passes. The browser exercises a real head/body ray hit, same-place chooser, task selection, separate door highlighting, state updates and occlusion successfully. Desktop evidence is `spatial-agent-layer-263/desktop.png`.

The browser stops at the 390px horizontal-overflow assertion (line 53 of `demo/spatial-task-layer-browser.test.ts`). Narrow acceptance and final cleanup/browser-error assertions have not completed. Absolute projected labels are the likely overflow source; this is not yet independently diagnosed. No fix or retry follows the third failed verification iteration. Maintainer authorization is required before another attempt.

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
- After renewed authorization: `$env:TASK_AGENT_EVIDENCE='docs/evidence/spatial-agent-layer-263'; node --test --test-concurrency=1 demo/spatial-task-layer-browser.test.ts`

No provider calls, production integration, merge, readiness change, issue closure or deployment occurred. Full demo build and final design detector remain pending when work stopped.
