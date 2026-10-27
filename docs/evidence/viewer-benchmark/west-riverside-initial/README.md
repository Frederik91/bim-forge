# Initial local West Riverside evaluation (#192)

This is a local, unqualified evaluation requested by the maintainer. Use all
seven IFC4 disciplines from the same pinned publisher revision. Keep source IFC,
prepared geometry, render screenshots, and browser traces in ignored private
storage. The request does not establish redistribution rights or a measured
200,000+ m² model.

**Decision: inconclusive; 200k+ m² qualification remains open under #192.** This
is an initial local configuration check. Raw outcomes, source bindings,
inventories, failures and private-artifact hashes are in [aggregate.json](aggregate.json).

The final local replay completed in Babylon. Fragments did not finish its
initial load within the 600-second candidate lifecycle limit. Both received the
same complete seven-discipline prepared input; full rendered-content correctness
was established only for Babylon. Neither outcome qualifies an engine for #192.

## Plan and ownership

`benchmarks/viewer/west-riverside.ts` downloads and verifies the seven files, tessellates them with
the pinned web-ifc version, and emits one common render model plus an inventory.
`benchmarks/viewer/contract.ts` preserves unknown floor area and unverified public provenance.
Both adapters consume the same geometry. `browser.ts` replays render-level
proposals and comparisons. Fragments' bounds oracle batches requests without
changing its per-element assertions.

Run the conversion tests, benchmark contract/lifecycle tests, root validation,
and real-Chrome smoke acceptance before full local runs. Keep failures and exact
source/lockfile/data hashes. Document measured work and all omissions. The
production model delta remains zero.

The follow-up reduces avoidable large-input allocations: fresh input may transfer
ownership after full validation, proposals copy element records while sharing
read-only tessellation, and exact per-record accepted-state comparisons replace
federation-sized temporary comparison strings. Tests still detect geometry and
metadata mutation. This does not remove whole-input validation from proposals.

## Reproduction

From the repository root, with Node 24 and the installed Chrome browser:

```sh
npm ci
node benchmarks/viewer/west-riverside.ts download
node --max-old-space-size=12288 benchmarks/viewer/west-riverside.ts convert
node --max-old-space-size=12288 benchmarks/viewer/runner.ts --dataset artifacts/private/west-riverside/prepared/model.json --channel chrome --cycles 1 --timeout-ms 600000 --output artifacts/private/west-riverside/run-001
```

Outputs are private by default. Use a new output directory for every browser
run. Each candidate has a separate bounded process. Do not run conversion or
other intensive work during measured browser runs. Repeat scored runs in a
balanced order before drawing comparative performance conclusions.

## Dataset and conversion limitations

- Floor area is unknown and stored as `null`. The physical building identity
  and modeled coverage are unverified. The 200,000+ m² qualification stays open.
- IFC-Bench declares CC BY 3.0 and reports a 2026 confirmation from the repository
  host. Older Autodesk statements describe the source Revit model as internal.
  The release/authorization chain for these specific IFC exports and published
  derivatives is unresolved. This execution is local only. Retain the notice,
  author/source attribution, input hashes, and conversion-change descriptions.
  The publisher attributes Wawan Solihin and the OpenIFC Model Repository,
  University of Auckland. The 2016 Revit statement does not by itself establish
  whether a later IFC release was authorized; that link remains to be verified.
- IFC2x3 and IFC4 are alternative exports, not additional buildings. Only the
  seven IFC4 files are included. Never sum floor area across disciplines.
- The converter emits render mesh parts with source product IDs. Render-part,
  source-product, and IFC-product counts are distinct. It reports empty geometry
  and omitted spaces, openings, or annotation geometry explicitly.
- Both viewers receive web-ifc 0.0.77 tessellation with 12 circle segments.
  Placed affine orientation and scale are baked into geometry. A single shared
  origin rebases the federation, rather than centering each discipline separately.
  Positions are rounded to a micrometre. Full IFC/engineering fidelity is not
  established by a successful tessellation.
- Materials are opaque RGB. Original alpha is retained as metadata and affected
  part counts are reported. Textures, full property sets, and room/storey
  containment are not qualified. Render proposals are not validated engineering
  edits to the IFC source.

The initial evaluation records loading, navigation, picking, filtering,
sectioning, bounded updates, and comparison behavior on the local workstation.
It does not choose an engine, certify laptop capacity, or satisfy the full
benchmark profile. See the source-bound report added with the run evidence.

