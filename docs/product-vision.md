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

## A multiplayer building workspace

BIM Forge should feel like entering a building where people and agents are already at work. Engineers explore the same spatial environment, discuss objects and places, assign tasks, and see relevant activity around them. The immediacy of a multiplayer game is a product direction: interaction, presence, and shared spatial context shape the experience.

The model remains visible while a person expresses intent, talks to an agent, and reviews proposed work. A separate chat panel is not the primary home of this interaction. Selecting a door or marking an area lets the person start typing or speaking in that context. Voice and future VR interactions should use the same task and spatial context as text.

### Being inside the building is the primary experience

The primary spatial experience places the person inside the building. People work from rooms, circulation spaces, and meaningful locations, rather than always observing a detached model from outside. Looking at an object, approaching it, and starting a task should form one continuous interaction.

Plan, section, elevation, and overview views remain readily available. Switching views preserves the selected objects, active task, relevant conversations, and spatial reference. A plan can show the person's location and direction of view. A section can frame the area under discussion. Returning inside restores the prior position and orientation.

People can navigate through the building or jump directly to a room, object, saved viewpoint, or permitted shared task. Routine work must not require walking through every intervening space. Navigation controls and transitions still need testing across desktop, touch, keyboard, and future VR.

Desktop navigation includes familiar game-style controls. WASD moves relative to the facing direction, and mouse movement turns that direction in an explicitly enabled mouse-look mode. Escape restores the cursor for selection and conversation. A separate free-roam flight mode allows movement beyond eye height and through the building for inspection. Shift ascends and Ctrl descends. Walking and flying remain distinguishable, and a return-to-room action recovers a useful location. Navigation input stops while a person types, changes views, or leaves the model focus.

### People can talk within the shared building

Built-in voice chat, text chat, and private conversations let people communicate with others they encounter through the model or a shared task. A person can identify a permitted participant or task owner and start a conversation without finding external contact details or switching to a separate calling application.

The interface must make the recipient and audience clear. Talking to another engineer and instructing an agent are different actions, even when both concern the same door. Joining a human conversation does not assign an agent, capture speech as model-editing intent, or grant model-change authority by itself.

Conversation privacy still applies. Spatial proximity does not make personal conversations discoverable or audible. Whether shared voice uses proximity audio, explicit channels, or direct calls remains open, as do recording, transcription, consent, and retention rules. No automatic voice capture is implied by entering the building.

### Conversations and agents belong to tasks in places

Starting a task conversation assigns an agent the instruction and its model context. The task retains its owner, source revision, relevant objects or region, and conversation. Several independent tasks can concern the same object or nearby places. An object does not have to share one conversation for every intention.

People can continue navigating while agents work. In 3D, a conversation is represented by a hovering task agent at the place where the conversation started. Its origin is separate from the objects the task concerns. Selecting the agent opens the conversation and highlights the associated objects or region. The agent does not follow the currently focused item. Where visibility permits, these representations distinguish active work, a question awaiting an answer, and a proposal awaiting review. Equivalent task references remain available in 2D. A searchable task list provides another route back to the relevant location and view.

Another engineer can communicate with the task owner or join a shared discussion within its visibility scope. The maintainer selected hovering 3D task agents as the conversation representation; their final art and dense-scene behavior need further design. Human avatars, camera sharing, clustering, and notification behavior remain open.

### Concurrent agents coordinate overlapping work

Agents should recognize when their tasks affect the same entities, relationships, or constraints. Spatial proximity can suggest overlap, but shared dependencies determine coordination needs. Work on separate floors may affect the same riser; adjacent tasks may be independent.

For example, one agent may widen a door while another moves its adjoining wall. Within the information they are permitted to share, the agents identify the dependency, exchange relevant constraints, and propose compatible work. People can inspect the overlap and the resulting proposals in the model.

Coordination does not grant approval authority. Agents cannot silently overwrite another task's proposal or apply an unapproved model change. An accepted change causes other affected proposals to be checked against the changed source context. The existing cross-discipline approval and revision rules still govern acceptance.

