# Scoped reference validation (#141)

`validateChangedReferences(client, branch, changedIds, deletedIds): Promise<void>`
checks all five outgoing columns of final changed rows and surviving incoming
references to identities absent after deletion. It resolves targets only in the
same branch. A missing target throws `Dangling reference <entity_id> -> <missing>`,
matching `Storage.validateReferences`. Success returns no value.

Call inside the existing acceptance transaction **after every visibility write**
and before head/receipt publication. Keep the branch lock, head CAS, assumptions,
transaction rollback, and receipt behavior. Pass every inserted/replaced identity
as `changedIds` and every deleted identity as `deletedIds`. Replacements may also
appear in `deletedIds`: final visible presence prevents false incoming failures.
Same-command source deletion/retargeting is resolved from final visibility.

This is equivalent to full reference validation when the branch was valid before
the transaction and the supplied change sets are complete. Unrelated pre-existing
corruption is outside that invariant: initial imports must continue calling the
full validator. This helper does not start/commit/roll back transactions or replace
engineering/schema validators. Main owns the `store.ts` integration.

Both SQL strings are exported for parameterized `EXPLAIN` with `[branch, ids]`.
Outgoing lookups use the visibility primary key; incoming probes use five separate
equality arms and stop at the first surviving reference. Existing schema indexes
already cover these probes. **No additive index SQL is required.** Exact existing
DDL, for integration review only (do not reapply to the current schema):

```sql
CREATE INDEX visibility_type ON qvm_storage.visibility(branch, type_id, entity_id) WHERE type_id IS NOT NULL;
CREATE INDEX visibility_container ON qvm_storage.visibility(branch, container_id, entity_id) WHERE container_id IS NOT NULL;
CREATE INDEX visibility_system ON qvm_storage.visibility(branch, system_id, entity_id) WHERE system_id IS NOT NULL;
CREATE INDEX visibility_from ON qvm_storage.visibility(branch, from_id, entity_id) WHERE from_id IS NOT NULL;
CREATE INDEX visibility_to ON qvm_storage.visibility(branch, to_id, entity_id) WHERE to_id IS NOT NULL;
```

In the coordinator's server container, use a fresh `qvm_w5_issue141_*` database,
`DATABASE_URL`, and `QVM_EXECUTION_LEASE`, then explicitly include the new test:

```sh
node --test experiments/storage/reference-validation.test.ts
```

The package test list is explicit; main must add this file to integrated commands.
Tests use the real `qvm_storage` schema and preserve the full validator as an oracle
for valid starting graphs. Tiny-data `EXPLAIN (ANALYZE, BUFFERS)` records default
plans and verifies index eligibility with sequential scans disabled separately;
this is correctness/plan inspection, not a benchmark or full qualification.
