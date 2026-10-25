# Native semantic baseline review

QVM-01 / issue #130. Coordinator review, 25 October 2026. This is evidence review, not architecture adoption or engineering approval.

Reviewed immutable run: `w1-baseline-20261025a`, recorded separately under EX-01, EX-03, EX-04, EX-05 and EX-06. Twenty observations: eleven met expectations and nine identify gaps. Every terminal record passed the executable W0 publication verifier against actual artifact bytes and pinned source commits. Registry status remains running while the VM-C1 comparison executes.

| Experiment | Baseline conclusion | Consequence |
| --- | --- | --- |
| EX-01 | Failed | Source ID churn and split/merge lineage are not represented. Controlled paired IFC exports remain additional coverage. |
| EX-03 | Inconclusive | Existing asset definition/occurrence isolation works in the slice; a general shared-property model was not exercised. |
| EX-04 | Failed | An empty-region query assumption and acceptance command payload reuse lack the required safeguards. |
| EX-05 | Failed | Moving a destination wall can invalidate the placement assumption despite valid combined geometry. Unrelated acceptance has no explicit approval-equivalence receipt. |
| EX-06 | Failed | Independent fields on the same object need an explicit merge policy. Incompatible edits must remain conflicts. |

The current native model is the baseline, not an implementation of VM-C1. These failures motivate candidate experiments; they do not prove the proposed design succeeds. The candidate must run the same cases and retain unsupported cases as limitations. Fixture actors exercise application bookkeeping and do not constitute human approvals.

Raw evidence root: `/ssd1/bim-forge-qualification/qvm-20261025/artifacts/w1-baseline-20261025a` on `frederik@192.168.1.17`. Exact relative paths, byte lengths and SHA-256 values are in each terminal record. Access is restricted by server SSH/filesystem permissions. Retain these artifacts and failed attempts through the architecture decision; no automatic cleanup is configured. Git carries the terminal results and this review, not the large source dumps.

Execution used the isolated server container and disposable fixture data. No production model, deployment, geometry contract or schema was changed.
