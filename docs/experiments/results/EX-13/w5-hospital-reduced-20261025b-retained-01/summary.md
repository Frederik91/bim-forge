# EX-13: w5-hospital-reduced-20261025b-retained-01

Outcome: inconclusive. Execution: cancelled.

The declared bounded persistence workload preserves source/query/history behavior within its admitted fixture and exploratory limits.

Variant: w4-generator; reduced; history=2; original hospital-reduced-20261025b.

- execution-failure: failed; expected Admitted workload completes; observed canceling statement due to user request
- exploratory-p95-entity-detail: failed; expected Predeclared exploratory p95 <= 300 ms; successful single-client samples required; observed {"operation":"entity-detail","budgetMs":300,"n":0,"errors":0,"p95Ms":null,"passed":false}
- exploratory-p95-page-query: failed; expected Predeclared exploratory p95 <= 1000 ms; successful single-client samples required; observed {"operation":"page-query","budgetMs":1000,"n":0,"errors":0,"p95Ms":null,"passed":false}
- exploratory-p95-one-hop: failed; expected Predeclared exploratory p95 <= 1000 ms; successful single-client samples required; observed {"operation":"one-hop","budgetMs":1000,"n":0,"errors":0,"p95Ms":null,"passed":false}
- exploratory-p95-bounded-delta: failed; expected Predeclared exploratory p95 <= 2000 ms; successful single-client samples required; observed {"operation":"bounded-delta","budgetMs":2000,"n":0,"errors":0,"p95Ms":null,"passed":false}
- exploratory-p95-bounded-acceptance: failed; expected Predeclared exploratory p95 <= 4000 ms; successful single-client samples required; observed {"operation":"bounded-acceptance","budgetMs":4000,"n":0,"errors":0,"p95Ms":null,"passed":false}

Limitations:

- Retrospective metadata publication only; the original experiments were not rerun.
- Original invocation ID hospital-reduced-20261025b; record ID adds a retained-01 suffix without replacing prior attempts.
- Evidence root is /ssd1/bim-forge-qualification/qvm-20261025/artifacts; paths and SHA-256 bind retained private artifacts.
- Every definition assertion is conservatively partial or not-covered. Full hospital load and independent selection verification are not included in this record.
- Database-only synthetic metadata does not qualify geometry, a real hospital inventory, engineering approvals or production adoption.
- Global PG/WAL metrics include other correctness activity; no comparative speedup, isolated capacity result or product SLO is claimed.
- Run start is the retained environment timestamp; finish is observation-file persistence time, not a fabricated benchmark clock.
- Runner CPU/memory fields describe the Node container; exact PostgreSQL limits/settings are separately retained in config and metrics artifacts.
- Failed behavior is retained as evidence.
- Coordinator cancellation of its scoped backend interrupted reference validation; initial publication rolled back. No completed load/oracle is claimed.
