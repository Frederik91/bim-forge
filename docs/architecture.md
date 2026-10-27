# Architecture direction

## Domain model

The core domain is a versioned project graph:

```text
Project
 ├─ Branch → Revision → ModelSnapshot
 ├─ Member → RoleAssignment → WorkContext ← ProjectPhase/ModelScope
 ├─ WorkContext → WorkspaceProfile → Workspace → View → ViewTemplate
 ├─ ChangeSession → Intent → Proposal
 ├─ Issue → AgentRun → PullRequest
 ├─ Entity → Relationship → Entity
 ├─ Property → Provenance → EvidenceArtifact
 ├─ Entity/Property ← DataBinding → ExternalRecord → ExternalSystem
 ├─ DataBinding → Observation
 ├─ CoordinatedChangeSet → ImpactPackage → ApprovalRequirement
 ├─ ValidatorRun → Finding → EvidenceArtifact
 └─ Policy → AuthorityScope → ReviewDecision → AuditEvent
```

An entity is a stable BIM object or project object. A revision is immutable. A branch is a named line of work with a parent revision. A proposal describes a change from one revision to another and carries a semantic delta, not just a binary file replacement. A pull request is the factory's review vehicle for a proposal; the product review surface presents the same model evidence without requiring end users to understand GitHub.

Views and discipline workspaces project the same shared model; they are not model copies. Work context and workspace profiles tailor presentation without granting access or authority. Intent captured from 2D, 3D, or VR is bound to stable entity identities and a source revision before an agent prepares a proposal. Coordinated change sets divide evidence by authority scope and require exact-content approvals before atomic application. External data bindings connect model context to source-owned records and observations without collapsing operational state into accepted design truth. See the [product vision](product-vision.md) for the end-user behavior and invariants.

## Service boundaries

- **Project service:** projects, members, role assignments, phases, permissions, policies, branches, and revisions.
- **Model service:** entity graph, properties and provenance, snapshots, semantic diffs, imports, exports, and query APIs.
- **Integration service:** source federation, identity mapping, external data bindings, connector policy, synchronization, subscriptions, and governed write-back proposals.
- **Experience service:** work contexts, workspace profiles, progressive disclosure, 2D/3D/VR projections, view templates, and revision-bound intent capture.
- **Analysis service:** constraint-aware regeneration, saved model questions, design scenarios, and simulation evidence.
- **Coordination service:** impact analysis, authority scopes, approval requirements, and atomic coordinated change sets.
- **Factory service:** issue intake, agent runs, worktrees, budgets, manifests, and PR orchestration.
- **Validation service:** schema, geometry, coordination, regression, and security validators.
- **Evidence service:** immutable reports, screenshots, exports, logs, and provenance.
- **Review surface:** end-user proposal review, model-aware diffs, impact packages, decisions, and issue/PR integration.

The first implementation can be a modular monolith with clear interfaces. Split services only when a real deployment or scaling boundary appears.

## Versioning semantics

- Revisions are immutable and content-addressed where practical.
- Branches point to revisions; they do not copy mutable model state.
- A model pull request contains source revision, target revision, entity-level operations, generated artifacts, and validator evidence.
- Merging creates a new revision. It never mutates an old revision.
- Conflicts are semantic when two branches touch the same entity or an incompatible relationship, not only textual.
- Approval records bind to exact proposal content, source revision, validator evidence, and policy version.
- A coordinated change set creates one new revision only after every required authority scope has approved it.
- External data bindings are versioned model context; fetched values and observations retain external identity, source time, freshness, units, and mapping version.
- Live observations do not become revision content unless a declared process captures them as evidence or proposes a model change.
- External write-back is a separately authorized operation governed by the source system's data authority.
- Intents, proposals, agent runs, decisions, and evidence record their work context.
- Role, phase, scope, and workspace-profile changes do not rewrite historical context or expand authority.
- Presentation rules cannot suppress mandatory findings, connected impacts, or required approvals.
- Workspace profiles preserve a cross-discipline proposal path even when the suggested change falls outside the user's normal tools or approval authority.

## Independent project operation

One logical model can span installations controlled by different companies. Each participant must be able to retain a usable copy of the agreed shared data and continue on a local branch if the main host becomes unavailable or revokes future access.

Deliver verified mirrors before collaboration between installations. Preserve stable entity identities, revision ancestry, artifacts, and review evidence across copies. Project governance defines acceptance authority independently of server ownership. Disconnected work can diverge and requires semantic reconciliation and applicable human review before shared acceptance.

See [Independent project mirrors](project-mirrors.md) for the replication boundaries, delivery order, and two-installation acceptance scenarios. These are architecture requirements for future implementation.

## Data model research

The [versioned BIM data model research](research/versioned-bim-data-model.md) compares IFC, existing authoring systems, and versioned model platforms. It proposes qualification experiments for identity, relationship semantics, regeneration, concurrency, and storage before the persistence schema is adopted. Its recommendations remain proposals.

## First vertical slice

The first feature should be read-only: import a small IFC fixture, expose entities and relationships, create an issue-linked branch, compute a semantic diff, run a validator, and open a draft PR containing the evidence. Model mutation follows only after this slice is reviewable.
