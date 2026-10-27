# Bounded bulk-batch experiment

Issue #156. This candidate raises only the record-count flush threshold from 250 to 5,000. It retains the existing 4 MiB canonical-body flush threshold, producer backpressure, prepared-body identity, SQL staging transaction, atomic initial publication and complete reference/source/body/property validation.

The byte threshold is checked after appending a record, as in the reference. It is not a guarantee of total heap or wire bytes, and may be exceeded by the final record. The record bound also limits object/identifier overhead. This experiment does not introduce a configuration adapter or change a production model.

The hypothesis is that small relationship and parameter documents benefit from fewer staging statements and durable commits, while the byte threshold still causes large-document batches to flush. WAL tuning is a separate experiment. A native rewrite would retain the same commit work unless the batching/data path also changed.

Acceptance evidence: server root/strict checks, existing PostgreSQL storage and qualification-runner regressions, then five alternating fresh reduced admissions per source at identical original CPU/RAM and tuned WAL. Each must retain producer bytes/counts, stored bodies/hashes, kind counts, logical properties and initial publication. Compare complete job and phase duration, client CPU/peak memory, actual WAL syncs/timing and failures. No full-scale performance or memory claim follows from these reduced samples. Main schedules all DB work under its exclusive lease.

Only a source-bound, validated candidate with supporting measurements may proceed to a separately declared medium/full trial. Preserve failed attempts and the reference source in Git. Draft PR only; no merge, deployment or schema adoption. Model delta is empty: the intended final model content is identical.
