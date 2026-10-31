# Durable spatial task placement, #254

## Plan and schema review before implementation

Own `src/task-placement.ts`, conversation/proposal parsers, `demo/change-requests.ts`, the existing server request routes, and dedicated placement tests. No viewer/controller/camera changes or construction entities. Validate canonical engineering metres, authoritative project/design/base, native object existence, and exact current IFC source/occurrence/placement pins. Acceptance evidence covers same-place tickets, mixed/region-only targets, restart, replay, invalid/stale sources, legacy tasks, and explicit recovery.

Placement has its own version 1. `taskPlacement` is an additive optional request field and an explicit placed/unplaced read projection. Its origin is historical, separate from independent object/region collections. Sources reuse `GeometryRef`; region and origin snapshots include project/design/revision. Creation view uses existing 2d/3d and level context; no new camera-pose schema is introduced. Recovery appends a recorded association with its own command identity and never rewrites the original placement. Target resolution is advisory, inspectable data, not permission or proposal acceptance.

Storage remains normalized queue version 1: optional placement and recovery metadata live in the existing `requests.body` JSON. Existing conversations remain schema version 1 with optional placement metadata. No SQL table rewrite, generated production migration, source deletion, or model mutation is needed. Missing metadata is projected as explicitly legacy-unplaced; new submissions without metadata are explicitly not-provided-unplaced. Startup reads validate new metadata without requiring historical objects to remain current.

Rollback: back up the complete SQLite database and WAL consistently before a real upgrade. Old strict binaries reject new JSON fields; restore the matching pre-upgrade backup when rolling back software, or use a new disposable database for local qualification. Do not strip placement metadata or recompute old replay fingerprints. New code preserves old request fingerprints by omitting absent request fields. Human schema/rollback review is required before merge.

## Verification

`npm ci --ignore-scripts`, `npm run validate`, and `npm run build:demo` passed. The focused placement, conversation parser, design request, and geometry source run passed 20 tests with no failures or skips. `npm run test:task-placement` is included in `npm test`.

The seven placement tests exercise real SQLite transactions, restart, replay, transcript projection, actual bounded ScriptBox workers, source catalog guards, and the existing HTTP server. The IFC catalog uses the existing synthetic prepared-geometry fixture, without a converter or provider call. These cases establish the storage contract, not live IFC conversion or frontend navigation.

| Before | After and evidence |
| --- | --- |
| A ticket has no fixed placement. | Two IDs at one door retain separate histories and the same fixed point through reload and a follow-up. Changed replay text or origin conflicts. |
| Native selections and markup lack a durable task binding. | Native and IFC references coexist with a source-bound circle. Region-only worker input has zero selected IDs and the exact region. |
| A later revision could recapture UI context. | A changed placement on revision conflicts, while a new explicit visual context remains valid. Retry keeps the origin and numeric attempts 1 then 2. |
| No placement source admission exists. | Nonfinite coordinates, wrong frame/project/base, missing native IDs, invalid levels, stale IFC revisions and moved occurrences reject. A catalog change before commit saves no second ticket. |
| Missing targets have no spatial recovery record. | Exact refs remain inspectable with current, stale, missing, or unavailable resolution. Explicit recovery is append-only, sequence-checked, replay-safe, and durable. Historical origin remains unchanged. |
| Old tasks have no placement data. | Missing metadata reads as legacy-unplaced. No coordinate or nearby target is fabricated. |

The broader baseline queue suites hit the known Windows `EPERM` teardown issue tracked by #265 in `demo/change-requests.test.ts` and `demo/request-conversation-queue.test.ts`. Four representative cases, including legacy migration, completed their assertions and failed in the old delete-before-close hook. Those files belong to the parent lane and are unchanged here. The combined run also stalled in the existing `demo/server.test.ts`; that specific test process was stopped. The dedicated new HTTP test passes with bounded requests and a single orderly teardown.

An expanded source-request run passed 21 of 22 tests. Its PNG/PDF/text preparation case failed with `Source preparation tool is unavailable` on Windows. Existing source preparation launches Linux-path tools; this task does not change that subsystem. The source route, origin checks, immutable identity, and project membership case passed. No validator was weakened.

Linux CI then exposed a feature packaging omission in `demo/preview-build.test.ts`: `Image omits server dependency demo/task-placement.ts`. Both reported CI runs reached 857 tests with 854 passing, one failing, and two optional skips. The new runtime module was imported by `ChangeRequests` but absent from the preview image's explicit source copy and build-context allowlist. Added that module to `deploy/preview/Dockerfile` and `.dockerignore`. Existing `src` rules already include `src/task-placement.ts`. This repair changes source packaging only. Ports, security, environment, cloud settings, and validators are unchanged. The focused packaging test passed both cases on the first repair attempt; validation and the production build also passed.

Accepted construction-model delta: zero. Task metadata creates no native/IFC entities, geometry, or accepted revision. Actual proposal inspection and explicit server acceptance retain their existing authority.

## Integration handoff

- `src/task-placement.ts` owns runtime schemas, inferred types, and parsers. Existing submission accepts optional `request.taskPlacement`. `TicketSummary`, full ticket, and `RequestConversation` expose `taskPlacement` and `placementRecoveries`. Initial refs remain historical across new messages. A normal explicit `ConversationVisual` remains per-message context.
- `GET /api/change-requests/:id/placement` returns original placement, append-only recoveries, effective association, `originalResolution`, and effective `resolution`. Source pin status is advisory and does not expand edit scope or reject unrelated proposals. Consumers must show stale/missing targets and request explicit recovery or fresh request context. No silent source correspondence is applied.
- `POST` on that route accepts exactly `{ recoveryId, expectedSequence, placement }`. A known ID replays only identical input, even after sequence advances. A new command checks transcript sequence, current project/design/base, source catalog, and task state before its atomic append. Recovery does not mutate the initial origin or retarget an already-running request. At most eight records are accepted.
- Creation context records existing `2d`/`3d` view and optional level, without inventing #255's pose type. #257 must offer an explicit point-framing fallback until a validated pose contract is integrated. No saved camera direction or walkable surface is claimed.
- Linked versions and placement history use existing retained-source storage, which refuses retention overflow rather than deleting historical dependencies. Request attachment bindings remain inside the original authoritative transaction. There is no second queue or acceptance endpoint.
- Future #257 owns browser capture, figure placement, highlighted context, stale recovery presentation, and list discovery. This branch contains no frontend/controller/camera changes. Use a disposable database for local integration, and review rollback before any real storage upgrade.

## Run ledger

| Attempt | Action | Result |
| --- | --- | --- |
| 1 | Review issue #254, repository instructions, policy, contracts, and schema/rollback design | Complete before code. State is not paused and #254 has no pause label. Parent authorized this isolated implementation attempt. |
| 1 | Dependency install and initial validation | Dependencies passed. Type checking identified the wider baseline/native reference target union; corrected admission to compare its actual design/base. |
| 1 | Placement implementation and focused tests | Seven placement cases passed. Existing conversation/design/source-boundary tests also passed. |
| 1 | Broader baseline qualification | Existing Windows cleanup and source-tool limits recorded above. No fixes to parent-owned suites or source preparation. |
| 1 | Production bundle, final validation, changed-path policy, and diff review | Passed; final command output recorded in the draft change review. |
| Packaging repair 1 | Add the new runtime module to both preview source lists; run `node --test demo/preview-build.test.ts` before broader checks | Passed, two tests with no skips. `npm run validate` and `npm run build:demo` also passed. Parent reported the precise Linux CI failure; no test assertion changed. |
