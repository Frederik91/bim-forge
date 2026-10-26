# Request chat composer

Issue #189 follows the deployed workspace in #188. The default request surface is a conversation and a single message composer. Context is explicit, visible and removable; attaching an item does not authorize a model edit.

## Plan

- `demo/index.html`, `demo/request-chat.css`: one composer with a left-hand + action, attachment chips, Send and compact model binding. Put coordinates, numeric sketch controls, source inspection, naming, scope and reconstruction behind Request options.
- `demo/request-composer.ts`: accessible + actions, @ model-item search and / action discovery, keyboard selection, composition-safe sending and visible snapshot-bound context. Commands are local UI actions; none submit, approve or mutate geometry.
- `demo/request-source-ui.ts`: file selection and clipboard files share atomic validation, upload state, size/count limits, retry/removal and draft retention. Mixed text/file paste preserves text. No background clipboard permission or global paste interception.
- `demo/room-app.ts`, `demo/request-chat.ts`: use the same composer for new requests and replies. Existing conversation, frozen scope, source, model, replay and review validators remain authoritative.
- Evidence: isolated server validation/build, focused source/composer and existing conversation integration tests, then desktop/phone UI with a disposable server project. Inspect +, @, /, paste, keyboard, errors, removable evidence and continued conversations. No live model edits.

## Boundaries

No schema, model, storage or credential changes. @ references bind stable IDs to the displayed revision through the existing visual-evidence contract. The model agent still interprets the instruction and prepares a separately validated proposal. Explicit user acceptance remains required.

## Qualification

Pending implementation and server/browser evidence.
