# W5 version transport byte diagnostic

This is a deterministic transport diagnostic, not a terminal EX-13 result or database benchmark. The active full hospital trial remains on coordinator source `612dd75` with the original duplicate transport. Its eventual outcome must be bound to that implementation; this diagnostic neither changes that run nor establishes an architectural capacity limit. Earlier immutable terminal records are unchanged.

## Source and input

Fix and harness source: `66d2ab564bfe6d75a6347942f35c0ebac461bd3f`. The original expression in `transport-diagnostic.ts` matches `Storage.insertVersions` at `612dd75`. The production change explicitly names the eight scalar SQL columns and complete `body`, instead of spreading the complete envelope outside `body`. SQL, conflict handling, canonical hashing, source preservation, validation and transaction behavior are unchanged. No new adapter or product persistence path is introduced.

Input is the retained actual W4 admission diagnostic `entities.tsv`, SHA-256 `25e83b667e73846f79804fa0f5e8f31ea2777c90af03f48a608b24687f45a624`. Streaming selection takes at most two unchanged rows per kind: 65 of 6,805 rows, covering 35 entity kinds. Typed properties, payload and source remain complete. This sample does not cover all large-payload cohorts or relationship/parameter mixes.

## Exact byte proof

[Raw output](transport-bytes.json) records:

| Query argument | UTF-8 bytes |
| --- | ---: |
| Exact original serialization | 592,443 |
| Actual fixed `Storage.insertVersions` serialization | 311,261 |
| Removed duplicate outer document fields | 281,182 |

The 47.46% reduction applies only to these query-argument bytes. It is not a CPU, ingestion-time, wire-protocol, WAL, storage-size or hospital-throughput measurement. There is no timing comparison or extrapolated speedup.

The harness intercepts the real method's `pg.Client.query` argument without connecting to PostgreSQL. It parses both arguments, projects the exact `jsonb_to_recordset` column shape, and asserts deep equality. The fixed shape rejects extra outer fields. Every complete nested body equals its admitted input, and every version ID equals the canonical hash of that body. It also proves byte savings equal exactly the sum of each removed JSON document field, including key/comma overhead.

- SQL-visible column hash, both variants: `6e7336da8d8537dd521f25c75b7542c3385edcff0e04386973ec19c62b8771e1`.
- Complete body-array hash, both variants: `2031471f8a60172b3f65554fc2eafa4db2f2335f17f7f4c00f4e4a569596a281`.
- Version-ID array hash: `c774fb6945e56edb7157b0b38c56adc26dd690c8415f831f5f2dfcfdf787f5e8`.
- One captured query, zero diagnostic errors. No database execution is inferred from the capture.

## Server validation and retained attempts

Tools image `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`, Node v24.22.1. Both sidecars used `--network none --cpus=.5 --memory=1g`; cgroup settings are retained. Source/check logs live below `/ssd1/bim-forge-qualification/qvm-20261025/artifacts/`.

- `w5-transport-20261025a/`: root validation passed (133 sources), strict W5 typecheck passed. First unit attempt failed to resolve `pg-types` because the cached modules were mounted at `/pgcache` instead of under a `node_modules` directory. Failure logs remain intact. No code or validator was relaxed.
- `w5-transport-20261025b/`: corrected cache mount `/pgcache/node_modules`, 11/11 non-DB tests and 2/2 selected boundary/wire tests passed; exact transport proof passed. Raw JSON, empty diagnostic stderr, source commit, environment and SHA-256 ledger are retained.

Exact executed commands inside these server containers:

```bash
npm run validate
npm --prefix experiments/storage run typecheck
node --test experiments/storage/envelope.test.ts experiments/storage/validation.test.ts experiments/storage/selections.test.ts experiments/storage/transport.test.ts
node --test --test-name-pattern="command boundary|W4 COPY decoder" experiments/storage/store.test.ts
node experiments/storage/transport-diagnostic.ts /diagnostic/entities.tsv
```

Host scripts with the actual mounts and immutable output paths are retained at `/ssd1/bim-forge-qualification/qvm-20261025/sources/w5-transport-check.sh` and `w5-transport-replay.sh`. The retained input was mounted read-only; both containers had no network. Successful root/type checks were not repeated for the mount-only correction.

`transport.test.ts` checks empty batches, the exact allowed transport shape, populated/null projections, complete typed states, Unicode/escaped payload, source metadata and canonical version IDs. Existing PostgreSQL readback/CAS/reference/history tests remain the semantic oracle. They were not rerun while DB jobs were held. After an explicit coordinator lease release, in an assigned isolated database, the pending command is:

```bash
# DATABASE_URL and QVM_EXECUTION_LEASE supplied by the coordinator; never the full-trial DB.
node --test experiments/storage/store.test.ts
```

There were no database writes, performance jobs, hospital generation, full-trial interruption or prior-evidence rewrites in this diagnostic.
