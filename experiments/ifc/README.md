# W2: narrow IFC exchange and coordinates

Tracking: [#125](https://github.com/Frederik91/bim-forge/issues/125), parent [#122](https://github.com/Frederik91/bim-forge/issues/122). Implementation only; **no execution evidence is claimed**. W0 foundation: `4fb723bc29a0fced971b3f4b2069e0fa31699a68`. Draft PR waits for coordinator-supplied server validation. No preview, production model or deployment changes.

Plan and owned files:

| File | Purpose and acceptance evidence |
| --- | --- |
| `native.ts`, `native.test.ts`, `tsconfig.json` | Strict TypeScript native authoring fixture and property import overlay; TypeBox at JSON boundaries; derive seed dimensions from W0, preserve unfamiliar scalar/list data, reject dangling references |
| `ifc_model.py` | Real IfcOpenShell IFC4 writer, direct IFC-native fixture and actual reopened second export; stable UUIDv5-derived IFC GlobalIds |
| `step_reader.py`, `test_checks.py` | Independent stdlib STEP parsing, typed property inventory, spatial/type/void/boundary graph, nested placements and map conversion; corruption sensitivity checks |
| `run.py` | EX-02/EX-08 observations, EXPRESS validation, actual geometry kernel, immutable raw artifacts, deltas and loss inventory |
| `observations.ts` | W0 observation validation, experiment separation and exact registry-assertion coverage accounting; no terminal result or approval |
| `requirements.txt`, `Dockerfile` | Pinned server Python wheel environment; optional standalone Python container |

## Fixture and comparison

`native.ts generate` validates `experiments/fixtures/tiny-building.json` through W0 `parseFixture`, copies its exact bytes and records its SHA-256. This is a W2 extension, not a replacement shared fixture. It takes `shared-wall` dimensions, `door` dimensions/offset, and `office` extents. W2 names them `wall-a`, `opening-a`, `space-a`; adds a second distinct `wall-b`, shared wall type, typed properties, one boundary surface pair, and a coordinate probe hierarchy. It intentionally does not claim to export the complete W0 room arrangement, furniture or service graph. The direct IFC-native input is authored separately in Python against these pinned W0 v1 quantities; parity fails if the W0 quantities drift.

Both routes use IfcOpenShell serialization, with one project/site/building/storey, two wall instances of one type, a hosted opening, a space with one partial physical boundary, instance/type properties and spatial relationships. Native TS JSON maps into IFC using the Python external-tool adapter. The direct route holds IFC entities, writes revision 1, reopens that actual file and modifies only wall-a's rectangle/profile for revision 2. Wall length changes from 4 m to 5 m. Type, other occurrence, opening, boundary and all 27 root identities remain unchanged. The native route exports the two independently serialized authored revisions.

Every route produces metre/mm and 0°/30° storey-rotation variants. Placements nest under site/building/storey; the opening nests under its wall. The storey origin is (10, 20, 3) m. Map conversion uses eastings 500000 m, northings 6600000 m, height 100 m, axis (0.8, 0.6), and scale 1 or 0.001 into a metre target CRS. These are synthetic coordinates labelled EPSG:25832, not certified survey control. Independent analytic checks compare raw dimensions, local SI corners and survey corners. The real geometry engine checks world bounds and volumes, including opening subtraction. Geometry/survey tolerances are 1e-6 m and volume tolerance is 1e-6 m³; relative tolerances are not used.

Exact canonical JSON snapshot hashes retain authored units. Metre/mm snapshots must have different exact hashes while physical corners compare equal within tolerance. Nothing recentres authoritative coordinates for a viewer.

EX-01 consumers receive `native-authoring/<variant>-r1.ifc`, `-r2.ifc` and equivalent `ifc-native/` files, plus independent snapshots and `<variant>.pair.json` with a one-object delta. The manifests provide byte counts/hashes. These are **controlled generated successive exports**, not independent vendor exports, Revit results or proof of vendor GUID stability. GUIDs are qualification identities in a W2 UUID namespace, not production identity adoption.

## Unfamiliar data and losses

The slice maps unfamiliar `Vendor_Unknown` label, boolean and label-list properties, retaining exact names, value kinds and apostrophes. The reader emits a typed inventory. The TS importer overlays that inventory onto retained authored geometry inputs; re-export checks property, relationship, identity, coordinates, schema and evaluated geometry. It does not reconstruct arbitrary authored geometry from IFC solids.

An additional actual IFC source contains `IfcPropertyBoundedValue` (`UnfamiliarRange`, bounds 2 and 12). Its original `.ifc` bytes and hash, owner, pset/name, IFC class, STEP number and typed raw attributes are retained. Native scalar/list import reports that bounded value as unmapped and drops it from the re-export; `bounded-native-roundtrip/full-unfamiliar-preservation` must remain a **failed** capability observation if that loss occurs. Direct IFC-native reopen/write is separately checked for full preservation. `bounded-loss-report.json` reports this loss and the authoring-intent reconstruction limit. Missing diagnostics never count as preservation.

The STEP reader imports no IfcOpenShell code. It handles this ASCII IFC4 rectangular-extrusion slice and explicitly rejects unsupported STEP syntax, escape encodings, nonvertical extrusions, other profiles, nonorthogonal placements and unsupported units. Unmapped property forms are inventoried. It is not a general independent IFC engine. Both candidates still share the external serialization and geometry implementation. The server sensitivity tests mutate actual IFC units, map values, properties and host relations, and reject duplicate GUIDs and dangling STEP references.

## Coordinator server commands

No commands below have been run by this worker. The coordinator allocates a disposable server container/slot and retains stdout, stderr, exit statuses, exact source Git metadata and image identity. The prepared tools image is `bim-qvm-tools:20261025`, reported image ID `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`. Main owns verification of that image and mounts. Use its Node/dependency setup and Python 3.11 venv on `/ssd1`, mounted at `/qualification`; no root package-script changes are needed. `Dockerfile` is an optional Python 3.12 alternative, not a requirement to rebuild main's tools image.

Run in the server tools container, with the exact source clone at `/workspace`, root Node dependencies available, and an exclusive fresh run path. Install once as requested by the coordinator:

```sh
/qualification/venv/bin/python -m pip install --only-binary=:all: -r experiments/ifc/requirements.txt
/qualification/venv/bin/python -m pip freeze
```

If main uses another venv path, substitute it for `PY` below. Commands are sequential; retain a nonzero experiment exit and inspect its observations. Do not turn a failed capability into a successful assertion.

```sh
cd /workspace
export PYTHONDONTWRITEBYTECODE=1
PY=/qualification/venv/bin/python
RUN=/qualification/w2-runs/w2-125-REPLACE-WITH-UNIQUE-RUN-ID
SOURCE_COMMIT=$(git rev-parse HEAD)

npm run validate
./node_modules/.bin/tsc --project experiments/ifc/tsconfig.json --noEmit
node --test experiments/ifc/native.test.ts
"$PY" -m unittest discover -s experiments/ifc -p 'test_*.py' -v

node experiments/ifc/native.ts generate "$RUN-inputs"
"$PY" experiments/ifc/run.py prepare --inputs "$RUN-inputs" --output "$RUN" --source-commit "$SOURCE_COMMIT"

node experiments/ifc/native.ts import-properties "$RUN-inputs/rotated-mm-r1.json" "$RUN/property-inventory.json" "$RUN/native-roundtrip.json"
node experiments/ifc/native.ts import-properties "$RUN-inputs/rotated-mm-r1.json" "$RUN/bounded-property-inventory.json" "$RUN/bounded-native-roundtrip.json"
"$PY" experiments/ifc/run.py roundtrip --inputs "$RUN-inputs" --output "$RUN"

node experiments/contracts/cli.ts observations "$RUN/roundtrip/all-observations.json"
node experiments/ifc/observations.ts "$RUN/roundtrip/all-observations.json" "$RUN/review-bundle.json"
```

Run each stage under the coordinator's command harness that records exit status without discarding evidence. `prepare` returns 1 if a check fails; the coordinator can still inspect artifacts and run the remaining import stages if inventories exist. `roundtrip` is expected to return 1 when the bounded-property capability limit is observed. That expected limitation is a failed experiment observation, not a passing test. Reusing a run/output file is refused; after an interrupted attempt use a fresh run ID. A full successful pipeline produces 85 core observations plus 4 roundtrip observations; infrastructure/parser failure can produce fewer, which must remain incomplete coverage.

`manifest.json` hashes the prepared artifacts including retained input bytes. `roundtrip/manifest.json` hashes that phase. `final-manifest.json` hashes both phases and source/import artifacts existing at the end of Python execution. Later coordinator logs/review bundles need their own W0 artifact descriptions. `environment.json` requires the exact source commit and records package versions/tolerances, but is not a substitute for the coordinator's full environment record or source-bundle retention.

W0 `parseObservations` validates the final array. `observations.ts` creates a review bundle separating EX-02 and EX-08 and accounting for every **exact** bound registry assertion; it rejects changed definitions. It deliberately marks independent-reader/general loss coverage, certified coordinates and viewer behavior partial. Every observation retains the slice limitations, so W0 cannot publish either experiment as passed. The coordinator uses `bindingFor`, `sha256`, `describeArtifact`, `verifyRun` and `publishRun` with actual environment, times, source and validator evidence. Keep artifacts under a unique owned `docs/experiments/results/EX-02/<run-id>/` or durable checksummed storage and link them from the corresponding EX-08 record. Do not edit the registry or invent a terminal record from these instructions.

## Limits before review

Not run by this worker: dependency installation, TypeScript validation/tests, IFC generation, EXPRESS rules, kernel evaluation and server containers. All behavior above is implemented intent awaiting those checks. A real failure is valid failed evidence. No external vendor model, Revit, arbitrary IFC ingestion, closed space shell, complex B-rep, multi-engine geometry agreement, global geodesy, UI viewport rebasing, production model mutation or deployment is qualified. The comparison is sufficient to expose this slice's loss and mapping costs; it cannot select a complete authoring architecture on its own.

Primary references: [released IFC4 ADD2 TC1 EXPRESS, buildingSMART](https://github.com/buildingSMART/IFC4.3.x-development/blob/master/reference_schemas/IFC4_ADD2_TC1.exp), [IfcOpenShell 0.9.0.post1 wheel metadata](https://pypi.org/project/ifcopenshell/0.9.0.post1/), [IfcOpenShell validation](https://docs.ifcopenshell.org/ifcopenshell-python/validation.html), [geometry settings](https://docs.ifcopenshell.org/ifcopenshell/geometry_settings.html). The EXPRESS attribute positions and IFC class semantics are attributed to buildingSMART International; no custom/pre-release IFC schema is used.
