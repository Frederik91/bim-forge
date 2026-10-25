# QVM-01 design assessment

Working assessment, 25 October 2026. The first execution round is complete. The full hospital database trial timed out before publication; see the [full-load review](decisions/full-hospital-review-20261025.md). This document proposes the next design to review; it does not adopt a schema, approve engineering changes or authorize merging.

## Suggested model direction

A project revision should identify a coherent graph of entity versions, relationships, semantic dependencies, ownership and retained artifacts. Stable entity identity, immutable content identity and external source identity serve different purposes and should remain explicit.

Occurrence overrides belong to an occurrence. A shared-definition change must be deliberate and expose its complete dependent-instance impact, including overrides that mask an effective change. Identical stored content can share bytes while retaining independent editing authority.

Acceptance should combine a small atomic database publication with semantic assumptions, evaluated deltas, applicable discipline policy and complete evidence. An unrelated accepted edit can preserve approval when its scope and assumptions remain equivalent. Changed occupancy, host/wall assumptions or dependent geometry must trigger revalidation. The short database head CAS protects publication after that semantic work; its coarse conflict alone cannot decide whether a user must revise a request.

## Evidence and limits

| Design question | Executed evidence | Remaining qualification |
| --- | --- | --- |
| Identity and independent changes | Bounded W1 lineage, independent acceptance orders, explicit field rules and payload-bound receipts | Physical split/merge equivalence, vendor identity and production transaction integration |
| Shared definitions and overrides | All three EX-03 cases mutate the W0 two-chair fixture and retain actual effective deltas | Rich property states, units, external dictionaries, persistent concurrent changes and regeneration |
| Spatial/query assumptions | Bounded overlap, empty-region insertion and changed-wall cases reject invalid assumptions | General spatial indexes, predicate lifetime/retirement and large cross-discipline dependency closures |
| Geometric references | Real OCCT face split and traversal permutation; ambiguous anchors remain pending | Curved faces, tolerance sweeps, reload, general topological naming and kernel upgrades |
| IFC exchange | Real controlled IFC files, geometry/coordinate checks and an actual bounded-property preservation failure | A loss-aware exchange contract, independent vendor/MVD coverage and the latest complete engine rerun |
| History and recovery | 1,000-revision small-model aging, six real PG recovery cases, portable divergence and partial reader upgrades | Full-model history combinations, old/new kernel execution and independent authentication/host failures |
| Storage capacity | Verified smoke/reduced admission and full manifest generation; fresh full trial timed out with 13,602,755 unpublished staged versions | Completed full admission, qualified working-set latency and the unexecuted branch/client/history matrix |

Links to original immutable results and separate reviews are in [the registry](registry.json). Each tested capability remains bounded by its fixture, actual source and environment. A passing case does not turn a partially covered experiment into a production qualification.

## Storage experiments to carry forward

The experimental store preserves complete typed documents and immutable versions with deltas. Its current branch-visibility copy, full-branch reference validation and recursive historical reconstruction still need explicit large-case qualification. A proposal workflow must avoid copying a hospital-sized membership view for every request.

The full trial used runner `612dd75` unchanged and failed its two-hour admission target. Profiling and plan inspection already identified repeated interpreted validation and an unbounded reference-join plan; those were corrected before the final preflight. A later transport diagnostic found a duplicate outer document in insert arguments. Its explicit-column fix preserves SQL-visible values and hashes, and passed post-run real PostgreSQL storage checks at integration source `1146065`. The timed-out full trial retained the original transport. No architecture or language-capacity verdict can be drawn from an untuned pipeline.

The next implementation experiment should measure an immutable prepared-record path that reuses one verified canonical serialization/hash across accounting, staging and insertion. Current source computes canonical forms repeatedly. This is a code-review hypothesis for measurement, not a measured speedup, and must preserve the full body/readback oracle.

Bulk import and interactive acceptance should be measured as separate phases. Any staged publication design must retain complete validation, atomic visibility of the accepted revision, exact retry receipts and the last complete usable state. Small edits need scoped validation that still covers incoming references, semantic query assumptions and evaluated dependants. Simply omitting expensive checks would invalidate the experiment.

## Adoption sequence to review

1. Combine the semantic prototype and governed policy/evidence checks with actual persistent transactions, replaying the same positive and negative cases.
2. Specify the loss-aware IFC/property contract and execute the latest complete exchange slice after the retry escalation is reviewed.
3. Measure the prepared-record bulk path and scoped validation, then repeat full admission only after reduced correctness and profiling justify another slot.
4. Execute pinned old/new kernel interpretation and broader reference cases before claiming historical geometry compatibility.

The renderer, AI service calls, VR interactions, engineering/code compliance, real hospital completeness and production security remain outside this qualification. Existing preview behavior and accepted model data are unchanged by these experiments.
