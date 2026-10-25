# Recovery, history interpretation and independent-copy review

QVM-01 / issue #130. Coordinator review, 25 October 2026. The W6 terminal records are unchanged copies of the W0-published originals in [draft PR #139](https://github.com/Frederik91/bim-forge/pull/139), source `186d298a85f1f8d905523a968ea040795cf79a75`.

Six real PostgreSQL cases passed through the W5 candidate and a governed experimental W6 wrapper:

- A dedicated writer was killed during staging; no incomplete accepted revision appeared.
- A writer was killed after database COMMIT; identical command/payload retry returned one logical acceptance and retained its receipt.
- A dump was restored into a separate database with separately copied artifacts. Source connections were blocked and the source artifact path hidden while all table exports, canonical hashes and paginated queries were compared.
- Missing artifact content prevented publication and preserved the last complete usable state.
- Divergent local contributions were preserved and exchanged, with a scalar conflict requiring declared reconciliation.
- Simulated mechanical and electrical policies required current approvals and bound review artifacts to the candidate acceptance.

All thirteen recovery/subprocess tests also passed without skips. The original correctness execution source remains `0247bdd381e565a9e885c62bbcbd85fbc3108c0d`; later metadata-only validation and publication did not repeat those operations.

EX-11 and EX-12 remain **inconclusive**. A killed writer is not a database-container crash or host power-loss test. Separate databases share one PostgreSQL server, one test role and one host; independent authentication, encryption keys and physical failure domains are not qualified. Test discipline actors do not represent human approvals or a deployed authority service. W5 stores single-parent ancestry; no general multi-parent merge or network synchronization service was implemented.

EX-09 has additional passing representation-shape, property-dictionary and serialization upgrade cases. Original historical bytes remained available to pinned/upgraded readers. It remains **inconclusive** because no old/new geometry-kernel upgrade was executed. Version descriptors alone do not qualify historical geometry interpretation.

The original correctness lease did not record a numeric disk budget. Terminal records truthfully use null plus an explicit limitation; W0 refuses a passed conclusion with an unrecorded budget. The bound timestamps are reconstructed from retained source/observation file times, not an instrumented timing benchmark.

Private raw evidence root for relative terminal artifact paths: `/ssd1/bim-forge-qualification/qvm-20261025/artifacts/w6-0247bdd-postgres-02`. Original validation/subprocess artifacts are under `artifacts/w6-0247bdd-checks-01`. Publication verification and its exact inputs are under `artifacts/w6-publish-33a4594-01`. All required paths, bytes and hashes were verified by W0 before publication.

These cases support atomic publication of model deltas together with complete evidence and payload-bound receipts, and preservation of independent branches before reconciliation. They do not authorize production schema adoption, security claims, automatic BIM approval, merging or deployment. Retain private artifacts and failed attempts through architecture review; no automatic cleanup is configured.
