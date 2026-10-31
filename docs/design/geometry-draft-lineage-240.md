# Unaccepted geometry in request conversations

Issue: https://github.com/Frederik91/bim-forge/issues/240. This is a separate follow-up to spatial markup PR239.

## Behavior

A conversation can add two trial cubes, then remove one without accepting either. The remaining cube must still satisfy its measured clearance. Accepted elements, source observations, IFC references and accepted Main/baselines retain their existing checks. Removing a trial cube must never erase the earlier turn or its evidence.

## Decision

Keep a bounded, self-contained proof of predecessor drafts in geometry evidence. Each ancestor binds its exact accepted origin, proposal snapshot digest, evidence digest and receipt/measurement prefix lengths. Canonical ID-based remove/upsert deltas reconstruct its native snapshot. Native validation remains owned by RoomRepository. The full original arrays are immutable append-only prefixes; derived final measurements are separate.

We compared retained pending proposal branches with self-contained proofs. Both can preserve provenance and replay history. Retained branches also import private conversation proposals into accepted model history and repeatedly store overlapping evidence, consuming the existing 32-revision/256 KiB project limits. Self-contained proofs retain one accepted proposal and consume the existing geometry evidence limits. Neither representation raises limits: 64 KiB, 128 receipts, 64 measurements and 20 ancestors still apply. Two same-model design workers proposed the alternatives; a different-model judge was unavailable under the tool policy, so the parent evaluates the design and executable evidence independently.

## Native authority

`RoomRepository.geometryHistory(target, through?)` returns a nominal `GeometryNativeHistory` capability, not an object assembled from a projected graph. It exposes the exact project root, writable target, accepted head, complete `acceptedPath(fromRevisionId)`, batch `validateSnapshots(values)` and native `reconcile(baseRevisionId, snapshot)`. Accepted-path validation shares the repository's existing target authority walk. Batch snapshot validation reuses the native parser and one invocation-local AssetFamily identity registry seeded by native history.

Original bases are frozen reconstruction inputs. Current accepted state is a separate freshness and reconciliation input. An unrelated accepted edit must not produce a blanket stale-base refusal. Historical accepted reviews use their decision-time accepted parent; later accepted state must not reinterpret an old decision.

## Ownership and boundary

- Portable contract/lineage: versioned schemas, canonical patches, exact prefix replay, hashes and derived obligation plan. Browser-safe; type-only imports of native authority.
- Geometry session: trusted continuation admission, append-only observations, current source validation and final measurement enforcement.
- Native repository: accepted ancestry, model validity, family identity and portable review binding.
- Proposal/queue: one coupled exact predecessor plus reconciled draft seed. The durable ticket and exact stored evidence row establish live predecessor provenance. Legacy history recovery is bounded and all-or-nothing.

Only inherited box-subject measurements can become inactive for a genuinely removed trial addition: the exact predecessor proves the candidate existed, its own complete origin and relevant accepted path prove it was not accepted, and the final candidate omits it. Accepted/current/source endpoints never qualify. Current-generation measurements remain active even if their text duplicates an older call. Reintroducing the candidate reactivates its old obligations. Original against-object/query members and all source receipts remain checked.

Portable hashes prove internal consistency, not the historical identity of a completely forged project author. Live continuation additionally requires the trusted queue row and same ticket; no signing secrets or second provenance store are introduced.

## Acceptance evidence

The initial server-container regression at 2d0ca24 passes strict validation and fails at the expected missing final endpoint after removing the second cube. The follow-up must prove deletion, retained-clearance failure, reintroduction, current duplicate calls, concurrent acceptance, unrelated reconciliation, scoped hidden accepted IDs, legacy recovery, portable restore, repeated turns and decision-time accepted history. Runtime/provider/browser evidence will be reported separately from source checks. No fix or deployment is qualified by this design document.

## Qualified preview receipt, 31 October 2026

Dedicated draft PR: https://github.com/Frederik91/bim-forge/pull/243, stacked on unmerged PR239. Qualified executable: `2f0a6e0d07f10c9c9451c73d157019ea8a3cf03a`. Image: `sha256:7cf6f5ec7630688b1f5bc7e7a98db274c81d371d377aec575616df182f329422`. The deployed browser manifest SHA-256 is `d109f664f4f3155fe8007fcc2d1b3dc26ab1adbc8bb73d3d467414fddfae367f`.

| Evidence | Result |
| --- | --- |
| Source04 | Strict validation of 341 TypeScript files, explicit 15-path policy check and 13 portable preflight tests passed. Full suite: 1,022 passed, zero failed, two existing optional skips. |
| Image01 | Exact image passed 35 lifecycle tests, one durable conversation test, API/markup restart and real four-worker admission checks. |
| Actual old-image upgrade | The prior deployed image generated a genuine v1 two-cube proposal in a disposable database. The new image resumed it, retained all original observations, removed the trial cube and accepted into the alternative only. Main, As-is and original evidence stayed unchanged through restart and portable restore. |
| Browser01 | Fifteen source-hosted Chromium checks passed in an isolated server container, covering markup, chat, desktop/phone layouts and guided review. This is distinct from the production-image and live-provider evidence. |
| Publication | Matching static/runtime pair published to https://192.168.1.17:9443/. Stopped-state and post-start fingerprints matched; original preview data, source state and authentication were preserved. ChatGPT remained connected. No merge or policy change. |
| Live-provider UI | Reopened the original failed synthetic chat and submitted its correction through the deployed UI. It reached Ready for review with exactly one cube and the summary “Keep Cube 1 and remove only proposed Cube 2.” No acceptance was performed. |

Live evidence binds project `3bf7b9af-8ab3-4a0e-a6e0-e3bf75f84a71`, ticket `4c0a84ef-3637-413e-ace1-b998e391c4f4` and new request `6a187261-21e7-4dd1-ae9a-c8aa665dd357`. Comparing exact stored snapshots proves the only delta from the prior draft is removal of `line-cube-2`: the remaining cube, family, room and relationships are identical. Both raw measurements and all four original receipts are preserved, now bound by a v2 ancestor proof. The earlier ready draft and failed turn remain in history. Complete accepted-project bytes match the before-UI capture, SHA-256 `790f5754e8b3463869e15cb21fb188de9ac8298c3ea1a14af7293cdb591713ee`.

The retained attempt ledger is under `/ssd1/bim-forge-qualification/issue240/`. Source01 is the expected red regression; source02 stopped on an exact-optional-property TypeScript error; source03 exceeded its five-minute harness deadline and exposed an index-based fixture placement collision. The fixture fix keeps poses stable by identity and changes no validator. Source04 used a bounded twenty-minute deadline with unchanged CPU, memory, network and filesystem restrictions. Its control connection dropped while the run continued; saved logs and the original container's zero exit status were recovered without another execution. Image01, browser01 and the first publication all passed. Cumulative root growth remained below the existing 2 GiB Docker budget.

V2 evidence remains forward-only for the prior preview image: after new writes, an old image cannot read it. Publication retains paired pre-write rollback artifacts, not a model-data rewind. These results qualify this bounded conversation workflow and one real-provider recovery, not all future geometry edits, large-model capacity or an unrestricted authority to discard measurements. Earlier markup-matrix receipts remain immutable historical evidence.
