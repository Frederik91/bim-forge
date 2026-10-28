# Geometry access for LLM-driven BIM authoring

Investigation dated 2026-10-28. [Issue #225](https://github.com/Frederik91/bim-forge/issues/225). Source base `e7f6ff36a895feaf72b8cf88342278b6a3bf2dc2`, the PR224 integration head. Research and disposable experiments only. Native model delta is empty.

## Decision

Implement bounded, pinned semantic discovery and geometric measurements before exposing raw meshes to the AI. Start with object descriptions, source/coordinate provenance, spatial relations, and candidate clearance/collision/support checks. Let the host calculate distances. Use progressive retrieval when it avoids substantial data, with batched queries for small scenes. Add views with stable object IDs for identification and user intent. Retain exact computation and human acceptance as separate steps.

This is an implementation recommendation, not a demonstrated production accuracy or cost winner. The pilot establishes counterexamples to bounds-only decisions and exercises a read-only query path in ScriptBox. It does not qualify IFC geometry kernels or compare VLMs. The [literature map](llm-geometry-literature-225.md) records external claims, released artifacts, licenses, and transfer limits. The [experiment guide](../../experiments/llm-geometry-225/README.md) gives the reproducible procedure and acquisition protocol.

## Current integration has identity without agent geometry

At the pinned base, [`LinkedPrepared`](../../src/linked-model.ts) contains validated source-bound index and geometry artifacts. `LinkedSelection` identifies an IFC object and source occurrence. `demo/room-app.ts` adds that selection, object properties, class, name, and units to a named request attachment. It omits the mesh and product-to-source placement. [`ModelScripts`](../../src/model-script.ts) exposes native inspection and bounded proposal operations, without linked-geometry queries.

The converter in [`experiments/ifc-link/link.py`](../../experiments/ifc-link/link.py) already uses IfcOpenShell `0.9.0.post1`, local geometry in metres, product placement, and occurrence placement. It checks original/source/project coordinate bounds and preserves conversion diagnostics. The research adds no viewer, native state cache, source importer, runtime configuration, or acceptance endpoint. The deployed request cited by issue225 demonstrates property reading only; it is not a geometry-reasoning result.

## Primary implementation evidence

| Primary source | Verified behavior | Consequence for BIM Forge |
| --- | --- | --- |
| [buildingSMART IfcLocalPlacement source](https://raw.githubusercontent.com/buildingSMART/IFC4.3.x-development/master/docs/schemas/resource/IfcGeometricConstraintResource/Entities/IfcLocalPlacement.md) | Placement can be relative to another placement; absent `PlacementRelTo` means absolute placement. Cycles need application rules. | Compose the complete chain once. Return the coordinate frame and provenance; never use a source placement as a project location. |
| [buildingSMART IfcMapConversion source](https://raw.githubusercontent.com/buildingSMART/IFC4.3.x-development/master/docs/schemas/resource/IfcRepresentationResource/Entities/IfcMapConversion.md) | Engineering-to-map conversion applies scale, Z rotation, and translation. Scale may convert units. | Map conversion, link occurrence, and viewer origin are distinct. Do not apply a conversion twice or silently accept unsupported scaled transforms. |
| [buildingSMART IfcUnitAssignment source](https://raw.githubusercontent.com/buildingSMART/IFC4.3.x-development/master/docs/schemas/resource/IfcMeasureResource/Entities/IfcUnitAssignment.md) | Project units are global defaults, with possible local assignments. | Normalize query lengths to metres and preserve source-unit evidence. A text label is not a unit conversion. |
| [IfcOpenShell geometry processing](https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html) | `create_shape` supplies local vertices, triangulated faces, and a placement matrix, or a BRep. Processing an entire element applies openings. The iterator supports reuse and bulk processing. | Query the already prepared artifact first. Preserve representation choice, opening treatment, conversion failures, and tessellation tolerance. |
| [IfcOpenShell geometry tree](https://docs.ifcopenshell.org/ifcopenshell-python/geometry_tree.html) | Box selection differs from exact selection. Collision, intersection, and clearance checks have different inside/outside behavior. Clearance checks alone do not establish containment. | Publish distinct predicates. Never substitute a bounding-box overlap or surface-only collision for solid containment or engineering clearance. |
| [IfcOpenShell selector](https://docs.ifcopenshell.org/ifcopenshell-python/selector_syntax.html) | Queries can traverse properties, storey, space, parent, systems, and placements. | A small semantic query layer can avoid full IFC dumps. Declared spatial containment and measured geometric containment must remain distinguishable. |

The standards HTML endpoints returned 403 during this investigation. The links above are buildingSMART's own source repository. These are primary definitions, not a claim that every IFC exporter conforms. No external dataset or code was copied into the pilot. New fixture and experiment code follows this repository's license; paper/code/data licensing is tracked separately in the literature map.

## Competing hypotheses and pilot evidence

| Hypothesis | Discriminating observation | Current result |
| --- | --- | --- |
| Bounds and frames suffice for placement. | Rotated placements work, but equal enclosing boxes can contain a doorway or an L-shaped gap. | Useful discovery evidence; insufficient to prove exact shape decisions. |
| Host spatial tools remove fragile arithmetic. | Independent world-solid checks on transformed proposals, support, room scope, nearest object, and occluded obstacles. | Exact host policies pass this bounded synthetic set. Actual tool-assisted model outputs require separate grading. |
| Progressive retrieval saves resources. | Same available tool replies, returned eagerly or requested as needed. | Fewer facts/calls can coexist with more model turns and tokens. No cost winner. |
| A segmented image can certify clearance. | A hidden obstruction is absent from the same top view. | Image absence cannot prove free space. No VLM accuracy experiment was run. |
| Sandboxed TS is a useful composition layer. | Execute real guest code over a read-only API and exercise denial/budget controls. | Happy-path ScriptBox execution passed; negative-control receipts accompany final qualification. |

The fourteen fixed fixtures cover axis-aligned and composed rotations/translations, source mm, a 200 km offset, positive/negative free-side selection, hidden obstacles, a doorway, an L-shaped obstacle, a native support table, a room boundary, a different-level decoy, missing geometry, a stale source pin, and hostile source text. All are unions of rectangular prism cells. Native and IFC identifiers are namespaced, but this pilot does not federate multiple occurrences of duplicate GlobalIds. Host relationships are simplified support facts; native hosted-void authoring is deferred.

The planner uses interval gaps in a shared local fixture frame. The independent host oracle uses convex support functions and GJK distance in transformed project coordinates. It separately checks identity, target, alignment, station, support, room interval, preferred side, nearest object, and exact 0.5 m clearance with a 1 micrometre numeric tolerance. This tolerance is for analytic fixtures; it is not an IFC tessellation accuracy claim. Ten analytic distance checks and nine wrong-answer controls exercise the grader.

### Deterministic comparison

Qualification at `084c18f849d3c6677b30f7a9947a3339a8766dc5` produced 490 receipts, five alternating repeats per condition. All outcomes repeated identically. Two abstentions per full-geometry arm correctly handle missing/stale evidence.

| Authored policy | Tasks solved / 14 | Proposals with violations | Query/helper calls | Offered context bytes, all 14 cases |
| --- | ---: | ---: | ---: | ---: |
| Complete solids (`raw`) | 14 | 0 | 24 | 22,025 |
| Enclosing summaries | 12 | 2 | 24 | 19,942 |
| Eager exact tools | 14 | 0 | 24 | 16,541 |
| Progressive exact tools | 14 | 0 | 15 | 16,541 |
| ScriptBox TS | 14 | 0 | 24 | 16,541 |
| Image-only abstention policy | 2 | 0 | 0 | 14,439 |
| View plus progressive tools | 14 | 0 | 15 | 22,345 |

Counts describe authored policies, not LLM reasoning. Serialized bytes describe offered context, excluding tool replies and common instructions. The policies use fixture objects directly. Full raw geometry does not need a language model to solve this toy task. The summary policy makes conservative but incorrect preferred-side decisions for the doorway and L-shape cases. Its nearest-object claims also fail there. Image-only abstains for all fourteen cases; its two solved tasks are required abstentions. Hybrid decisions ignore the image, so their equality to progressive is by construction.

Micro timings and ranges are retained in receipts. They exclude inference, network, serialization, conversion, rendering, and grading. The limiter for the sandbox is guest compilation/execution, while direct policies only calculate small interval gaps. Cold compilation and warm sessions differ. There is no application end-to-end performance experiment; these timings cannot select a production stack.

### Actual connected LLM pilot

Four isolated `gpt-6.1-sol` agents at high reasoning effort each handled the same ordered five diagnostic tasks once. They received only their assigned synthetic packet. No oracle or report was supplied. Raw and summary conditions differ in shape information and wording about enclosure limits. They test evidence sufficiency; their scores cannot isolate representation from computation or instruction effects.

The eager/progressive control shares available helper facts and output contract. The helper supplies task-conditioned candidate coordinates, validity, and nearest IDs. Those values include host geometry computation. They are useful for testing retrieval and decision consumption, but would leak answers in a benchmark of unaided geometry reasoning. The helper is not the recommended production interface.

All twenty raw model outputs, exact packets, call requests/replies, and available session-token telemetry are in [`llm-trials.json`](../../experiments/llm-geometry-225/receipts/llm-trials.json). Raw returned four proposals and a stale-reference abstention. Summary returned five abstentions, including the required stale abstention. Eager and progressive returned identical proposals/abstention. Progressive requested five candidate replies; eager supplied eight. Independent grades are retained in the final receipt.

Observed session input/output token totals were raw 88,767/1,009, summary 88,104/218, eager 86,857/805, and progressive 176,299/884. Most input was cached inherited system/tool context. Progressive has extra turns and resends context. These are complete agent-session counters, not payload tokens or prices. Seed, temperature, billed dollar cost, and isolated provider latency were unavailable. One generation per condition gives no model reliability estimate, significance test, fine-tuning recommendation, or production accuracy claim. There were no output repairs or invalid helper requests in acquisition.

## Proposed read-only API

Use native and IFC reference variants rather than unqualified IDs. Parse external JSON with the existing TypeBox boundary, derive types from that schema, and issue opaque read handles. The following sketch describes semantics; it is not installed in the product.

```typescript
type GeometryRef =
	| { kind: 'native'; projectId: string; targetId: string; revisionId: string; entityId: string }
	| { kind: 'ifc'; sourceNamespace: string; sourceRevision: string; originalSha256: string;
		occurrenceId: string; occurrenceTransformSha256: string; globalId: string };
type Failure = 'missing' | 'stale' | 'unsupported' | 'incomplete' | 'limit' | 'ambiguous';
type Read<T> =
	| { kind: 'ok'; value: T; readSetSha256: string; completeness: 'complete' | 'partial'; toleranceMetres: number }
	| { kind: 'unavailable'; reason: Failure; refs: GeometryRef[] };
interface GeometryReadApi {
	describe(refs: GeometryRef[]): Promise<Read<ObjectDescriptions>>;
	query(scope: FrozenReadScope, filter: SemanticSpatialFilter, page: Page): Promise<Read<ObjectPage>>;
	relations(refs: GeometryRef[], kinds: RelationKind[], page: Page): Promise<Read<RelationPage>>;
	measure(candidate: OrientedBoxMetres, against: GeometryRef[], checks: CheckKind[]): Promise<Read<Measurements>>;
}
```

Descriptions include class/name, source units, project-Z-up frame, placement chain, project bounds, representation/tessellation quality, and diagnostics. Bounds are labeled enclosures. Query returns stable namespaced IDs and a cursor, not unbounded geometry. Spatial filters include box/radius candidates; nearest and geometric inside require exact refinement. Relations distinguish source-declared host, void, support, space, and level facts from measured or inferred relations. Unknown support is not proof of a structural load path.

`measure` returns distance intervals or tolerance, witness points, intersecting IDs, containment/support results where supported, and the complete read-set pin. A finite distance to a tessellated surface is not an exact BRep guarantee. Keep `intersection`, `touch`, `distance`, `inside`, and `support` separate. A broad-phase box hit means "needs refinement". It does not mean collision. A missing obstacle or partial query cannot certify a free side.

Initial limits should be explicit proposal values: 32 references per call, 64 KiB per result, 16 returned candidates per page, 16 calls per request, 50,000 existing source vertices maximum, and a 2-second geometry-worker deadline. Reuse stricter existing preparation limits. These values need real-scene calibration; the pilot does not establish their sufficiency. Pin converter/kernel version, artifact hash, units, transform digest, and approximation settings in the read receipt. Reject duplicate/missing identity and incomplete geometry where exact checks are required.

Guest TS receives only these bounded reads and existing authorized native proposal methods. It receives no source bytes, network, filesystem, credentials, mutable linked models, or acceptance capability. Aggregate/vectorized queries reduce repeated host crossings. Host rechecks frozen read handles after asynchronous work, when binding a proposal, and at human acceptance if linked evidence is a dependency. Source updates invalidate dependent measurements; a view selection alone grants no write authority. Main and As-is remain authoritative through existing native review.

## Ordered implementation and falsification

1. Add source-bound descriptions and bounded semantic queries over existing prepared artifacts. Prove occurrence/units/source freshness with real converted IFC fixtures. Keep the request attachment compact and return query handles.
2. Add a geometry worker adapter for candidate distance/intersection checks, with independent golden fixtures and explicit approximation/unsupported states. Reuse the converter's artifact provenance. Do not require raw IFC parsing or mesh arithmetic in model context.
3. Bind query read sets to proposal evidence and acceptance freshness. Add ScriptBox reads through the existing API generator. Preserve the single viewer and chat mount.
4. Run a blinded, repeated model study on disjoint holdout scenes. Give eager and progressive arms the same query semantics, candidate-generation budget, task set, token budget, and compute capabilities. Record final geometry with an independent kernel. Batch the small-scene condition and measure real end-to-end latency and billed cost before choosing retrieval defaults.
5. Add optional camera/depth/segmentation packets with source-bound ID maps. Test rotated cameras, hidden objects, stale ID maps, image-only abstention, and identical-text hybrid controls. Defer arbitrary mesh/BRep export, multi-occurrence federation, curved/non-manifold support, host editing, training, and large-building claims.

Change the recommendation if summaries with explicit analytic shape guarantees solve holdout tasks at lower observed cost without violations. Prefer eager batching if extra model turns dominate progressive savings. Add specialized geometry representations if mesh tolerances cannot certify requested clearances. Admit vision for final numeric checks only if an independent exact validator still verifies every proposal. Require a richer semantic API if host/room/level mistakes persist despite correct coordinates.

## Qualification and retained failures

All build/test commands run in new `/ssd1/bim-forge-qualification/issue225` directories on `frederik@192.168.1.17`. Source/dependencies are read-only; geometry containers have no network, 2 CPUs, 3 GiB RAM/swap cap, 256 PIDs, dropped capabilities, no-new-privileges, and bounded commands. These are resource caps, not measured peak consumption. Root validation, explicit changed paths, container inspection, raw logs, and source bundles are retained. The connected model phase is separate and uses only synthetic packets through the existing Codex route.

| Attempt | Source | Outcome and root cause |
| --- | --- | --- |
| 1 | Mistyped `1d62548d...` | Preflight checkout failed before a container ran. The supplied full SHA was incorrect. Retained directory; corrected with `git rev-parse HEAD`. |
| 2 | `1d6254808ad13f3a02e432764d9457d4d88105d6` | Root validation and 7-path policy passed. Guest compilation rejected an object argument where the generated ScriptBox method takes positional `1 | -1`. Retained full failure evidence. |
| 3 | `084c18f849d3c6677b30f7a9947a3339a8766dc5` | Complete deterministic pilot and independent oracle passed. No validator was weakened. |

Final qualification adds schema checks for all external LLM answers and sandbox denial/limit controls. Its exact source, log digests, all per-case outcomes, and any later failures are recorded in `experiments/llm-geometry-225/receipts/qualification.json`. No exhausted issue218 tests were rerun. No production models, preview services, credentials, deployment configuration, or factory loops were changed.
