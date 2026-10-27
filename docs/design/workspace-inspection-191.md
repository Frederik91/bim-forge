# Model workspace inspection

Issue #191 improves the deployed workspace in #190. It changes presentation, read-only navigation and the placement of existing explicit proposal decisions. Selection, hover and hierarchy actions never author geometry or approve a request.

## Plan

- Correct the request panel's flex height chain in `demo/request-chat.css`, retain independent history scrolling, pin the composer and follow new messages only when already near the end.
- Add `demo/model-explorer.ts` with a pure stable-ID hierarchy projection, accessible expandable tree and read-only element properties. Update `demo/index.html`, `demo/room-app.ts` and `demo/workspace-shell.ts`; remove the replaced level/room dropdowns and handlers.
- Extend `demo/model-scene.ts` and `demo/model-viewer.ts` with distinct selected/hover overlays, visible-element picking, pointer cursor, drag/cancel/leave handling and accessible selection feedback. Preserve camera drags and comparison evidence.
- Display validated request activity by conversation turn, show working/offline/terminal feedback and bind inline proposal controls to the exact inspected message, request and revision. Keep the shared model visible and preserve unsent drafts across inspection and decisions. Return to the request model without leaving chat.
- Verify pure hierarchy/property behavior and actual Babylon meshes under NullEngine, then real desktop/phone UI on an isolated server fixture with multiple levels and rooms. Check measured chat/input bounds, pointer clicks, hover clearing, room/level navigation, properties and unchanged accepted model/drafts. Build/test only in server containers.
- Open a draft PR with source-bound evidence, then merge and deploy the tested result to the server preview under the maintainer's standing instruction. Retain a consistent private rollback snapshot and verify served assets, health, connection and preserved model/request data.

## Diagnosis

The deployed desktop at 1280 × 720 gave the history mount exactly 100 px and left 72 px below the form. The read-only UI bounds check returned `pass: false`. The context content did not grow to fill its flex parent. Clicking the visible office desk did update the selected stable ID, but left properties hidden in request options and gave weak visual feedback.

The tree uses actual level and room identities. Shared walls/openings remain at level scope rather than being duplicated under rooms. Legacy single-room snapshots get an elements group, not an invented persisted level. Non-spatial family definitions remain available separately.

## Evidence

Three isolated workers supplied viewer interaction, hierarchy/property assertions and conversation activity/review rendering. The parent owns the shared viewer consumer and inspector mounts. Source commits and test logs remain traceable through issue #191.

- Server image `bim-qvm-tools:20261025` (`4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`), Node 24.22.1. Checks run with 0.5 CPU, 1 GiB and no network; the disposable UI server has no preview data or credentials mounted.
- Full combined suite at `15d8f2b`: 604 passed, 2 skipped, zero failures, followed by 21 passing asset tests. The subsequent chat reading/focus fixes passed 31 focused tests; final integration validation and build cover the delivered source. All new suites are included in `npm test`.
- Viewer: 28/28 passed in the one maintainer-approved corrected rerun. Earlier runs stopped under the three-attempt rule; the final failing fixture retained selection across rendering modes. Resetting fixture selection preserved both hover and selected-color assertions.
- Hierarchy: 22/22 passed, covering actual spatial ownership, shared elements, legacy snapshots, generated families and dimensional units. Parent source adds explicit model units and clears absent inspector identities.
- Desktop browser at 1280 x 720: history grows into the remaining panel; measured gap between composer and panel bottom is 0 px, replacing the deployed 72 px gap. Direct mesh clicks selected the north wall and then the plant and opened their exact read-only properties. Level and room clicks changed visible context while retaining the unsent reply.
- Real queue/ScriptBox UI flow: request plant height change, read working status and reported tool actions, answer the structured clarification, inspect the inline proposal, toggle 3D delta and explicitly accept. The decision remains in the same chat. A separate API read/deterministic assertion confirms only `level-ground-plant.height` changed from 1 to 1.2 m; all 37 entity identities and all relationships remain intact.
- A second chat ran while the first retained its unsent reply; switching back restored the original message. Phone viewport 390 x 844 has no horizontal overflow; model and transcript remain visible and composer/panel bottoms both measure 818 px. This is browser viewport evidence, not physical-device touch qualification.
- Raw combined evidence is retained privately at `/ssd1/bim-forge-qualification/workspace-191/`; worker evidence paths are recorded in the integration handbacks. Hover colors, before/after ghost picking, hidden geometry, gesture cancellation and material cleanup have executable Babylon/NullEngine coverage. Browser automation cannot independently move a hovering pointer without clicking; the live check covers actual mesh clicks and camera interaction.

No persistent model schema, model authoring API, acceptance validator, permission or credential contract changes. Only an explicit bound decision can accept a proposal; replying, selecting and navigating cannot approve it. The existing accepted-history comparison fallback remains available for historical revisions without a request ticket.
