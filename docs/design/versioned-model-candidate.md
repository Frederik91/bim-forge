# Versioned model design candidate

Candidate: `VM-C1`. Status: proposed, unqualified. Coordinator: [qualification program #122](https://github.com/Frederik91/bim-forge/issues/122). Adoption review: [W7 #130](https://github.com/Frederik91/bim-forge/issues/130). Research basis: [versioned BIM data model](../research/versioned-bim-data-model.md).

This document records the current suggestion so experiments test an identifiable design. It does not describe an implemented storage adapter or authorize a migration. Existing runtime behavior remains at the research report's stated baseline.

## Identity and immutable state

`ProjectId` identifies the logical project independently of an installation. `EntityId` identifies a meaningful object across its history. `EntityVersionId` identifies one immutable authored state. `ContentHash` identifies canonical bytes. `ProjectRevisionId` identifies a consistent model state with explicit ancestry. Branch references can advance without changing existing revisions.

Source identities include source installation or namespace, model lineage, source identifier, and source revision. Native instances keep distinct identities while sharing immutable type or geometry content. A linked model occurrence has its own identity and transform, so repeated links remain distinguishable. Physical, analytical, and functional representations can have separate identities and explicit correspondence.

A project revision resolves exact native entity and relationship versions, source-model revision pins and transforms, schema contracts, and required artifacts. The logical version index need not be one enormous JSON document or one membership row per entity per revision. That physical representation is an experimental decision.

## Relationships, types, and properties

Containment, hosting, placement, support, system membership, dependency, correspondence, and provenance have distinct semantics. Relationships define direction, endpoint types, cardinality, lifecycle, and deletion behavior. Derive inverse indexes from one authoritative representation.

Version relationships separately when they carry independently meaningful state. Keep simple owned references inside the entity version when they have no separate lifecycle. Avoid promoting every scalar or mesh vertex into an independently managed business entity.

Type edits declare affected instances. An occurrence edit must not silently modify other occurrences that share content. Typed properties identify their definition, units, dictionary version, source authority, and provenance. Absent, unknown, conflicting, not applicable, and cleared values remain distinguishable. Observations retain source time and freshness separately from design revisions.

## Proposals and acceptance

A proposal binds a request, immutable base, operations, affected objects, read assumptions, semantic preconditions and postconditions, validation evidence, and required discipline authority. Read assumptions include predicates such as an unobstructed region, not only existing object IDs.

Storage granularity, conflict granularity, and approval scope are separate. Entity conflicts are a conservative starting point. More precise field rules require evidence that independent edits remain independent after regeneration and validation.

Agents work on isolated drafts without holding a central database transaction throughout generation. Acceptance builds a combined candidate against the current head, checks assumptions and authority, regenerates affected state, and validates the resulting model. A short atomic publication advances the expected head and records the new revision, delta, decisions, and application receipt. If the head changes during preparation, the relevant checks repeat.

Preserve the original reviewed proposal. Approval reuse after unrelated changes requires declared equivalence checks and new application evidence. Changes to review-relevant assumptions, evaluated geometry, scope, or authority require renewed review. Failed or unresolved evaluation cannot publish partial accepted state. Retries use command identity and payload equality rather than blind duplicate insertion.

## Geometry, history, and persistence

Authored parameters and constraints, evaluated engineering geometry, and display meshes have explicit roles. A dependency mechanism handles one-way propagation. Cyclic constraints require a bounded solver contract. Stable object identity does not guarantee stable face identity. Semantic anchors, topology evolution, and unresolved attachments must remain inspectable.

Keep the PostgreSQL plus immutable object-storage direction provisional. Store required artifacts and verify completeness before publishing their referencing revision. Preserve canonical bytes and schema, mapping, validator, and geometry-engine versions needed to interpret history. Display and query projections can be rebuilt from pinned inputs.

Independent copies retain the agreed ancestry, model data, required artifacts, and evidence. Incomplete transfers leave the last complete revision usable. Disconnected branches preserve divergent contributions and require governed reconciliation. Server ownership does not itself grant project acceptance authority.

## Open decisions and experiment bindings

| Decision | Candidate or open question | Required evidence |
| --- | --- | --- |
| D-01 | Identity namespaces, occurrences, and split/merge lineage | EX-01, EX-02 |
| D-02 | Relationship ownership and shared-type edit scope | EX-03, EX-07 |
| D-03 | Entity versions with finer conflict components where justified | EX-04, EX-05, EX-06 |
| D-04 | Approval equivalence after reconciliation | EX-04, EX-05, EX-07, EX-12 |
| D-05 | Native authoring with explicit IFC mapping versus narrow IFC-native alternative | EX-02, EX-08 |
| D-06 | Parametric evaluation, stable anchors, and pinned engineering output | EX-07, EX-09 |
| D-07 | Canonical units, coordinates, serialization, and evolution | EX-08, EX-09 |
| D-08 | Version index, current-state indexes, checkpoints, and artifact layout | EX-10, EX-13 |
| D-09 | Publication, retry, completeness, and restore protocol | EX-09, EX-11, EX-12 |
| D-10 | Workload and capacity envelope for a detailed hospital | EX-10, EX-13 |

All decisions remain proposed or open. A documentation check is not experimental evidence for them.

## Candidate changes and adoption

Each run records candidate ID, repository commit, this path, and its SHA-256. The commit and hash are the exact design binding. The ID is a readable label.

An editorial correction can retain `VM-C1` while producing a new commit and hash. A semantic change creates `VM-C2` or a separately named alternative. The coordinator records the reason and which experiment results need repeating. Old run records and design commits stay retrievable.

W7 proposes adoption only after correctness, declared IFC exchange, regeneration, history, recovery, and agreed workload gates have evidence. Unsupported capabilities and capacity failures remain explicit. A maintainer makes the adoption decision before implementation changes the production persistence schema in [#78](https://github.com/Frederik91/bim-forge/issues/78).
