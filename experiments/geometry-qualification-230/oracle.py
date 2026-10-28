"""Independent analytical oracle for finite vertical polygon prisms, in metres.

No IFC writer, triangulator, application calculation, spatial interval policy or LLM
output is imported. Oracle inputs describe measured shapes, not prompted answers.
It covers this fixture's vertical prisms only, not arbitrary IFC or curved solids.
"""
from __future__ import annotations

from dataclasses import dataclass
import math

EPS = 1e-9


@dataclass(frozen=True)
class Prism:
    polygon: tuple[tuple[float, float], ...]
    bottom: float
    top: float

    def __post_init__(self):
        values = [self.bottom, self.top, *(v for p in self.polygon for v in p)]
        if len(self.polygon) < 3 or not all(math.isfinite(v) for v in values) or self.top <= self.bottom:
            raise ValueError("Oracle requires finite non-degenerate vertical prisms")
        if abs(area(self.polygon)) < EPS:
            raise ValueError("Degenerate footprint")


def edges(polygon):
    return zip(polygon, (*polygon[1:], polygon[0]))


def area(polygon):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in edges(polygon)) / 2


def point_segment(point, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length_squared = dx * dx + dy * dy
    if length_squared <= EPS * EPS:
        return math.dist(point, a)
    fraction = max(0., min(1., ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length_squared))
    return math.dist(point, (a[0] + fraction * dx, a[1] + fraction * dy))


def inside(point, polygon):
    if any(point_segment(point, a, b) <= EPS for a, b in edges(polygon)):
        return True
    result = False
    for a, b in edges(polygon):
        if (a[1] > point[1]) != (b[1] > point[1]):
            crossing_x = a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if point[0] < crossing_x:
                result = not result
    return result


def cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def segment_distance(a, b, c, d):
    # Strict crossings plus explicit endpoint-on-segment cover contact and collinearity.
    if cross(a, b, c) * cross(a, b, d) < 0 and cross(c, d, a) * cross(c, d, b) < 0:
        return 0.
    return min(point_segment(a, c, d), point_segment(b, c, d), point_segment(c, a, b), point_segment(d, a, b))


def distance(left, right):
    """Solid-to-solid minimum; containment returns zero, not distance between shells."""
    xy = 0. if any(inside(p, right.polygon) for p in left.polygon) or any(inside(p, left.polygon) for p in right.polygon) else min(
        segment_distance(a, b, c, d) for a, b in edges(left.polygon) for c, d in edges(right.polygon))
    dz = max(0., left.bottom - right.top, right.bottom - left.top)
    return math.hypot(xy, dz)


def union_distance(left, right):
    if not left or not right:
        raise ValueError("Absence is not an infinite-clearance certificate")
    return min(distance(a, b) for a in left for b in right)


def box(x, y, z, width, depth, height):
    return Prism(((x, y), (x + width, y), (x + width, y + depth), (x, y + depth)), z, z + height)


def frame(point, occurrence="a", placement_change=False):
    """Independent closed-form composed storey->building->occurrence transform."""
    x, y, z = point
    # Storey rotates -15 degrees, then building rotates +30 degrees.
    angle = math.radians(15)
    ox = 10 + 2 * math.cos(math.pi / 6) - (-1 if not placement_change else 0) * math.sin(math.pi / 6)
    oy = 20 + 2 * math.sin(math.pi / 6) + (-1 if not placement_change else 0) * math.cos(math.pi / 6)
    q = (ox + x * math.cos(angle) - y * math.sin(angle), oy + x * math.sin(angle) + y * math.cos(angle), 3.5 + z)
    if occurrence == "a":
        return q
    if occurrence == "b":
        return (100 - q[1], -30 + q[0], 2 + q[2])
    raise ValueError("Unknown qualified occurrence")


def project(prism, occurrence="a", placement_change=False):
    transformed = tuple(frame((x, y, 0), occurrence, placement_change)[:2] for x, y in prism.polygon)
    return Prism(transformed, frame((0, 0, prism.bottom), occurrence, placement_change)[2],
                 frame((0, 0, prism.top), occurrence, placement_change)[2])


def doorway_wall(shift=0., occurrence="a", placement_change=False):
    # Independently decomposed material, unlike the writer's single solid minus void.
    return tuple(project(p, occurrence, placement_change) for p in (
        box(0, shift, 0, 2, .3, 3), box(3, shift, 0, 3, .3, 3), box(2, shift, 2.2, 1, .3, .8)))


def l_solid(occurrence="a"):
    return project(Prism(((0, 5), (3, 5), (3, 6), (1, 6), (1, 8), (0, 8)), 0, 2), occurrence)


def facts():
    wall = doorway_wall()
    probes = {"free-side-500mm": box(.5, .8, .5, .5, .5, 1), "doorway-passage": box(2.2, .05, .1, .6, .2, 1.8),
              "touching": box(.5, .3, .5, .5, .5, 1), "contained": box(.5, .1, .5, .2, .1, .2),
              "above-lintel": box(2.2, .05, 3.5, .6, .2, .5)}
    measured = {name: union_distance((project(probe),), wall) for name, probe in probes.items()}
    measured["l-recess"] = distance(project(box(1.5, 6.5, .5, .5, .5, .5)), l_solid())
    return measured
