# Task controller extraction #253

## Scoped plan

- Move request wire parsing, ticket summaries, polling, per-task draft storage, submission replay, continuation and decisions into `demo/spatial-tasks.ts`.
- Make `demo/room-app.ts` a caller of this owner while retaining its editor, recovery, visual/source/evidence rendering and exact proposal checks. No server, schema, camera, Plan drawing or style changes.
- Keep project plus ticket identity, reject stale project/task generations, and retain the identical uncertain submission envelope and source pins for retry.
- Verify submit/reopen/append/revise/cancel/retry/inspect/decide, attachment retention, independent drafts, offline controls and delayed replies with controller tests and existing browser journeys. Run `npm run validate`, applicable suites, build and diff checks.

Construction-model delta: zero. Existing server review and publication CAS remain authoritative.

## Run ledger

1. Baseline `82d6502`, isolated branch `codex/issue-253-task-controller`. Read issue #253, AGENTS, loop constraints, implementation plan and reviewed #261 contracts. State is unpaused. User authorization supplied by parent covers this implementation.

## Status: work in progress, not ready

The controller extraction is implemented but its new shipped-application draft journey fails. The parent requested preserving this exact WIP after escalation; further fixes and a fourth attempt need renewed scope. Do not integrate this as completed #253 acceptance evidence.

### Blocking observable failure and attempt ledger

`demo/spatial-tasks-browser.test.ts` uses the real server and deterministic clarification worker. It creates an unsent First task with `first.txt`, creates an independent Second draft with `second.txt`, restores First and submits it, restores Second with its own text/file, then reopens the confirmed First task. The expected composer is empty because First was sent. Instead it contains `First independent door task`, with status `Chat reopened with its unsent message and attachments. Drafts stay in this tab until sent.` No browser page error or application error is reported. The test's later append and delayed-poll assertions are not reached and are not qualified.

1. First run failed at an immediate empty-composer assertion after New chat, before the asynchronous transition completed. Added an observable composer-value wait to the test; no assertion was weakened.
2. Second run reached confirmed First task reopening and timed out waiting for an empty composer. Original First text was restored.
3. Third run added teardown diagnostics only and reproduced the same restoration failure: original First text, the unsent-draft restoration status above, no page errors, empty application error. Stopped and escalated. No fourth fix or test attempt was made.

The owning cause is not proven. Submission deletes its original draft key in the controller and the UI adapter; a stale switcher entry or a save under the confirmed key remains a hypothesis. Preserve the failing regression rather than claim that unit tests prove the shipped journey.

## Implemented boundary and integration surface

- `SpatialTasks<Draft>` owns current project/task/draft identity, ticket parsing and summaries, validated conversation projection, inspected proposal projection, offline freshness, per-task draft storage, polling coordination and every change-request endpoint caller.
- Exports: `SpatialTasks`, `BacklogItem`, `TaskSubmission`, `TaskGeneration`, `TaskProjection`, `StaleTaskResponse`, `TaskConflict`.
- Intents/read ports: `setProject`, `startTask`, `selectTask`, `openTask`, `readTask`, `readDraft`, `refresh`, `submit`, `append`, `decide`, `inspectProposal`, `observeWorkspace`, `generation`, `isCurrent`, `requireCurrent`, `key`, `projection`.
- Draft/presentation adapters: `saveDraft`, `getDraft`, `deleteDraft`, `parseTicket`, `updateTicket`, `receiveTask`, `setOffline`; lifecycle: `poll`, `startPolling`, `dispose`.
- `room-app.ts` retains editor/recovery, source picker, linked reference and evidence rendering, saved visual inspection, model presentation and existing exact review/capability checks. Its competing request transport, retry bodies/IDs, ticket parser/cache, draft map, active conversation identity and polling flags were removed.
- Uncertain submission and append retry reuse the original serialized body, identity, sequence and source references. A successful replay with later edited content reports `preserveDraft` so those edits remain unsent. Project/task generations reject delayed reads, inspection restores and decision acknowledgements, including switch-away-and-return cases.
- `TaskProjection` is the readonly presentation surface; parsed ticket and conversation data are frozen. A projection/inspection receipt grants no model publication authority. Existing server decisions and accepted-head CAS remain final.
- Placement persistence and task graphics remain #254/#257 work. This slice does not implement a new origin schema or navigation policy. Existing context/view restoration is retained pending the navigation integration lane.

