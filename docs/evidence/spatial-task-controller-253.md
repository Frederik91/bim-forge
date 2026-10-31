# Task controller extraction #253

## Scoped plan

- Move request wire parsing, ticket summaries, polling, per-task draft storage, submission replay, continuation and decisions into `demo/spatial-tasks.ts`.
- Make `demo/room-app.ts` a caller of this owner while retaining its editor, recovery, visual/source/evidence rendering and exact proposal checks. No server, schema, camera, Plan drawing or style changes.
- Keep project plus ticket identity, reject stale project/task generations, and retain the identical uncertain submission envelope and source pins for retry.
- Verify submit/reopen/append/revise/cancel/retry/inspect/decide, attachment retention, independent drafts, offline controls and delayed replies with controller tests and existing browser journeys. Run `npm run validate`, applicable suites, build and diff checks.

Construction-model delta: zero. Existing server review and publication CAS remain authoritative.

## Run ledger

1. Baseline `82d6502`, isolated branch `codex/issue-253-task-controller`. Read issue #253, AGENTS, loop constraints, implementation plan and reviewed #261 contracts. State is unpaused. User authorization supplied by parent covers this implementation.

## Status: controller repair verified; draft for human review

The shipped draft-restoration regression recorded below is repaired and the expanded real-server journey passes. The PR remains a draft for human review, with combined spatial-workspace integration/qualification owned by the parent. Existing Windows PDF/socket prerequisites remain separate host limitations.

On 2026-10-31 the maintainer explicitly renewed this epic repair with “Continue with as many attempts as you need”. The parent relayed that this supersedes the session attempt-count stop for the epic; it does not authorize weakening validators or automatic merge/readiness/issue closure. Work resumed under that renewal.

### Original WIP failure and attempt ledger

`demo/spatial-tasks-browser.test.ts` uses the real server and deterministic clarification worker. It creates an unsent First task with `first.txt`, creates an independent Second draft with `second.txt`, restores First and submits it, restores Second with its own text/file, then reopens the confirmed First task. The expected composer is empty because First was sent. Instead it contains `First independent door task`, with status `Chat reopened with its unsent message and attachments. Drafts stay in this tab until sent.` No browser page error or application error is reported. At the WIP checkpoint, the test's later append and delayed-poll assertions were not reached. They now pass under the expanded journey below.

1. First run failed at an immediate empty-composer assertion after New chat, before the asynchronous transition completed. Added an observable composer-value wait to the test; no assertion was weakened.
2. Second run reached confirmed First task reopening and timed out waiting for an empty composer. Original First text was restored.
3. Third run added teardown diagnostics only and reproduced the same restoration failure: original First text, the unsent-draft restoration status above, no page errors, empty application error. Stopped and escalated. No fourth fix or test attempt was made.

At that WIP checkpoint the owning cause was not proven; stale switcher state was only a hypothesis. The later trace disproved that hypothesis and identified the wire-contract error below.

### Renewed diagnosis, repair and proof

1. Instrumented the actual controller draft writes in the shipped browser. Submission confirmed the original local key with `preserveDraft: false`, but composer cleanup was not reached; later switches saved the still-visible sent text under the confirmed ticket key.
2. Captured the real application error stack: `Scopes require finite plain JSON data`, from `parseRequestConversation(undefined)` through `receiveTask` in the controller send acknowledgement path. The first submission endpoint returns `TicketSummary`, which deliberately has no transcript. The controller had reconciled the ticket identity and then mistakenly parsed the summary as a full conversation; that exception stopped the successful send's composer cleanup. Earlier isolated tests supplied a full conversation in their fake acknowledgement and missed the actual API contract.
3. Removed that competing detail parse from the acknowledgement path. Added a typed `TaskAcknowledgement` carrying the validated summary and draft-retention result. Full conversation parsing remains strict in the subsequent detail-read path; room-app consumes the typed summary directly.
4. Added a regression with the actual summary-only acknowledgement, asserting successful reconciliation, deleted sent draft, null transcript until the separate detail read, and the later validated conversation. The existing shipped assertion that a sent task reopens with an empty composer now passes without relaxation.
5. Expanded the shipped journey to deliberately lose the first acknowledgement after the real server saves it. The identical replay body creates exactly one durable task and clears the composer after confirmation. Both independent unsent drafts retain their distinct text/files; reopening and appending continue the original task. A held old-task poll cannot reopen the task or overwrite a new draft. Switching to another real project and back retains the original project's unsent draft and attachment. Accepted Main remains unchanged throughout this clarification-only journey. No page/application errors remain after the deliberate failed-acknowledgement retry.
6. Removed all temporary controller/application instrumentation. One project-switch test action initially attempted a button inside a closed Project tools menu; the test now opens that visible menu before selecting Projects. No product assertion or validator was weakened.

## Implemented boundary and integration surface

