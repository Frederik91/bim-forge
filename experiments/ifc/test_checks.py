"""Server-only sensitivity checks against real generated IFC, not a mocked engine."""
import tempfile
import unittest
import copy
import json
import subprocess
from pathlib import Path

import ifcopenshell
import jsonschema

from ifc_model import add_unfamiliar_bounded_property, direct_inputs, export_model, successive_direct_export
from run import canonical_hash, close, coordinate_errors, paired_errors, semantic_errors, validate_input
from step_reader import Reader, parse


class ReaderChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "source.ifc"
        self.model = direct_inputs("rotated-mm")
        export_model(self.model, "ifc-native", self.path)

    def test_released_fixture_semantics_and_coordinates(self):
        snapshot = Reader.open(self.path).snapshot()
        self.assertEqual(semantic_errors(snapshot, self.model), [])
        self.assertEqual(coordinate_errors(snapshot, self.model), [])

    def test_actual_ts_json_boundary_accepts_valid_3d_input_and_rejects_malformed_coordinates(self):
        output = Path(self.temp.name) / "native-inputs"
        subprocess.run(["node", "experiments/ifc/native.ts", "generate", str(output)], check=True, capture_output=True, text=True)
        schema = json.loads((output / "native-model.schema.json").read_text())
        model = json.loads((output / "m-r1.json").read_text())
        self.assertEqual(validate_input(model, schema), model)
        for coordinates in ([10, 20], [10, 20, 3, 0], [10, "20", 3]):
            with self.subTest(coordinates=coordinates):
                invalid = copy.deepcopy(model)
                invalid["storey"]["origin"] = coordinates
                with self.assertRaises(jsonschema.ValidationError):
                    validate_input(invalid, schema)

    def test_successive_exports_have_stable_ids_and_one_changed_occurrence(self):
        second = self.path.with_name("second.ifc")
        successive_direct_export(self.path, second)
        self.assertEqual(paired_errors(Reader.open(self.path).snapshot(), Reader.open(second).snapshot()), [])

    def test_exact_snapshot_hashes_accept_unnamed_roots_and_remain_distinct_from_physical_equivalence(self):
        millimetres = Reader.open(self.path).snapshot()
        metres_path = self.path.with_name("metres.ifc")
        export_model(direct_inputs("rotated-m"), "ifc-native", metres_path)
        metres = Reader.open(metres_path).snapshot()
        self.assertTrue(any(root["name"] is None for root in millimetres["roots"]))
        self.assertEqual(canonical_hash(millimetres), canonical_hash(json.loads(json.dumps(millimetres))))
        self.assertNotEqual(canonical_hash(millimetres), canonical_hash(metres))
        for key in metres["products"]:
            self.assertTrue(close(metres["products"][key]["cornersMetres"], millimetres["products"][key]["cornersMetres"], 1e-6))

    def test_independent_checks_detect_real_serialized_unit_map_and_property_corruption(self):
        for mutation in ("unit", "map", "property", "host"):
            with self.subTest(mutation=mutation):
                model = ifcopenshell.open(str(self.path))
                if mutation == "unit":
                    project = model.by_type("IfcProject")[0]
                    next(unit for unit in project.UnitsInContext.Units if unit.UnitType == "LENGTHUNIT").Prefix = None
                elif mutation == "map":
                    model.by_type("IfcMapConversion")[0].Eastings += 10
                elif mutation == "property":
                    next(prop for prop in model.by_type("IfcPropertySingleValue") if prop.Name == "FireRating").NominalValue = model.create_entity("IfcLabel", "LOST")
                else:
                    model.by_type("IfcRelVoidsElement")[0].RelatingBuildingElement = next(wall for wall in model.by_type("IfcWall") if wall.Name == "wall-b")
                target = self.path.with_name(f"{mutation}.ifc")
                model.write(str(target))
                snapshot = Reader.open(target).snapshot()
                self.assertTrue(coordinate_errors(snapshot, self.model) if mutation in ("unit", "map") else semantic_errors(snapshot, self.model))

    def test_duplicate_guids_are_rejected_before_comparison(self):
        model = ifcopenshell.open(str(self.path))
        first, second = model.by_type("IfcWall")
        second.GlobalId = first.GlobalId
        target = self.path.with_name("duplicate.ifc")
        model.write(str(target))
        with self.assertRaisesRegex(ValueError, "Duplicate GlobalId"):
            Reader.open(target).snapshot()

    def test_unfamiliar_bounded_value_is_loss_reported_with_typed_raw_values(self):
        target = self.path.with_name("bounded.ifc")
        add_unfamiliar_bounded_property(self.path, target)
        inventory, losses = Reader.open(target).property_inventory()
        self.assertEqual(len(losses), 1)
        self.assertEqual(losses[0]["ifcClass"], "IFCPROPERTYBOUNDEDVALUE")
        self.assertIn({"ifcType": "IFCREAL", "arguments": [12.0]}, losses[0]["rawAttributes"])
        self.assertIn("Maker's core", str(inventory))

    def test_corrupt_step_and_unreleased_schemas_do_not_get_skipped(self):
        source = self.path.read_text()
        with self.assertRaisesRegex(ValueError, "Only released"):
            parse(source.replace("'IFC4'", "'IFC5'"))
        with self.assertRaises(ValueError):
            parse(source.replace("DATA;", "DATA;#999999=IFCWALL(#999998);"))


if __name__ == "__main__":
    unittest.main()
