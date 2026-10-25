# EX-10: w5-native-history-20261025b-retained-01

Outcome: inconclusive. Execution: completed.

The declared bounded persistence workload preserves source/query/history behavior within its admitted fixture and exploratory limits.

Variant: native-snapshot; fixture; history=1000; original native-history-20261025b.

- source-query-oracle: passed; expected All source documents, counts by kind and canonical hashes survive load; observed {"fingerprint":{"count":6,"sum":"0ab1bdb42851512055516f338a1eba49cca2cf7a1dc0187c7e883ab49bff54c3","xor":"b2918eda17dca1f9ca2d8b3fa7fd81af84486edf9df88b6d90991cddf33e55bb"},"countsByKind":{"Door":1,"hosted-by":1,"Wall":4}}
- bounded-baseline: passed; expected Five or more alternating repetitions at existing validated snapshot bounds; observed 5 alternating open-checksum samples per variant
- immutable-reconstruction: passed; expected Initial revision remains identical after aged bounded edits; observed c0559eb7264e0a9b2e3c06381fb2a47a09ef778ba4d05bb88ef799e5bd54f40b
- workload-errors: passed; expected Every executed database operation completes without unexpected errors; observed []
- capacity-scope: failed; expected Full hospital capacity requires admitted full inventory and complete workload coverage; observed fixture: 6 records; 1000 requested history revisions
- exploratory-p95-entity-detail: failed; expected Predeclared exploratory p95 <= 300 ms; successful single-client samples required; observed {"operation":"entity-detail","budgetMs":300,"n":5,"errors":0,"p95Ms":3.6189210000000003,"passed":false}
- exploratory-p95-page-query: failed; expected Predeclared exploratory p95 <= 1000 ms; successful single-client samples required; observed {"operation":"page-query","budgetMs":1000,"n":5,"errors":0,"p95Ms":3.9957339999999704,"passed":false}
- exploratory-p95-one-hop: failed; expected Predeclared exploratory p95 <= 1000 ms; successful single-client samples required; observed {"operation":"one-hop","budgetMs":1000,"n":5,"errors":0,"p95Ms":2.8146610000001147,"passed":false}
- exploratory-p95-bounded-delta: failed; expected Predeclared exploratory p95 <= 2000 ms; successful single-client samples required; observed {"operation":"bounded-delta","budgetMs":2000,"n":999,"errors":0,"p95Ms":0.5777090000001408,"passed":false}
- exploratory-p95-bounded-acceptance: failed; expected Predeclared exploratory p95 <= 4000 ms; successful single-client samples required; observed {"operation":"bounded-acceptance","budgetMs":4000,"n":999,"errors":0,"p95Ms":10.357885000000351,"passed":false}

Limitations:

- Retrospective metadata publication only; the original experiments were not rerun.
- Original invocation ID native-history-20261025b; record ID adds a retained-01 suffix without replacing prior attempts.
- Evidence root is /ssd1/bim-forge-qualification/qvm-20261025/artifacts; paths and SHA-256 bind retained private artifacts.
- Every definition assertion is conservatively partial or not-covered. Full hospital load and independent selection verification are not included in this record.
- Database-only synthetic metadata does not qualify geometry, a real hospital inventory, engineering approvals or production adoption.
- Global PG/WAL metrics include other correctness activity; no comparative speedup, isolated capacity result or product SLO is claimed.
- Run start is the retained environment timestamp; finish is observation-file persistence time, not a fabricated benchmark clock.
- Runner CPU/memory fields describe the Node container; exact PostgreSQL limits/settings are separately retained in config and metrics artifacts.
- Snapshot layout is a PostgreSQL reference storing product-validated full snapshots; it is not the existing runtime persistence adapter.
- Partial storage workload only: no geometry, solver, predicate conflicts, artifact bytes, backup/restore, offered-rate pacing, deletion churn or engineering validity claim.
- Graph and fanout queries are explicitly capped; reference validation scans the entire branch per acceptance.
- Historical reconstruction scans ancestry deltas without checkpoints. Current visibility is copied per branch.
- Type fanout is an indexed instance lookup, not evaluated regeneration. No independently varied 8/32-branch or 64-client matrix is implemented.
- Global PG metrics can include other correctness streams. Full measurements require exclusive scheduling.
- Run is not the warm single-client exploratory scenario; budget qualification is unavailable.
- Six-record native fixture only; 1,000 history revisions are not a full-inventory/history Cartesian run. Snapshot reference is not the existing runtime persistence adapter; latency budgets were ineligible in this correctness scenario.
