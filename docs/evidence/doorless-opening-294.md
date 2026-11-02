# Native permanent opening — issue 294

Status: implementation and deterministic qualification pass; shipped UI acceptance verification is incomplete. Draft for review, not ready to merge or deploy.

## Recorded case and model delta

The original request was “Remove this door, have it a fixed, 2m wide opening”. The saved conversation reports that no leaf-removal/conversion tool existed. The subsequent request for a 2 m **door** fails the existing validator: `Stair flights and slab voids must remain clear of door clearance zones.` No accepted geometry was changed.

A disposable replay of the exact accepted revision `a62b2bcad79c10766d3f9b53012875e809b90f067004d7d7e3cbe09665f8d37d` reproduces that Door failure and validates the new Opening operation. The live project was only read; no live task was submitted, accepted, deleted or reset.

| Record | Before | Proposed |
| --- | --- | --- |
| `door-entry` type | Door | Opening |
| Width | 0.9 m | 2 m |
| Height | 2.1 m | 2.1 m |
| Physical centre | `[2.45,0,0]` | `[2.45,0,0]` |
| Host | `level-ground-wall-south` | Same |
| `host-door-entry` offset | 2 m | 1.45 m |

One entity and one existing hosting relationship change. Stable IDs, typed parameters, level ownership, room connectivity, unrelated entities and accepted bytes remain intact. No door leaf, swing, glazing or inset door frame is generated. A permanent Opening reserves 0.9 m access clearance on each side without a fictitious leaf sweep. Host fit, millimetre grid, overlap, roof, furniture, asset, slab/stair and frozen-scope validators still apply. This is concept geometry, not construction or code certification.

## Implementation

`Opening` is a first-class native entity with width/height and exactly one wall host. Entity parsing, floor reconstruction, scope/dependencies, geometry, delta evaluation, plan and 3D readers support it. Existing snapshots retain their bytes and hashes.

`model.previewDoorToOpening({doorId,widthMetres:2,anchor:"centre"})` stages the conversion in the private ScriptBox draft. The method is discoverable in the model guide and worker instructions, has `draft-write` effect, enforces normal capabilities and scope, and grants no acceptance authority. Hosted width editing also supports an existing Opening while preserving its type.

The current preview's separate native Walk adapter is not on this main-based branch. Its doorway filter must include Opening during integration; the parent is handling that seam.

## Linux qualification

All fixture/app servers and tests ran on the Linux VM as `bimforge`. Windows was only an editing/SSH client. Runtime source checks are under `/var/lib/bim-forge/previews/checks/opening294-5aab5e5`.

At `8ad0773d799a0503ca4e0f39d1aa4bf209f3a49e`:

```text
npm run validate: passed
Strict TypeScript valid. 385 source file(s) checked.
tsc --noEmit: passed
Policy valid. 0 changed file(s) checked.
node --test --test-concurrency=1 src/hosted-opening.test.ts src/model-script-hosted-opening.test.ts demo/hosted-opening-queue.test.ts demo/model-plan.test.ts demo/model-scene.test.ts
tests 50; pass 50; fail 0
npm run build:demo: passed
```

At final implementation `f0bcbcfd334b4393fa4ef2ba656108e0453fe640` (after adding the browser case and removing inset door trim): validation passes for 386 sources, demo build passes, and all seven hosted-opening checks pass. Real Babylon rays at the centre and ±0.99 m find no construction infill; wall remains outside the 2 m opening and above its retained height. Plan dimensions show 2 m without adding a door swing; native geometry describes the opening as a hosted void, not a physical obstruction.

The typed ScriptBox cases prove successful scoped conversion, read-only capability denial, unchanged accepted repository and atomic rejection outside frozen authority. Queue/scene/plan regressions remain in the focused 50-check evidence.

## Unresolved shipped UI check

`demo/doorless-opening-browser.test.ts` creates a disposable house project and submits a controlled real ScriptBox worker through the shipped app. Proposal creation and the 2000 mm plan pass with zero page errors and unchanged Main. The test then waits for the explicit acceptance POST after switching to Plan; no response arrives. It fails at the `page.waitForResponse` for `/decision` (30 s timeout, overall case 58 s). Last status is `Plan opened. Selection and unsent task are retained.`

Acceptance and server-restart portions have **not** been qualified. Read-only inspection of the final screenshot shows the floating Assistant covering the lower-right canvas review tray's acceptance action. A separate acceptance action is visible inside the chat, but this test targets the covered tray action. No alternative-action repair/rerun was attempted after the third verification failure; the parent requested further-attempt approval under AGENTS.md. Raw logs and the final screenshot remain in the isolated Linux evidence directory and client `BIMForge/opening-294-evidence` directory.

## Review and compatibility

Geometry and native schema changes require human review. There is no SQL migration, but old binaries cannot read snapshots containing the new Opening entity after human acceptance. Keep a compatible reader for such data; do not claim arbitrary binary rollback is safe. This branch has not been merged or deployed and the live accepted project is unchanged.
