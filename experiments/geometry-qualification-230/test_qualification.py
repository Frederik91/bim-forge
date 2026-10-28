"""Real conversion + independent controls. No model-provider assertions substitute for this.

Run serially in a network-off server container. Every output is retained by the runner.
This checks converter artifacts; product query/freshness/browser requirements are separate.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import sys
import unittest

import numpy as np
from generate import generate, identifier, require_container
from oracle import Prism, box, distance, doorway_wall, facts, frame, inside, l_solid, project, union_distance

# Conversion is the system under test, never the oracle.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ifc-link"))
from link import LinkError, build_link, verify_link  # noqa: E402


def volume(mesh):
    vertices = np.array(mesh["verticesMetres"], dtype=float).reshape((-1, 3))
    triangles = np.array(mesh["triangles"], dtype=int).reshape((-1, 3))
    # Translate near origin so a large occurrence translation cannot mask cancellation.
    points = vertices - vertices.mean(axis=0)
    return abs(sum(float(np.dot(points[a], np.cross(points[b], points[c]))) / 6 for a, b, c in triangles))


def project_vertices(mesh, occurrence):
    vertices = np.array(mesh["verticesMetres"], dtype=float).reshape((-1, 3))
    return (occurrence @ np.array(mesh["productToSourceMetres"]) @ np.column_stack((vertices, np.ones(len(vertices)))).T).T[:, :3]


class OracleControls(unittest.TestCase):
    def test_triangle_inspector_known_cube_positive_and_negative_controls(self):
        vertices = np.array([[0., 0., 0.], [1., 0., 0.], [1., 1., 0.], [0., 1., 0.],
                             [0., 0., 1.], [1., 0., 1.], [1., 1., 1.], [0., 1., 1.]])
        triangles = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
                     1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]
        self.assertAlmostEqual(volume({"verticesMetres": vertices.flatten(), "triangles": triangles}), 1.)
        self.assertTrue(mesh_contains((.5, .5, .5), vertices, triangles))
        self.assertFalse(mesh_contains((1.5, .5, .5), vertices, triangles))
        self.assertFalse(mesh_contains((-.5, .5, .5), vertices, triangles))

    def test_hand_computable_adversarial_controls(self):
        measured = facts()
        expected = {"free-side-500mm": .5, "doorway-passage": .2, "touching": 0., "contained": 0., "above-lintel": .5, "l-recess": .5}
        self.assertEqual(set(measured), set(expected))
        for name, value in expected.items():
            with self.subTest(name=name):
                self.assertAlmostEqual(measured[name], value, places=8)
        self.assertEqual(distance(box(0, 0, 0, 2, 2, 2), box(.5, .5, .5, .1, .1, .1)), 0.)
        self.assertAlmostEqual(distance(box(0, 0, 0, 1, 1, 1), box(2, 2, 2, 1, 1, 1)), math.sqrt(3))

    def test_symmetry_rigid_invariance_and_containment(self):
        a, b = box(.5, .8, .5, .5, .5, 1), box(0, 0, 0, 6, .3, 3)
        self.assertAlmostEqual(distance(a, b), distance(b, a))
        self.assertAlmostEqual(distance(a, b), distance(project(a, "b"), project(b, "b")))
        self.assertGreater(distance(project(box(1.5, 6.5, .5, .5, .5, .5)), l_solid()), 0)
        for wall in (doorway_wall(), doorway_wall(occurrence="b")):
            self.assertAlmostEqual(union_distance(wall, wall), 0)

    def test_no_absence_or_nonfinite_certificates(self):
        with self.assertRaises(ValueError):
            union_distance((), (box(0, 0, 0, 1, 1, 1),))
        with self.assertRaises(ValueError):
            Prism(((0, 0), (1, 0), (0, float("nan"))), 0, 1)


class RealIFC(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        require_container()
        cls.root = Path(os.environ["QUAL_ARTIFACTS"])
        cls.manifest = generate(cls.root / "fixtures")
        cls.repeated = generate(cls.root / "fixtures-repeat")
        cls.counter = 0

    def convert(self, name, namespace="discipline-a", occurrence="occurrence-a", transform=None):
        type(self).counter += 1
        output = self.root / ("converted-%03d-%s" % (self.counter, name))
        arguments = dict(namespace=namespace, revision=name, occurrence=occurrence)
        if transform is not None:
            arguments["transform"] = transform
        manifest = build_link(self.root / "fixtures" / (name + ".ifc"), output, **arguments)
        self.assertEqual(verify_link(output), manifest)
        return output, manifest, json.loads((output / "geometry.json").read_text())

    def test_deterministic_immutable_pack(self):
        self.assertEqual(self.manifest, self.repeated)
        with self.assertRaises(FileExistsError):
            generate(self.root / "fixtures")
        for source in self.manifest["sources"]:
            data = (self.root / "fixtures" / source["file"]).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), source["sha256"])

    def test_true_subtraction_units_placements_and_geometry_controls(self):
        occurrence = np.array([[0., -1., 0., 100.], [1., 0., 0., -30.], [0., 0., 1., 2.], [0., 0., 0., 1.]])
        retained = []
        for unit in ("m", "mm"):
            for key, matrix in (("a", np.eye(4)), ("b", occurrence)):
                with self.subTest(unit=unit, occurrence=key):
                    _, manifest, geometry = self.convert(unit + "-v1", "discipline-" + key, "occurrence-" + key, matrix.tolist())
                    mesh = next(m for m in geometry["meshes"] if m["ref"]["globalId"] == identifier("wall"))
                    # 6*.3*3 - 1*.3*2.2; opening volume must actually be absent.
                    self.assertAlmostEqual(volume(mesh), 4.74, places=6)
                    l_mesh = next(m for m in geometry["meshes"] if m["ref"]["globalId"] == identifier("l-solid"))
                    self.assertAlmostEqual(volume(l_mesh), 10., places=6)
                    actual = project_vertices(mesh, matrix)
                    corners = np.array([frame((x, y, z), key) for x in (0, 6) for y in (0, .3) for z in (0, 3)])
                    np.testing.assert_allclose(actual.min(axis=0), corners.min(axis=0), atol=1e-7, rtol=0)
                    np.testing.assert_allclose(actual.max(axis=0), corners.max(axis=0), atol=1e-7, rtol=0)
                    # Sample both sides of material/void boundaries at several heights.
                    # General ray parity tests actual triangles independently of analytic prism distance.
                    for local, expected in (((2.5, .15, 1), False), ((2.5, .15, 2.6), True), ((1, .15, 1), True),
                                            ((2.5, .8, 1), False), ((4, .15, 1), True)):
                        self.assertEqual(mesh_contains(frame(local, key), actual, mesh["triangles"]), expected)
                    retained.append({"unit": unit, "occurrence": key, "source": manifest["source"], "wallVolume": volume(mesh),
                                     "privateAnalyticalFacts": facts(), "limitations": "Fixture vertical prisms; tessellation, not exact IFC solid proof"})
        (self.root / "private-oracle-results.json").write_text(json.dumps(retained, indent=2) + "\n")

    def test_version_identity_and_geometry_deltas(self):
        converted = {}
        for version in ("v1", "property", "unrelated", "wall-motion", "added-obstruction", "removed", "reidentified", "placement"):
            output, manifest, geometry = self.convert("m-" + version)
            converted[version] = (manifest, {m["ref"]["globalId"]: m for m in geometry["meshes"]})
            self.assertEqual((output / "original.ifc").read_bytes(), (self.root / "fixtures" / ("m-" + version + ".ifc")).read_bytes())
        base_manifest, base = converted["v1"]
        wall_id = identifier("wall")
        base_vertices = project_vertices(base[wall_id], np.eye(4))
        for version in ("property", "unrelated"):
            self.assertNotEqual(base_manifest["source"]["originalSha256"], converted[version][0]["source"]["originalSha256"])
            np.testing.assert_allclose(base_vertices, project_vertices(converted[version][1][wall_id], np.eye(4)), atol=1e-9, rtol=0)
        for version in ("wall-motion", "placement"):
            self.assertFalse(np.allclose(base_vertices, project_vertices(converted[version][1][wall_id], np.eye(4))))
        self.assertNotIn(wall_id, converted["removed"][1])
        self.assertNotIn(wall_id, converted["reidentified"][1])
        self.assertIn(identifier("wall-new"), converted["reidentified"][1])
        self.assertNotIn(identifier("new-obstruction"), base)
        self.assertIn(identifier("new-obstruction"), converted["added-obstruction"][1])

    def test_partial_empty_and_unsupported_never_hide_missing_geometry(self):
        for version in ("partial", "empty", "unsupported"):
            with self.subTest(version=version):
                output, manifest, geometry = self.convert("m-" + version)
                index = json.loads((output / "index.json").read_text())
                represented = {m["ref"]["globalId"] for m in geometry["meshes"]}
                missing = {o["ref"]["globalId"] for o in index["objects"]} - represented
                self.assertTrue(missing)
                self.assertTrue(manifest["diagnostics"])
                if version == "empty":
                    self.assertEqual(geometry["meshes"], [])
                else:
                    # Spatial containers always lack meshes; they must not accidentally
                    # satisfy this assertion about the intentionally missing product.
                    key = "no-representation" if version == "partial" else "wire-no-solid"
                    self.assertIn(identifier(key), missing)

    def test_failed_candidates_retain_original_and_never_publish_manifest(self):
        current_output, _, _ = self.convert("m-v1")
        current_bytes = {p.name: p.read_bytes() for p in current_output.iterdir()}
        for name, expected in (("m-duplicate", "DUPLICATE_GLOBAL_ID"), ("m-huge", "UNSAFE_TRANSFORM"),
                               ("m-budget", "PRODUCT_BUDGET"), ("oversize", "SOURCE_BUDGET"), ("malformed", None)):
            with self.subTest(name=name):
                type(self).counter += 1
                output = self.root / ("rejected-%03d" % self.counter)
                with self.assertRaises(Exception):
                    build_link(self.root / "fixtures" / (name + ".ifc"), output,
                               namespace="discipline-a", revision=name, occurrence="occurrence-a")
                failure = json.loads((output / "failure.json").read_text())
                self.assertIs(failure["published"], False)
                self.assertFalse((output / "manifest.json").exists())
                if expected:
                    self.assertEqual(failure["code"], expected)
                # Oversize admission rejects before retention; other failures retain exact source.
                if name != "oversize":
                    self.assertEqual((output / "original.ifc").read_bytes(), (self.root / "fixtures" / (name + ".ifc")).read_bytes())
                self.assertEqual({p.name: p.read_bytes() for p in current_output.iterdir()}, current_bytes)


def mesh_contains(point, vertices, flat_triangles):
    """Moller-Trumbore ray parity, avoiding fixture-aligned edges with oblique direction."""
    origin = np.array(point)
    direction = np.array([1., .371390676, .193417])
    hits = []
    for a, b, c in np.array(flat_triangles).reshape((-1, 3)):
        edge1, edge2 = vertices[b] - vertices[a], vertices[c] - vertices[a]
        h = np.cross(direction, edge2)
        determinant = float(np.dot(edge1, h))
        if abs(determinant) < 1e-10:
            continue
        inverse = 1. / determinant
        s = origin - vertices[a]
        u = inverse * float(np.dot(s, h))
        q = np.cross(s, edge1)
        v = inverse * float(np.dot(direction, q))
        t = inverse * float(np.dot(edge2, q))
        if -1e-9 <= u <= 1 + 1e-9 and v >= -1e-9 and u + v <= 1 + 1e-9 and t > 1e-9:
            if all(abs(t - previous) > 1e-7 for previous in hits):
                hits.append(t)
    return len(hits) % 2 == 1


if __name__ == "__main__":
    require_container()
    unittest.main(verbosity=2)
