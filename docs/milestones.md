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

Goal: add clash/coordination analysis, multi-disciplinary review routing, and model-aware PR inspection.

Exit evidence: coordination changes cannot merge without required evidence and assigned human review.

## M6 — Controlled automation

Goal: permit only explicitly allowlisted, low-risk unattended actions after measured verifier performance.

Exit evidence: project policy, budgets, kill switch, audit trail, confidence thresholds, and rollback are all tested in failure scenarios.
