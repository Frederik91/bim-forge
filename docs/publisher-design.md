# Controlled publisher design

The publisher turns administrator-approved file bytes into a new branch and a bot-authored draft PR. The advisory planner cannot start it. The publisher never runs proposed source, Git, npm, tests, hooks, or shell commands.

## Ownership

The administrator installs a pinned, root-owned publisher release and stages one root-owned package. Systemd delivers the App key only to the separate `bimforge-github` account. The AI worker has neither that credential nor approval-spool access.

```text
unprivileged implementation and tests
  -> administrator reviews package and evidence
  -> root-owned package, approved SHA-256
  -> isolated publisher -> new branch -> draft PR
  -> GitHub checks and Frederik91's approval
```

An approval binds the original JSON bytes, repository, issue title/body fingerprint and timestamp, main SHA, proposal text, and complete file contents. It grants publication permission, not merge approval. The publisher reads the package once and uses its private snapshot. Unknown fields, commands, deletes, file modes, file references, and unsupported paths are not part of the input language.

The first allowlist supports Markdown under `docs/`, regular JavaScript modules directly under `factory/`, and `package.json`. It excludes deployment files, agent instructions, `.github`, policy, state, and the pinned repository denylist. Proposed npm validation remains unchanged; test commands can only append test files. Credential-pattern checks are a precaution, not a complete secret scanner. The administrator must inspect the proposed content before approving publication.

## Design comparison

Two independent sketches compared direct GitHub Git Database requests with importing an approved Git bundle into a private object store. Both can keep proposed source inert. The bundle approach also needs Git configuration suppression, pack/object limits, subprocess isolation, and a credential helper. The direct-request design avoids those mechanisms for this bounded text scope. The cross-judge selected it as the base.

The implementation adopts exact-byte approval, all-state/all-base PR discovery, durable draft intent, issue-scope binding, and a separate deployment bootstrap. It does not implement the candidate's proposed Git commit serializer or approval-envelope framework. GitHub creates a single-parent commit, and the publisher independently verifies its entire leaf inventory, parent, and message before exposing a branch. Retries compare actual remote content rather than predicting timestamps or commit identities.

Pure input policy, credential handling, publication, and filesystem audit have separate modules. Only the fixed operator CLI is a supported deployed entry. Test dependencies are supplied by trusted application code; no package field selects a client, executable, URL, or secret path. Imports alone convey no publishing authority.

## Live gates

Before every repository write, the publisher verifies an unchanged main SHA and issue scope, explicit unpaused state, no global pause issue, and a clear local pause control. It requires human code-owner review with stale-approval dismissal, strict checks from the GitHub Actions App, administrator enforcement, resolved discussions, linear history, no bypass actors, no force pushes or deletion, and disabled auto-merge. CODEOWNERS must name only `* @Frederik91` after comments. Active or ambiguous rulesets are unsupported and cause refusal.

The App receives contents write, pull requests write, administration read, issues read, and metadata read. It has no workflow, checks, status, or administration-write permission. GitHub includes merge capability in contents write. The deployed request capability exposes no merge, approval, ref-update, PR-edit, close, or repository-settings write operation; required human review is a separate server-side safeguard.

## Failure behavior

One private global lease serializes publisher runs. It is never automatically reclaimed after a crash. Audit events are synced before requests. A deterministic branch derives from the package hash; existing content is verified and never overwritten. Changed, closed, merged, retargeted, or non-draft PRs require operator review instead of repair.

A durable draft intent is saved before sending the PR request. If the response is lost, another invocation can adopt the exact observed draft. If no matching draft can be established, it stops rather than sending again. Unresolved intent also blocks a different package for that issue. Failed mutation attempts are counted across package hashes, up to the pinned policy limit of three. There are no automatic retries.

Tokens are revoked in normal cleanup. A hard kill can leave a token valid until its one-hour expiry. GitHub offers no transaction that binds protection/pause reads to a subsequent write. The publisher rechecks and reports observed drift, but it cannot promise a zero-width race window. Main's review rules remain the final barrier.

## Evidence boundaries

Publisher tests use a controlled HTTP fixture to verify refusal, write vocabulary, and reconciliation. Linux filesystem tests exercise actual file permissions, aliases, snapshots, locks, and durable budgets. These do not prove GitHub behavior or proposed source correctness. Qualification on the actual VM and a real App-authored draft are separate evidence. Tests and validators for proposed code run outside the credential account, with the outputs included in the reviewed proposal. No model-authored test claim is treated as a verifier result by the publisher.
