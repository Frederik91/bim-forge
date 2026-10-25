"""EX-07 bounded real OCCT split/history experiment. Never imports product code."""

import argparse
import hashlib
import importlib.metadata
import json
import platform
import sys
import traceback
from pathlib import Path


EXPECTED = {
    "occt-real-face-split": "A valid OCCT box is split by a real plane: 6 initial faces, more final faces, and exactly two top-face history successors.",
    "occt-raw-index-reference": "The original top-face index loses its original meaning; the guarded attachment stays pending with no chosen successor.",
    "occt-datum-ambiguity": "Top-plane datum alone finds two successors and returns pending, with no arbitrary attachment.",
    "occt-semantic-anchor": "Top datum plus an interior point resolves exactly one successor and preserves that physical anchor.",
    "occt-boundary-anchor-pending": "An anchor on the split boundary finds two faces and stays pending with no chosen successor.",
    "occt-reordered-traversal": "Repackaging actual result faces in rotated order changes raw index identity while the interior semantic anchor resolves the same OCCT face.",
}
LIMITATIONS = [
    "One planar box split, one datum and two points; not a general topological naming solution or parametric kernel.",
    "Explicit traversal permutation uses a compound of actual OCCT result faces; it is an adversarial traversal-order case, not a second Boolean edit.",
    "No persistence/reload, fillets, curved faces, tolerance sweep, IFC export, Revit API or production authoring integration.",
]


