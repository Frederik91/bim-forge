# Deploy and qualify the hourly dispatcher

Do not run these steps from an unattended coding job. Human review of the trusted controller and publisher code is a prerequisite. Keep the timer disabled until the installed checks pass. Neither current profile provides new work because both utilities already exist on main.

## Prepare a protected release

1. Stop factory activity. Confirm that every generator, case, verifier, and publisher service has an empty control group. Preserve existing attempts, approvals, publication intents, and old releases.
2. Install the reviewed source as a new root-owned directory under `/opt/bim-forge/releases`. Give neither worker account write access. Do not include mutable checkouts, external symlinks, secrets, or dependencies outside the measured installations.
3. Point both `coding-current` and `publisher-current` at that same reviewed release. Keep `/opt/bim-forge` and the release aliases root-owned. Protect every parent directory against worker writes.
4. Protect the generator installation at `/var/lib/bim-forge/tools`, including its Node package dependencies. Protect `/var/lib/bim-forge` against rename attacks by the worker. The worker still needs traversal of that parent and ownership of its existing private `.codex` and `coding` directories. Do not print, copy, or change the authentication files. Verify the generator still starts as `bimforge`, never root.
5. Create `/var/lib/bim-forge-coding/schedule` as root mode `0700`. Create `/var/lib/bim-forge-approvals/scheduled` as root with group `bimforge-github`, mode `0750`. Keep the approvals parent root-owned and protected. Preserve the existing root-only App key and manual spool.

## Install the default-disabled units

Save these three unit definitions under `/etc/systemd/system`. Do not change the existing coding isolation units or ordinary publisher unit to relax their protections.

### bim-forge-schedule.service

```ini
[Unit]
Description=Dispatch one preapproved BIM Forge scope
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=root
WorkingDirectory=/opt/bim-forge/coding-current
ExecStart=/opt/bim-forge/node/bin/node /opt/bim-forge/coding-current/factory/schedule-job.ts --once
ExecStopPost=/opt/bim-forge/node/bin/node /opt/bim-forge/coding-current/factory/schedule-job.ts --cleanup
Environment=PATH=/opt/bim-forge/node/bin:/usr/bin:/bin
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER
ReadWritePaths=/var/lib/bim-forge-coding /var/lib/bim-forge/coding /opt/bim-forge/coding-source /var/lib/bim-forge-approvals/scheduled
InaccessiblePaths=/etc/bim-forge /var/lib/bim-forge/.codex
UMask=0077
MemoryMax=768M
CPUQuota=100%
TasksMax=128
LimitCORE=0
TimeoutStartSec=20min
TimeoutStartFailureMode=kill
TimeoutStopSec=45s
KillMode=control-group
KillSignal=SIGKILL
```

### bim-forge-schedule.timer

```ini
[Unit]
Description=Hourly approved-scope BIM Forge dispatch

[Timer]
OnCalendar=*-*-* *:00:00 UTC
AccuracySec=1s
Persistent=false
Unit=bim-forge-schedule.service

[Install]
WantedBy=timers.target
```

### bim-forge-scheduled-publish@.service

```ini
[Unit]
Description=Publish one permitted scheduled BIM Forge draft
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=bimforge-github
Group=bimforge-github
WorkingDirectory=/opt/bim-forge/publisher-current
ExecStart=/opt/bim-forge/node/bin/node /opt/bim-forge/publisher-current/factory/publish.ts --scheduled-sha %i
LoadCredential=github-app-key:/etc/bim-forge/github-app.pem
StateDirectory=bim-forge-publisher
StateDirectoryMode=0700
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
InaccessiblePaths=/var/lib/bim-forge /var/lib/bim-forge-coding/ledger /var/lib/bim-forge-coding/jobs /var/lib/bim-forge-coding/cases /var/lib/bim-forge-coding/schedule
UMask=0077
MemoryMax=256M
CPUQuota=100%
TasksMax=64
LimitCORE=0
TimeoutStartSec=10min
TimeoutStartFailureMode=kill
TimeoutStopSec=2s
KillMode=control-group
KillSignal=SIGKILL
```

