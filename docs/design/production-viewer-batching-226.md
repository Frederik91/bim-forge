# Retained production viewer and bounded batches — #226

Approved scope: integrate the renderer improvement into the existing ModelScene.
Accepted production model delta is zero; no authoring, storage or workspace
ownership changes. Source snapshots remain authoritative outside the renderer.

## Plan and acceptance before implementation

1. Merge reviewed benchmark #214, then #219, preserving current main's tests.
2. Keep ModelViewer and ModelScene's public interaction methods. Add a private
   batch owner for opaque, unhighlighted meshes, preserving source normals/UVs,
   logical meshes/IDs and bounds. Selected/outlined and transparent review parts
   use their original individual geometry/material behavior.
3. Retain render units across snapshots. Use existing modelChanges dependency
   invalidation, including hosts, supports, families, levels and stair openings.
   Remove/rebuild changed units only, preserving unchanged resources and camera.
4. Visibility-only changes update indices or whole-batch enable state, never
   vertex buffers. Batches are material/spatial groups capped at 128 parts and
   100,000 vertices, with an oversized single part preserved intact.
5. Validate actual ModelScene behavior on deterministic production fixtures,
   both material modes, picking/references, cutaways, selection and preview/
   compare/discard. Check untouched resources and 100-cycle resource recovery.
6. Use real Chrome A/B diagnostics and inspect focused images. Compare full
   triangle positions, normals and UVs; investigate float32 projection as a
   possible cause of the benchmark overview difference. Record residual image
   differences and unavailable GPU memory/presentation timing honestly.
7. Run npm run validate, relevant tests and CI; publish a draft with evidence,
   review it, then complete the user's approved merge when checks pass.

## Ownership sketch

```text
ModelViewer (unchanged owner, one canvas)
  ModelScene.setModel(snapshot, comparison)
    retained render units (existing domain dependency comparison)
    existing geometry generators -> logical source mesh records
    SceneMeshBatches.update(source parts)
      opaque/unhighlighted -> material/spatial batch, source geometry cached
      highlighted/transparent -> individual source mesh
      visibility change -> index-only update
    pick -> triangle range -> original source mesh -> stable BIM object ID
```

Private helper API: update(parts), pick(x,y,predicate), resources(), clear().
Retention requires an explicit project ID from the existing host repository.
Snapshots contain no project identity; legacy callers that omit the optional ID
keep full-replacement behavior. Switching projects always releases prior parts,
even when entity IDs and geometry coincide. The application supplies its existing
repository project ID; this adds no authoring or persistence state.
Source geometry caches belong to the helper only while the logical source mesh
is alive. Removing a part releases its cache and affected batch membership.
Clearing/disposal removes batch buffers and shadow casters. Diagnostic constructor
option `off` keeps individual rendering for A/B checks; the product default is
automatic batching above a bounded size threshold, with no new user setting.

## Limits

Transparent context and previous-state ghosts retain individual sorting and
wireframe semantics. This delivery does not claim a 200k+ sqm qualification,
source rights/area admission or primary-laptop/GPU-memory capacity. Those remain
open in #192. Private West Riverside data and images must not enter Git.

## Run ledger

- Approved implementation started in isolated branch
  `codex/issue-226-production-viewer`, based on the integrated benchmark stack.
- Benchmark integration found a package.json test-command conflict with compact
  workspace #215; preserved both test sets and the browser test command.
