# Project evidence ledger (#199)

Child of [#197](https://github.com/Frederik91/bim-forge/issues/197), stacked on
`feature/issue-197-synthetic-pilot`. Initial baseline was `d914ab4`; the final
qualification uses parent `40b207c` plus owned commits `fe17f9e` and `46e36db`.
Storage changes require human
review. This slice owns evidence domain/storage, existing source retention and
their tests. The parent owns queue, native review fields, server, ScriptBox, UI
and package integration.

## Plan and ownership

1. `src/model-evidence.ts`: exact bounded schemas, typed claims, immutable anchors
   and serializable review read sets using the actual `ModelParameterValue` union.
2. `demo/request-source-store.ts`: explicit project retention in the existing byte
   authority, extending both expiry protection and read eligibility.
3. `demo/project-evidence-store.ts`: append/CAS/receipts, indexed pages, immutable
   review pins and private dependency closure on the caller's SQLite connection.
4. The corresponding three test files: deterministic synthetic fixture admission,
   source integrity, conflict/correction/absence, rollback, restart and bounds.
5. Server `npm run validate`, bounded focused tests, source hashes, this inspectable
   provenance delta, and a child draft PR. No accepted geometry or scenario heads
   belong to this store.

## Public seam

`src/model-evidence.ts` exports `EvidencePinSchema`, `EvidenceAnchorSchema`,
`EvidencePropertySchema`, `EvidenceAssertionSchema`, `EvidenceEntrySchema`,
`EvidenceSubjectSchema`, `EvidenceReadSetSchema` and their corresponding types.
It also exports `parseEvidencePin`, `parseEvidenceEntry`, `parseEvidenceReadSet`,
`normalizedEvidenceValue`, `evidenceCanonical`, `evidenceDependencies` and the
`MAX_EVIDENCE_*` constants. It has no Node imports or Buffer dependency; native
review/browser contracts can use its parsers.

Proposal-local choices also export `EvidenceUseSchema`, `EvidenceUsesSchema`,
`EvidenceUse`, `parseEvidenceUses` and `evidenceSubjectKey` from this module.
`EvidenceUse` is `{pin: EvidencePin, subject: EvidenceSubject, rationale: string}`.
`subject` is an exact frozen read-subject descriptor. The rationale must contain
non-whitespace text and at most 4096 characters. The array admits at most 32 uses,
with one choice per logical project/entity/property-definition, independent of
revision, body hash or value kind. The parser copies plain data and rejects
duplicate choices without needing database access.

`EvidencePin` is `{entryId, hash}`. An entry contains `{id, anchor, property,
predecessor, assertion}`. Anchors contain `{projectId, revisionId, entityId,
bodyHash, target: DesignTarget}`; properties contain `{definitionId, valueKind}`. Measured, observed and
documented values require verified project-retained source citations. Inferences
require rationale and pinned basis entries; assumptions require rationale and
may state an empty basis. Unknown assertions carry a reason. Resolution entries
name the original candidate IDs, selected candidate and rationale. Their selected
claim keeps its original provenance kind.

`demo/project-evidence-store.ts` exports `ProjectEvidenceStore`,
`EvidenceBundleClosure`, `StoredEvidence`, `EvidenceReviewReadiness`,
`EvidenceReviewContext`, `EvidenceContextIssue`, `evidenceHash`, `evidenceAnchor`,
`evidenceApplicable`.
The hashes use SHA-256 over the existing native canonical entity-body preimage.

```typescript
const evidence = new ProjectEvidenceStore(queueDatabase, existingSourceStore);
// Explicit source admission; upload UUID, manifest and bytes stay unchanged.
existingSourceStore.retainProject(projectId, originalSource);
const pin = evidence.append({ repository, commandId, actor, entry });
const readSet = evidence.freezeReadSet({ repository, revisionId, target, pins: [pin], subjects });
evidence.pinReadSet({ requestId, readSet });
// Parent acceptance transaction, after asynchronous work and target/ticket fences:
const readiness = evidence.verifyReadSet({ repository, readSet });
// Publish accepted geometry only when readiness.ready and other parent guards pass.
```

Other methods: `get({projectId,pin})`, `page({projectId,after?,limit?})`,
`readPinned({projectId,requestId})`, `bundleClosure({repository,pins})`.
`RequestSourceStore.retained(projectId,sourceId)` returns private verified metadata;
existing `get` and `prepare` can read retained original bytes after upload expiry.

`RequestSourceStore.projectPage({projectId, after, limit?})` returns
`{sources: RequestSource[], next: string | null}`. `after` is `null` for the first
page or the previous page's `next` UUID. `limit` defaults to 20 and must be an
integer from 1 to 20. Sources are ordered by ascending lowercase UUID, with an
exclusive cursor. A terminal or empty page returns `next: null`. Reusing a cursor
repeats the same page while retained membership remains unchanged. New retention
before the cursor appears on a refreshed first page; this is not a frozen export.

Only explicit project-retained uploads appear, including after upload expiry.
Request membership alone does not make an upload a project-library item. A
non-null cursor must have valid upload UUID syntax and belong to this project's
retained membership. Malformed, absent, unretained and foreign-project cursors
all fail with `Invalid project source page cursor.` The query uses the composite
`(project_id, source_id)` retention index, a metadata-only join and at most
`limit + 1` rows. Each returned manifest is parsed independently, so the request
attachment count and byte-aggregate limits do not truncate metadata discovery.
Listing never selects BLOBs or runs preparation/content verification. Existing
retention, `retained`, `get` and download paths still verify original bytes.
The parent calls this API through its queue, without querying source tables.

Append checks canonical payload and actor receipts before predecessor CAS or
anchor freshness. An identical committed command can replay after a correction
or after the original revision becomes unavailable. Changed payload/actor is
rejected. Corrections append with an exact predecessor ID/hash and cannot fork
an already-corrected predecessor. Savepoints join caller rollback, including
source retention, entries, command receipts and request pins.

Freeze includes candidate-set signatures for each relevant entity/property,
including empty sets, all candidate entry hashes, verified source hashes/metadata
and anchor applicability. It adds the subjects in pinned dependency closure;
it queries relevant indexed candidate sets rather than hydrating all project
facts into each request. Dependency closure can reach the 256-entry bound. A competing value or
contrary resolution blocks readiness. Resolutions must cover every current
active value candidate. Adding another contradiction invalidates the old set;
unrelated entity/property facts do not. Metres/millimetres and
seconds/minutes/hours compare in normalized units without rewriting originals.

Anchors require `target: DesignTarget`; read sets require
`target: WritableDesignTarget`. These schemas import the parent's pure
`src/design-target-contract.ts`, which has no repository dependency. Parsers do
not infer a target for unbound data. `evidenceAnchor(repository, revisionId,
entityId, target?)` and `freezeReadSet({..., target?})` default helper calls to main.
No live evidence data needs a migration.

Verification derives the current authoritative target head with
`repository.freezeDesignTarget(readSet.target)`. A private walker reads validated
native `persistence().designTargets` metadata. It follows at most 32 unique refs:
the requested target head, its immutable baseline, the baseline's parent target
capped at `baseline.from.revisionId`, and the parent's baseline chain to main.
Cycles, missing refs and invalid ancestry fail. Baseline-tagged anchors match
their exact immutable pin. Mutable-target anchors must be ancestors of their
permitted target head/cap, with an original valid body matching the pinned read
revision's entity body. Sibling target labels remain separate at a shared root
even when entity bodies are equal. Candidate signatures and source checks omit
ineligible sibling/future-parent claims. Explicit consumed dependencies remain
verified. The store reads native authority without owning any target heads.

This is not an exact-revision-only filter. A same-target claim anchored at R2
after an unrelated bed change still invalidates a chair read set frozen at R
when the chair body is unchanged. Inherited parent claims after an immutable
fork cap remain excluded. Parent native review also binds `evidence.target` to
the request target and enforces publication/cancellation fences.

Superseded consumed root pins and inference bases fail readiness even after a
fresh read-set freeze. Historical predecessor/resolution entries stay available
in complete bundles without becoming consumed facts. Unknown required pins and
bases also fail; historical unknowns behind an explicit correction do not
independently block its corrected value.

## Proposal-local choices for human review

Strict `verifyReadSet` retains conflict refusal: a known unresolved value conflict makes
it return `ready: false`. The separate
`verifyForReview({repository, readSet, uses})` returns
`{ready, reasons, warnings}`. It first checks exact signature freshness, complete
source/dependency validity and anchor applicability through the shared private
validation code. Issues have typed classifications; review policy does not match
human-readable error text.

A proposal may explicitly choose one current active applicable value claim for
an unchanged known conflict. Its exact ID/hash must be a root pin in the frozen
read set, and its logical subject must match the declared frozen subject. Each
acknowledged conflict becomes a warning containing the selected entry, subject
and rationale, with an explicit human-approval requirement. Both original claims
and the global conflict remain unchanged. This does not append a resolution or
promote an assumption to a measured, documented or accepted fact.

New candidate entries after freeze, changed absence signatures, unknown required
facts or inference bases, missing/corrupt sources or entries, invalid anchors,
conflicting resolutions, inactive/replaced selections, wrong hashes/subjects and
duplicate logical choices still fail. Conflicting active resolutions also fail
when they cover only a subset of current candidates. Blocking failures return
no assumption warnings. Empty uses follow strict conflict behavior.

The parent hashes and displays `nativeReview.evidenceUses` before native review
creation, then calls this review policy in its acceptance transaction alongside
target/ticket/cancellation fences. Human approval remains the authority. This
slice does not edit native review types, guest output, the queue or model-script.

## Bounded evidence input for proposal generation

`reviewContext({repository, readSet})` returns `EvidenceReviewContext`:
`{entries: StoredEvidence[], readSet: EvidenceReadSet, sources: RequestSource[],
issues: EvidenceContextIssue[]}`. These response types are exported from
`demo/project-evidence-store.ts`. `StoredEvidence` contains `{entry, pin}`.
Issues distinguish `value-conflict`, `unknown-required` and
`conflicting-resolutions` with messages and subject/entry identity.

The method validates exact unchanged read-subject signatures, source integrity,
dependency closure and anchor applicability. It includes every applicable
competing claim for the frozen subjects, even when that claim is not a root pin.
Pinned dependencies and the visible competitors' correction/basis/resolution
dependencies are complete. The parent does not enumerate project pages or query
candidate tables. Known conflicts, unknowns and contrary resolutions can appear
as generation data, while `verifyReadSet` and `verifyForReview` retain their
separate acceptance policies. A chosen use still needs an exact root pin; context
discovery does not expand the frozen read set or confer acceptance authority.

The full response has hard limits of 32 entries and 64 KiB serialized UTF-8,
including read-set and authorized source metadata. The domain exports
`MAX_EVIDENCE_CONTEXT_ENTRIES` and `MAX_EVIDENCE_CONTEXT_BYTES`. Oversized context
throws `Narrow evidence context` with the exceeded limit; no candidate is
silently omitted. Missing/corrupt dependencies, invalid anchors or changed
membership also fail. Raw source bytes are never included. Original files stay
on the existing private source-input path; the parent may pass entries and the
read set to `ModelProposalOptions.evidenceContext`.

Closure returns pinned entries, correction/basis/resolution dependencies,
authorized original-source metadata, and explicit missing dependencies. It
never includes raw source bytes. A portable native document by itself cannot
claim private evidence/source completeness. A private restore needs these
dependencies and existing source authority; no second blob store was introduced.

## Bounds

The project admits 256 immutable entry bodies, at most 16 KiB UTF-8 each and
4 MiB total. Receipts/pins/SQLite indexing overhead are separate storage. Request
read sets admit 32 root pins and at most 32 distinct subjects including dependency
closure. Pages use indexed sequence cursors with a maximum of 20 entries.
Closure traverses at most 256 entries from at most 32 roots. Native portable
document limits and all original MIME, privacy, decoder and source quotas remain.

## Inspectable before/after

The test `retained synthetic evidence survives request expiry and exposes an
inspectable provenance delta without changing geometry` admits the generated
plan through real source validation. Fixture source descriptors are inputs,
not authoritative surveyed evidence. The source SHA-256 is computed from the
admitted bytes and checked again on every retained citation read.

```text
Before: no retained project claims; accepted native snapshot = fixture snapshot
After source retention: same upload UUID + manifest + original bytes, no request binding
After claims:
  survey      measured  geometry-thickness = 0.15 m  -> retained synthetic plan
  assumption  assumed   geometry-thickness = 0.20 m  -> explicit rationale
  readiness = false: unresolved same-subject/property contradiction
After explicit resolution:
  resolution candidates=[survey, assumption], selectedEntryId=survey
  readiness = true for a newly frozen set; both original claims remain unchanged
After expiry/restart: original bytes, claims, receipts and immutable request pins survive
Native model delta: entities {added:[],removed:[],modified:[]}
                    relationships {added:[],removed:[],modified:[]}
```

Other tests assert unknown-to-observed correction, inference-basis conflicts,
absence invalidation, source/cross-project/body failures, contrary resolutions,
two-connection predecessor CAS, receipt failure rollback and replay with the
original revision missing. No claim automatically becomes accepted model data.

## Qualification ledger

User authorization allows ten total attempts for this interactive item only;
global policy and human merge review remain unchanged. No local tests/builds,
package installs, image builds, root npm writes, pruning, live state, credentials,
automations, merging, deploying or issue closing were used.

| Attempt | Server slot/container | Result | Failure/root cause and next action |
| --- | --- | --- | --- |
| 1 | `residential197/evidence199-1`, `bim-evidence199-a1` | root validate; 22/22 focused tests | No failure. Review strengthened the lost-anchor receipt proof, browser-safe parser boundary, native kinds, resolutions and exact byte bounds. |
| 2 | `residential197/evidence199-2`, `bim-evidence199-a2` | root validate; 27/27 focused tests | No failure. Qualified the initial evidence implementation at `aa7104c`. |
| 3 | `residential197/evidence199-3`, `bim-evidence199-a3` | root validate; 28/28 focused tests | No failure. Added bounded retained-source metadata discovery. SQLite authorizer denied BLOB reads during listing; paging, isolation, cursor guards, expiry/restart and original integrity checks passed. |
| 4 | `residential197/evidence199-4`, `bim-evidence199-a4` | root validate; 39/39 focused tests | No failure. Qualified explicit proposal review choices with strict conflict refusal unchanged. |
| 5 | `residential197/evidence199-5`, `bim-evidence199-a5` | root validate; 43/43 focused tests | No failure. Qualified bounded complete generation context and exact32-entry/64KiB boundaries. Independent review then required consumed-pin supersession and target-lineage hardening before final handoff. |
| 6 | `residential197/evidence199-6`, `bim-evidence199-a6` | root validate failed; 48/48 focused tests passed | TS2741: borrowed native fixtures in `src/design-targets.test.ts` and `demo/versioned-project-store.test.ts` lacked new required target fields. No owned-code or test failure. Parent supplied fixture-only fix `40b207c`; no validator was changed. |
| 7 | `residential197/evidence199-7`, `bim-evidence199-a7` | root validate; 85/85 tests | Passed after rebasing on parent `40b207c`. Includes all 48 evidence/source tests and 37 native target/store tests. Superseded consumed roots/bases, shared-root sibling claims/resolutions, irrelevant corrupt sibling source, unchanged-read freshness across unrelated edits, R2 new-fact invalidation and baseline inheritance/caps passed. |

All slots are under `/ssd1/bim-forge-qualification/`. Clean source snapshots use
the `d914ab4` archive for attempts 1/2, `aa7104c` for attempt 3 and `85cc5c2` for
attempts 4/5, plus owned-file overlays. Attempts 6/7 use full clean committed
archives; final archive is `46e36db` on parent `40b207c`. Mounts are read-only. Dependencies:
`/ssd1/bim-forge-qualification/all-ready-195/final/dependencies`, read-only. Image:
`bim-qvm-tools:20261025`, ID
`sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`.
Containers: network none, 1 CPU, 2 GiB memory/swap maximum, read-only root and
SSD-backed `/tmp`/npm cache. Validate timeout 180 s; focused test timeout 120 s,
one test process at a time, per-test timeout 60 s.

```sh
npm run validate
node --test --test-concurrency=1 --test-timeout=60000 \
  src/model-evidence.test.ts demo/project-evidence-store.test.ts \
  demo/request-source-store.test.ts src/design-targets.test.ts \
  demo/versioned-project-store.test.ts
```

Final validator/test output:

```text
Strict TypeScript valid. 255 source file(s) checked.
> tsc --noEmit
Policy valid. 0 changed file(s) checked.
tests 85; pass 85; fail 0; cancelled 0; skipped 0; todo 0
VALIDATE_EXIT=0; FOCUSED_EXIT=0
```

The standard root validate policy command does not pass changed paths; its
reported zero is preserved above. The final diff against parent `40b207c` has
five owned paths, outside the policy denylist. Borrowed parent/core commits are
upstream dependencies, not issue-owned edits. `git diff --check` also passes.
Logs/manifests are retained in each server slot and local `artifacts/private/`.

Attempt 2 archives (SHA-256), retained for the initial implementation:

```text
99703cf0cc631276c43169a75423e0b354dd0e17cce3f273e41d9246545a938b source-base.tar
71291b7e311563a42e676b704cf3fe16e366e9edf877596b53e9dcf2050ede0f evidence199-overlay-a2.tar
```

Attempt 3 archives (SHA-256):

```text
e92148f068697b0918b8e85ab61fce1c3b5e18aa0c6b0bab4c132edc261af888 source-base-a3.tar
601dfe6e8307d3b048ff0d46a16dea1beb0cbac9eee5f5f4accba3f8025aa228 evidence199-overlay-a3.tar
```

Final attempt 7 source archive (SHA-256):

```text
67eb63c6b2e8a0fca77661e0eb3d39c5f80cf750af7b298af921922ca53db335 source-base-a7.tar
```

Final qualified source files (SHA-256, exact bytes):

```text
e06e292145fd80990af386948cdb0f8a0f352ea6bdefa919138db8bfd0c66e5a src/model-evidence.ts
474074054fb82008b088354f759631439b724c3a28cb0b95b66b7f42f7aaba59 src/model-evidence.test.ts
a0fcef21f7f84e0177fd19b9c196f4e462181f2a7dd06088ac5b115589e1a8b0 demo/project-evidence-store.ts
4cbe99df27d72ff6988e0cfa289c95b1cf75cb3a29f91bae4659cdc71009c75b demo/project-evidence-store.test.ts
345f8cf19d1ac77755c81c98abdb1e7666402c490b41edc9117a2e5f430c1d35 demo/request-source-store.ts
cb0cb01105fc20ffc9d829bbdad6ded04f82ef1d709ada0f769e4d70ab862c4a demo/request-source-store.test.ts
```

The source-discovery commit `85cc5c2` is already integrated by the parent. Final
owned code commits are `fe17f9e` (schemas) and `46e36db` (review policy/context and
lineage/supersession fixes), rebased onto parent `40b207c`; earlier shared local
IDs `12fe44c` and `e7d0f91` contain equivalent owned patches. The final proof-note
commit changes documentation only; the six code/test hashes above remain exact.
Seven of ten total attempts were used. Attempt 6's known dependency failure was
resolved by the parent fixture patch; final validators and all 85 tests pass.

Parent integration still owns `nativeReview.evidenceUses` hashing/display,
native target-equality guards and guest/queue/server/UI wiring. The parent
independently qualifies those callers, package registration, browser/full-suite
behavior and private-bundle import. This proof covers the domain/store and
borrowed native target/store tests without claiming the combined UI workflow or
engineering-survey qualification.