def json_write(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write("\n")


def run_kernel(output, raw):
    # Import failures are recorded as failed observations; no fallback engine.
    import OCP
    from OCP.BRep import BRep_Builder
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter
    from OCP.BRepBndLib import BRepBndLib
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepClass import BRepClass_FaceClassifier
    from OCP.BRepGProp import BRepGProp
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
    from OCP.BRepTools import BRepTools
    from OCP.Bnd import Bnd_Box
    from OCP.GeomAbs import GeomAbs_Plane
    from OCP.GProp import GProp_GProps
    from OCP.TopAbs import TopAbs_FACE, TopAbs_IN, TopAbs_ON
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedMapOfShape, TopTools_ListOfShape
    from OCP.TopoDS import TopoDS, TopoDS_Compound
    from OCP.gp import gp_Dir, gp_Pln, gp_Pnt

    tolerance = 1e-7  # Shape dimensions and classifier points are in millimetres.
    raw["environment"].update({
        "cadqueryOcp": importlib.metadata.version("cadquery-ocp"),
        "cadqueryOcpProxy": importlib.metadata.version("cadquery-ocp-proxy"),
        "vtk": importlib.metadata.version("vtk"),
        "ocpReportedVersion": str(getattr(OCP, "__version__", "unavailable")),
        "toleranceMm": tolerance,
    })

    def faces(shape):
        indexed = TopTools_IndexedMapOfShape()
        TopExp.MapShapes_s(shape, TopAbs_FACE, indexed)
        return [TopoDS.Face_s(indexed.FindKey(i)) for i in range(1, indexed.Extent() + 1)]

    def datum(face):
        surface = BRepAdaptor_Surface(face)
        if surface.GetType() != GeomAbs_Plane:
            return False
        plane = surface.Plane()
        return abs(plane.Location().Z() - 2.0) <= tolerance and abs(abs(plane.Axis().Direction().Z()) - 1) <= tolerance

    def descriptor(face, index):
        bounds = Bnd_Box()
        BRepBndLib.Add_s(face, bounds, False)
        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(face, props)
        center = props.CentreOfMass()
        return {"indexZeroBased": index, "areaMm2": props.Mass(), "boundsMm": list(bounds.Get()),
                "centroidMm": [center.X(), center.Y(), center.Z()], "topDatum": datum(face)}

    def resolve_indices(indices):
        # No nearest/first/lowest-index fallback. Boundaries are ambiguous too.
        return {"status": "resolved" if len(indices) == 1 else "pending",
                "candidateCount": len(indices), "candidates": indices, "chosen": indices[0] if len(indices) == 1 else None}

    def anchored(face_list, point):
        indices = []
        for index, face in enumerate(face_list):
            if not datum(face):
                continue
            classifier = BRepClass_FaceClassifier(face, gp_Pnt(*point), tolerance)
            if classifier.State() in (TopAbs_IN, TopAbs_ON):
                indices.append(index)
        return resolve_indices(indices)

    box = BRepPrimAPI_MakeBox(10.0, 8.0, 2.0).Shape()
    before = faces(box)
    initial_top = [i for i, face in enumerate(before) if datum(face)]
    if len(initial_top) != 1:
        raise RuntimeError(f"Expected one baseline top face, found {initial_top}")
    old_index = initial_top[0]
    top = before[old_index]
    raw["before"] = [descriptor(face, i) for i, face in enumerate(before)]
    BRepTools.Write_s(box, str(output / "before.brep"))
    before_hash = hashlib.sha256((output / "before.brep").read_bytes()).hexdigest()
    tool = BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(5, 0, 0), gp_Dir(1, 0, 0)), -20, 20, -20, 20).Face()
    arguments = TopTools_ListOfShape()
    arguments.Append(box)
    tools = TopTools_ListOfShape()
    tools.Append(tool)
    splitter = BRepAlgoAPI_Splitter()
    splitter.SetArguments(arguments)
    splitter.SetTools(tools)
    splitter.SetNonDestructive(True)
    splitter.SetToFillHistory(True)
    splitter.Build()
    if not splitter.IsDone():
        raise RuntimeError("OCCT splitter did not complete")
    result = splitter.Shape()
    if result.IsNull():
        raise RuntimeError("OCCT splitter produced a null shape")
    after = faces(result)
    raw["faceCounts"] = {"before": len(before), "after": len(after)}
    raw["after"] = [descriptor(face, i) for i, face in enumerate(after)]
    modified = [shape for shape in splitter.Modified(top) if shape.ShapeType() == TopAbs_FACE]
    successors = [i for i, face in enumerate(after) if any(face.IsSame(shape) for shape in modified)]
    top_indices = [i for i, face in enumerate(after) if datum(face)]
    raw["history"] = {"originalIndexZeroBased": old_index, "modifiedCount": len(modified),
                      "successorIndices": successors, "deleted": bool(splitter.IsDeleted(top)),
                      "generatedCount": splitter.Generated(top).Size()}
    BRepTools.Write_s(result, str(output / "after.brep"))
    BRepTools.Write_s(box, str(output / "baseline-after-operation.brep"))
    unchanged = before_hash == hashlib.sha256((output / "baseline-after-operation.brep").read_bytes()).hexdigest()
    valid_before = bool(BRepCheck_Analyzer(box).IsValid())
    valid_after = bool(BRepCheck_Analyzer(result).IsValid())
    raw["validity"] = {"before": valid_before, "after": valid_after, "baselineBrepUnchanged": unchanged}

    raw_face = after[old_index] if old_index < len(after) else None
    # The unsafe comparator shows what indexing alone would pick. It never
    # becomes an attachment: a split history must resolve uniquely first.
    safe_raw = resolve_indices(successors)
    raw["rawIndex"] = {"naiveFace": descriptor(raw_face, old_index) if raw_face is not None else None,
                       "naiveIsHistorySuccessor": raw_face is not None and any(raw_face.IsSame(shape) for shape in modified),
                       "guardedAttachment": safe_raw}
    raw["datumOnly"] = resolve_indices(top_indices)
    point = [2.0, 3.0, 2.0]
    boundary_point = [5.0, 3.0, 2.0]
    baseline_anchor = anchored(before, point)
    anchor = anchored(after, point)
    boundary = anchored(after, boundary_point)
    raw["anchors"] = {"interiorPointMm": point, "boundaryPointMm": boundary_point,
                      "baseline": baseline_anchor, "interior": anchor, "boundary": boundary}
    raw["rawIndex"]["naiveContainsInteriorAnchor"] = old_index in anchor["candidates"]

    # Rotate actual OCCT face objects in a new compound. This exercises a real
    # topology traversal order change without manufacturing mock geometry.
    reordered_shape = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(reordered_shape)
    # Choose the first nontrivial cyclic permutation putting a different real
    # face at the old raw index than the uniquely anchored physical face.
    shift = next(offset for offset in range(1, len(after)) if (old_index + offset) % len(after) != anchor["chosen"])
    for face in after[shift:] + after[:shift]:
        builder.Add(reordered_shape, face)
    reordered = faces(reordered_shape)
    reordered_anchor = anchored(reordered, point)
    same_anchor = (anchor["chosen"] is not None and reordered_anchor["chosen"] is not None
                   and after[anchor["chosen"]].IsSame(reordered[reordered_anchor["chosen"]]))
    changed_raw = old_index < len(reordered) and raw_face is not None and not raw_face.IsSame(reordered[old_index])
    raw["reordered"] = {"faces": [descriptor(face, i) for i, face in enumerate(reordered)],
                        "interior": reordered_anchor, "samePhysicalAnchor": same_anchor,
                        "rawIndexPhysicalFaceChanged": changed_raw, "naiveContainsInteriorAnchor": old_index in reordered_anchor["candidates"],
                        "cyclicShift": shift, "method": "cyclic-permutation-in-actual-face-compound"}
    raw["faceCounts"]["reordered"] = len(reordered)
    BRepTools.Write_s(reordered_shape, str(output / "reordered-faces.brep"))
    raw_changed = raw_face is None or abs(descriptor(raw_face, old_index)["areaMm2"] - descriptor(top, old_index)["areaMm2"]) > tolerance
    split_ok = (len(before) == 6 and len(after) > len(before) and valid_before and valid_after and unchanged
                and len(modified) == 2 and len(successors) == 2 and not splitter.IsDeleted(top)
                and set(successors) == set(top_indices))
    raw["checks"] = {
        "occt-real-face-split": split_ok,
        "occt-raw-index-reference": split_ok and raw_changed and safe_raw["status"] == "pending" and safe_raw["chosen"] is None,
        "occt-datum-ambiguity": split_ok and len(top_indices) == 2 and raw["datumOnly"]["chosen"] is None,
        "occt-semantic-anchor": split_ok and baseline_anchor["status"] == "resolved" and anchor["status"] == "resolved"
                                and anchor["chosen"] in successors,
        "occt-boundary-anchor-pending": split_ok and len(boundary["candidates"]) == 2
                                       and boundary["status"] == "pending" and boundary["chosen"] is None,
        "occt-reordered-traversal": split_ok and len(reordered) == len(after) and same_anchor and changed_raw
                                    and old_index not in reordered_anchor["candidates"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path, help="New directory with an existing parent; never overwritten")
    args = parser.parse_args()
    args.out.mkdir()  # Refuse reuse of an immutable run path.
    raw = {"environment": {"python": sys.version, "platform": platform.platform()}, "checks": {}}
    try:
        run_kernel(args.out, raw)
    except Exception:
        raw["error"] = traceback.format_exc()
    artifacts = []
    for path in sorted(args.out.glob("*.brep")):
        data = path.read_bytes()
        artifacts.append({"path": path.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    raw["artifacts"] = artifacts
    observed = json.dumps(raw, sort_keys=True, allow_nan=False)
    observations = [{"experimentId": "EX-07", "caseId": case_id, "expected": expected,
                     "observed": observed, "passed": bool(raw["checks"].get(case_id, False)) and "error" not in raw,
                     "limitations": LIMITATIONS} for case_id, expected in EXPECTED.items()]
    json_write(args.out / "topology-artifacts.json", raw)
    json_write(args.out / "observations.json", observations)
    print(json.dumps(observations, allow_nan=False))
    return 0 if all(entry["passed"] for entry in observations) else 1


if __name__ == "__main__":
    sys.exit(main())
