# Independent project mirrors

## Purpose and status

BIM Forge aims for participants to work in one shared model. Participants may also link IFC or other CAD models. A shared model must allow each participating company to retain a usable project copy and continue work on its own infrastructure.

If Company A hosts the main server, an outage or dispute must not leave Company B unable to use the project data it already holds. Hosting and project acceptance authority are separate responsibilities.

This document records architecture requirements. Independent mirrors and collaboration between installations are future capabilities. The acceptance scenarios below are implementation gates, not evidence that synchronization already works.

## One logical model across installations

A project has shared entity identities, immutable revision history, and an agreed accepted revision. Several installations can store that project. Each installation has its own database, object storage, accounts, and operational control.

A branch identifies a line of work from a known revision. Local work preserves the common history and stable entity identities. Participants exchange revisions and reviewable model proposals. They do not need to export and reimport separate discipline models to collaborate.

During disconnection, installations can have different branch tips and different knowledge of the accepted revision. Each installation must display its last verified synchronized revision and synchronization status. Continuing locally does not imply access to future changes or authority to publish to the shared project.

## Independent mirror

A mirror receives the agreed shared project data and retains the material needed to use that data independently. The replication scope and retention agreement define what the mirror receives and keeps.

Within that scope, a usable copy includes:

- Model snapshots, entity identities, relationships, and revision ancestry.
- Branch history, model proposals, review decisions, and provenance needed to interpret the mirrored revisions.
- Linked files and other referenced artifacts needed to open, validate, and continue the model.
- Validator findings, semantic deltas, and review evidence associated with those revisions.

Company B controls its own storage, authentication, and encryption keys. Its installation must start and operate without Company A's identity provider, artifact URLs, or key service. Private credentials and unrelated company data are outside the mirror scope.

The mirror must verify content hashes and required artifact completeness before declaring a revision synchronized. Interrupted transfers must resume safely. Repeated transfers must not duplicate revisions or evidence. Missing or corrupt content must leave the last complete revision usable and mark the newer revision incomplete.

If A becomes unavailable or revokes future access, B can open its last complete revision and create a local branch. B can prepare AI proposals, inspect deltas, and run validators using independently configured services. The UI must identify any unavailable optional service.

Remote deletion or access revocation must not silently erase B's retained history. Local retention follows the project agreement and applicable obligations. A mirror cannot recover changes it never received, and replication does not replace independent backups.

## Collaboration between installations

Both companies can run BIM Forge and exchange proposals and accepted revisions while connected. Each proposal carries its source revision, entity-level changes, artifacts, validation evidence, and provenance. The receiving installation verifies the proposal and applies its project review policy.

Project governance defines who can accept changes and how participants recognize the accepted revision. Hosting a server alone grants no acceptance authority. Conflicting claims about the accepted revision must remain visible for reconciliation. Disconnection does not elect a new project authority automatically.

Reconnection preserves both companies' work. Reconciliation uses the common ancestor and semantic model deltas. Conflicts can involve the same entity, incompatible relationships, or coordination between different entities. Geometry and coordination changes require human review and the applicable validation evidence before acceptance. Synchronization must never choose a geometry result solely because it arrived last.

For example, A and B both start at revision 100. A moves a wall while B routes a duct through the wall's new position. Reconciliation must retain both proposals and expose the clash. An engineer reviews the combined result before a new accepted revision records the decision.

The mirror agreement defines which data participants may receive and retain. Current permissions govern future exchange and shared publication. Local continuation from retained data does not grant access to another company's private branches or override project acceptance policy.

## Storage implications

The [storage decision](storage.md) remains PostgreSQL plus object storage. Each installation must hold both the revision metadata and the referenced artifacts needed for independent use.

Project synchronization exchanges versioned project records and immutable artifacts. A database replica alone does not establish model conflict rules, review authority, or artifact completeness. The synchronization protocol, identity trust, supported version compatibility, and acceptance authority mechanism need separate implementation decisions.

## Delivery order

1. Preserve stable identities, immutable revisions, provenance, and portable artifacts in the model kernel and storage design.
2. Deliver a verified mirror with independent startup, visible synchronization status, and a local continuation branch after disconnection.
3. Add proposal exchange and reconciliation between independent installations, with semantic conflict checks and human acceptance.

Each stage needs its own scoped issue, fixtures, validator assertions, and review evidence. A documentation change does not authorize a schema migration or deployment change.

## Acceptance evidence

Use a disposable project fixture with two installations, independent storage, and independent authentication. Include a wall, a duct, a linked model, revision history, and a reviewed proposal with validation artifacts.

The implementation must demonstrate these scenarios:

1. Synchronize an agreed revision and verify its metadata and referenced artifact hashes. Record the revision and transfer completeness in an inspectable report.
2. Interrupt and repeat synchronization. Verify that the receiver resumes without duplicate revisions or evidence.
3. Withhold an artifact and corrupt another artifact. Verify that the receiver rejects completeness for the affected revision and can still open the last complete revision.
4. Stop A's server and block access to its identity, key, and artifact services. Verify that B can authenticate locally, open the synchronized model and linked model, and inspect retained history and evidence.
5. On B, prepare and validate a local model change. Inspect the before and after delta and confirm that the source revision remains unchanged.
6. Restore connectivity with future exchange denied. Verify that B retains local work and agreed history, while A rejects unauthorized publication and data access.
7. Restore authorized exchange after both companies prepare divergent changes. Use the wall and duct example to verify that both proposals survive and coordination validation reports the clash.
8. Verify that the conflicting result cannot become the accepted revision until an authorized human reviews it. Retain the resulting delta, validator output, and acceptance decision.

These checks must distinguish local branch progress from the project's accepted revision. They must also show what B can continue when no further changes arrive from A.
