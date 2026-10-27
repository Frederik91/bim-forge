# Issue #153 documentation plan and evidence

Issue: [native computation ownership](https://github.com/Frederik91/bim-forge/issues/153). Branch: `docs/issue-153-native-compute`. Exclusive worktree: `issue-153-native-compute/bim-forge`. Base: `51a0690229fff776d5f9d6db9467951aefdac30d`.

## Plan

1. Inspect deployed-preview source at `8a1f3a955ecea90bceef574ff8b9eab4249669ce`, storage experiment source at `962d6023119baf070bd6c2a8c599e2cf0ea3186e`, and pinned IFC/OCCT experiments read-only. Check official primary sources for runtime/kernel claims.
2. Write `docs/design/native-computation.md` with current owners, proposed native/TypeScript responsibilities, data contracts, permanent budgets, migration gates, and a small future Rust comparison. Link it from `docs/architecture.md` and `docs/storage.md`.
3. Run root `npm run validate` and the changed-file policy check in the server tools container, then inspect links and the documentation-only diff. Commit, push, and open one draft PR for human review.

Model entities and runtime validators changed: none. Model delta: none. No database access, benchmark execution, production/runtime code, deployment, registry/results changes, architecture adoption, merge, or issue closure is included.

## Evidence

The proposal pins the inspected repository source and links official Rust, Node.js, PostgreSQL 15, IfcOpenShell, and OCCT documentation, checked on 25 October 2026. Current full-admission facts come from the retained terminal record and read-only inspection of its existing log/CPU-stat files. No new performance result is claimed.

Initial root validation and the four-file policy check passed on `frederik@192.168.1.17`, using `bim-qvm-tools:20261025` with `--network=none --cpus=.25 --memory=1g --memory-swap=1g`. Source was copied into `/app` with `cp -R`; cached `pg` and `@types/pg` were symlinked. Docker inspection confirmed 250,000,000 NanoCPUs, 1,073,741,824 memory bytes, network `none`, exit 0, and no OOM kill. The image ID is `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`.

The validator output was:

```text
npm run validate
Strict TypeScript valid. 114 source file(s) checked.
tsc --noEmit
Policy valid. 0 changed file(s) checked.

node scripts/validate-policy.ts --changed-files docs/design/native-computation.md docs/design/native-computation-plan.md docs/architecture.md docs/storage.md
Policy valid. 4 changed file(s) checked.
```

This verifies repository lint/types/policy, not the proposed architecture or any Rust performance. The final documentation snapshot receives the same checks plus a relative-link check before publication. Unique server source/artifact directories and exact log locations are attached in the draft PR. The main coordinator retains the exclusive database lease.
