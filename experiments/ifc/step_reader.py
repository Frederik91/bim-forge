"""Independent, deliberately narrow IFC4 STEP reader. No IfcOpenShell imports.

Attribute offsets follow released IFC4 ADD2 TC1 EXPRESS. Unsupported geometry,
property forms and STEP escapes fail explicitly or appear in the loss inventory.
This is not an independent full IFC implementation or an MVD validator.
"""
from __future__ import annotations

import itertools
import math
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Ref:
    number: int


@dataclass(frozen=True)
class Atom:
    name: str


@dataclass(frozen=True)
class Entity:
    kind: str
    args: tuple


TOKEN = re.compile(r"\s+|/\*.*?\*/|'(?:[^']|'')*'|\#[0-9]+|\.[A-Z_]+\.|[A-Z_][A-Z_0-9]*|[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?|[(),;=$*]", re.S)


class Parser:
    def __init__(self, source: str):
        self.tokens = []
        offset = 0
        for token in TOKEN.finditer(source):
            if token.start() != offset:
                raise ValueError(f"Unsupported STEP syntax at {offset}")
            value = token.group()
            offset = token.end()
            if not value.isspace() and not value.startswith("/*"):
                self.tokens.append(value)
        if offset != len(source):
            raise ValueError("Unparsed STEP suffix")
        self.index = 0

    def take(self, expected=None):
        if self.index >= len(self.tokens):
            raise ValueError("Truncated STEP value")
        value = self.tokens[self.index]
        self.index += 1
        if expected is not None and value != expected:
            raise ValueError(f"Expected {expected}, found {value}")
        return value

    def value(self):
        token = self.take()
        if token == "(":
            values = []
            if self.tokens[self.index] != ")":
                while True:
                    values.append(self.value())
                    if self.tokens[self.index] != ",":
                        break
                    self.take(",")
            self.take(")")
            return tuple(values)
        if token.startswith("'"):
            if "\\" in token:
                raise ValueError("STEP escape encoding outside the ASCII fixture contract")
            return token[1:-1].replace("''", "'")
        if token.startswith("#"):
            return Ref(int(token[1:]))
        if token in ("$", "*") or re.fullmatch(r"\.[A-Z_]+\.", token):
            return Atom(token)
        if token[0].isalpha():
            args = self.value()
            if not isinstance(args, tuple):
                raise ValueError("Typed STEP value requires arguments")
            return Entity(token, args)
        number = float(token)
        if not math.isfinite(number):
            raise ValueError("Nonfinite STEP number")
        return number


def parse(source: str) -> dict[int, Entity]:
    if not re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'IFC4'\s*\)\s*\)\s*;", source):
        raise ValueError("Only released IFC4 STEP is admitted")
    match = re.search(r"\bDATA\s*;(.*?)\bENDSEC\s*;", source, re.S)
    if not match:
        raise ValueError("Missing STEP DATA section")
    parser = Parser(match.group(1))
    entities = {}
    while parser.index < len(parser.tokens):
        ref = parser.take()
        if not re.fullmatch(r"#[0-9]+", ref):
            raise ValueError("Expected STEP entity ID")
        parser.take("=")
        entity = parser.value()
        parser.take(";")
        number = int(ref[1:])
        if number in entities or not isinstance(entity, Entity):
            raise ValueError("Duplicate or invalid STEP entity")
        entities[number] = entity

    def references(value):
        if isinstance(value, Ref):
            if value.number not in entities:
                raise ValueError(f"Dangling STEP reference #{value.number}")
        elif isinstance(value, Entity):
            references(value.args)
        elif isinstance(value, tuple):
            for item in value:
                references(item)
    for entity in entities.values():
        references(entity)
    return entities


def add(a, b):
    return tuple(x + y for x, y in zip(a, b, strict=True))


def scale(a, factor):
    return tuple(x * factor for x in a)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def normalized(a):
    norm = math.sqrt(sum(x * x for x in a))
    if norm <= 0:
        raise ValueError("Zero direction")
    return scale(a, 1 / norm)


IDENTITY = ((0., 0., 0.), (1., 0., 0.), (0., 1., 0.), (0., 0., 1.))


def raw_value(value):
    if isinstance(value, Entity):
        return {"ifcType": value.kind, "arguments": [raw_value(item) for item in value.args]}
    if isinstance(value, Atom):
        return {"stepAtom": value.name}
    if isinstance(value, Ref):
        return {"stepReference": value.number}
    if isinstance(value, tuple):
        return [raw_value(item) for item in value]
    return value


def transform(frame, point):
    origin, x, y, z = frame
    return add(origin, add(scale(x, point[0]), add(scale(y, point[1]), scale(z, point[2]))))


def compose(parent, child):
    origin, *axes = child
    return (transform(parent, origin), *(tuple(sum(parent[j + 1][i] * axis[j] for j in range(3)) for i in range(3)) for axis in axes))


