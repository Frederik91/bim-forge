# Milestones

Milestones are deliberately ordered around risk reduction and a usable factory, not around recreating every Revit feature at once.

## M0 — Repository and safety foundation

Goal: establish the project contract, issue taxonomy, CI checks, policy gates, and branch/review rules.

Exit evidence: policy validator passes; templates exist; branch protection is enabled; a human can pause all loops.

## M1 — Versioned model kernel

Goal: import a small IFC fixture, represent entities and relationships, create immutable revisions and branches, and compute a semantic diff.

Exit evidence: repeatable fixture tests, revision history, branch isolation, and a human-readable model delta.

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

Goal: let a person choose a project, understand its current state, and navigate one accepted revision through shared 3D and templated 2D views.

Exit evidence: project overview, discipline workspace, stable selection, view persistence, and property provenance work against the same fixture revision.

### P2 — AI-native change session

Goal: turn selection, comments, visual targets, and measurements into anchored intent that a discipline work agent can convert into a validated proposal.

Exit evidence: the reviewer can inspect what changed, why, assumptions, uncertainty, property provenance, and the original intent without any interaction directly mutating the accepted model.

### P3 — Multidisciplinary review and spatial capture

Goal: coordinate one connected mechanical/electrical change through separate authority scopes, and prove that desktop and simulated review-walk input produce the same intent contract.

Exit evidence: impact packages, mandatory approvals, stale-approval behavior, atomic application, independent discipline-agent review for an allowlisted metadata change, and a complete audit trail are demonstrated end to end.
