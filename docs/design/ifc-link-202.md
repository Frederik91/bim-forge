# Read-only IFC link spike (#202)

Related: [#202](https://github.com/Frederik91/bim-forge/issues/202), parent [#197](https://github.com/Frederik91/bim-forge/issues/197).

## Integration contract

`build_link(source, output, *, namespace, revision, occurrence, transform, limits, cancelled, progress)` retains original IFC bytes and returns a version 1 manifest. The manifest pins source lineage (`namespace`), caller revision and original SHA-256. A separate link occurrence has an ID and a rigid, row-major 4x4 matrix from source metres to project metres, using column vectors. Derived data never changes the original or becomes native model authority. `verify_link(output)` checks a trusted local preparation's artifact hashes, sizes and source binding before inspection; it is not an untrusted-manifest security boundary.

Source object references contain namespace, revision, original SHA-256 and IFC GlobalId. Occurrence selection adds the occurrence ID. STEP numbers are diagnostic pointers inside that exact original only. Missing, malformed or duplicate root GlobalIds reject the index; no STEP-number identity fallback is allowed.

The artifacts are `original.ifc`, `index.json`, `geometry.json`, and `manifest.json`. The original is authoritative; JSON artifacts are disposable. Index entries retain object identity, direct and type property ownership, containment/decomposition and relationship diagnostics. Type property sets remain on the type object rather than being flattened onto instances. Raw relationship references carry a source STEP pointer and GlobalId where available, under the index's exact source binding. Geometry contains local metre vertices, triangle indices and an explicit product-to-source matrix. Map conversion and target CRS stay visible and unapplied. No certified survey transformation is implied.

The caller supplies explicit bounded tokens for namespace, revision and occurrence. The complete source tuple is required even if a caller reuses a revision label. This experiment has no source-lineage registry or cross-export reconciliation service. A STEP-renumbering test confirms object GlobalIds remain the identity component while the new bytes get a new original hash and revision.

The output directory must be new. Publication writes `manifest.json` last with an atomic rename. Cancellation or failure retains `failure.json` and any already admitted original, without a completed manifest. Partial JSON files can remain and must not be consumed. Retrying uses a new directory. An over-limit source is rejected before retention. The completed artifact budget does not prevent retaining an admitted original and a small failure receipt when conversion fails.

## Owned implementation and acceptance plan

| File | Responsibility | Acceptance evidence |
| --- | --- | --- |
| `experiments/ifc-link/link.py` | Bounded original retention, index, placements, geometry and manifest | Source-bound hashes, explicit losses, complete/failure state |
| `experiments/ifc-link/fixture.py` | Reuse the existing W2 synthetic IFC writer | Deterministic permitted tiny IFC with unfamiliar property |
| `experiments/ifc-link/test_link.py` | User-visible import/index behavior | Missing/duplicate ID, properties, unit/placement safety, cancel/budget failures |
| This document | Public seam, execution evidence and limits | Exact server source/dependencies/commands/results |

Only IFC4 metre/mm sources and bounded nested local placements are supported in this slice. Exactly one project with explicit length units and 3D identity representation world contexts is required. Placements must be finite, right-handed and orthogonal, with no cycles and at most 32 nested local placements. Represented products need an explicit placement. Product transforms from the geometry engine must agree with independently assembled nested placement matrices within 1e-7. Lengths, translations and evaluated coordinates stay within a 1e6-metre envelope.

Production source schemas, server, root package, native graph and single `ModelViewer` remain parent-owned. No runtime integration, database migration, viewer replacement or bulk native import belongs to this spike. Existing native limits of 100 items, 32 revisions and 256 KiB are unchanged; the sidecar is not a route around native admission.

## Grounding

The existing [W2 IFC experiment](../../experiments/ifc/README.md) generates real IFC4 files and checks exchange fidelity, including an explicitly unmapped bounded property. This spike reuses its synthetic writer and retained IfcOpenShell 0.9.0.post1 dependencies without treating historical experiment results as link qualification. The [viewer benchmark](../../benchmarks/viewer/README.md) keeps render IDs and model authority separate; no renderer is adopted here.

Primary references: [buildingSMART GlobalId definition](https://standards.buildingsmart.org/IFC/DEV/IFC4_3/HTML/lexical/IfcGloballyUniqueId.html), [IfcOpenShell geometry processing](https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html), and [pinned placement implementation](https://github.com/IfcOpenShell/IfcOpenShell/blob/v0.9.0/src/ifcopenshell-python/ifcopenshell/util/placement.py). GlobalIds use the compressed 22-character encoding; geometry uses local vertices and a product transform. Neither fact establishes stable identity across arbitrary vendor exports or engineering correctness.

The seam was published [on #202 before implementation](https://github.com/Frederik91/bim-forge/issues/202#issuecomment-6446905466). Parent #197 owns integration and can review this experiment without taking a runtime dependency on it.

## Worker limits and reproduction

The installed IfcOpenShell version must be `0.9.0.post1`. Limits can be lowered but cannot exceed 2 MiB source bytes, 2,000 IFC entities, 64 products, 50,000 vertices, 100,000 triangles, 8 MiB completed artifacts and 30 seconds of cooperative processing. Parser and geometry calls are native and cannot be interrupted by the Python callbacks. A separate process/container supervisor is required for hard resource limits and termination. The retained run uses a 300-second outer timeout with a 10-second kill grace for the entire validation/test job, 0.5 CPU, 2 GiB memory with no additional swap, 128 processes, dropped capabilities and no network.

Progress events report retention, indexing, per-product geometry and publication. The CLI accepts a cancellation file; the Python API also accepts cancellation and progress callbacks. The tests cancel during geometry and immediately before publication. They verify that cancellation never publishes a complete manifest. This is worker plumbing, not a production background-job service or UI progress implementation.

Commands run only inside the isolated server container, with the retained venv at `/qualification/python` and pinned Python packages at `/python-deps`:

```sh
export PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/python-deps
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
PY=/qualification/python/bin/python
npm run validate
node scripts/validate-policy.ts --changed-files experiments/ifc-link/link.py experiments/ifc-link/fixture.py experiments/ifc-link/test_link.py docs/design/ifc-link-202.md
"$PY" -m unittest discover -s experiments/ifc-link -p 'test_*.py' -v
"$PY" experiments/ifc-link/fixture.py /evidence/fixture
"$PY" experiments/ifc-link/link.py /evidence/fixture/synthetic.ifc /evidence/prepared --namespace synthetic-residential --revision r1 --occurrence west
"$PY" -c 'import sys; sys.path.insert(0,"experiments/ifc-link"); from link import verify_link; print(verify_link("/evidence/prepared")["counts"])'
```

No dependency installation or image build is required. Tests create fresh synthetic IFCs through the existing W2 writer, add its unfamiliar bounded property, and fix the header timestamp. They do not read or modify earlier qualification outputs.

## Source-bound server evidence

Implementation source: `0e3d4b9d4286744fe88959d55f64c229590b03e2`, based on main `f59687e`. All three Python implementation/test files are unchanged by the later documentation commit. The successful run is `/ssd1/bim-forge-qualification/issue202-ifc-link-20261027-a03/`, from 2026-10-27 16:08:22 UTC to 16:08:45 UTC. It retains `source.bundle`, the detached clone, `run-a03.sh`, container inspect/final state, per-step logs, limits, checksums and generated artifacts under `evidence/`.

The retained image is `bim-qvm-tools:20261025`, ID `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`. The source and `/workspace/node_modules` are separate read-only mounts. Node dependencies come from `/ssd1/bim-forge-qualification/all-ready-195/final/dependencies`. Python comes from `/ssd1/bim-forge-qualification/qvm-20261025/python`; the read-only wheel directory is `/ssd1/bim-forge-qualification/qvm-20261025/w2-runs/w2-source-unit-c30979d-20261025-01/python-deps`. All 19 versions from `experiments/ifc/requirements.txt` matched. Evidence, cache, home and temporary files use this run's SSD directories. The worker runs as server UID/GID 1000, with no credential, application-data or database mount.

| Check | Result |
| --- | --- |
| Root `npm run validate` | PASS: strict TS checks 240 sources, root typecheck and policy |
| Policy with the four owned changed paths | PASS |
| Python behavior tests | 23 PASS, no failures or skips |
| Actual synthetic fixture and CLI preparation | PASS |
| Original/index/geometry hash and source-binding check | PASS |
| Container exit / OOM | 0 / false |
| Tracked source status before / after | Both clean |

Retained root validator output (`evidence/validate.log`):

```text
> bim-forge@0.1.0 validate
> npm run lint && npm run typecheck && node scripts/validate-policy.ts
> bim-forge@0.1.0 lint
> node scripts/validate-typescript.ts
Strict TypeScript valid. 240 source file(s) checked.
> bim-forge@0.1.0 typecheck
> tsc --noEmit
Policy valid. 0 changed file(s) checked.
```

Tests cover exact retained bytes, deterministic generation, lineage/revision/occurrence separation, STEP renumbering, missing/malformed/duplicate GlobalIds, unfamiliar scalar/list/bounded properties, spatial/type references, metre/mm equivalence, nested rotation and occurrence bounds, unapplied map conversion, unsafe units/axes/context/cycles/transforms, source/entity/product/vertex/triangle/output/time budgets, cancellation, artifact tampering and refusal to overwrite a previous run. A mocked geometry-engine error verifies the diagnostic path; it does not establish real unsupported-vendor geometry coverage. Other geometry checks use actual generated IFC and the retained kernel.

### Attempt ledger

The interactive owner authorized ten total attempts per item; global factory limits and validators are unchanged. Every run has a fresh directory and retained evidence.

| Attempt | Source | Result and inspected cause | Next change |
| --- | --- | --- | --- |
| `issue202-ifc-link-20261027-a01` | `0e3d4b9` | Failed before tests: root UID with dropped capabilities could not write the UID-1000 evidence directory; exit 1, no OOM | Run worker as host UID/GID 1000 |
| `issue202-ifc-link-20261027-a02` | `0e3d4b9` | Dependency check passed; root `tsc` was OOM-killed at the 1 GiB cap, exit 137, OOM true; link tests never ran | Raise this bounded worker to 2 GiB |
| `issue202-ifc-link-20261027-a03` | `0e3d4b9` | All seven steps passed; exit 0, OOM false | Document evidence and publish draft for review |

No code fix or validator change was needed after either environment failure. Cgroup `memory.peak` on the successful job was 1,249,894,400 bytes, which covers root validation and every child command, not isolated converter memory or a capacity benchmark.

### Inspectable original and conversion result

The generated original is 7,593 bytes, SHA-256 `a52ff45c732be3870dbcc368e7212d9736c6a6a536ba72901dccf05e083adfc5`. The actual manifest reports 153 IFC entities, 9 indexed objects, 7 products, 4 meshes, 40 vertices and 64 triangles. Its fixture contains two walls, an opening and a space, together with project/site/building/storey and a wall type. The output includes three expected no-representation diagnostics for the spatial containers.

The bounded property's lower/upper values 2/12 are visible as typed raw values with `mapped: false`. `IfcRelSpaceBoundary` and `IfcRelVoidsElement` are retained relationship inventories and explicitly uninterpreted. The map conversion retains eastings 500000 and northings 6600000, with `applied: false`. Source bounds for wall-b in the rotated mm fixture are approximately `[[7.9, 23.464101615, 3], [11.464101615, 25.637306696, 6]]` metres; tests compare these against an analytical rotation and against a separate metre export. A second test applies a 90-degree occurrence rotation and translation without changing source geometry.

| Artifact under `a03/evidence/prepared/` | Bytes | SHA-256 |
| --- | --- | --- |
| `original.ifc` | 7593 | `a52ff45c732be3870dbcc368e7212d9736c6a6a536ba72901dccf05e083adfc5` |
| `index.json` | 22223 | `9f63576ca7db68c0d7740ecbd5b7697c696b46eb303279a52576795c21300673` |
| `geometry.json` | 8653 | `e4db9f1d5dbd618c8522cb1cf27a764e5943f9f2c1ece624f491cd809f2c1e21` |

Manifest SHA-256: `df23b6746b29d8f89084c2c710df350a789cf5a20999fd1cacc78db70760279b`. Root validator log SHA-256: `12da7de0930f215cc493ec331a8affcf623f53062ea4ed065c7c3f0a117d403f`. Python test log SHA-256: `f71b577935b00be9ae9c8bd76cb8274895641a58cf16b54813c8c825e30d361f`.

## Parent integration boundary and remaining gaps

Future integration can add these disposable meshes to the existing single viewer. A selection must retain occurrence ID and the full source object reference. The inspector must show original revision/hash, typed properties, loss diagnostics and unapplied georeferencing. A request can cite that reference as read-only context; editing a native object still requires an isolated AI proposal and human review. Parent #197 owns any source-blob registry, access control, job queue, evidence schema or viewer adapter.

This spike does not provide production ingestion, paged indexing, revision matching, signed artifact trust, web serving, source privacy enforcement or a UI. It does not certify arbitrary IFC files, all property/relationship semantics, materials/styles/layers, survey coordinates, watertight geometry, independent geometry engines, native roundtrips or hospital scale. It uses a controlled synthetic fixture and records tessellation and mapping losses. Production model delta is zero. Nothing is merged or deployed, and the preview remains unchanged.
