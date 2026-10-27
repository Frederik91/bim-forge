# EX-13: w5-hospital-reduced-20261025c-retained-01

Outcome: inconclusive. Execution: completed.

The declared bounded persistence workload preserves source/query/history behavior within its admitted fixture and exploratory limits.

Variant: w4-generator; reduced; history=2; original hospital-reduced-20261025c.

- source-query-oracle: passed; expected All source documents, counts by kind and canonical hashes survive load; observed {"fingerprint":{"count":270205,"sum":"7a7dce5cc0865f0bf3aa82a0fe14ca5a115e8a5258b60a4f24442bb7d5600082","xor":"50c0078fc4df5d1d4fca3e065a4ea698cf7d53cae90fceb20a6a9ffe2cce472a"},"countsByKind":{"site":1,"building":1,"level":1,"space":100,"zone":2,"system":20,"typeDefinition":50,"wall":800,"stud":14000,"slab":100,"roof":2,"door":250,"window":150,"chair":600,"desk":200,"bed":50,"cabinet":300,"otherFurnishing":350,"electricalOutlet":1800,"switch":400,"luminaire":1400,"electricalPanel":50,"circuit":500,"cableSegment":3000,"ductSegment":1800,"ductFitting":2400,"pipeSegment":2500,"pipeFitting":3000,"pump":50,"valve":1000,"terminal":800,"sensor":800,"containmentSegment":1000,"equipment":300,"connectionPort":30000,"parameter:dimension":3794,"parameter:typeReference":3000,"parameter:dependencyInput":3000,"parameter:recipe":3000,"parameter:hostOffset":2206,"containedIn":37776,"instanceOf":37602,"hostedBy":17450,"supportedBy":10200,"memberOfSystem":20800,"boundsSpace":1600,"hasPort":30000,"connectedTo":15000,"parameterDependsOn":15000,"externalBinding":1000,"provenance":1000}}
- bounded-baseline: failed; expected Five or more alternating repetitions at existing validated snapshot bounds; observed No native product snapshot supplied; relative baseline comparison not executed
- immutable-reconstruction: passed; expected Initial revision remains identical after aged bounded edits; observed 4b94a0e36c824bb6e0780eba554fdda967c112b4ccdc4957de5e2985c967f59e
- workload-errors: passed; expected Every executed database operation completes without unexpected errors; observed []
- capacity-scope: failed; expected Full hospital capacity requires admitted full inventory and complete workload coverage; observed reduced: 270205 records; 2 requested history revisions
- exploratory-p95-entity-detail: passed; expected Predeclared exploratory p95 <= 300 ms; successful single-client samples required; observed {"operation":"entity-detail","budgetMs":300,"n":5,"errors":0,"p95Ms":1.7994130000006407,"passed":true}
- exploratory-p95-page-query: passed; expected Predeclared exploratory p95 <= 1000 ms; successful single-client samples required; observed {"operation":"page-query","budgetMs":1000,"n":5,"errors":0,"p95Ms":45.135702999992645,"passed":true}
- exploratory-p95-one-hop: passed; expected Predeclared exploratory p95 <= 1000 ms; successful single-client samples required; observed {"operation":"one-hop","budgetMs":1000,"n":5,"errors":0,"p95Ms":0.8914159999985714,"passed":true}
- exploratory-p95-bounded-delta: passed; expected Predeclared exploratory p95 <= 2000 ms; successful single-client samples required; observed {"operation":"bounded-delta","budgetMs":2000,"n":1,"errors":0,"p95Ms":0.3796629999997094,"passed":true}
- exploratory-p95-bounded-acceptance: passed; expected Predeclared exploratory p95 <= 4000 ms; successful single-client samples required; observed {"operation":"bounded-acceptance","budgetMs":4000,"n":1,"errors":0,"p95Ms":1292.3188169999921,"passed":true}

Limitations:

- Retrospective metadata publication only; the original experiments were not rerun.
- Original invocation ID hospital-reduced-20261025c; record ID adds a retained-01 suffix without replacing prior attempts.
- Evidence root is /ssd1/bim-forge-qualification/qvm-20261025/artifacts; paths and SHA-256 bind retained private artifacts.
- Every definition assertion is conservatively partial or not-covered. Full hospital load and independent selection verification are not included in this record.
- Database-only synthetic metadata does not qualify geometry, a real hospital inventory, engineering approvals or production adoption.
- Global PG/WAL metrics include other correctness activity; no comparative speedup, isolated capacity result or product SLO is claimed.
- Run start is the retained environment timestamp; finish is observation-file persistence time, not a fabricated benchmark clock.
- Runner CPU/memory fields describe the Node container; exact PostgreSQL limits/settings are separately retained in config and metrics artifacts.
- Hospital/W0 entity kinds are outside the existing product snapshot contract. Run native-snapshot separately.
- Partial storage workload only: no geometry, solver, predicate conflicts, artifact bytes, backup/restore, offered-rate pacing, deletion churn or engineering validity claim.
- Graph and fanout queries are explicitly capped; reference validation scans the entire branch per acceptance.
- Historical reconstruction scans ancestry deltas without checkpoints. Current visibility is copied per branch.
- Type fanout is an indexed instance lookup, not evaluated regeneration. No independently varied 8/32-branch or 64-client matrix is implemented.
- Global PG metrics can include other correctness streams. Full measurements require exclusive scheduling.
