# EX-10: native-history-20261025b

Outcome: inconclusive. Execution: completed.

The pinned entity-version candidate preserves complete source documents, reconstructs immutable history and executes the declared bounded workload within its recorded envelope.

Variant: versioned-postgresql-fixture.

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

- Synthetic metadata and bounded native fixtures do not qualify geometry, rendering, discipline approval, a real hospital or production schema adoption.
- Existing host services remained active; raw correctness-run samples do not establish an isolated performance comparison.
- Closed-loop contention has no paced offered-load model; full branch/churn/client matrix is untested.
- History aging uses six native records at 1000 revisions before mixed traffic; the full hospital/history Cartesian product was not executed.
- The bounded snapshot comparator is a PostgreSQL reference layout, not the existing runtime persistence adapter.
- Exploratory latency targets are unqualified in correctness mode.
