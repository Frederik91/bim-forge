# Native Plan core evidence — #262

Issue: [#262](https://github.com/Frederik91/bim-forge/issues/262). Base: shared foundation `b5f01e2`. Branch: `codex/issue-262-plan-core`. Construction-model delta: **zero**. The production Plan remains owned by `room-app.ts` until #256 switches callers and deletes the old drawing/projection writers.

## Plan and scope

`demo/model-plan.ts` owns pure native geometry, projection, inverse coordinates, source-qualified hit candidates and SVG rendering. `demo/model-plan.test.ts` checks native walls, hosted openings, level ownership, dimensions, scale, selection and comparison. `demo/model-plan-fixture.ts` enriches the existing validated `multiStoreySnapshot()` with native furniture, a window and a dimensional asset proxy. The gallery and browser test supply visual evidence without another production owner. Tokens come only from injected `SpatialTokens` subsets; the renderer imports their type, never a palette.

Read-only entities: Wall, Door, Window, Space, Slab, Stair, Roof, Furniture, Equipment and AssetInstance. Level and AssetFamily metadata supply context without becoming selectable construction geometry. No queue, storage, viewer, scene, global styling, provider or deployment changes.

## Public handoff to #256

| Export | Meaning |
| --- | --- |
| `createModelPlan(input): ModelPlan` | Explicit source snapshot/project/design target/revision, level, viewport, optional comparison and selected source references; injected `PlanTokens`. No DOM or model writes. |
| `renderModelPlan(document, plan): SVGSVGElement` | Native SVG. No listeners, navigation, submission or live routing. Entity elements expose project, revision, entity, revision role and representation attributes. |
| `hitTestModelPlan(plan, [x,y], tolerancePx = 4)` | All overlapping source-qualified native candidates, current revision first, then opening/object before wall/room/slab/roof context. No arbitrary replacement of stale references. |
| `plan.projection.project([x,y,z])` | Project east/north metres to SVG viewBox units; north is screen up. Plan intentionally projects onto the explicit level. |
| `plan.projection.inverse([x,y])` | Project point at the selected level elevation, retaining project, revision and level. |

Integration must convert client coordinates to viewBox coordinates: `(clientX - rect.left) * plan.width / rect.width`, likewise Y. Recreate the Plan with current viewport dimensions to preserve readable 13 px annotation text. Stroke weights use the injected drafting widths and `non-scaling-stroke`. A viewport `bounds` window supports explicit framing/zoom; project points outside it retain their inverse mapping and do not become viewport hits.

The caller supplies validated native graphs and authoritative snapshot pins. Evidence fixture pins are distinct test hashes (`aaaa…`/`bbbb…`), not repository-published revisions. The core never derives revision identity from names or changes model data to make a view.

## Acceptance evidence

- Real validated multi-room, three-level native fixture: basement −3 m, ground 0 m, attic +3 m; 8 × 6 m wall-axis spans, two rooms of 24 m² on each level. No coordinates copied from the approved visual study.
- Hosted entry proposal: 900 → 1100 mm and offset 2.0 → 1.9 m preserve centre `[2.45,0,0]`. Accepted comparison stays 900 mm. Both revisions remain separately hit-testable. Solid proposed swing and dashed existing swing plus textual before/after width distinguish the change without relying on color alone.
- Wall profiles preserve 150 mm native thickness and omit hosted opening intervals. A point inside the opening returns the door/window, without the wall. Window width independently agrees with its 1.2 m source property.
- Door leaf and sampled quarter-circle swing derive from host direction and relationship offset. The native model does not encode handing; the symbol follows the existing positive-normal convention, without inventing a hardware promise.
- Dimensions independently assert 8 m/6 m source wall-axis spans and 1.1 m opening. Scale-bar pixels divided by the same projection scale equal the stated metres. Moved-wall evidence checks a 9 m axis span and proposed wall outline.
- Inverse round trips run at widths 320, 390 and 900, all three level elevations, and an explicit zoom window. Stale revision targets cannot select current objects.
- Source-bound furniture and asset proxy hits, native slab outlines, both incident stairs on ground, and attic roof/ridge projection are checked. Room labels wrap while screen text stays at least 13 px.
- Chromium uses the actual bundled renderer at 1024, 390 and 320 px; it clicks the current door, reads its identity/revision, changes to attic, checks absent ground door and present roof, disables comparison, verifies no horizontal overflow, and rejects browser errors. Screenshots were opened and inspected in two batched visual passes.

| Capture | Proof |
| --- | --- |
| [Desktop ground](../../artifacts/plan-core-262/ground-1024.png) | Native geometry detail, changed opening, dimensions and source selection. |
| [390 px ground](../../artifacts/plan-core-262/ground-390.png) | Wrapped room labels and readable drawing dimensions. |
| [320 px ground](../../artifacts/plan-core-262/ground-320.png) | Narrowest qualified view and source hit text. |
| [320 px attic](../../artifacts/plan-core-262/attic-320.png) | Level-specific door/stair geometry and dashed roof/ridge projection. |

## Validation and run ledger

```text
npm ci --ignore-scripts
  203 packages installed; audit: 0 vulnerabilities
npm run validate
  Strict TypeScript valid: 358 source files
  tsc --noEmit: PASS
  Policy valid
node --test demo/model-plan.test.ts demo/model-plan-browser.test.ts
  10 tests passed; 0 failed; 0 skipped
impeccable detect --json demo/model-plan.ts demo/model-plan-gallery.ts
  []
git diff --check
  PASS
```

| Attempt | Result |
| --- | --- |
| 1, initial core | 8 geometry cases passed; typecheck caught test narrowing on the accepted Door union. Corrected the test to narrow the entity discriminant. |
| 2, enriched fixture/browser | 9 cases including Chromium passed; typecheck caught an unbranded fixture room ID. Used existing `identifier()` boundary parser. |
| 3, final qualification | All validators and 10 focused tests pass. Explicit changed-file policy and final diff check pass. No validator changes. |

## Limits and review decision

These are native horizontal footprints with conventional opening symbols. Furniture/equipment/assets are explicit footprint proxies; slab bounds are native profiles and roof/ridge outlines are projections. This does not provide arbitrary source-derived Section or linked IFC Plan cuts. Project +Y is north only in the local engineering frame. The renderer does not implement georeferencing, task navigation, touch hit cycling or live-shell integration. The gallery's fixture is deterministic geometry evidence, not a connected-provider result or accepted model edit. #256/#258 own combined production integration and qualification.

Human review decides whether this standalone Plan core is acceptable for integration; this draft does not authorize readiness, merge or deployment.
