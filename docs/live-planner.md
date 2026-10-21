# Manually triggered live planning

The live adapter extends the report-only runner from PR #9. It fetches one selected public issue from `Frederik91/bim-forge`, captures the clean source revision and bounded repository context, and asks the private worker's signed-in Codex CLI for a structured advisory plan.

Run it on the dedicated Linux worker as the isolated worker account:

```sh
npm run factory:plan -- --issue 10 --approve-scope --data-dir /var/lib/bim-forge/runs
```

`--approve-scope` is an explicit decision by a trusted shell operator to run planning. It is not engineering approval of the generated plan. Issue labels, titles, and bodies cannot supply this authorization. There is no public endpoint or scheduled dispatch.

The public GitHub API is read without a write token. Rate limits or inability to check a pause signal prevent work rather than assuming permission. An open issue or PR with the `loop-pause-all` label pauses planning. Remote pause state is refreshed at least once per minute while the process runs and checked freshly before starting and accepting a result; local `STATE.md` is checked throughout.

Codex runs with the existing worker account's sign-in, an isolated empty working directory, ignored user configuration, disabled shell execution, disabled connectors/plugins/browser/image tools and subagents, and a strict output schema. It receives only a bounded JSON context packet. It does not check out or execute pull-request content. Any reported tool use rejects the result. The adapter requires Linux so cancellation can kill the entire process group, including Codex's native child.

Deploy under the same external OS restrictions used for the fixture service: root-owned code, a non-sudo worker account, `NoNewPrivileges`, and a read-only system view. Permit writes only to the run directory and Codex's private state directory, which needs to refresh its sign-in. Keep that state private to the worker. Do not run this account-backed workflow in public CI or expose it to arbitrary public issue events.

Each live run saves its context packet and schema, validated JSON and Markdown report, outcome, source revision, policy/context hashes, and reported token usage. Monetary cost remains unknown. A clarification request is a `needs-input` outcome. Live and fixture identities are distinct; repeated identical inputs reuse the saved result without another model request.

The executable paths target the provisioned VM: Node under `/opt/bim-forge/node/bin`, Codex under `/var/lib/bim-forge/tools/bin`, and worker state under `/var/lib/bim-forge`. The adapter identifies the tested Codex CLI version 0.160.0. Update and requalify that adapter deliberately when changing the CLI.

Plans do not execute their proposed steps, approve changes, post comments, create PRs, or merge. Branch-writing agents and recurring dispatch remain separate increments.
