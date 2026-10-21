# LOOP.md — BIM Forge operating model

The factory is the first product. It discovers work, gives agents bounded context, verifies results, persists evidence, and routes decisions to the right human gate.

## Active loops

### Issue intake — L1 report-only

- Trigger: new or updated issue with the `agent-ready` label.
- Output: clarified scope, risk class, missing information, and a proposed plan.
- May: comment and add labels.
- May not: change files, create branches, or approve work.

### Implementation loop — L2 assisted

- Trigger: maintainer starts an approved issue run.
- Output: isolated branch and draft pull request.
- May: edit code and model fixtures inside the issue scope.
- Must: run the verifier, publish evidence, and stop for human review.

### Pull-request verifier — L1/L2

- Trigger: pull request update.
- Output: schema, geometry, coordination, regression, security, and policy results.
- May: comment with findings and request changes.
- May not: merge or dismiss a failed gate.

### Review router — L2 assisted

- Trigger: all required validators pass.
- Output: review classification and suggested reviewers.
- Auto-approval is disabled for geometry, coordination, schema, migrations, permissions, and security.

## Rollout levels

| Level | Behavior | Promotion condition |
| --- | --- | --- |
| L1 | Discover, report, validate, and comment | Evidence is complete and the kill switch works |
| L2 | Create bounded branches and draft PRs | Verifier has been correct for a sustained trial |
| L3 | Unattended low-risk actions only | Explicit project policy, allowlist, audit trail, and maintainer sign-off |

## Kill switch

Pause all loops with the `loop-pause-all` label or by setting `paused: true` in `STATE.md`. A paused run exits before any model or repository mutation.

## Observability

Every run should record: issue, actor, model revision, branch, changed paths/entities, prompt or plan identifier, tool calls, validator versions, token/cost estimate, review class, decision, and failure reason if applicable.
