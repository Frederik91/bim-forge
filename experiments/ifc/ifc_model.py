"""Real IFC tooling only. This is a qualification adapter, not product authoring code."""
from __future__ import annotations

import math
import uuid
from collections import defaultdict
from pathlib import Path

import ifcopenshell
import ifcopenshell.guid

NAMESPACE = uuid.UUID("4030656e-22ec-4aaa-80ee-9eaf170a1898")


def guid(key: str) -> str:
    return ifcopenshell.guid.compress(uuid.uuid5(NAMESPACE, key).hex)


def direct_inputs(variant: str) -> dict:
    """Independently authored IFC-native fixture; does not read the TS JSON fixture."""
    u = 1000 if variant.endswith("mm") else 1
    return {
        "revision": 1, "variant": variant, "lengthUnit": "mm" if u == 1000 else "m",
        "storey": {"origin": [10 * u, 20 * u, 3 * u], "rotationDegrees": 30 if variant.startswith("rotated") else 0},
        "map": {"eastings": 500000, "northings": 6600000, "height": 100,
                "xAxisAbscissa": 0.8, "xAxisOrdinate": 0.6, "scale": 1 / u},
        "wallType": {"id": "wall-type", "name": "Qualification wall type", "properties": [
            {"pset": "W2_Declared", "name": "ThicknessMetres", "kind": "real", "value": 0.2},
            {"pset": "Vendor_Unknown", "name": "Recipe", "kind": "label", "value": "Maker's opaque recipe"}]},
        "walls": [{"id": key, "name": key, "typeId": "wall-type", "size": [4 * u, 0.2 * u, 3 * u],
                   "position": [0, index * 4 * u, 0], "properties": [
                       {"pset": "Pset_WallCommon", "name": "FireRating", "kind": "label", "value": "EI60"},
                       {"pset": "Vendor_Unknown", "name": "Flag", "kind": "boolean", "value": True},
                       {"pset": "Vendor_Unknown", "name": "Layers", "kind": "labels", "value": ["skin", "Maker's core"]}]}
                  for index, key in enumerate(("wall-a", "wall-b"))],
        "opening": {"id": "opening-a", "name": "opening-a", "hostId": "wall-a", "size": [0.9 * u, 0.4 * u, 2.1 * u], "position": [u, -0.1 * u, 0]},
        "space": {"id": "space-a", "name": "space-a", "size": [6 * u, 4 * u, 3 * u], "position": [0, 0.2 * u, 0]},
        "boundary": {"id": "boundary-a", "spaceId": "space-a", "wallId": "wall-a"},
    }


