# Composable model scopes

Parent #171. Baseline `7ab61dc5666c58886722a683fbf5171dcb683f3d` includes the deployed versioned-house work. Existing preview remains unchanged during implementation.

## Swarm checklist

- [x] Frame: inspect deployed source, define selectors, ownership and acceptance evidence.
- [x] Fan out: independent domain, query, workflow and browser worktrees.
- [x] Aggregate: coordinator persistence/projection work and combined server/UI checks.
- [x] Report: source-bound draft PRs, inspectable delta and explicit limitations.

## Contract

`src/model-scope-contract.ts` owns strict TypeBox wire schemas: typed parameter values/bindings, composable allOf/anyOf/exclusion queries, frozen scope evidence and saved definitions. IDs are stable domain IDs. Queries support explicit IDs, room/level membership, entity kind, furniture kind, shared asset family, typed parameter presence/kind/comparison, bounded geometric observations and directed model relations. Geometric predicates describe bounds, not exact solid intersections or new design constraints.

A saved scope is a versioned query definition belonging to a project. Each request copies that definition and freezes exact targets, read-only context, dependent and writable IDs against an immutable base revision. Context is never blanket write authority. Recompute the binding from the base to refuse forged evidence; compare current membership and relevant baseline dependencies before acceptance. Preserve unrelated accepted edits. New matches never silently join a reviewed proposal.

Parameter editing uses built-in geometric dimensions and optional typed `parameters` on existing entity versions. Absent metadata must preserve legacy bytes/hashes. Definition identity, value kind and units are explicit; geometric built-ins cannot be shadowed by user metadata. Existing support/hosting/family/containment constraints provide dependency propagation and validation. No arbitrary expression evaluator, cyclic constraint solver or duplicate authoritative geometry is introduced. Shared-family recipe changes enumerate affected occurrences; subset variants preserve other instances and original definitions.

A scoped draft may introduce a new immutable family definition only when it is used exclusively by existing writable occurrences of one observed original family. It cannot add occurrences, orphan definitions or affect unselected siblings. Rebinding to an existing unobserved family is refused. The new authored definition appears in subsequent script inspection and in the reviewed addition delta; it does not expand the frozen target set. This permits explicit subset variants without blanket creation authority.

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

The preview graph contains selected objects plus required context/dependencies, with stable IDs, and is not a standalone valid portable project. No complete portable history is returned. Revision reads replay bounded identity/hash deltas and hydrate only the requested revision or selected item bodies. One compact derived scope projection is cached per project, rather than copying membership into every revision. A cold or changed-revision cache rebuild validates that revision; warm previews reuse its compact records. Saved definitions use CAS versions; later edits cannot rewrite submitted queries.

A named wing is a saved query spanning its constituent spaces or levels. Saved areas may overlap. They do not create a second containment hierarchy or change spatial ownership. Scope context is deliberately conservative: objects sharing a relevant room and hosting/family dependencies can invalidate an assumption even if they are not writable.

## Verification and limits

Done means the actual asynchronous request/ScriptBox/review flow proves one room edit and one building-wide type/parameter edit, correct units, dependency/context separation, subset family safety, frozen membership across restart, unchanged unrelated accepted edits and refusal of newly matching/relevant changed data. Use real supported/hosted assets and rooms/levels, a deterministic validator and inspectable before/after delta. Verify bounded working-set reads without full portable-history hydration. Server containers only; root validation and focused tests per worker, full combined suite and browser check by coordinator. Draft PRs, no main merge or preview deployment during this task. Keep all validators and existing portable caps; do not assert hospital performance or arbitrary geometry capability.

The prototype still has the existing 100-entity and 32-revision portable bounds. Its compact query cache is not the hospital-scale indexed database, incremental geometric kernel, arbitrary formula engine or cyclic solver. Dimensional edits regenerate existing supported representations and pass the existing support/hosting/placement validators; unsupported mappings fail atomically. A future large-model adapter must preserve these query/frozen-authority semantics while replacing cold projection rebuilds and portable request hydration with indexed, paged reads.

## Integration evidence

