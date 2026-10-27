# Synthetic residential workflow

Parent [#197](https://github.com/Frederik91/bim-forge/issues/197). Starting point: main `f59687e`, published server preview. The next prototype is built and tested with generated data; real house inputs are needed later to assess incomplete evidence and the actual modeling experience.

## Delivery and ownership

| Slice | Issue | Initial ownership |
| --- | --- | --- |
| Deterministic residential fixture | #198 | New fixture/generator/tests; reuse the existing eight-room residential floor |
| Persistent project evidence | #199 | Evidence domain/storage and source inspection, after the selected contract |
| Bounded geometric dependencies | #200 | New pure wall-change preview module/tests; coordinator owns ScriptBox wiring |
| Named design alternatives | #201 | Explicit baseline/alternative authority and comparison, after the selected contract |
| Read-only IFC links | #202 | Isolated import/index/geometry spike and manifest; no production renderer adoption |
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

Keep the original IFC content-addressed and immutable. An update creates a new source revision; it cannot silently replace the pinned link used by an existing request. Multiple occurrences of the same source model require distinct occurrence IDs and transforms. IFC GlobalIds identify rooted source objects; namespace them with the source model and link context, and report duplicates or missing IDs. STEP numbers may locate records within one file but do not establish identity across exports.

Engineering units, placements and map conversion remain explicit. Viewer origin offsets are presentation data rather than edits to source coordinates. Large reference models need bounded property/spatial queries and derived geometry loading independent of native portable history. A small successful fixture or a derived render format does not establish large-project performance.

Do not automatically fetch external URLs embedded in IFC. Preserve source references as data; conversion runs without network access and render dependencies must be pinned/self-hosted. Unsupported classes, properties, relations and geometry must be visible in diagnostics rather than silently omitted from a completeness claim.

Primary-source checks: buildingSMART defines rooted object [GlobalId](https://standards.buildingsmart.org/IFC/DEV/IFC4_3/HTML/lexical/IfcRoot.html) and explicit [map conversion](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcMapConversion.htm). That Open's [IFC loader implementation](https://github.com/ThatOpen/engine_components/blob/main/packages/core/src/fragments/IfcLoader/index.ts) exposes attribute/relationship selection, while its [Fragments implementation guide](https://github.com/ThatOpen/engine_fragment/blob/main/CONTRIBUTING.md) separates IFC conversion from its worker-backed runtime. These are candidate implementation inputs, not an engine-adoption decision.

## Architecture decision process

- [x] Ground the current model, storage, source and workspace boundaries.
- [ ] Compare two complete design shapes: model-native evidence/scenario state versus a project-owned ledger over immutable model revisions.
- [ ] Cross-review and synthesize a small public API with explicit ownership.
- [ ] Implement and integrate against the chosen contract; keep drafts reviewable.
- [ ] Replace the design if implementation reveals repeated authority or state-duplication workarounds.

Design candidates are graded against five concrete criteria: unambiguous acceptance authority, preservation of source/privacy/restart/conflict invariants, small composable APIs, bounded work under constrained resources, and compatibility with the single viewer plus separate read-only IFC references. No human design checkpoint was requested; routine choices proceed with recorded rationale.

## Verification and publication

Build/test only in isolated server containers, with clean source snapshots and SSD-backed dependencies/cache/artifacts. Root filesystem capacity is limited; no unrelated Docker pruning or unbounded workloads. The owner explicitly increased the retry allowance to ten total attempts so routine qualification corrections can proceed without repeated approval. Apply that allowance to this interactive work, record failures and inspect their cause before retrying. The coordinator's earlier PostgreSQL-only interpretation was unnecessarily restrictive. This does not change the factory's global policy, correctness validators, resource budgets or human merge requirements. Escalate if ten total attempts on an item are exhausted.

Each model-changing slice supplies a fixture, deterministic validation assertions and an inspectable before/after delta. Combined evidence must cover source provenance/conflicts, hosted geometry, unrelated state preservation, alternative isolation, restart recovery, stale authority refusal and visible draft/review state. Human review is required before merging geometry/schema/storage work. Approved combined changes are published to the server preview with paired static/runtime artifacts, rollback and accepted/source data preservation checks.
