# Contributing

Start with an issue that describes the desired BIM or product outcome, scope, constraints, and acceptance evidence. If it is ambiguous, clarify it before writing code. Small, reviewable pull requests are preferred over broad rewrites.

## Set up a checkout

Use Node.js 24 or newer and npm:

```sh
npm ci
```

For the browser workspace, run `npm run build:demo` before `node demo/server.ts`. See the [workspace guide](docs/room-demo.md) for local use and the [deployment guide](deploy/preview/README.md) for private Docker operation.

Some source-input tests exercise PDF preparation through the Poppler command-line tools `pdfinfo`, `pdftoppm`, and `pdftotext`. Install `poppler-utils` on Debian/Ubuntu, or the equivalent Poppler tools for your platform. CI installs this package before validation/tests. Use disposable model data and isolated temporary state; tests and experiments must not target the live preview database or another project's credentials.

## Before opening a pull request

1. Read [AGENTS.md](AGENTS.md), [LOOP.md](LOOP.md), [STATE.md](STATE.md), and [policy/loop-constraints.md](policy/loop-constraints.md). Available implementation tools do not change the checked-in L1 operating level.
2. Work in a dedicated branch/worktree, with one issue and one coherent change. Record a short plan naming affected files/entities, validators, and expected evidence.
3. Run the checks below. Record actual commands, outcomes, and environment blockers; do not describe a skipped or blocked check as passed.
4. For model changes, include fixtures, semantic deltas, validator output, and rollback notes. UI changes need relevant browser evidence as well as deterministic tests.
5. Open a draft pull request, link the issue, include a concise change/validation summary, and identify the required human reviewers. Do not merge or close issues automatically.

## Validation and tests

```sh
npm run validate
npm test
```

`npm run validate` runs the TypeScript lint/migration guard, `tsc --noEmit`, and machine-readable policy validation. It does not execute the regression suite. `npm test` runs qualification-contract checks, builds the demo, runs the configured application/factory tests, and finishes with the asset suite. See [package.json](package.json) for the authoritative script list.

Run focused checks while developing, then the relevant broader checks before review:

```sh
npm run test:qualification-contracts
npm run test:viewer-benchmark
npm run test:assets
```

For request-chat and workspace-shell browser changes, the separate browser suite uses Playwright Chromium:

```sh
npx playwright install chromium
npm run build:demo
npm run test:chat-browser
```

Install browser OS dependencies as required by Playwright on your platform. A passing non-browser suite does not establish cross-browser, physical-touch, or deployed-preview behavior.

CI runs `npm ci`, installs Poppler, runs `npm run validate` and `npm test`, and separately passes changed PR paths to `scripts/validate-policy.ts --changed-files`. A plain validation run checks policy structure but does not discover a Git diff. The automated publication file-count budget is checked by the publication path, not by the policy validator. Never disable a validator or weaken policy to make a patch pass.

The project is intentionally conservative around model mutation. Passing CI is necessary but never sufficient for geometry, coordination, schema, permission, or security changes. Preserve failed evidence and escalate after the configured attempt limit rather than retrying indefinitely.

## Documentation changes

Distinguish implemented prototype behavior from proposed architecture and qualification outcomes. Keep user-facing entry points aligned with source, package scripts, and tests. Link historical design/evidence records rather than rewriting their original results. Do not promote milestones, alter factory control state, or claim a deployment/benchmark succeeded based only on implementation tests.
