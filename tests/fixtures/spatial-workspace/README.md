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
The offline `spatialFixtureWorker` calls #270's real bounded ScriptBox WASM method
`model.previewHostedDoorWidth`, then uses the existing queue/review/explicit
decision path. It never calls a provider or injects a snapshot. Its optional
`region-context` mode actually returns a clarification asking which door to use.

`spatialFixtureVisual` supports object, region-only and mixed source-bound visual
context. Origin and camera constants are separate from those targets. #254 owns
validated durable placement: `spatialFixturePlacement` consumes its concrete types
and binds the real project, main revision, frame and creation level. Object, region
and mixed modes preserve separate origin and target collections. #255 owns camera
pose types; manifest eye/forward/up values are input constants, not a wire schema.

Reusable helpers for #258:

- `fixture.ts`: `spatialAcceptanceFixture`, `spatialFixtureManifest`,
  `spatialFixtureRequest`, `spatialFixtureVisual`, `spatialFixturePlacement`,
  `spatialMissingTargetPlacement`, `spatialUnplacedFixture`, `spatialDoorFacts`,
  `spatialExpectedDoorSnapshot`. Request IDs/proposal names use lowercase words
  separated by hyphens. Region mode intentionally grants no object selection.
- `worker.ts`: `spatialFixtureWorker({ mode, inspectInput, afterScript })`;
  `spatialWorkerGate()` pauses after a real script result and releases on abort
  (or explicit `release`). `reached`/`finished` promises avoid timing guesses.
- `harness.ts`: `spatialQueueFixture(testContext, worker?)`, `spatialWaitFor`,
  `spatialAcceptedSnapshot`, `assertSpatialDoorDelta`. The queue helper uses #265's
  single asynchronous resource owner to drain all queues/SQLite before deletion.

`npm run test:spatial-acceptance` runs 12 checks, including persisted acceptance,
same-door identity/replay/follow-up, region clarification, legacy/unplaced/missing
targets, cancellation/late staged result, superseded turns, conflicting proposals,
restart during work and explicit retry. The historical legacy fixture modifies
only a disposable SQLite record to simulate an omitted placement field. The
missing-target fixture is inspectable historical data and deliberately rejects
new submission; no nearby native object substitutes for it.

#258 owns actual browser/UI navigation, graphics, Plan, local server and combined
release evidence. These deterministic queue checks do not qualify those gates.
