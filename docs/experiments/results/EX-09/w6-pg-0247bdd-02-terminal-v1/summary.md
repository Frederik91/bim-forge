# EX-09: w6-pg-0247bdd-02-terminal-v1

Outcome: inconclusive. Execution: completed.

The disposable W5 candidate and governed W6 wrapper preserve immutable history, complete publication, retry receipts and review evidence through the declared recovery cases.

Variant: VM-C1; W5 PostgreSQL 15 candidate plus W6 portable packages and explicitly simulated discipline policy; tiny W0 fixture only..

- pinned-historical-query: failed; expected Query the old accepted revision through its pinned reader before and after schema, dictionary, canonicalization and kernel changes; original model and representation bytes remain unchanged.; observed Partial execution is recorded by postgres-history-format-dictionary-upgrade. A geometry-kernel upgrade has not executed, so the complete EX-09 assertion remains unqualified.
- postgres-history-format-dictionary-upgrade: passed; expected Change a real representation format, property dictionary and serialization while retaining exact old database bytes and querying them with pinned and upgraded readers.; observed Real PostgreSQL retained exact 89204cde3ac2770a3685a2fcabadfd1c23e8bd456d72b921b181bc1972adf124 bytes and canonical version 28f13d249b3ef98e0fcd1cfe7b3071e8342b3cdade4312b94bda1ac51a64fc9e after changing the representation shape, owner dictionary keys and serialization. Both the pinned v1 reader and upgraded reader reopened the historical model. No geometry kernel was executed.

Limitations:

- Terminal interpretation is retrospective; no database or correctness test was rerun to prepare this record.
- Times use retained source-binding and final-observation file mtimes as execution bounds, not instrumented process timings.
- Client limits were 0.5 CPU and 1536 MiB. Separate databases and artifact roots used one PostgreSQL server and test role.
- No real old/new geometry engine is available in this runner. Version descriptor changes cannot substitute for executing an engine upgrade.
- This is a disposable W6 representation format over the W0 fixture. No production schema or geometry engine is migrated.
- No numeric disk budget was recorded in the correctness execution lease. diskBudgetBytes is null; this inconclusive record does not establish a budgeted qualification pass.