Aggregate draft: [#180](https://github.com/Frederik91/bim-forge/pull/180), stacked on #170. Worker drafts: domain [#176](https://github.com/Frederik91/bim-forge/pull/176), query [#178](https://github.com/Frederik91/bim-forge/pull/178), workflow [#179](https://github.com/Frederik91/bim-forge/pull/179), browser [#177](https://github.com/Frederik91/bim-forge/pull/177).

Review and integrate #180 as the combined change. The worker drafts retain slice-level ownership/evidence; some require sibling modules and coordinator persistence, so their standalone contract-base CI is not an independent shipping qualification.

Server source `3aa2f4414707f74cd60929dacd0867c564bde932` passed root validation, demo build, exact 37-path policy check and 66 combined integration tests. The owner-approved corrected ScriptBox run at ancestor `a14b03edcddf4da0b0a009151bbbd5363ed5929b` passed 18 tests; no ScriptBox application code changed between these sources. Raw evidence lives under `/ssd1/bim-forge-qualification/scopes-171/{integration,corrected}/` with pinned source bundles and container inspection. Test containers use Node 24 image `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`, 0.5 CPU, 1 GiB, no swap and no network.

Inspectable HTTP/restart delta (`demo/scoped-house.test.ts`):

| Entity | Before | Reviewed result |
| --- | --- | --- |
| `office-desk` | width 1.6 m; no inspection interval | width 1.8 m; interval 2 h |
| `living-person` | instance height 1.87 m | instance height 1.9 m; interval 2 h |
| `bedroom-person` | instance height 1.87 m | instance height 1.9 m; interval 2 h |
| `office-monitor`, `office-laptop`, `standing-person` | supported devices and shared recipe | exact original bodies |

The requests are prepared independently, reopened after server restart, then accepted in sequence. The accepted delta contains exactly those three modified entity IDs and preserves the independent edit. Separate cases refuse newly matching objects, relevant dependency changes and forged write scope. Corrupt unrelated proposal bodies do not prevent a selected working-set read; corrupt selected bodies still fail closed.

Remaining regression suites at `3aa2f44`: 470 passed, zero failed, two skipped because the container runs as root and those existing factory cases require a non-root caller. Raw log: `integration/regression.log`. The final scoped-family addition at `1643595c193f408f9840f1544c732b481390a158` passed root validation (131 TypeScript files) and 39 focused tests, including two new real scoped-variant cases. Those cases prove a new definition plus one rebound occurrence, unchanged original/sibling, no orphan/extra occurrence authority, and refusal of unobserved existing families. Raw evidence: `variant2/`. Across the standard suite, these disjoint partitions cover 556 passing tests and two existing skips; the 39-test supplemental run repeats 37 domain/query tests and adds two cases.

Desktop and 390 x 844 browser proof used a disposable server-container fixture with the exact built `3aa2f44` UI (bundle SHA-256 `1a758f4fd8e9de28c4543f4944c71b8565167963d50bd042f554506fa493a60e`). Both views selected an object, composed room/type filters, previewed, saved/reopened the query, submitted and opened frozen review. The desk had 1 target, 14 context objects, 2 dependents and 3 writable objects. The phone accepted a plant proposal at revision prefix `5a4f265702`; the desk then correctly required fresh review because that plant was relevant context. Phone document width did not overflow. A first fixture attempt exposed a nested-directory asset-copy mistake; correcting the fixture copy restored matching markup and bundle. No application fix or live-preview change was involved.

Browser screenshots/result are retained locally under `artifacts/private/scope-ui-qa-3aa2f44-attempt2/` in the #175 worktree. Server fixture/source/logs are retained under `integration/browser/`. The final variant changes do not modify UI controls; the added real ScriptBox test qualifies their new inspection/acceptance behavior.

## Parallel follow-up sessions

The user requested separately navigable sessions while this task finishes scope work. [Request conversations](codex://threads/01a1798b-0cbb-7901-8727-29895a4d927d) owns #181/#182/#183; [Model-first workspace](codex://threads/01a1798b-2704-70c1-9252-0f5e23341476) owns #184. Both start from `1643595` in isolated managed worktrees. The model-first shell owns permanent model/context/navigation panel placement and reserves `#request-chat-mount`; conversation components own its contents. The parent session monitors progress and relays contract changes. These are ongoing follow-ups, not capabilities claimed by #180.
