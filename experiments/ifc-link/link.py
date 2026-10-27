"""Bounded, read-only IFC4 link preparation. Run only in an isolated worker."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.shape
import numpy as np

PIN = "0.9.0.post1"
IDENTITY = [[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.], [0., 0., 0., 1.]]
GUID = re.compile(r"[0-3][0-9A-Za-z_$]{21}\Z")
TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")


class LinkError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class Limits:
    source_bytes: int = 2 * 1024 * 1024
    entities: int = 2000
    products: int = 64
    vertices: int = 50000
    triangles: int = 100000
    output_bytes: int = 8 * 1024 * 1024
    seconds: float = 30.

    def validate(self):
        for name, ceiling in asdict(Limits()).items():
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise LinkError("INVALID_LIMIT", name)
            if value <= 0 or value > ceiling or (name != "seconds" and not isinstance(value, int)):
                raise LinkError("INVALID_LIMIT", name)


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def rigid(value):
    try:
        matrix = np.asarray(value, dtype=float)
    except (ValueError, TypeError) as error:
        raise LinkError("UNSAFE_TRANSFORM", "Expected numeric 4x4 matrix") from error
    if matrix.shape != (4, 4) or not np.isfinite(matrix).all():
        raise LinkError("UNSAFE_TRANSFORM", "Expected finite 4x4 matrix")
    rotation = matrix[:3, :3]
    if (not np.allclose(matrix[3], [0, 0, 0, 1], atol=1e-9, rtol=0)
            or not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-9, rtol=0)
            or not math.isclose(float(np.linalg.det(rotation)), 1., abs_tol=1e-9, rel_tol=0)
            or np.max(np.abs(matrix[:3, 3])) > 1e6):
        raise LinkError("UNSAFE_TRANSFORM", "Only right-handed rigid transforms within 1e6 metres")
    return matrix


def axis_matrix(axis, scale):
    if not axis or not axis.is_a("IfcAxis2Placement3D"):
        raise LinkError("UNSUPPORTED_PLACEMENT", "Only IfcAxis2Placement3D")
    try:
        origin = np.asarray(axis.Location.Coordinates, dtype=float)
        x = np.asarray(axis.RefDirection.DirectionRatios if axis.RefDirection else [1, 0, 0], dtype=float)
        z = np.asarray(axis.Axis.DirectionRatios if axis.Axis else [0, 0, 1], dtype=float)
        if any(v.shape != (3,) or not np.isfinite(v).all() for v in (origin, x, z)):
            raise ValueError("nonfinite or non-3D axes")
        if np.linalg.norm(x) < 1e-12 or np.linalg.norm(z) < 1e-12:
            raise ValueError("zero axis")
        x, z = x / np.linalg.norm(x), z / np.linalg.norm(z)
        if abs(float(x @ z)) > 1e-9:
            raise ValueError("nonorthogonal axes")
        result = np.eye(4)
        result[:3, :3] = np.column_stack((x, np.cross(z, x), z))
        result[:3, 3] = origin * scale
        return rigid(result)
    except (TypeError, ValueError, AttributeError) as error:
        raise LinkError("UNSAFE_PLACEMENT", str(error)) from error


def product_matrix(product, scale, checkpoint):
    current = product.ObjectPlacement
    chain, seen = [], set()
    while current:
        checkpoint()
        if current.id() in seen or len(chain) >= 32:
            raise LinkError("UNSAFE_PLACEMENT", "Cycle or depth >32 in placement chain")
        seen.add(current.id())
        if not current.is_a("IfcLocalPlacement"):
            raise LinkError("UNSUPPORTED_PLACEMENT", current.is_a())
        chain.append(axis_matrix(current.RelativePlacement, scale))
        current = current.PlacementRelTo
    result = np.eye(4)
    for matrix in reversed(chain):
        result = result @ matrix
    return rigid(result)


def raw(value):
    """Shallow source inventory: STEP references are confined to exact original bytes."""
    if isinstance(value, ifcopenshell.entity_instance):
        if value.id() == 0:
            return {"ifcType": value.is_a(), "value": raw(value.wrappedValue)}
        return {"sourceStep": value.id(), "ifcClass": value.is_a(),
                "globalId": getattr(value, "GlobalId", None)}
    if isinstance(value, (list, tuple)):
        return [raw(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        raise LinkError("NONFINITE_DATA", "Nonfinite IFC scalar")
    return value


def attributes(entity):
    return {key: raw(value) for key, value in entity.get_info().items() if key not in ("id", "type")}


def properties(owner, diagnose):
    sets = list(getattr(owner, "HasPropertySets", ()) or ())
    for relation in getattr(owner, "IsDefinedBy", ()):
        if relation.is_a("IfcRelDefinesByProperties"):
            sets.append(relation.RelatingPropertyDefinition)
    result = []
    for pset in sorted(sets, key=lambda p: p.id()):
        if not pset.is_a("IfcPropertySet"):
            diagnose("PROPERTY_SET_NOT_MAPPED", pset)
            result.append({"ifcClass": pset.is_a(), "raw": attributes(pset)})
            continue
        items = []
        for prop in pset.HasProperties:
            supported = prop.is_a() in ("IfcPropertySingleValue", "IfcPropertyListValue")
            if not supported:
                diagnose("PROPERTY_NOT_MAPPED", prop)
            items.append({"name": prop.Name, "ifcClass": prop.is_a(), "mapped": supported,
                          "raw": attributes(prop), "sourceStep": prop.id()})
        result.append({"globalId": pset.GlobalId, "name": pset.Name, "properties": items})
    return result


def prepare(model, binding, transform, limits, checkpoint, progress):
    if model.schema != "IFC4":
        raise LinkError("UNSUPPORTED_SCHEMA", model.schema)
    count = 0
    for _ in model:
        checkpoint()
        count += 1
        if count > limits.entities:
            raise LinkError("ENTITY_BUDGET", "IFC entity count exceeds limit")
    roots = model.by_type("IfcRoot")
    ids = set()
    for root in roots:
        guid = root.GlobalId
        if not isinstance(guid, str) or not GUID.fullmatch(guid):
            raise LinkError("INVALID_GLOBAL_ID", f"Invalid or missing GlobalId at source STEP {root.id()}")
        if guid in ids:
            raise LinkError("DUPLICATE_GLOBAL_ID", guid)
        ids.add(guid)
    projects = model.by_type("IfcProject")
    if len(projects) != 1 or not projects[0].UnitsInContext:
        raise LinkError("UNSAFE_UNITS", "Exactly one project with explicit units required")
    units = projects[0].UnitsInContext.Units
    lengths = [unit for unit in units if getattr(unit, "UnitType", None) == "LENGTHUNIT"]
    if (len(lengths) != 1 or not lengths[0].is_a("IfcSIUnit") or lengths[0].Name != "METRE"
            or lengths[0].Prefix not in (None, "MILLI")):
        raise LinkError("UNSAFE_UNITS", "Only explicit metre or millimetre units supported")
    scale = .001 if lengths[0].Prefix == "MILLI" else 1.
    contexts = model.by_type("IfcGeometricRepresentationContext", include_subtypes=False)
    if not contexts:
        raise LinkError("UNSUPPORTED_CONTEXT", "Missing 3D geometry context")
    for context in contexts:
        if (context.CoordinateSpaceDimension != 3
                or not np.allclose(axis_matrix(context.WorldCoordinateSystem, scale), np.eye(4), atol=1e-9, rtol=0)):
            raise LinkError("UNSUPPORTED_CONTEXT", "Only 3D identity world coordinate systems supported")
    diagnostics = []

    def diagnose(code, entity, detail=None):
        diagnostics.append({"code": code, "sourceStep": entity.id(), "ifcClass": entity.is_a(),
                            "globalId": getattr(entity, "GlobalId", None), "detail": detail})

    georef = [{"ifcClass": item.is_a(), "sourceStep": item.id(), "raw": attributes(item)}
              for kind in ("IfcCoordinateOperation", "IfcCoordinateReferenceSystem") for item in model.by_type(kind)]
    if georef:
        diagnose("GEOREFERENCE_UNAPPLIED", projects[0], "Source engineering frame only; no survey conversion")
    objects = []
    for owner in sorted(model.by_type("IfcObjectDefinition"), key=lambda obj: obj.GlobalId):
        checkpoint()
        objects.append({"ref": {**binding, "globalId": owner.GlobalId}, "ifcClass": owner.is_a(),
                        "name": owner.Name, "properties": properties(owner, diagnose)})
    relations, spatial = [], []
    mapped = {"IfcRelAggregates", "IfcRelContainedInSpatialStructure", "IfcRelDefinesByProperties", "IfcRelDefinesByType"}
    for relation in sorted(model.by_type("IfcRelationship"), key=lambda rel: rel.GlobalId):
        checkpoint()
        relations.append({"globalId": relation.GlobalId, "ifcClass": relation.is_a(), "raw": attributes(relation)})
        if relation.is_a() == "IfcRelAggregates":
            spatial.extend({"kind": "decomposition", "parent": relation.RelatingObject.GlobalId,
                            "child": child.GlobalId} for child in relation.RelatedObjects)
        elif relation.is_a() == "IfcRelContainedInSpatialStructure":
            spatial.extend({"kind": "containment", "parent": relation.RelatingStructure.GlobalId,
                            "child": child.GlobalId} for child in relation.RelatedElements)
        if relation.is_a() not in mapped:
            diagnose("RELATIONSHIP_NOT_MAPPED", relation)
    products = sorted(model.by_type("IfcProduct"), key=lambda product: product.GlobalId)
    if len(products) > limits.products:
        raise LinkError("PRODUCT_BUDGET", "Product count exceeds limit")
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", False)
    settings.set("convert-back-units", False)
    meshes, placements, vertex_count, triangle_count = [], [], 0, 0
    for number, product in enumerate(products):
        checkpoint()
        matrix = product_matrix(product, scale, checkpoint)
        placements.append({"globalId": product.GlobalId, "productToSourceMetres": matrix.tolist(),
                           "sourcePlacementStep": product.ObjectPlacement.id() if product.ObjectPlacement else None})
        progress({"phase": "geometry", "completed": number, "total": len(products), "globalId": product.GlobalId})
        checkpoint()
        if not product.Representation:
            diagnose("NO_REPRESENTATION", product)
            continue
        if not product.ObjectPlacement:
            raise LinkError("UNSAFE_PLACEMENT", "Represented product has no explicit placement")
        try:
            shape = ifcopenshell.geom.create_shape(settings, product)
        except RuntimeError as error:
            diagnose("GEOMETRY_NOT_CONVERTED", product, str(error)[:500])
            continue
        checkpoint()
        shape_matrix = ifcopenshell.util.shape.get_shape_matrix(shape)
        if not np.allclose(matrix, shape_matrix, atol=1e-7, rtol=0):
            raise LinkError("GEOMETRY_TRANSFORM_MISMATCH", product.GlobalId)
        vertices, faces = list(shape.geometry.verts), list(shape.geometry.faces)
        vertex_count += len(vertices) // 3
        triangle_count += len(faces) // 3
        if vertex_count > limits.vertices or triangle_count > limits.triangles:
            raise LinkError("GEOMETRY_BUDGET", "Total mesh size exceeds limit")
        if (not vertices or len(vertices) % 3 or len(faces) % 3 or not faces
                or any(not isinstance(i, int) or i < 0 or i >= len(vertices) // 3 for i in faces)):
            diagnose("INVALID_MESH", product)
            continue
        points = np.asarray(vertices).reshape((-1, 3))
        if not np.isfinite(points).all() or np.max(np.abs(points)) > 1e6:
            raise LinkError("UNSAFE_GEOMETRY", product.GlobalId)
        homogeneous = np.column_stack((points, np.ones(len(points))))
        source_points = (matrix @ homogeneous.T).T[:, :3]
        project_points = (transform @ matrix @ homogeneous.T).T[:, :3]
        if np.max(np.abs(project_points)) > 1e6:
            raise LinkError("UNSAFE_GEOMETRY", "Occurrence exceeds project coordinate envelope")
        meshes.append({"ref": {**binding, "globalId": product.GlobalId}, "verticesMetres": vertices,
                       "triangles": faces, "productToSourceMetres": matrix.tolist(),
                       "sourceBoundsMetres": [source_points.min(axis=0).tolist(), source_points.max(axis=0).tolist()],
                       "occurrenceBoundsMetres": [project_points.min(axis=0).tolist(), project_points.max(axis=0).tolist()]})
    index = {"source": binding, "schema": model.schema, "unitScaleToMetres": scale,
             "units": [{"ifcClass": unit.is_a(), "raw": attributes(unit)} for unit in units],
             "georeferencing": {"applied": False, "inventory": georef}, "objects": objects,
             "relationships": relations, "spatial": spatial, "placements": placements}
    geometry = {"source": binding, "frame": "source-engineering-metres", "meshes": meshes}
    return index, geometry, diagnostics, {"entities": count, "objects": len(objects), "products": len(products),
                                         "meshes": len(meshes), "vertices": vertex_count, "triangles": triangle_count}


def build_link(source, output, *, namespace, revision, occurrence, transform=IDENTITY,
               limits=Limits(), cancelled=lambda: False, progress=lambda event: None):
    """Own a NEW output directory; a completed manifest is the sole publication marker.

    Callbacks are trusted worker plumbing. Cancellation/deadlines are cooperative;
    a process/container supervisor must bound native parser and geometry calls.
    """
    limits.validate()
    for value in (namespace, revision, occurrence):
        if not isinstance(value, str) or not TOKEN.fullmatch(value):
            raise LinkError("INVALID_SCOPE", "Expected explicit bounded namespace/revision/occurrence tokens")
    transform = rigid(transform)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    binding = None

    def checkpoint():
        if cancelled():
            raise LinkError("CANCELLED", "Link preparation cancelled")
        if time.monotonic() - started > limits.seconds:
            raise LinkError("TIME_BUDGET", "Cooperative time budget exceeded")

    try:
        if importlib.metadata.version("ifcopenshell") != PIN:
            raise LinkError("DEPENDENCY_VERSION", f"Requires IfcOpenShell {PIN}")
        checkpoint()
        progress({"phase": "retain", "completed": 0, "total": 1})
        with Path(source).open("rb") as stream:
            data = stream.read(limits.source_bytes + 1)
        if len(data) > limits.source_bytes:
            raise LinkError("SOURCE_BUDGET", "Original exceeds admission byte limit")
        binding = {"namespace": namespace, "revision": revision, "originalSha256": digest(data)}
        (output / "original.ifc").write_bytes(data)
        progress({"phase": "index", "completed": 0, "total": 1})
        checkpoint()
        model = ifcopenshell.file.from_string(data.decode("utf-8"))
        checkpoint()
        index, geometry, diagnostics, counts = prepare(model, binding, transform, limits, checkpoint, progress)
        payloads = {"original.ifc": data, "index.json": encode(index), "geometry.json": encode(geometry)}
        manifest = {"format": "bim-forge-ifc-link", "version": 1, "state": "complete", "readOnly": True,
                    "source": binding, "schema": model.schema, "tool": {"ifcopenshell": PIN},
                    "occurrence": {"id": occurrence, "sourceToProjectMetres": transform.tolist()},
                    "artifacts": {name: {"sha256": digest(content), "bytes": len(content)} for name, content in payloads.items()},
                    "limits": asdict(limits), "counts": counts, "diagnostics": diagnostics,
                    "losses": ["Meshes tessellate source geometry; no parametric/native editing or roundtrip.",
                               "Index maps direct scalar/list properties, decomposition, containment and type references only.",
                               "Other relationships/properties remain source inventories, not interpreted native semantics.",
                               "Materials, styles, layers, quantities and non-object metadata are not fully indexed.",
                               "Georeferencing is retained but unapplied; source engineering frame is not survey qualification."]}
        manifest_bytes = encode(manifest)
        if sum(map(len, payloads.values())) + len(manifest_bytes) > limits.output_bytes:
            raise LinkError("OUTPUT_BUDGET", "Completed artifacts exceed output byte limit")
        for name in ("index.json", "geometry.json"):
            checkpoint()
            (output / name).write_bytes(payloads[name])
        progress({"phase": "publish", "completed": 0, "total": 1})
        checkpoint()
        pending = output / "manifest.pending"
        pending.write_bytes(manifest_bytes)
        pending.rename(output / "manifest.json")
        return manifest
    except Exception as error:
        receipt = {"state": "failed", "source": binding, "code": getattr(error, "code", "IMPORT_FAILED"),
                   "detail": str(error)[:1000], "published": False}
        (output / "failure.json").write_bytes(encode(receipt))
        raise


def verify_link(output):
    """Verify a trusted local preparation's artifact integrity before inspection."""
    output = Path(output)
    manifest = json.loads((output / "manifest.json").read_text())
    if (manifest.get("format") != "bim-forge-ifc-link" or manifest.get("version") != 1
            or manifest.get("state") != "complete" or manifest.get("readOnly") is not True
            or set(manifest["artifacts"]) != {"original.ifc", "index.json", "geometry.json"}):
        raise LinkError("INVALID_MANIFEST", "Expected complete v1 read-only manifest")
    for name, expected in manifest["artifacts"].items():
        data = (output / name).read_bytes()
        if expected != {"sha256": digest(data), "bytes": len(data)}:
            raise LinkError("ARTIFACT_MISMATCH", name)
    if manifest["source"]["originalSha256"] != manifest["artifacts"]["original.ifc"]["sha256"]:
        raise LinkError("SOURCE_MISMATCH", "Original hash differs from source binding")
    for name in ("index.json", "geometry.json"):
        if json.loads((output / name).read_text())["source"] != manifest["source"]:
            raise LinkError("SOURCE_MISMATCH", name)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--occurrence", required=True)
    parser.add_argument("--cancel-file", type=Path)
    args = parser.parse_args()
    result = build_link(args.source, args.output, namespace=args.namespace, revision=args.revision,
                        occurrence=args.occurrence, cancelled=lambda: bool(args.cancel_file and args.cancel_file.exists()),
                        progress=lambda event: print(json.dumps(event), flush=True))
    print(json.dumps({"state": result["state"], "counts": result["counts"]}))
