# EX-13: hospital-smoke-20261025b

Outcome: inconclusive. Execution: completed.

The pinned entity-version candidate preserves complete source documents, reconstructs immutable history and executes the declared bounded workload within its recorded envelope.

Variant: versioned-postgresql-smoke.

- source-query-oracle: passed; expected All source documents, counts by kind and canonical hashes survive load; observed {"fingerprint":{"count":27075,"sum":"3be02dac0a0cafa8fd2a49756d3307fac8d9788a2b24d218263d7aab2f00c6c5","xor":"f57f282b26eb408243242204a0696107e414af45c21410122b03e62f589542a7"},"countsByKind":{"site":1,"building":1,"level":1,"space":10,"zone":1,"system":3,"typeDefinition":27,"wall":80,"stud":1400,"slab":10,"roof":1,"door":25,"window":15,"chair":60,"desk":20,"bed":5,"cabinet":30,"otherFurnishing":35,"electricalOutlet":180,"switch":40,"luminaire":140,"electricalPanel":5,"circuit":50,"cableSegment":300,"ductSegment":180,"ductFitting":240,"pipeSegment":250,"pipeFitting":300,"pump":5,"valve":100,"terminal":80,"sensor":80,"containmentSegment":100,"equipment":30,"connectionPort":3000,"parameter:dimension":378,"parameter:typeReference":300,"parameter:dependencyInput":300,"parameter:recipe":300,"parameter:hostOffset":222,"containedIn":3804,"instanceOf":3761,"hostedBy":1745,"supportedBy":1020,"memberOfSystem":2080,"boundsSpace":160,"hasPort":3000,"connectedTo":1500,"parameterDependsOn":1500,"externalBinding":100,"provenance":100}}
- bounded-baseline: failed; expected Five or more alternating repetitions at existing validated snapshot bounds; observed No native product snapshot supplied; relative baseline comparison not executed
- immutable-reconstruction: passed; expected Initial revision remains identical after aged bounded edits; observed 036c68df0277ea9d7dc08e92a0d28ecf273978e9b8416c688ccbceca20bb4779
- workload-errors: passed; expected Every executed database operation completes without unexpected errors; observed []
- capacity-scope: failed; expected Full hospital capacity requires admitted full inventory and complete workload coverage; observed smoke: 27075 records; 2 requested history revisions
- exploratory-p95-entity-detail: passed; expected Predeclared exploratory p95 <= 300 ms; successful single-client samples required; observed {"operation":"entity-detail","budgetMs":300,"n":5,"errors":0,"p95Ms":11.998486000000412,"passed":true}
- exploratory-p95-page-query: passed; expected Predeclared exploratory p95 <= 1000 ms; successful single-client samples required; observed {"operation":"page-query","budgetMs":1000,"n":5,"errors":0,"p95Ms":46.88104799999928,"passed":true}
- exploratory-p95-one-hop: passed; expected Predeclared exploratory p95 <= 1000 ms; successful single-client samples required; observed {"operation":"one-hop","budgetMs":1000,"n":5,"errors":0,"p95Ms":3.070757000001322,"passed":true}
- exploratory-p95-bounded-delta: passed; expected Predeclared exploratory p95 <= 2000 ms; successful single-client samples required; observed {"operation":"bounded-delta","budgetMs":2000,"n":1,"errors":0,"p95Ms":0.48250300000290736,"passed":true}
- exploratory-p95-bounded-acceptance: passed; expected Predeclared exploratory p95 <= 4000 ms; successful single-client samples required; observed {"operation":"bounded-acceptance","budgetMs":4000,"n":1,"errors":0,"p95Ms":549.5942319999995,"passed":true}

Limitations:

- Synthetic metadata and bounded native fixtures do not qualify geometry, rendering, discipline approval, a real hospital or production schema adoption.
- Existing host services remained active; raw correctness-run samples do not establish an isolated performance comparison.
- Closed-loop contention has no paced offered-load model; full branch/churn/client matrix is untested.
- This run admits only smoke scale; full inventory and its history matrix require separate records.
- One bounded update is insufficient for a tail-latency claim. Correctness retries may reuse staged immutable versions; no ingest-throughput comparison is justified.
