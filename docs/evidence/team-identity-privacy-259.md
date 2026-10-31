# Team identity and privacy design evidence

Issue: [#259](https://github.com/Frederik91/bim-forge/issues/259). Contract: [Team identity, privacy, and proposal publication](../design/team-identity-privacy.md). Date: 2026-10-31.

## Scope and plan

This attempt adds only the contract and this evidence file. The first milestone is confirmed single-engineer. It changes no construction model entities, storage schema, authorization code, providers, credentials, or deployment configuration. The model delta is zero.

The plan is to inspect the issue and current server/store behavior, document the future identity and access model, specify publication and migration requirements, coordinate projection boundaries with #261, and run repository validation plus policy and diff checks. Acceptance evidence is the source inventory, access matrix, open policy decisions, four-actor qualification contract, and future implementation boundaries.

## Source evidence

Inspected source baseline: `7cc79034a772e1e56fdbbba7e64d2a5aeb792597`. The planning document identifies production source as `bc7fbd392f036a6fda055599854f29670a27f279`. No live production privacy test was run.

Codebase-memory discovery used the indexed prototype project `C-Users-Frederik-Tegnander-.codex-worktrees-model-centered-design-language-bim-forge`, as directed by the parent task. Its server, source-store, evidence-store, account-connection, and browser-cache discoveries were checked against files in this isolated worktree. Broad search results were incomplete and were narrowed to named files; no completeness claim rests on the index.

| Source | Observation used by the design |
| --- | --- |
| `demo/server.ts`, `createDemoServer`, `sameOriginRequest` | Host and origin checks; no participant argument on current project, source, evidence, history, scope, or ticket commands. Service connection and health endpoints are separate from BIM membership. |
| `src/codex-app-server.ts`, `CodexAccountConnection` | Server-wide account connection and model-worker owner, not a BIM participant principal. |
| `demo/change-requests.ts`, `ChangeRequests`, `TicketSummary`, `list`, `recordEvidence`, `decide` | SQLite project/ticket/message/execution storage; titles derived from first message; direct-ID reads; `preview-human` evidence and decision attribution. |
| `src/request-conversation.ts`, `RequestConversationSchema`, `ConversationMessageSchema` | Version 1 conversation with message kinds and source/visual/evidence references; no verified participant or audience. |
| `demo/request-source-store.ts`, `RequestSourceStore` | Project-scoped immutable blobs, request binding, project retention, prepared images and text. Existing project/source association is not participant authorization. |
| `demo/project-evidence-store.ts`, `ProjectEvidenceStore` | Entries, receipts, dependency closure, citations, read sets, and freshness checks require audience-aware treatment in later work. |
| `demo/versioned-project-store.ts`, `VersionedProjectStore` | Content-addressed bodies, reviews, revisions, project documents, and accepted target publications. Portable reconstruction can disclose embedded information if only routes are filtered. |
| `demo/linked-model-routes.ts`, `handleLinkedModelRoute` | Catalog, originals, prepared geometry, replacement candidates, version review/adoption, and placement. Its authorization callback currently invokes same-origin checking. |
| `demo/room-app.ts`, `rememberFloorDraft`, `displayAccepted`, `download`; `demo/room-store.ts` | Session-storage floor draft, local-storage last project, in-memory state, portable downloads, and IndexedDB legacy recovery. Future actor switching needs more than clearing chat text. |
| `docs/design/spatial-workspace-implementation.md` | Single-engineer implementation scope and later team/privacy gate. |

## Interface coordination

#261's owner confirmed that the proposed `docs/design/spatial-workspace-contracts.md` keeps project-plus-ticket task identity and no invented audience or participant fields. Future task projections and graphics consume only server-authorized data. Lists, counts, titles, locations, overlays, and status are disclosures. Actor, project, and policy-generation invalidation belongs to later enforcement, not a claim about the present controller. No shared interface file was edited in this lane.

## Review checklist

- The contract distinguishes observed behavior, proposed defaults, and unexecuted future tests.
- Personal conversations reveal neither content nor existence, including to project administrators under the proposed policy.
- Company and discipline audiences remain project-bound, with explicit intersection semantics.
- Publication creates a previewed, immutable shared package without exposing the private transcript or private task identity.
- Shared acceptance requires a package visible to the target audience and preserves model validation and explicit approval.
- Migration preserves unverified legacy attribution and blocks participant-less readers of future team storage.
- Revocation covers browser caches, late responses, queued/active workers, provider delivery, and final transaction ordering.
- The future test matrix includes two active members, an outsider, a revoked identity, and an administrator policy check.

## Run ledger

| Attempt | Action | Result |
| --- | --- | --- |
| 1 | Read issue, local instructions, policy, source, and implementation plan; coordinate #261 | Complete. Issue has no pause label and local `STATE.md` has `paused: false`. Parent explicitly authorized this design lane. |
| 1 | `npm ci --ignore-scripts` | Passed. 203 packages installed; audit reported zero vulnerabilities. Lockfile unchanged. |
| 1 | `npm run validate` | Passed. `Strict TypeScript valid. 347 source file(s) checked.` Typecheck exited successfully. `Policy valid. 0 changed file(s) checked.` |
| 1 | `node scripts/validate-policy.ts --changed-files docs/design/team-identity-privacy.md docs/evidence/team-identity-privacy-259.md` | Passed. `Policy valid. 2 changed file(s) checked.` |
| 1 | Relative Markdown link check | Passed. Both local document links resolve. External issue links use the known repository URLs. |
| 1 | Whitespace and scope review | Passed. New-file whitespace checks emitted no diagnostics. Only these two Markdown files changed; no model delta. |

The new-file check used `git diff --no-index --check -- NUL <path>` because the files were initially untracked. Exit 1 indicates the new-file difference, with no whitespace diagnostics. The staged diff is checked again before commit.

Validation output:

```text
> npm run lint && npm run typecheck && node scripts/validate-policy.ts
Strict TypeScript valid. 347 source file(s) checked.
> tsc --noEmit
Policy valid. 0 changed file(s) checked.

> node scripts/validate-policy.ts --changed-files docs/design/team-identity-privacy.md docs/evidence/team-identity-privacy-259.md
Policy valid. 2 changed file(s) checked.

Local document links valid. 2 checked.
```

## Limits and human decisions

The current runtime is not qualified for participant privacy. Passing repository validation for documentation cannot establish that guarantee. No browser, worker, provider, team migration, or privacy negative test is claimed as run. The future qualification table is a requirement for later implementation.

Human review must decide the default audience, company/discipline semantics, administrator access, shared-target acceptance visibility, displayed attribution, custody, retention and deletion, offline/revocation behavior, exceptional access, and role assignment. The contract proposes defaults for each. Draft review does not authorize merging, issue closure, runtime security work, provider calls, or deployment.
