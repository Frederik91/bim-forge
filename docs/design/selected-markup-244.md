# Selected-surface and proposal markup — issue 244

## User-visible behavior

Click a wall face in the 3D viewer, open Markup, and draw on that captured face. The drawing-plane selector names the selected surface and a translucent patch shows its plane. Floor remains an explicit override and survives closing and reopening the tools in the same selection and chat context.

A selection made through navigation or the object picker has no captured face. The first drawing gesture must hit that selected element; missing it cannot silently draw on the floor or a different element. Navigation containers, levels and spaces are not physical drawing surfaces. Model, project, level, cutaway and linked-source changes invalidate captured faces and require a fresh pick.

The current chat's validated proposal also permits markup. Its attachment records the exact proposal revision and name. Sending a reply does not accept geometry. Tentative live drafts, historical inspected snapshots and fixed baselines keep their existing authority restrictions. Proposal drawing does not enable destination dragging.

## Implementation boundaries

The existing ModelViewer captures face identity, position and normal; SpatialMarkupView owns drawing-plane choice and feedback. RoomApp uses one context gate for the viewer, composer and attachment callback. Control refresh updates markup availability directly, including after saved-project startup; it does not rebuild the model merely to enable the toolbar.

This is a browser-only change: no model schema, API, storage, backend image, dependencies or acceptance rules change. Native and linked face picking use the same markup surface shape. This work's runtime browser evidence is for native walls; it does not establish IFC-face, phone or live-provider accuracy.

## Reproducible acceptance evidence

`demo/selected-markup-browser.test.ts` drives the shipped application and real server queue with a deterministic ScriptBox provider. It checks:

- Reload a saved project, click a wall, open Markup, and attach a vertical rectangle; explicitly choose Floor, reopen the tools and attach a horizontal rectangle.
- Select a different wall without a captured face, draw on the old wall, and receive no annotation or implicit floor projection.
- Leave and manually reopen a validated proposal, draw on its wall, and send a reply. The server returns 202 with the exact proposal revision/name, while accepted project bytes remain unchanged.

All build and browser runs use isolated network-off server containers with read-only source and dependencies, 2 CPUs, 3 GiB memory and no added swap. Artifacts remain on SSD. The existing cumulative Docker storage cap applies.

Source attempts remain recorded under `/ssd1/bim-forge-qualification/issue244/attempts.jsonl`. Attempt 1 reproduced the two reported failures. Attempt 2 caught a TypeScript shape mismatch; attempt 3 caught a level-navigation regression. Attempt 4 passed the affected suite, and attempt 5 strengthened exact proposal binding. Attempt 6 reproduced hidden markup after saved-project reload. Attempt 7 passed the markup paths but its broader floor-plan test timed out after both approvals while closing its isolated server. Its browser trace is retained; the timeout is not reported as a geometry assertion failure.

Final executable source: `30a64cd646e40fa2ee26f3e3fdd3761a01a75ef5`. Attempt 8 passes `npm run validate` (342 strict TypeScript sources and policy), the demo build and all 69 affected checks: 51 model/chat checks, 3 new browser regressions, the existing markup browser workflow and 14 chat/browser checks. The full guided floor-plan workflow, including baseline, alternative and restart, passes in this final run.

## Server preview publication

Publication 2 atomically installs `releases/30a64cd646e40fa2ee26f3e3fdd3761a01a75ef5`; its manifest SHA-256 is `090ca67f849a18fb80978f4898238f1fb78e6c9efc6cd715200e3f885c60626f`. Served assets match their hashes. The existing backend image `sha256:7cf6f5ec7630688b1f5bc7e7a98db274c81d371d377aec575616df182f329422`, container identity and compose bytes are unchanged. Read-only server state fingerprints match before and after; health is OK, ChatGPT remains connected and IFC links remain configured. Cumulative root growth is 937,742,336 bytes against the existing 2 GiB cap.

The prior static release remains available for pointer rollback. Rollback does not rewind model data. Exact private command, container, result, failed-attempt and preservation receipts remain under `/ssd1/bim-forge-qualification/issue244/`; they contain no published credential material.