- `SpatialTasks<Draft>` owns current project/task/draft identity, ticket parsing and summaries, validated conversation projection, inspected proposal projection, offline freshness, per-task draft storage, polling coordination and every change-request endpoint caller.
- Exports: `SpatialTasks`, `BacklogItem`, `TaskSubmission`, `TaskAcknowledgement`, `TaskGeneration`, `TaskProjection`, `StaleTaskResponse`, `TaskConflict`.
- Intents/read ports: `setProject`, `startTask`, `selectTask`, `openTask`, `readTask`, `readDraft`, `refresh`, `submit`, `append`, `decide`, `inspectProposal`, `observeWorkspace`, `generation`, `isCurrent`, `requireCurrent`, `key`, `projection`.
- Draft/presentation adapters: `saveDraft`, `getDraft`, `deleteDraft`, `parseTicket`, `updateTicket`, `receiveTask`, `setOffline`; lifecycle: `poll`, `startPolling`, `dispose`.
- `room-app.ts` retains editor/recovery, source picker, linked reference and evidence rendering, saved visual inspection, model presentation and existing exact review/capability checks. Its competing request transport, retry bodies/IDs, ticket parser/cache, draft map, active conversation identity and polling flags were removed.
- Uncertain submission and append retry reuse the original serialized body, identity, sequence and source references. A successful replay with later edited content reports `preserveDraft` so those edits remain unsent. Project/task generations reject delayed reads, inspection restores and decision acknowledgements, including switch-away-and-return cases.
- `TaskProjection` is the readonly presentation surface; parsed ticket and conversation data are frozen. A projection/inspection receipt grants no model publication authority. Existing server decisions and accepted-head CAS remain final.
- Placement persistence and task graphics remain #254/#257 work. This slice does not implement a new origin schema or navigation policy. Existing context/view restoration is retained pending the navigation integration lane.

## Validation and evidence

- `npm ci --ignore-scripts`: passed, 203 packages installed, 0 reported vulnerabilities.
- `npm run validate`: passed after the controller extraction, including strict TypeScript, type checking and repository policy.
- `npm run build:demo`: passed; production room-app bundle includes the extracted controller.
- Latest controller tests: **11/11 passed**, including the summary-only acknowledgement regression, covering identical lost-acknowledgement envelope/source replay, append sequence replay/conflict draft retention, task ABA and project ABA rejection, independent drafts, delayed submission and decision replies, polling generation isolation, readonly/offline state, later-edit retention and exact task-message inspection.
- Existing shipped browser checks: **18/18 passed** in `canvas-studio-browser.test.ts`, `request-chat.test.ts`, and `workspace-shell.test.ts`. Includes source upload, actual proposal display with unchanged accepted head, explicit server acceptance, offline/stale controls, revise-to-focused-composer, one preserved viewer and desktop/phone panel behavior. The newly added shipped task journey also passes as detailed above.
- Latest focused unit run: **58/58 passed** across controller/conversation/status/evidence/context/composer/source/floor-guide/tabs. The new shipped task-controller browser journey also passes. Earlier broadened run: **64 passed / 1 baseline host failure** across conversation, evidence, status, context, composer, retained sources, controller, floor guide, tabs and draft lifecycle suites. Real cancellation, reply supersession, retry and draft cleanup assertions passed.
- Construction model delta for this refactor: **zero**. Browser fixtures exercise existing proposal/acceptance behavior; no production model/provider/deployment mutation occurred in this lane.

### Separate baseline Windows limitations

1. `floor-plan-guide-browser.test.ts` completed desktop PNG preparation, confirmed dimension/source binding, unsent reload recovery, real draft display, explicit Main acceptance, baseline/alternative-only delta and SQLite restart. The final phone PDF upload failed twice with HTTP 400 `{"error":"Source preparation tool is unavailable."}`. `demo/request-source-store.ts` `pdfCommand` invokes `/usr/bin/prlimit` and `/usr/bin/pdfinfo`, `/usr/bin/pdftotext`, `/usr/bin/pdftoppm`; these Linux paths are unavailable on this Windows host. No third retry or server change was made. This is separate from the repaired controller draft-restoration regression.
2. The broadened unit run's only failing case was `demo/request-draft.test.ts` `HTTP draft feed is read-only, same-origin, uncached and ends when the final proposal is ready`. It failed at `server.listen(temp/server.sock)` with Windows `EACCES`, before HTTP/app behavior. No test or server change was made for this host limitation.

Retained synthetic floor evidence on this host: `C:/Users/Frederik Tegnander/.codex/visualizations/2026/10/31/controller-253/` contains `browser-trace.zip`, `last-ui-state.png`, `desktop-confirmed.png`, `desktop-alternative.png`, `floor-plan-measurement.txt`, `accepted-project.json`, and `model-delta.json`. The original trace contains the exact failed PDF response. `task-controller-fixed.png` and `task-controller-fixed-trace.zip` retain the successful expanded controller journey after repair. No customer sources or credentials were used.

## Review risks and decision

The refactor spans the application's task entry points. Its previously failing draft-restoration journey now passes through the shipped app, including real-server uncertain acknowledgement replay, attachments, task/project switching, continuation and late-response rejection. Integration consumers must revalidate against the parent's combined domain, navigation, Plan and task-graphics baseline; this branch intentionally does not merge other implementation lanes merely to repair its acknowledgement contract. The broader PDF/socket cases require a supported host or separate reviewed portability work; they were not weakened. Human review controls readiness and merging. No main merge, ready marking, issue closure, deployment or live provider call occurred.
