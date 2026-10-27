# Completed PR integration

Issue #195 follows the maintainer request to approve and merge completed PR work and publish one combined server preview.

- Audit every open branch against current `main` and earlier aggregate #188. Preserve evolved product behavior from #193; do not replay superseded component implementations.
- Combine genuine research, qualification and viewer-benchmark work. Resolve only integration seams in root package scripts/dependencies, TypeScript source coverage and shared documentation. Retain all applicable tests and strict validators.
- Keep experimental PostgreSQL/native/hospital runners opt-in. Importing tooling must not run a large admission, modify live models or restart paused automations. Historical failed/timed-out/partial results remain labelled accurately.
- Verify root validation/build, changed-path policy, experiment contracts and combined application tests in isolated server containers. Fix review blockers with source-bound evidence before merging candidates.
- Publish matched immutable runtime/static assets with a consistent private rollback snapshot; compare accepted/source tables and request/project identities before and after cutover. Browser smoke remains read-only on the user preview.

No accepted model entity, relationship, parameter or revision is intentionally modified by this integration.

## Content disposition

The repository requires linear history and squash merges. This integration brings completed content forward without replaying older application implementations or claiming that the historical pull requests were individually merged.

| Canonical contribution | Included pull requests |
| --- | --- |
| Publication investigation #166 | #121, #131, #132, #133, #147, #158, #166 |
| Batch persistence #157 | #136, #143, #144, #145, #146, #149, #150, #155, #157 |
| Semantic experiment #134 | #134 |
| Geometry regeneration #135 | #135 |
| IFC experiment #137 | #137 |
| Hospital generator #138 | #138, including its raw artifact archive |
| Recovery experiment #139 | #139 |
| Allocation probe fix #160 | #160 |
| Native compute design #154 | #154 |

The changes of #143, #145 and #150 are patch-equivalent to commits in #157. Earlier application components #167, #168, #169, #170, #176, #177, #178, #179, #180, #186 and #187 were already integrated through #188 and evolved further in #193. They must not be replayed over the current application. Closing superseded originals requires the maintainer's separate approval under AGENTS.md.

The viewer benchmark #194 is integrated with its review fixes: Babylon geometry remains valid when all instances are replaced; the candidate deadline includes cleanup; completed evidence requires the actual requested checks and sample counts. The new regressions are part of the default test command. The production viewer remains Babylon.js.

## Verification and limits

- Server snapshot `51c7962`: root validation passed for 228 TypeScript sources; five qualification contract tests and 22 semantic/storage boundary tests passed. Six allocation-probe scenarios passed, including timeout and malformed/missing evidence rejection.
- The same snapshot passed the complete application suite: 640 passed, two intentional skips, zero failures. Application/runtime/deployment files are identical to #193 at `38b435d`.
- IFC head `fea3e22`: root/scoped validation, three TypeScript tests and eight Python tests passed. Latest preparation produced 85 passing observations, 16 passing EXPRESS checks and four passing canonical-hash comparisons; 94 artifact hashes/sizes verified. Its negative control was rejected correctly.
- Viewer review fixes have source-bound isolated-server evidence: 31 Babylon/scene checks and 36 runner/evidence checks passed. Both adapters completed a three-cycle browser replay using SwiftShader. This is correctness evidence, not GPU or large-project qualification.
- The final combined snapshot, its validator output and application tests are recorded in the integration PR. Server evidence is retained under `/ssd1/bim-forge-qualification/all-ready-195/`; IFC preparation evidence is under `/ssd1/bim-forge-qualification/issue195-ifc137-20261027-a01/`.
- Combined source `8ad2460` passed 656 tests with three documented skips and zero failures. Five qualification contract tests also passed. The subsequent `073ca38` adds those same contract tests to default CI and documentation; its root validation, build and explicit 432-path policy check passed. Merging #194's final main commit `d191a18` into the aggregate preserved the qualified tree exactly. The skipped browser case lacks cached Chromium; two other skips are existing application cases.

No new full-hospital admission was authorized or run. The three historical hospital failures, incomplete controller terminal evidence, IFC property preservation loss, inconclusive semantic/recovery outcomes, broader topology gaps and unqualified native-compute speedups remain visible findings. The viewer fixture remains synthetic and `qualified: false`; no engine winner or 200,000 m² performance claim is made.

The optional fresh PostgreSQL edge-case run stopped after three setup failures before any test executed. A corrected helper is prepared, but its one rerun remains paused for maintainer approval. Existing isolated preview/database data is not used by the experimental runner.

## Preview publication

Build the exact merged commit in server containers, publish matched static/runtime artifacts, retain a private consistent rollback snapshot and compare all accepted versioned/source-table hashes plus project/request identities across cutover. Preserve the active ChatGPT connection and verify the published workspace without submitting or accepting changes in a live project. The release is a development preview; opt-in experiments are not started by deployment.