class Reader:
    def __init__(self, source: str):
        self.source = source
        self.entities = parse(source)

    @classmethod
    def open(cls, path: Path):
        return cls(path.read_text(encoding="utf-8"))

    def resolve(self, value, kind=None):
        if not isinstance(value, Ref):
            raise ValueError(f"Expected reference, found {value}")
        entity = self.entities[value.number]
        if kind and entity.kind != kind:
            raise ValueError(f"Expected {kind}, found {entity.kind}")
        return entity

    def all(self, kind):
        return [entity for entity in self.entities.values() if entity.kind == kind]

    def one(self, kind):
        items = self.all(kind)
        if len(items) != 1:
            raise ValueError(f"Expected exactly one {kind}, found {len(items)}")
        return items[0]

    def named(self, kind, name):
        items = [entity for entity in self.all(kind) if entity.args[2] == name]
        if len(items) != 1:
            raise ValueError(f"Expected unique {kind}/{name}")
        return items[0]

    def name(self, ref):
        return self.resolve(ref).args[2]

    def point(self, ref):
        return self.resolve(ref, "IFCCARTESIANPOINT").args[0]

    def axes(self, ref):
        entity = self.resolve(ref, "IFCAXIS2PLACEMENT3D")
        origin, z_ref, x_ref = entity.args
        z = (0., 0., 1.) if z_ref == Atom("$") else normalized(self.resolve(z_ref, "IFCDIRECTION").args[0])
        x = (1., 0., 0.) if x_ref == Atom("$") else normalized(self.resolve(x_ref, "IFCDIRECTION").args[0])
        if abs(sum(a * b for a, b in zip(x, z, strict=True))) > 1e-12:
            raise ValueError("Nonorthogonal placement outside fixture contract")
        return (self.point(origin), x, cross(z, x), z)

    def placement(self, ref, visited=frozenset()):
        if ref == Atom("$"):
            return IDENTITY
        if ref in visited:
            raise ValueError("Cyclic placement")
        parent, relative = self.resolve(ref, "IFCLOCALPLACEMENT").args
        return compose(self.placement(parent, visited | {ref}), self.axes(relative))

    def solid(self, product):
        definition = self.resolve(product.args[6], "IFCPRODUCTDEFINITIONSHAPE")
        representations = definition.args[2]
        if len(representations) != 1:
            raise ValueError("Expected one body representation")
        shape = self.resolve(representations[0], "IFCSHAPEREPRESENTATION")
        if shape.args[1:3] != ("Body", "SweptSolid") or len(shape.args[3]) != 1:
            raise ValueError("Unsupported body representation")
        return self.resolve(shape.args[3][0], "IFCEXTRUDEDAREASOLID")

    def box(self, product):
        solid = self.solid(product)
        profile = self.resolve(solid.args[0], "IFCRECTANGLEPROFILEDEF")
        pos = self.resolve(profile.args[2], "IFCAXIS2PLACEMENT2D")
        if pos.args[1] != Atom("$"):
            raise ValueError("Rotated profile outside fixture contract")
        if self.resolve(solid.args[2], "IFCDIRECTION").args[0] != (0., 0., 1.):
            raise ValueError("Nonvertical extrusion outside fixture contract")
        cx, cy = self.point(pos.args[0])
        length, width, height = profile.args[3], profile.args[4], solid.args[3]
        frame = compose(self.placement(product.args[5]), self.axes(solid.args[1]))
        corners = [transform(frame, (x, y, z)) for x, y, z in itertools.product(
            (cx - length / 2, cx + length / 2), (cy - width / 2, cy + width / 2), (0., height))]
        return {"size": [length, width, height], "frame": frame, "corners": corners}

    def unit_scale(self):
        assignment = self.resolve(self.one("IFCPROJECT").args[8], "IFCUNITASSIGNMENT")
        lengths = [self.resolve(ref) for ref in assignment.args[0] if self.resolve(ref).args[1] == Atom(".LENGTHUNIT.")]
        if len(lengths) != 1:
            raise ValueError("Ambiguous length units")
        unit = lengths[0]
        if unit.kind != "IFCSIUNIT" or unit.args[3] != Atom(".METRE."):
            raise ValueError("Unsupported unit")
        return {Atom("$"): 1., Atom(".MILLI."): 0.001}[unit.args[2]]

    def map_point(self, point):
        conversion = self.one("IFCMAPCONVERSION")
        source, target, e, n, h, a, b, factor = conversion.args
        context = self.one("IFCGEOMETRICREPRESENTATIONCONTEXT")
        if self.resolve(source) != context:
            raise ValueError("Map conversion does not reference model context")
        crs = self.resolve(target, "IFCPROJECTEDCRS")
        unit = self.resolve(crs.args[6], "IFCSIUNIT")
        if unit.args[2:] != (Atom("$"), Atom(".METRE.")):
            raise ValueError("Fixture target CRS must use metres")
        norm = math.hypot(a, b)
        if norm <= 0 or factor <= 0:
            raise ValueError("Invalid map conversion")
        a, b = a / norm, b / norm
        x, y, z = point
        return (e + factor * (a * x - b * y), n + factor * (b * x + a * y), h + factor * z)

    def property_inventory(self):
        inventory = []
        unsupported = []
        owners = [self.named("IFCWALLTYPE", "Qualification wall type"), *sorted(self.all("IFCWALL"), key=lambda x: x.args[2])]
        for owner in owners:
            owner_id = "wall-type" if owner.kind == "IFCWALLTYPE" else owner.args[2]
            if owner.kind == "IFCWALLTYPE":
                psets = owner.args[5]
            else:
                refs = [ref for ref, entity in self.entities.items() if entity is owner]
                psets = [rel.args[5] for rel in self.all("IFCRELDEFINESBYPROPERTIES") if Ref(refs[0]) in rel.args[4]]
            properties = []
            for ref in psets:
                pset = self.resolve(ref, "IFCPROPERTYSET")
                for item in pset.args[4]:
                    prop = self.resolve(item)
                    if prop.kind == "IFCPROPERTYSINGLEVALUE" and prop.args[3] == Atom("$"):
                        value = prop.args[2]
                        if isinstance(value, Entity) and value.kind in ("IFCLABEL", "IFCREAL", "IFCBOOLEAN"):
                            kind = {"IFCLABEL": "label", "IFCREAL": "real", "IFCBOOLEAN": "boolean"}[value.kind]
                            scalar = value.args[0]
                            if kind == "boolean":
                                if scalar not in (Atom(".T."), Atom(".F.")):
                                    raise ValueError("Invalid boolean property")
                                scalar = scalar == Atom(".T.")
                            properties.append({"pset": pset.args[2], "name": prop.args[0], "kind": kind, "value": scalar})
                            continue
                    if prop.kind == "IFCPROPERTYLISTVALUE" and prop.args[3] == Atom("$"):
                        values = prop.args[2]
                        if isinstance(values, tuple) and all(isinstance(x, Entity) and x.kind == "IFCLABEL" for x in values):
                            properties.append({"pset": pset.args[2], "name": prop.args[0], "kind": "labels", "value": [x.args[0] for x in values]})
                            continue
                    unsupported.append({"ownerId": owner_id, "pset": pset.args[2], "name": prop.args[0],
                                        "ifcClass": prop.kind, "stepEntity": item.number,
                                        "rawAttributes": raw_value(prop.args),
                                        "disposition": "unmapped; retained in original IFC bytes only"})
            inventory.append({"ownerId": owner_id, "properties": sorted(properties, key=lambda x: (x["pset"], x["name"]))})
        return inventory, unsupported

    def snapshot(self):
        root_pattern = re.compile(r"^[0-3][0-9A-Za-z_$]{21}$")
        roots = [{"guid": x.args[0], "kind": x.kind, "name": x.args[2]} for x in self.entities.values()
                 if len(x.args) >= 4 and isinstance(x.args[0], str) and root_pattern.fullmatch(x.args[0])]
        guids = [x["guid"] for x in roots]
        if len(guids) != len(set(guids)):
            raise ValueError("Duplicate GlobalId")
        inventory, unsupported = self.property_inventory()
        void = self.one("IFCRELVOIDSELEMENT")
        typed = self.one("IFCRELDEFINESBYTYPE")
        boundary = self.one("IFCRELSPACEBOUNDARY")
        connection = self.resolve(boundary.args[6], "IFCCONNECTIONSURFACEGEOMETRY")
        surfaces = []
        for ref in connection.args:
            surface = self.resolve(ref, "IFCCURVEBOUNDEDPLANE")
            plane = self.resolve(surface.args[0], "IFCPLANE")
            outer = self.resolve(surface.args[1], "IFCPOLYLINE")
            surfaces.append({"frame": self.axes(plane.args[0]), "outer": [self.point(p) for p in outer.args[0]], "inner": surface.args[2]})
        products = {}
        u = self.unit_scale()
        for kind in ("IFCWALL", "IFCOPENINGELEMENT", "IFCSPACE"):
            for product in self.all(kind):
                box = self.box(product)
                products[product.args[2]] = {"guid": product.args[0], "kind": kind, **box,
                    "cornersMetres": [scale(p, u) for p in box["corners"]], "surveyCornersMetres": [self.map_point(p) for p in box["corners"]]}
        spatial = [{"parent": self.name(rel.args[4]), "children": sorted(self.name(ref) for ref in rel.args[5])}
                   for rel in self.all("IFCRELAGGREGATES")]
        contained = [{"storey": self.name(rel.args[5]), "elements": sorted(self.name(ref) for ref in rel.args[4])}
                     for rel in self.all("IFCRELCONTAINEDINSPATIALSTRUCTURE")]
        return {"roots": sorted(roots, key=lambda x: x["guid"]), "properties": inventory, "unsupported": unsupported,
                "products": products, "unitScale": u, "mapConversion": list(self.one("IFCMAPCONVERSION").args[2:]),
                "spatial": sorted(spatial, key=lambda x: x["parent"]), "contained": contained,
                "relations": {"void": [self.name(void.args[4]), self.name(void.args[5])],
                              "type": {"name": self.name(typed.args[5]), "instances": sorted(self.name(ref) for ref in typed.args[4])},
                              "boundary": [self.name(boundary.args[4]), self.name(boundary.args[5]), boundary.args[7].name, boundary.args[8].name],
                              "boundarySurfaces": surfaces}}
