# Spatial acceptance fixture

Issue #264 owns these helpers. They construct a disposable native three-level,
six-room building using the existing validated multi-storey model. This is authored
test geometry, never a survey or production project.

Stable project: `00000264-0000-4000-8000-000000000264`. Ground-floor task target:
`level-ground-door-inner`, hosted by `level-ground-wall-inner` through
`host-level-ground-door-inner`. Project coordinates are X east, Y north, Z up,
in metres. The source revision is obtained from the constructed repository, not
copied from another run.

| Field | Accepted baseline | Required proposal |
| --- | --- | --- |
| Door width | 0.9 m | 1.1 m |
| Hosted offset | 3.0 m | 2.9 m |
| World centre | [4, 3.45, 0] m | [4, 3.45, 0] m |
| Other entities/relationships | Baseline | Exactly retained |

`spatialExpectedDoorSnapshot` is an independent expected-data oracle. It must
never be supplied as a canned worker result or accepted through a test-only route.
The real deterministic worker must use the bounded ScriptBox method delivered by
#270 and the existing queue/review/explicit decision path. That worker and combined
restart/cancellation/stale-result journey are still pending at this preparation
checkpoint. These three fixture checks do not qualify the end-to-end workflow.

`spatialFixtureVisual` supports object, region-only and mixed source-bound visual
context. Origin and camera constants are separate from those targets. #254 owns
validated durable placement and #255 owns camera pose types; adapters must consume
their concrete contracts instead of treating this manifest as a wire schema.

Preparation check: `node --test demo/spatial-workspace-fixture.test.ts`.
