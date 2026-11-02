# Delete spatial agents (#292)

## User behavior

Delete agent is available in the selected agent's conversation controls and on each Tasks row. Confirmation distinguishes an unsent draft from saved work. Keep agent or Escape cancels. A confirmed deletion removes only that agent from the viewer and Tasks; deleting a current agent does not immediately spawn a replacement. New chat starts another agent explicitly.

Unsent draft removal clears its text, attachment/context state and saved local draft. Another draft remains intact. Saved removal stops queued/working execution and fences late results; the saved conversation and proposal/review evidence remain in Chats. The accepted model is unchanged. A failed server deletion retains the visible agent and reports the error.

Deleting the active agent explicitly returns the displayed model to the accepted source while retaining the actual eye, facing, level and motion. Its proposal remains available through saved history. Snapshot binding is checked separately from viewpoint continuity, because an orphaned proposal must not remain visible after closing its task.

## Implementation and persistence

The existing request journal stores an optional literal `agentDeleted: true`. Deletion requires the currently reviewed request identity, is idempotent, and uses the existing cancellation decision/state and worker abort path. No database table migration or model entity change is introduced. Older binaries that strictly reject unknown stored fields cannot read flagged tickets; use a build supporting this field when reopening this preview data.

The controller rejects stale projections that would resurrect a removed agent. The server refuses more worker revisions/replies/retries on a deleted agent. Human decisions on an already saved proposal remain governed by the existing explicit review path.

Model delta: zero. Ticket metadata and camera-side presentation only; no geometry, model snapshot, model validator or accepted-head changes.

## Linux acceptance evidence

At `79ed8642ed864b77c323b7d2ba55fbdc11b21848`:

```text
Strict TypeScript valid. 385 source file(s) checked.
tsc --noEmit: passed
Policy valid. 0 changed file(s) checked.
change-requests.test.ts + spatial-tasks.test.ts: 54 passed, 0 failed
build:demo: passed
created draft and saved agents can be deleted ...: 1 passed, 0 failed (39.6 s)
browser errors: []
```

Backend tests cover saved proposal/transcript preservation, stale identity rejection, idempotence, another task remaining intact, worker abort and late completion across restart, and unchanged accepted project bytes. Controller tests cover DELETE binding, stale projection rejection, and server failure.

The real UI test covers two unsent agents, cancel/confirm, inactive deletion, clearing an attached text file, current deletion without replacement, explicit New chat, two saved agents, failed deletion and retry, preserved eye/canvas, saved deletion surviving page reload, and reachable Tasks delete controls at 390 and 320 pixels. Fixtures run on Linux with a deterministic worker; no live provider or user project is mutated by these tests.

Commands on Linux, as `bimforge`:

```sh
npm run validate
node --test demo/change-requests.test.ts demo/spatial-tasks.test.ts
npm run build:demo
PLAYWRIGHT_BROWSERS_PATH=/var/lib/bim-forge/previews/browser-cache \
XDG_CACHE_HOME=/var/lib/bim-forge/previews/browser-cache \
node --test --test-name-pattern='created draft' demo/spatial-workspace-browser.test.ts
```

One initial typecheck found `working` is not an activity stage; the stage expression was narrowed to valid terminal states. The repair passes all checks above. Raw logs and plan are retained in the client's Local AppData `BIMForge/delete-agent-292-evidence` directory. This source is ready for integration with the other requested workspace changes; it has not independently replaced the running preview.
