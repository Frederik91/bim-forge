# Versioned house implementation slice

Issue #161. Source baseline `8a1f3a955ecea90bceef574ff8b9eab4249669ce`.

## Swarm checklist

- [x] Frame: inspect live source, pin baseline, define ownership and completion.
- [ ] Fan out: disjoint persistence, request/server, browser and publication-investigation workers.
- [ ] Aggregate: coordinator reviews/integrates changes and runs server behavior/UI checks.
- [ ] Report: draft PRs with source-bound evidence, limitations and model deltas.

The current browser uses IndexedDB; the server queue uses SQLite project/history strings. RoomRepository already validates bounded models, reconciles proposals and exposes 3D review. We retain those semantics and replace durable full-document copies with immutable references, per-item content versions and revision deltas. SQLite remains the existing local installation store for this bounded slice, with one atomic transaction for accepted head, request decision and retained review evidence. This does not select a hospital-scale storage engine or add a speculative database adapter. The PostgreSQL investigator works separately on the measured large-installation publication path.

## Shared contract and ownership

`RoomRepository.persistence()` exposes its existing validated, deeply frozen document. `demo/versioned-project-contract.ts` fixes the synchronous shared-connection store contract. `VersionedProjectStore` will be exported from `demo/versioned-project-store.ts` and accept the queue's `DatabaseSync`. It stores immutable item bodies, parent-linked revision changes and metadata/reference manifests. Repeated put is idempotent; publish is a CAS pointer update. It must preserve branches, reviews, source bindings, entity order and portable revision hashes on reconstruction. No unchanged membership copy per revision. Compound writes use savepoints or the caller's transaction; no accepted head may survive a failed ticket/receipt write.

- #163 owns `demo/versioned-project-store.ts` and focused tests. No shared file edits.
- #164 owns `demo/change-requests.ts`, `demo/server.ts` and affected queue/server/reconciliation/source-request tests. It performs a validated atomic migration and replaces stored project/base/result histories with references. An async open/factory may replace synchronous constructors; migrate all callers in its scope rather than preserve duplicate APIs.
- #165 owns `demo/room-app.ts`, `demo/room-store.ts`, `demo/index.html`, `demo/room.css` and focused new browser/client tests. Server state is authoritative. Existing browser bytes remain recoverable during safe transfer; a browser cannot overwrite an existing accepted head.
- #162 owns the publication investigation report and narrow diagnostic only. No fourth full admission or existing database mutation; coordinator grants any disposable measurement lease.
- Coordinator owns this contract, `src/room-model.ts`, package test wiring, cross-slice integration tests, isolated server orchestration and final UI verification.

## HTTP contract

All existing host/origin, size, source and permission guards remain. New routes use the same controls. Successful JSON shapes:

- `GET /api/projects` -> `{ projects: ProjectSummary[] }`, maximum 32.
- `POST /api/projects` body `{ project: string }` -> `{ project: string }`. Validates/registers a new project or returns an already registered authoritative project with the same identity/root. It cannot replace an existing accepted head with browser state. Mismatched identity/root is 409. Repeating a valid import is idempotent.
- `GET /api/projects/:projectId` -> `{ project: string }` or 404.
- `GET /api/projects/:projectId/history?before=<revisionId>&limit=20` -> `ProjectHistoryPage`; limit 1..50, cursor excludes that entry and is project-bound. Unknown project/cursor is refused.
- Existing submit/review/decision routes keep their wire shapes. Runtime projections may still contain a bounded portable document; persisted request bases/results contain only immutable references. Rejected or failed work cannot advance the accepted head.

History exposes only the accepted main ancestry, never labels a pending proposal accepted. `recordedAt` is when this store recorded an entry; imported history must not invent an original acceptance timestamp. Keep responsive 3D review and existing backlog grouping.

## Done predicate and evidence

Server-container tests must prove stable identities, changed-only storage, reconstruction, two independent proposals accepted in either order, true semantic conflicts refused, invalid/stale/forged decisions refused, atomic migration/failure rollback, idempotent replay, cancellation fencing and accepted/backlog/review recovery across restart. Test bounded history paging and no cross-project leakage. Preserve the existing 256 KiB/array bounds and engineering validators; portable projection/hydration remains a bounded house operation, not a hospital working-set API. Native geometry ownership stays with its separate proposal; no empty Rust service is introduced.

The coordinator tests the combined server UI with an isolated disposable project, retaining before/after model and review evidence. Builds/tests run only in server containers. Draft PRs only; no merge, live preview deployment, accepted-model mutation or hospital qualification claim. User's earlier file-count waiver remains applicable. Concurrent coding is allowed; database measurements require an exclusive recorded slot.
