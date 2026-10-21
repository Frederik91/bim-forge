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

## Why not start with a document database?

A document store is attractive for variable IFC properties, but it makes transactional branching, permissions, audit history, and cross-entity queries harder to reason about. PostgreSQL gives a strong transactional core and already supports JSONB, full-text search, and extensions. A document or graph projection can be added later when actual access patterns demand it.

## Local development

The first local adapter should use PostgreSQL plus an S3-compatible object store. A small fixture dataset must be able to run entirely locally. Tests should use disposable databases and never depend on a shared project.
