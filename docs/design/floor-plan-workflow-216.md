# Guided floor-plan workflow

Issue [#216](https://github.com/Frederik91/bim-forge/issues/216) adds a floor-plan action to the existing chat composer. It uses the private source pipeline and existing reconstruction, proposal, acceptance, baseline, and alternative APIs.

## Source and measurement contract

`demo/floor-plan-guide.ts` parses a positive whole-millimetre dimension with an immutable drawing reference, PDF page, named feature, provenance, and dimension basis. Provenance distinguishes a site measurement from a dimension printed on a drawing. The basis distinguishes wall centrelines from a clear span between faces. The guide never treats these spans as interchangeable.

Confirmation uploads `floor-plan-measurement.txt` through `uploadSourceFile`. The note contains the original drawing ID, SHA-256, filename, page, confirmed value, and provenance. Submission includes both sources through the existing request contract and project retention path. A removed or changed drawing invalidates confirmation. At most three user attachments leave room for the fourth measurement attachment.

The guide requires confirmation before sending a guided request. Its request explicitly enables `floor-plan-reconstruction`; attaching a drawing alone grants no reconstruction authority. The composed instruction uses readable single-line text to satisfy the native review validator. Advanced reconstruction remains available through Request options.

Confirmation records a user assertion. It does not verify the drawing's accuracy, resolve conflicting project evidence, or promote inferred values to measured facts. Other dimensions remain inferred until reviewed. The agent receives the drawing and note and must disclose contradictions, assumptions, unsupported geometry, and omissions. Existing evidence freshness checks and human acceptance still apply.

## Composer and recovery

`demo/floor-plan-guide-ui.ts` owns only composer controls and confirmation state. `demo/room-app.ts` supplies the current chat binding, sources, and writable state. The single `ModelViewer`, `#request-chat-mount`, geometry validators, accepted model state, and server routes retain their existing owners.

The last guided unsent draft recovers in the same browser tab through `sessionStorage`. Recovery contains text and source references, not private source bytes. It checks project, design target, and exact accepted revision before restoring. A changed design leaves the recovery record available and refuses automatic restoration. Existing in-tab chat switching retains independent drafts. Recovery depends on server source availability and does not extend an unsent source's expiry.

The confirmed dimension remains a compact, expandable composer summary after reload. Confirmation is separate from sending, proposal review, and acceptance. After accepting the reconstruction, **+ Alternative** uses the existing baseline and fork commands to retain an **As-is** version and open an independent writable alternative.

## Qualification

Qualification runs on `frederik@192.168.1.17` in `bim-qvm-tools:20261025` with network disabled, two CPUs, 3 GiB memory, 256 PIDs, read-only source and dependencies, and SSD-backed temporary files and artifacts. The source snapshots, commands, logs, and attempt ledger remain under `/ssd1/bim-forge-qualification/issue216/`. No root package installation, preview cutover, credential copy, or live model mutation forms part of this qualification.

The new browser case uses the shipped app and a deterministic provider fixture. Actual PNG/PDF preparation, queue persistence, ScriptBox execution, native geometry validation, review, acceptance, and SQLite restart run without mocks. This verifies application behavior; it does not qualify live AI interpretation accuracy or actual-phone interaction.

The synthetic source depicts a 6000 by 4000 mm floor with two rooms, a 150 mm wall thickness, and a 2700 mm height. The browser confirms only the 6000 mm overall centreline width. Reconstruction creates a validated two-room floor proposal. After explicit acceptance, the browser captures an As-is baseline, forks Alternative 1, and accepts a 200 mm shared-partition shift only into that alternative. Main and the fixed baseline retain identical revisions. The retained delta reports the changed wall and both room bounds.

The browser also verifies unsent text/source/confirmation recovery after reload, source-bound measurement delivery, private source download, explicit decision responses, accepted state after server restart, a 390 by 844 PDF flow, source-removal invalidation, one visible model canvas, and no page overflow. The pure contract tests cover unknown scale, invalid lengths and pages, clear-span versus centreline meaning, immutable source changes, attachment limits, request length, readable review text, recovery parsing, and unresolved contradictory evidence.

Reproduce the checks in the configured server container:

```sh
npm run validate
npm run build:demo
npm run test:chat-browser
npm test
node scripts/validate-policy.ts --changed-files demo/index.html demo/request-composer.ts demo/room-app.ts demo/room.css package.json demo/floor-plan-guide.ts demo/floor-plan-guide-ui.ts demo/floor-plan-guide.test.ts demo/floor-plan-guide-browser.test.ts docs/design/floor-plan-workflow-216.md
```

At code commit `2d33164`, attempt a08 passed all 14 browser checks and the full `npm test` suite: 814 passing tests, zero failures, and three existing optional skips. Its explicit nine-file policy check also passed. The retained `model-delta.json` has SHA-256 `9cd25647fb125946cd276a35b7a8ada3e2da19a8996ea8d0a6163760860201c2`. The complete log has SHA-256 `a6c1896013c95b4e13d1dd43a212a4b87f170e1e11a4b7abdf42ca9c31384fb6`.

The final a09 snapshot adds compact recovery display and retains the source measurement note and accepted portable project alongside screenshots, trace, and model delta. Its root validation, four contract tests, 14 browser checks, and explicit ten-file policy output are recorded in `a09/artifacts/qualification.log`. The issue and draft PR identify the checked commit and outcome.

| Attempt | Result and cause |
| --- | --- |
| a01 | Container could not mount `dist` inside read-only source because the empty mount directory was absent. Created it in the SSD source snapshot. No tests ran. |
| a02 | Lint passed. TypeScript could not resolve its sibling platform package because the dependency mount lacked a `node_modules` parent. Corrected mount layout. |
| a03 | Root validation, four new contract tests, and browser build passed. |
| a04 | Browser upload, confirmation, and unsent recovery passed. Proposal wait timed out. |
| a05 | Terminal ticket exposed a04's cause: a generated newline violated the native reviewed-instruction contract after geometry validation passed. Normalized generated whitespace and added a regression assertion. |
| a06 | Root validation passed. The full-suite contract prelude required Git metadata absent from the tar snapshot. Switched to a committed bundle clone. |
| a07 | Root validation, build, and 13 existing browser checks passed. The new test reached acceptance but selected hidden Accepted markup. Bound the check to the decision response and exact chat status. |
| a08 | All 14 browser checks, 814 full-suite tests, root validation, build, and nine-file policy passed. Three existing optional tests skipped. |
| a09 | Final compact recovery and retained source/model evidence checks. Commands, source commit, and results are retained in `a09/artifacts/`. |

## Integration boundary

This branch builds on main `882a50b7599ff926fb0648c2e070c51a2cffccfd`. It uses existing `model.previewWallShift` and does not import #217's helper or edit #218's linked-model modules, server routes, or viewer. The parent coordinator owns combined integration and preview publication. The existing composer textarea remains available for an unsent linked-reference insertion.

Supported reconstruction remains one rectangular storey tiled by two to twelve rectangular rooms. Angled or curved walls and disconnected wings require another representation. Native portable limits remain 100 items, 32 revisions, and 256 KiB. The measurement note and concise UI state do not expand those limits or certify construction geometry. Human review remains required before merge.
