# Combined preview integration

Issue #185 combines the durable model foundation (#170), model scopes (#180), request conversations (#181–183) and model-first workspace (#184) into one draft PR targeting `main`.

## Plan and ownership

- [x] Frame: current main is `8a1f3a955ecea90bceef574ff8b9eab4249669ce`; start this isolated integration branch from completed scope source `31a356c78ba75822cbd7954515e0f30d52a02e26`, including the unmerged versioned-house foundation.
- [ ] Handback: pin both sessions' final code, draft PRs, tests, browser evidence and limitations before combining.
- [ ] Aggregate: integrate conversation/backend changes first, then resolve the model-first shell's overlapping `demo/room-app.ts`, `demo/index.html` and `demo/room.css`. Preserve one model/viewer state, `#request-chat-mount` and the `WorkspaceShell` context API. Check package/Docker module wiring and all required DOM IDs.
- [ ] Qualify: server-container root validation, exact changed-path policy, build and full combined suite. Add or reuse actual HTTP/ScriptBox fixtures for scoped conversational turns, file/visual evidence, proposal versions, unrelated acceptance and restart recovery. Inspect the combined model delta.
- [ ] Browser: use a disposable server fixture for desktop and 390px phone. Verify model remains visible through scope/query composition, chat clarification/reply with files and 2D/3D annotations, progress, review/delta rotation, acceptance, reopening and panel navigation.
- [ ] Report: one aggregate draft PR against main, with source-bound evidence and an explicit merge/deploy handoff. Keep earlier slice drafts for traceability.

The parent owns this integration worktree, conflict resolution, integration fixtures, runtime/package wiring and combined evidence. Child sessions retain their own worktrees until their handbacks are complete. No concurrent writers share a worktree.

## Preserved boundaries

Stable model identities, immutable revisions, frozen scope membership and context/write separation remain authoritative. A visual attachment is request evidence, not direct authoring permission. Conversation turns are append-only and proposals retain exact turn/base/source bindings; refinements preserve compatible earlier draft intent or fail with an explicit conflict. Accepted model changes require an explicit review decision. Existing geometry, hosting, support, family, source, scope, replay and persistence validators remain enabled.

All builds/tests run in isolated server containers. No local npm builds/tests, no live preview model data or credentials, no merges/deployments. Respect the three-attempt stop rule. Retain current portable bounds; this integration does not claim hospital-scale qualification. The user's existing file-count waiver applies without changing factory policy.

## Source and evidence register

| Slice | Final source | Evidence |
| --- | --- | --- |
| Model scopes and foundation | `31a356c78ba75822cbd7954515e0f30d52a02e26` | #180; `docs/design/model-scopes-171.md` |
| Request conversations | awaiting handback | dedicated Request conversations session |
| Model-first workspace | awaiting handback | dedicated Model-first workspace session |
| Combined integration | pending | this issue and aggregate PR |
