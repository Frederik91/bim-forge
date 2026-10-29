# Geometry reads and proposal evidence

Child [#233](https://github.com/Frederik91/bim-forge/issues/233) of [#230](https://github.com/Frederik91/bim-forge/issues/230).
Exact initial base: `f4285c644e52b5bdba8e4f6afeb6e099bc02b891`.
This component is **unqualified source**. No build, compiler, test or container ran while the server was unavailable.
Human review remains required for geometry, storage and security changes. No merge or deployment is authorized here.

## Ownership and source

The component owns `src/model-script.ts`, `src/model-proposal.ts`, review parsing in `src/room-model.ts`,
evidence plumbing in `demo/change-requests.ts`, the new `src/geometry-evidence*` modules and their queue tests.
It changes no parent server/UI/viewer/package mount, geometry kernel, converter or linked revision store.
`VersionedProjectStore` already content-addresses the complete review body, so it needs no evidence-specific edit.

`geometry-evidence-api.ts` is the single ScriptBox registration metadata source. It imports #231's wire schemas,
derives capabilities and documentation from its four definitions, and reads structural limits from those schemas.
The guest uses `geometry.describe`, `geometry.query`, `geometry.relations` and `geometry.measure` for both source kinds.
An explicit initial `selectedObjectIds: []` means no native anchor in project/design context. Supplied native IDs still require existence,
uniqueness and valid syntax; frozen design/scope/write checks are unchanged. A prior nonempty selection whose anchors all disappeared
becomes `needs-input` and cannot silently rebase to an empty selection. A fresh chat must deliberately establish a new context.
Host-only context projection, source storage, linked writes and native acceptance are absent from that namespace.
`geometry-evidence-contract.ts` contains browser-safe parsing and Web Crypto digest validation. `room-model.ts` imports only
that contract; Node workers and host orchestration cannot enter the browser bundle through model restoration.

## Integration contract

```typescript
interface GeometryReadSnapshot {
  input: GeometrySessionInput;
  catalogToken: string;
  correspondences?: GeometryCorrespondence[];
}
interface GeometryEvidenceSource {
  snapshot(input: {
    projectId: string;
    native: GeometrySessionInput['native'];
    signal: AbortSignal;
    historicalRefs?: readonly Extract<GeometryRef, { kind: 'ifc' }>[];
  }): Promise<GeometryReadSnapshot>;
  withCatalogGuard<T>(projectId: string, catalogToken: string, commit: () => T):
    { kind: 'committed'; value: T } | { kind: 'catalog-changed' };
}
```

The parent supplies `ChangeRequests.open(file, worker, {geometry: source})`.
Standalone proposal preparation accepts `geometry: {source, current?}` where `current` reads the current native target input.
An optional host-only `geometry.inherited` carries authenticated evidence for an unaccepted private conversation draft.
The queue checks the original request/ticket/attempt body before inheritance. It copies original receipts and typed measurements,
deduplicates identical observations, records a bounded hash-linked `inheritedFrom` lineage, and revalidates/reseals the final follow-up
even when that worker makes no geometry calls. Missing origin or relevant stale geometry fails closed before a continuation can bind.
Completed accepted geometry is native baseline rather than an unaccepted private draft; unrelated later native requests do not reactivate
historical source constraints. Archived requests and their original source pins remain unchanged in either case.
The provider returns data and verified correspondence pairs. It does not create workers.
Revalidation extracts a bounded, deduplicated set of historical IFC references from trusted receipt object reads,
full query members, level/exclusion predicates, the host's implicit candidate exclusion and measured object subjects. The provider resolves only those retained versions,
rather than scanning every object in every version. Initial construction omits historical references; this resolver data never reaches the guest.
`GeometryEvidenceSession` owns the request worker; revalidation uses `validateGeometryReceiptsInWorker`.
The request worker lifetime is 180 seconds, with the geometry owner's separate startup/operation hard deadlines.

The provider must authorize the project, preserve all unavailable active source entries, and return an exact native input.
The native input contains the full private evaluation snapshot and target; `geometryNativeInput` derives `readableIds`
from frozen target/context/dependent IDs. Guest geometry never receives an unfiltered scoped native graph.
The independent final-candidate validation context uses the complete host-authorized native graph without returning its facts to the guest.

For linked data the parent maps #232's `snapshotCurrent` into immutable `GeometrySessionInput` data, reconstructs verified
historic/current identity correspondence from retained versions, and delegates `withCatalogGuard` to the linked store.
The real guard must reserve linked SQLite with `BEGIN IMMEDIATE`, compare the catalogue token, reject thenables,
execute the synchronous native transaction and release its reservation. Adoption and placement use that same source-owner reservation.
The fixture guard in these tests proves orchestration only; #232 and parent qualification must prove the cross-process database fence.

## Trust and persistence

The host automatically retains every geometry receipt and the typed request/result for each measurement.
The guest cannot supply geometry evidence in its decision, omit a consulted observation, or turn source text into approval.
Operation and result digests, project/request/base identity and the original final proposal snapshot digest are checked.

`ProposalReview.geometryEvidence` stores a bounded JSON string. `readGeometryEvidence` validates its separate schema,
64 KiB byte cap and internal receipt bindings. This representation preserves the native model's existing 100-item arrays
and 256 KiB portable-project limit. Large read sets can fail closed at those limits; this change does not qualify large models.

`request_geometry_evidence` authenticates the exact body against request ID, ticket ID and attempt in the queue database.
The reviewed portable body alone grants no freshness or execution authority. A missing, altered or stripped host binding blocks acceptance.
Historical reviews without geometry evidence retain their native behavior. A portable pending geometry review without its host attempt record
requires fresh hosted inspection. Already accepted imported native history remains native history.

`request_geometry_acceptances` records the catalogue token, reconciled candidate digest, independent final measurement receipts and typed final request/results
inside the same native transaction as the explicit decision. Original request source pins and review evidence remain unchanged.

## Freshness and final candidate

The host checks accumulated relevant observations before script dispatch, after asynchronous execution, during proposal sealing,
after native proposal creation, during queue binding and at explicit acceptance. Signal, session revocation, superseded request
generation and native document CAS remain fences against late results.

Queue binding and acceptance both revalidate outside database locks, then publish under the linked catalogue guard and native transaction.
A catalogue mismatch repeats semantic revalidation up to three times. It does not itself mean that geometry is stale.
Relevant geometry/transform/removal/query-membership changes fail; unrelated revisions can pass with verified identity correspondence.

Measurements retain their full typed predicates, including clearance distance and absence candidate sets. A guest box's `candidateId`
must identify a real final native object. The host independently measures that final authored shape against the original constraint,
then checks every physical object overlapping its host-evaluated candidate enclosure expanded by the kernel's declared numeric tolerance through exact kernel measurement.
The complete predicate includes newly added/moved-in objects; unlocated shapes and unavailable sources still prevent a certificate.
Distant open display surfaces outside that predicate cannot affect candidate intersection. Reconciliation runs the same checks against the actual merged native candidate.
A finite wall reference cannot hide a newly intersecting object elsewhere in the candidate's final surroundings.

Original observations are revalidated against the accepted current native context, separately from final-candidate constraints.
Final replay rebinds both endpoints and includes native members retained in a measurement query's full host receipt.
Explicit clearances apply to actual final shapes in either endpoint order, including original query members that leave the predicate.
Ordinary object distance/intersection probes retain their historical facts without requiring the authored object to stay at that pose.
Worker-produced full evaluated geometry digests identify changed native endpoints, including host/family/level effects; bounds and sampled faces cannot prove shape equality.
Only proposed boxes and changed physical native endpoints receive the additional surroundings check, so unchanged native wall joins do not become new constraints.
The describe receipt geometry projection is produced by #231 for every record with an evaluated shape, including opening voids.
Unknown source representation error is retained as unknown; numeric expansion does not claim source-error certainty.
Sequential comparison/replay/surroundings workers stay within the existing session cap.

Exploratory measurements remain in history. For each candidate and constraint the final replay checks the most recent trial;
a later corrected placement can supersede an earlier violated trial without deleting the failure.
Changing the predicate or requested clearance does not erase the earlier constraint.
Distance/intersection probes at an earlier box pose remain observations, rather than becoming conflicting final design constraints.
Explicit clearance predicates remain enforceable across pose changes; final-pose probes are replayed against the authored object.

The geometry owner's exact head `a7a8f3c76ee622141bdfda50c7e140c99fa91837` introduces certified `contact` using an exact supporting-plane
nonpenetration proof on closed prepared meshes. The surroundings check accepts only `separated`, `empty-set` and this certified `contact`.
Some coincident/coplanar cases still report `contact-or-overlap`; those and incomplete/open surfaces remain blocked.
No epsilon can waive penetration, and a positive requested clearance remains enforceable even when zero-gap support contact is certified.
Actual native slab support, distant open furniture, positive-gap rejection, `1e-10` linked slab penetration and coplanar open floor controls
are authored in the queue suite. These consumer assertions remain unrun; the parent owns runtime qualification.

## Authored evidence and qualification ledger

All assertions below are **unrun**.

| Requirement | Test source |
| --- | --- |
| Actual generated guest, one namespace, hostile source text, exact restoration | `src/geometry-evidence.test.ts` |
| Browser-safe restore digest validation rejects a modified measurement result | `src/geometry-evidence.test.ts` |
| Dispatch/bind races, relevant/unrelated source updates, removed source, new obstruction and empty-region membership | `src/geometry-evidence.test.ts` |
| Final native shape versus guessed guest box; corrected trial history | `src/geometry-evidence.test.ts` |
| Frozen scope, unchanged hosted Door bytes with moved world geometry, cross-project context and cancellation | `src/geometry-evidence.test.ts` |
| Alternative acceptance, unchanged Main/As-is, historical pins, restart and final acceptance receipts | `demo/geometry-evidence-queue.test.ts` |
| Ready-proposal source changes and catalogue update during pending acceptance | `demo/geometry-evidence-queue.test.ts` |
| Native reconciliation and independent unrelated native acceptance | `demo/geometry-evidence-queue.test.ts` |
| Authenticated private-draft continuation, review-only follow-up, relevant/unrelated source changes and preserved lineage | `demo/geometry-evidence-queue.test.ts` |
| Finite against-object loophole and missing host-authenticated evidence | `demo/geometry-evidence-queue.test.ts` |
| Both native endpoint orders, native query members, observational moves, actual final persisted distances and tolerance-expanded surroundings | `demo/geometry-evidence-queue.test.ts` |
| Real linked cross-process reservation, converter, app UI, connected agent and independent oracle | #232 / #234 / parent #230 |

No independent #233 qualification run has been started. The parent owns the serial server slot and combined attempt ledger.
Initial parent SSH/HTTPS probes timed out; connectivity subsequently returned. No local build/test substitute was used.
Parent combined attempt 2 at `256071ce2ec5581e468d69d21e03e459d4e755bf` passed strict lint over 314 sources, then failed TypeScript
before tests/builds. Its four #233 diagnostics were missing typed schema metadata access, an unbranded test request binding,
and a receipt-digest await inside the synchronous native state parser. Schema limits now use validated own data descriptors,
the test binding goes through the real request parser, and digest verification stays in the public async restore/proposal paths.
The synchronous storage-authority parser remains synchronous. Parent fixes its separate provider fixture constructor errors.
Exact red log: `/ssd1/bim-forge-qualification/issue230/run-256071ce2ec5581e468d69d21e03e459d4e755bf-component-02/artifacts/validate.log`.
These corrections have not been rerun; the parent will assign the next bounded qualification attempt.
Parent component 3 at `f6ef6f9edc4080c66d40c7502a7c1bbfc11fbdd6` subsequently passed root validation, explicit policy,
browser build, geometry 28/28 and linked revision 12/12. Evidence tests failed before bootstrap because the pinned ScriptBox package
does not support tuple `additionalItems`. A owns equivalent exact bounded-array canonical schemas; uniqueness is preserved pending upstream
ScriptBox issue 24 support. Component 4 at `aee595c` passed root validation, policy, geometry 31/31 and provider 3/3, without repeating
the blocked ScriptBox bootstrap. No independent #233 run occurred. The ignored `artifacts/private/issue233-contract-audit.ts` diagnostic
is prepared for parent execution, never evaluated locally; the parent retains all run logs and the ten-attempt budget.
Static verification performed: source/diff inspection and `git -c core.whitespace=cr-at-eol diff --check`.
The app worktree creation failed during Git configuration discovery; direct isolated Git worktree creation succeeded.
The shell profile initially reset relative paths to MacType; explicit non-login shell and absolute owned paths resolved it.
No source was edited in saved Main, parent integration or another worker checkout.
Static import review caught a Node-only worker import entering the browser through `room-model.ts`; the contract/host split fixes the dependency at its source.
This correction has not been confirmed by a browser build because build qualification is server-only.

Parent must register both new test files in the combined package and run, only in a new bounded network-off server container:

```sh
npm run validate
node scripts/validate-policy.ts --changed-files demo/change-requests.ts demo/geometry-evidence-queue.test.ts \
  docs/design/geometry-evidence-233.md src/geometry-evidence-api.ts src/geometry-evidence-contract.ts src/geometry-evidence.fixture.ts \
  src/geometry-evidence.test.ts src/geometry-evidence.ts src/model-proposal.ts src/model-script.ts src/room-model.ts
node --test --test-concurrency=1 src/geometry-evidence.test.ts demo/geometry-evidence-queue.test.ts \
  src/model-script.test.ts src/model-script-review.test.ts src/model-script-wall.test.ts src/model-script-dimension.test.ts \
  src/room-model.test.ts demo/change-requests.test.ts demo/versioned-project-store.test.ts \
  demo/proposal-reconciliation.test.ts demo/design-requests.test.ts
```

The policy invocation lists all eleven component paths. The parent must also check every path in the complete combined diff.
Retain exact source/image, command output, failing root causes and isolation receipts under a new `/ssd1` evidence root.
No draft PR is permitted before those mandatory checks pass. This handoff does not reopen exhausted worker218 qualification.
