# Request conversation qualification

Issues #181, #182, and #183. Code qualified at `3233b9ec4bc38537cdcc68d7dad0ef619b1777ac`, based on PR #180 at `1643595c193f408f9840f1544c732b481390a158`. The model-first application frame in #184 is a separate change.

## Server checks

All commands ran over SSH to `frederik@192.168.1.17` in isolated containers using immutable Git bundle source. Image `bim-qvm-tools:20261025` resolved to `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`. Containers had 0.5 CPU, 1 GiB memory, and no swap. No local npm, build, or test command ran.

| Source | Check | Result | Server artifact directory |
| --- | --- | --- | --- |
| `3ccb8854faec853de12ada426a881db88277ca2d` | `npm run validate`, explicit changed-path policy, `npm test` | 569 passed, zero failed, two existing platform-dependent factory skips | `/ssd1/bim-forge-qualification/181-3ccb8854/artifacts/` |
| `3233b9ec4bc38537cdcc68d7dad0ef619b1777ac` | `npm run validate`, explicit policy check of 19 changed paths, focused conversation tests, `npm run build:demo` | Validation and build passed. All 16 tests passed. | `/ssd1/bim-forge-qualification/181-3233b9ec/artifacts/` |

The focused command was `node --test src/request-conversation.test.ts demo/request-chat-evidence.test.ts demo/conversation-flow.test.ts demo/request-conversation-queue.test.ts`. Final checks cover structured clarification, immutable file and visual evidence, aggregate source limits, idempotent replay, sequence conflicts, late worker cancellation, per-ticket serialization, legacy recovery, earlier proposal and decision retention, refinement from the prior draft, and rebase over unrelated acceptance. A conflicting accepted change fails explicitly and preserves the earlier proposal.

The complete suite predates the final rebase, progress-CAS, guidance, and stable-title changes. Those changes are covered by the final validation, focused tests, build, and restart browser check. The two skipped factory tests exercise non-administrator dispatch and a symlink entry in a different host environment. No validator or test was removed or disabled.

## Browser and model evidence

The disposable fixture was `demo/fixtures/conversation-preview.ts`. Its deterministic worker returned questions and intentions through `run_model_script`; real ScriptBox execution, scope guards, model validation, persistence, and review remained active. No live ChatGPT account or live preview credentials were used.

The browser exercised this sequence on source `3ccb8854`:

1. Open the fixture house, select `office-desk`, freeze its scope, and attach a 2D pin at `[9.5, 1.5, 0]` metres on `level-ground`.
2. Ask to widen the desk while preserving its monitor and other rooms. The assistant asks, "What width should the selected desk have?"
3. Reply with "1800 mm", upload `desk-notes.md`, and attach the same selected stable ID with a 3D pin. The source digest is `ba77da2a85a7` at its displayed prefix.
4. Open the proposal from the assistant message. The validated delta changes only `office-desk` from 1.6 m to 1.8 m wide. Its monitor, laptop, other entities, and all relationships remain unchanged.
5. Explicitly accept the proposal. The transcript records the acceptance decision as message five; sending the reply did not accept it.

The accepted base was `40cc01d2c9cf0246b5c292a432a483d9e823624b9e578f6e89ea3c2ca388017f`. The accepted result has revision prefix `fdff132a32`. `demo/conversation-flow.test.ts` independently asserts the one-entity delta and unchanged accepted model before review.

The fixture then restarted using the final `3233b9ec` source and copied disposable state. Reopening the completed conversation recovered all five messages, the original 2D pin, the reply's file and 3D pin, the proposal link, and its acceptance decision. The title remains the first user request after refinement. Desktop 1440 by 1000 and phone 390 by 844 checks showed no page overflow or application error. The only resource error was the existing missing favicon.

Screenshots and Playwright transcripts are retained in the local task artifact directory `C:/Users/Frederik Tegnander/.codex/visualizations/2026/10/26/01a1798b-0cbb-7901-8727-29895a4d927d/browser-evidence/`. Final captures are `conversation-final-desktop.png` and `conversation-final-phone.png`.

## Review boundaries

The preview limits each conversation to 20 user turns and 48 total messages, with 1,000 characters per message and four source files totalling at most 12 MiB. Limit failures retain earlier evidence. The UI captures selection and floor or wall pins; the wire contract also represents arrows. A changed scoped base requires a fresh scope review. Conflicting prior drafts fail explicitly instead of dropping earlier changes. The accepted model remains authoritative until a separate acceptance decision.

Persistence changes require human review. Publication uses the existing file-count waiver and does not modify factory policy. No merge, live preview deployment, hospital qualification, or benchmark run forms part of this evidence.
