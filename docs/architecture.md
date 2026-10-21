# Architecture direction

## Domain model

The core domain is a versioned project graph:

```text
Project
 ├─ Branch → Revision → ModelSnapshot
 ├─ Issue → AgentRun → PullRequest
 ├─ Entity → Relationship → Entity
 ├─ ValidatorRun → Finding → EvidenceArtifact
 └─ Policy → ReviewDecision → AuditEvent
```

An entity is a stable BIM object or project object. A revision is immutable. A branch is a named line of work with a parent revision. A pull request proposes a change from one revision to another and carries a semantic delta, not just a binary file replacement.

## Service boundaries

- **Project service:** projects, members, permissions, policies, branches, and revisions.
- **Model service:** entity graph, snapshots, semantic diffs, imports, exports, and query APIs.
- **Factory service:** issue intake, agent runs, worktrees, budgets, manifests, and PR orchestration.
- **Validation service:** schema, geometry, coordination, regression, and security validators.
- **Evidence service:** immutable reports, screenshots, exports, logs, and provenance.
- **Review surface:** issue/PR integration plus a future model-aware diff viewer.

The first implementation can be a modular monolith with clear interfaces. Split services only when a real deployment or scaling boundary appears.

## Versioning semantics

- Revisions are immutable and content-addressed where practical.
- Branches point to revisions; they do not copy mutable model state.
- A model pull request contains source revision, target revision, entity-level operations, generated artifacts, and validator evidence.
- Merging creates a new revision. It never mutates an old revision.
- Conflicts are semantic when two branches touch the same entity or an incompatible relationship, not only textual.

## First vertical slice

The first feature should be read-only: import a small IFC fixture, expose entities and relationships, create an issue-linked branch, compute a semantic diff, run a validator, and open a draft PR containing the evidence. Model mutation follows only after this slice is reviewable.