### Visibility is chosen for the conversation

The intended high-level visibility choices include:

- Personal: the conversation and its activity are not disclosed to other participants.
- Discipline: the conversation is shared with the permitted discipline audience.
- Company: the conversation is shared with the permitted company audience.

Personal means that other participants do not see a marker, task listing, activity cue, or agent coordination message that reveals the private conversation. The wish to coordinate overlapping work does not override this choice.

Detailed privacy design remains open. It must resolve audience membership, cross-company disciplines, invitations, defaults, policy administration, and what becomes visible when personal exploration becomes a shared proposal. This vision does not select an authorization implementation or promise coordination using information that an agent cannot access.

### Design consequences

The design system must support spatial selection, anchored conversation, permitted presence, task status, proposal comparison, and a secondary task list. These need a consistent language across 2D, 3D, text, and intended voice interaction. The first view should answer what place is selected, which visible task is active there, and what needs the person's attention while preserving the model context.

This section records intended product behavior, not implemented multiplayer, voice, privacy, or agent-coordination capabilities. The direction was confirmed by the maintainer on 2026-10-31 and informs [design exploration #248](https://github.com/Frederik91/bim-forge/issues/248).

## Project experience

### Project overview

Entering a model can resume the person's saved working location and task. A project overview remains available and answers:

- What is the current accepted revision?
- What changed recently, and what is waiting for review?
- Which coordination findings, decisions, and risks need attention?
- Which disciplines and agents are active?
- Which connected data sources are current, stale, unavailable, or awaiting reconciliation?
- Where should I continue my work?

From there, the person can enter the full model, a saved view, a discipline workspace, a change session, or a proposal review.

### One model, many views

The project has one shared semantic model and revision history. 2D, 3D, section, elevation, schedule, and VR experiences are views of that model rather than separate model copies.

A view records the projection needed to return to the same working context: revision, camera or cut plane, level, crop, visibility rules, property filters, visual style, and annotations. A view template makes that configuration reusable. Revit-like plan workflows are therefore available without making 2D drawings a second source of truth.

A discipline workspace is a scoped lens over the shared model. It combines relevant views, systems, properties, findings, proposals, and policies for one discipline while retaining cross-discipline context.

### Adaptive work context and progressive disclosure

BIM Forge will eventually contain more capabilities than any one person needs at once. The interface should be assembled around the person's explicit work context rather than exposing one growing toolbar.

A work context combines:

- project role and discipline;
- project phase;
- model scope, such as site, building, level, zone, system, work package, or selection;
- current task or decision.

An experience policy uses that context to emphasize the most relevant views, properties, commands, agents, checks, notifications, deliverables, and next actions. For example:

- an architect in concept design sees room requirements, options, massing, area, and early performance checks;
- an MEP engineer working on level 03 sees systems, routing, clearances, connected loads, and discipline properties;
- a site manager in construction sees the issued baseline, work packages, RFIs, installation status, and field observations;
- a maintenance technician in operations sees assets, live observations, alarms, history, procedures, and open work.

The active context remains visible and easy to switch. A person may hold several roles on the same project. Search, command access, and an explicit Show all path keep the full product discoverable, while personal preferences refine presentation inside project policy.

Contextual defaults are affordances, not proposal boundaries. An electrical engineer may not normally see architectural wall-authoring tools, but can still select a wall, explain why it should move, and submit that cross-discipline intent. BIM Forge routes the resulting proposal and impact package to the architect and every other affected authority. The electrical engineer's role neither blocks the suggestion nor grants authority to apply or approve the architectural change.

Presentation is not authorization. Work context can change what is emphasized, but access policy still controls what can be read or changed, authority scope controls what can be approved, and validation policy controls mandatory evidence. Findings, affected disciplines, and connected dependencies remain visible when they cross the selected model scope.

Intents, proposals, agent runs, reviews, and evidence retain the work context in which they were created. Agents state which role, phase, model scope, task, and project guidance they used. Project-phase transitions and context changes are auditable and never rewrite historical decisions.

This capability is tracked in [issue #71](https://github.com/Frederik91/bim-forge/issues/71).

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

### Speech and drawing form one time-linked instruction

A planned capability connects what a person says with what they point at and draw at the relevant time. For example, the person says "move this one this way, then this one this way" while drawing two arrows at different objects. The agent must associate each reference and direction with the correct object and gesture.

The instruction retains a shared timeline for spoken phrases, transcript timing, selection, pointer movement, and progressive strokes. The final transcript and finished drawing alone cannot express which gesture accompanied each phrase. Each relevant event also retains its model revision, spatial reference, and active view so camera movement does not detach the intent from its place.

Speech may precede or follow a stroke. Interpretation uses the surrounding temporal and spatial context, not exact timestamp equality. People can inspect or replay the agent's object-and-direction interpretation and correct it. Ambiguous references require clarification, and "a bit further" does not become an unexplained precise distance.

The intended inputs include mouse or pointer drawing on desktop, touch on a phone, and future hand or controller gestures in VR. They capture intent through the same proposal boundary. Human voice chat is not automatically recorded as an agent instruction; capture and retention remain subject to the conversation's visibility and later privacy design.

This capability is explicitly deferred at the maintainer's request. [Planning issue #250](https://github.com/Frederik91/bim-forge/issues/250) records requirements, dependencies, and future evidence. It is not implemented or included in the current spatial interaction study.

## Property-centered model work

Geometry is only one part of the product. Each entity also carries parameters, properties, requirements, classifications, relationships, and derived values.

Property provenance must distinguish where a value came from and why it can be trusted. Typical origins include:

- explicitly specified by a person;
- calculated from geometry or other values;
- imported from a source model;
- referenced or synchronized from an externally owned record;
- observed from an operational system at a stated time;
- selected from a product catalog;
- inferred by an agent and awaiting confirmation;
- unknown or inherited from legacy data.

The review surface should show the source, method, units, applicable revision, evidence, and responsible authority for material values. A derived value is recalculated when its inputs change. An AI-inferred value remains visibly inferred until policy permits or a responsible authority confirms it.

Views and view templates can use properties to control visibility, styling, labels, schedules, checks, and discipline-specific emphasis. This makes property quality part of daily model navigation rather than a separate cleanup task.

## Connected external data and digital twin context

The building model is not a closed database. Rooms, systems, equipment, issues, documents, requirements, cost items, schedules, assets, and operational signals may remain authoritative in external systems.

An external data binding connects a stable model identity to an externally owned record or observation. It preserves:

- source system and external record identity;
- the person or organization acting as data authority;
- access and write policy;
- mapping direction and mapping version;
- units and value semantics;
- retrieval or observation time, freshness, and availability.

The product must distinguish four ways of using external data:

1. **Reference:** open the authoritative external record from its model context.
2. **Synchronized snapshot:** show selected external fields with their source revision or retrieval time.
3. **Live observation:** show a time-stamped operational value or history in spatial context.
4. **Governed write-back:** prepare an external update only when the connector and responsible data authority permit it.

A designer might open a room's authoritative requirement record in a room-function system such as dRofus, or follow a coordination item to a construction system such as Procore. A maintenance user might select a pump and see operating state, temperature, flow, alarms, and recent history from the building's operational systems.

Operational observations remain distinct from accepted design properties. A sensor value can trigger a finding, analysis, or proposal, but cannot silently rewrite design intent or satisfy a requirement. Stale, unavailable, estimated, and transformed values remain visibly marked. Any write-back follows the external system's approval policy and audit trail.

This capability is tracked in [issue #70](https://github.com/Frederik91/bim-forge/issues/70).

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

## Strategic capabilities beyond the first slice

Five additional capabilities turn the interaction model into a credible authoring and delivery platform. They describe product direction, not permission to skip the safety milestones.

### Federated coexistence gateway

BIM Forge should connect existing authoring, coordination, analysis, document, field, and asset systems without flattening their ownership. Incoming revisions appear as source-aware semantic deltas with stable identity mapping and measured information loss. Approved information can leave through governed IFC, BCF, schedules, documents, APIs, or connector-specific exchanges.

This is the adoption wedge: a project can gain model intelligence and coordination value before every discipline changes its authoring system.

### Constraint-aware parametric regeneration

Model changes must preserve declared hosts, joins, alignments, dimensions, clearances, system connections, and dependent geometry. A proposal explains which constraints were maintained, changed, or left unsatisfied and fails deterministically when regeneration cannot produce a valid result.

Reusable families, types, components, and governed content build on the same contract. AI authoring becomes trustworthy when it changes relationships and parameters rather than only moving disconnected geometry.

### Requirements and governed project knowledge

Briefs, room requirements, standards, BIM execution plans, approved content, office conventions, and accepted decisions should be versioned, attributable, and linkable to model scope. Agents and validators cite the exact source they used. Exceptions retain owner, rationale, applicability, and approval instead of becoming hidden deviations.

This lets every material proposal answer which requirement it satisfies, threatens, or leaves unverified.

### Branchable options and simulation

A person can ask for several alternatives without contaminating the accepted model. Each design scenario retains the same source revision and comparable viewpoints while exposing geometry, quantities, requirements, cost, schedule, carbon, energy, constructability, maintainability, and other available outcomes.

Every result shows its inputs, method, units, uncertainty, and completeness. Approximate analysis informs a decision; it does not present false precision as approval evidence.

### Issued deliverables and lifecycle packages

The model must produce dependable sheets, annotations, schedules, quantities, baselines, and issue packages. An issued baseline records the exact model revision, views, requirements, open exceptions, approvals, and evidence delivered at a project stage.

Scoped external review rooms let clients, contractors, fabricators, and operators participate without receiving full authoring access. Field observations, commissioning records, manuals, warranties, and maintenance information remain linked through construction and handover.

Across these capabilities, the product should show an editable intent contract before expensive agent work begins and a decision-focused control tower for blocked work, conflicts, stale evidence, and human decisions.

## Product invariants

- The accepted model changes only by creating a new immutable revision.
- A 2D, 3D, or VR interaction captures intent; it does not silently commit model state.
- Stable entity identities and source revisions anchor every proposal.
- Work context changes presentation and defaults without granting access, tool permission, or approval authority.
- Any participant with proposal access can suggest cross-discipline work; the responsible authorities review its affected aspects.
- Mandatory findings and connected impacts remain visible across role, phase, and model-scope boundaries.
- External values retain their source system, external identity, data authority, units, time, and freshness.
- Operational observations remain distinct from accepted design properties.
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

1. Choose a sample project, open its overview, and inspect the active work context.
2. Select a mechanical detailed-design context for level 03, then navigate the same accepted revision in a shared 3D view and a templated 2D plan.
3. Open one discipline workspace, inspect property provenance, and follow one room to a simulated externally owned room record.
4. Select a pump and distinguish a simulated live observation from its accepted design properties.
5. Drag a visual target, add a measurement and comment, confirm the interpreted intent, and submit it.
6. Let a discipline work agent prepare a bounded proposal and impact analysis.
7. Switch to the electrical reviewer context and review both mechanical and electrical impact packages, with exact-content approval requirements.
8. Demonstrate delegated agent approval for a safe metadata change while retaining human approval for geometry and coordination.
9. Apply the approved change as one new revision and inspect its semantic delta and audit trail.

VR hardware is not required for this first slice. The intent record should nevertheless be designed so a later review walk can produce the same anchored requests.

## Not yet promised

This vision does not yet promise unrestricted free-form geometry, production-grade VR hardware support, production connectors to named external systems, operational control of building equipment, autonomous approval of coordination geometry, regulatory approval, or replacement of professional engineering judgment. Those capabilities require separate evidence and explicit product and governance decisions.
