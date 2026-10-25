"""Coordinator-only server runner. Emits provisional case observations, never approval."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import re
import shutil
import sys
import traceback
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.validate
import jsonschema

from ifc_model import add_unfamiliar_bounded_property, direct_inputs, export_model, successive_direct_export
from step_reader import Reader

VARIANTS = ("m", "mm", "rotated-m", "rotated-mm")
LIMITS = [
    "Controlled generated IFC4 ADD2 TC1 fixture, not independent vendor exports; Revit not tested.",
    "Both candidates share IfcOpenShell serialization and geometry; stdlib STEP reader is independent but narrow.",
    "One partial space boundary, not a closed room shell, MVD qualification or thermal boundary calculation.",
    "Scalar/list property import retains authored geometry sidecar; no generic IFC-to-parametric-authoring reconstruction.",
    "Synthetic EPSG:25832 map transform, not certified survey/geodetic accuracy or a viewer test.",
    "Standalone observations require W0 validation and independent review; no engineering approval.",
]
GEOMETRY_TOLERANCE_M = 1e-6
SURVEY_TOLERANCE_M = 1e-6
VOLUME_TOLERANCE_M3 = 1e-6


def write_json(path: Path, value):
    with path.open("x", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True, default=str, allow_nan=False)
        handle.write("\n")


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def close(actual, expected, tolerance=1e-9):
    if isinstance(expected, (list, tuple)):
        return isinstance(actual, (list, tuple)) and len(actual) == len(expected) and all(close(a, b, tolerance) for a, b in zip(actual, expected, strict=True))
    return isinstance(actual, (int, float)) and math.isfinite(actual) and abs(actual - expected) <= tolerance


def property_key(item):
    return item["pset"], item["name"]


def expected_properties(model):
    return [{"ownerId": item["id"], "properties": sorted(item["properties"], key=property_key)}
            for item in [model["wallType"], *model["walls"]]]


def expected_local_corners(model, key):
    """Analytic oracle from the authored contract; does not call exporter/reader transforms."""
    u = 0.001 if model["lengthUnit"] == "mm" else 1.
    items = {item["id"]: item for item in [*model["walls"], model["opening"], model["space"]]}
    item = items[key]
    position = list(item["position"])
    if key == model["opening"]["id"]:
        host = items[model["opening"]["hostId"]]
        position = [x + y for x, y in zip(position, host["position"], strict=True)]
    angle = math.radians(model["storey"]["rotationDegrees"])
    c, s = math.cos(angle), math.sin(angle)
    ox, oy, oz = model["storey"]["origin"]
    length, width, height = item["size"]
    corners = []
    for x in (0., length):
        for y in (0., width):
            for z in (0., height):
                x, y, z = float(x), float(y), float(z)
                px, py, pz = x + position[0], y + position[1], z + position[2]
                corners.append([(ox + c * px - s * py) * u, (oy + s * px + c * py) * u, (oz + pz) * u])
    return corners


def expected_survey_corners(model, local_metres):
    # Map coordinates are in metres; scale converts source model units to target metres.
    source_unit = 0.001 if model["lengthUnit"] == "mm" else 1.
    m = model["map"]
    factor = m["scale"] / source_unit
    a, b = m["xAxisAbscissa"], m["xAxisOrdinate"]
    norm = math.hypot(a, b)
    a, b = a / norm, b / norm
    return [[m["eastings"] + factor * (a * x - b * y), m["northings"] + factor * (b * x + a * y), m["height"] + factor * z]
            for x, y, z in local_metres]


def semantic_errors(snapshot, model):
    errors = []
    expected_products = {"wall-a": "IFCWALL", "wall-b": "IFCWALL", "opening-a": "IFCOPENINGELEMENT", "space-a": "IFCSPACE"}
    if {key: value["kind"] for key, value in snapshot["products"].items()} != expected_products:
        errors.append("product identity/class inventory differs")
    # All fixture roots, including relationships and psets, must be present and unique.
    if len(snapshot["roots"]) != 27:
        errors.append(f"expected 27 IfcRoot identities, observed {len(snapshot['roots'])}")
    if snapshot["properties"] != expected_properties(model):
        errors.append("typed instance/type properties differ")
    if snapshot["unsupported"]:
        errors.append("unsupported property representation")
    relations = snapshot["relations"]
    if relations["void"] != ["wall-a", "opening-a"]:
        errors.append("opening host relationship differs")
    if relations["type"] != {"name": "Qualification wall type", "instances": ["wall-a", "wall-b"]}:
        errors.append("type assignment differs")
    if relations["boundary"] != ["space-a", "wall-a", ".PHYSICAL.", ".INTERNAL."]:
        errors.append("space boundary relationship differs")
    expected_spatial = sorted([
        {"parent": "W2 semantic slice", "children": ["site"]}, {"parent": "site", "children": ["building"]},
        {"parent": "building", "children": ["storey"]}, {"parent": "storey", "children": ["space-a"]},
    ], key=lambda x: x["parent"])
    if snapshot["spatial"] != expected_spatial or snapshot["contained"] != [{"storey": "storey", "elements": ["wall-a", "wall-b"]}]:
        errors.append("spatial aggregation/containment differs")
    u = 1000 if model["lengthUnit"] == "mm" else 1
    expected_outer = [[0, 0], [4 * u, 0], [4 * u, 3 * u], [0, 3 * u], [0, 0]]
    for index, surface in enumerate(relations["boundarySurfaces"]):
        expected_origin = [0, 0 if index == 0 else 0.2 * u, 0]
        if not close(surface["outer"], expected_outer) or surface["inner"] or not close(surface["frame"],
                [expected_origin, [1, 0, 0], [0, 0, 1], [0, -1, 0]]):
            errors.append("partial boundary surface differs")
    return errors


def coordinate_errors(snapshot, model):
    errors = []
    unit = 0.001 if model["lengthUnit"] == "mm" else 1.
    if snapshot["unitScale"] != unit:
        errors.append("length unit differs")
    m = model["map"]
    if not close(snapshot["mapConversion"], [m["eastings"], m["northings"], m["height"], m["xAxisAbscissa"], m["xAxisOrdinate"], m["scale"]]):
        errors.append("authoritative map conversion differs")
    items = {item["id"]: item for item in [*model["walls"], model["opening"], model["space"]]}
    if set(snapshot["products"]) != set(items):
        errors.append("product set differs")
    for key, product in snapshot["products"].items():
        if key not in items:
            continue
        expected = expected_local_corners(model, key)
        if not close(product["size"], items[key]["size"]):
            errors.append(f"{key}: authored dimensions rewritten")
        if not close(product["cornersMetres"], expected, GEOMETRY_TOLERANCE_M):
            errors.append(f"{key}: local SI placement/corners differ")
        if not close(product["surveyCornersMetres"], expected_survey_corners(model, expected), SURVEY_TOLERANCE_M):
            errors.append(f"{key}: survey transform differs")
    return errors


def mesh_measurements(path: Path):
    model = ifcopenshell.open(str(path))
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    measured = {}
    for kind in ("IfcWall", "IfcOpeningElement", "IfcSpace"):
        for product in model.by_type(kind):
            shape = ifcopenshell.geom.create_shape(settings, product)
            geometry = shape.geometry
            vertices = [geometry.verts[i:i + 3] for i in range(0, len(geometry.verts), 3)]
            faces = [geometry.faces[i:i + 3] for i in range(0, len(geometry.faces), 3)]
            if not vertices or not faces:
                raise ValueError(f"Empty evaluated geometry: {product.Name}")
            origin = vertices[0]
            tetrahedra = []
            for face in faces:
                a, b, c = [[vertices[index][axis] - origin[axis] for axis in range(3)] for index in face]
                tetrahedra.append((a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2])
                                   + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6)
            measured[product.Name] = {"volumeM3": abs(math.fsum(tetrahedra)),
                                      "boundsMetres": [[min(p[i] for p in vertices) for i in range(3)], [max(p[i] for p in vertices) for i in range(3)]],
                                      "vertexCount": len(vertices), "triangleCount": len(faces)}
    return measured


def geometry_errors(measured, model):
    u = 0.001 if model["lengthUnit"] == "mm" else 1.
    errors = []
    for item in [*model["walls"], model["opening"], model["space"]]:
        key = item["id"]
        volume = math.prod(item["size"]) * u ** 3
        if key == "wall-a":
            opening = model["opening"]
            volume -= opening["size"][0] * item["size"][1] * opening["size"][2] * u ** 3
        if key not in measured:
            errors.append(f"{key}: missing evaluated solid")
            continue
        if not close(measured[key]["volumeM3"], volume, VOLUME_TOLERANCE_M3):
            errors.append(f"{key}: evaluated volume {measured[key]['volumeM3']} != {volume}")
        corners = expected_local_corners(model, key)
        bounds = [[min(p[i] for p in corners) for i in range(3)], [max(p[i] for p in corners) for i in range(3)]]
        if not close(measured[key]["boundsMetres"], bounds, GEOMETRY_TOLERANCE_M):
            errors.append(f"{key}: evaluated world bounds differ")
    return errors


class Observations:
    def __init__(self):
        self.rows = []

    def check(self, experiment, case, expected, action, limitations=()):
        try:
            errors = action()
            observed = "checks satisfied" if not errors else "; ".join(errors)
            passed = not errors
        except Exception:
            observed = traceback.format_exc()
            passed = False
        self.rows.append({"experimentId": experiment, "caseId": case, "expected": expected, "observed": observed,
                          "passed": passed, "limitations": [*LIMITS, *limitations]})


def schema_check(path, report):
    model = ifcopenshell.open(str(path))
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model, logger, express_rules=True)
    write_json(report, logger.statements)
    return [] if not logger.statements else [f"{len(logger.statements)} schema/EXPRESS diagnostic(s); see {report.name}"]


def validate_input(model, schema):
    jsonschema.Draft202012Validator(schema).validate(model)
    return model


def paired_errors(first, second):
    errors = []
    if first["roots"] != second["roots"]:
        errors.append("root GUID/class/name identity changed across exports")
    for field in ("properties", "unsupported", "relations", "contained", "spatial", "unitScale", "mapConversion"):
        if first[field] != second[field]:
            errors.append(f"unexpected change: {field}")
    changed = sorted(key for key in first["products"] if first["products"][key] != second["products"].get(key))
    if changed != ["wall-a"]:
        errors.append(f"expected only wall-a changed, found {changed}")
    return errors


def manifest(output, name="manifest.json"):
    artifacts = []
    for path in sorted(output.rglob("*")):
        if path.is_file() and path != output / name:
            artifacts.append({"path": path.relative_to(output).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size})
    write_json(output / name, {"artifacts": artifacts, "authority": "provisional-standalone; W0 writer/review pending"})


def prepare(inputs: Path, output: Path, source_commit: str):
    output.mkdir(parents=True, exist_ok=False)
    shutil.copytree(inputs, output / "inputs")
    observations = Observations()
    schema = load(inputs / "native-model.schema.json")
    write_json(output / "environment.json", {"python": sys.version, "platform": platform.platform(),
        "packages": {name: importlib.metadata.version(name) for name in ("ifcopenshell", "numpy", "jsonschema")},
        "schema": "IFC4 ADD2 TC1", "sourceCommit": source_commit, "contractCommit": "4fb723bc29a0fced971b3f4b2069e0fa31699a68", "provenance": "controlled-generated",
        "tolerances": {"geometryM": GEOMETRY_TOLERANCE_M, "surveyM": SURVEY_TOLERANCE_M, "volumeM3": VOLUME_TOLERANCE_M3}, "limitations": LIMITS})
    snapshots = {}
    try:
        if importlib.metadata.version("ifcopenshell") != "0.9.0.post1":
            raise ValueError("The run requires the pinned IfcOpenShell 0.9.0.post1 engine")
        source_fixture_hash = hashlib.sha256((inputs / "w0-source.json").read_bytes()).hexdigest()
        for candidate in ("native-authoring", "ifc-native"):
            directory = output / candidate
            directory.mkdir()
            for variant in VARIANTS:
                for revision in (1, 2):
                    tag = f"{variant}-r{revision}"
                    source = inputs / f"{tag}.json"
                    expected = validate_input(load(source), schema)
                    if expected["basis"]["sha256"] != source_fixture_hash:
                        raise ValueError("Native source is not bound to the retained W0 fixture bytes")
                    path = directory / f"{tag}.ifc"
                    if candidate == "native-authoring":
                        export_model(expected, candidate, path)
                    elif revision == 1:
                        export_model(direct_inputs(variant), candidate, path)
                    else:
                        successive_direct_export(directory / f"{variant}-r1.ifc", path)
                    case = f"{candidate}/{tag}"
                    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                    try:
                        snapshot = Reader.open(path).snapshot()
                    except Exception:
                        failure = traceback.format_exc()
                        observations.check("EX-02", f"{case}/step-reader", "Independent parser reads every admitted record", lambda: [failure])
                        continue
                    snapshots[(candidate, variant, revision)] = snapshot
                    write_json(directory / f"{tag}.snapshot.json", snapshot)
                    observations.check("EX-02", f"{case}/semantic-contract", "IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained", lambda: semantic_errors(snapshot, expected))
                    observations.check("EX-08", f"{case}/coordinates", "Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances", lambda: coordinate_errors(snapshot, expected))
                    def evaluate_geometry():
                        measured = mesh_measurements(path)
                        write_json(directory / f"{tag}.mesh.json", measured)
                        return geometry_errors(measured, expected)
                    observations.check("EX-08", f"{case}/real-kernel", "Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds", evaluate_geometry)
                def check_pair():
                    first = snapshots[(candidate, variant, 1)]
                    second = snapshots[(candidate, variant, 2)]
                    delta = {"provenance": "controlled-generated; not vendor export", "first": f"{variant}-r1.ifc", "second": f"{variant}-r2.ifc",
                             "changedObject": "wall-a", "firstLength": first["products"]["wall-a"]["size"][0],
                             "secondLength": second["products"]["wall-a"]["size"][0], "identityCount": len(first["roots"]),
                             "errors": paired_errors(first, second)}
                    write_json(directory / f"{variant}.pair.json", delta)
                    return delta["errors"]
                observations.check("EX-02", f"{candidate}/{variant}/successive-exports", "Two actual exports retain all GlobalIds and change only wall-a dimensions", check_pair,
                                   ["Paired fixture supports EX-01 generated-source cases only; no source ID churn guarantees for vendors."])
        for variant in VARIANTS:
            for revision in (1, 2):
                observations.check("EX-02", f"{variant}-r{revision}/candidate-parity", "Independent reader sees identical narrow logical models for both candidates",
                    lambda v=variant, r=revision: [] if snapshots[("native-authoring", v, r)] == snapshots[("ifc-native", v, r)] else ["candidate snapshots differ"])
        for candidate in ("native-authoring", "ifc-native"):
            for prefix in ("", "rotated-"):
                def compare_units():
                    metres = snapshots[(candidate, f"{prefix}m", 1)]
                    millimetres = snapshots[(candidate, f"{prefix}mm", 1)]
                    errors = []
                    if canonical_hash(metres) == canonical_hash(millimetres):
                        errors.append("exact canonical snapshot hashes unexpectedly equal despite different authoritative units")
                    for key in metres["products"]:
                        for field in ("cornersMetres", "surveyCornersMetres"):
                            if not close(metres["products"][key][field], millimetres["products"][key][field], SURVEY_TOLERANCE_M):
                                errors.append(f"{key}/{field}: physical equivalence fails")
                    write_json(output / f"{candidate}-{prefix}unit-comparison.json", {"metresExactCanonicalSha256": canonical_hash(metres),
                        "millimetresExactCanonicalSha256": canonical_hash(millimetres), "errors": errors,
                        "note": "Exact canonical JSON hash is distinct from tolerance-aware geometry equivalence."})
                    return errors
                observations.check("EX-08", f"{candidate}/{prefix}m-vs-mm", "Different exact canonical hashes, equivalent physical corners without viewer-origin rewriting", compare_units)
        source = output / "ifc-native" / "rotated-mm-r1.ifc"
        inventory, unsupported = Reader.open(source).property_inventory()
        write_json(output / "property-inventory.json", inventory)
        write_json(output / "property-import-source.json", {"source": source.relative_to(output).as_posix(), "unmapped": unsupported})
        adversarial = output / "ifc-native" / "unfamiliar-bounded.ifc"
        add_unfamiliar_bounded_property(source, adversarial)
        inventory, unsupported = Reader.open(adversarial).property_inventory()
        write_json(output / "bounded-property-inventory.json", inventory)
        write_json(output / "bounded-loss-report.json", {"source": adversarial.relative_to(output).as_posix(), "unmapped": unsupported,
            "originalSourceBytesRetained": True, "sourceSha256": hashlib.sha256(adversarial.read_bytes()).hexdigest(),
            "unfamiliarMappedProperties": [dict(ownerId=item["ownerId"], **prop) for item in inventory for prop in item["properties"] if prop["pset"] == "Vendor_Unknown"],
            "transformLosses": ["Native property overlay retains the authored geometry sidecar; authoring intent cannot be reconstructed from IFC geometry.",
                                "Unsupported property is absent from native scalar/list representation and its re-export; original IFC is retained for review."]})
        observations.check("EX-02", "unfamiliar-bounded/detected", "Unfamiliar bounded property is explicit in loss inventory with original source bytes retained",
            lambda: [] if len(unsupported) == 1 and unsupported[0]["name"] == "UnfamiliarRange" else ["bounded property not exactly inventoried"])
    except Exception:
        failure = traceback.format_exc()
        observations.check("EX-02", "runner-incomplete", "All preparation stages execute", lambda: [failure])
    write_json(output / "core-observations.json", observations.rows)
    write_json(output / "prepare-state.json", {"phase": "prepared", "roundtripPending": True, "authoritativeResult": False})
    manifest(output)
    # Preserve failed observations. Exit 1 is evidence, not permission to drop failed cases.
    return 0 if observations.rows and all(row["passed"] for row in observations.rows) else 1


def roundtrip(inputs: Path, output: Path):
    directory = output / "roundtrip"
    directory.mkdir(exist_ok=False)
    observations = Observations()
    schema = load(inputs / "native-model.schema.json")
    original = Reader.open(output / "ifc-native" / "rotated-mm-r1.ifc").snapshot()
    for name in ("native-roundtrip", "bounded-native-roundtrip"):
        def check_import():
            model = validate_input(load(output / f"{name}.json"), schema)
            target = directory / f"{name}.ifc"
            export_model(model, "native-authoring-property-overlay", target)
            snapshot = Reader.open(target).snapshot()
            write_json(directory / f"{name}.snapshot.json", snapshot)
            expected = load(inputs / "rotated-mm-r1.json")
            errors = semantic_errors(snapshot, expected) + coordinate_errors(snapshot, expected)
            if snapshot["roots"] != original["roots"]:
                errors.append("GlobalId/class/name identities differ after property import/re-export")
            if snapshot["properties"] != original["properties"]:
                errors.append("unfamiliar scalar/list metadata lost or changed")
            errors += schema_check(target, directory / f"{name}.validation.json")
            measured = mesh_measurements(target)
            write_json(directory / f"{name}.mesh.json", measured)
            return errors + geometry_errors(measured, expected)
        observations.check("EX-02", f"{name}/scalar-list-roundtrip", "Real IFC import via independent inventory -> TypeBox TS overlay -> IFC preserves declared slice", check_import)
    def native_bounded_loss():
        source = Reader.open(output / "ifc-native" / "unfamiliar-bounded.ifc").snapshot()
        target = Reader.open(directory / "bounded-native-roundtrip.ifc").snapshot()
        return [] if source["unsupported"] == target["unsupported"] else ["UnfamiliarRange lost from native IFC re-export; explicitly reported in bounded-loss-report.json; original source bytes retained"]
    observations.check("EX-02", "bounded-native-roundtrip/full-unfamiliar-preservation", "Every unfamiliar property survives in the re-exported IFC, including bounded values", native_bounded_loss,
                       ["Expected capability limit: native property union currently maps scalar/list only; preserve this failed case."])
    def direct_bounded_roundtrip():
        source = output / "ifc-native" / "unfamiliar-bounded.ifc"
        target = directory / "bounded-ifc-native-roundtrip.ifc"
        model = ifcopenshell.open(str(source))
        model.write(str(target))
        original_snapshot = Reader.open(source).snapshot()
        roundtrip_snapshot = Reader.open(target).snapshot()
        write_json(directory / "bounded-ifc-native-roundtrip.snapshot.json", roundtrip_snapshot)
        return ([] if original_snapshot == roundtrip_snapshot else ["IFC-native bounded property roundtrip differs"]) + schema_check(target, directory / "bounded-ifc-native-roundtrip.validation.json")
    observations.check("EX-02", "bounded-ifc-native-roundtrip/full-unfamiliar-preservation", "Direct IFC-native reserialization preserves unfamiliar bounded value entity and typed attributes", direct_bounded_roundtrip)
    write_json(directory / "observations.json", observations.rows)
    write_json(directory / "all-observations.json", [*load(output / "core-observations.json"), *observations.rows])
    manifest(directory)
    manifest(output, "final-manifest.json")
    return 0 if all(row["passed"] for row in observations.rows) else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "roundtrip"))
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-commit", help="Exact 40-character source Git commit; required for prepare")
    args = parser.parse_args()
    if args.phase == "prepare":
        if not args.source_commit or not re.fullmatch(r"[a-f0-9]{40}", args.source_commit):
            parser.error("prepare requires --source-commit with the exact source Git commit")
        return prepare(args.inputs, args.output, args.source_commit)
    return roundtrip(args.inputs, args.output)


if __name__ == "__main__":
    raise SystemExit(main())
