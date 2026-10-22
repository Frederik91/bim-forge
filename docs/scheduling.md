# Scheduled coding and draft publication

## Current boundary

This document is preparation, not an installed scheduler. The owner selected hourly checks, then expanded the requested target to coding and draft-PR publishing. Human approval and merging remain required. The current controller and publisher are still manually invoked.

The second manual qualification is issue #20, a pure schedule snapshot checker. Issue #21 adds its fixed trusted profile. Human review precedes deployment of that extension and execution of the second profile. Merging source does not deploy a release or enable recurring work.

## Proposed hourly flow

```text
hourly wake -> one protected, explicitly approved task
            -> fresh scope, pause, budget, release, and health checks
            -> existing coding controller -> independent acceptance and repository checks
            -> verified immutable package -> bounded publication policy
            -> existing isolated publisher -> draft PR -> human review and merge
```

The timer cannot choose public issues or execute issue text. The generator retains disabled tools. Candidate code runs only in credential-free accounts. The publisher alone receives short-lived App credentials. Neither a passing candidate test nor `checkSchedule(snapshot).eligible` grants publication authority.

## Approval and limits

The proposed dispatcher accepts one administrator-installed task slot. Approval binds the repository, exact issue snapshot, current main SHA, complete scope and independent cases, fixed profile, reviewed installed release hashes, expiry, and publication policy. No arbitrary command or file path enters through the slot identifier.

The slot permits at most one model start and one new draft. Keep one active coding job globally. Propose at most one coding start per UTC day initially, with the existing cumulative three-start limit per issue. The owner must approve the activation limits before enabling recurrence. An hourly wake is not permission for an hourly model call.

No automatic retries, backlog catch-up, rebasing, approval refresh, issue closure, or merge. Changed main, issue, release, policy, or cases blocks the slot rather than silently updating it. Failure or interruption spends a started slot. A successful run waits while its draft is reviewed; duplicate wakes report the recorded result without another model call or PR.

Manual and scheduled starts must share the same lease and durable admission records. Daily counts and single-use consumption come from those records, not a second counter in a timer or caller-supplied snapshot. Persist consumption before starting generation. Missing or ambiguous state stops work and requires administrator recovery.

The existing exact-byte publishing spool stays mandatory. Automated staging would require a new reviewed dispatcher that checks an explicit, narrow preauthorization policy against the trusted controller's verified ledger and frozen source bytes before installing that exact package. This is a change from per-package human publishing approval. It is not implemented or implicitly granted by a timer. Keep the publisher's live gates and human merge requirements unchanged.

## Trigger choice

Prefer a VM-native timer because the factory runs on the always-on VM and already uses fixed systemd services. An app heartbeat would add desktop availability and an app-to-VM authorization transport. Do not run both.

For the initial phase, prepare an hourly read-only report with no model calls or App credential. The later coding dispatcher remains a separate reviewed component. A readiness-only service needs no sudo, secret access, or network if it consumes a protected administrator-prepared snapshot. It must report stale or missing snapshots rather than calling them ready.

A future timer uses hourly UTC boundaries, no boot catch-up, no failure restart, and one fixed service. Its installation defaults to disabled. Report and dispatch have distinct service identities and permissions. This PR provides no activation command or deployable timer, because those executables and their admission checks are not implemented yet.

## Activation checklist

1. Review and merge the fixed-profile extension. Install an immutable reviewed release only after all coding units are stopped and their control groups are empty. Preserve the old release and ledgers for rollback and evidence.
2. Freeze issue #20 against the then-current main and live issue snapshot. Run its 32 independent cases and full Linux suite in credential-free sandboxes. Review generated source, actual exits and outputs, case hashes, and publication bytes. Supplemental tests do not prove arbitrary hostile behavior.
3. Publish its draft through the existing exact-byte approval flow. Keep human approval, trusted CI, and administrator protection enforcement in place.
4. Implement and review a separate trusted dispatcher and publication preauthorization policy. Require fixed profile additions only, no existing controller, test, validator, policy, deployment, credential, schema, or model edits. Prove manual/scheduled races, duplicate wakes, expired or changed bindings, daily and issue budgets, publication reconciliation, and crash recovery.
5. Enforce a whole-job monotonic deadline and approval expiry during execution, not only at admission. Retain local and remote pause checks, stage limits, bounded output, read-only host files, private network, capped scratch, and whole-control-group cleanup. A killed controller alone is not cleanup.
6. Demonstrate disabled, idle, missing-snapshot, stale, busy, paused, unknown, exhausted-budget, and lost-response behavior with no unapproved model or GitHub write. Failed cleanup must require recovery, never clear its own lease.
7. Approve the exact installed release, queue slot, expiry, daily cap, hourly cadence, and automated publication policy. Then explicitly enable the selected timer. Verify one real wake and its audit record before leaving it unattended.

Stop future wakes with the timer's disabled state. Stop active coding with administrator-owned `/var/lib/bim-forge-coding/PAUSED`; stop publisher writes with `/var/lib/bim-forge-approvals/PAUSED`. Preserve active-unit and failed-run evidence. Do not erase attempts or steal stale leases by age. Exact service names and activation commands belong to the future reviewed dispatcher deployment, not to this design.

## Remaining limits

The VM has 2 vCPUs and 6 GiB RAM. Keep generation, cases, and supplemental checks sequential, with the current stage limits. Measure the shared VM's memory and disk headroom before admitting work. A timer must not add parallelism.

Reported token usage is checked after completion; it is not a hard monetary spending ceiling. Unknown costs remain unknown. Same-kernel isolation does not eliminate guest-kernel or hypervisor risks. A small or empty repository does not remove credential risk.
