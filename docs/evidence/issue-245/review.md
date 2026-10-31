# Mounted assets — issue 245

Plan: extend `AssetInstance` in `asset-family.ts` with optional discriminated mounting while retaining room ownership and historical floor placements. Share elevation evaluation between geometry and `asset-placement.ts` validation. Update ScriptBox schemas, inspection, instructions and scope/geometry host relationships. Verify fixtures, vertical collisions, save/restore, native geometry and actual Babylon mesh bounds.

## Reviewable model delta

The deterministic cabinet fixture starts with eight retained immutable families. It adds one two-part cabinet family, three 400 × 300 × 600 mm wall-mounted cabinets at bottom elevation 1400 mm, and a 900 mm floor proxy underneath. Existing definitions and shell entities remain unchanged. The ninth family is admitted. All three cabinet bounds are Z = 1.4–2.0 m, sharing one recipe.

## Contract

Room ownership remains `placement: {kind: 'single-room'}` or `{kind: 'room', roomId}`. Optional `mounting` is one of:

- `{kind: 'floor'}`: also the historical omitted-field default.
- `{kind: 'wall', wallId, elevation}`: bottom above owning floor; the footprint must touch the named wall face, fit its length/height and avoid hosted openings.
- `{kind: 'ceiling', clearance}`: top clearance below the conservative local ceiling envelope (walls, roof underside and overlapping upper slabs). Zero clearance attaches to the underside; positive clearance suspends below it.
- `{kind: 'free-floating', elevation}`: bottom above owning floor without a wall host.

Explicit offsets are metres on the millimetre grid. Walls must be on the same owning level. Wall edits that detach a hosted asset fail validation and require explicit repositioning/rebinding. Ceiling items follow envelope changes; derived geometry changes appear in review. Families remain immutable. Budgets are 32 families and 32 combined furnishings/instances; the 16-part recipe bound remains.

## Evidence and limits

Before implementation, `node --test src/asset-mounting.test.ts` rejected the mounted cabinets with “Asset edits require exact bounded families, instances and removeInstanceIds.”

Automated coverage includes cabinet/sink vertical separation, family reuse beyond the former eight-family budget, overlapping vertical intervals, missing/detached/wrong-level/opening-obstructing hosts, invalid/off-grid offsets, world elevation, save/restore, ScriptBox declarations and authoring/inspection, native geometry host relations, scope host relations, and Babylon mesh/ghost elevations.

This change does not establish arbitrary angled wall mounting, surface-normal orientation, tilted assets, sloping-ceiling alignment, structural fixing design or manufacturer fidelity. Ceiling objects remain upright below the minimum supported envelope over their footprint. No live provider, browser-session or deployment qualification has been performed. Human change review is required before merge.

Validation results: `npm run validate` and `npm run build:demo` passed. `npm run test:assets` passed all 28 tests. The targeted geometry, scope, parameters, wall-dependency and Babylon scene run passed 115 tests. `npm test` passed qualification contracts and geometry suites, then stopped in linked-model revision tests with three Windows temporary-directory EPERM cleanup errors and one EACCES local `.sock` listener error. These full-suite failures are not waived or represented as passing.