## Completed Babylon replay and remaining evidence gaps

The second execution completed all requested replay operations and lifecycle
cleanup with no page errors on Chrome 155.0.8059.80. It reported 97,590 draw
calls and 15,334,885 triangles for the initial frame, matching the prepared
inventory. The identity/transform/bounds oracle covered all render parts.
The representative preview/comparison/discard cycle, stale rejection,
1/10/100/1,000-part proposals and 30 camera waypoints completed.

| Observed operation, one execution | Duration |
| --- | ---: |
| Renderer load and first camera, after fetch/parse/validation | 4.383 s |
| Full identity and bounds readback | 0.291 s |
| Preview affecting 1,000 parts, including common validation/diff/oracle | 17.421 s |
| Enter comparison for the representative render proposal | 1.071 s |
| Camera/update interval, median of 30 waypoints | 341.3 ms |

These are raw configuration observations, not comparative performance or
product-target scores. There are insufficient samples for interaction p95s.
Full project open was not timed. Common full-model validation remains inside
proposal measurements, which were around 17–18 seconds across all four sizes.
Profile and separate that work before comparing incremental renderer APIs.

Visual inspection found spatially separate geometry clusters. Confirm shared
coordinates and required source-to-federation transforms against the exports
before calling this a coordinated federation. The Babylon baseline and overview
comparison PNGs are byte-identical (SHA-256
`27f7f149907bc2afa9a45d8b8ce48b81fd105cab427da3b445a65298bf11e225`).
State readback confirms the added/modified/removed render records, but these wide
overview images do not demonstrate a visible engineering review. Add focused,
visible proposal cases and matched material/fidelity checks before qualification.

The earlier execution timed out at 600 seconds in Babylon's replay, after the
first proposal operation logged completion. Fragments' corresponding unscored
admission was manually cancelled after about 163 seconds during load so both
could use the allocation correction. Preserve the cancellation separately from
an engine failure. The timeout's underlying cause was not profiled; the completed
rerun does not establish that allocation was its only cause.

## Fragments load outcome

The second execution reached `start load` and timed out in `replay` after
600,932 ms, with no completed load sample or full-input readback. The watchdog
terminated its owned process tree and reported no cleanup errors. A 600-second
lifecycle timeout is not a measured 600-second completed load. Selection,
proposals, comparison and navigation on the full input remain unexecuted for
this candidate. Missing metrics are unavailable, not zero.

This adapter builds a raw editable model and submits the complete input through
the edit API. It does not exercise a native, preprocessed `.frag` loading path.
The small smoke replay passes, but this large-input configuration is not
qualified. The timeout does not establish an intrinsic Fragments capacity limit.
Retain it as counterevidence when changing the import strategy.

## Validation and continuation

`npm run validate` passed. Benchmark tests passed 21 cases, with one expected
platform-specific skip. The small real-Chrome replay completed in both viewers.
The additional scene/proposal suite passed 36 of 38 tests; two Windows `EPERM`
temp-directory cleanup hooks failed. Both failures reproduced on the unchanged
`f59687e` base in a separate worktree, using the same locked dependencies. These
tests and their validators are unchanged; this is a recorded baseline limitation.
The full run has one completed candidate and one bounded load failure; it is
not an all-green benchmark. Accepted production model delta: zero.

Next, validate source coordination transforms and conversion fidelity, create
visible engineering proposal cases, separate common validation from renderer
updates, and compare a native Fragments import with a batched/instanced Babylon
configuration under an equal tuning budget. Preserve shared geometry, identities
and content equivalence. Then run balanced repetitions, memory/CPU profiling,
the full scenario set and the actual primary laptop profile.

Admission still requires verified physical-project identity, modeled scope and
gross floor area, an evidence-backed release/redistribution chain for the exact
exports, and reviewed conversion losses. `grossFloorAreaM2` stays `null` and
`qualified` stays `false`. Keep issue #192 and the 200k+ m² qualification open.

Raw files remain under ignored `artifacts/private/west-riverside/`. The recorded
full runs use `prepared-v2/model.json`, `run-001/` and `run-002/`; the source and
prepared geometry hashes are unchanged across them. The run manifests bind the
then-current source hashes, dependencies, input, hardware and configuration.
Historical bundles/source maps remain private and hashed, including the first
run's earlier allocation strategy. Public evidence contains aggregate metrics,
inventories and hashes, with no IFC, mesh payload, render images or traces.

