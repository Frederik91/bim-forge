# Change request backlog

## Plan and grounding

The existing `demo/server.ts` returns temporary proposal job IDs, retains eight
in-memory results for fifteen minutes, and loses them on restart. The browser
waits in a modal and publishes a proposal into its local repository. The deployed
workstation route binds a wall and an inferred group before the user describes
the operation. Those constraints came from the narrow #92 acceptance example,
not a general model-authoring requirement.

Keep immutable revisions, stable object IDs, `previewRectangle`,
`previewFurnishings`, and human review. Replace temporary jobs and workstation
discovery. Do not change the coding factory, authentication, or renderer stack.

## Usage and shape

1. A person submits text, selected object IDs and optional spatial reference.
2. The server durably records the ticket before acknowledging it. The browser
   returns to the model immediately and may submit more tickets.
3. Bounded workers claim queued tickets. Each sees an immutable base, never a
   mutable current model. Results remain separate proposals.
4. A project backlog lists queued, working, needs-input, ready, completed,
   rejected, cancelled and failed tickets. Review opens a proposal without
   replacing the current accepted project.
5. Acceptance checks the current server head against the proposal base and
   atomically records both the new project and ticket decision. A stale proposal
   must be revised against the current model; it cannot rewind accepted work.

`demo/change-requests.ts` owns durable projects, tickets, idempotency, scheduling,
recovery and decisions. `demo/server.ts` owns HTTP origin/size checks and routes.
`src/visual-request.ts` owns validated generic spatial references.
`src/model-proposal.ts` interprets text through bounded model tools.
`demo/room-app.ts`, HTML and CSS own nonblocking submission, markers, backlog,
and review. Model entities and deterministic geometry validators stay in
`src/room-model.ts`.

## Design comparison

Compared two shapes directly; parallel model-runner tools were unavailable.

- Extending browser polling jobs exposes lifetime, retry, refresh, and model
  reconciliation to every caller; it cannot process work after a server restart.
- A durable server queue hides claiming, crash recovery and atomic decisions
  behind submit/list/detail/decision operations. This is the selected design.

Accept a single preview-server queue owner and bounded SQLite storage rather
than introducing a separate distributed job service. Reject stale proposals
instead of silently rebasing geometry. A later multi-instance deployment needs
cross-process worker leases; do not run two owners against this database.

## Acceptance evidence to collect

- Server-container `npm run validate` and `npm test`.
- Deterministic tests: idempotent submission; multiple queued requests; bounded
  claims; isolation; restart recovery; failure/retry; atomic decision replay;
  stale-base rejection; malformed reference rejection; support/collision checks;
  model deltas for relocation and creating a desk without copying devices.
- UI on the server: submit two tickets without waiting, keep navigating, reload
  during processing, review independently, reject/revise/accept, and verify that
  only acceptance changes main. Exercise floor and wall references in Plan/3D.
- Check a phone-width backlog/review. Do not claim real touch qualification from
  mouse or viewport checks.
- Deploy exact tested commit, inspect image/static hashes and health, and repeat
  the nonblocking request/review workflow on the public preview.

## Progress

- Ground: complete.
- Sketch and comparison: complete.
- Agree: user authorized implementation; no additional checkpoint.
- Implement: complete. Final image and deployed acceptance remain to be checked.
- Scrap/revisit: replace the shape if callers need parallel state ownership or
  workstation compatibility branches.

## Candidate results

The server container passed `npm run validate` and `npm test`: 281 tests,
279 passed, two existing skips, no failures. The focused tests cover concurrent
submission, decision, and revision delivery, including a decision made from an
older ticket attempt.

The browser submitted two real GPT-6.1-Sol requests without a blocking modal.
Both continued through a reload. The freestanding relocation changed four
objects and no relationships. Main stayed at `f07d4e6478` until acceptance,
then advanced to `49b36b59a7`. The desk-only creation added one object with no
modifications or removals. Its old-base acceptance was rejected. A revision
within the same ticket preserved the selected desk and floor marker, added only
the requested desk against the new base, and advanced main to `7ead89407b`.

A third, desk-only move deliberately left supported devices without a specified
destination. After a container kill during Working, the recovered second attempt
asked where the monitor and laptop should go instead of moving them silently.
Rejecting that ticket left the accepted model unchanged. The earlier desk-only
proposal remained visible in the revised ticket's history.

Mouse drags captured floor references in both Plan and 3D. The 390-pixel viewport
had `scrollWidth === clientWidth === 375` including the browser scrollbar.
Backlog navigation and proposal acceptance worked at that width. This is not
real-device touch qualification.

## Preview boundaries

One server process owns the SQLite queue. Two workers run at a time, with at most
64 pending requests. Tickets do not expire. A ticket allows eight revisions and
three processing attempts per revision. Model snapshots retain the existing
256 KiB and 32-revision demo limits. Server startup recovers interrupted work;
completed results and decisions survive restart.

The SQLite file is `bim-change-requests.sqlite` inside the existing protected
server state mount. The current private preview still trusts installation
access. Project IDs separate backlogs, not user permissions. This change does
not introduce role authorization or discipline-specific approval delegation.
Keep the existing network gate and do not expose this preview publicly.

Accepted model changes invalidate outstanding proposals conservatively. The
preview asks for a revision instead of merging unrelated proposals automatically
or inferring ticket dependencies. The immutable base and prior attempt remain
available for review. Old `preview_workstation_move` evidence remains readable
in exported historical models, but the live tool and gesture route are removed.
