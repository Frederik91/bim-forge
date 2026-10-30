# Independent markup relation oracle — issue 238

Status: **SOURCE-ONLY**. No Node, npm, builds, typechecks, tests, server jobs,
provider requests or live-model reads were executed for this partition. Parent
must independently review the calculations and run qualification under its lease.
This module supplies evidence; it cannot approve a proposal or accept model changes.

`grader.ts` has one **type-only** import of the markup schema's inferred types.
It imports no production geometry calculation, bounds, parser or tessellation.
There are no new dependencies, package changes or test-registry changes.

## Input contract

- Coordinates are project-space metres: X east, Y north, Z elevation. Use the
  actual captured markup, preserving its vertices, circle radius and normal.
- A rectangle uses its four ordered corners. A polyline is a region only when
  the last point repeats the first (arithmetic threshold `1e-10 m`, never 2 mm).
  Lines and open polylines have finite boundary/path distances; inside/outside
  return `unsupported: open-path`.
- `Footprint` is either an `oriented-rectangle` with centre, full width/depth and
  counterclockwise yaw **in radians**, or a `polygon` with an actual, ordered,
  simple projected perimeter. Both clockwise and counterclockwise rings work;
  polygon closure may be implicit or explicit.
- The caller must supply the actual proposal object's geometry and source/revision
  evidence. The oracle does not extract assets or validate source completeness.
  A bounding box or convex hull of an irregular asset is not its exact polygon.
  Holes, multiple rings, disconnected components and incomplete mesh projections
  are outside this input contract; never substitute their outer perimeter.
- Each vertex set must be horizontal within `1e-10 m` arithmetic degeneracy.
  Tilted, warped, self-crossing, self-touching, backtracking, zero-area and
  degenerate inputs abstain. Circle normals must be unit and horizontal.
  Signed elevations are preserved; paired planes must agree within 2 mm.
  No implicit projection from another storey is performed.
- Inputs are typed schema data, not unvalidated JSON. Independent finite,
  degeneracy and topology checks defend the geometry boundary. Limit: 256
  points, coordinates within 1000 km, distance from first vertex at most 10 km.

## Callable API

Every function returns `OracleResult<T>`: either
`{ kind: 'supported', value: T, toleranceMetres: 0.002 }` or
`{ kind: 'unsupported', reason, detail }`. Unsupported is never success.

| Export | Object argument | Supported value |
| --- | --- | --- |
| `gradeInside` | `{ markup, footprint }` | `boolean`: whole filled footprint lies inside the region |
| `gradeOutside` | `{ markup, footprint, minimumGapMetres }` | `{ satisfied, disjoint, gapMetres }` |
| `measurePointBoundaryDistance` | `{ markup, point }` | Unsigned planar distance in metres |
| `gradeCentreDistance` | `{ markup, centre, targetDistanceMetres }` | `{ satisfied, distanceMetres }` |
| `measureFootprintBoundaryDistances` | `{ markup, footprint }` | `{ vertexDistancesMetres, boundaryDistanceMetres }` |

`TOLERANCE_METRES` is fixed at **0.002 m** for the host's 1 mm grid; callers
cannot widen it. Circle containment uses the actual radial inequality. Polygon
containment partitions complete footprint edges at region-boundary intersections,
then checks interior intervals and analytic 2 mm segment capsules. Convex-region
containment can use this Euclidean allowance. Concave-region containment passes
when the complete edges are actually inside, fails if an edge exceeds the band,
and abstains with `tolerance-ambiguity` when certainty depends on the band: a
concave offset could seal a mouth and enclose an excluded interior pocket.

Outside means **disjoint filled regions** before applying the gap allowance.
Touching, crossing and containment fail, including requests for zero gap; the
allowance never permits penetration. `gapMetres` is zero for overlapping regions.
Boundary-to-boundary distance is a different measurement: containment can have a
positive boundary distance. Vertex distances alone cannot detect crossing edges.
The centre-distance grade uses `abs(measured - target) <= 0.002`. Measurements
remain unrounded; `1e-10` only resolves arithmetic degeneracy and topology.

## Parent-only execution

Run only in the parent-coordinated, bounded, isolated **server** container with
the exact committed source, Node >=24 and the parent's pinned dependencies.
These commands are a handback, **not evidence of execution**:

```sh
QUAL_SERVER_CONTAINER=issue238 node --test --test-concurrency=1 experiments/markup-qualification-238/grader.test.ts
npm run validate
```

The test suite refuses execution without the lease marker, Linux and
`/.dockerenv`; these checks cannot authenticate a lease or replace parent
coordination. Parent owns resource/time bounds, source SHA pinning, read-only
mounts, retained output and failure accounting. No server lease was requested or
assumed here. This new suite is intentionally absent from the shared registry.

Analytical adversarial tests cover circle bounding-box corners, concave L-notches,
all-vertices-inside segment crossings, rotated footprints/regions, minimum gaps,
containment/tangency at zero gap, finite segment endpoints, centre and vertex vs
boundary distances, nonzero/negative elevations, open-path undefined-inside,
self-intersections, warped inputs, invalid values, winding and input immutability.
They do not establish browser drawing, actual model-provider quality, proposal
geometry completeness, acceptance, deployment or production behavior.

## Live proposal receipts

`grade-live.ts` reads a bounded, retained observation file from the parent. It
restores each frozen base and proposed repository, computes the actual delta,
checks requested dimensions and preservation, and grades new footprints or
explicitly requested centres. Circle/concavity traps require a footprint outside
the actual region while inside its bounding rectangle. No provider review text
can satisfy those predicates. Edge cases also check the requested spacing.

`surface-grader.ts` independently checks the declared zero-elevation,
floor-standing cabinet case below a vertical rectangle: complete footprint stays
on one side of the wall, actual nearest plane gap, horizontal centring, width,
floor elevation and top below the outline. It abstains on a horizontal reference;
it is not a general sloping-surface or multi-storey placement oracle.

The open-line case separately checks the midpoint that the provider explicitly
assumed. The infeasible square/circle case checks the rotation-independent
half-diagonal radius and unchanged declined repository. Both retain a distinct
semantic-review outcome: arithmetic does not establish whether the explanation
honestly disclosed an assumption or declined the incompatible instruction.

Parent-only server commands also include `surface-grader.test.ts`. Keep original
case instructions, world coordinates, failed attempts and successive observation
files. A later retry does not erase a first-attempt failure. Recheck accepted
project hashes between observations; no live proposal in this exercise is accepted.

`cases.json` preserves the original ambiguous "either side" instruction and its
explicit one-cube clarification. The original count failure and subsequent
inherited-evidence revision failure remain failures; #240 tracks the latter.
`line-offset-one` is a separately drawn, fresh request with explicit cardinality,
not a replacement or relaxed score for the earlier conversation.