## Passing validation and evidence

- `npm ci --ignore-scripts`: passed, 203 packages installed, 0 reported vulnerabilities.
- `npm run validate`: passed after the controller extraction, including strict TypeScript, type checking and repository policy.
- `npm run build:demo`: passed; production room-app bundle includes the extracted controller.
- Controller tests: **10/10 passed**, covering identical lost-acknowledgement envelope/source replay, append sequence replay/conflict draft retention, task ABA and project ABA rejection, independent drafts, delayed submission and decision replies, polling generation isolation, readonly/offline state, later-edit retention and exact task-message inspection.
- Existing shipped browser checks: **18/18 passed** in `canvas-studio-browser.test.ts`, `request-chat.test.ts`, and `workspace-shell.test.ts`. Includes source upload, actual proposal display with unchanged accepted head, explicit server acceptance, offline/stale controls, revise-to-focused-composer, one preserved viewer and desktop/phone panel behavior. These passed after the final runtime changes; the newly added draft test is separately failing above.
- Focused existing/controller unit run: **49/49 passed** before adding the final two controller cases. Broadened run after those cases: **64 passed / 1 baseline host failure** across conversation, evidence, status, context, composer, retained sources, controller, floor guide, tabs and draft lifecycle suites. Real cancellation, reply supersession, retry and draft cleanup assertions passed.
- Construction model delta for this refactor: **zero**. Browser fixtures exercise existing proposal/acceptance behavior; no production model/provider/deployment mutation occurred in this lane.

### Separate baseline Windows limitations

1. `floor-plan-guide-browser.test.ts` completed desktop PNG preparation, confirmed dimension/source binding, unsent reload recovery, real draft display, explicit Main acceptance, baseline/alternative-only delta and SQLite restart. The final phone PDF upload failed twice with HTTP 400 `{"error":"Source preparation tool is unavailable."}`. `demo/request-source-store.ts` `pdfCommand` invokes `/usr/bin/prlimit` and `/usr/bin/pdfinfo`, `/usr/bin/pdftotext`, `/usr/bin/pdftoppm`; these Linux paths are unavailable on this Windows host. No third retry or server change was made. This is separate from the new controller draft-restoration failure.
2. The broadened unit run's only failing case was `demo/request-draft.test.ts` `HTTP draft feed is read-only, same-origin, uncached and ends when the final proposal is ready`. It failed at `server.listen(temp/server.sock)` with Windows `EACCES`, before HTTP/app behavior. No test or server change was made for this host limitation.

Retained synthetic floor evidence on this host: `C:/Users/Frederik Tegnander/.codex/visualizations/2026/10/31/controller-253/` contains `browser-trace.zip`, `last-ui-state.png`, `desktop-confirmed.png`, `desktop-alternative.png`, `floor-plan-measurement.txt`, `accepted-project.json`, and `model-delta.json`. The trace contains the exact failed PDF response; no customer sources or credentials were used.

## Review risks and decision

The refactor spans the application's task entry points. Its current shipped draft-restoration regression blocks readiness, despite passing isolated controller and existing review checks. Draft and attachment independence must pass through the shipped app before integration. The broader PDF/socket cases require a supported host or separate reviewed portability work; do not weaken them in this issue. Human review controls readiness and merging. Parent authorization on 2026-10-31 requested a WIP commit/draft only after the stop threshold; further controller repair is pending scoped renewal.
