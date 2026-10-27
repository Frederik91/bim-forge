# EX-13: r3-handoff-reduced-20261025a

Outcome: inconclusive. Execution: completed.

The admitted reduced inventory supports exact independent space/type/system oracles and bounded reads plus two durable single-object metadata changes under the declared limits.

Variant: VM-C1 corrected catalog-frequency reader and bounded read-only metadata inspection.

- preserved-admission: passed; expected Bounded qualification check completes with fidelity; observed {"revisionId":"bf51372c05b1f0e0daf9c1e26027778beff85399645f705d5169ab2e78d38188","priorSha256":{"config.json":"479004b4ab4ce0cc4e8c9a87875462736b1ac9c72af0bc3a1751869dc87699cb","load.json":"9c5d59df001d6dc0bfccdde55ccdab252b70f0b0c3c64bfc827f5af722e9a88d","oracle.json":"e8e273cc41dc7048050e72ae48bdfa0fb3bef3836a6118df0f59f91d17934b24","property-values.json":"d77ef6e59688c21bc80435f5f744c66e68f10dfefdfa65da6ee6a3c1b629b35f","observations.json":"29bd750d5f2858e888eda40cdca34aad68f250462b04a0e0d20cb5052c1e6609","errors.json":"37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570"}}
- hot-space-members: passed; expected count=13522; SHA-256 of ascending decimal numeric IDs plus LF=eb4b0fab4abfe4b783e7ae8bc84598184ba1aee26a68ef4472bc670b193e1a2a; observed {"count":13522,"sha256":"eb4b0fab4abfe4b783e7ae8bc84598184ba1aee26a68ef4472bc670b193e1a2a","complete":true}
- shared-type-members: passed; expected count=160; SHA-256 of ascending decimal numeric IDs plus LF=ac7fc98c417007e94c2e40ceca7788d8cae284ad7c6fb3c31f703be0b2d5614a; observed {"count":160,"sha256":"ac7fc98c417007e94c2e40ceca7788d8cae284ad7c6fb3c31f703be0b2d5614a","complete":true}
- system-members-including-ports: passed; expected count=2779; SHA-256 of ascending decimal numeric IDs plus LF=7bdfc9951d56d468ad8594b95aafc045a6afe3410872308368836c39d8d50f29; observed {"count":2779,"sha256":"7bdfc9951d56d468ad8594b95aafc045a6afe3410872308368836c39d8d50f29","complete":true}
- interactive-samples: passed; expected Bounded qualification check completes with fidelity; observed 5 samples per operation; errors=0
- durable-change-0: passed; expected Bounded qualification check completes with fidelity; observed {"head":"a988b770003bb178c224240316c9520b7943c53a5eed2d21b29f41328cc5a87a","version":"008404ac8c831ebb977aa19c3702e69ba593cf8daa2a3401f1ffaa038fb0981b","deltaCount":1,"historyCount":2}
- durable-change-1: passed; expected Bounded qualification check completes with fidelity; observed {"head":"9af46f002f6ebfee26889805f5f82f95a57c969256c272129192e2f78412e05b","version":"8e184772f2b0f9cd9c027e4fe2c14f278a2285792a648e078070bc4d34751e8a","deltaCount":1,"historyCount":3}
- coordinator-bounded-metadata-state: passed; expected Two durable metadata commits preserve the initial revision, exact command receipts, point deltas and original/restored body hashes.; observed {"verified":true,"readCountsVerified":true,"changesVerified":true,"inspectionExitCode":"0"}
- coordinator-synthetic-scope: passed; expected Database-only synthetic and bounded-sample scope remains explicit.; observed reduced admitted inventory; concurrency1, n5 per read, two metadata accepts; no full history/client sweep, geometry or real hospital qualification.
- coordinator-exploratory-detail: passed; expected Every observed bounded detail call completes without error and within the predeclared 300 ms exploratory target.; observed {"n":5,"elapsedMs":[2.5242640000000165,3.367003000000068,2.0575640000000703,2.4970670000000155,2.389318000000003],"errors":0,"targetMs":300}
- coordinator-exploratory-page: passed; expected Every observed bounded page call completes without error and within the predeclared 1000 ms exploratory target.; observed {"n":5,"elapsedMs":[23.171045999999933,43.42995900000005,14.14748499999996,15.298299999999927,49.462318000000096],"errors":0,"targetMs":1000}
- coordinator-exploratory-one-hop: passed; expected Every observed bounded one-hop call completes without error and within the predeclared 1000 ms exploratory target.; observed {"n":5,"elapsedMs":[1.3226439999999684,1.8434180000000424,0.7630570000000034,1.0050150000000713,0.8368080000000191],"errors":0,"targetMs":1000}
- coordinator-exploratory-accepted-change: passed; expected Every observed bounded accepted-change call completes without error and within the predeclared 4000 ms exploratory target.; observed {"n":2,"elapsedMs":[33.33406000000002,11.100044000000025],"errors":0,"targetMs":4000}

Limitations:

- Synthetic metadata and bounded single-object changes do not qualify geometry, discipline approval, real hospital completeness or production adoption.
- Five read samples and two acceptance calls do not qualify tail latency or paced concurrent capacity.
- Bounded per-entity history does not qualify full historical reconstruction, deep full-model aging or multi-parent lineage.
- The inspector reads only selected point metadata and bodies; the runner independently checks exact one-object deltas.
- The reduced stage is additional real-data validation and never substitutes for a failed full trial.
