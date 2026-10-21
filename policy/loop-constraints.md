# Loop constraints

These constraints are binding for every automated run.

## Push and merge

- Do not push or merge without a visible run summary.
- Always create a draft pull request first.
- Never auto-merge model, geometry, coordination, schema, migration, permission, or security changes.
- Never close an issue or pull request automatically.

## Scope and isolation

- One issue, one branch, one coherent pull request.
- Use an isolated worktree for every code or model change attempt.
- Do not edit protected paths from an unattended run.
- Do not modify a production model; use fixtures or a disposable project copy.

## Verification

- Run all applicable validators before proposing a change.
- Never disable a failing test or validator.
- Record each attempt in the run ledger.
- Escalate after `maxAttemptsPerIssue` failures.

## Budget and pause

- Stop at the configured token, time, or cost budget.
- If `STATE.md` is paused or the `loop-pause-all` label is present, exit before mutation.
