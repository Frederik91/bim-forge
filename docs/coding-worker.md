# Run the manual coding trial

The worker supports two fixed read-only task profiles. The health profile adds `factory/health.ts` and `factory/health.test.ts`. The schedule-check profile adds `factory/schedule-check.ts` and `factory/schedule-check.test.ts`. It is not a general shell agent. The administrator supplies a ready plan and independent input/output cases before generation. The existing planner and publisher keep their separate responsibilities.

```text
administrator-approved scope
  -> tool-disabled Codex returns complete source as data
  -> administrator controller freezes a new worktree
  -> disposable, credential-free accounts execute the candidate
  -> controller compares actual exits and output with approved cases
  -> supplemental policy and repository tests
  -> publication package awaiting separate administrator approval
  -> existing publisher opens a draft for human review
```

## Dispatch one reviewed scope

Install a reviewed, root-owned release at `/opt/bim-forge/coding-current` and the three fixed service templates separately. The administrator creates root-owned `/var/lib/bim-forge-coding`, its `jobs` and `cases` directories, a root-owned clone at `/opt/bim-forge/coding-source`, and `/var/lib/bim-forge/coding` for generator output. The coding account receives no sudo access. No unit is enabled on a timer.

Create a UTF-8 JSON scope with exactly `version`, `repository`, `issue`, `baseSha`, `plan`, `paths`, and `acceptanceCases`. Version is `1`; repository is `Frederik91/bim-forge`. `issue` contains the current `number`, `title`, `body`, and `updated_at`. Use a full main SHA and the existing ready-plan schema, with no questions and change class `read-only`. Paths must match one complete profile pair above. Mixed pairs and unknown paths are rejected. New files only: a merged task cannot be rerun to overwrite its existing files.

Each independent case has exactly `mode`, `name`, `input`, and `output`. Mode is `cli` or `api`, selecting the installed command or exported-function adapter. Input is literal stdin text. A JSON object output requires successful exit, no stderr, and that exact serialized object plus a newline. Null output requires a normal nonzero exit, empty stdout, and the profile's fixed error plus a newline on stderr. Health uses `summarizeRunHealth` and `Invalid run records`. Schedule-check uses `checkSchedule` and `Invalid schedule snapshot`. Cases never select executables, shell commands, imports, network destinations, or secret paths. `factory/code-acceptance.ts` supplies 24 health cases and 32 schedule-check cases.

The controller writes protected `paths.json` into each new case directory. The case adapter resolves it through the same fixed profile table. Old case artifacts remain evidence, not reusable execution inputs for the new adapter. Deploy controller and adapter bytes together; do not change a running job's release.

The schedule checker reports on supplied data only. Its `eligible` result is not an execution capability or proof of live authorization. The string-only independent case format cannot represent arbitrary invalid UTF-8 bytes. Candidate-authored byte tests remain supplemental, not independent evidence for that property.

Review the complete scope, then install it as a root-owned regular file with no group or world write access. From the VM administrator account:

```sh
sudo /opt/bim-forge/node/bin/node /opt/bim-forge/coding-current/factory/code-job.ts --spec /var/lib/bim-forge-coding/health-scope.json
```

The controller records the exact scope hash before starting a model. A verified outcome identifies a root-owned `publication.json`, its SHA-256, private observations, and the verification log. Failed case observations are saved before comparison, and supplemental logs are collected on failure too. Review the actual source and evidence, then follow [Publish an approved change](publisher.md). Dispatch approval is not publishing approval or merge approval.

## Stop or retry

Create `/var/lib/bim-forge-coding/PAUSED` as the administrator to stop local work. Public `loop-pause-all`, changed issue scope, changed main, unknown GitHub state, or explicit paused state also stop acceptance. Public checks occur at stage boundaries and approximately every 30 seconds during active work. Local checks run every 500 milliseconds, apart from bounded system/API calls. Checks cannot form a transaction with GitHub writes; the publisher rechecks its own gates.

Repeating a completed or failed scope returns the recorded outcome without another model call. After a normal failure, `--retry` explicitly requests another attempt. Three recorded starts for an issue exhaust the budget even if the scope changes. No automatic repair loop is implemented.

A hard kill leaves the lease or a running record for administrator recovery. Stop all recorded generation, case, and verification units, confirm their cgroups are empty, preserve artifacts, mark the exact run interrupted, and only then remove its exact stale lease. Never delete history or reset attempt counts. No automatic recovery command is provided.

## Isolation and limits

Only the fixed tool-disabled generator runs as `bimforge`, reusing its private ChatGPT login. Proposed source is never imported or executed by that account. The administrator controller handles bytes and starts fixed units; it never executes candidate code as root. Candidate cases and supplemental tests use systemd dynamic users, no capabilities, read-only host files, inaccessible credential locations, private scratch, no usable network, and whole-cgroup cleanup. The controller compares case observations outside those accounts. A candidate's printed verdict cannot authorize publication.

The administrator and installed release remain trusted. Same-VM account and namespace isolation is not a separate security kernel. Host-enforced VM network restrictions add another boundary but do not protect credentials stored inside the guest.

Bounds include a 256 KiB scope, 128 KiB generator prompt, one completed tool-free turn, 1 MiB protocol output, 64 KiB per source file, and the existing 512 KiB publication limit. Main's unchanged 12-file policy still applies. The pinned source is limited to 512 regular files and 8 MiB. Only additions are allowed; the controller alone appends the new test path to the unchanged package test command.

Generation has a ten-minute process timeout and an eleven-minute service deadline. Each acceptance process has three seconds; supplemental checks have three minutes. Service timeout and stop kill the whole cgroup without a SIGTERM grace period. Generator memory is capped at 2 GiB, case memory at 256 MiB, and supplemental tests at 1.5 GiB. They run sequentially. Writable scratch is limited to 128 MiB under `/tmp`; `/var/tmp` and an empty `/run` are read-only mounts. There is no dependency installation.

Reported input plus output tokens above 60,000 reject the result after completion. This is not a hard live token or monetary cutoff. Monetary cost remains unknown. Tasks requiring an enforceable prepaid spending ceiling are unsupported.

## Design and evidence boundaries

Two sketches compared an interactive shell broker with one-shot inline source generation. Both keep credentials outside execution. Inline generation won because this two-file trial needs no new model-facing command transport. The implementation retains the broker design's bounded source inventory and explicit resource ceilings.

The design uses root-owned worktrees and systemd dynamic users rather than a new fixed account or full guest image for each job. Inputs and source are immutable to candidate accounts. Real exit codes and root-owned output files are compared outside the execution sandbox, rather than trusting test-generated receipts. Installed runtime and service hashes, scope, plan, cases, policy, available usage, and observed outputs form the provenance record.

Passing fixed cases demonstrates those cases, not general correctness or resistance to every hostile program. Supplemental candidate-authored tests are not independent evidence. The live VM qualification and draft PR are separate from the unit suite. No autonomous scheduling, credential copying, App permission upgrade, model mutation, or automatic merge is included.

See [scheduled coding and draft publication](scheduling.md) for the proposed next stage. That design is not installed or enabled by this change.
