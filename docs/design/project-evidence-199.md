# Project evidence ledger (#199)

Child of [#197](https://github.com/Frederik91/bim-forge/issues/197), stacked on
`feature/issue-197-synthetic-pilot` at `d914ab4`. Storage changes require human
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

`EvidencePin` is `{entryId, hash}`. An entry contains `{id, anchor, property,
predecessor, assertion}`. Anchors contain `{projectId, revisionId, entityId,
bodyHash}`; properties contain `{definitionId, valueKind}`. Measured, observed and
documented values require verified project-retained source citations. Inferences
require rationale and pinned basis entries; assumptions require rationale and
may state an empty basis. Unknown assertions carry a reason. Resolution entries
name the original candidate IDs, selected candidate and rationale. Their selected
claim keeps its original provenance kind.

`demo/project-evidence-store.ts` exports `ProjectEvidenceStore`,
`EvidenceBundleClosure`, `evidenceHash`, `evidenceAnchor`, `evidenceApplicable`.
The hashes use SHA-256 over the existing native canonical entity-body preimage.

```typescript
const evidence = new ProjectEvidenceStore(queueDatabase, existingSourceStore);
// Explicit source admission; upload UUID, manifest and bytes stay unchanged.
existingSourceStore.retainProject(projectId, originalSource);
const pin = evidence.append({ repository, commandId, actor, entry });
const readSet = evidence.freezeReadSet({ repository, revisionId, pins: [pin], subjects });
evidence.pinReadSet({ requestId, readSet });
// Parent acceptance transaction, after asynchronous work and target/ticket fences:
const readiness = evidence.verifyReadSet({ repository, readSet });
// Publish accepted geometry only when readiness.ready and other parent guards pass.
```

Other methods: `get({projectId,pin})`, `page({projectId,after?,limit?})`,
`readPinned({projectId,requestId})`, `bundleClosure({repository,pins})`.
`RequestSourceStore.retained(projectId,sourceId)` returns private verified metadata;
existing `get` and `prepare` can read retained original bytes after upload expiry.

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

An original exact revision/body and the selected revision's entity body must
both match for applicability. The same unchanged entity body can remain usable
at another revision; a changed/missing body cannot. Parent integration still
owns target-head freshness, authorization and which consumed properties must
be declared (including absent ones). Unknown pinned facts and inference bases
block readiness. Historical unknowns preserved behind an explicit correction
do not independently block its corrected value.

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
| 2 | `residential197/evidence199-2`, `bim-evidence199-a2` | root validate; 27/27 focused tests | No failure. Final six implementation/test files match the source manifest below. |

Both slots are under `/ssd1/bim-forge-qualification/`. Clean source snapshots use
the `d914ab4` archive plus owned-file overlays, mounted read-only. Dependencies:
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
  demo/request-source-store.test.ts
```

Final validator/test output:

```text
Strict TypeScript valid. 249 source file(s) checked.
> tsc --noEmit
Policy valid. 0 changed file(s) checked.
tests 27; pass 27; fail 0; cancelled 0; skipped 0; todo 0
```

The standard root validate policy command does not pass changed paths; its
reported zero is preserved above. All seven PR paths are within the explicit
ownership and outside the policy denylist. `git diff --check` also passes.
Logs/manifests are retained in each server slot and local `artifacts/private/`.

Final archives (SHA-256):

```text
99703cf0cc631276c43169a75423e0b354dd0e17cce3f273e41d9246545a938b source-base.tar
71291b7e311563a42e676b704cf3fe16e366e9edf877596b53e9dcf2050ede0f evidence199-overlay-a2.tar
```

Final qualified source files (SHA-256, exact bytes):

```text
1f4d8c8919c70c37deb3a1a8d2a805494f7ca85ce1490bb4da3bfcc56e5cbbaa src/model-evidence.ts
e54d088727ddd4ebaa5c513f98db70d1f00be0afe570421fa9c80f4c6eecf0cf src/model-evidence.test.ts
0f8987b336357dbc53cf165170170ad85e2c34063682bb7839c200d674fdf70c demo/project-evidence-store.ts
1e38c30a63e4dedc594d97569843b833a662775c6d94e89a8a6bd0e8ad44dbc6 demo/project-evidence-store.test.ts
440f09ccb109cbea8e66db29df5b81dd8e3d586be7a336b0b2b29a8a645b6903 demo/request-source-store.ts
e5a915d2e6f16f41527479ad46db8aa0b503428469eee463804d6a32e3635f6d demo/request-source-store.test.ts
```

Qualification covers this domain/store boundary. Package registration, complete
queue/native-review transaction integration, UI/source inspection, browser build,
full repository tests and portable private-bundle import remain parent work.
No combined workflow, UI or engineering-survey qualification is claimed here.
