# Detailed hospital database benchmark

Profile: [`hospital-200k-v1`](profile.json). Area: 200,000 m², confirmed by the project owner. Status: specified, not run. Generator: [W4 #127](https://github.com/Frederik91/bim-forge/issues/127). Database execution: [W5 #128](https://github.com/Frederik91/bim-forge/issues/128). Result: [EX-13](../../docs/experiments/registry.json) in [qualification program #122](https://github.com/Frederik91/bim-forge/issues/122).

## What this profile measures

The benchmark simulates the database workload of a detailed hospital. It does not require drawing a hospital, generating valid construction geometry, or loading millions of meshes into the viewer. Synthetic area and density are declared controls. They are not evidence of a measured real hospital inventory.

The full profile proposes 6,777,445 entities across 35 kinds. This includes 3,000,000 individually identified connection ports, 1,400,000 studs, 180,000 electrical outlets, 180,000 duct segments, 240,000 duct fittings, pipe networks, systems, shared types, and furniture. The profile targets approximately 145 million typed property values, 18 million relationships, and 1.5 million parametric constraint records. These are generation targets or derived estimates, not measured results.

Four buildings with ten levels each provide 40 spatial levels and 10,000 spaces. Include department and system groupings, repeated product families, instance overrides, external references, parameters, and evidence metadata. Individual studs and outlets remain individually identifiable. Connection ports count separately from their owning equipment and runs.

The generator must reconcile exact inventory counts, valid endpoint cardinalities, and generated spatial/system structure. If a requested relationship count conflicts with its validity rules, report the difference. Do not pad the graph with meaningless edges.

W4 has not yet implemented the generator. W5 has not yet implemented or executed the database driver. This directory contains their versioned input contract and measurement requirements.

## Generate a useful graph

Stream seeded records instead of materializing the entire dataset in the generator's memory. Keep generation independent of the production storage choice. Output a manifest and load-neutral records that candidate loaders can consume. The W0 contract defines exact record encoding, schema validation, and content hashes before executable results are accepted.

Use typed containment, host, support, type/instance, port ownership, compatible connectivity, system membership, parameter dependency, source binding, and provenance relationships. Validate all references. Most objects have a small neighborhood; selected systems, types, departments, and levels are high-degree hubs. Report degree percentiles and maxima by relationship kind. Vary graph skew independently of hot-key access skew.

Properties include numeric quantities and units, booleans, repeated classification values, sparse and unknown values, unique identifiers, bounded descriptive text, and class-correlated values. Ports use eight values, type definitions use 80, and other entities have cohorts targeting a mean of 32. Integer cohort rounding and schema choices affect the exact result. The generated manifest records actual counts and serialized byte distributions.

Generate spatial proxies and bounded parameter or recipe payloads with varied seeded values. Avoid identical zero-filled blobs whose compression gives misleading storage results. Record deduplication and compressibility. Keep database proxy bytes, external reference metadata, and any materialized synthetic artifact payloads separate. External dummy payloads require an explicit byte budget and cannot impersonate valid IFC or CAD data.

Add history independently of project area. Exercise 1, 10, 100, and 1,000 accepted revisions, with a nominal 0.1% changed fraction per ordinary revision. Include deleted objects, explicit replacement lineage, relationship changes, rejected proposals, evidence, and 1, 8, and 32 branches. Shared-type edits and system-wide changes exercise large dependent fan-out separately from ordinary churn.

Count entity versions, relationship versions, property values, revision-membership records, proposals, audit data, and artifacts separately. Version sharing can still have expensive full membership indexes. Measure that cost rather than assuming content deduplication makes every revision small.

## Scale and capacity admission

The profile defines smoke, reduced, medium, full, and optional detail-stress scales. Fractions apply to inventory, while preserving a valid skeleton and recomputing relationships. A reduced fixture is a subset of the nominal hospital workload and does not establish full-scale performance. Detail-stress increases assumed detail at the same nominal area.

Before each stage, pin CPU, RAM, disk budget, container images, database settings, and client placement. Estimate capacity using observed lower-stage database, index, temporary, WAL, and backup growth. Full or stress execution starts only when its envelope fits the available server resources. Report a capacity limit when it does not fit. Stop at the declared boundary rather than consuming unbounded host resources.

Run against dedicated databases and volumes in server containers. Preserve the preview and other projects. Reserve an exclusive measurement slot for full performance runs on shared storage resources. Small correctness tests and independent coding can proceed in parallel within their recorded limits.

## Workloads and correctness oracles

| Workload | Required case and oracle |
| --- | --- |
| Open project and navigate | Resolve a revision summary without loading every property or history record. Page room/level contents with expected IDs and byte counts. |
| Inspect an object | Return declared properties, type overrides, source metadata, and connections for an exact revision. |
| Search and schedules | Common and selective predicates, missing values, numeric ranges, department/system joins, sorting, and grouped quantities with known totals. |
| Traverse systems | Bounded one-hop and multi-hop neighborhoods, reverse edges, cycles, ordinary objects, and hubs with exact reachable-set checks. |
| Compare and reconstruct revisions | Nearby and distant revisions, additions, removals, property and relationship changes with exact delta and state hashes. |
| Accept a small proposal | Persist changed versions, audit/evidence references, and one expected-head advancement. Verify no lost changes or duplicate acceptance. |
| Department or type change | Exercise fan-out and large batches while reporting preparation, validation, publication, progress, and effects on foreground requests separately. |
| Concurrent changes | Disjoint rooms, different objects on one head, shared-type dependencies, and deliberately conflicting same-object/head updates. Verify retries and rejection semantics. |
| Backup and restore | Produce and restore a complete versioned package into a fresh instance, then check hashes, counts, ancestry, required artifacts, and queries. |

Define independent expected result sets and invariants. A load row count or matching output from the same buggy importer and exporter is insufficient. Performance observations can be collected during implementation, but qualification requires the relevant correctness evidence from W1-W3.

Compare the current snapshot implementation only within its supported limits. Record limits for larger cases rather than weakening its validators. Compare one candidate layout against the same logical workload, then add alternatives only when a result identifies a concrete reason.

## Measurement protocol

Separate these phases and publish both phase costs and total readiness time:

1. Generation and serialization.
2. Transfer and bulk load.
3. Index construction, constraint validation, and statistics collection.
4. Warm-up and isolated user operations.
5. Aged read/write operation after repeated accepted changes.
6. Mixed traffic, bursts, contention, and backup/restore.

PostgreSQL documents `COPY`, fresh-load index construction, and statistics collection as distinct bulk-load considerations. Keep durability and required constraints in the qualified path. A disposable unsafe ingest variation must remain a separately labeled result. [PostgreSQL 18 population guidance](https://www.postgresql.org/docs/18/populate.html)

Fix workload weights, offered rate, latency/error budgets, duration, and resource limits before measurement. The profile's 90/10 and 60/40 read/write mixes and 1/8/32/64 clients are synthetic scenarios, not claimed usage traces. W0/W5 must fill currently unspecified budgets and rates. Report both closed-loop concurrency and offered-rate behavior, including backlog, retries, timeouts, skipped work, and achieved rate.

Use at least three independently initialized measured repetitions after warm-up. Retain unaggregated operation samples for p50/p95/p99 and variation between runs. Fix dataset and traffic seeds, but do not claim concurrent completion ordering is deterministic. Measure client bottlenecks and database time separately from any implemented API round trip. Custom pgbench scripts can drive database-only operations; its banking workload is not a BIM workload. [PostgreSQL 18 pgbench](https://www.postgresql.org/docs/18/pgbench.html)

Record schema and index definitions, query plans for diagnostics, software and images, settings, CPU, memory accounting, storage, TLS/network setup, cache procedure, maintenance, checkpoints, and resource time series. A process restart does not prove storage-cold access. Use accurately labeled warm, restart, partially cold, or independently verified cold runs. Never flush a shared host's caches. [Cache layers](https://www.postgresql.org/docs/18/pgprewarm.html), [query diagnostics](https://www.postgresql.org/docs/18/sql-explain.html)

Measure database heap/TOAST and indexes without double-counting overlapping totals. Capture temporary and peak disk use, generated and retained WAL, backups, external artifacts, lock waits, deadlocks, failed/retried operations, container peak memory, and maintenance activity. Deliberately retained application versions and obsolete MVCC tuple versions are different costs. [Size functions](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADMIN-DBSIZE), [WAL](https://www.postgresql.org/docs/18/wal-configuration.html), [vacuum](https://www.postgresql.org/docs/18/routine-vacuuming.html), [statistics](https://www.postgresql.org/docs/18/monitoring-stats.html)

Index comparisons preserve the actual predicates. JSONB GIN operator classes support different operators, and a JSONB update locks the containing row. Foreign keys do not automatically index referencing columns. Benchmark the actual candidate indexes and edit granularity. [JSONB](https://www.postgresql.org/docs/18/datatype-json.html#JSON-INDEXING), [constraints](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-FK)

## Result and claim boundary

Use the [program result contract](../../docs/experiments/templates/run-result.json). Pin the exact design, profile, generator, dataset, driver, schema/indexes, seed, settings, and server envelope. Include expected/actual counts, query and delta checksums, raw samples, observed errors, resource peaks, reproduction commands, and limitations. Failed and resource-limited runs remain in the record.

A successful result qualifies a specific configuration for a specific synthetic dataset and workload. It does not establish rendering quality, geometric correctness, real-kernel regeneration, IFC fidelity, AI quality, unimplemented permission checks, or performance on a real hospital model. Those require their own experiments and representative source data.
