# Storage direction and current implementation

## Implemented preview storage

The current bounded preview uses **SQLite**, not PostgreSQL or an S3 adapter. `demo/change-requests.ts` owns the queue connection; `demo/versioned-project-store.ts` stores immutable item bodies, parent-linked revision changes, manifests/references, review records, and accepted project/design pointers. Acceptance is transactional with retained request/decision evidence. Uploaded source bytes and project evidence have dedicated server stores.

Server project state is authoritative. Legacy IndexedDB records are read-only recovery material, and importing a stale browser copy cannot overwrite an existing accepted head. The command-line server defaults to `.bim-preview/bim-change-requests.sqlite`, or the configured `CODEX_HOME` directory. See the [workspace guide](room-demo.md), [versioned house contract](design/versioned-house-slice-161.md), and [private deployment/backup instructions](../deploy/preview/README.md).

The store preserves the bounded portable model contract, including a 256 KiB document ceiling and revision/collection limits. Runtime operations still reconstruct complete portable house documents. This is not hospital-scale persistence, a level-streaming API, multi-user authorization, or an independent-installation synchronization adapter.

## Proposed larger-system recommendation

The larger-system recommendation is **PostgreSQL plus object storage**. It remains a design direction, not the preview implementation or an adopted production schema. The [qualification program](experiments/README.md) records experiments and reviewed failures/limits; passing implementation tests does not qualify the full workload or authorize adoption.

PostgreSQL is the source of truth for transactional metadata and queryable BIM indexes. Object storage is the source of truth for immutable, large, or binary artifacts. Keep the two linked by content hashes and explicit provenance records.

## Proposed PostgreSQL responsibilities

- projects, users, teams, roles, and policy settings;
- branches, revisions, parent relationships, and merge decisions;
- normalized BIM entities and relationships needed for search and validation;
- issues, agent runs, budgets, prompts/plan identifiers, and run manifests;
- validator runs, findings, review decisions, and append-only audit events;
- object keys, hashes, media types, sizes, and retention metadata.

Use JSONB for extensible IFC/native properties, but keep identifiers, ownership, type, revision, and high-value relationship fields relational. Add a graph database only if measured traversal workloads justify the operational cost.

The [native computation proposal](design/native-computation.md) keeps native worker indexes and kernel caches as bounded projections of pinned model inputs. It proposes artifact/array boundaries without a second authoritative graph and separates measured ingestion/PostgreSQL limits from unmeasured Rust benefits. The proposal does not adopt a new persistence implementation.

## Proposed object storage responsibilities

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

## Local development and experiments

The browser workspace currently runs against its SQLite server store; PostgreSQL and S3 are not prerequisites for the local preview. See [CONTRIBUTING.md](../CONTRIBUTING.md) for setup and checks.

The separate persistence qualification code evaluates a PostgreSQL candidate against declared fixtures and workload bounds. Follow the qualification program for disposable database setup, run isolation, budgets, and immutable result records. A future PostgreSQL/S3 application adapter requires its own adoption decision and evidence. Tests must never depend on or mutate a shared live project.
