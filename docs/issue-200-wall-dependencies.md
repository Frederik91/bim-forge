# Bounded wall dependency preview (#200, parent #197)

Ownership: new `src/wall-dependencies.ts`, its focused test file, and this note.
Baseline: `f59687e976d7b165f7df10d0d77a2fc42879e67a`.

Plan: validate a native snapshot; identify complete rectangular room sides on both
sides of an interior axis-aligned wall; translate that wall and update room bounds
and terminating perpendicular endpoints; validate the entire candidate; expose the
existing `ModelDelta` plus deterministic evaluation dependencies. Fixtures cover
the eight-room residential floor, named hosted openings, generated two-room floors,
and coincident version-two floors. Rejection assertions preserve original bytes.

## Public seam

```ts
previewWallShift(baseSnapshot: unknown, input: WallShiftRequest): WallShiftPreview
```

`WallShiftRequest` contains `wallId` and `offsetMetres`. Positive means global +X
for vertical walls or global +Y for horizontal walls, independently of endpoint
ordering. A nonzero offset must be on the millimetre grid, at most one metre.
The result contains the validated `snapshot`, existing `delta: ModelDelta`, and
`impacts: WallShiftImpact[]`. Failures throw descriptive errors before returning
a candidate. There is no repository, database, agent tool, or publication call.

Impacts have `kind: 'entity' | 'relationship'`, stable `id`, sorted `reasons`, and
`changed` indicating changes to stored data. Entries sort by kind then ID using
code-point order. `changed: false` does not mean world geometry is unchanged:
a door/window follows a translated host even though its own dimensions and local
hosting offset retain exactly the same bytes. `delta` remains the storage delta;
`impacts` is evaluation evidence, not write permission or frozen scope authority.

Exports: `previewWallShift`, `WallShiftRequest`, `WallShiftPreview`,
`WallShiftImpact`, and `WallShiftReason`.

## Supported geometry and limits

- Complete shared rectangular room sides, including multiple rectangles along one
  long partition. Preserve object IDs, names, parameters, and untouched bodies.
- A perpendicular wall terminating on the moved partition extends or shrinks at
  that endpoint. A perpendicular carrier stays fixed while the partition endpoint
  slides along it. Both are evaluation dependencies.
- Local opening offsets remain fixed for the translated host. On resized
  perpendicular hosts, adjust offsets when the start endpoint moves to preserve
  the opening's existing world position. Validate host length, door connectivity,
  opening overlap, room clearance, furnishings/supports, equipment, assets, stairs,
  slabs and roof using the native validators, with additional empty-clear-interior,
  retained-room-owner, and equipment/door-clearance checks.
- Version-two ownership restricts geometric edits to the target level. Other
  levels still participate in whole-snapshot validation.
- Reject exterior walls, partial room sides, collinear continuations, interior
  crossings, reversed/collapsed connections, invalid offsets, collapsed/overlapping
  rooms, and invalid dependent geometry. This is a final-state concept geometry
  preview, not a swept-volume construction simulation or general constraint solver.
- Native caps and units remain unchanged (metres on a millimetre grid; current
  snapshot validator caps). There is no jurisdictional minimum room dimension.
  An empty clear interior is rejected, including otherwise empty narrow rooms.

The existing validators are reused unchanged. Furnishings are retained by body
and owner; they are never automatically relocated to make a wall move valid.
Dependency selection uses entity types, geometric connections and IDs referenced
by the model, with no user-text or fixture-ID matching.

## Inspectable model delta

On the residential floor, translate the living/kitchen partition by +0.300 m:

| Object | Before | After |
| --- | --- | --- |
| Partition | X = 5.000 m | X = 5.300 m |
| Living room east bound | 5.000 m | 5.300 m |
| Kitchen west bound | 5.000 m | 5.300 m |
| Synthetic shared door endpoints | (5.000, 1.200) to (5.000, 2.000) | (5.300, 1.200) to (5.300, 2.000) |
| Shared door body and local host | unchanged dimensions/name/offset | identical bytes |
| Other rooms and furnishings | existing bodies | identical bytes |

