# Hospital generator wire format v1

W4 / issue #127, stacked on W0 contract foundation
`4fb723bc29a0fced971b3f4b2069e0fa31699a68`.
This is synthetic qualification input. W4 generator correctness checks pass on the
server; full generation, database ingestion and qualification remain pending.

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

Entity IDs are positive integers, contiguous starting at 1 in the canonical
profile kind order (`KINDS` in `profile.ts`); ordinal is 1-based within a kind. Relationship
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
skeleton and nested spatial paths are site -> building -> level -> zone -> space.
Hosted objects are contained in their wall; supported objects are contained in
their slab or containment segment. Walk that path to reach their space. Types
belong to the site, systems to buildings, and circuits are typed electrical
occurrences. No duplicate edges are added to fill a target.

System domain is determined by system ordinal modulo 3: ordinal 1,4,7,... is
electrical; 2,5,8,... is air; 3,6,9,... is water. Ports use a class/nominal connector
size shared within a system. This compatibility is a synthetic metadata rule.
It does not qualify engineering flow, circuit design or physical connectivity.
`connectedTo` is undirected in meaning but stored once with increasing port ID.
`parameterDependsOn` is occurrence -> definition or host/support; its JSON metadata
binds the parameter row. `externalBinding` is occurrence -> its class definition,
with a synthetic source URI. `provenance` is occurrence -> source project/site.
The profile's `correspondsTo` has zero rows: this dataset does not fabricate a
second imported representation.

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
generated manifest, never guessed by a loader. The prepared full topology predicts
18,742,644 relationships and 145,118,512 logical property values (272 above the
estimated property total because small kinds round cohorts independently).
These are analytical expectations awaiting server verification. Count logical property values
exactly, rather than asserting the profile's 145,118,240 estimate is measured.

Cohort sizes use exact decimal arithmetic before flooring. In particular, 70% of
1,400,000 studs is 980,000, and 70% of each 180,000-kind inventory is 126,000.
Binary64 multiplication incorrectly rounds these products below their integers;
flooring that result inflates the 176-value remainder by one per kind. That bug
added 160 values each for studs, outlets and duct segments, explaining the failed
145,118,992 oracle. Exact decimal allocation restores 145,118,512: the only excess
over the profile estimate is site rounding (+144) and building rounding (+128).
The independent test uses integer ratios 7/10 and 1/4; the generator precomputes
decimal cohort boundaries once per kind. The same correction applies to payload
cohort boundaries. Previously generated hashes must be regenerated from this source.

The correction passed seven generator tests in the leased `bim-qvm-w4-debug`
container (0.5 CPU, 1,536 MiB), including the independently reproduced then fixed
boundary regression. Scoped TypeScript checking passed against the combined
integration source. `npm run validate` passed against an isolated W4 source copy
(121 TypeScript sources); the combined W4/W5 copy requires W5's `pg` dependencies,
which are absent from the unmodified tools image. No database load or full dataset
generation ran during this correction.

`--table manifest` emits one JSON object. It streams all three tables internally
without storing them, computing SHA-256 of their **exact escaped TSV bytes**,
row/byte counts, counts by kind, property counts, payload/property byte statistics,
degree statistics and deterministic query/delta oracles. It is intentionally a
separate generation pass. W5 can tee each live stream through a SHA-256 tool to
compare against manifest hashes without retaining large input files.

The manifest binds every generator implementation file to committed bytes using
W0 `bindingFor`. Its source mount must be a real Git clone, such as a bundle clone
on `/ssd1`, with a clean checkout of the source commit. A bare copied directory or
a Windows worktree `.git` pointer is insufficient. Data-only tables do not invoke Git.

Generation retains 35 ID ranges, system-sized port partitions, bounded row buffers
and exact histograms; it has no map or array of all entity IDs. Payload cohort
assignment is a seeded bijection, preserving exact global byte-cohort sizes and
spreading large payloads across kinds. Each blob is exactly 256, 2,048 or 32,768
UTF-8 JSON bytes at the current profile. The first at most 64 payloads per byte
cohort supply explicitly labeled compression/deduplication samples.

