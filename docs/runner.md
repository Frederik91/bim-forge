# Report-only runner: first increment

This release runs a fixed fixture process. It exercises the runner without contacting GitHub, invoking a model, spending model usage, creating branches, or changing BIM data. It is the first increment of issue #8, not the completed live factory.

## Try it

Requires Node.js 24 or newer and Git. From the repository root:

```bash
npm test
npm run factory -- run --data-dir ../bim-forge-runs --fixture factory/fixtures/issue.json --plan-fixture factory/fixtures/plan.json
npm run factory -- status --data-dir ../bim-forge-runs
```

The example issue number 999 is synthetic. `approved: true` in the fixture simulates accepted scope; it is not a GitHub authorization mechanism. Live intake must verify the maintainer independently before invoking this runner.

Each attempt saves `run.json` and `events.jsonl`. Valid planning output also saves `plan.json` and `plan.md`. Reports explicitly identify the simulation. Usage and cost remain `null` because no model is invoked.

Run storage must be outside the checkout. Do not share one store between hosts or place it on a network filesystem. Restrict the directory to the worker's service account.

## Stops and retries

The runner reads the trusted checkout's `STATE.md`. Exactly one `paused: true` or `paused: false` line is required. Pause or unapproved scope blocks the test process before it starts. During a run, pause or loss of pause state terminates the process. Ctrl+C also cancels it.

The default wall-clock timeout is ten minutes. For a shorter limit, pass `--timeout-ms 1000`. Only one process may use a store at a time.

Repeated input reuses the saved result, including failure. After investigating a failure, pass `--retry` explicitly. The trusted policy's attempt limit applies across restarts. A successful or clarification result cannot be retried unchanged; update the issue or source revision when the inputs change.

After a crash, first stop the worker service and any remaining fixture process. Then run:

```bash
npm run factory -- recover --data-dir ../bim-forge-runs
```

Recovery is an operator action, never automatic. It refuses a live worker, a live planner, or a lock owned by another host. It marks abandoned runs `interrupted` without starting another attempt. The service must stay stopped throughout recovery. If a lock or run record is corrupted, inspect and recover the affected store manually; the runner fails closed rather than deleting history.

## Plan output

A plan names the outcome, change class, relative repository paths, steps, acceptance checks, reviewers, and unanswered questions. Unknown fields and malformed output fail validation. A valid plan with questions is saved as `needs-input`; a ready plan requires steps, acceptance checks, and a reviewer.

No plan field is executed. The simulated planner is a fixed Node.js child process started without a shell or inherited credentials. Timeout and cancellation wait for that child to exit before releasing the worker lock. The child creates no descendants. A future live adapter needs its own process-tree and credential isolation guarantees.

## VM target and next increments

Deployment target: Ubuntu Server 24.04 LTS guest on the existing KVM host, with two vCPUs, 6 GiB RAM, an 80 GiB thin-provisioned disk, autostart, and SSH user `frederik`.

Next add live GitHub issue intake and maintainer checks, then the existing coding-agent adapter, and finally a service that starts on boot. Repository-level pause labels and a live usage budget are part of those integrations. This increment checks only local `STATE.md` and the fixture scope flag.

PR creation, model edits, and merge automation remain later increments. Keep the current repository review requirements enabled.
