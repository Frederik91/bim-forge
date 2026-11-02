# Spatial agent progress, result attention and completion (#304)

## Scope and ownership

Base: combined preview `06a2982`. This is presentation and per-browser viewing
state; no BIM entity, geometry validator, server queue state, SQL schema or
acceptance rule changes. Existing saved tickets and conversations remain intact.
Root-supplied room-app/presentation integration `cd2b59b` is included in the
standalone feature branch as `8a4b2c3`; the combined branch must not apply it twice.

`TaskResultAttentionStore` owns local viewing state, keyed by project + ticket.
The outcome version is the authoritative request ID + worker attempt. Backend
assistant messages are immutable for a request turn; updatedAt also changes on
human decisions and therefore is deliberately not a result identity. New turns
and retry attempts become unread again. Completed/cancelled/working/queued are
not newly delivered results. Storage denial preserves the in-session behavior.
These flags are browser-local, not account-level collaboration permissions.

`SpatialTasks.resultAttention(ticket)` supplies `none`, `unread` or `viewed`.
`markResultViewed(ticketId)` guards the selected task, current user request,
connected state and an actual current assistant message after any retry marker;
a failed outcome may instead expose its real error status. It never sends an API
request. Root calls it only after the actual corresponding result is visible,
using message identity and intersection/clipping checks rather than task selection.

`SpatialTaskLayer` retains the original body and fixed origin. A working task has
alternating hand movement and an orbiting bead. Reduced-motion, hidden document,
occluded and offscreen paths keep the state legible while stopping movement.
Unread has a solid dot beside the head; viewed has a check. The shared textual
status label distinguishes these states in model labels and the task list, so
neither motion nor color is the only cue. The badge sits beside the head because
the existing DOM label obscured the initial above-head position in real captures.
Maximum horizontal extent remains below 0.19 m.

Only server `completed` hides a figure from active rendering, picking, anchors
and active task entries. The application also excludes completed descriptors.
History/Chats still contains the accepted conversation and all earlier results.
Repeated accepted projections cannot bring the figure back. A later explicitly
submitted turn may become active work again.

## Qualification record

- Linux strict validation/typecheck/policy and frontend build pass at `1aaf6d3`;
  397 source files checked.
- All 36 focused attention/controller/layer tests pass, including viewing reload,
  later turns/retries, project separation, denied storage, current-message guards,
  reduced/offscreen motion, completed hiding, real body picks, occlusion, resource
  disposal and exclusion from construction serialization.
- Real Babylon renderer browser fixture passes in 15.0 s: working motion changes
  across actual frames, reduced motion stays static, unread/viewed labels differ,
  same-place picks remain usable, accepted task leaves active entries/anchors,
  and 390/320 layouts retain interaction. This fixture is explicitly isolated.
- The shipped two-turn lifecycle at `1aaf6d3` passes its functional assertions in
  46.1 s: selected working task is not marked viewed; a hidden result remains
  unread; exposing the exact result marks viewed; reload preserves viewing; a
  later hidden result is unread again; explicit pointer-exposed acceptance gives
  the exact expected door delta and removes the active figure/task; Chats retains
  both assistant results. Its final diagnostic reported a stale-workspace action
  error when history navigation began before the acceptance action fully settled.
  Follow-up source waits for foreground completion and asserts a clear error
  surface at result exposure, acceptance and history navigation.

## Final clean qualification

At `862e4f432821cf46fcce1a0e1d51561dc4977342`, strict validation/typecheck/policy
pass with 397 source files checked. The application source is identical to the
already-built and 36/36 unit-qualified `64d7df3`; the final commit adds only an
assertion that viewing/reload never submits a task mutation.

- Renderer browser: **1/1 pass, 15.13 s**. Retained working, unread, viewed,
  desktop and 390/320 captures. The final unread dot and viewed check are visibly
  distinct beside the head and clear of the model label; both captures were
  manually inspected.
- Shipped application lifecycle: **1/1 pass, 48.36 s**. All first/later result,
  acceptance and saved-history error surfaces are explicitly empty. Final page
  errors are `[]`; final action error is empty. Waiting for foreground acceptance
  completion before history navigation resolves the earlier test sequencing race.
- Exactly three task writes occur: the user's submit, subsequent reply and
  explicit accept. Result viewing and reload perform no task mutations.
- The exact accepted fixture snapshot matches the expected 1100 mm door result;
  the only changed entity is `door-ground-connecting`. Main stays unchanged before
  the explicit acceptance; the figure and active task disappear afterward while
  both saved assistant results remain readable through Chats.

Artifacts: `/var/lib/bim-forge/previews/ops/agent-states-304-renderer-final` and
`/var/lib/bim-forge/previews/ops/agent-states-304-shipped-final`; run output is
retained in the operator's `BIMForge/agent-states-304-evidence` folder. All
application/fixture servers run on Linux; Windows only edits, transfers source
and views retained evidence. No live preview project, conversation or service was
changed by this feature agent.
