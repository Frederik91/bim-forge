# Combined preview integration

Issue #185 combines the durable model foundation (#170), model scopes (#180), request conversations (#181–183) and model-first workspace (#184) into one draft PR targeting `main`.

## Plan and ownership

- [x] Frame: current main is `8a1f3a955ecea90bceef574ff8b9eab4249669ce`; start this isolated integration branch from completed scope source `31a356c78ba75822cbd7954515e0f30d52a02e26`, including the unmerged versioned-house foundation.
- [x] Handback: pin both sessions' final code, draft PRs, tests, browser evidence and limitations before combining.
- [x] Aggregate: integrate conversation/backend changes first, then resolve the model-first shell's overlapping `demo/room-app.ts`, `demo/index.html` and `demo/room.css`. Preserve one model/viewer state, `#request-chat-mount` and the `WorkspaceShell` context API. Check package/Docker module wiring and all required DOM IDs.
- [x] Qualify: server-container root validation, exact changed-path policy, build and full combined suite. Add or reuse actual HTTP/ScriptBox fixtures for scoped conversational turns, file/visual evidence, proposal versions, unrelated acceptance and restart recovery. Inspect the combined model delta.
- [ ] Browser: the combined desktop/phone application flows and both observed defect fixes passed. Browser file picking remains unqualified because Chrome extension file access is blocked and no IAB/native picker is available; a manual picker check remains. Server upload/binding/delivery/restart tests passed. See the full [qualification report](../evidence/combined-preview-185/README.md).
- [x] Report: one aggregate draft PR against main, with source-bound evidence and an explicit merge/deploy handoff. Keep earlier slice drafts for traceability.

The parent owns this integration worktree, conflict resolution, integration fixtures, runtime/package wiring and combined evidence. Child sessions retain their own worktrees until their handbacks are complete. No concurrent writers share a worktree.

## Preserved boundaries

Stable model identities, immutable revisions, frozen scope membership and context/write separation remain authoritative. A visual attachment is request evidence, not direct authoring permission. Conversation turns are append-only and proposals retain exact turn/base/source bindings; refinements preserve compatible earlier draft intent or fail with an explicit conflict. Accepted model changes require an explicit review decision. Existing geometry, hosting, support, family, source, scope, replay and persistence validators remain enabled.

All builds/tests run in isolated server containers. No local npm builds/tests, no live preview model data or credentials, no merges/deployments. Respect the three-attempt stop rule. Retain current portable bounds; this integration does not claim hospital-scale qualification. The user's existing file-count waiver applies without changing factory policy.

## Source and evidence register

| Slice | Final source | Evidence |
| --- | --- | --- |
| Model scopes and foundation | `31a356c78ba75822cbd7954515e0f30d52a02e26` | #180; `docs/design/model-scopes-171.md` |
| Request conversations | `043762d45c38baecbb85c014a6fbe4a0264481c3` | #186; `docs/evidence/request-conversations-181.md` |
| Model-first workspace | delivery `5dae3d593babe319d1cdfd698811556117aa5e4d`; application `79e078d48a03203760022b97178d48916f6c4336` | #187; `docs/evidence/issue-184/README.md` |
| Combined integration | final application `08a5868cc735389c22a2513bd0da19a1bf38305a` | this issue and aggregate PR; [combined qualification](../evidence/combined-preview-185/README.md) |

## Integration findings

The textual UI merge produced two `#request-chat-mount` nodes at different positions. The combined shell keeps the one owned by the context panel. The build integrity test now checks every static DOM ID for duplicates and requires exactly one chat mount.

The browser release also needs its new conversation stylesheet. `build:demo` now emits the page, both stylesheets, bundle and a SHA-256/byte-length manifest together. The deployment instructions describe publishing the exact matched release. No live deployment configuration or state was changed.

The new HTTP qualification creates a saved room/type desk scope, receives an actual ScriptBox clarification, replies with a Markdown document and revision-bound 3D pin while retaining the initial 2D pin, and prepares the desk proposal. An independent scoped bed proposal is accepted after restart; the desk remains acceptable and preserves that bed edit. The accepted delta contains only `main-bed` and `office-desk`; supported devices and all relationships remain exact. The conversation retains both visual attachments, file evidence and its explicit acceptance decision.

The first two new-fixture runs failed before review: an older all-furnishings fixture forwarded metadata to an input schema that excludes it, then the replacement parameter operation lacked its required explicit scope. The final fixture uses the typed parameter API with a bound scope. The third run passed both the HTTP/restart case and complete-release integrity test, with root validation, policy and build also passing. Failures and passing logs are retained under `/ssd1/bim-forge-qualification/combined-185/`.

## Combined server qualification

Source `76623b9a3cd1fb9bab24fb5bb204f4b98579c363` passed `npm run validate` (145 TypeScript files), explicit changed-path policy against main `8a1f3a9`, and `npm run build:demo`. The complete standard test list from `scripts.test` plus `scripts.test:assets` ran together using `node --test --test-concurrency=1`: **576 cases, 574 passed, zero failed, two existing root-environment factory skips**. The two cases require a non-administrator caller and its installed symlink entry; no test or validator was disabled for this integration.

The immutable-source bundle, complete command, raw logs and container inspection are retained at `/ssd1/bim-forge-qualification/combined-185/76623b9/`. The container used Node `v24.22.1`, tools image `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`, 0.5 CPU, 1 GiB, no swap and no network. `artifacts/full-tests.log` records the complete result. All later differences must be evidence-only or receive new relevant qualification.

The combined browser fixture uses the same built bundle, SHA-256 `aa9acd29600d32054440519425f58e45d5b09034ae1aee3bd31424cc3ba185c1`, in a separate 0.25-CPU/1-GiB server container. It listens only on server loopback port 19585, reached through an authenticated SSH tunnel. Its private seeded project/state has no live preview data or ChatGPT credentials. The fixture worker is deterministic; ScriptBox, scopes, model validators, persistence and explicit review are real. Browser evidence is recorded separately below when complete.

## Final corrected qualification

The first combined browser run found two component defects: retained pins were treated as authored drafts, and reopening a conversation retained the previous browsing selection. Source `08a5868cc735389c22a2513bd0da19a1bf38305a` separates snapshot-bound inspection overlays from authored markers and restores validated request IDs, room and level. It preserves the missing-reference state explicitly and keeps genuine unsent text/marker warnings.

The corrected source passed root validation, build and 19 focused cases, then the **entire combined suite: 578 cases, 576 passed, zero failed, two existing root-environment skips**. Raw evidence is under `/ssd1/bim-forge-qualification/combined-185/ui-fix2/artifacts/`, including `full-tests.log` and container inspection. Its final bundle SHA-256 is `a758ecd13664712c5857eab49add8f441bea192b49513f614af4df0943039219`.

The final browser recheck used the retained accepted revision and all five messages from the first fixture. Desktop and phone now restore `office-desk` / `room-office` / `level-ground`, and repeated saved 2D/3D inspection creates no false draft warning. Actual unsent text and a new marker still prompt, and Keep editing preserves the text. Accepted model, message bindings, sequence, timestamps and decision remain unchanged. Full [results, captures and the remaining browser-picker automation gap](../evidence/combined-preview-185/README.md) are committed for review. No extension settings, live preview state, merge or deployment were changed.
