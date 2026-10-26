# Composable model scopes

Parent #171. Baseline `7ab61dc5666c58886722a683fbf5171dcb683f3d` includes the deployed versioned-house work. Existing preview remains unchanged during implementation.

## Swarm checklist

- [x] Frame: inspect deployed source, define selectors, ownership and acceptance evidence.
- [x] Fan out: independent domain, query, workflow and browser worktrees.
- [ ] Aggregate: coordinator persistence/projection work and combined server/UI checks.
- [ ] Report: source-bound draft PRs, inspectable delta and explicit limitations.

## Contract

`src/model-scope-contract.ts` owns strict TypeBox wire schemas: typed parameter values/bindings, composable allOf/anyOf/exclusion queries, frozen scope evidence and saved definitions. IDs are stable domain IDs. Queries support explicit IDs, room/level membership, entity kind, furniture kind, shared asset family, typed parameter presence/kind/comparison, bounded geometric observations and directed model relations. Geometric predicates describe bounds, not exact solid intersections or new design constraints.

A saved scope is a versioned query definition belonging to a project. Each request copies that definition and freezes exact targets, read-only context, dependent and writable IDs against an immutable base revision. Context is never blanket write authority. Recompute the binding from the base to refuse forged evidence; compare current membership and relevant baseline dependencies before acceptance. Preserve unrelated accepted edits. New matches never silently join a reviewed proposal.

Parameter editing uses built-in geometric dimensions and optional typed `parameters` on existing entity versions. Absent metadata must preserve legacy bytes/hashes. Definition identity, value kind and units are explicit; geometric built-ins cannot be shadowed by user metadata. Existing support/hosting/family/containment constraints provide dependency propagation and validation. No arbitrary expression evaluator, cyclic constraint solver or duplicate authoritative geometry is introduced. Shared-family recipe changes enumerate affected occurrences; subset variants preserve other instances and original definitions.

## Ownership and APIs

- #172 domain: `src/model-parameters.ts`, RoomRepository/asset metadata and related schema/tests. Exports `modelParameters(entity)`, `applyModelParameterEdits({snapshot,targetIds,edits})`, `parseModelParameters(value)`; shared parameter edits use `{definitionId,name,value}`. Add optional `scope?: FrozenModelScope` to persisted `ProposalReview` and enforce query worker guards in direct proposal/acceptance paths.
- #173 query: `src/model-scope.ts`, tests and dedicated fixture. Exports `resolveModelScope({graph,query})`, `freezeModelScope({graph,query,baseRevisionId})`, `assertModelScopeFresh({base,current,binding})`, `assertModelScopeWrites({before,after,binding})`. Resolution returns `targetIds,contextIds,dependentIds,writableIds,relationshipIds`. Frozen body identity is pinned by base revision; guards compare exact canonical bodies from that revision, not collision-prone hashes. Query module imports RoomRepository types only and the domain parameter reader; it must not instantiate repositories at module load.
- #174 workflow: proposal/ScriptBox, queue, HTTP, request context and matching tests. Requests add optional `scope: ScopedRequest`; reviews add frozen `scope`. Existing requests without scopes remain legitimate. Use `model.scope()` and `model.previewParameters({edits})` in ScriptBox; every existing geometry authoring method fences deltas when scope is present. A preview does not imply approval.
- #175 browser: room app/HTML/CSS and new scope client/tests. An optional scope builder composes filters, previews targets/context/impact and saves named queries. Review shows frozen membership/dependency evidence. Preserve normal selection and visual intent semantics and server-first recovery.
- Coordinator: this contract, `demo/versioned-project-store.ts`/contract and new scope persistence/projection files, package/Docker wiring, cross-slice tests, evidence and server scheduling. Do not duplicate these files in workers.

HTTP shapes (existing host/origin/project/size guards apply):

```text
POST /api/projects/:id/scope-preview {baseRevisionId,query}
  -> {scope: FrozenModelScope, graph: ModelGraph}
GET /api/projects/:id/scopes -> {scopes: SavedModelScope[]}
POST /api/projects/:id/scopes {id,name,query,expectedVersion: string|null}
  -> {scope: SavedModelScope}
```

The preview graph contains selected objects plus required context/dependencies, with stable IDs, and is not a standalone valid portable project. No complete portable history is returned. Persistent projections are derived from immutable entity/revision bodies and updated from changed records, not one membership copy per revision. Saved definitions use CAS versions; later edits cannot rewrite submitted queries.

## Verification and limits

Done means the actual asynchronous request/ScriptBox/review flow proves one room edit and one building-wide type/parameter edit, correct units, dependency/context separation, subset family safety, frozen membership across restart, unchanged unrelated accepted edits and refusal of newly matching/relevant changed data. Use real supported/hosted assets and rooms/levels, a deterministic validator and inspectable before/after delta. Verify bounded working-set reads without full portable-history hydration. Server containers only; root validation and focused tests per worker, full combined suite and browser check by coordinator. Draft PRs, no main merge or preview deployment during this task. Keep all validators and existing portable caps; do not assert hospital performance or arbitrary geometry capability.
