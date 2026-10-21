# Publish an approved change

Use the installed, root-owned publisher from the VM administrator account. Do not run proposed source in the credential-bearing account. The publisher has no scheduler or public endpoint.

## Prepare the package

1. Create an isolated worktree from a pinned `main` revision.
2. Implement one open issue and run the applicable tests and `npm run validate` without App credentials.
3. Review the complete file contents, changed paths, validator outputs, and change summary.
4. Create a UTF-8 JSON package with exactly these fields:

```json
{
  "version": 1,
  "repository": "Frederik91/bim-forge",
  "issue": 14,
  "issueUpdatedAt": "<GitHub issue updated_at>",
  "issueSha256": "<issue title/body fingerprint>",
  "baseSha": "<full main revision>",
  "title": "<reviewed PR title>",
  "body": "<reviewed summary, validation evidence, and recovery instructions>",
  "files": [{ "path": "docs/example.md", "content": "<complete UTF-8 contents>" }]
}
```

The fingerprint is SHA-256 of `JSON.stringify({ number: issue.number, title: issue.title, body: issue.body })` from the selected GitHub issue. Placeholder values above are not valid input. File contents are inline, never paths to files that the publisher later opens.

Inspect the package without credentials:

```sh
node factory/publish.mjs --inspect proposal.json
```

Record the reported SHA-256 independently. Changing any byte requires another publication approval. Limits are 512 KiB per package, 64 KiB per file, and at most the pinned repository's file limit, capped at 12. Only additions and replacements of regular text files are supported.

## Stage and publish

The administrator installs the reviewed package under `/var/lib/bim-forge-approvals/<sha256>.json`, owned by root with mode `0640` and group `bimforge-github`. The approval directory is root-owned, group-readable, and not writable by either the worker or publisher. Do not put App keys in the proposal or checkout.

Start the fixed service with the approved digest:

```sh
sudo systemctl start bim-forge-publish@<sha256>.service
sudo journalctl -u bim-forge-publish@<sha256>.service --no-pager -n 12
```

The service reads only that package, verifies live gates, creates or reconciles a new factory branch, and opens a draft targeting `main`. It never marks the draft ready, approves, or merges. A completed result contains `tokenRevoked: true`. Private audit records are under `/var/lib/bim-forge-publisher/`; source content and credentials are not included in those events.

## Stop or recover

To stop future writes immediately, create `/var/lib/bim-forge-approvals/PAUSED` as the administrator. The publisher also honors explicit `paused: true` in `STATE.md` and an open repository issue or PR with `loop-pause-all`.

Retry the same digest after a normal failure. The publisher verifies remote state instead of updating branches. An unresolved PR request requires operator reconciliation; do not change the digest to bypass it. An interrupted global lease also requires administrator recovery. Stop all publisher units, verify no publisher process remains, preserve the audit, and inspect remote state before removing only the exact stale lease. Never clear approval, intent, or issue-budget records to make a failing job proceed.

GitHub scope and installed publisher code are administrator-managed deployment state. Merging this PR does not upgrade a running VM or grant App permissions. See [the publisher design](publisher-design.md) for the supported scope and residual risks.
