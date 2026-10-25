# EX-13: w5-hospital-smoke-20261025a-retained-01

Outcome: failed. Execution: completed.

The declared bounded persistence workload preserves source/query/history behavior within its admitted fixture and exploratory limits.

Variant: w4-generator; smoke; history=2; original hospital-smoke-20261025a.

- source-query-oracle: passed; expected All source documents, counts by kind and canonical hashes survive load; observed {"fingerprint":{"count":27075,"sum":"3be02dac0a0cafa8fd2a49756d3307fac8d9788a2b24d218263d7aab2f00c6c5","xor":"f57f282b26eb408243242204a0696107e414af45c21410122b03e62f589542a7"},"countsByKind":{"site":1,"building":1,"level":1,"space":10,"zone":1,"system":3,"typeDefinition":27,"wall":80,"stud":1400,"slab":10,"roof":1,"door":25,"window":15,"chair":60,"desk":20,"bed":5,"cabinet":30,"otherFurnishing":35,"electricalOutlet":180,"switch":40,"luminaire":140,"electricalPanel":5,"circuit":50,"cableSegment":300,"ductSegment":180,"ductFitting":240,"pipeSegment":250,"pipeFitting":300,"pump":5,"valve":100,"terminal":80,"sensor":80,"containmentSegment":100,"equipment":30,"connectionPort":3000,"parameter:dimension":378,"parameter:typeReference":300,"parameter:dependencyInput":300,"parameter:recipe":300,"parameter:hostOffset":222,"containedIn":3804,"instanceOf":3761,"hostedBy":1745,"supportedBy":1020,"memberOfSystem":2080,"boundsSpace":160,"hasPort":3000,"connectedTo":1500,"parameterDependsOn":1500,"externalBinding":100,"provenance":100}}
- bounded-baseline: failed; expected Five or more alternating repetitions at existing validated snapshot bounds; observed No native product snapshot supplied; relative baseline comparison not executed
- immutable-reconstruction: passed; expected Initial revision remains identical after aged bounded edits; observed 036c68df0277ea9d7dc08e92a0d28ecf273978e9b8416c688ccbceca20bb4779
- workload-errors: passed; expected Every executed database operation completes without unexpected errors; observed []
- capacity-scope: failed; expected Full hospital capacity requires admitted full inventory and complete workload coverage; observed smoke: 27075 records; 2 requested history revisions
- exploratory-p95-entity-detail: passed; expected Predeclared exploratory p95 <= 300 ms; successful single-client samples required; observed {"operation":"entity-detail","budgetMs":300,"n":5,"errors":0,"p95Ms":110.50256399996579,"passed":true}
- exploratory-p95-page-query: failed; expected Predeclared exploratory p95 <= 1000 ms; successful single-client samples required; observed {"operation":"page-query","budgetMs":1000,"n":5,"errors":0,"p95Ms":2666.005995000014,"passed":false}
- exploratory-p95-one-hop: passed; expected Predeclared exploratory p95 <= 1000 ms; successful single-client samples required; observed {"operation":"one-hop","budgetMs":1000,"n":5,"errors":0,"p95Ms":10.342117999971379,"passed":true}
- exploratory-p95-bounded-delta: passed; expected Predeclared exploratory p95 <= 2000 ms; successful single-client samples required; observed {"operation":"bounded-delta","budgetMs":2000,"n":1,"errors":0,"p95Ms":0.606335999967996,"passed":true}
- exploratory-p95-bounded-acceptance: passed; expected Predeclared exploratory p95 <= 4000 ms; successful single-client samples required; observed {"operation":"bounded-acceptance","budgetMs":4000,"n":1,"errors":0,"p95Ms":207.3938350000535,"passed":true}

Limitations:

- Retrospective metadata publication only; the original experiments were not rerun.
- Original invocation ID hospital-smoke-20261025a; record ID adds a retained-01 suffix without replacing prior attempts.
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
- The original smoke page p95 exceeded its predeclared budget; the failed observation is retained unchanged.
