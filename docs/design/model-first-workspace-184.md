# Model-first workspace (#184)

Base: `1643595c193f408f9840f1544c732b481390a158` (PR #180).

## Plan and acceptance

Change `demo/index.html`, `demo/room.css`, a small `demo/workspace-shell.ts`
controller and minimal navigation hooks in `demo/room-app.ts`. Model entities,
storage, scope queries and rendering algorithms do not change. Preserve every
existing DOM ID, the scope builder, auth, sources, backlog tabs and delta review.

Run root validation, changed-path policy validation, demo build and existing
scope/client/request/server tests in a resource-limited server container. Check
desktop and phone layouts against a disposable project, including panel
collapse, Plan/3D, rendering modes, room/level navigation, sources/scopes,
backlog/activity/history and review. Record source-bound screenshots and logs.

## Integration contract

- `#workspace-shell` owns layout only. `#workspace-navigation` contains existing
  level and room navigation. `#workspace-context` contains existing contextual
  pages and request details. Both panels have named toggle/close controls.
- The empty `#request-chat-mount` host is inside `#editor-panel`, before request fields.
  Issue #181 owns its children, transcript/composer and annotation behavior.
  No shell controller handles messages, submissions or model scope queries.
- `showPage` still selects request/project/backlog/activity/review/history, but
  keeps the central model visible. Request and review canvas sections occupy
  the same central stage. The existing single `ModelViewer` moves between its
  existing hosts; no second model state or viewer is introduced.
- `showRequestPane('details')` opens request context. `canvas` focuses attention
  on the model and closes the phone sheet. Desktop context remains available.
- Panels scroll independently. At phone widths the open panel becomes a lower
  sheet, reserving the upper viewport for the model. Escape closes a panel and
  returns focus to its toggle; modal dialogs retain their existing behavior.
- The shell module exposes `showContext(page)` and `showRequestDetails(show)`
  to the existing navigation hooks. Chat should use existing request navigation
  hooks; it does not own panel visibility or central model placement.

Model delta: zero entity, relationship, geometry or accepted-revision changes.
Human review and a draft PR remain required. No live-preview deployment.