`check.ts` emits W0 `Observation[]` to stdout, with nonzero exit on failed checks.
Its independent endpoint/degree maps are restricted to smoke or smaller, at most
10,000 entities. This checker is deliberately separate from the memory-bounded
data producer. `generator.test.ts` prepares seven server test cases, including odd
port counts, seed variation, COPY escaping and full analytical cardinalities.
No local build/test has run; no qualification result is asserted. The observations
cover generator correctness only. W5/W0 must account for every remaining EX-13
assertion before publishing a terminal result; these observations carry limitations.

## Prepared server commands

Only the coordinator runs these commands in an allocated slot. They have not run.
`W4_SOURCE` is an actual clean Git bundle clone of the handed-off source commit on
`/ssd1`. The tools image supplies dependencies under `/app/node_modules`; create
a `/node_modules` symlink inside each disposable container before running Node.
`W4_EVIDENCE` is a unique run directory on `/ssd1`, retained with source/image
bindings. Pin the tools image ID supplied by the coordinator; these examples use
the immutable image ID rather than the mutable tag.

```bash
set -euo pipefail
: "${W4_SOURCE:?actual source Git clone on /ssd1}"
: "${W4_EVIDENCE:?unique allocated evidence directory on /ssd1}"
W4_IMAGE=sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff
mkdir -p "$W4_EVIDENCE"
docker run --rm --cpus=1 --memory=2g \
  -v "$W4_SOURCE:/workspace:ro" -w /workspace "$W4_IMAGE" \
  sh -c 'ln -s /app/node_modules /node_modules && npm run validate && /app/node_modules/.bin/tsc --noEmit -p benchmarks/hospital/generator/tsconfig.json && node --test benchmarks/hospital/generator/generator.test.ts' \
  >"$W4_EVIDENCE/validation.log" 2>&1
docker run --rm --cpus=1 --memory=2g \
  -v "$W4_SOURCE:/workspace:ro" -w /workspace "$W4_IMAGE" \
  sh -c 'ln -s /app/node_modules /node_modules && node benchmarks/hospital/generator/check.ts --scale smoke' \
  >"$W4_EVIDENCE/observations.json" 2>"$W4_EVIDENCE/check.stderr"
docker run --rm --cpus=1 --memory=2g \
  -v "$W4_SOURCE:/workspace:ro" -w /workspace "$W4_IMAGE" \
  sh -c 'ln -s /app/node_modules /node_modules && node benchmarks/hospital/generator/cli.ts --scale smoke --table manifest' \
  >"$W4_EVIDENCE/manifest-smoke.json" 2>"$W4_EVIDENCE/manifest.stderr"
```

The optional W5 integration pipeline below requires its tables and database
container first. It generates directly into COPY and retains only the hash, not
an on-disk input TSV. It is not authorization for a full job. First use smoke;
then admit reduced/medium/full only in coordinator-allocated slots. Both sides
must use the same source commit, profile, seed and scale as the manifest.

```bash
: "${W5_PG_CONTAINER:?disposable PostgreSQL 15 container}"
: "${W5_PG_USER:?database user}"
: "${W5_PG_DATABASE:?disposable database}"
W4_SCALE=smoke
for table in entities relationships parameters; do
  docker run --rm --cpus=1 --memory=2g \
    -v "$W4_SOURCE:/workspace:ro" -w /workspace "$W4_IMAGE" \
    sh -c 'ln -s /app/node_modules /node_modules && exec node benchmarks/hospital/generator/cli.ts "$@"' sh --scale "$W4_SCALE" --table "$table" \
    2>"$W4_EVIDENCE/$table-generator.stderr" \
  | tee >(sha256sum >"$W4_EVIDENCE/$table.sha256") \
  | docker exec -i "$W5_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 \
      -U "$W5_PG_USER" -d "$W5_PG_DATABASE" \
      -c "COPY $table FROM STDIN WITH (FORMAT text)" \
      >"$W4_EVIDENCE/$table-copy.log" 2>&1
done
```

W5 should supply explicit COPY column lists from the stable table above if its
physical schema has extra or reordered columns. Add FK/type/cardinality checks
before timing. Compare the live hashes with `manifest.tables[table].sha256`.
The resource limits above are proposed correctness/generator envelopes, not
measured peak memory or authority to consume a server execution slot.

History, branches and rejected proposals are recipes/oracles for W5; this stream
materializes the initial revision only. External artifact bytes, real IFC, solver
execution, database latency, recovery and approval behavior remain unqualified.
