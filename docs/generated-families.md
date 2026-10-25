# AI-authored asset families

Issue #113, based on draft PR #112. Changes remain proposals requiring human acceptance.

## Architecture and usage

Current catalog objects are `Furniture.kind` variants; their fixed silhouettes live in `furniture-geometry.ts`, with matching authoring schemas and plan rendering. ScriptBox stages validated snapshots, the queue retains execution evidence, and repository revisions preserve definitions, placements and decisions. This module extends that same path.

```ts
await model.previewAssets({
  families: [{ id: 'standing-person', type: 'AssetFamily', name: 'Standing person proxy',
    description: 'Conceptual standing figure, no anatomical accuracy.', parts: personParts }],
  instances: [{ id: 'person-187', type: 'AssetInstance', name: 'Person 1.87 m', familyId: 'standing-person',
    position: [2, 2], rotationDeg: 0, size: { width: .5, depth: .3, height: 1.87 },
    placement: { kind: 'room', roomId: 'office' } }],
  removeInstanceIds: [],
});
```

`placement` is `{kind:'room',roomId}` for a named room (level derived from the room) or `{kind:'single-room'}` for the existing unlevelled single-room shell. Persist the same placement, never a second conflicting level identity. No shell conversion is necessary to add an asset to an existing project.

`AssetFamily` definitions and `AssetInstance` placements are native flat-graph entity variants in both existing snapshot forms. Definitions are nonspatial and immutable by ID: identical registration is idempotent; changing a recipe requires a new family ID and explicit instance updates. Historical snapshots gain no fields/defaults, preserving bytes and hashes. Old application versions cannot read the new variants.

Each part is `{id,kind:'box'|'ellipsoid'|'cylinder',min:[x,y,z],size:[width,depth,height],color:'#rrggbb'}`. Coordinates lie in a normalized unit box; positive parts must stay within it and their combined analytic extrema must reach all six unit-box bounds. Instance width/depth/height (metres on a millimetre grid) scale that recipe exactly; local floor Z is zero. Cylinders are vertical, ellipsoids use full diameters. No stored bounds can disagree with generated geometry. No scripts, expressions, external URLs, recursive families or arbitrary binary payloads are persisted or executed during restore/render.

The first module supports floor-standing proxies with axis sizing, not topology-changing parameters, arbitrary orientations, hosted products or photoreal human meshes. The AI writes recipes inside its existing sandbox; new family categories need no catalog entry or renderer branch. Definition descriptions and review assumptions state fidelity.

## Synthesis

Candidate A proposed declarative parametric primitives; B proposed generated inert triangle meshes. Prefer A's compact, predictable primitive representation, simplify its affine evaluator to normalized geometry with three size parameters, and graft B's immutable IDs and direct support for existing single-room projects. Reject A's mandatory whole-snapshot upgrade and B's larger mesh transport/validation surface for this first slice. Keep new geometry behind one shared evaluator used by bounds, placement, plan, Babylon and model-delta review.

An independent design judge preferred the same synthesis. We accept whole-axis scaling and conservative occupied bounding boxes in exchange for a small, deterministic authoring and review boundary. Height changes stretch vertical features; fixed-size subcomponents, articulated poses and richer constraint parameters require further family semantics.

## Implementation plan

- New `src/asset-family.ts`: authoritative TypeBox schemas/types, recipe validation, resolution, local/world geometry, footprints and bounded quantities. Maximum 8 definitions, 16 parts/family, 32 combined furnishings/instances, within graph100/result64KiB/history256KiB limits.
- `room-model.ts`, level/room queries and reconstruction: native variants, atomic upsert/remove authoring, preservation across shell edits, room/door/stair/roof/slab and cross-object occupancy validation. Definitions are included as read dependencies in level views without acquiring level ownership.
- `model-script.ts`, `model-proposal.ts`: one `model.previewAssets` capability, discovered schemas/docs, inspectable families and placements, ordinary execution evidence and human review.
- Babylon/plan/delta/UI: generic family geometry and instance picking, derived dimensions/proxy description, before/after parameter/placement changes and instance deltas when family references change.
- Fixtures for a 1.87 m person, second height reusing one family, unrelated generated object; deterministic geometry/budget/clearance rejection, atomic failure, exact legacy restore, real ScriptBox/queue/acceptance, and actual AI/browser verification on server containers. Open a draft PR, no merge or shared-preview deployment.

## Verification

See [server, live-worker and browser evidence](evidence/issue-113/README.md). The actual AI authored a standing-person family, reused it at 1.87 m and 1.65 m, and authored an unrelated floor lamp. A separate UI request produced a 1.87 m person that was accepted and restored without changing the original shell. Tests measure generated vertices as well as declared dimensions.
