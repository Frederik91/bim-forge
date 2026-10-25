# Request backlog tabs — issue #115

## Scope and plan

Replace the state dropdown with four tabs in the requested order: Ready for review, In progress, Waiting, Completed / rejected. Update `demo/index.html`, `demo/room-app.ts` and `demo/room.css`; keep grouping in the typed `demo/request-tabs.ts` module and cover it in `demo/request-tabs.test.ts`, included in `npm test`.

No model entities, geometry, storage schema, worker behavior or approval rules change. Model delta: none. The PR is stacked on the generated-family feature (#114).

## Behavior

| Tab | Request states |
| --- | --- |
| Ready for review | ready, needs-input, failed |
| In progress | working |
| Waiting | queued |
| Completed / rejected | completed, rejected, cancelled |

The first tab opens by default. Counts update independently of the selected tab. Existing request actions and individual status labels remain. Clarification requests and failures stay in the attention group, with an explanation above the cards. Each tab has its own empty state. Arrow keys wrap; Home and End select the first and last tabs. Only the selected tab is in the keyboard tab sequence. The associated panel is labelled by that tab. On phones all four tabs fit in two rows.

## Acceptance evidence

Build and tests ran in Docker on `192.168.1.17`, using an isolated candidate based on `bim-issue-109-candidate`, Node 24.22.1. The shared server preview and its model data were not changed.

- `npm run validate` passed; explicit policy validation also checked the changed paths. See [validation.txt](validation.txt).
- `npm run build:demo` passed.
- `node --test demo/request-tabs.test.ts demo/change-requests.test.ts demo/server.test.ts`: **24 passed, 0 failed**. See [tests.txt](tests.txt).
- Browser test: created a disposable room and submitted one real queued request. Seven additional controlled rows in that candidate's disposable SQLite database represented the other states. These fixtures prove grouping and controls, not AI output or proposal acceptance.
- Initial groups: **3 / 1 / 1 / 3**. The first group showed a ready proposal, a clarification and a failure; retry/revision controls remained visible. Progress showed View progress and Cancel request. Waiting showed the submitted request. Finished showed completed, rejected and cancelled cards.
- Keyboard: ArrowRight selected Waiting, End selected Completed / rejected, Home returned to Ready for review, ArrowLeft wrapped to the final tab. Focus followed the selected tab.
- Live update: changed the controlled working row to ready. Polling changed counts to **4 / 0 / 1 / 3**, kept In progress selected and focused, and showed its empty state.
- Phone viewport: **390 × 844**. Document scroll width and client width both **375 px**; all four tab rectangles remained within the viewport, in two rows.
- Real cancellation through the phone UI moved the original queued request to the final group. Counts became **4 / 0 / 0 / 4**, Waiting stayed selected and showed its empty state.

Screenshots: [desktop](desktop.png) before the live transition; [phone](mobile.png) after the transition and before cancellation.

## Run record

| Attempt | Result | Decision |
| --- | --- | --- |
| 1 | Type checks, lint, build, 24 tests and desktop/phone UI checks passed | Open a draft PR for human review; no merge or shared-preview deployment |
