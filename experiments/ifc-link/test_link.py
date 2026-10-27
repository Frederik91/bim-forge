import hashlib
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ifcopenshell
import numpy as np

from fixture import synthetic_ifc
from ifc_model import guid
from link import IDENTITY, Limits, LinkError, build_link, verify_link


class LinkBehavior(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = synthetic_ifc(self.root / "fixture")
        self.output = self.root / "link"

    def build(self, **options):
        args = dict(namespace="synthetic-residential", revision="r1", occurrence="link-west")
        args.update(options)
        return build_link(self.source, self.output, **args)

    def mutate(self, edit):
        model = ifcopenshell.open(str(self.source))
        edit(model)
        model.write(str(self.source))

    def assert_failure(self, code, **options):
        original = self.source.read_bytes()
        with self.assertRaises(LinkError) as caught:
            self.build(**options)
        self.assertEqual(caught.exception.code, code)
        self.assertFalse((self.output / "manifest.json").exists())
        receipt = json.loads((self.output / "failure.json").read_text())
        self.assertEqual(receipt["code"], code)
        self.assertFalse(receipt["published"])
        self.assertEqual(self.source.read_bytes(), original)
        if code != "SOURCE_BUDGET" and receipt["source"]:
            self.assertEqual((self.output / "original.ifc").read_bytes(), original)

    def test_original_hash_scope_progress_and_deterministic_fixture(self):
        original = self.source.read_bytes()
        second = synthetic_ifc(self.root / "second")
        self.assertEqual(second.read_bytes(), original)
        progress = []
        manifest = self.build(progress=progress.append)
        self.assertEqual(verify_link(self.output), manifest)
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual((self.output / "original.ifc").read_bytes(), original)
        self.assertEqual(manifest["source"], {"namespace": "synthetic-residential", "revision": "r1",
                                           "originalSha256": hashlib.sha256(original).hexdigest()})
        self.assertEqual([p["phase"] for p in progress[:2]], ["retain", "index"])
        self.assertEqual(progress[-1]["phase"], "publish")
        self.assertGreater(manifest["counts"]["meshes"], 0)
        index = json.loads((self.output / "index.json").read_text())
        self.assertTrue(all(item["ref"] == {**manifest["source"], "globalId": item["ref"]["globalId"]}
                            for item in index["objects"]))

    def test_unfamiliar_properties_and_relationships_are_inspectable(self):
        manifest = self.build()
        index = json.loads((self.output / "index.json").read_text())
        wall = next(item for item in index["objects"] if item["ref"]["globalId"] == guid("wall-a"))
        vendor = next(pset for pset in wall["properties"] if pset["name"] == "Vendor_Unknown")
        props = {prop["name"]: prop for prop in vendor["properties"]}
        self.assertTrue(props["Flag"]["mapped"])
        self.assertEqual(props["Flag"]["raw"]["NominalValue"], {"ifcType": "IfcBoolean", "value": True})
        self.assertEqual(props["Layers"]["raw"]["ListValues"][1], {"ifcType": "IfcLabel", "value": "Maker's core"})
        self.assertFalse(props["UnfamiliarRange"]["mapped"])
        self.assertEqual(props["UnfamiliarRange"]["raw"]["LowerBoundValue"]["value"], 2.)
        self.assertEqual(props["UnfamiliarRange"]["raw"]["UpperBoundValue"]["value"], 12.)
        self.assertTrue(any(d["code"] == "PROPERTY_NOT_MAPPED" for d in manifest["diagnostics"]))
        self.assertTrue(any(d["code"] == "RELATIONSHIP_NOT_MAPPED" and d["ifcClass"] == "IfcRelVoidsElement"
                            for d in manifest["diagnostics"]))
        self.assertIn({"kind": "containment", "parent": guid("storey"), "child": guid("wall-a")}, index["spatial"])
        self.assertIn({"kind": "decomposition", "parent": guid("project"), "child": guid("site")}, index["spatial"])
        wall_type = next(item for item in index["objects"] if item["ref"]["globalId"] == guid("wall-type"))
        self.assertTrue(wall_type["properties"])
        self.assertTrue(any(rel["ifcClass"] == "IfcRelDefinesByType" for rel in index["relationships"]))

    def test_units_nested_rotation_geometry_and_occurrence_transform(self):
        transform = [[0., -1., 0., 100.], [1., 0., 0., 50.], [0., 0., 1., 0.], [0., 0., 0., 1.]]
        self.build(transform=transform)
        index = json.loads((self.output / "index.json").read_text())
        self.assertEqual(index["unitScaleToMetres"], .001)
        geometry = json.loads((self.output / "geometry.json").read_text())
        mesh = next(item for item in geometry["meshes"] if item["ref"]["globalId"] == guid("wall-b"))
        expected = [[7.9, 20 + 2 * math.sqrt(3), 3], [8 + 2 * math.sqrt(3), 22 + 2.1 * math.sqrt(3), 6]]
        np.testing.assert_allclose(mesh["sourceBoundsMetres"], expected, atol=1e-7, rtol=0)
        np.testing.assert_allclose(mesh["occurrenceBoundsMetres"],
                                   [[100 - expected[1][1], 50 + expected[0][0], 3],
                                    [100 - expected[0][1], 50 + expected[1][0], 6]], atol=1e-7, rtol=0)
        self.assertFalse(index["georeferencing"]["applied"])
        self.assertTrue(any(item["raw"].get("Eastings") == 500000 for item in index["georeferencing"]["inventory"]))
        metre_source = synthetic_ifc(self.root / "metre-fixture", "rotated-m")
        metre_out = self.root / "metre-link"
        build_link(metre_source, metre_out, namespace="synthetic-residential", revision="r1", occurrence="link-west", transform=transform)
        metre_mesh = next(item for item in json.loads((metre_out / "geometry.json").read_text())["meshes"]
                          if item["ref"]["globalId"] == guid("wall-b"))
        np.testing.assert_allclose(metre_mesh["sourceBoundsMetres"], mesh["sourceBoundsMetres"], atol=1e-7, rtol=0)

    def test_namespace_revision_and_occurrence_prevent_identity_aliasing(self):
        first = self.build()
        other = build_link(self.source, self.root / "other", namespace="other-lineage", revision="r2", occurrence="east")
        self.assertEqual(first["source"]["originalSha256"], other["source"]["originalSha256"])
        self.assertNotEqual(first["source"], other["source"])
        self.assertNotEqual(first["occurrence"]["id"], other["occurrence"]["id"])

    def test_step_renumbering_does_not_change_object_identity(self):
        self.build()
        first = json.loads((self.output / "index.json").read_text())["objects"]
        text = self.source.read_text()
        import re
        self.source.write_text(re.sub(r"#(\d+)", lambda match: "#" + str(int(match[1]) + 10000), text))
        other_out = self.root / "renumbered"
        build_link(self.source, other_out, namespace="synthetic-residential", revision="r2", occurrence="link-west")
        second = json.loads((other_out / "index.json").read_text())["objects"]
        self.assertEqual([obj["ref"]["globalId"] for obj in first], [obj["ref"]["globalId"] for obj in second])
        self.assertNotEqual(first[0]["ref"]["originalSha256"], second[0]["ref"]["originalSha256"])

    def test_missing_id_rejects_index_but_retains_original(self):
        self.mutate(lambda model: setattr(model.by_guid(guid("wall-a")), "GlobalId", None))
        self.assert_failure("INVALID_GLOBAL_ID")

    def test_malformed_id_rejects_index(self):
        self.mutate(lambda model: setattr(model.by_guid(guid("wall-a")), "GlobalId", "9" * 22))
        self.assert_failure("INVALID_GLOBAL_ID")

    def test_duplicate_id_rejects_without_overwriting_one_occurrence(self):
        self.mutate(lambda model: setattr(model.by_guid(guid("wall-b")), "GlobalId", guid("wall-a")))
        self.assert_failure("DUPLICATE_GLOBAL_ID")

    def test_unknown_unit_rejects_instead_of_assuming_metres(self):
        self.mutate(lambda model: setattr(next(u for u in model.by_type("IfcProject")[0].UnitsInContext.Units
                                               if u.UnitType == "LENGTHUNIT"), "Prefix", "CENTI"))
        self.assert_failure("UNSAFE_UNITS")

    def test_missing_units_rejects(self):
        self.mutate(lambda model: setattr(model.by_type("IfcProject")[0], "UnitsInContext", None))
        self.assert_failure("UNSAFE_UNITS")

    def test_placement_cycle_rejects_before_native_geometry(self):
        def edit(model):
            placement = model.by_guid(guid("wall-a")).ObjectPlacement
            placement.PlacementRelTo = placement
        self.mutate(edit)
        self.assert_failure("UNSAFE_PLACEMENT")

    def test_nonorthogonal_axes_rejects(self):
        def edit(model):
            model.by_guid(guid("wall-a")).ObjectPlacement.RelativePlacement.RefDirection.DirectionRatios = (1., 0., 1.)
        self.mutate(edit)
        self.assert_failure("UNSAFE_PLACEMENT")

    def test_zero_axis_rejects(self):
        def edit(model):
            model.by_guid(guid("wall-a")).ObjectPlacement.RelativePlacement.Axis.DirectionRatios = (0., 0., 0.)
        self.mutate(edit)
        self.assert_failure("UNSAFE_PLACEMENT")

    def test_nonidentity_world_context_rejects(self):
        def edit(model):
            model.by_type("IfcGeometricRepresentationContext", include_subtypes=False)[0].WorldCoordinateSystem.Location.Coordinates = (1., 0., 0.)
        self.mutate(edit)
        self.assert_failure("UNSUPPORTED_CONTEXT")

    def test_link_scaling_reflection_and_nonfinite_transform_rejects(self):
        for value in (2., -1., float("nan")):
            with self.subTest(value=value):
                matrix = [row[:] for row in IDENTITY]
                matrix[0][0] = value
                with self.assertRaises(LinkError) as caught:
                    self.build(transform=matrix)
                self.assertEqual(caught.exception.code, "UNSAFE_TRANSFORM")
                self.assertFalse(self.output.exists())

    def test_cancel_during_geometry_retains_original_without_publication(self):
        state = {"cancelled": False}
        def progress(event):
            state["cancelled"] = event["phase"] == "geometry"
        self.assert_failure("CANCELLED", cancelled=lambda: state["cancelled"], progress=progress)

    def test_cancel_at_publish_never_marks_partial_files_complete(self):
        state = {"cancelled": False}
        def progress(event):
            state["cancelled"] = event["phase"] == "publish"
        self.assert_failure("CANCELLED", cancelled=lambda: state["cancelled"], progress=progress)
        self.assertTrue((self.output / "geometry.json").exists())

    def test_time_budget_is_an_explicit_failure(self):
        with patch("link.time.monotonic", side_effect=[0., 2.]):
            self.assert_failure("TIME_BUDGET", limits=Limits(seconds=1.))

    def test_source_entity_product_mesh_and_output_budgets(self):
        cases = [(Limits(source_bytes=1), "SOURCE_BUDGET"), (Limits(entities=1), "ENTITY_BUDGET"),
                 (Limits(products=1), "PRODUCT_BUDGET"), (Limits(vertices=1), "GEOMETRY_BUDGET"),
                 (Limits(triangles=1), "GEOMETRY_BUDGET"), (Limits(output_bytes=1), "OUTPUT_BUDGET")]
        for number, (limits, code) in enumerate(cases):
            with self.subTest(code=code, number=number):
                self.output = self.root / f"budget-{number}"
                self.assert_failure(code, limits=limits)

    def test_caller_cannot_raise_unqualified_caps(self):
        with self.assertRaises(LinkError) as caught:
            self.build(limits=Limits(entities=1000000))
        self.assertEqual(caught.exception.code, "INVALID_LIMIT")
        self.assertFalse(self.output.exists())

    def test_geometry_conversion_failure_is_visible_without_fabricated_mesh(self):
        with patch("link.ifcopenshell.geom.create_shape", side_effect=RuntimeError("unsupported solid")):
            manifest = self.build()
        self.assertEqual(manifest["counts"]["meshes"], 0)
        self.assertTrue(any(d["code"] == "GEOMETRY_NOT_CONVERTED" for d in manifest["diagnostics"]))
        self.assertEqual(verify_link(self.output), manifest)

    def test_artifact_tampering_is_detected(self):
        self.build()
        with (self.output / "original.ifc").open("ab") as stream:
            stream.write(b"\nchanged")
        with self.assertRaises(LinkError) as caught:
            verify_link(self.output)
        self.assertEqual(caught.exception.code, "ARTIFACT_MISMATCH")

    def test_existing_run_cannot_be_overwritten(self):
        self.build()
        manifest_bytes = (self.output / "manifest.json").read_bytes()
        with self.assertRaises(FileExistsError):
            self.build()
        self.assertEqual((self.output / "manifest.json").read_bytes(), manifest_bytes)


if __name__ == "__main__":
    unittest.main()
