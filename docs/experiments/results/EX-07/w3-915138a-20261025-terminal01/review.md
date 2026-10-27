# EX-07 terminal evidence for review

Conclusion: **inconclusive**. Execution completed. All 16 case observations passed, but general topological reference stability remains partially covered. This record is evidence for human review, not approval or production adoption.

The actual experiment source and runner commit is `915138a190439a22f31928e43097f9c588415237`. The later publisher commit `939c4b2df009bac9819a113d624904baf62c0a59` merged W0 `29583f735c1803872ace3fa663dcf6d7a145434a` and finalized existing artifacts without rerunning experiments. W0 verified both Git bindings, every evidence hash, the exact registry assertion set and equality between recorded observations and the hashed executed observation artifact.

- [Terminal result](result.json) and [W0 generated summary](summary.md).
- [Exact terminal input](../w3-915138a-20261025-terminal01-evidence/result-input.json).
- [Executed observation artifact](../w3-915138a-20261025-terminal01-evidence/successful-node/node/observations.json).
- [Full dependency artifacts and before/after deltas](../w3-915138a-20261025-terminal01-evidence/successful-node/node/dependency-artifacts.json).
- [Actual OCCT descriptors and BREP hashes](../w3-915138a-20261025-terminal01-evidence/successful-kernel/occt/topology-artifacts.json).
- [Earlier binding failure 1](../w3-915138a-20261025-terminal01-evidence/failed-kernel-attempt-1/occt/topology-artifacts.json) and [failure 2](../w3-915138a-20261025-terminal01-evidence/failed-kernel-attempt-2/occt/topology-artifacts.json).
- [Publisher server validation](publication-validation.log) and [command exit statuses](publication-status.json).

Actual OCCT result: 6 original faces became 11 unique faces. Old top-face index 5 selected a vertical split face; the top-face history contained successors 2 and 9. The interior semantic anchor resolved face 2; the seam anchor retained two candidates and no chosen face. Reordering resolved the same physical anchored face at index 1. The baseline BREP bytes were preserved.

The exact four registry assertions are covered as follows: full dependent delta covered, failed/unresolved rollback covered, general split/reordering stability partial, and bounded real-kernel evidence covered. No registry status was changed. EX-08 remains W2's responsibility and is absent from this record.

Resource evidence records 0.5 CPU and 1 GiB memory. Original correctness-run disk budget was not captured; the 64 MiB numeric budget is explicitly the retrospective finalization retention budget. Timing is a filesystem envelope derived from retained kernel-log creation and final observation-validation modification times, not measured latency. See [finalization provenance](../w3-915138a-20261025-terminal01-evidence/finalization-provenance.json).

To verify later, use the committed repository root with its Git objects available, inside a server container:

```sh
node experiments/contracts/cli.ts verify \
  docs/experiments/results/EX-07/w3-915138a-20261025-terminal01/result.json \
  docs/experiments/results/EX-07/w3-915138a-20261025-terminal01-evidence
```

Publisher checks passed `npm run validate` (121 TypeScript sources) and scoped TypeScript checking. The original retained source-915138a evidence includes 11 passing W3 tests, five passing W0 contract tests, six passing actual OCCT checks and a 16-observation shared-contract check. No experiment was repeated during finalization.
