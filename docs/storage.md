# Storage decision

## Recommendation

Use **PostgreSQL plus object storage** as the initial persistence architecture.

PostgreSQL is the source of truth for transactional metadata and queryable BIM indexes. Object storage is the source of truth for immutable, large, or binary artifacts. Keep the two linked by content hashes and explicit provenance records.

## PostgreSQL stores

- projects, users, teams, roles, and policy settings;
- branches, revisions, parent relationships, and merge decisions;
- normalized BIM entities and relationships needed for search and validation;
- issues, agent runs, budgets, prompts/plan identifiers, and run manifests;
- validator runs, findings, review decisions, and append-only audit events;
- object keys, hashes, media types, sizes, and retention metadata.

Use JSONB for extensible IFC/native properties, but keep identifiers, ownership, type, revision, and high-value relationship fields relational. Add a graph database only if measured traversal workloads justify the operational cost.

## Object storage stores

- original IFC/native uploads;
- immutable revision snapshots;
- geometry meshes, thumbnails, and view exports;
- semantic diff bundles and validation evidence;
- logs and reports that are too large for transactional rows.

Artifacts should be immutable, content-addressed, encrypted, and retained according to project policy. Never use object storage as an untracked mutable working directory.

## Independent copies and synchronization

Each participating company can host its own PostgreSQL database and object storage for the agreed shared project data. Treat the source-of-truth responsibilities above as responsibilities within each installation. Project governance determines the accepted revision across installations.

A usable mirror needs revision ancestry, model data, linked files, review evidence, and referenced artifacts within the agreed replication scope. Verify hashes and required content before marking a revision synchronized. Keep the last complete revision usable during interrupted or incomplete transfers. Display that revision and synchronization status to users.

Local startup and continued work must use independently controlled authentication, encryption keys, and stored artifacts. Remote revocation governs future exchange and shared publication. It must not silently delete locally retained history. Retention follows the project agreement, and mirrors still need independent backups.

Use application-level revision and proposal semantics to define synchronization and reconciliation. Database replication alone does not define artifact completeness, model conflicts, or review authority. The initial persistence choice does not commit the project to unrestricted writes to replicated tables.

See [Independent project mirrors](project-mirrors.md) for delivery stages and acceptance evidence. These requirements do not describe an implemented synchronization adapter.

## Why not start with a document database?

A document store is attractive for variable IFC properties, but it makes transactional branching, permissions, audit history, and cross-entity queries harder to reason about. PostgreSQL gives a strong transactional core and already supports JSONB, full-text search, and extensions. A document or graph projection can be added later when actual access patterns demand it.

## Local development

The first local adapter should use PostgreSQL plus an S3-compatible object store. A small fixture dataset must be able to run entirely locally. Tests should use disposable databases and never depend on a shared project.
