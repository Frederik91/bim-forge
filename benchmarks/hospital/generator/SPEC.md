# Hospital generator wire format v1

W4 / issue #127, based on `f6a7db7c1366eea48a3c677e518efe0f2816383b`.
This is synthetic qualification input. Implementation and server validation are pending.

## Invocation and transport

`node benchmarks/hospital/generator/cli.ts --scale smoke --table entities --seed bim-forge-hospital-200k-v1`

Tables: `entities`, `relationships`, `parameters`, `manifest`. Scale: `smoke`,
`reduced`, `medium`, `full`, or a positive numeric fraction up to 2. The seed is
an arbitrary nonempty string; its default is read from `benchmarks/hospital/profile.json`.
`--profile PATH` overrides that file. Run from the repository root.

Data tables are UTF-8, LF, **headerless TSV in PostgreSQL COPY text format**.
Use `COPY ... FROM STDIN WITH (FORMAT text, DELIMITER E'\t', NULL '\N')`.
Escape backslash first as `\\`, tab as `\t`, CR as `\r`, and LF as `\n`.
SQL null is the two bytes `\N`; JSON null remains the JSON literal `null`.
JSONB cells are ordinary compact JSON followed by this COPY escaping step.
No status messages or manifest are mixed into data stdout. Consumers must check
both producer and loader exit codes (`set -o pipefail`). A broken pipe is failure.

## Ordered columns (stable v1)

| Table | Columns in wire order | Suggested PostgreSQL types |
| --- | --- | --- |
| entities | `id, kind, ordinal, type_id, space_id, system_id, revision_id, properties, payload, source` | `bigint, text, bigint, bigint NULL, bigint NULL, bigint NULL, bigint, jsonb, jsonb, jsonb` |
| relationships | `id, kind, source_id, target_id, revision_id, properties` | `bigint, text, bigint, bigint, bigint, jsonb` |
| parameters | `id, entity_id, name, kind, value, depends_on_entity_id, revision_id, properties` | `bigint, bigint, text, text, jsonb, bigint, bigint, jsonb` |

Entity IDs are positive integers, contiguous starting at 1 in profile
`countsByKind` insertion order; ordinal is 1-based within a kind. Relationship
and parameter IDs are independent positive contiguous sequences starting at 1.
All foreign IDs reference the generated entity table at the **same scale and seed**.
`revision_id=1` denotes this dataset's synthetic initial accepted snapshot;
history/proposals are described as deterministic query/delta oracles, not fabricated
accepted revision records. W5 must create its own revision/branch storage.

Ports have one owner (`hasPort`: owner -> port), no occurrence type, and no direct
spatial containment edge: reach space through owner. Compatible ports connect in
canonical pairs (lower port ordinal -> higher); at most one connection per port.
All other occurrences have one `instanceOf` edge to a class-compatible definition
and one `containedIn` edge. MEP occurrences have one `memberOfSystem` edge. Spatial
skeleton, definitions, zones, circuits and hosting/support rules will be detailed
in the implementation. No duplicate edges are added to fill a target.

Properties are keyed typed values, not EAV rows. Values carry explicit state and
scope; quantities carry units. Count logical values by `jsonb_object_keys(properties)`.
Payload is a separate JSON object with nondegenerate spatial proxy and seeded
synthetic padding; source is a synthetic file/entity/version binding. These are
not real geometry or an IFC export. External artifact references carry URIs only;
no artifact files are materialized.

## Cardinalities and manifest

Full inventory: exactly 6,777,445 entities / 35 kinds, including 3,000,000 ports,
1,400,000 studs and 5,000 definitions. Named scales use the profile's fractions.
Counts round down by kind with a minimum valid skeleton; the manifest reports
every admitted count and rounding difference. Parameters: 1,500,000 at full scale,
scaled and capped by eligible occurrences. Relations follow typed topology,
aiming at the profile's 18,000,000 +/- 15%; exact totals are authoritative in the
generated manifest, never guessed by a loader. Count logical property values
exactly, rather than asserting the profile's 145,118,240 estimate is measured.

`--table manifest` emits one JSON object. It streams all three tables internally
without storing them, computing SHA-256 of their **exact escaped TSV bytes**,
row/byte counts, counts by kind, property counts, payload/property byte statistics,
degree statistics and deterministic query/delta oracles. It is intentionally a
separate generation pass. W5 can tee each live stream through a SHA-256 tool to
compare against manifest hashes without retaining large input files.

Preparation plan: TypeBox profile/CLI boundaries; constant-space arithmetic IDs
and topology; streaming row serializers with backpressure; a manifest collector
and correctness fixture checks. Only coordinator-allocated server containers may
run checks. No local build/test has run; no qualification result is asserted.
