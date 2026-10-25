# Qualify an admitted hospital branch (#142)

Plan: add only `qualification.ts`, `qualification.test.ts` and this guide. Reuse
`Storage` and the fixed-template `verifySelections` oracle. Verify source-bound
load fidelity, then sample reads and two durable metadata commits on one entity.
Acceptance evidence is strict/root validation, rejection cases and a real PG15
smoke run in a separate server database. Main owns full execution and final review.

Import `runQualification` from `benchmarks/hospital/workloads/qualification.ts` in
main's server-side driver. Pass the config below and a **new** output directory.
Check the returned `passed`; a failed result must cause the caller to fail its job.
No shared CLI changes are needed. `DATABASE_URL` and `QVM_EXECUTION_LEASE` must be
explicit environment variables. One connection is active at a time, including
reconnections after accepted commits. Main must grant the exclusive full-data
slot and enforce the external resource/disk watchdog before invoking it.

```json
{
  "runId": "main-supplied-unique-run",
  "branch": "already-admitted-branch",
  "scale": "full",
  "sourceCommit": "<40 hex characters: prior admission source commit>",
  "manifest": { "file": "/qualification/inputs/manifest.json", "sha256": "<exact source manifest SHA-256>" },
  "admission": { "file": "/qualification/inputs/admission.json", "sha256": "<exact supplied admission SHA-256>" },
  "priorAdmissionDir": "/qualification/artifacts/completed-load",
  "priorSha256": {
    "config.json": "<exact SHA-256>",
    "load.json": "<exact SHA-256>",
    "oracle.json": "<exact SHA-256>",
    "property-values.json": "<exact SHA-256>",
    "observations.json": "<exact SHA-256>",
    "errors.json": "<exact SHA-256>"
  },
  "repeats": 3,
  "pageSize": 50,
  "maximumSelectionRows": 1000000,
  "statementTimeoutMs": 30000,
  "wallTimeMs": 900000
}
```

Compute pins from the completed immutable artifacts before this run. The prior
config must describe EX-13 `load-only`, W4 COPY or generator admission, the same
branch, scale and source commit. Its load record must hash the exact admission
bytes supplied here. Relocated mount paths are supported: content hashes bind
the admission and its source manifest; its SQL is never executed. All table
counts/hashes must match the manifest. Prior expected/actual fingerprint, kind
counts and property counts must agree with the load and manifest. Both successful
`source-query-oracle` and `initial-inventory` observations and empty errors are
required. Full requires exactly 6,777,445 entities, 18,742,644 relationships and
1,500,000 parameters at inventory fraction 1. `smoke` is only for bounded fixtures.

The published head, initial-load revision payload and its hash must still match.
The driver then performs independent space/type/system count and ordered-ID hash
oracles before writes. It records page/detail/one-hop checksums and counts, edits
one document with `qualificationRun`, reconnects to verify the accepted receipt,
delta, current body and pinned history rows, then restores the original document
through a second accepted commit and reconnects again. **The branch head advances
twice.** Its initial revision and all three entity versions remain reviewable.
An interrupted run can leave the marker committed; retain its outputs and let
main choose recovery. The runner refuses to restart from an advanced head.

No schema initialization, import, branch creation, full fingerprint/property scan,
full metrics, recursive historical reconstruction or full branch copies occur in
the runner. Indexed history queries select at most three known revision rows.
Selection reads are capped at 1,000 rows/page and the configured total per oracle;
reaching that cap before exhaustion fails. Interactive pages cap at 100, repeats
at 5. A conservative SQL query upper bound is recorded (including transaction,
configuration and receipt statements); concurrency is 1. Each statement has a
timeout and an overall timer closes the connection at the deadline. Existing
`Storage.accept` reference validation still runs; it can scan the admitted branch
and can time out. The driver does not weaken it.

Output retains exact admission, manifest and six prior artifact bytes with hashes,
raw `samples.ndjson` including failed samples, independent `selections.json`,
accepted proposals with before/after version IDs, bounded history rows, observations,
errors and `result.json` with actual attempted/success/error and committed/verified
change counts. Partial outputs remain after failure. Invalid config or an existing
output directory throws before execution. A local pass describes these exploratory
small samples only; main's combined review owns the terminal qualification status.

Tests require a server container with the tools image, its dependencies, a fresh
`qvm_w5_issue142_*` database, lease and `QVM142_ARTIFACT_ROOT`. Run root
`npm run validate`, `node_modules/.bin/tsc --noEmit --noUncheckedIndexedAccess`,
and `node --test benchmarks/hospital/workloads/qualification.test.ts`. The test
alone initializes/imports its six-record fixture and performs full scans of that
fixture to create and independently check admission evidence. Failed and successful
test artifacts are retained below the explicit artifact root.
