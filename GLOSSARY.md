# BIM Forge model review

## Language

**Project**:
A named building-model study and its revision history.

**Level**:
A horizontal building storey that provides a common elevation and contains spaces.
_Avoid_: Floor project

**Space**:
A named, bounded part of a level. A residential room or hallway is a space; adjoining spaces share building walls rather than owning duplicate copies.
_Avoid_: Room project

**Room focus**:
The space used to frame the current view and request context. It does not grant permission to change its contents or exclude impacts on adjacent spaces.

**Entity**:
A building object with a stable identity across revisions, such as a wall or door.

**Relationship**:
An identified connection between entities, such as a door being hosted by a wall.

**Snapshot**:
The complete set of entities and relationships at one point in a model's history.

**Revision**:
An immutable snapshot linked to its parent revision. The first revision has no parent.

**Branch**:
A named reference to a revision that identifies a line of work.

**Proposal**:
A change saved on a separate branch for comparison with its source, without replacing the original.

**Semantic delta**:
The added, removed, or modified entities and relationships between two snapshots.
_Avoid_: Text diff

**Conflict**:
Different changes to the same entity or relationship in proposals with a shared ancestor, requiring a review decision.

**View**:
A saved projection of a model revision for navigation, inspection, or review in 2D, 3D, or an immersive environment.

**View template**:
A reusable configuration for creating consistent views.

**Discipline workspace**:
A discipline-specific lens over the shared model, its views, properties, findings, and proposals.

**User role**:
A named set of project responsibilities that helps describe a person's work without itself granting permission or approval authority.

**Role assignment**:
The association of a person with a user role for a defined project context.

**Project phase**:
A declared stage of the building lifecycle that frames current goals, evidence, deliverables, and workflows.

**Model scope**:
The site, building, level, zone, system, work package, selection, or other bounded part of the model relevant to current work.

**Work context**:
The explicit combination of role, discipline, project phase, model scope, and task used to frame work.

**Workspace profile**:
A reusable presentation of views, properties, actions, agents, checks, notifications, and deliverables for a work context.

**Experience policy**:
A rule that tailors presentation and defaults to a work context without changing access or authority.

**Access policy**:
A rule defining what an actor may read or change.

**Validation policy**:
A rule defining the checks and evidence required for identified work.

**Intent**:
A person's revision-bound request for model work, anchored to relevant entities, locations, measurements, and view context.

**Change session**:
A group of related intentions and the proposals produced from them.

**Request source**:
An image or document supplied as immutable reference evidence for a change request and retained with its proposals. A source does not itself grant permission to change the model.

**Review walk**:
A time-ordered, spatial record of intentions captured while moving through a model.

**Parameter**:
A named input or constraint used to describe or calculate model state.

**Property**:
A named value that describes an entity, relationship, or project.

**Derived value**:
A property calculated from declared inputs and a reproducible method.

**Requirement**:
A condition that model state is expected to satisfy.

**Classification**:
An assignment that relates model data to a defined category or external system.

**Property provenance**:
The recorded origin, method, evidence, and authority for a property value.

**Constraint**:
A declared relationship or condition that model state is expected to preserve.

**Regeneration**:
The deterministic recalculation of dependent model state after an input changes.

**Federated model**:
A coordinated view of multiple source models that preserves each source's identity and ownership.

**External system**:
A system outside BIM Forge that remains authoritative for identified records or observations.

**External record**:
An identified item whose authoritative state is maintained by an external system.

**Data authority**:
The person or organization accountable for an identified class of data and its change policy.

**External data binding**:
A governed connection between model context and an external record or observation that preserves source, authority, mapping, time, and freshness.

**Observation**:
A time-stamped measured or reported value that describes a condition without becoming accepted design intent.

**Digital twin context**:
A model view that combines accepted design or asset state with source-owned operational observations while keeping their meanings distinct.

**Knowledge pack**:
A versioned collection of governed requirements, standards, content, rules, and accepted project guidance.

**Design scenario**:
An isolated alternative derived from a shared revision for comparison against other alternatives.

**Baseline**:
An immutable, issued project state against which later work and delivery readiness are compared.

**Deliverable package**:
A versioned set of model state, views, schedules, documents, evidence, approvals, and declared exceptions issued together.

**Authority scope**:
The defined discipline and model aspect over which an actor may make or approve decisions.

**Coordinated change set**:
A proposal whose connected impacts across authority scopes must be reviewed and applied as one unit.

**Impact package**:
The subset of a coordinated change set, evidence, and findings relevant to one authority scope.

**Approval requirement**:
A policy-derived decision that must be satisfied before a proposal can be applied.

**Delegated authority policy**:
A discipline-controlled rule defining the narrow proposal classes an agent may approve without a human decision.

**Discipline work agent**:
An agent acting for a discipline to inspect the model and prepare bounded proposals.

**Discipline review agent**:
An independently instructed agent acting for a discipline to evaluate a proposal within delegated authority.
