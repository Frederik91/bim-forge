# Combined spatial assistant preview (#300)

## Integration scope

This supervised testing preview combines #292–#295 on the already-running
`codex/preview-left-drag-290` baseline (`ad08d17e8838c632141ed95f5fc1bf62df52f19d`).
The independent implementation reviews remain drafts: #296 (deletion), #297
(Assistant sizing/settings), #298 (doorless openings), and #299 (personal
assistant/task dispatch). This integration does not merge protected `main`.

The integration seams are `demo/room-app.ts`,
`demo/spatial-workspace-presentation.ts`, `demo/canvas-studio.css`,
`demo/native-walk.ts`, and their shipped-UI qualification tests. A permanently
available personal composer dispatches independent saved task agents. Only
submitted tasks become model-space figures. Saved private drafts remain in Chats.
Deleting the current task agent returns to accepted geometry while preserving the
physical viewpoint and saved conversation/review history. The native Walk adapter
treats a real hosted `Opening` as traversable without inventing a door leaf.

## Model and authority contracts

- Door conversion preserves stable identity, host, centre and height, changes
  `Door` to `Opening`, and provides a full 2 m clear opening. Exact before/after
  and delta evidence is in `doorless-opening-294-delta.json`.
- Existing geometry, scope, passage-clearance, hosting and review validators stay
  enabled. Main changes only after explicit acceptance.
- Task placement is frozen at dispatch: selected markup bounds, selected object
  location (offset outside wall faces), or the actual current viewpoint.
- The agent-deletion journal marker retains chat/proposal/review records and
  fences late worker results; it does not delete construction geometry.
- An accepted `Opening` and a saved `agentDeleted: true` marker require compatible
  readers. Older strict binaries reject those new values. No SQL table migration
  is introduced. Preserve an offline data backup before changing the preview.

## Linux qualification

All application and disposable fixture servers run on the Linux VM. Windows is
used for editing, SSH transport, and browser clients only. Fixtures use temporary
projects; qualification never submits instructions to the user's live project.

At combined source `8db223a` (application source unchanged at `eb53186`), the full
`npm test` run completed its preceding groups and reported 892 passing tests,
two failures and two conditional skips in its main group. Both failures were
environment preconditions in `factory/schedule-job.test.ts`: login umask 0002
created group-writable fixture files, correctly rejected by the immutable-tree
validator. With test-runner umask 077, the complete schedule-job file passed
24/24; the remaining asset suite passed 21/21. The original full command exited
nonzero; these are documented targeted resolutions, not a claim that it exited
successfully. No validator or assertion was weakened. The additional native
Walk/dispatch unit group passed 18/18, including real 2 m opening traversal in
both directions, jamb/headroom obstruction and accepted-source immutability.

The initial combined 22-file browser qualification reported 76 passes, five
failures and one cancellation. It exercised the shipped single viewer, including
navigation, left-drag look, native Walk, actual wall/rectangle markup, plan/task
continuity, dispatch, deletion, and agent rendering. Failures prompted a real
short-viewport card scrolling correction, explicit task-opening adaptations for
the new personal assistant flow, and fixture restart quiescence. The design
gallery build was also added to the manual Linux runner, matching the existing
qualification image's build steps.

The subsequent eight-file repair run at `cbf2663` passed Assistant sizing/settings,
the design system, guided floor reconstruction, agent deletion, stable shell, and
concurrent spatial dispatch. It exposed three final qualification adaptations:
the native Walk floor title, a transient inspection control after automatic
proposal opening, and collapsing the phone conversation before using Tasks.
These retain exact model/delta, explicit acceptance, offline authority, restart,
actual pointer-hit and unchanged-viewpoint assertions.

Final focused reruns at `144ee45741c1739423c249b054ae42502cebf6ac` passed:

| Shipped Linux workflow | Result |
| --- | --- |
| 2 m opening proposal → pointer-exposed acceptance → exact delta → server restart | 1/1; 40.7 s; no browser errors |
| Delete assigned task agents; retain personal assistant, private draft/file, history and physical pose | 1/1; 36.5 s |
| Pick real native agent body; exact 1100 mm review; 390/320 phone switching; acceptance/reload/task return | 1/1; 69.4 s |
| Actual batched scene occlusion, construction picking, framing and serialization exclusions | 1/1 |

At `3fe356b`, the final Canvas Studio file passed 3/3 in 35.4 s: actual offline
retained-control fencing, Sources & checks → Revise with focused retained draft,
pointer-exposed explicit acceptance, exact door-only delta, phone layout and
single-viewer identity. This last source change only adapts the test flow; the
application source remains the already-qualified combined source.

## Preview release procedure

Create an immutable, clean checkout of the final integration commit on Linux;
install locked dependencies, run `npm run validate`, and build the frontend there.
Before switching `bim-forge-walk-preview.service`, verify its existing owned
WorkingDirectory, stop it and archive the existing `walk-284` data directory.
Keep that same data directory, service owner, port and account connection. Change
only the release WorkingDirectory and restart the service. Verify its ready
receipt against the exact source/build identity.

The post-switch browser check must use only the Linux preview URL through the SSH
client. It blocks API writes, checks actual personal Assistant resize controls,
collapsed/explained advanced settings and their unchanged permission default,
left-drag head movement with unchanged eye, reachable 320 × 600 composer controls,
one canvas, no browser errors, and byte-equivalent project responses. Retain the
ready receipt, backup hash, built-file hash, screenshots and browser result outside
the repository. These deployment checks are separate from the disposable-project
authoring tests above and make no live model-provider accuracy claim.
