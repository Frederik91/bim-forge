# Compact model and chat workspace

Issue: #213. The maintainer approved six UX changes and smaller components after the live residential workflow test.

The model stays visible. The header owns the active-design selector, a one-action alternative shortcut and optional version management. The version dialog lives in the document body so closing a tools menu cannot hide it. The shortcut captures the current writable design as a fixed starting baseline before forking; selecting an existing baseline forks directly. Existing server commands and idempotency keys remain authoritative.

Chat owns requests, progress, clarification and proposal decisions. Outcome-first cards keep explicit target-specific acceptance and revision actions visible; technical evidence remains expandable. Activity/history are secondary navigation. Selecting a model object shows a compact context bar; detailed properties remain available on demand. Desktop controls use compact spacing; phone/coarse-pointer targets remain comfortable.

Pasted, dropped and chosen files stay temporary until Send. Sending retains the exact uploaded descriptors through the existing project-source API before submitting the request or reply. Failure keeps the message and attachments unsent. No bytes are duplicated and retries retain the same source identity. Retained files are discoverable through the library and bounded @ suggestions. Source retention does not turn a document into an accepted fact.

Freshness compares the currently selected design against the same target in the most recently fetched server repository. A fixed baseline is labelled fixed, rather than incorrectly compared with a cached head of another design. Chat messages and review authority remain bound to their original design and revision.

## Ownership and verification

- Parent: `index.html`, `room-app.ts`, `design-workspace.ts`, composer integration, source retention and design-status helpers.
- Chat worker: `request-chat.ts`, `request-chat.css`, status types and focused regressions.
- Shell worker: `room.css`, `workspace-shell.ts`, resize/focus/responsive regressions.

No geometry, entity schema, server capability or acceptance-policy change. One `ModelViewer` and the established mount IDs remain. Server-container validation and standard tests precede the draft PR. Isolated server browser tests cover compact cards, guarded decisions, focus/scroll, keyboard/pointer panel resizing and narrow layouts. Final CUA browser checks use a separate preview project and compare baseline/alternative identity after explicit acceptance. Record actual results and limits in the PR receipt; no local build/test and no paused factory restart.
