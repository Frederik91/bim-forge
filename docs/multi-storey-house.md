# Multi-storey house model

Issue [#111](https://github.com/Frederik91/bim-forge/issues/111), based on pending draft PR #110. Implementation is for a reviewable concept model, with explicit human acceptance.

## Design and usage

Use a versioned flat snapshot with direct level ownership. Keep metres on a millimetre grid. Historical snapshots retain their exact shape and hashes; existing edits retain the input format. New building reconstruction produces snapshot version 2 in a child proposal. This version is independent of the repository/history envelope version.

```ts
const level = levels(snapshot).find(item => item.id === selectedLevelId);
const plan = levelView(snapshot, level.id);
const proposed = previewBuilding(snapshot, buildingLayout);
const revised = previewFloor(proposed, oneLevelLayout); // preserves every other level
```

Version 2 requires `levelId` on walls, furniture, equipment, slabs and roofs. Spaces already carry it. Doors/windows inherit ownership from their wall host. A stair names its lower and upper levels. A shared `building-levels.ts` query boundary resolves membership, per-level views, elevations, roof clearance and stair footprints for validation, AI, 2D/3D and derived placement deltas.

New entities:

- Slab: identity/name, `levelId`, rectangular `bounds`, positive `thickness`; top is the level elevation. Stair voids derive from stairs ending on that level, without a second authored opening list.
- Stair: identity/name, `fromLevelId`, `toLevelId`, axis-aligned `start`/`end` XY centreline, `width`, integer `steps`. Rise derives from endpoint elevations. The complete footprint must fit a room at each endpoint; connected levels must be adjacent in elevation order.
- Roof: identity/name, `levelId`, rectangular `bounds`, `thickness`, and `profile`: `{kind:'flat',height}` or `{kind:'gable',eaveHeight,ridgeHeight,ridgeAxis:'x'|'y'}`. Heights are relative to its level. Initial roofs belong to the highest level. Roof undersides bound the effective wall tops and furnishing/equipment clearance; they do not establish building-code compliance.

`BuildingLayout` contains `levels` and `stairs`. Each level contains `level:{id,name,elevationMm}`, the existing room/opening layout fields, `slabThicknessMm`, and `roof` (profile/bounds/thickness or null). Building authoring preserves contents and their level identity. Existing unlevelled contents retain their implicit zero-elevation level when a unique zero-elevation level is supplied; otherwise the candidate fails. Never assign contents by overlapping XY bounds.

`previewFloor` remains a useful single-level reconstruction operation, using the layout's stable level ID. On an existing building, it preserves that level's elevation/slab/roof, incident stairs, all contents and every other level. Changes incompatible with retained geometry fail validation. Whole-building reconstruction uses a distinct explicit `building-reconstruction` request scope; existing `floor-plan-reconstruction` authorizes only a level.

Floor references include `levelId` in version-2 buildings. Existing wall references inherit their wall's level. Legacy references and snapshots are read exactly; no defaults are persisted during restore. Furnishing operations retain existing ownership; newly added or transferred whole-building furnishings require explicit level assignments. Room-scoped authoring derives the level from the chosen room.

## Synthesis

Two candidates compared membership edges with direct fields. Choose candidate B: ownership is visible beside geometry, openings derive their level from the host, and existing hosting relationships keep one purpose. Reject candidate A's metres-to-millimetres migration and duplicate opening ownership. Incorporate A's atomic level-edit and cross-level connectivity obligations. The independent judge also preferred B.

Accept historical read/edit support to preserve hashes and small deltas. This is intentional format support, not a temporary adapter authoring API. Reject nested storey graphs, which make globally stable references and cross-level stairs harder to compare. Slab holes and roof clipping are derived geometry rather than duplicated mutable facts.

## Implementation plan and evidence

- `room-model.ts`, `floor-plan.ts`, new `building-levels.ts`/`building-layout.ts`: versioned entities, ownership, level queries, per-level topology/placement, global door/stair exterior reachability, roof/slab/stair geometry, atomic building/level authoring.
- `model-script.ts`, `model-proposal.ts`, request/source persistence: typed authoring schemas, explicit building scope and level-bound context; preserve queued requests/review metadata and human decisions.
- `model-scene.ts`, `model-viewer.ts`, `model-delta-view.ts`, `visual-request.ts`: elevation applied once, slab voids, straight stairs, pitched roof, level/cutaway visibility, level-qualified picking, dependent placement deltas.
- `room-app.ts`, HTML/CSS: desktop/phone level navigation, per-level plans, whole-building/isolated 3D and roof controls; a basement/ground/attic starter.
- Fixture with three coincident floor footprints and connecting stairs/gabled roof; validators reject cross-level support, ambiguous references, bad elevations/hosts/roof/stairs. Existing exact restore stays valid. Show a one-level delta preserving the others and a level-elevation delta affecting its dependent geometry.
- Run validation and applicable suites in server containers, then actual ScriptBox/model proposal and browser checks in an isolated server candidate. Attach screenshots and an inspectable model delta to a draft PR. No shared-preview deployment or merge is authorized.

Initial bounds remain explicit: up to six levels, at most twelve rectangular rooms per level, globally bounded graph/history. Retain current graph limits unless the verified house fixture demonstrates a need to raise all affected transport/storage budgets coherently. Complex roofs, multi-flight stairs and structural/code certification are outside this first slice.
