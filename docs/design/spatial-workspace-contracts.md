# Spatial workspace contracts

Issue [#261](https://github.com/Frederik91/bim-forge/issues/261), within [#251](https://github.com/Frederik91/bim-forge/issues/251). This reference supplements the [implementation plan](spatial-workspace-implementation.md). The first milestone serves one engineer in the existing trusted environment. Team identity and privacy remain a [separate design gate](https://github.com/Frederik91/bim-forge/issues/259).

The existing source was checked at `7cc79034a772e1e56fdbbba7e64d2a5aeb792597`. The rules below are the shared implementation agreement. Existing types and behavior are named explicitly. Proposed concepts are handoffs, not implemented exports, endpoints, or storage schemas. Concrete parsers, versioning, migration, and rollback belong to #254.

## Identity and coordinates

| Concept | Contract | Existing owner |
| --- | --- | --- |
| Task | The pair `projectId`, `ticketId` identifies one durable conversation. The first ticket ID equals its initial `requestId` today. Later requests do not change the task ID. | `demo/change-requests.ts`, `src/request-conversation.ts` |
| Turn and attempt | Preserve `messageId`, `requestId`, and sequence. Worker execution is identified by ticket, request, and numeric `attempt`. There is no separate `attemptId` field. An avatar does not create another worker identity. | `ChangeRequests`, `StoredExecution`, conversation schemas |
| Native object | Retain project, design target, revision, and entity ID. Use existing `GeometryRef` semantics when an object needs a qualified spatial reference. An entity ID alone is insufficient across projects or revisions. | `src/geometry-contract.ts` |
| Linked object | Retain namespace, source revision, original SHA-256, occurrence ID, GlobalId, and placement binding. `GeometryRef` uses `placementDigest`; `LinkedSelection` carries the occurrence transform. Neither representation grants native write authority. | `src/geometry-contract.ts`, `src/linked-model.ts` |
| Point and frame | Canonical points are finite `[X east, Y north, Z elevation]` metres in `project-engineering-metres`, scoped to a project and pinned snapshot. Frame names are not a global georeference. The current geometry coordinate envelope is ±1,000,000 m. | `src/spatial-markup.ts`, `src/geometry-contract.ts` |
| Rendering | Convert project `[x,y,z]` to Babylon `[x,z,y]` only at the rendering boundary. Convert legacy millimetre references once through the existing adapter. Plan projection and inverse hit mapping preserve the selected revision and level elevation. | `demo/model-scene.ts` `modelPoint`, `src/visual-request.ts`, #262 |

Linked geometry is already normalized to metres. Apply product-to-source and source-to-project transforms in that order before the Babylon axis conversion. Do not apply the original IFC millimetre scale again. Retain the exact source and occurrence pin when a linked surface supplies placement context. Current linked georeferencing remains unapplied.

## Origin, placement, and targets

| Concept | Required meaning | Owner and handoff |
| --- | --- | --- |
| Draft origin | Capture the explicit starting point, project frame, snapshot/source pins, and creation view context once when the composer begins. The draft remains local unsent content. Later selection, movement, and highlights cannot recapture its origin. | #253 draft owner; #257 binds navigation and persistence |
| Placed task | Validated metadata records the captured project point and provenance atomically with first submission. Preserve the original point and pins through continuation, retry, navigation, restart, and model changes. | #254 storage; #257 projects it |
| Unplaced task | Explicit alternative to placed. Legacy data or absent trustworthy context does not acquire a fabricated point. Keep the task discoverable in the list. | #254 compatibility; #257 presentation |
| Recovery placement | An explicit later placement is a new recorded recovery association. It cannot rewrite a known historical origin or pretend a legacy origin was captured at creation. #254 specifies its concrete representation and conflict rules before storage changes. | #254, then #257 |
| Task targets | Explicit source-bound object references and regions are independent collections. Both may coexist. Region-only context has zero selected object IDs. Targets describe request context, not additional edit permission. | Existing visual/source contracts; #254 durable binding |
| Target resolution | Resolve against the pinned snapshot/source. In the current view, expose missing, stale, or unavailable targets without silently replacing them. Retain original references for inspection and require explicit refreshed context or a new proposal before further work. | #254 resolution data; #253/#257 presentation |

Existing `ConversationVisual` binds accepted or proposal snapshots, view, level, selected native IDs, pins, arrows, and `SpatialMarkup`. A region is approximate user intent, not an exact engineering boundary. A point at a task origin does not imply a selected door, room, or nearby entity. Future target binding preserves both object and region context instead of a mutually exclusive union.

`ConversationVisual` currently has `2d` or `3d` and has no saved eye pose, immutable origin, or first-class linked selection field. Preserve existing payload compatibility until #254 adds reviewed, validated placement metadata. Do not send proposed fields to old strict parsers. Linked context currently uses the read-only linked reference path; a renderer cannot promote it into a native selection.

An origin remains a historical project-space point if its source changes. Its figure may require a stale-context indication. It does not follow the current position of a door or a newly adopted IFC occurrence. A missing target does not make a valid historical origin unplaced.

## Submission, source pins, and decisions

`ChangeRequests` remains the only queue and conversation transaction owner. `VersionedProjectStore` remains the accepted-head publication owner. #253 extracts callers without adding another queue, acceptance method, or mutable ticket store.

| Event | Required outcome |
| --- | --- |
| First submission | Reuse the existing request ID and server fingerprint. #254 includes placement in the authoritative transaction and replay identity. Two distinct submissions at one point produce two tickets. |
| Lost acknowledgement | Preserve the exact submitted body, ID, and captured origin while outcome is uncertain. Retry the identical envelope or reconcile the confirmed ticket. Reusing an ID with changed content must conflict. A refreshed project serialization is not the original envelope. |
| Follow-up replay | Reuse the same `messageId` and payload. Existing `appendMessage` checks replay before `expectedSequence`; it then rejects new stale-sequence messages. Refresh explicitly, retain unsent text, and never turn a replay into another ticket. |
| Stale accepted visual or source | New input must match its authoritative base and retained source pins. Missing native IDs, wrong frame/project, nonfinite coordinates, changed occurrence placement, or unavailable source bytes cannot silently resolve to current objects. #254 owns new placement checks. |
| Source retention | Preserve immutable `RequestSource` IDs, names, media types, byte counts, and SHA-256 values. Use existing retention/binding owners before a durable task references evidence. `EvidencePin` remains `entryId` plus hash. A UI cache or filename is not a source pin. |
| Proposal inspection | Match ticket, assistant message ID, request ID, proposal name/revision, and relevant source/design target. Keep the actual proposed delta visible and use existing `matchingProposalReview` and decision capability rules. |
| Acceptance | Only an explicit existing server decision can publish. Server compatibility, scope, evidence, geometry guards, and accepted-head compare-and-swap remain authoritative. Unrelated accepted work may remain compatible; a changed head alone does not justify inventing a blanket rejection rule. |
| Stale proposal or late result | Show the conflict and retain inspectable history. A local inspected receipt, avatar pick, or newly selected object cannot authorize acceptance. Superseded/cancelled work cannot replace a newer turn or accepted model. |

The server currently runs at most two attempts globally and one per ticket. Cancellation retains execution ownership until cleanup drains. The task layer uses reported state; it cannot infer provider cleanup completion or introduce a draining status without authoritative telemetry.

## Readonly task projection and view intent

#253 owns one readonly frontend projection derived from validated server state and local drafts. Its logical inputs are current project, ticket summaries/conversations, request activity, exact review binding, connectivity, per-task drafts, and later #254 placement. Its outputs supply the task list, figure descriptors, selected conversation, highlights, and review affordances. Derive runtime types from their owning definitions rather than copying a second wire schema here.

Confirmed tasks carry stable project/ticket identity, placement state, explicit targets and their resolution, current request/attempt/activity, and exact proposal inspection state. An unsent draft has its own local key and no confirmed ticket or worker state. Reconciliation replaces that draft figure with the confirmed task without moving its origin or duplicating it. A figure's hover offset is presentation only.

Use existing `RequestState` values: `queued`, `working`, `needs-input`, `ready`, `completed`, `rejected`, `cancelled`, and `failed`. The current `completed` label is **Accepted**. Offline is connection freshness alongside the last received state, not another server execution state. Animation cannot imply a worker is running between turns.

| Intent | Result and owner |
| --- | --- |
| Start task | #253 creates the local draft; #257 supplies captured place and explicit context. No submission or worker starts yet. |
| Open task | #253 selects the conversation and #257 highlights its bound targets. Keep the current camera. Opening the visible figure and opening its list entry have the same meaning. |
| Return to task | #257 requests explicit navigation through #255. Use the saved, validated creation view context when applicable. If no usable pose exists, expose a supported framing alternative. Unplaced tasks cannot invent a return point. |
| Change view | #255 owns discriminated Inside, Overview, Plan, and Section session intent plus saved Inside pose. Section remains an unsupported/gated mode until true source-derived rendering exists. #256/#257 own shell adapters. |
| Inspect or decide | #253 uses existing request and exact review routes. #257 presents them in context. Figures and camera state grant no decision capability. |

Camera pose belongs to the operator's tab session and project, separate from task placement and future presence. #255 defines the concrete pose with project-space eye position, facing/up orientation, view mode, level, and supported Inside motion mode. A task return pose is a captured creation context, never a live binding to that session. Preserve the applicable Inside pose through Plan and Overview; reject incompatible project/source context instead of applying an old pose blindly.

One navigation owner stops movement, releases pointer capture/lock, and cancels active gestures on Escape, blur, hidden document, pointer cancellation, task/view/project transitions, and disposal. Typing in the composer, editable controls, or modal dialogs must not move the camera. Mouse-look requires explicit activation and release/fallback behavior. Fly uses Shift up and Ctrl down. Walk entry, floors, eye height, collision, and stairs require #255 evidence; an overlay or bounding box cannot certify a walkable surface.

Responses are scoped to the active project/task generation. A late read cannot switch the active conversation, overwrite another draft, or refresh the wrong inspection. Future team release adds actor and policy-generation invalidation after server authorization under #259. No participant, audience selector, or privacy guarantee is implied by the first milestone.

## Task graphics and Plan adapters

#263 owns a disposable layer attached to the existing scene. It consumes readonly figure descriptors with stable task identity, validated project-space placement, reported state, selection, visibility, and injected tokens. It returns task hit identity, screen anchor/visibility information, and same-place candidate identities. These are conceptual inputs/outputs; #263 owns concrete exports. It does not fetch, store conversations, submit, decide, navigate, or create an engine/camera.

#257 owns production picking and lifecycle integration after #255 finishes the camera changes. Task body hits route to task intent, separately from native and linked construction selection. Active markup/navigation gestures suppress task activation. Decorations and labels do not become construction hits. Hidden/disposed figures are not pickable. Occlusion and viewport checks suppress unusable anchors; the accessible list remains available. Multiple tasks at the same point retain distinct IDs and expose an explicit chooser rather than selecting an arbitrary task.

Task graphics never enter native entities, IFC/export output, geometry queries, construction selection tables, model framing bounds, collision/floor tests, or proposal deltas. #257 audits generic scene picks and framing so overlay meshes cannot obstruct linked/native picking or enlarge model bounds. Removal, project change, and disposal release the layer's meshes, materials, textures, observers, and hit maps exactly once. The layer releases only resources it owns.

#262 owns native Plan drawing, project-to-screen projection, and inverse hit mapping for an explicit snapshot, level, comparison context, and tokens. Hit output retains source revision and entity identity. It does not own live room-app routing or task selection. #256 switches callers and deletes old drawing/projection writers. Unsupported linked Plan cuts remain explicit; footprint proxies cannot claim to be exact sections.

## Shared token inputs

#252 owns `demo/ui/design-tokens.ts`, its `spatialTokens` export, generated `--spatial-*` CSS properties, `DESIGN.md`, and presentation primitives. CSS aliases, SVG Plan, and Babylon materials derive values from that single source. Standalone #262/#263 modules receive readonly token subsets. #256/#257 import the authority and inject those subsets, so standalone branches do not need copied palettes or concurrent global style edits.

| Consumer | Semantic inputs from #252 |
| --- | --- |
| Shell and controls | `color.ink`, `color.primary`, `color.selection`, `color.muted`, `color.border`, `color.paper`, `color.canvas`; shared fonts, spacing, radii, focus and minimum target sizing. |
| Native Plan | `color.drawingPaper`, `color.drawingInk`, `color.drawingMuted`, `color.drawingOutline`, `color.wall`, `color.floor`, `color.furniture`, `color.furnitureOutline`, `color.existing`, `color.proposed`, `color.proposedFill`, and selection colors. Use `font.drawing` and `drafting` keys `detail`, `outline`, `existing`, `selected`, `cut`, `dimension`, `dimensionText`, `labelHalo`, `existingDash`, `regionDash`. Engineering distances remain metres; strokes/text use screen units. |
| Task graphics | `color.agentBody`, `color.agentFace`, `color.agentEyes`, `color.ink`, `color.focus`, `color.selection`. Status mapping uses `primary` for working, `warning` for needs-input, `error` for failed, `proposed` for ready, `success` for completed, and `muted` for rejected/cancelled; queued uses a neutral treatment. Animation is presentation mapped from reported status. |

These semantic keys are agreed with #252. That lane owns runtime definitions and exported token subset types. Consumers derive subsets from that authority rather than minting parallel token names. The status adapter retains `working` and `completed` exactly as the server reports them, with **Accepted** as the completed label.

## Exclusive file owners and handoffs

| Issue | Exclusive files during parallel construction | Adapter handoff |
| --- | --- | --- |
| #261 | This contract and `docs/evidence/spatial-contracts-261.md` | Shared reference only. |
| #252 | `DESIGN.md`, token definitions, primitives/gallery and styling | Tokens to #262/#263, then #256/#257. Coordinate shared presentation files with #253. |
| #253 | `demo/spatial-tasks.ts`, request extraction from `demo/room-app.ts`, transport/status adapters | One task owner; remove moved writers. Finish room-app extraction before later integration. |
| #254 | Conversation schema, `demo/change-requests.ts`, required server persistence contracts and tests | Validated placement and compatibility to #257. No frontend/controller/camera edits. |
| #255 | `demo/view-navigation.ts`, `demo/model-viewer.ts`, `demo/model-scene.ts`, camera/markup/FXAA/input consumers | Active-camera and view-session intent to #256/#257. No room-app edits. |
| #262 | `demo/model-plan.ts`, drawing/projection/hit tests | Standalone drawing to #256. No live routing or global token ownership. |
| #263 | `demo/spatial-task-layer.ts`, graphics/picking/disposal tests | Descriptors/hits to #257. No viewer lifecycle edits during #255. |
| #264 | `tests/fixtures/spatial-workspace` and dedicated acceptance helpers | Stable fixture identities and expected deltas to lane tests/#258. No runtime or validator changes. |
| #259 | Participant/access/publication design document and evidence | Future server authorization gate. Readonly projections and graphics expose only server-authorized tasks; locations, counts, titles, and status are disclosure surfaces. |
| #256, then #257 | Sequential live room-app integration; #257 later adapts viewer task picking | #256 consumes #252/#253/#255/#262; #257 consumes #254/#256/#263. |
| #258 | Combined qualification evidence/harness integration after #257/#264 | Actual deterministic journey first; connected-provider qualification remains a separate authorized gate. |

An owner notifies affected consumers before changing a shared assumption. Dependents use named committed baselines and revalidate after integration. Test hosts do not establish a second production owner. #261 does not introduce schema code or runtime adapters.

## Acceptance matrix

These cases are required implementation evidence, not claims that this documentation implements placement.

| Case | Inputs | Required observable result | Evidence owner |
| --- | --- | --- | --- |
| One door task | Native 900 mm hosted door, accepted snapshot pin, captured origin, explicit object target | Draft reconciles to one ticket; reopen/restart keeps origin. Real 1100 mm proposal leaves accepted width 900 mm until explicit acceptance. Assert centre, host relationship, and full expected delta. | #264 fixture; #254/#257/#258 |
| Same-place tasks | Two different initial request IDs, identical point and door target | Two independent tickets, drafts, statuses, and histories; chooser/list can open each. Opening neither moves the camera. | #254/#263/#257 |
| Region only | Pinned rectangle or circle, `selectedObjectIds: []` | Worker receives the region; no nearby entity is invented. Origin remains independent of region edits. | #254/#257/#258 |
| Legacy unplaced | Existing conversation without trustworthy placement | List/transcript remain accessible; no fabricated figure or return pose. Explicit recovery preserves provenance. | #254/#257 |
| Lost acknowledgement | Submit persisted, response lost, identical envelope replayed | One ticket, one origin, one initial message. Changed body under same ID conflicts without losing unsent content. | #254/#253/#258 |
| Stale proposal/pins | Conflicting accepted door edit, changed source occurrence, or different inspected message/request | Show stale/missing context; no silent retarget or acceptance. Unrelated accepted work remains subject to existing compatibility checks. Late results cannot replace newer work. | #254/#253/#257/#258 |

Construction-model delta for this contract change is zero. The [run evidence](../evidence/spatial-contracts-261.md) records source checks and validation. Runtime placement, browser navigation, real task graphics, and the complete AI journey require their owning implementation evidence.
