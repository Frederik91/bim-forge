# Scheduled coding and draft publication

## Source is not activation

The owner selected hourly coding and draft publication. Human review and merging remain required. The two manual trial utilities and schedule admission library are merged. Both fixed profiles now exist on main, so neither is eligible for another additions-only run.

`factory/schedule-job.ts` connects the existing controller and publisher. New trusted code still requires human review before installation. A merged PR does not install a release, approve a task, or enable a timer. The [deployment guide](scheduled-dispatch.md) contains the default-disabled units and qualification steps.

## One approved scope per activation

The root-owned `/var/lib/bim-forge-approvals/SCHEDULED` file selects one approval and the fixed `profile-additions-draft-v1` publication policy. Missing activation means disabled. A null approval means idle. The timer cannot select public issues, change a scope, refresh an approval, or retry a failed job.

```text
hourly wake
  exact administrator-approved scope
    shared coding admission and lease
      tools-disabled generator
      independent credential-free cases and repository tests
      exact verified package and required scheduled permit
        isolated App publisher creates a draft
          human reviews and merges
```

The seven-field approval binds the repository, exact scope digest, measured deployment digest, start time, expiry, and UTC-day start limit. The scope includes the issue snapshot, base SHA, plan, paths, and acceptance cases. Approval validity is at most 24 hours. The daily limit is one through six starts, including manual starts. The existing cumulative issue limit remains three.

The owner authorized six starts per UTC day during supervised factory setup. Use six only in an exact setup approval that expires within 24 hours. Return subsequent operational approvals to three after qualification. Raising this allowance does not reset recorded starts, retry a consumed scope, or select another task. Existing approvals retain their exact limits. The fixed `schedule-check` demonstration utility retains its original one-through-three contract. It does not control real admission.

The dispatcher uses the coding ledger as the sole admission record. It holds the same coding lease through publication and confirmed child-service cleanup. A separate dispatch record lists the exact services that cleanup owns. Dispatch receipts cache terminal outcomes, not start counters. Duplicate wakes return the receipt without another model call or repository write. An uncertain publication requires manual reconciliation through the existing exact-byte publisher workflow.

## Publication authority stays separate

The dispatcher reopens the protected verified ledger, exact candidate bytes, independent observations, and verifier log. It derives the manifest append from the pinned baseline. It permits only the selected profile's new files and that exact append. It never imports candidate code or reads the App key.

Scheduled packages and permits live only in `approvals/scheduled`. `publish.ts --scheduled-sha` requires the permit. Missing or invalid scheduled authorization never falls back to `--approved-sha`. The existing manual spool remains separate.

The App publisher checks current activation, both local pause files, approval expiry, boot identity, and the original monotonic deadline before each repository request. Existing remote issue, main, pause, protection, intent, issue-budget, and reconciliation checks remain active. Only the isolated App service receives a credential. Token revocation remains allowed after work authorization expires.

## Time and deployment checks

The whole job has one same-boot 20-minute monotonic deadline, starting before intake. Each candidate service retains its own shorter limit. Local guards run while remote checks are pending. Remote gates refresh approximately every 30 seconds during active stages. Cleanup may continue after expiry but cannot start more work.

Measurement covers the installed source tree, Node and npm installation, generator installation and dependencies, unit files and effective protection settings, controller binaries, and their linked libraries. Each actual child service also requires the expected template file with no instance override, drop-in, or pending reload before start. Both release aliases must resolve to one protected release. Writable ancestors and external dependency links are unsupported. A supplied Git SHA is not deployment evidence.

Ubuntu's root-managed operating system remains trusted. This digest is not a measured-boot or complete OS attestation. Root compromise, malicious OS packages, and changes inside an already running process are outside this check.

File hashing reads every byte in 64 KiB chunks and rejects files that change during measurement. Each installed tree remains limited to 768 MiB and 20,000 entries. A legitimate executable larger than 256 MiB fits that aggregate budget without a whole-file memory allocation.

The current generator installation and its parent directory are worker-owned. Scheduled deployment must first protect those executable files and ancestors while preserving the worker's private authentication directory. The dispatcher refuses this mutable installation; the manual trial does not establish scheduled readiness.

## Stops and crash recovery

The hourly UTC timer has no catch-up, automatic restart, or parallel job execution. The service defaults to disabled. The dispatcher checks memory and disk headroom before consuming a start.

Either local pause file stops useful work: `/var/lib/bim-forge-coding/PAUSED` or `/var/lib/bim-forge-approvals/PAUSED`. Public `loop-pause-all` issues and repository `STATE.md` remain remote stops. Disabling the timer stops future wakes, not an active job.

Before each child starts, the dispatcher durably records its exact service ID. `ExecStopPost` stops only those validated services and confirms empty control groups. A failed cleanup preserves the coding lease. Hard interruption preserves the active dispatch record and any stale leases. No age-based lease deletion or automatic resume exists.

## Remaining limits

The VM has 2 vCPUs and 6 GiB RAM. Stages stay sequential. Reported token usage is checked after generation; it is not a hard monetary cap. Unknown costs remain unknown.

An in-flight network request cannot be atomically recalled when a permit expires. The existing transport timeout bounds requests. A hard kill may prevent immediate token revocation; the token's lifetime remains the fallback. Same-kernel sandboxes do not eliminate guest-kernel or hypervisor vulnerabilities. Fixture tests do not prove the installed scheduler works. Installed disabled, idle, stop, and cleanup checks follow human review.
