# Native design target authority

Issue [#201](https://github.com/Frederik91/bim-forge/issues/201), integration
[#197](https://github.com/Frederik91/bim-forge/issues/197). Builds on the selected
[synthetic residential architecture](synthetic-residential-197.md).

## Authority and immutable data

`RoomRepository` owns accepted main and alternative heads. Baselines pin an
accepted revision and its source target; forks share that immutable revision.
Neither capture nor fork duplicates geometry or creates a project. A baseline
cannot supply writable authority. Alternative identities and baseline origins
are immutable across publication.

Portable envelope version 3 adds `designTargets` with baselines, alternatives and
frozen proposal bindings. Optional native review evidence uses the committed
`EvidenceReadSet` schema/parser from #199. The core validates exact project/base
revision binding and subject projects; it does not access evidence storage.
When evidence is present, the portable envelope declares `externalDependencies:
{ evidence: "external", sourceBytes: "external" }`. Native exports retain pins and
read sets, while evidence/source bytes remain external dependencies. Geometry revision hashes remain SHA256 of the original
canonical `{ version: 1, parentId, snapshot }` preimage. Untouched v1/v2 documents
retain their serialization and original review preimages. Legacy readers reject
v3. Capturing a baseline upgrades the envelope without rewriting legacy reviews.

Each explicit proposal binds `{ projectId, target, revisionId }` before AI work.
`from` must match that frozen revision. New v3 proposal creation requires the
binding and a current head; navigation cannot change it. Pending proposals can
later reconcile unrelated changes on the same target through the existing merge
and engineering validators. Target-local accepted ancestry proves acceptance on
restore; a pending review plus external status cannot advance a native head.
Supersession applies only to the selected target. Human actor and decision ID
are retained exactly. Queue command receipts remain the integration owner's job.

## Small integration surface

`src/design-targets.ts` exports descriptor-safe parsers and the discriminated
`DesignTarget`, `WritableDesignTarget` and `FrozenDesignTarget` types. Baseline
refs are excluded from writable target parsing. Inputs reject accessors without
executing getters, using the existing plain-data boundary.

The repository exposes `freezeDesignTarget`, `captureBaseline`, `forkAlternative`,
`designTargets` and `designView`. The view returns the selected immutable
snapshot, baseline revision and inspectable delta for the existing single viewer.
`propose`, `proposeLayout` and `proposeReviewedModel` accept a frozen `target`.
`proposalSnapshot(proposed, name, target)`, `accept(name, decision, target)` and
`acceptFrom(proposed, name, decision, target)` verify its exact original binding.
Existing legacy calls remain valid for legacy proposals.

`proposeWallShift({ name, from, target, shift, review })` returns
`{ repository, impacts, delta }`. It delegates all geometry work to
`previewWallShift`; impacts distinguish changed stored bodies from evaluated
dependencies. Existing frozen scope validation requires write authority for the
wall and changed spaces, plus other changed stored items. Context stays read-only.

## Atomic persistence

`VersionedProjectStore` retains changed-only entity/revision/review storage and
the caller's SQLite connection. Savepoints participate in the outer queue
transaction. Staging `put` never publishes heads.

`publish` retains mandatory document CAS. V3 also requires a writable `target`
and `expectedTargetRevisionId`; accepted publication checks the exact native
request/decision and one-step target ancestry. Publication preserves existing
review evidence, historical decisions, sibling heads and baseline pins. Target
history keeps decisions separate even when immutable revision geometry is shared.
`acceptedHead(projectId, target?)` and `history({ ..., target? })` default to main.

`publishMetadata({ projectId, expectedDocumentId, reference })` is the separate
baseline/fork operation. It allows only admitted new immutable refs and initial
fork heads, preserving all geometry, branches, reviews and existing heads. It
creates no geometry history row. Parent queue receipts describe metadata commands.
History traverses inherited baseline ancestry without fabricating metadata edits
as geometry imports. Private portable import reconstructs native accepted reviews.

Existing bounds remain: 100-item arrays, 32 revisions/branches, 31 reviews, 256 KiB
portable documents and existing script/review limits. No global policy changes.

## Ownership and evidence boundary

This slice owns native targets and the versioned model store. The parent owns
queue/HTTP/ScriptBox/UI/package integration, dispatch and receipt semantics. #199
owns the evidence schema (inherited commit `aa7104c`, cherry-picked here as
`c66aed5`). This branch imports that schema directly. The parent freezes read sets
from its authoritative store before AI, passes them into reviews before hashing,
and verifies host freshness in the acceptance transaction. This slice defines no competing evidence type and makes no claim
that evidence/source closure or the combined UI workflow is qualified.

Geometry and storage changes require human review; the child PR is a draft.
No merge, deployment, live-model mutation or issue closing is part of this slice.


## Pre-evidence qualification receipt

The pre-evidence implementation passed on attempt five of ten total attempts.
The subsequent evidence extension requires new qualification below. No local test or build ran. Pre-evidence
source baseline: `d914ab41210a97966d715dfeab58d2c69064f832`. Server slot:
`/ssd1/bim-forge-qualification/residential197/scenarios201-5`; container
`bim-scenarios201-a5`, image
`sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`.
The container used network none, 1 CPU, 2 GiB memory/swap limit and read-only
source/dependencies from `all-ready-195/final/dependencies`. Own SSD temporary
SQLite fixtures only. No root npm writes, installs, image builds or pruning.

Source archive SHA256:
`f9eca7adf749aa1f7c62c823c173aae90e93723af712743d30a34bbda5c32f57`.
The server verified 747 source-manifest file hashes before execution. Raw output
is retained in that slot's `results/validate.log` and `results/tests.log`.
This result section was added afterward; executable sources/tests match the
qualified bytes below.

```text
npm run validate
Strict TypeScript valid. 247 source file(s) checked.
tsc --noEmit
Policy valid. 0 changed file(s) checked.

node --test --test-concurrency=1
  src/design-targets.test.ts src/room-model.test.ts
  demo/versioned-project-store.test.ts src/wall-dependencies.test.ts
  demo/change-requests.test.ts demo/proposal-reconciliation.test.ts
  demo/versioned-house.test.ts demo/scoped-house.test.ts
  src/model-scope.test.ts src/model-scope-contract.test.ts
tests 158; pass 158; fail 0; cancelled 0; skipped 0
```

| Attempt | Result and cause |
| --- | --- |
| 1 | Container start failed before validation: missing nested dependency mountpoint inside read-only source. Added an empty source/node_modules directory on SSD. |
| 2 | All 88 focused tests passed; root typecheck caught fallback main-target literal widening. Added an explicit WritableDesignTarget annotation, no cast/suppression. |
| 3 | Root validate and 91 focused tests passed. |
| 4 | Adjacent callers: 64/65 passed. Early history-cap refusal changed the legacy error category. Restored Unsupported saved project while preserving caps, refusal and rollback; no validator/test weakening. |
| 5 | Root validate and combined 158 tests passed, including hash-valid pending-review bundle forgery and identical sibling geometry with distinct review decisions. |

| Qualified file | SHA256 |
| --- | --- |
| `src/room-model.ts` | `bc2e67f1dad006a1d91228862263a8d44fa65115adb1c92132124580dffb036c` |
| `src/design-targets.ts` | `a4ae83f5f71ae95cd8323ba30f9f85f1a6c1141ee9b54885c2e1ae123e097a9e` |
| `src/design-targets.test.ts` | `3892c8f7a4359dc1fce964012d5661a49c30d90915e94e3d75d0b8ecd21b5858` |
| `demo/versioned-project-contract.ts` | `b6cc7e7e09db412165cbcb738a03970c13e5d4080d7990bc50bae9e558a2230c` |
| `demo/versioned-project-store.ts` | `91f5a3fb5fd8d79ca87af9b30b28ced504157e6912050bdeb3b9698f3789ee4c` |
| `demo/versioned-project-store.test.ts` | `be4b6576e0ae092ef702fa76381bdd657f26984519a9699cb8ae04656a90d330` |


## Evidence-extension qualification receipt

The explicit parent handoff added optional native evidence read sets using the
inherited #199 component `aa7104c` (local cherry-pick `c66aed5`). That component's
seven files are inherited and unmodified by the #201 implementation. The #201
follow-up changes only native review parsing/persistence, its own tests and this
document. The accepted geometry hashes and absent-evidence legacy review
preimages remain unchanged.

Attempt 6: root `npm run validate` passed, with strict lint covering 251 source
files, `tsc --noEmit` passing and policy valid. All 189 focused/caller tests passed
with zero failures, cancellations or skips. The previous ten focused files were
joined by `src/model-evidence.test.ts`, `demo/project-evidence-store.test.ts` and
`demo/request-source-store.test.ts`. No test or validator was weakened.

Server slot `scenarios201-6`, container `bim-scenarios201-a6`, same image,
resources, isolation and read-only dependency mount as above. Source archive
SHA256: `5d9965390b0c1a212ce3ac7dc7b8e1392ecec100ae598e915004afba2415fc61`.
All 752 manifest file hashes were verified on the server before execution. Logs
remain in the slot's `results/validate.log` and `results/tests.log`. Six of ten
attempts used, including earlier infrastructure/typecheck/error-category failures.
Only this result documentation was updated after the passing run.

```text
Strict TypeScript valid. 251 source file(s) checked.
tsc --noEmit
Policy valid. 0 changed file(s) checked.
tests 189; pass 189; fail 0; cancelled 0; skipped 0
```

Evidence-bearing native exports preserve pins/read sets and explicitly declare
`externalDependencies: { evidence: "external", sourceBytes: "external" }`.
Dependent new acceptance still needs the parent's authoritative evidence/source
closure and transactional freshness checks. Native restore alone does not claim
those external bytes exist.

| Final qualified file | SHA256 |
| --- | --- |
| `src/room-model.ts` | `808d72e4a27241ebd9bc89324847641cde26b57d48b48ad2cdac800b6da45f60` |
| `src/design-targets.ts` | `a4ae83f5f71ae95cd8323ba30f9f85f1a6c1141ee9b54885c2e1ae123e097a9e` |
| `src/design-targets.test.ts` | `45584725b5bf091a4527bbc397b0175497ea1bb71905255cbcae24b6a13280a5` |
| `demo/versioned-project-contract.ts` | `b6cc7e7e09db412165cbcb738a03970c13e5d4080d7990bc50bae9e558a2230c` |
| `demo/versioned-project-store.ts` | `7225f0701a39736c7668cefb08c7ad470fc1a5701f6be27a0b5854a7ca40c001` |
| `demo/versioned-project-store.test.ts` | `cdb556fb8be0b53a50df86a63157328b643afa2c21c3908c1766cda5ebb59a8b` |
| `src/model-evidence.ts` | `1f4d8c8919c70c37deb3a1a8d2a805494f7ca85ce1490bb4da3bfcc56e5cbbaa` |