class Builder:
    def __init__(self, candidate: str):
        self.file = ifcopenshell.file(schema="IFC4")
        self.file.header.file_name.originating_system = f"BIM Forge W2 controlled-generated {candidate}"
        self.file.header.file_name.authorization = "Qualification fixture; no engineering approval"

    def entity(self, kind: str, **attributes):
        return self.file.create_entity(kind, **attributes)

    def root(self, kind: str, key: str, **attributes):
        return self.entity(kind, GlobalId=guid(key), **attributes)

    def point(self, coordinates):
        return self.entity("IfcCartesianPoint", Coordinates=tuple(float(x) for x in coordinates))

    def direction(self, ratios):
        return self.entity("IfcDirection", DirectionRatios=tuple(float(x) for x in ratios))

    def axes(self, location=(0, 0, 0), degrees=0, normal=(0, 0, 1)):
        theta = math.radians(degrees)
        return self.entity("IfcAxis2Placement3D", Location=self.point(location), Axis=self.direction(normal),
                           RefDirection=self.direction((math.cos(theta), math.sin(theta), 0)))

    def placement(self, parent=None, location=(0, 0, 0), degrees=0):
        return self.entity("IfcLocalPlacement", PlacementRelTo=parent, RelativePlacement=self.axes(location, degrees))

    def box(self, context, size):
        length, width, height = size
        profile = self.entity("IfcRectangleProfileDef", ProfileType="AREA",
                              Position=self.entity("IfcAxis2Placement2D", Location=self.point((length / 2, width / 2))),
                              XDim=float(length), YDim=float(width))
        solid = self.entity("IfcExtrudedAreaSolid", SweptArea=profile, Position=self.axes(),
                            ExtrudedDirection=self.direction((0, 0, 1)), Depth=float(height))
        shape = self.entity("IfcShapeRepresentation", ContextOfItems=context, RepresentationIdentifier="Body",
                            RepresentationType="SweptSolid", Items=[solid])
        return self.entity("IfcProductDefinitionShape", Representations=[shape])

    def surface(self, length, height, location):
        plane = self.entity("IfcPlane", Position=self.axes(location=location, normal=(0, -1, 0)))
        outer = self.entity("IfcPolyline", Points=[self.point(xy) for xy in ((0, 0), (length, 0), (length, height), (0, height), (0, 0))])
        return self.entity("IfcCurveBoundedPlane", BasisSurface=plane, OuterBoundary=outer, InnerBoundaries=[])

    def properties(self, owner, key, properties):
        groups = defaultdict(list)
        for prop in properties:
            if prop["kind"] == "labels":
                item = self.entity("IfcPropertyListValue", Name=prop["name"],
                                   ListValues=[self.file.create_entity("IfcLabel", x) for x in prop["value"]])
            else:
                value_type = {"label": "IfcLabel", "real": "IfcReal", "boolean": "IfcBoolean"}[prop["kind"]]
                item = self.entity("IfcPropertySingleValue", Name=prop["name"], NominalValue=self.file.create_entity(value_type, prop["value"]))
            groups[prop["pset"]].append(item)
        psets = []
        for name, items in sorted(groups.items()):
            pset = self.root("IfcPropertySet", f"pset-{key}-{name}", Name=name, HasProperties=items)
            psets.append(pset)
            if not owner.is_a("IfcTypeObject"):
                self.root("IfcRelDefinesByProperties", f"properties-{key}-{name}", RelatedObjects=[owner], RelatingPropertyDefinition=pset)
        if owner.is_a("IfcTypeObject"):
            owner.HasPropertySets = psets


