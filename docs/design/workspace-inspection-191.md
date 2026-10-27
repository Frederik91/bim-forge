# Model workspace inspection

Issue #191 improves the deployed workspace in #190. It changes presentation and read-only navigation only. Selection, hover and hierarchy actions never author geometry or approve a request.

## Plan

- Correct the request panel's flex height chain in `demo/request-chat.css`, retain independent history scrolling, pin the composer and follow new messages only when already near the end.
- Add `demo/model-explorer.ts` with a pure stable-ID hierarchy projection, accessible expandable tree and read-only element properties. Update `demo/index.html`, `demo/room-app.ts` and `demo/workspace-shell.ts`; remove the replaced level/room dropdowns and handlers.
- Extend `demo/model-scene.ts` and `demo/model-viewer.ts` with distinct selected/hover overlays, visible-element picking, pointer cursor, drag/cancel/leave handling and accessible selection feedback. Preserve camera drags and comparison evidence.
- Verify pure hierarchy/property behavior and actual Babylon meshes under NullEngine, then real desktop/phone UI on an isolated server fixture with multiple levels and rooms. Check measured chat/input bounds, pointer clicks, hover clearing, room/level navigation, properties and unchanged accepted model/drafts. Build/test only in server containers.
- Open a draft PR with source-bound evidence, then merge and deploy the tested result to the server preview under the maintainer's standing instruction. Retain a consistent private rollback snapshot and verify served assets, health, connection and preserved model/request data.

## Diagnosis

The deployed desktop at 1280 × 720 gave the history mount exactly 100 px and left 72 px below the form. The read-only UI bounds check returned `pass: false`. The context content did not grow to fill its flex parent. Clicking the visible office desk did update the selected stable ID, but left properties hidden in request options and gave weak visual feedback.

The tree uses actual level and room identities. Shared walls/openings remain at level scope rather than being duplicated under rooms. Legacy single-room snapshots get an elements group, not an invented persisted level. Non-spatial family definitions remain available separately.

## Evidence

Pending implementation and qualification.
