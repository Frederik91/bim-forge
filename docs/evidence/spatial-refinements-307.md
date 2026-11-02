# Minimal spatial conversations and task lifecycle (#307)

This supervised preview combines five isolated changes on the previously running
`06a2982e10f7a408d7629f9117bd4c1d3e587128` baseline. Each feature remains a draft:

| Issue | Review | Result |
| --- | --- | --- |
| #302 | #308 | Move the personal/task card by its title bar, touch or keyboard; retain manual position and reachable bounds. |
| #303 | #310 | Compact icon header and composer; secondary controls in options; reconstruction offered through “+”, with explicit permission. |
| #304 | #311 | Working animation, unread/viewed result badges, and accepted agents removed from active space while Chats retains history. |
| #305 | #312 | Place newly dispatched figures beside selected geometry using its actual bounds and the viewing side. |
| #306 | #309 | Q descends in Fly, Shift ascends; browser command chords are not movement keys. |

## Integration contracts

The single existing viewer, saved task identity, object/markup references and
human acceptance remain authoritative. This change does not edit construction
entities, relationships, model validators, backend schemas or permissions.
Per-browser result viewing is stored separately from server execution/review state.
It keys each outcome by project, ticket, current request and attempt. Reload retains
viewing state; a later reply or retry creates an unread outcome. Opening a working
task cannot mark a nonexistent result viewed. Failed outcomes become viewed only
when their current failed status is exposed.

The rendered current result must actually be visible: message identity is checked,
the card and document must be visible, native popovers/dialogs defer the mark, and
viewport intersections are checked against actual pointer hit targets to exclude
covering overlays. Viewing never sends a task mutation. Accepted/completed tasks
leave both model figures and the active spatial task list; the saved conversation
and both results remain available through Chats. This is completion, not deletion.

Manual movement preserves desired desktop dimensions when a narrow screen clamps
the displayed card. Automatic defaults start at 360 px for personal conversations
and 520 px for task conversations, subject to actual measured content minimums.
The minimum retains the real composer and a readable transcript. Short viewports
scroll with a protected heading and resize grip. Options use the native top layer,
so their height does not inflate card sizing. Icon controls retain accessible
names, 44 px targets and visible focus; Escape dismisses a menu before the card.

Selected hosted objects use jamb and wall-face clearance; ordinary authored assets
use rotated footprints. Overview supplies a camera viewpoint to choose the visible
side, separately from the actual-eye fallback. Saved origins stay immutable and
existing task positions are not rewritten. Markup and no-reference fallback rules
are retained. The rendered body's dimensions are included in the clearance proof.

## Qualification provenance

All application and disposable fixture servers run on Linux. Windows performs
editing, SSH transport and browser-client checks only. Fixtures never submit
instructions or accept changes in the user's live project.

The isolated feature checks passed before combination: move/resize/keyboard/touch
and narrow sizing; minimal chat and explicit reconstruction permissions; full
Main/As-is/Alternative reconstruction and restart; working/unread/viewed renderer
states and a two-turn accepted/history workflow; actual Overview door/wall body
picks; held-upload/markup/eye fallback dispatch; Q+W descent and input isolation.
Detailed source identities and evidence are in the individual evidence files and
draft PRs above.

At combined source `6df0b87`, strict validation checked 400 source files; typecheck,
policy and demo build passed. The focused unit group passed 72/72. A sequential
15-file shipped browser run passed eleven files and exposed four failures. The
passing workflows covered minimal chat, Overview placement, real agent selection
and deletion/history, concurrent dispatch, independent drafts/attachments, Plan,
Canvas offline/Revise/acceptance, guided reconstruction, 2 m opening acceptance
and restart, navigation, and shell stability.

The failures were retained and addressed directly:

- A card check tried to activate an inspection control already replaced by the
  automatically opened review; it now waits for the stable review surface.
- A background result could reopen a deliberately closed card and replace the
  displayed proposal, accidentally marking the result viewed. Automatic preview
  now defers while closed, including after asynchronous reads/restoration. Stronger
  tests compare the full displayed-source token and physical pose on both turns.
- A fresh-task markup check read old references before the foreground transition
  completed. It now waits for the enabled personal composer and zero reference
  count, retaining all original saved-region/source checks.
- An isolated renderer check inspected DOM anchors before the next render frame;
  its exact removal assertion now waits for the frame, as in the qualified feature.

At `1d65604`, card interaction passed in 41.1 s (344 px measured task minimum,
97 px transcript, directly reachable input/Send, and 320 × 600 scrolling), real
markup replay passed in 73.0 s, and the renderer passed in 14.1 s. The stronger
unread test passed its first closed/result/source checks but exposed an additional
saved-task reopen race after reload. Its final repair and evidence follow below.

The remaining race was traced with a browser debugger to `showChatTicket`
reapplying an already-received response after a newer poll had been confirmed by
the task controller. The controller correctly rejected that stale application.
The renderer now consumes the controller's authoritative ticket/conversation
projection instead of feeding the old payload back into it. Offline state is
mirrored from that projection. Current activity is shown only when request,
attempt and update version still match; other turns retain their history.
The controller's stale-response fences remain unchanged.

At `1880963d7fec0ef9aeadef130e9ca6c738e017f7`, strict validation/build and all
26 controller tests passed. The full shipped two-turn lifecycle passed in 44.42 s
with a deterministic interleaving: hold the placement read during task reopen,
allow a real newer conversation poll to finish, then resume the foreground open.
This retains the closed-card unread checks and exact displayed snapshot/physical
pose on both hidden outcomes, persisted viewing after reload, renewed unread
state for the second result, actual pointer-exposed acceptance, exact door-only
delta, absence from active figures/list, and both saved results in Chats.
Browser errors and the action-error banner are empty. Exactly the three intended
human operations—submit, reply and accept—write to task APIs; viewing/reload do not.

The Canvas review file also passed 3/3 at the same `1880963d` source in 36.67 s,
including retained offline-control fencing, Sources & checks → Revise with focused
retained draft, explicit acceptance and exact door-only delta, phone layout and
single-canvas identity. There are no remaining unresolved qualification failures.

The final integration has the identical application/test source as `1880963d`;
subsequent integration documentation is qualified separately by the final Linux
release validation/build. Historical evidence files retain their original source
and older key bindings; the current navigation plan/contracts and all shipped
captions use Q for descent.

## Release boundary

After final qualification, prepare a clean immutable Linux release from the exact
final commit, validate/build it, stop the owned preview service and archive its
existing `walk-284` data directory before switching only WorkingDirectory. Keep
the same service owner, data, port and account connection. Verify the ready
receipt's source/build identity and retain the backup checksum.

The live browser check blocks API writes and verifies compact personal mode,
actual header dragging/resizing, menu/settings defaults, Q+W descent/Shift ascent,
the Q caption, accepted agents absent from active space, narrow control hits,
desktop size retention, one canvas, zero errors and unchanged project responses.
The live receipt and screenshots are retained outside the repository. No protected
main merge or automatic issue closure is part of this preview update.
