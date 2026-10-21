# The BIM factory

This directory is the executable design for the issue-to-PR loop. It is intentionally small: the first implementation task is to make the loop auditable before giving it model-writing power.

## Contracts

- [loop.json](loop.json) defines stages, permissions, promotion levels, and stop conditions.
- `agents/` defines the output contract for each role.
- `../policy/gate.json` is the machine-readable safety policy.
- `../STATE.md` is the operator-visible state and kill switch.

## First implementation slice

1. Read an issue and produce a structured plan.
2. Create an isolated branch/worktree.
3. Run deterministic validators against a fixture model.
4. Open a draft PR with a machine-readable run manifest.
5. Require a human before any merge.

The factory should not learn to mutate real projects until this slice has useful failure reports and repeatable evidence.
