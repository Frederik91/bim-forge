# Viewer benchmark setup (#192)

## Implementation plan

Build a separate browser application under `benchmarks/viewer/`. Both adapters
consume the same validated, tessellated geometry, stable element IDs, camera,
and proposal delta. The production viewer and accepted model remain unchanged.

1. Define input, proposal, admission, and result contracts in `contract.ts`.
2. Add a deterministic synthetic fixture in `fixtures.ts` and a versioned
   measurement profile in `profile.json`.
3. Implement real Babylon and Fragments renderers under `adapters/`, including
   selection, filtering, sectioning, incremental replacement, and resource disposal.
4. Add an isolated browser replay and a CLI that builds local assets, serves only
   benchmark files on loopback, runs candidates separately, and retains evidence.
5. Verify neutral-model invariants with Node tests and both adapters in Chromium.
   Run `npm run validate` and relevant existing scene/proposal tests before a draft PR.
6. Document real-project acquisition, conversion, and admission requirements.

Model entities are benchmark render elements with source IDs and categories.
The fixture represents walls, slabs, doors, windows, equipment, and furniture
with simple triangle geometry. It does not claim engineering detail or IFC fidelity.
Proposal preview and comparison operate on disposable render data. Production
model delta: zero.

## Run the setup

Use Node 24 or newer from the repository root:

```sh
npm ci
npm run validate
npm run test:viewer-benchmark
npx playwright install chromium
npm run benchmark:viewer
```

If Chrome is already installed, use `npm run benchmark:viewer -- --channel chrome`
instead of downloading Chromium. On a full system drive, set `TEMP`, `TMP`,
`npm_config_cache`, and, if needed, `PLAYWRIGHT_BROWSERS_PATH` to a writable drive
before installation/execution. These are per-process settings.

Each CLI invocation creates a new evidence directory below the ignored
`artifacts/private/viewer-benchmark/` path. An existing output directory is
rejected so previous results cannot be overwritten. Example commands:

```sh
npm run benchmark:viewer -- --candidate fragments --channel chrome --cycles 100
npm run benchmark:viewer -- --candidate both --elements 1200 --cycles 3
npm run benchmark:viewer -- --dataset /private/project/render-model.json --output /private/runs/viewer-192-001
npm run benchmark:viewer -- --serve
```

`--serve` opens a loopback-only manual app and prints its URL. `--headed` displays
the automated browser. `--timeout-ms` bounds each candidate, with a 120,000 ms
default and a 600,000 ms maximum. Only one candidate runs at a time, in a fresh
browser process. The runner serves the supplied dataset and generated assets,
not arbitrary files or a directory listing. Keep outputs private when inputs
contain project data. Do not use an evidence directory inside `benchmarks/viewer/`.

## What the replay verifies

The two adapters use the installed engine packages. Fragments' matching worker
is copied from the pinned package and served locally. There is no CDN fetch.
Dynamic imports load only the selected engine. Neither adapter imports the
production viewer, repositories, credentials, model APIs, or deployment code.

The replay loads geometry, reads IDs/positions/world bounds back from the engine,
selects an element, reads its properties, ray-picks visible geometry, hides all
geometry, clips all geometry, and verifies hidden/clipped geometry cannot be
picked. A deterministic proposal moves an element, removes another, and adds a
third. Review shows added, modified, and removed geometry. Repeated compare,
comparison-exit, and discard operations must restore the exact baseline IDs and
bounds. A stale proposal must leave the baseline unchanged.

The replay also moves 1, 10, 100, and 1,000 elements when the fixture is large
enough. Missing sizes are explicitly reported as not run. The default 24-element
fixture is a geometry/adapter test, not a realistic project. `--elements` creates
more synthetic boxes and never changes dataset admission. Camera paths come
from the input model. The smoke fixture has an exterior orbit. Custom inputs
need their own views and meaningful pick locations.

Babylon shares vertex geometry and materials between meshes. Fragments shares
shells/materials and uses its real edit API. It creates a shell for each unique
geometry/scale pair to preserve nonuniform dimensions. Bounded replacements
delete instance data while retaining shared shells/materials. Runtime delta
models must participate in picking, filtering, clipping, and highlighting.

## Read the evidence

`run.json` records the source commit, dirty state, hashes of source files and
the lockfile, dataset hash/counts, OS/CPU/RAM, and profile. Each candidate JSON
contains raw elapsed times, draw calls, rendered triangles, frame intervals,
renderer identity, correctness checks, errors, and explicit limitations.
`completion.json` records the final setup status. Failed browser launches and
transport errors get a separate failure JSON. Baseline/comparison screenshots,
review data, browser versions, and Playwright traces are retained locally.

The result parser rejects missing scenario evidence and qualification claims.
It emits no p95 for groups with fewer than 100 samples. A completed setup always
has `qualified: false`. JSON schema checks cannot independently prove source
provenance or visual fidelity; review raw traces and screenshots too.

Both adapters support translation, positive nonuniform scale, arbitrary triangle
meshes, opaque colors, metadata selection, visibility, and a horizontal section
plane. Arbitrary rotations/mirroring must be baked into shared input geometry.
Both adapters preserve their camera while updating render elements. Comparison
uses opaque, colored previous geometry and retains unchanged context. Exact
overlap can hide an earlier surface; transparency and z-fighting qualification
remain future work.

## Remaining work in #192

This PR starts the benchmark. It does not complete the engine decision.

- Acquire/admit a real 200,000+ m² federated project using [the dataset checklist](dataset-requirements.md).
- Implement and measure IFC/native conversion and preprocessing, with equivalent
  tessellation, units/origin, material fidelity, and unsupported-category reporting.
- Add configuration A using the pinned production Babylon viewer. These new
  adapters are candidate setup B/C, not a claim that B has been fully optimized.
- Add spatial streaming/unload, instancing/batching tuning, memory/CPU/long-task
  instrumentation, network shaping, independent cold/warm repetitions, and
  hardware admission. Setup frame intervals include worker synchronization and
  correctness readback; they are not isolated render FPS or GPU presentation time.
- Expand to room/storey/discipline navigation, shared-family dependency fan-out,
  host/opening correctness, cancellation/failure recovery, acceptance into a
  disposable project, and an end-to-end AI request/proposal check. The current
  replay checks render-level deltas and stale rejection, not authoring semantics.
- Run the scored profiles and real-device tests from the issue, then write the
  engine recommendation. Store hardware memory evidence separately; no memory
  retention or real-tablet qualification is claimed by a completed setup run.

Preparation and conversion currently happen in the same browser load/update
operation. The neutral diff and world-bounds oracle scan the full input. Fragments
property and bounds readback crosses the worker boundary. Keep these costs
visible and split them into separately timed phases before scored comparisons.

Primary references: [Fragments lifecycle](https://docs.thatopen.com/Tutorials/Fragments/Fragments/FragmentsModels),
[Fragments edit API](https://docs.thatopen.com/Tutorials/Fragments/Fragments/FragmentsModels/EditApi),
[Babylon instances](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/instances).