The focused tests assert this delta, actual evaluated opening endpoints, both room
connections, support evaluation, reverse endpoint ordering, T-junction endpoint
changes, and rejection atomicity. Parent #197 owns ScriptBox/scope integration and
aggregate visual 2D/3D review evidence; this slice supplies native geometry evidence.

## Verification ledger

Server-only verification uses `frederik@192.168.1.17`, existing image
`bim-qvm-tools:20261025`, a clean source extraction on SSD, and read-only cached
dependencies `/ssd1/bim-forge-qualification/all-ready-195/final/dependencies`.
No image build, installation, root-disk checkout, live data or automation changes.
Compile/validate: 1 CPU / 2 GiB; focused tests: 0.5 CPU / 1 GiB; network disabled.

The owner explicitly authorized ten total attempts per item for this interactive
qualification, with each failed attempt recorded and diagnosed before retrying.
Global factory policy stays unchanged. Human geometry review is required before merge.

| Attempt | Result | Root cause / correction |
| --- | --- | --- |
| 1 | Container launch failed before tests | Read-only source lacked the dependency mount point. Created an empty SSD `source/node_modules` directory; no dependency write. |
| 2 | Root validate and changed-path policy passed; focused tests 8/12 passed | Correctly rejected negative hall shift hit existing chair clearance; chose a valid positive fixture move. Compare evaluated endpoints on the native millimetre grid, not exact floating-point equality. Add missing units around compiled fixture. Reuse the existing small multi-storey fixture instead of exceeding the native 100-entity cap. |
| 3 | PASS: root validate, changed-path policy, all 15 focused tests | Clean extraction, same resource limits, read-only source/dependencies, network disabled. Added explicit crossing/collinear, equipment clearance and room-ownership assertions. No validator changes. |

Attempts 1-2 source archive SHA-256:
`fcfd77c7ca408ae48e7aa85eea0908b86219c67cb6adf49b5af7b8913112fe1d`.
Server evidence: `/ssd1/bim-forge-qualification/issue-200-wall-dependencies/attempt-1/evidence/`.

Attempt 3 source archive SHA-256:
`1459cba70bf2ba09cbce29484076627a1e4acde842c6809c8aa4974a74cb5e65`.
The evidence ledger was completed after that extraction; the tested TypeScript
sources are unchanged. SHA-256 values matched between local files and SSD source:

| File | SHA-256 |
| --- | --- |
| `src/wall-dependencies.ts` | `8c237b319747f1e8a4a62d0a32e5ac8c3b1f71295f2bee1876dbc8669abceb59` |
| `src/wall-dependencies.test.ts` | `f6de488c1d4aef98283872d78128e0b401def57f45180d3c78794bf7516f27e1` |

Server logs:
`/ssd1/bim-forge-qualification/issue-200-wall-dependencies/attempt-3/evidence/{validate,focused}.log`.

```text
npm run validate
Strict TypeScript valid. 242 source file(s) checked.
tsc --noEmit: exit 0
Policy valid. 0 changed file(s) checked.
node scripts/validate-policy.ts --changed-files src/wall-dependencies.ts src/wall-dependencies.test.ts docs/issue-200-wall-dependencies.md
Policy valid. 3 changed file(s) checked.
node --test src/wall-dependencies.test.ts
tests 15; pass 15; fail 0
```

The package test list is intentionally unchanged under this worker's ownership.
The parent must run the focused test command explicitly when integrating it.
No browser/device, ScriptBox, persistence, or aggregate 2D/3D qualification is
claimed by this pure-module slice. No deployment was performed.

Publication retry: the first push failed because Git's configured credential
helpers selected `frte-aec` and attempted an unavailable password prompt.
`gh auth status` and `gh api user` confirmed the active owner account `Frederik91`.
A command-local credential helper and username override pushed successfully.
No global Git configuration or stored credentials changed.
