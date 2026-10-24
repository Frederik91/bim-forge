# Product vision

BIM Forge is an AI-native BIM authoring and coordination environment. People explore a shared building model, state what should change, and remain in control of the aspects for which they are responsible. Discipline agents do the bounded model work, validate it, and return an explainable proposal for the approvals required by project policy.

This document is the source of truth for the intended end-user experience. [Architecture](architecture.md) describes system boundaries, [milestones](milestones.md) describe delivery order, and the [glossary](../GLOSSARY.md) defines the product language.

## Product promise

Opening BIM Forge should feel like entering a building project, not opening a database or a collection of tools.

```text
Choose project -> understand current state -> enter a model view
               -> capture intent -> AI prepares a proposal
               -> affected disciplines review -> create a new revision
```

The accepted model remains versioned and reviewable throughout this flow. A gesture, spoken instruction, or agent action cannot silently change it.

## Project experience

### Project overview

After choosing a project, a person lands on an overview that answers:

- What is the current accepted revision?
- What changed recently, and what is waiting for review?
- Which coordination findings, decisions, and risks need attention?
- Which disciplines and agents are active?
- Where should I continue my work?

From there, the person can enter the full model, a saved view, a discipline workspace, a change session, or a proposal review.

### One model, many views

The project has one shared semantic model and revision history. 2D, 3D, section, elevation, schedule, and VR experiences are views of that model rather than separate model copies.

A view records the projection needed to return to the same working context: revision, camera or cut plane, level, crop, visibility rules, property filters, visual style, and annotations. A view template makes that configuration reusable. Revit-like plan workflows are therefore available without making 2D drawings a second source of truth.

A discipline workspace is a scoped lens over the shared model. It combines relevant views, systems, properties, findings, proposals, and policies for one discipline while retaining cross-discipline context.

## Capturing intent in 2D, 3D, and VR

People should be able to select, comment, point, drag, measure, sketch, or speak in whichever view best expresses the problem. These interactions capture intent; they do not directly author accepted geometry.

Each captured intent is anchored to enough context for another person or agent to understand it later:

- project and source revision;
- stable entity identities and affected region;
- selected point, face, path, measurement, or viewpoint when relevant;
- originating view and discipline context;
- the person's request, annotations, and supporting evidence.

A change session groups related intentions and the resulting proposals. In VR, a review walk adds a time-ordered spatial record of where the person was, what they pointed at or measured, and what they said. The person can pause, inspect the captured list, correct an interpretation, and decide which intentions should become proposals.

The agent then uses bounded model tools to create a proposal. Reviewers see the semantic delta, rationale, constraints, validation evidence, assumptions, and uncertainty. They can approve the exact proposal or request another revision without losing earlier proposals or the original model state.

## Property-centered model work

Geometry is only one part of the product. Each entity also carries parameters, properties, requirements, classifications, relationships, and derived values.

Property provenance must distinguish where a value came from and why it can be trusted. Typical origins include:

- explicitly specified by a person;
- calculated from geometry or other values;
- imported from a source model;
- selected from a product catalog;
- inferred by an agent and awaiting confirmation;
- unknown or inherited from legacy data.

The review surface should show the source, method, units, applicable revision, evidence, and responsible authority for material values. A derived value is recalculated when its inputs change. An AI-inferred value remains visibly inferred until policy permits or a responsible authority confirms it.

Views and view templates can use properties to control visibility, styling, labels, schedules, checks, and discipline-specific emphasis. This makes property quality part of daily model navigation rather than a separate cleanup task.

## Cross-discipline authority

Anyone with project access may propose a change, but proposing does not grant authority to approve every consequence. Authority attaches to an aspect of the model, not necessarily to an entire object.

For example, moving a pump may affect:

- mechanical placement and flow connections;
- electrical supply, circuit, and cable route;
- structural support and loading;
- controls and monitoring points;
- clearances, access, and maintainability.

The proposal becomes a coordinated change set with an impact package for each affected authority scope. Deterministic relationship, spatial, and rule checks establish mandatory approval requirements. AI may explain impacts and suggest reviewers, but it cannot remove a required authority or downgrade a blocking finding.

Approval is bound to the exact proposal content, source revision, validator evidence, and policy version. A material change or stale base revision invalidates affected approvals. Required, consulted, and informed participants remain distinct so consultation does not masquerade as consent.

An approved coordinated change set applies atomically: either all approved discipline impacts create one new revision, or none do. This prevents one discipline's portion from entering the accepted model while connected work remains unapproved.

## Discipline agents and delegated approval

Each discipline may configure its own agents. Three controls remain separate:

1. **Instructions** describe how the discipline wants work performed and reviewed.
2. **Tool permissions** define what an agent can read, calculate, propose, or operate.
3. **Delegated authority policy** defines the exact classes of proposal the discipline agent may approve without a human decision.

Delegation is opt-in, narrow, evidence-based, and reversible. A model's self-reported confidence is never authority. Policy must use deterministic facts such as change class, property path, affected entities, magnitude, validator results, coordination impact, and project phase.

The operating levels are deliberately separate:

- **Observe:** inspect and report without proposing a model change.
- **Propose:** create a validated proposal but approve nothing.
- **Approve:** record a decision only within delegated authority.
- **Apply:** create an accepted revision only when project policy permits and every approval requirement is satisfied.

The agent or run that authored a proposal cannot also supply the independent discipline approval for it. A discipline work agent prepares the change; a separately instructed discipline review agent evaluates the exact proposal and evidence. Every agent decision records its identity, policy version, evidence, scope, rationale, and timestamp.

Project policy controls whether a fully approved low-risk change is applied automatically or waits for a person to press Apply. Agent-made changes remain visible in the same history, review surface, and rollback path as human-approved changes.

The initial governance boundary remains conservative: geometry and coordination changes require human review. Early delegated approval should target deterministic metadata and property changes. Expanding that boundary requires an explicit later governance decision backed by independent evidence; it is not implied by this vision.

## Product invariants

- The accepted model changes only by creating a new immutable revision.
- A 2D, 3D, or VR interaction captures intent; it does not silently commit model state.
- Stable entity identities and source revisions anchor every proposal.
- Anyone may propose, while each affected authority retains control of its scope.
- Approval covers exact proposal content and becomes stale when its basis changes.
- Deterministic validators can add mandatory review; AI cannot remove it.
- An agent cannot change its own permissions or delegated authority.
- Authoring and independent approval are separate roles and runs.
- Coordinated changes apply atomically.
- Project policy decides whether a fully approved change applies automatically.
- Every proposal, decision, application, and rollback is explainable and auditable.

## First end-user slice

The first cohesive product slice should demonstrate the whole interaction model at small scale:

1. Choose a sample project and open its overview.
2. Navigate the same accepted revision in a shared 3D view and a templated 2D plan.
3. Open one discipline workspace and inspect property provenance.
4. Select a pump, drag a visual target, add a measurement and comment, and submit the intent.
5. Let a discipline work agent prepare a bounded proposal and impact analysis.
6. Review mechanical and electrical impact packages, with exact-content approval requirements.
7. Demonstrate delegated agent approval for a safe metadata change while retaining human approval for geometry and coordination.
8. Apply the approved change as one new revision and inspect its semantic delta and audit trail.

VR hardware is not required for this first slice. The intent record should nevertheless be designed so a later review walk can produce the same anchored requests.

## Not yet promised

This vision does not yet promise unrestricted free-form geometry, production-grade VR hardware support, autonomous approval of coordination geometry, regulatory approval, or replacement of professional engineering judgment. Those capabilities require separate evidence and explicit product and governance decisions.
