# Independent consolidated-record verification

QVM-01 / issue #130, 25 October 2026. The coordinator independently verified all 25 consolidated terminal records using W0 `a98b6cd49c637f40dd7431196bd98349bcc4a466`. This is metadata verification, not another experiment execution or an improved experimental outcome.

The first audit rejected seven records because two tested commits were no longer reachable from the streams' current rebased branches: W1 `2a0d4020073faab30f7046b66a2e478cce022f00` and W6 `0247bdd381e565a9e885c62bbcbd85fbc3108c0d`. Original commit objects and source bundles still existed; the raw observations and artifact hashes were intact. The failed audit is retained in `source-archive-verification-20261025/first-attempt.json`.

The tested objects are now retained by permanent repository archive branches:

- `experiment/qvm-executed-2a0d4020073f` — original semantic candidate execution.
- `experiment/qvm-executed-0247bdd381e5` — original PostgreSQL recovery execution.
- `experiment/qvm-w2-executed-be6e71b` — historical IFC preparation/downstream execution.
- `experiment/issue-122-integration` — combined generator/storage runners, including full-load source `612dd75192d4605096efd3ed52f02c4abd913de1`.

These are source-retention references, not merge candidates or claims that historical source passes current clean-install CI. Actual execution dependency/image settings remain part of each run's evidence. Current implementation PRs carry later dependency and source fixes separately.

After fetching archived objects, a fresh bounded server container checked every historical design/definition/source/runner binding, exact registry assertion accounting, raw artifact byte count and SHA-256, and equality with the executed observation artifact. All 25 records verified. The complete result is `source-archive-verification-20261025/verified.json`; none of the original terminal bytes was changed by this audit.

Private raw audit roots are `artifacts/w7-independent-verification-e3daf0c` and `artifacts/w7-independent-verification-e3daf0c-attempt2`, beneath `/ssd1/bim-forge-qualification/qvm-20261025`. Source bundles, the exact input list and the retained verification command remain in the same qualification root. Execution used 0.5 CPU / 1 GiB and no network/database access.

Future executions must retain the tested source object before their working branches can be rewritten. The existing verifier continues to fail closed when a source object is missing. The currently running full database load is not a terminal record and is excluded from this audit.
