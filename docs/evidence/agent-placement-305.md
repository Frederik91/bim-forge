# Agents beside selected geometry (#305)

## Report and cause

The reported Overview screenshot showed an agent embedded in a selected door.
The old dispatch calculation only offset hosted items when an Inside `eye`
existed. Overview deliberately has no Inside eye, so it fell through to the exact
entity anchor. Furniture and authored asset anchors were also used without a
horizontal clearance offset.

## Result

`taskDispatchPoint` now accepts an optional `viewpoint` separately from `eye`.
The viewpoint chooses which side of selected geometry faces the actual camera.
It never supplies a location when no object or markup is selected: the existing
Inside eye / Plan centre / unplaced Overview fallback remains unchanged.

- `ModelViewer.captureViewpoint()` returns the active camera position converted
  from Babylon coordinates to project `[x, y, z]` engineering metres.
- Hosted doors, windows and permanent openings move beyond a jamb by half the
  opening width plus 0.3 m where the host segment permits, and beyond the wall
  face by 0.45 m. Walls receive the same face clearance without a jamb offset.
  The normal side follows the real viewpoint; a deterministic side remains safe
  relative to the host when a viewpoint is unavailable.
- Furniture uses its rotated footprint; authored assets use their evaluated
  geometry bounds. Equipment and other spatial extents use their corresponding
  native footprints. The origin lies beyond that footprint toward the viewpoint.
- The rendered figure's horizontal radius is below 0.19 m, leaving clearance for
  its hands and work/status visuals. Placement considers the referenced item and
  its host; this change is not a global obstacle solver or projected-agent packing
  system.
- Markup centroid priority, selected target IDs, the source revision and frozen
  saved task origin are retained. Existing saved agents are not relocated.

Construction model delta: **none**. No entity, host relationship, schema,
validator, permission or accepted revision is changed by overlay placement.

## Qualification

All fixture servers ran on Linux, in an isolated checkout. No live preview data
or service was changed by this task.

At application/test source `5a6315d8e10dc6a805ddd9209ec3abe6ced943fb`:

| Check | Result |
| --- | --- |
| `npm run validate` | Strict TypeScript: 395 source files; typecheck and policy pass |
| `npm run build:demo` | Pass |
| `node --test demo/task-dispatch.test.ts` | 6/6 pass |
| New shipped Overview door + wall workflow | 1/1 pass, 29.24 s |
| Existing spatial-dispatch/markup/held-upload/eye workflow | 1/1 pass, 36.08 s |

The deterministic tests exercise both camera sides of a Door, Window and Opening,
the no-eye Overview case, missing-camera safety, non-reference fallback, upper
level rotated furniture and authored asset footprints, graph immutability, and
unchanged previously returned points.

The shipped browser creates a disposable saved house, dispatches from Overview
with no Inside pose, checks the real door and east-wall target IDs/clearances,
clicks each actual Babylon body, and verifies that its exact ticket receives the
ray pick. It also proves one retained canvas, unchanged accepted project responses
and identical task placement after reload. Both browser files report zero page
errors. In the reported inner-door fixture the saved origin is `[4.525, 2.7, 0.6]`,
with target `level-ground-door-inner`; the east-wall origin is `[7.475, 3, 0.6]`.

Screenshots of the real door and wall figures, JSON origin/target receipts, logs
and run ledger are retained under the task's Linux/Windows evidence directories.
The door screenshot was visually inspected: the figure clears the wall face and
sits beside the opening rather than inside its leaf.

Earlier qualification failures were fixture errors: missing `await` on project
restore, replacing the building's only exterior doorway with a window, and an
incorrect Overview selector. Those were retained and escalated under AGENTS.md.
After the user explicitly authorized continuing for the remainder of the chat,
the fixture selector was corrected. A subsequent close-neighbour fixture ray
correctly hit the nearer door figure; the second target was moved to a separate
east wall while retaining exact body-pick assertions. No validator or authority
assertion was relaxed.

The new browser file is included in both the spatial suite and the Linux shipped
qualification manifest.
