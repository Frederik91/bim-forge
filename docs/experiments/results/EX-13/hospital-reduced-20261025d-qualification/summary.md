# EX-13: hospital-reduced-20261025d-qualification

Outcome: inconclusive. Execution: completed.

The admitted reduced inventory supports exact independent space/type/system oracles and bounded reads plus two durable single-object metadata changes under the declared limits.

Variant: VM-C1 corrected catalog-frequency reader and bounded read-only metadata inspection.

- preserved-admission: passed; expected Bounded qualification check completes with fidelity; observed {"revisionId":"0d78509363231c0f12f4e316fbd0c35576096909e72d09b1b35ed1296934c821","priorSha256":{"config.json":"20cada88a06758a14b62a82c6c5e41770564848d83ba6e3f01581162954788a9","load.json":"6b5de628342942c83265b14362b924d611828c473e0636bc7c6d9655e09a66ee","oracle.json":"e8e273cc41dc7048050e72ae48bdfa0fb3bef3836a6118df0f59f91d17934b24","property-values.json":"d77ef6e59688c21bc80435f5f744c66e68f10dfefdfa65da6ee6a3c1b629b35f","observations.json":"570779efda6f8107f33380f325d2e30e8e2943b82b3d2bda9039e7dd36331ba5","errors.json":"37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570"}}
- hot-space-members: passed; expected count=13522; SHA-256 of ascending decimal numeric IDs plus LF=eb4b0fab4abfe4b783e7ae8bc84598184ba1aee26a68ef4472bc670b193e1a2a; observed {"count":13522,"sha256":"eb4b0fab4abfe4b783e7ae8bc84598184ba1aee26a68ef4472bc670b193e1a2a","complete":true}
- shared-type-members: passed; expected count=160; SHA-256 of ascending decimal numeric IDs plus LF=ac7fc98c417007e94c2e40ceca7788d8cae284ad7c6fb3c31f703be0b2d5614a; observed {"count":160,"sha256":"ac7fc98c417007e94c2e40ceca7788d8cae284ad7c6fb3c31f703be0b2d5614a","complete":true}
- system-members-including-ports: passed; expected count=2779; SHA-256 of ascending decimal numeric IDs plus LF=7bdfc9951d56d468ad8594b95aafc045a6afe3410872308368836c39d8d50f29; observed {"count":2779,"sha256":"7bdfc9951d56d468ad8594b95aafc045a6afe3410872308368836c39d8d50f29","complete":true}
- interactive-samples: passed; expected Bounded qualification check completes with fidelity; observed 5 samples per operation; errors=0
- durable-change-0: passed; expected Bounded qualification check completes with fidelity; observed {"head":"ad074f682aa3fbed2afdfcc03e205c9fa93ac6c4dd0de2b72b0d4fb8e88ac15e","version":"78bb69ff161861609fccb06bd859d0adbb30e704f5678eb379af1e98ce3894af","deltaCount":1,"historyCount":2}
- durable-change-1: passed; expected Bounded qualification check completes with fidelity; observed {"head":"3127240c3a0415fe18d5138081e9f7d1428d312e1c655af463c16996d7ace716","version":"8e184772f2b0f9cd9c027e4fe2c14f278a2285792a648e078070bc4d34751e8a","deltaCount":1,"historyCount":3}
- coordinator-bounded-metadata-state: passed; expected Two durable metadata commits preserve the initial revision, exact command receipts, point deltas and original/restored body hashes.; observed {"verified":true,"readCountsVerified":true,"changesVerified":true,"inspectionExitCode":"0"}
- coordinator-synthetic-scope: passed; expected Database-only synthetic and bounded-sample scope remains explicit.; observed reduced admitted inventory; concurrency1, n5 per read, two metadata accepts; no full history/client sweep, geometry or real hospital qualification.
- coordinator-exploratory-detail: passed; expected Every observed bounded detail call completes without error and within the predeclared 300 ms exploratory target.; observed {"n":5,"elapsedMs":[2.312791999999945,1.9653589999999213,1.9249230000000352,3.836459999999988,2.0822990000000345],"errors":0,"targetMs":300}
- coordinator-exploratory-page: passed; expected Every observed bounded page call completes without error and within the predeclared 1000 ms exploratory target.; observed {"n":5,"elapsedMs":[16.759490000000028,23.28421199999991,13.904839999999922,14.883710999999948,17.487894000000097],"errors":0,"targetMs":1000}
- coordinator-exploratory-one-hop: passed; expected Every observed bounded one-hop call completes without error and within the predeclared 1000 ms exploratory target.; observed {"n":5,"elapsedMs":[1.3144600000000537,0.7072889999999461,0.6647020000000339,1.1315539999999373,0.7197300000000268],"errors":0,"targetMs":1000}
- coordinator-exploratory-accepted-change: passed; expected Every observed bounded accepted-change call completes without error and within the predeclared 4000 ms exploratory target.; observed {"n":2,"elapsedMs":[43.40640700000006,11.591621000000032],"errors":0,"targetMs":4000}

Limitations:

- Synthetic metadata and bounded single-object changes do not qualify geometry, discipline approval, real hospital completeness or production adoption.
- Five read samples and two acceptance calls do not qualify tail latency or paced concurrent capacity.
- Bounded per-entity history does not qualify full historical reconstruction, deep full-model aging or multi-parent lineage.
- The inspector reads only selected point metadata and bodies; the runner independently checks exact one-object deltas.
- The reduced stage is additional real-data validation and never substitutes for a failed full trial.
