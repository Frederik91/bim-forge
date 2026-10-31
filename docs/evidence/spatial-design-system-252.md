# Spatial design system · issue #252

## Plan and scope

Preserve the approved Inside-first study, draft #249 at `9f5802d3f3d428fd91d367fba71477a787b26ad1`. Extract its navy/blue/mineral palette, Segoe UI chrome, Arial drawing text, 44 px controls, restrained panels and differentiated drafting lines into `demo/ui/design-tokens.ts`. Generate CSS from that authority in `scripts/build-demo.ts`; React, Plan and Babylon consume the same source. Reuse `demo/ui/button.tsx`; add only shared task identity/state and panel primitives, an isolated state gallery and `DESIGN.md`.

Model entities: none added or changed. The gallery reads the validated `viewerBuilding()` fixture. Its drawing specimen is presentation evidence, not a replacement Plan renderer. No request transport, room-app orchestration, camera, schema, queue, provider or privacy controls change.

Acceptance: run `npm run validate`, demo/gallery builds, palette contrast and browser gallery checks, then inspect desktop/narrow screenshots and actual native project views. Check keyboard focus, disabled/empty/loading/error/stale states, readable dimensions and textual task identity independent of color. Integration owners import/inject the shared token subsets agreed with #261.

## Run ledger

1. Baseline read: instructions and live issue #252 reviewed; `STATE.md` is unpaused and issue has no pause label. Approved CSS/source inspected. Impeccable context/extract/craft-floor and TypeScript/type-discipline read. Existing Button is the component authority; no new visual-world exercise. Codebase graph was tried but available indexes belong to historical worktrees; current owning files were read directly.
2. Qualification attempt 1: lint passed; typecheck found that a combined entity-type/level filter did not narrow the fixture union. Both builds passed. Split discriminant and level filtering so TypeScript proves wall/space fields without casts. No validator weakened.
3. Qualification attempt 2: validate and both builds passed. Four of five browser/build checks passed (gallery keyboard, retained draft, 44 px controls, desktop/390/320 layouts, forced colors, actual native Plan/single viewer, hashed release). Contrast caught approved geometry amber on its tinted fill at 4.27:1; preserve geometry amber and use the study's separate proposal-text brown `#674308` for small text. Visual review also caught scaled SVG annotations on narrow screens; keep their rendered size at 13 px with a measured viewport and verify it. No validator weakened.

## Validation and limitations

Qualification attempt 3 passed: strict TypeScript/lint, typecheck, policy, demo and gallery builds, and **5/5 focused checks** in `demo/design-system-browser.test.ts` + `demo/preview-build.test.ts`. Impeccable's mechanical detector returned `[]` for all changed UI targets. Source diff has no whitespace errors.

The contrast check covers twelve foreground/background pairs (body, secondary, action, selected, warning, failure, accepted, proposal, drawing ink/annotation and selection). Browser execution confirms editable draft retention on task switching, Tab/Enter operation, a 3 px keyboard outline, native disabled actions, all eight server-state labels, stale/empty/loading/error, 44 px actions, no page overflow at 1440/390/320 px, 13 px rendered drawing dimensions at narrow widths, forced-colors textual task identity, and no gallery writes or page errors. Native workspace verification creates a disposable room with provider and worker explicitly disabled, opens real Plan/3D, confirms the shipped shared action token and one viewer canvas, and captures narrow Plan. The hashed release test verifies all five production assets and their browser references.

Screenshots were visually inspected at desktop and 390 px. The approved study was also captured locally at `http://127.0.0.1:4188/`, including its original Inside and detailed Plan views. The gallery uses the validated `viewerBuilding()` fixture, with 6 000/4 000 mm wall axes and an 800 mm hosted door. It does not copy the study's synthetic room coordinates.

| Evidence | Artifact |
| --- | --- |
| Approved baseline Inside / drafting | [Inside](spatial-design-system-252/approved-study-desktop.png), [Plan](spatial-design-system-252/approved-study-plan.png) |
| Shared gallery + visible keyboard focus | [Desktop](spatial-design-system-252/gallery-desktop.png) |
| Narrow gallery and legible dimensions | [390 px](spatial-design-system-252/gallery-390.png), [320 px](spatial-design-system-252/gallery-320.png) |
| Task identity without color | [Forced colors](spatial-design-system-252/gallery-high-contrast.png) |
| Existing actual native app | [Plan](spatial-design-system-252/native-plan-desktop.png), [3D](spatial-design-system-252/native-viewer-desktop.png), [narrow Plan](spatial-design-system-252/native-plan-narrow.png) |

Replay from this worktree:

```powershell
npm ci --ignore-scripts
npm run validate
npm run build:design-gallery
npm run build:demo
$env:QUAL_ARTIFACTS = 'docs/evidence/spatial-design-system-252'
node --test --test-concurrency=1 demo/design-system-browser.test.ts demo/preview-build.test.ts
```

To inspect the gallery, serve `dist/design-system` locally (for example `python -m http.server 4192 --bind 127.0.0.1 --directory dist/design-system`). This is an isolated fixture surface, separate from the production release and provider connection.

## Handoff and risks

- Token contract agreed with #261: `spatialTokens` / `SpatialTokens` in `demo/ui/design-tokens.ts`, generated `--spatial-*` namespace; renderers receive readonly derived subsets. `proposedText` preserves the study's accessible small-text brown while `proposed` preserves its geometry amber.
- The production delta adopts those values through existing Canvas Studio semantic aliases and includes the reusable primitive CSS. It preserves existing DOM, renderer, camera and transport ownership.
- Legacy production SVG and Babylon materials still contain their existing colors; #262/#256 and #263/#257 own replacing them with injected tokens. Gallery drafting is a fixture specimen, not a second production Plan renderer. This PR does not claim full spatial shell/agent integration.
- Gallery state examples are explicitly fixture presentation. Accepted is the human label for the current server `completed` state; no new request/storage state exists. No provider calls, live model writes, privacy selectors, merges or readiness transitions occurred.

Model delta: **0 entities, 0 relationships, 0 accepted revisions**. No migration or deployment configuration change.
