# Spatial contract evidence

Issue [#261](https://github.com/Frederik91/bim-forge/issues/261). Baseline `7cc79034a772e1e56fdbbba7e64d2a5aeb792597`, branch `codex/issue-261-contracts`, isolated worktree `issue-261-contracts/bim-forge`.

## Plan and scope

Add `docs/design/spatial-workspace-contracts.md` and this evidence record. Document existing identities, coordinate/source bindings, immutable origin versus targets, submission replay, readonly task/view interfaces, overlay ownership, token inputs, exclusive file owners, and acceptance cases. No model entities, relationships, schemas, runtime code, validators, credentials, or deployment files change. Construction-model delta is zero.

Validation consists of `npm run validate`, changed-path policy, `git diff --check`, and focused existing conversation/markup/status tests. These verify the existing behavior used as the contract foundation; they do not claim new runtime placement or browser behavior.

## Source and coordination evidence

- Read issue #261, repository `AGENTS.md`, `policy/loop-constraints.md`, `policy/gate.json`, `STATE.md`, and the implementation plan. State is not paused and issue #261 has no `loop-pause-all` label.
- Used the indexed production-baseline project for symbol discovery and read `ChangeRequests.submit` there, then verified owning source in this worktree. Actual source confirms request fingerprint replay, initial ticket ID, transactional conversation/source binding, numeric attempts, two global slots, sequence conflicts, superseded-result protection, and guarded publication.
- Checked `src/request-conversation.ts`, `src/spatial-markup.ts`, `src/geometry-contract.ts`, `src/geometry-query.ts`, `src/linked-model.ts`, `src/request-sources.ts`, `src/model-evidence.ts`, `demo/model-scene.ts`, `demo/linked-model-render.ts`, and `demo/request-chat-status.ts`. Existing frame is `project-engineering-metres`; project XYZ metres become Babylon XZY. `completed` is the server state displayed as Accepted. No `attemptId` or immutable origin exists in the baseline.
- Coordinated #252 token authority as `demo/ui/design-tokens.ts` / `spatialTokens` / `--spatial-*`, including explicit drafting and agent color keys. Standalone Plan and graphics consume readonly injected subsets, with live integration adapters importing the single authority. Runtime definitions remain #252-owned.
- Coordinated #259: trusted single-engineer scope supplies no participant identity or privacy guarantee. Future server authorization filters projections, figures, counts, locations, titles, and status; actor/project/policy-generation changes invalidate late state. No speculative audience fields enter this contract.

## Run ledger

| Attempt | Action | Result |
| --- | --- | --- |
| 1 | Source and scope review; write contract/evidence | Complete. Matrix includes all six required cases and named exclusive file owners. |
| 1 | `npm ci --ignore-scripts` | Passed. 203 packages installed; zero vulnerabilities reported. |
| 1 | `npm run validate` | Passed. Strict TypeScript checked 347 source files; `tsc --noEmit` and base policy passed. |
| 1 | `node scripts/validate-policy.ts --changed-files docs/design/spatial-workspace-contracts.md docs/evidence/spatial-contracts-261.md` | Passed. Two changed paths checked. |
| 1 | `node --test src/request-conversation.test.ts src/spatial-markup.test.ts demo/request-chat-status.test.ts` | Passed. 32 tests, zero failed/skipped. Covers source/snapshot parsing, finite bounded regions, zero-object worker context, turn status, and exact proposal capabilities. |
| 1 | `git diff --check` and final documentation review | Passed. Documentation-only scope. |

Queue replay and publication claims were checked against owning source and existing test assertions, not requalified here. The parent identified pre-existing Windows cleanup failures in the queue suite and owns their test-only correction in #265. This documentation attempt does not modify that suite or claim it passed.

No provider calls, production-data changes, deployment, merge, readiness change, or issue closure form part of this attempt.
