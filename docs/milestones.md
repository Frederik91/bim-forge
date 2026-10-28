# Milestones

Milestones are deliberately ordered around risk reduction and a usable factory, not around recreating every Revit feature at once.

## Implementation status versus exit evidence

The repository now contains bounded authoring/review and factory implementations. The roadmap below retains its goals and exit criteria; source presence does not mark a milestone complete or change factory authority.

| Track | Current source/evidence position | Remaining qualification boundary |
| --- | --- | --- |
| M0 | Repository policy, templates, CI, and pause checks exist. | Source inspection does not confirm hosted branch protection or live operator readiness. |
| M1 | Immutable native fixture revisions, branches, deltas, and a server-side versioned store exist. | General IFC exchange and full model/storage qualification remain open. |
| M2 | Bounded project, accepted-history, model-scope, and evidence APIs support preview inspection. | Not a general large-project query/streaming API. |
| M3 | Runner, advisory planner, isolated coding worker, and draft publisher are implemented. | End-to-end operational evidence and authorization are distinct; checked-in state remains L1. |
| M4 | Bounded fixture authoring, proposal review, reconciliation, and explicit acceptance exist. | Not general safe BIM mutation, production model approval, or completion of every exit criterion. |
| M5–M6 | Coordination/authority and controlled-automation goals remain roadmap work. | No broad coordination or unattended engineering-approval qualification is claimed. |
| P1–P2 | Plan/3D workspace, selection/navigation, design targets, chat, sources, and proposal review are prototyped. | Full role/phase authority, provenance, device coverage, and all acceptance scenarios need their own evidence. |
| P3–P6 | Some bounded source, dependency, and evidence work supports these directions. | Full multidisciplinary review, federation, governed analysis, and lifecycle delivery are not established. |

Implementation entry points: [workspace guide](room-demo.md), [versioned house slice](design/versioned-house-slice-161.md), [compact workspace](design/compact-workspace-213.md), [runner](runner.md), [live planner](live-planner.md), [coding worker](coding-worker.md), and [publisher](publisher.md). These links include historical design/evidence records, not a declaration that every recorded rollout action happened. The [qualification program](experiments/README.md) is the source for reviewed experimental outcomes.

## M0 — Repository and safety foundation

Goal: establish the project contract, issue taxonomy, CI checks, policy gates, and branch/review rules.

Exit evidence: policy validator passes; templates exist; branch protection is enabled; a human can pause all loops.

## M1 — Versioned model kernel

Goal: import a small IFC fixture, represent entities and relationships, create immutable revisions and branches, and compute a semantic diff.

Exit evidence: repeatable fixture tests, revision history, branch isolation, and a human-readable model delta.

The [versioned model qualification program](experiments/README.md) records the proposed persistence design and experiments before schema adoption. It includes identity, exchange, concurrency, regeneration, recovery, and a detailed synthetic hospital database workload. Three execution rounds have been reviewed. Full hospital-scale admission and production adoption remain unqualified; consult the registry and linked reviews for current case-level outcomes rather than treating implementation-test success as qualification.

## M2 — Query and observation surface

Goal: expose read-only project/model queries, snapshots, relationships, and validation findings through a stable API.

Exit evidence: a reviewer can inspect a project state and evidence without opening the source database.

## M3 — Agent factory L1/L2

Goal: turn a GitHub issue into intake, a bounded plan, an isolated branch, a draft PR, and validator evidence.

Exit evidence: one end-to-end fixture task completes without direct production-model mutation; all run state is auditable.

## M4 — Safe model authoring

Goal: implement a narrow, reversible metadata mutation and semantic merge path.

Exit evidence: human-reviewed model PRs show before/after state, validators, rollback, and conflict behavior.

## M5 — Coordination workflows

Goal: add clash/coordination analysis, aspect-scoped discipline authority, atomic coordinated change sets, and model-aware proposal inspection.

Exit evidence: affected disciplines receive impact packages; exact-content approval requirements are reproducible; a coordinated change cannot partially apply or merge without required evidence and assigned human review.

## M6 — Controlled automation

Goal: permit discipline-controlled agents to approve only explicitly allowlisted, low-risk actions after measured verifier performance.

Exit evidence: instructions, tool permissions, and delegated authority are separate; authoring and review runs are independent; project policy, budgets, kill switch, audit trail, evidence thresholds, stale approvals, and rollback are tested in failure scenarios. Geometry and coordination remain human-reviewed unless a later governance decision explicitly changes that boundary.

## Product experience track

The [product vision](product-vision.md) runs across the risk-reduction milestones rather than waiting until the factory is complete.

### P1 — Project and model workspace

Goal: let a person choose a project, enter an explicit role/phase/model-scope context, understand current state, and navigate one accepted revision through shared 3D and templated 2D views.

Exit evidence: project overview, visible and switchable work context, discipline workspace, stable selection, view persistence, and property provenance work against the same fixture revision. Context-specific presentation preserves Show all access, cross-discipline suggestions, mandatory findings, permissions, and approval requirements.

### P2 — AI-native change session

Goal: turn selection, comments, visual targets, and measurements into anchored intent that a discipline work agent can convert into a validated proposal.

Exit evidence: the reviewer can inspect what changed, why, assumptions, uncertainty, property provenance, and the original intent without any interaction directly mutating the accepted model.

### P3 — Multidisciplinary review and spatial capture

Goal: coordinate one connected mechanical/electrical change through separate authority scopes, and prove that desktop and simulated review-walk input produce the same intent contract.

Exit evidence: impact packages, mandatory approvals, stale-approval behavior, atomic application, independent discipline-agent review for an allowlisted metadata change, and a complete audit trail are demonstrated end to end.

### P4 — Federated sources and connected data

Goal: coordinate source-aware model revisions and connect model context to externally owned requirements, project records, asset data, and operational observations.

Exit evidence: two source fixtures preserve identity and provenance across an update; a room record, project-system item, and simulated pump observation expose data authority and freshness; unavailable or stale data is explicit; no observation silently changes the accepted revision.

### P5 — Constraint-aware options and governed knowledge

Goal: regenerate dependent model state from declared constraints, apply versioned requirements and knowledge packs, and compare isolated design scenarios with explainable analysis.

Exit evidence: one bounded parameter change propagates deterministically or reports an unsatisfied constraint; two scenarios compare model, requirement, quantity, and one simulation outcome from the same source revision.

### P6 — Issued information and lifecycle continuity

Goal: produce dependable sheets, schedules, quantities, baselines, scoped review packages, field feedback, and handover records from versioned model state.

Exit evidence: an issued package records its exact revision, evidence, approvals, and exceptions; one external reviewer responds in a scoped room; one field or commissioning record remains linked to the final asset handover.