## Execution profile

The initial run uses Windows, Node 24.18.0, installed Chrome, an AMD Ryzen 7
7700X (16 logical processors), 64 GB RAM, and an NVIDIA RTX 4080 SUPER via
ANGLE/D3D11. The canvas is 1280 × 800 at device scale 1. This is a shared
workstation, not an exclusive measurement host or the primary 16 GB laptop.
An initial host sample reported 22% CPU load and about 21 GB free physical
memory. Those samples are not per-candidate peak or settled memory readings.

Each viewer runs once, sequentially, in a fresh browser process, with a
600,000 ms candidate lifecycle watchdog. Chrome uses its default JS heap
configuration. The runner/converter Node process has a 12,288 MB heap ceiling;
that is not a browser memory cap. Browser tracing is enabled and contributes
overhead. Assets are local, unshaped and served with `Cache-Control: no-store`.
The input is eagerly parsed JSON, not streamed geometry or native preprocessed
Fragments. Both configurations remain untuned for this workload.

The small admission replay completed on both viewers with no page errors and
confirmed the RTX 4080 SUPER renderer. It checks harness behavior, not full-input
completeness. The full-input replay requests one review cycle, fixed proposals
affecting 1/10/100/1,000 render parts, and a 30-waypoint exterior orbit. It does
not cover interior routes, room/storey isolation, acceptance, engineering
regeneration, cancellation/reload, or the 100-cycle memory-retention scenario.

`load` starts after input fetch/parse/validation and adapter construction.
Operation durations include renderer completion plus a browser animation frame;
review durations also include neutral diffs, model validation/cloning, and the
full identity/bounds oracle. Accepted-state serialization checks run outside the
review timer. Navigation intervals include camera/update work and are not
GPU-presented FPS. Source conversion and transport/parse costs must be reported
separately in any scored follow-up.

The expected claim is only: both experimental configurations were exercised
against this exact seven-discipline input, with completed work and failures
retained. A one-run, traced, untuned comparison on a shared workstation cannot
choose an engine or establish product targets.

## Local workload inventory

Pinned IFC4 inputs total 223,562,189 bytes. The common prepared input contains
97,590 render parts, 63,182 source products with rendered parts, 53,329 unique
geometry records, and 15,334,885 instanced triangles. Its JSON representation is
460,267,095 bytes, SHA-256
`99ca530d28d01f8a906af7b2ebb3cfa020af62226968c937fa3fcd4dbdd96a30`.
These are geometry/inventory measurements, not a floor-area calculation.

| Discipline | Rendered source products | Render parts | Triangles |
| --- | ---: | ---: | ---: |
| Architecture | 14,409 | 31,036 | 4,917,234 |
| Structure | 2,827 | 2,925 | 207,747 |
| Mechanical | 19,670 | 23,690 | 2,921,119 |
| Electrical | 2,798 | 5,313 | 148,966 |
| Plumbing | 9,121 | 12,541 | 4,525,772 |
| Fire alarm | 867 | 1,021 | 398,698 |
| Sprinklers | 13,490 | 21,064 | 2,215,349 |

All seven exports contain zero `IfcSpace` records. There are eight architecture
storey records and five in each other export; these are overlapping discipline
records, not unique floors to add together. The converter logged 32 native
web-ifc geometry errors and skipped 353 empty geometry parts (345 architecture,
eight structure). An error message is not necessarily one lost product. BREP
and opening fidelity require an independent source-versus-mesh audit.
Across the federation, 2,070 transparent parts were made opaque, including
2,006 in architecture. Bounds/identity agreement between adapters does not
resolve any of these source conversion gaps.

The converter's second execution used manifest integrity checks and matched the
first prepared JSON hash exactly. Conversion was approximately 48 seconds on
this workstation, including validation/serialization. Retain its raw log and
inventory rather than treating that single conversion as a speed comparison.

Sources: [IFC-Bench revision](https://huggingface.co/datasets/sylvainHellin/ifc-bench/tree/9ba471a3e38b353a81a1dc9ecb4aa56d2ce0a7fa/projects/west_riverside_hospital),
[CC BY 3.0 terms](https://creativecommons.org/licenses/by/3.0/),
[Autodesk source-model discussion](https://forums.autodesk.com/t5/revit-architecture-forum/revit-model-west-riverside-hospital-autodesk-courtesy/m-p/6701325).