def export_model(inputs: dict, candidate: str, output: Path) -> None:
    b = Builder(candidate)
    model = b.file
    length = b.entity("IfcSIUnit", UnitType="LENGTHUNIT", Prefix="MILLI" if inputs["lengthUnit"] == "mm" else None, Name="METRE")
    metre = b.entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")
    units = b.entity("IfcUnitAssignment", Units=[length, b.entity("IfcSIUnit", UnitType="AREAUNIT", Name="SQUARE_METRE"),
                                               b.entity("IfcSIUnit", UnitType="VOLUMEUNIT", Name="CUBIC_METRE")])
    context = b.entity("IfcGeometricRepresentationContext", ContextType="Model", CoordinateSpaceDimension=3,
                       Precision=1e-8 if inputs["lengthUnit"] == "m" else 1e-5, WorldCoordinateSystem=b.axes())
    body = b.entity("IfcGeometricRepresentationSubContext", ContextIdentifier="Body", ContextType="Model",
                    ParentContext=context, TargetView="MODEL_VIEW")
    project = b.root("IfcProject", "project", Name="W2 semantic slice", RepresentationContexts=[context], UnitsInContext=units)
    site = b.root("IfcSite", "site", Name="site", ObjectPlacement=b.placement(), CompositionType="ELEMENT")
    building = b.root("IfcBuilding", "building", Name="building", ObjectPlacement=b.placement(site.ObjectPlacement), CompositionType="ELEMENT")
    storey = b.root("IfcBuildingStorey", "storey", Name="storey", CompositionType="ELEMENT",
                    ObjectPlacement=b.placement(building.ObjectPlacement, inputs["storey"]["origin"], inputs["storey"]["rotationDegrees"]))
    for key, parent, child in (("project-site", project, site), ("site-building", site, building), ("building-storey", building, storey)):
        b.root("IfcRelAggregates", key, RelatingObject=parent, RelatedObjects=[child])
    crs = b.entity("IfcProjectedCRS", Name="EPSG:25832", Description="Synthetic survey values; no certified geodetic control", MapUnit=metre)
    transform = inputs["map"]
    b.entity("IfcMapConversion", SourceCRS=context, TargetCRS=crs, Eastings=float(transform["eastings"]),
             Northings=float(transform["northings"]), OrthogonalHeight=float(transform["height"]),
             XAxisAbscissa=float(transform["xAxisAbscissa"]), XAxisOrdinate=float(transform["xAxisOrdinate"]), Scale=float(transform["scale"]))
    wall_type = b.root("IfcWallType", inputs["wallType"]["id"], Name=inputs["wallType"]["name"], PredefinedType="STANDARD")
    b.properties(wall_type, inputs["wallType"]["id"], inputs["wallType"]["properties"])
    walls = {}
    for wall in inputs["walls"]:
        item = b.root("IfcWall", wall["id"], Name=wall["name"], PredefinedType="STANDARD",
                      ObjectPlacement=b.placement(storey.ObjectPlacement, wall["position"]), Representation=b.box(body, wall["size"]))
        b.properties(item, wall["id"], wall["properties"])
        walls[wall["id"]] = item
    b.root("IfcRelDefinesByType", "wall-type-instances", RelatedObjects=list(walls.values()), RelatingType=wall_type)
    opening = inputs["opening"]
    host = walls[opening["hostId"]]
    void = b.root("IfcOpeningElement", opening["id"], Name=opening["name"], PredefinedType="OPENING",
                  ObjectPlacement=b.placement(host.ObjectPlacement, opening["position"]), Representation=b.box(body, opening["size"]))
    b.root("IfcRelVoidsElement", "wall-opening", RelatingBuildingElement=host, RelatedOpeningElement=void)
    space = inputs["space"]
    room = b.root("IfcSpace", space["id"], Name=space["name"], CompositionType="ELEMENT", PredefinedType="INTERNAL",
                  ObjectPlacement=b.placement(storey.ObjectPlacement, space["position"]), Representation=b.box(body, space["size"]))
    b.root("IfcRelAggregates", "storey-space", RelatingObject=storey, RelatedObjects=[room])
    b.root("IfcRelContainedInSpatialStructure", "storey-walls", RelatedElements=list(walls.values()), RelatingStructure=storey)
    boundary = inputs["boundary"]
    u = 1000 if inputs["lengthUnit"] == "mm" else 1
    connection = b.entity("IfcConnectionSurfaceGeometry", SurfaceOnRelatingElement=b.surface(4 * u, 3 * u, (0, 0, 0)),
                          SurfaceOnRelatedElement=b.surface(4 * u, 3 * u, (0, 0.2 * u, 0)))
    b.root("IfcRelSpaceBoundary", boundary["id"], Name="partial-wall-boundary", RelatingSpace=room,
           RelatedBuildingElement=walls[boundary["wallId"]], ConnectionGeometry=connection,
           PhysicalOrVirtualBoundary="PHYSICAL", InternalOrExternalBoundary="INTERNAL")
    model.write(str(output))


def successive_direct_export(first: Path, second: Path) -> None:
    """Reopen the actual first IFC export; edit only wall-a's parametric solid."""
    model = ifcopenshell.open(str(first))
    wall = model.by_guid(guid("wall-a"))
    solid = wall.Representation.Representations[0].Items[0]
    profile = solid.SweptArea
    multiplier = 1.25
    profile.XDim *= multiplier
    x, y = profile.Position.Location.Coordinates
    profile.Position.Location.Coordinates = (x * multiplier, y)
    model.write(str(second))


def add_unfamiliar_bounded_property(source: Path, target: Path) -> None:
    """Adversarial preservation case outside the native scalar/list mapping contract."""
    model = ifcopenshell.open(str(source))
    pset = model.by_guid(guid("pset-wall-a-Vendor_Unknown"))
    prop = model.create_entity("IfcPropertyBoundedValue", Name="UnfamiliarRange",
                               UpperBoundValue=model.create_entity("IfcReal", 12.0), LowerBoundValue=model.create_entity("IfcReal", 2.0))
    pset.HasProperties = [*pset.HasProperties, prop]
    model.write(str(target))
