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
