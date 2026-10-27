# EX-13: hospital-reduced-20261025b

Outcome: inconclusive. Execution: cancelled.

The pinned entity-version candidate preserves complete source documents, reconstructs immutable history and executes the declared bounded workload within its recorded envelope.

Variant: versioned-postgresql-reduced.

- execution-failure: failed; expected Admitted workload completes; observed canceling statement due to user request
- exploratory-p95-entity-detail: failed; expected Predeclared exploratory p95 <= 300 ms; successful single-client samples required; observed {"operation":"entity-detail","budgetMs":300,"n":0,"errors":0,"p95Ms":null,"passed":false}
- exploratory-p95-page-query: failed; expected Predeclared exploratory p95 <= 1000 ms; successful single-client samples required; observed {"operation":"page-query","budgetMs":1000,"n":0,"errors":0,"p95Ms":null,"passed":false}
- exploratory-p95-one-hop: failed; expected Predeclared exploratory p95 <= 1000 ms; successful single-client samples required; observed {"operation":"one-hop","budgetMs":1000,"n":0,"errors":0,"p95Ms":null,"passed":false}
- exploratory-p95-bounded-delta: failed; expected Predeclared exploratory p95 <= 2000 ms; successful single-client samples required; observed {"operation":"bounded-delta","budgetMs":2000,"n":0,"errors":0,"p95Ms":null,"passed":false}
- exploratory-p95-bounded-acceptance: failed; expected Predeclared exploratory p95 <= 4000 ms; successful single-client samples required; observed {"operation":"bounded-acceptance","budgetMs":4000,"n":0,"errors":0,"p95Ms":null,"passed":false}

Limitations:

- Synthetic metadata and bounded native fixtures do not qualify geometry, rendering, discipline approval, a real hospital or production schema adoption.
- Existing host services remained active; raw correctness-run samples do not establish an isolated performance comparison.
- Closed-loop contention has no paced offered-load model; full branch/churn/client matrix is untested.
- This run admits only reduced scale; full inventory and its history matrix require separate records.
- One bounded update is insufficient for a tail-latency claim. Correctness retries may reuse staged immutable versions; no ingest-throughput comparison is justified.
