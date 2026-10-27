# Synthetic residential workflow

Parent [#197](https://github.com/Frederik91/bim-forge/issues/197). Starting point: main `f59687e`, published server preview. The next prototype is built and tested with generated data; real house inputs are needed later to assess incomplete evidence and the actual modeling experience.

## Delivery and ownership

| Slice | Issue | Initial ownership |
| --- | --- | --- |
| Deterministic residential fixture | #198 | New fixture/generator/tests; reuse the existing eight-room residential floor |
| Persistent project evidence | #199 | Evidence domain/storage and source inspection, after the selected contract |
| Bounded geometric dependencies | #200 | New pure wall-change preview module/tests; coordinator owns ScriptBox wiring |
| ScriptBox partition preview | #207 | Typed sandbox API over the bounded wall operation and existing write fence |
| Named design alternatives | #201 | Explicit baseline/alternative authority and comparison, after the selected contract |
| Read-only IFC links | #202 | Isolated import/index/geometry spike and manifest; no production renderer adoption |
| Source and evidence library | #211 | Bounded private-source/history client and panel; parent owns chat and workspace integration |
| Integration | #197 | Contract, package scripts, server/ScriptBox/UI mounts, combined tests and release evidence |

Every coding attempt has its own branch/worktree. Existing `ModelViewer` remains the single model surface. `WorkspaceShell` owns layout only; evidence, alternatives, request chat and review must share that surface rather than creating competing viewers or accepted-state caches.

## Grounding

The native model already has immutable entity/revision bodies, proposals, scope bindings, queued conversational requests, source attachments and server-first recovery. `RoomRepository` validates portable documents and retains original reviewed proposals. `VersionedProjectStore` persists accepted pointers and changed bodies in SQLite. Current acceptance/publication APIs explicitly assume accepted `main` ancestry; named alternatives require an intentional authority change, not a renamed proposal or an independent mutable model cache.

`RequestSourceStore` owns private attachment bytes, media validation and bounded preparation for the agent. A project evidence library must preserve those boundaries while giving source material and its model anchors a lifecycle beyond one request. An observed or inferred assertion cannot silently become accepted engineering fact.

The native floor compiler and supported geometry validators handle bounded representations. They do not implement a general parametric/cyclic solver. A supported shared-wall edit must report changed room boundaries and evaluated hosted-object geometry, including dependents whose own stored bytes are unchanged.

Native portable bounds remain 100-item arrays, 32 revisions and 256 KiB documents. Generated workflow fixtures start within these constraints. A large linked IFC must use separate bounded queries/artifacts; putting all IFC objects into the portable native document is not an adoption path.

The IFC exchange experiments retain explicit property preservation losses and unsupported mappings. The viewer benchmark has synthetic correctness evidence and no qualified engine winner. Retain original IFC bytes and source authority, and treat indexes/render artifacts as derived, replaceable data. Source lineage/revision, link occurrence, units and coordinate transforms are part of identity/context. IFC linking does not imply lossless native editing or hospital-scale qualification.

## Early IFC linking

Prioritize a read-only reference path alongside native authoring. The eventual user flow is attach an IFC, see asynchronous processing progress, inspect its spatial hierarchy/objects/properties, control visibility and reference selected objects in a request. Converting chosen objects into native authoring is a later reviewed operation with explicit mapping and loss evidence.

The initial #202 prototype establishes the import/index/geometry artifact contract, failure diagnostics and resource boundaries. It must not claim the production UI already links arbitrary files. Production integration follows source-bound correctness and viewer checks.

The [bounded prototype](ifc-link-202.md) passed 24 server-container checks, including rejection of unsafe source coordinates before applying an occurrence transform. Two [licensed dataset candidates](ifc-datasets-202.md) are pinned for follow-up admission. Neither fits the unchanged spike bounds; they have not been admitted, converted or qualified as production reference models.

Keep the original IFC content-addressed and immutable. An update creates a new source revision; it cannot silently replace the pinned link used by an existing request. Multiple occurrences of the same source model require distinct occurrence IDs and transforms. IFC GlobalIds identify rooted source objects; namespace them with the source model and link context, and report duplicates or missing IDs. STEP numbers may locate records within one file but do not establish identity across exports.

Engineering units, placements and map conversion remain explicit. Viewer origin offsets are presentation data rather than edits to source coordinates. Large reference models need bounded property/spatial queries and derived geometry loading independent of native portable history. A small successful fixture or a derived render format does not establish large-project performance.

Do not automatically fetch external URLs embedded in IFC. Preserve source references as data; conversion runs without network access and render dependencies must be pinned/self-hosted. Unsupported classes, properties, relations and geometry must be visible in diagnostics rather than silently omitted from a completeness claim.

Primary-source checks: buildingSMART defines rooted object [GlobalId](https://standards.buildingsmart.org/IFC/DEV/IFC4_3/HTML/lexical/IfcRoot.html) and explicit [map conversion](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcMapConversion.htm). That Open's [IFC loader implementation](https://github.com/ThatOpen/engine_components/blob/main/packages/core/src/fragments/IfcLoader/index.ts) exposes attribute/relationship selection, while its [Fragments implementation guide](https://github.com/ThatOpen/engine_fragment/blob/main/CONTRIBUTING.md) separates IFC conversion from its worker-backed runtime. These are candidate implementation inputs, not an engine-adoption decision.

## Architecture decision process

- [x] Ground the current model, storage, source and workspace boundaries.
- [x] Compare two complete design shapes: model-native evidence/scenario state versus a project-owned ledger over immutable model revisions.
- [x] Cross-review and synthesize a small public API with explicit ownership.
- [ ] Implement and integrate against the chosen contract; keep drafts reviewable.
- [ ] Replace the design if implementation reveals repeated authority or state-duplication workarounds.

Design candidates are graded against five concrete criteria: unambiguous acceptance authority, preservation of source/privacy/restart/conflict invariants, small composable APIs, bounded work under constrained resources, and compatibility with the single viewer plus separate read-only IFC references. No human design checkpoint was requested; routine choices proceed with recorded rationale.

### Synthesis decision

Choose candidate A's native acceptance authority and graft candidate B's immutable evidence ledger. The independent cross-review agrees. External scenario receipts that leave the native review pending are rejected; so is storing every source observation inside native geometry revisions. Raw source bytes remain owned by `RequestSourceStore`, with explicit project retention extending both read eligibility and expiry.

`RoomRepository` owns typed main/alternative targets, immutable baseline pins, target-local accepted ancestry and review decisions. Keep existing geometry revision hash preimages and legacy review/hash behavior. A new envelope may introduce target metadata; old readers must reject an unsupported format instead of misreading it. `VersionedProjectStore` publishes the selected target atomically with the existing queue's decision transaction. No temporary main-pointer swap or cloned-project adapter is permitted.

The evidence store owns immutable claims, corrections, explicit conflict resolutions and command receipts, not accepted geometry or scenario heads. Native reviews pin evidence entry IDs/hashes, relevant subject/property candidate-set signatures including absence, source hashes and anchor applicability. New relevant contradictions invalidate readiness; unrelated evidence does not. Observed, measured, inferred and assumed assertions remain distinguishable. Corrections never overwrite original claims or silently promote an assumption. An agent may select an existing conflicting claim as an explicit proposal-specific design assumption through hashed `evidenceUses` with a rationale. This permits human review of a useful proposal without globally resolving source history. Changed candidate sets, superseded facts, unknown required values and missing or corrupt sources still block acceptance.

Parent integration owns queue/server/ScriptBox/UI, frozen target/evidence dispatch and combined transactions. The #201 core worker owns native target/ref/restore/acceptance plus the versioned model store, publishing exact APIs before parent caller migration. The #199 worker owns `src/model-evidence.ts`, `demo/project-evidence-store.ts` and project retention in `demo/request-source-store.ts`; it does not edit the queue, server, viewer or native repository. Both workers build on the already integrated fixture and pure wall helper.

Acceptance checks command receipts before freshness so a lost response can replay idempotently after later advances. Following asynchronous preparation, recheck the selected target, ticket, evidence read set and cancellation/generation fences in the same SQLite transaction. Sibling-target races must preserve sibling heads. Baselines never yield writable authority. Portable/native scenario history must itself prove acceptance; complete private bundles additionally need pinned evidence/source closure. Missing dependencies remain visible and block dependent new acceptance.

First integration case: retain the generated plan and invented measurement sheet as explicitly synthetic sources, record their competing documented values, capture an As-is baseline, fork a partition alternative, prepare a wall proposal on that alternative, review geometry and the chosen evidence assumption, accept, restart, and verify the original main/baseline and unrelated contents remain unchanged. The sample uses a fresh project UUID; the fixed fixture UUID is reserved for disposable tests. Source identities and evidence commands are deterministic within that project so an interrupted setup can resume without duplicate claims.

The initial fixture and wall helper passed 26 combined server tests at `179e34f`. Native/guest evidence review passed 130 focused tests. Parent queue attempt 4 at `cc9dbb5` passed root validation and 70 of 71 checks: all five queue workflow cases, actual HTTP sample setup with an interrupted upload, and source/evidence routes passed. One existing static-asset check failed because the harness had not built the browser bundle; the harness now builds before server tests. Full workspace/browser integration remains in progress. These correctness checks do not qualify large-project capacity or real-house evidence accuracy.

## Verification and publication

Build/test only in isolated server containers, with clean source snapshots and SSD-backed dependencies/cache/artifacts. Root filesystem capacity is limited; no unrelated Docker pruning or unbounded workloads. The owner explicitly increased the retry allowance to ten total attempts so routine qualification corrections can proceed without repeated approval. Apply that allowance to this interactive work, record failures and inspect their cause before retrying. The coordinator's earlier PostgreSQL-only interpretation was unnecessarily restrictive. This does not change the factory's global policy, correctness validators, resource budgets or human merge requirements. Escalate if ten total attempts on an item are exhausted.

Each model-changing slice supplies a fixture, deterministic validation assertions and an inspectable before/after delta. Combined evidence must cover source provenance/conflicts, hosted geometry, unrelated state preservation, alternative isolation, restart recovery, stale authority refusal and visible draft/review state. Human review is required before merging geometry/schema/storage work. Approved combined changes are published to the server preview with paired static/runtime artifacts, rollback and accepted/source data preservation checks.