Validate the files with `systemd-analyze verify`, then reload the service manager. Confirm that the timer is disabled. Resolve every unexpected diagnostic before continuing.

## Qualify disabled and idle wakes

1. Leave `SCHEDULED` absent. Start the scheduler service once. Its result must be `disabled`, with no coding admission, model use, package staging, or publication service.
2. Install this exact compact JSON plus one newline as `/var/lib/bim-forge-approvals/SCHEDULED`, root-owned, group `bimforge-github`, mode `0640`:

   ```json
   {"version":1,"approvalSha256":null,"publicationPolicy":"profile-additions-draft-v1"}
   ```

3. Start the scheduler service once. Expect `idle` with reason `no-approved-scope`. Confirm that no child service started and no admission record appeared.
4. Run `schedule-job.ts --measure` as the administrator using the installed Node binary. Record its complete evidence and SHA-256. A mutable executable, unsupported link, different release alias, drop-in, or pending reload must refuse measurement. Do not replace the result with a Git SHA.
5. Re-run the credential-free full Linux suite against the installed release. Qualify pause, deadline, failed cleanup, and interruption with disposable fixtures. Preserve any failed-state evidence. Do not bypass a stale lease to make qualification pass.

## Approve one eligible task

1. Review a compatible additions-only profile first. The current two profiles are ineligible. Any new profile is another reviewed source change, not permission to select arbitrary issue paths.
2. Freeze a scope from the current main SHA and live issue snapshot. Include the ready read-only plan, exact fixed paths, and independent cases. Fetch the public source objects into `/opt/bim-forge/coding-source` as the administrator. Do not execute candidate code there.
3. Hash the exact scope bytes. Install them as `schedule/scope-<scopeSha256>.json`, root-owned mode `0600`.
4. Create the existing seven-field approval as canonical compact JSON plus one newline. Set `repository` to `Frederik91/bim-forge`, `scopeSha256` to the scope digest, and `deploymentSha256` to the installed measurement. Use canonical UTC timestamps with milliseconds. Set a window of at most 24 hours and `dailyLimit: 1` initially.
5. Hash those exact approval bytes. Install them as `schedule/approval-<approvalSha256>.json`, root-owned mode `0600`.
6. Replace `SCHEDULED` atomically with canonical compact JSON plus one newline. Set `version: 1`, that `approvalSha256`, and `publicationPolicy: "profile-additions-draft-v1"`. Keep root ownership, group `bimforge-github`, and mode `0640`. This step authorizes automated staging and draft publication for that exact scope.
7. Start one supervised wake before enabling recurrence. Check the coding ledger, independent outputs, verification log, scheduled package and permit, publisher receipt, token-revoked result, draft status, required CI, and human merge protection. A duplicate wake must return the same receipt without more model use or writes.
8. Only after those checks pass, enable and start `bim-forge-schedule.timer`. Confirm its next hourly UTC wake and read the first scheduled result. Do not run a second desktop or cron scheduler.

## Stop and recover

Disable and stop the timer to prevent future wakes. Create either protected local `PAUSED` file to stop active useful work. Stop the scheduler service when immediate termination is needed. Inspect the matching post-stop cleanup result and confirm empty child control groups.

If `schedule/active.json`, `ledger/coding.lock`, or the publisher lock survives, stop for administrator recovery. Do not delete a lease by age. Use the exact recorded run, units, publication digest, and publisher intent history to determine whether a draft already exists. Reconcile uncertain publication manually. Never resume mutation from the next hourly wake or erase attempt history.

Keep the previous release for rollback. Before changing either alias, disable the timer, stop work, and confirm cleanup. Re-measure and create a fresh approval after any source, runtime, unit, policy, scope, or issue change.
