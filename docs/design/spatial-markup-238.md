# Spatial markup for request chats

Issue: [#238](https://github.com/Frederik91/bim-forge/issues/238). Base: merged main `8a7bb02`. This is user intent attached to a request, not authored BIM geometry or an acceptance capability.

## Interaction

Open **Markup** in the existing 3D viewer, choose Line, Rectangle, Circle or Polyline, and draw. The default floor plane uses the visible storey (or clearly labelled selected/default storey in a whole-building view). Surface mode captures the first actual visible surface hit and retains that plane for the gesture. A completed shape is attached to the current chat. The user can then type “Add a kitchen here.” There is no kitchen-specific action, layout template or intent parser.

Show a live orange preview and approximate metric dimensions. Return to selection/navigation after a completed drag, retain committed shapes while orbiting, and support Escape, cancellation, Undo and Clear without changing the model. Polyline finishes through Enter/Finish; its points are captured on one plane. Camera controls must recover after cancellation, pointer loss, second touches, hidden views and disposal. Touch controls wrap within the existing model surface.

The + menu and /markup command expose the same controls. No new wizard, model viewer, project store or accepted-state cache is introduced.

## Representation and ownership

Two designs were considered: a plane-local wire format with per-shape basis transforms, and direct project-space geometry. Use direct project-space geometry because the existing pin/arrow evidence and geometry tools already use metres with X east, Y north, Z elevation. A transient drawing plane belongs to the browser gesture implementation; callers and the agent do not need another coordinate language.

- `src/spatial-markup.ts`: authoritative TypeBox schemas, finite/nondegenerate geometry validation, plane construction, shape creation, bounds and readable summaries. Lines have two endpoints; rectangles have four ordered orthogonal corners; circles have a centre, unit normal and radius; polylines have bounded vertices. Every coordinate is project-space metres.
- `src/request-conversation.ts`: extend the existing annotation union while retaining historical pins/arrows and enforcing shape semantics at every wire/message boundary. Keep the 16-annotation ceiling; bound polyline vertices. No SQLite schema change is needed for existing JSON conversation storage.
- `demo/spatial-markup-view.ts`: the sole drawing/overlay implementation, reused inside the existing scene. It owns its toolbar, pointer capture, draft gesture and disposable non-pickable meshes; it requests frames from ModelViewer rather than owning a render loop.
- `demo/model-viewer.ts` and the minimal scene picking seam: attach drawing to the existing canvas/camera and resolve actual visible surface normals. Keep native/IFC picking and the independent renderer batching implementation intact.
- `demo/room-app.ts`, `demo/request-chat-evidence.ts`, `demo/request-composer.ts`, `demo/request-chat.ts`: connect completed markup to the existing snapshot-bound visual attachment, current chat draft, historical inspection and compact context chips. Regions do not implicitly select the previously highlighted door/desk. Sent shapes remain immutable and draft shapes do not leak across chats/projects.
- `src/model-proposal.ts`: include the exact visual context and derived bounds/summaries in worker input, with explicit approximate-intent guidance. Agent geometry reads remain authoritative for actual model dimensions, available space and clearances. Existing scope, freshness and human acceptance checks remain unchanged.

All files are owned by the issue238 integration attempt; no concurrent writer shares this worktree. New optional viewer actions simply make markup unavailable to read-only benchmark callers; they are not a compatibility adapter. A mark on a linked surface is a user-drawn world-space location, not a new source-owned IFC property or a certified measurement of that source.

## Evidence and qualification plan

1. Pure contract/plane tests: lines/rectangles/circles/polylines; translated and rotated planes; nonzero/negative storey elevations; finite bounds; degenerate/skew/noncoplanar rectangles; zero/invalid normals/radii; oversized/unknown fields; preserved pin/arrow messages.
2. Request/conversation tests: initial and continued worker input contains exact world coordinates and bounds; restart/history replay preserves shapes; invalid or stale contexts fail without changing native acceptance authority.
3. Actual browser interaction: one canvas, real drag/click coordinates, camera orbit and cancellation, CSS scaling/device pixel ratios, floor/surface planes, draft isolation and sent-history inspection. Inspect before/after model bytes rather than assuming overlay-only code cannot mutate them.
4. Full strict validation, explicit changed-path policy and applicable root tests in bounded isolated server containers. Source/dependencies are read-only; artifacts, cache and temporary files stay on `/ssd1`. Keep failed attempts and inspect causes; the documented interactive ten-attempt allowance is separate from the exhausted issue230 source series.
5. In a disposable preview project, draw a floor rectangle and send “Add a kitchen here” to the real connected provider. Inspect both received context and resulting proposal, without accepting changes into existing user projects or bypassing validators. Report measured results separately from synthetic, source-hosted and image qualification.
6. Publish qualified paired static/runtime artifacts to the server preview under standing owner authorization, preserving CURRENT model/source data and auth. Retired issue230 publishers must not be replayed. Any new installer must check paths with lstat/lexists before writes and preserve exact service identity/restart fencing and post-stop data authority.

Open a draft PR with source-bound evidence. Human approval remains required for merging the extended conversation/geometry-context contract.

## Qualification and published preview — 30 October 2026

Qualified executable: `f34414f35453801dc9008f6eb88fbe6e49fd931d`.
Preview: <https://192.168.1.17:9443/>. Runtime image: `sha256:9b3c1cd97fab96c1b3604c44a3cdffeba2dd7798e68b7b2b71d48db8ea0332ce`.
Receipts and failed attempts remain under `/ssd1/bim-forge-qualification/issue238/`.

| Evidence | Exact scope and outcome |
| --- | --- |
| Broad regression at `f49a10a` | `source-03/evidence/full-suite.log`: 977 passing checks, two existing optional skips, zero failures. This predates the later UI refresh, toolbar and tentative-floor fixes; it is not presented as a full-suite run of the final executable. |
| Final strict validation and build | `source-07/evidence/`: `npm run validate`, explicit 20-path policy check and browser build pass. |
| Final affected checks | Same source: 19 focused conversation/shape/queue checks and 63 viewer, batching, composer, actual ScriptBox and conversation checks pass. Source meshes provide actual surface normals in both rendering modes. |
| Final source-hosted browser workflow | `browser-03/`: one actual-app markup workflow plus 14 existing browser checks pass. At DPR 2, draw a rectangle on the 3 m attic floor, orbit, draw a circle and line, undo, cancel, finish a polyline, send, switch chats and restore the reference. Accepted project bytes remain identical. |
| Tentative-floor regression | The guided floor browser fixture holds the worker after it stages a new storey. The accepted-model location panel stays unavailable during this tentative view; accepted Main remains unchanged. Reconstruction, acceptance, baseline/alternative isolation, restart, phone PDF preparation and source removal still pass. |
| Actual runtime image | `image-03/`: the pinned production image accepts a region-only request over HTTP, preserves the accepted project, retains the shape after SQLite restart and executes the actual ScriptBox guest with markup context. No credentials or provider are used in this isolated check. |
| Publication | `publish-f34414f35453801dc9008f6eb88fbe6e49fd931d-01/evidence/`: paired static/runtime publication passed. A read-only, post-stop CURRENT fingerprint of every native/linked table and retained immutable IFC file equals the fingerprint after the new app starts. Original restart policies are restored; public assets match the qualified manifest, ChatGPT is connected and IFC remains configured. No database restore or credential copy occurred. |

The isolated browser workflow verifies application behavior, not public TLS/proxy routing or live-provider quality. Those were checked separately after publication through the real preview UI:

- Created **3D markup — kitchen preview QA238**, project `901c7869-16e9-476d-87e7-09dd9c77b324`.
- Drew one 3.49 m × 0.58 m floor rectangle and sent exactly **“Add a kitchen here.”**, without a selected native anchor or a kitchen-specific tool.
- ChatGPT generated a validated proposal on ticket `da970531-b0a5-4460-907e-88801cdc2fdd`: four new asset families and four occurrences for storage/worktop, sink, cooker and refrigerator; no existing entity or relationship changed.
- Its intent assessment explicitly used the marked dimensions, assumed a freestanding linear kitchenette, reported certainty 87/100 and retained the shell. These are model-generated assessment statements, not independently certified design quality.
- The accepted head remains `c050c7bdae…`. **No acceptance was made.** The ready proposal remains open in the test project for human review. The exact synthetic ticket, activity, visual context and accepted-project hash are retained in `live-kitchen-ui.json`.

### Failures retained and corrections

Source attempt 1 found a missing test-boundary type annotation; attempt 2 passed strict validation and all 19 focused checks but the broader qualification fixtures correctly refused an archive without Git history. Later runs use an exact Git bundle/checkout. Image attempt 1 incorrectly treated a local image ID as a registry image name; the corrected build verifies an explicit local base tag against the immutable image ID and uses the existing engine without networked build steps or dependency installation. Image attempt 3 used about 679 MB of the original cumulative 2 GiB root-disk allowance; it did not reset that allowance.

Browser attempt 2 passed the markup workflow but exposed an intermittent `Unknown level` error in the existing reconstruction flow. The legacy location panel mixed accepted geometry with a tentative replacement floor's storey. The fix makes that editor unavailable while a live draft is displayed, matching its existing mutation guard. The final test deliberately holds the live draft instead of relying on timing, and retains full page-error stacks. No validator or failure assertion was weakened.

### Limits and rollback

These are approximate planar outlines, not volumetric zones, surveyed measurements or editable BIM objects. A circle retains its exact centre, normal and radius; its rendered segments and axis-aligned bounds do not change its intended shape. Existing scopes, source freshness, constraints and human acceptance remain authoritative. Surface-normal plumbing covers native and linked meshes; this handback does not claim a separate live IFC-surface drawing test, actual-phone gesture test or VR support.

The existing JSON conversation format now admits additional annotation variants. Historical pins/arrows remain valid, but an older application may reject new shape-bearing messages. Keep the old paired static/runtime artifacts for recovery; a downgrade must retain all CURRENT data and account for those new messages. Do not restore an old database snapshot to make an old reader work.

## Relational qualification follow-up

The owner requested actual shape-to-agent placement trials in addition to drawing and persistence checks. The frozen [case matrix](../../experiments/markup-qualification-238/cases.json) covers rectangles, circles and explicitly closed concave polylines with inside/outside/edge instructions; finite lines with along/offset and undefined-inside instructions; bounding-square/concavity traps; attic and basement elevations; and a picked vertical wall rectangle with a floor-standing cabinet below it. All trials use newly created, named disposable projects. No live proposal is accepted.

The [independent oracle](../../experiments/markup-qualification-238/README.md) restores actual proposal deltas and measures whole footprints, requested centres, spacing and dimensions. It imports wire types, not production geometry math. Its fixed 2 mm tolerance accounts for the existing 1 mm placement grid. Provider claims and successful host placement validation cannot satisfy these independent predicates. The wall case checks the nearest plane gap, horizontal centring, width, floor elevation and top below the outline. It is not evidence for arbitrary wall-mounted authoring or sloping/volumetric constraints.

Initial live trials exposed execution failures as well as intent issues:

- Geometry workers could hit the four-worker cap while a completed freshness worker was still terminating. Admission now has a bounded FIFO of sixteen waiters, preserves the four-worker cap, includes waiting in existing deadlines, cancels queued work, and releases permits only on actual exit. One-shot results and failed factory startup await cleanup.
- Some provider turns finished after a successful observation without a terminal host result. At most two continuations can follow such a turn in the same thread, request authority, aggregate script budget and overall deadline. Failed tools/turns are not automatically continued. Late turn IDs cannot complete a newer turn; cancellation still revokes dispatch. Only a terminal host reply completes authoring.
- An agent used drawing bounds as a three-dimensional clearance query region. Guidance now distinguishes planar intent from the complete candidate-plus-clearance search volume. A later cabinet attempt encountered an unsupported final furnishing proxy. Guidance requires inspecting capabilities and authoring an honest closed primitive family for a new item when volumetric clearance is required; it never promotes existing or linked proxies to certified solids.
- A basement inspection reached a script resource limit. Guidance now asks for focused, paginated, compact observations rather than concatenated full model, API-document and geometry-page dumps. No execution or result limit was raised.
- The original phrase “a cube on either side” produced two cubes, with correct gaps and an explicit one-on-each-side assumption. The expected count remains one, so that receipt fails the count check. The same chat receives an explicit “exactly one cube in total” clarification; both original wording and clarification are retained in the matrix and conversation. A later result must not erase the original failure.

The open-line negative case explicitly states that a line has no inside and assumes its midpoint; arithmetic separately checks that midpoint. The oversized square/circle case declines without a proposal: a 2 m square needs radius at least 1.41421356 m, greater than the captured 0.68006579 m radius. Arithmetic proves infeasibility and preservation; explanation review separately establishes honest disclosure. Neither semantic case is silently counted as an ordinary geometric placement pass.

The count clarification exposed a separate existing conversation limitation: inherited measurements still require the geometry of a removed, unaccepted trial cube. Its successful preview therefore cannot seal. This is tracked in [#240](https://github.com/Frederik91/bim-forge/issues/240), with the required host-owned lineage, complete-base provenance and acceptance/restore checks. No evidence-retirement exception was added here. The failed count receipt and failed follow-up remain visible. A nineteenth, fresh request explicitly says “exactly one cube in total” to qualify that spatial instruction independently; it does not make the earlier conversation pass.

| Evidence | Qualified scope |
| --- | --- |
| `source-12`, `2d5901f` | Strict validation, 35 focused lifecycle checks, full regression: 996 pass, two existing optional skips, zero failures. |
| `source-14`, `bd533d3` | Final executable validation and explicit path policy, 73 focused checks including actual ScriptBox execution, independent-oracle adversarial fixtures, lifecycle checks, and browser build. |
| `browser-05` | Actual markup workflow plus 14 chat/workspace/guided-floor browser checks pass. |
| `image-05` | Exact runtime image passes API shape retention/restart, real ScriptBox, 35 lifecycle checks and actual four-held-workers/queued-validation admission. |
| Publication | Executable `bd533d32ff3aa326ab3e694b61feb7328dc8d6c4`, image `sha256:ef34053b222b2f70c126581790611b2352a5c40fd413ed0275e60f0a4304edab`, paired static/runtime live at the server preview. CURRENT fingerprints agree across cutover; auth stays connected. |
| Final live matrix | Pending final collection and independent grading. |

Receipts and full failed history remain under `/ssd1/bim-forge-qualification/issue238/`. Source attempt 11 stopped before a container because its upload had not finished; the completed bundle is hash-verified before subsequent cloning. The owner extended the source series to twenty total attempts; it is not a new series. Source/image/browser ledgers retain their earlier entries. Three paired publications retain fifteen bounded helper-container receipts; a publication attempt comprises its preflight, closed-state audit, install and preservation checks. Original cumulative Docker growth is about 732 MB of the existing 2 GiB allowance. No credentials, validators, source uncertainty or acceptance requirements were changed to obtain a passing result.
