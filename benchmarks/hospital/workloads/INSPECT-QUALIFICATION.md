# Bounded qualification inspection (#142)

Import `inspectQualification(store, { branch, runId, initialRevisionId })` from
`inspect-qualification.ts`. Main may serialize the returned typed JSON into its
own new evidence artifact after successful qualification or partial failure.
This function returns facts, never a qualification verdict. It does not connect,
initialize schemas, mutate model data, or collect resources. Use an idle, dedicated
connected `Storage` client, with the coordinator's normal timeout/resource controls.
**Do not invoke during the database measurement hold.**

Every read shares one `REPEATABLE READ READ ONLY` transaction. Missing branch,
receipt, revision or selected delta is represented explicitly. Receipt revisions
are branch-filtered; mismatched hashes, command IDs, parents and single-object
command shapes are reported as facts. Invalid initial load/hash/command linkage
prevents selecting source data from that revision. SQL/schema/connection errors
propagate; rollback failure retains both errors in an `AggregateError`.

Read bounds: one branch primary-key lookup, at most three revision primary-key
lookups, two exact command-receipt lookups, three selected change rows, and two
distinct version-body primary-key lookups. The initial source identity is the
first change in the initial load (`WHERE revision_id=$1 ORDER BY entity_id LIMIT 1`),
using the changes primary key. Accepted change rows use exact revision/entity
keys. There are no counts, full history scans, recursive ancestry, visibility
copies, or calls to the loader/validator/qualification runner.

Initial, changed and restored bodies are returned with their version IDs and
hash/entity checks. Restoration normally reuses the initial immutable version,
so at most two bodies are read. If actual metadata points to a third distinct
version, that state's `bodyRead` is `two-body-limit`; its actual version ID remains
visible. Missing versions are `missing`, not success. Selected deltas are point
facts; this inspector does not independently prove there are no unrelated changes
in a revision, nor prove that the current head descends from the initial revision.
Main retains responsibility for terminal/evidence review.

Pure metadata-validation tests can run without PostgreSQL:

```sh
node --test benchmarks/hospital/workloads/inspect-qualification.test.ts
```

Run validation/typechecking only in coordinator-approved server containers.
No database execution or plan/performance qualification is asserted by these tests.
