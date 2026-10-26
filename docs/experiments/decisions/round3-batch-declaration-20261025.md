# Additional bulk-batch comparison declaration

Issue #156, within the approved tuning work #151. Recorded before the batch comparison. The original round-three declaration remains unchanged.

Compare the current 250-record flush threshold with a 5,000-record candidate. Preserve the existing 4 MiB canonical-body flush threshold, which is checked after appending a record. It permits one-record overshoot and does not measure complete wire/heap residency. Keep all producer, schema, hash, reference, atomic publication and complete readback/property checks. Change no model content. Both sources include the same explicit execution-purpose changes from #152; verify that their runtime difference is limited to the record-count threshold.

Use five alternating fresh reduced admissions per source, 8 GiB max_wal_size, loader 1 CPU / 1 GiB and PostgreSQL 1.5 CPUs / 3 GiB. The unchanged host, cache procedure, no-swap setting, checkpoint-before-job procedure, monitoring, aggregate allocation and free-space limits from the round-three declaration apply. Each case has the same 15-minute internal and 16-minute external limit. No competing database measurement.

Compare complete client-job time, ingestion/publication/analyze phases, client CPU and peak, WAL bytes/sync counts/timing and checkpoint counters. Require complete fidelity and no unexpected errors or memory-cap failure in every case. To carry the candidate into the medium/full completion trial on timing grounds, require at least a 10 percent lower median job time and non-overlapping observed job-time ranges. Otherwise retain the reference for that trial and record the result as no demonstrated timing benefit. A micro result or lower commit count alone is insufficient.

Preserve all cases, sources and raw artifacts. No production adoption, merge, deployment or general TypeScript-versus-Rust conclusion follows. The purpose is to test avoidable transaction overhead within the same constrained allocation.
