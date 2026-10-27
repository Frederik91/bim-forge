# Project HTTP API integration (#197)

Base: `823add10c2c83ce7720552bbdc2f7008a56b9eec`.
Ownership: `demo/server.ts`, `demo/server.test.ts`, and this private API note.
Queue/core, packages and UI remain parent-owned.

## Routes and queries

All paths below start with `/api/projects/:projectId` and reuse existing host,
same-origin, no-store, JSON, error and private-source boundaries.

| Route | Input | Response / existing queue call |
| --- | --- | --- |
| `GET /project-sources` | Optional single `after=<source UUID>` | `{sources,next}` from `listProjectSources(projectId, after)`; fixed 20-item pages |
| `POST /project-sources` | One existing uploaded `RequestSource` manifest, without an envelope | `{source}` from `retainProjectSource(projectId, input)` |
| `GET /evidence` | Optional single `after=<nonnegative safe integer>` | `{entries:[{entry,pin}],next}` from `listEvidence(projectId, after)`; fixed 20-item pages |
| `POST /evidence` | `{commandId,entry}` | `{pin}` from `recordEvidence(projectId,input)` |
| `POST /baselines` | `{commandId,name,from:FrozenDesignTarget}` | `{project,target}` from `designCommand(projectId,'baseline',input)`, mapping its `created` field to `target` |
| `POST /alternatives` | `{commandId,name,baselineId}` | `{project,target}` from `designCommand(projectId,'alternative',input)`, mapping `created` to `target` |
| `GET /history` | Existing `before` and `limit`, plus optional `target=main` or `target=alternative&targetId=<id>` | Existing history page from `history({projectId,before,limit,target})` |

All successful new routes return 200, including idempotent command replay.
Collection GETs accept only `after`, at most once, with no client page-size
override. Empty, malformed, overflowing, duplicate and unknown query fields are
rejected. Evidence cursors use canonical decimal integers. Source cursor project
membership remains queue-owned. POST routes accept no queries. History rejects
duplicate/unknown fields, a missing alternative ID, a main target with an ID,
an ID without an explicit alternative target, and baseline/unknown target kinds.
Omitted target retains legacy main history behavior.

Body caps: source manifest 2 KiB, evidence command 32 KiB, design command 4 KiB.
Queue/domain parsers retain exact shapes, source verification, native anchors,
entry limits, target freshness, idempotency and transactional authority. Unknown
projects return 404, unsupported methods 405, `BacklogConflict` 409 and other
validation errors 400, following existing project routes.

Original source bytes remain available only through the existing same-origin
`GET /api/projects/:projectId/sources/:sourceId`; listing sources/evidence does
not return bytes or introduce another blob path.

## Plan and verification

Add the four bounded route handlers and explicit history target parsing without
queue changes. Extend real-server tests using disposable SQLite and the existing
generated residential fixture. Verify source upload/retention/private retrieval,
project isolation and pagination; evidence append/read/replay/rejection; baseline
and alternative metadata replay/conflict and unchanged native model; explicit
target history; host/origin/query/body/method failures and restart recovery.

Only isolated server containers build or execute tests. Slots:
`/ssd1/bim-forge-qualification/residential197/serverapi-aN`; containers:
`bim-serverapi-aN`; image `bim-qvm-tools:20261025`; read-only dependency cache
`/ssd1/bim-forge-qualification/all-ready-195/final/dependencies`. Each uses at
most one CPU and 2 GiB, network none, read-only root/source/dependencies, and
SSD-backed temporary/build/evidence directories. Ten total interactive attempts
are authorized; validators and global factory policy remain unchanged.

Planned gates are root validation, changed-path policy, demo build and real-server
tests. Known parent dependency integration failures will be recorded precisely
instead of patched in unowned files. No merge, deployment or live data access.

| Attempt | Source / gates | Result and action |
| --- | --- | --- |
| 1 | Archive `8177af054f9a17b83e03015c06fbcb9b5521215787fbaedc74ff5cdabc7f7195` in `serverapi-a1` | Demo build PASS; 14/14 real-server tests PASS, zero skips/failures; changed-path policy PASS for all 3 owned files. Root validation: strict TS lint PASS, typecheck blocked by the two unowned integration errors below. No retry or validator changes. |

Commands run inside the container:

```sh
timeout 180 npm run validate
node scripts/validate-policy.ts --changed-files demo/server.ts demo/server.test.ts docs/issue-197-server-api-privateapi.md
timeout 180 npm run build:demo
timeout 240 node --test --test-concurrency=1 --test-timeout=60000 demo/server.test.ts
```

Strict TypeScript lint scanned 255 source files. Full compilation reported exactly:

```text
demo/versioned-project-store.test.ts(515,115): error TS2353:
  'target' does not exist in the current EvidenceReadSet type.
src/design-targets.test.ts(209,131): error TS2353:
  'target' does not exist in the current EvidenceAnchor type.
```

Those tests expect target-aware evidence schemas, which are being integrated by
the parent. No owned-file type errors were reported. Full compilation is deferred
until the parent resolves that dependency, as requested; no queue/core/test/schema
outside this ownership was edited. Root validation is not claimed green.

Server evidence remains in
`/ssd1/bim-forge-qualification/residential197/serverapi-a1/evidence/`:
`validate.log`, `changed-path-policy.log`, `build.log`, `focused.log`,
`status.tsv`, `source-sha256.txt`, and initial/final container inspection JSON.
The container exited 1 because of root validation, without an OOM kill.
Inspection confirms one CPU, 2 GiB memory/swap maximum, network none and a
read-only root. The final note was completed after the test snapshot; these
TypeScript files match that snapshot byte-for-byte:

| File | SHA-256 |
| --- | --- |
| `demo/server.ts` | `3237ffbc439faf0b4de48679221c6fe3cecad6ec9c37cae6f96d676fd44dc053` |
| `demo/server.test.ts` | `48ac62d9557ad02671ffa02d5937ed1407f5b072cc64c4d8eac2ddafbef0ccdc` |

Five new real-server tests exercise 21-item source and evidence collections with
20-item pages, repeatable commands and conflicting payloads, verified native
anchors, private same-project byte access, foreign project/cursor refusal,
baseline/alternative metadata persistence and explicit history selection,
fresh SQLite sessions, and malformed query/body/origin/host/method rejection.
Accepted geometry and original project bytes remain unchanged by source/evidence
commands; design metadata preserves the main revision and alternative snapshot.
The nine existing server tests also pass. These are disposable fixture checks,
not live preview or combined UI/workflow qualification.

Handoff: integrate this three-file commit onto the parent, reconcile the two
target-aware evidence dependency errors, and rerun root validation plus the
existing server test entry point. One of ten qualification attempts was used.
No package registration, push, PR, merge or deployment belongs to this handoff.
