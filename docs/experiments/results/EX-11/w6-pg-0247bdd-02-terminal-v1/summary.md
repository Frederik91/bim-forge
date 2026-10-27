# EX-11: w6-pg-0247bdd-02-terminal-v1

Outcome: inconclusive. Execution: completed.

The disposable W5 candidate and governed W6 wrapper preserve immutable history, complete publication, retry receipts and review evidence through the declared recovery cases.

Variant: VM-C1; W5 PostgreSQL 15 candidate plus W6 portable packages and explicitly simulated discipline policy; tiny W0 fixture only..

- database-stage-crash: passed; expected Kill a leased dedicated W5 writer after verified artifact staging and before head publication. A fresh connection sees the old head and no receipt or partial accepted state.; observed Actual writer SIGKILL after artifact staging left every database table unchanged. Retry committed exactly one revision and receipt 44e4201239b9b30c9306f003e39f5ad26c705bbcb05c0ed9ed78d9255b786a92 with three evidence records.
- database-after-commit-retry: passed; expected Kill the leased writer after database commit but before acknowledgement. Retry the identical command and payload; SQL reports exactly one revision, head advance and acceptance receipt. Changed payload reuse is rejected.; observed Actual writer SIGKILL occurred after PostgreSQL COMMIT. Identical retry replayed 2e0c847c1798942b016aa7029a0b6e8324465dadcaae870e427e45a652327efc without a table change; changed payload reuse was rejected.
- independent-database-restore: passed; expected Restore metadata into a new dedicated PostgreSQL database and a separate artifact root, then independently query entities, ancestry, branches, reviews and hashes with source access unavailable.; observed Restored complete pg_dump into qvm_w5_recovery_w6_0247bdd_01_restore and a separate artifact root. All table contents, canonical version hashes, paginated branch/historical documents, ancestry, deltas and receipts matched while source DB connections were rejected and source artifact paths were unavailable.
- database-incomplete-artifacts: passed; expected A missing and a corrupt required artifact each prevent database publication; a fresh query still opens the last complete accepted revision.; observed Missing and corrupt model artifacts each prevented governed publication; fresh SQL exports of all tables were byte-equivalent and the retained complete artifact package reopened.

Limitations:

- Terminal interpretation is retrospective; no database or correctness test was rerun to prepare this record.
- Times use retained source-binding and final-observation file mtimes as execution bounds, not instrumented process timings.
- Client limits were 0.5 CPU and 1536 MiB. Separate databases and artifact roots used one PostgreSQL server and test role.
- A process crash at the stated checkpoint is exercised; database-container and host power-loss recovery are outside this case.
- Two databases share a PostgreSQL server and the qvm test role. Separate identity providers, encryption keys and host failure domains are not qualified.
- No numeric disk budget was recorded in the correctness execution lease. diskBudgetBytes is null; this inconclusive record does not establish a budgeted qualification pass.
