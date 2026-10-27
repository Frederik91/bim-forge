# Obtain the realistic 200,000+ m² dataset

Dataset status: **missing real project**. No owner, access approval, source
files, or measured floor-area evidence has been supplied for #192. The synthetic
hospital inventory in #122/#127 qualifies neither rendering nor engineering
geometry. Do not present a generated model as a measured hospital.

## Acquisition handoff

Identify a project sponsor or BIM coordinator who can provide the following:

| Required input | Acceptance evidence |
| --- | --- |
| A real building or campus with at least 200,000 m² gross floor area | Schedule/report naming included buildings and storeys, area convention, calculation, and exclusions. Do not sum duplicate discipline floor areas. |
| Architecture and structure | Coordinated, same-revision IFC exports or permission-cleared native geometry exports, including slabs, openings, stairs, roofs, walls, and structural members. |
| Mechanical, electrical, and plumbing | Detailed systems, ducts, pipes, fittings, terminals, equipment, containment, and repeated small elements. List absent disciplines/detail explicitly. |
| Object identity and metadata | Stable source IDs, discipline and storey mapping, classifications/properties, linked model references, and identity collision rules across source files. |
| Coordinates and units | Export units, survey/reference system, local origin and federation transforms, known alignment points, and engineering tolerances. |
| Source snapshots | Immutable revision identifiers, file sizes, SHA-256 hashes, export application/version/settings, and source-to-export traceability. |
| Rights and privacy | Written permission to convert and benchmark locally, plus separate permission for screenshots, derived artifacts, sharing with reviewers, and retention. Public repository publication is not assumed. |
| Representative changes | Cleared baseline/proposed revisions or specified edits for small changes, host/opening changes, a repeated-family fan-out, metadata-only changes, and a larger redesign. Expected changed IDs must be known. |
| Views and interaction oracles | Exterior/interior/dense-MEP camera routes, visible IDs at fixed waypoints, pick points with expected IDs, and room/storey/discipline isolation sets. |
| Execution device | The specified 16 GB integrated-GPU laptop with exact hardware/software profile, plus a workstation. A real tablet is required for touch claims. |

Keep files in controlled private storage. Provide a reproducible local read-only
access method and an owner for missing items. Do not upload to a conversion
service or contact a data owner without explicit authorization. Issue creation
and this setup do not grant rights to company/customer models.

## Prepare the shared geometry

1. Pin the conversion tool, versions, source hashes, tessellation tolerance, and
   coordinate transformation before generating either candidate's artifact.
2. Produce one engine-neutral tessellated dataset. Use right-handed, Y-up metres
   and a documented local origin. Bake arbitrary rotation/mirroring into geometry
   for this first adapter contract. Preserve each source element ID and its
   metadata. Reuse identical geometry where valid.
3. Record exact element, triangle, vertex, geometry, material, and texture counts,
   bounding boxes, discipline/storey distributions, compressed/uncompressed bytes,
   conversion time, and losses. Distinguish non-renderable ports/relationships
   from rendered objects. The first contract accepts opaque colors, not textures.
   Any simplified source material/geometry remains a declared limitation.
4. Validate geometry/units/identity against known source objects and federation
   alignment points. Retain before/after geometry evidence and tolerances. Check
   georeferenced precision after rebasing. Passing JSON validation alone is
   insufficient to establish fidelity.
5. Create smoke/reduced/full manifests with provenance back to the same project.
   Reduced views must preserve meaningful dense regions and shared geometry.
6. Add versioned, validated proposal deltas with expected added/modified/removed
   IDs. The input JSON supports geometry and metadata; native authoring semantics
   and regeneration require additional domain integration.

The current input schema is exported as `ModelSchema` from `contract.ts`. A model
has `version`, `id`, `revision`, `coordinateSystem`, `grossFloorAreaM2`, `cameraPath`,
`provenance`, `geometries`, and `elements`. Geometry contains triangle positions
and indices. An element references geometry and defines position, positive
scale, opaque RGB color, discipline, storey, category, and string properties.

For real provenance, provide `sourceHashes`, `permissionEvidence`,
`floorAreaEvidence`, `coordinateReference`, `conversionEvidence`,
`inventoryEvidence`, and `limitations`. References should identify accessible
private evidence, not disclose credentials. These fields record evidence
locations; a human must verify the evidence. The setup's admission result always
remains unqualified until the scored benchmark and evidence review exist.

Run a private prepared input with:

```sh
npm run benchmark:viewer -- --dataset /private/project/render-model.json --output /private/runs/viewer-192-001
```

The current runner loads JSON eagerly. This can test adapters on prepared input,
but does not implement production streaming or admit a full project within a
memory budget. A successful run must not conceal absent input categories or
conversion simplifications.
