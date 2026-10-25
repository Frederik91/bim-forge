# Prepared import experiment

Issue #140, parent #122. Starting source `1146065`. This is a disposable qualification candidate.

The loader prepares each schema-validated entity once. `PreparedEntity` owns canonical UTF-8 content, its existing SHA-256 version identity, logical-property count and explicit-column transport. It retains no mutable source object. Fingerprint accounting, batch bounds, immutable version insertion and staging reuse that identity. Complete source documents and unknown property states remain in the body.

One SQL statement inserts versions and staged identities from the same materialized bounded input. A duplicate staged identity aborts both writes in its batch. Earlier staged batches remain unpublished if a later batch or producer fails. Initial publication still validates every reference and publishes changes, visibility, head and receipt atomically. Existing batch limits remain 250 records or approximately 4 MiB of canonical bodies. A bounded source row can cross the batch threshold.

Database readback hashes each complete body once, using the same result for its fingerprint and stored-version identity check. It does not replace body readback with a hash-column comparison. The temporary stage is analyzed before the publication join, so its planner cardinality describes the actual load.

Acceptance still validates command shape, exact head, declared assumptions, references, immutable history and receipts. Prepared versions replace the previous internal raw insertion API. All callers, including the transport diagnostic, migrate together.

Acceptance evidence comprises canonical equality and producer-mutation tests, malformed-input rejection, atomic batch rollback against real PostgreSQL, existing CAS/reference/history tests, strict TypeScript, root validation and unchanged W0 contracts. All builds and executions use server containers. Performance evidence requires fresh databases, equal resources, alternating input-identical runs and complete readback. No speedup or full capacity is asserted by this source change alone.
