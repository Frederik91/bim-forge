# Read-only IFC link spike (#202)

Related: [#202](https://github.com/Frederik91/bim-forge/issues/202), parent [#197](https://github.com/Frederik91/bim-forge/issues/197).

## Proposed integration contract

`build_link(source, output, *, namespace, revision, occurrence, transform, limits, cancelled, progress)` retains original IFC bytes and returns a version 1 manifest. The manifest pins source lineage (`namespace`), caller revision and original SHA-256. A separate link occurrence has an ID and a rigid, row-major 4x4 matrix from source metres to project metres, using column vectors. Derived data never changes the original or becomes native model authority.

Source object references contain namespace, revision, original SHA-256 and IFC GlobalId. Occurrence selection adds the occurrence ID. STEP numbers are diagnostic pointers inside that exact original only. Missing, malformed or duplicate root GlobalIds reject the index; no STEP-number identity fallback is allowed.

The proposed artifacts are `original.ifc`, `index.json`, `geometry.json`, and `manifest.json`. The original is authoritative; JSON artifacts are disposable. Index entries retain object identity, direct and type property ownership, containment/decomposition and relationship diagnostics. Geometry contains local metre vertices, triangle indices and an explicit product-to-source matrix. Map conversion and target CRS stay visible and unapplied. No certified survey transformation is implied.

## Owned implementation and acceptance plan

| File | Responsibility | Acceptance evidence |
| --- | --- | --- |
| `experiments/ifc-link/link.py` | Bounded original retention, index, placements, geometry and manifest | Source-bound hashes, explicit losses, complete/failure state |
| `experiments/ifc-link/fixture.py` | Reuse the existing W2 synthetic IFC writer | Deterministic permitted tiny IFC with unfamiliar property |
| `experiments/ifc-link/test_link.py` | User-visible import/index behavior | Missing/duplicate ID, properties, unit/placement safety, cancel/budget failures |
| This document | Public seam, execution evidence and limits | Exact server source/dependencies/commands/results |

Only IFC4 metre/mm sources and bounded nested local placements are intended for the first slice. Production source schemas, server, root package, native graph and single `ModelViewer` remain parent-owned. No runtime integration, database migration, viewer replacement or bulk native import belongs to this spike.

## Grounding

The existing [W2 IFC experiment](../../experiments/ifc/README.md) generates real IFC4 files and checks exchange fidelity, including an explicitly unmapped bounded property. This spike reuses its synthetic writer and retained IfcOpenShell 0.9.0.post1 dependencies without treating historical experiment results as link qualification. The [viewer benchmark](../../benchmarks/viewer/README.md) keeps render IDs and model authority separate; no renderer is adopted here.

Primary references: [buildingSMART GlobalId definition](https://standards.buildingsmart.org/IFC/DEV/IFC4_3/HTML/lexical/IfcGloballyUniqueId.html), [IfcOpenShell geometry processing](https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html), and [pinned placement implementation](https://github.com/IfcOpenShell/IfcOpenShell/blob/v0.9.0/src/ifcopenshell-python/ifcopenshell/util/placement.py). GlobalIds use the compressed 22-character encoding; geometry uses local vertices and a product transform. Neither fact establishes stable identity across arbitrary vendor exports or engineering correctness.
