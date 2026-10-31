# Request-store test cleanup on Windows

Issue #265, an additional qualification prerequisite for epic #251.

## Change and reason

The existing durable request tests registered temporary-directory removal before
later asynchronous store shutdown. Windows refused removal with EPERM while SQLite
still held the files. A shared temporary-resource owner now closes every opened or
reopened queue and diagnostic database before removing its directory. It also owns
cleanup when an assertion interrupts the test. The resolved removal target is
checked to remain a direct child of the temporary root created for the test.

Affected files: `demo/change-requests.test.ts`,
`demo/request-conversation-queue.test.ts`, and `demo/request-test-resources.ts`.
No runtime or model entity changes. Existing assertions, failure expectations,
restart steps and validator checks remain intact.

## Attempt ledger and evidence

- Baseline: production `bc7fbd3`, planning `7cc7903`, Windows, Node 24.18.0.
  `node --test demo/model-scene.test.ts demo/change-requests.test.ts
  demo/request-conversation-queue.test.ts` failed during temporary-folder teardown.
  Original output: integration worktree `.audit/baseline-tests.tap`.
- A local transformation script initially used a compiler API absent from the
  installed TypeScript 7 package. It stopped before changing the test files. A
  scratch-only TypeScript parser transformed the affected test callbacks without
  changing their assertions. No package manifest or lockfile was changed.
- After repair, the same three suites passed: **64 tests, 64 passed, 0 failed,
  0 skipped**. Output: this worktree `.audit/after-fixed-tests.tap`.
- `npm run validate` passed: 348 source files checked, typecheck and policy passed.
- Changed-path policy and whitespace checks are run before publication.

The reusable owner replaces lifecycle ownership; it does not suppress cleanup
errors, ignore EPERM, skip assertions or weaken validators. Explicit intermediate
closes remain where tests inspect or reopen SQLite data. Queue close is already
idempotent and its existing shutdown test remains unchanged.

Construction-model delta: **zero**. No providers, migration, deployment or merge.
