# Original room workbench integration

On 25 October 2026, the maintainer explicitly approved PR #37 together with the other open PRs for a combined server preview, tracked in #119.

The original workbench is incorporated through its current TypeScript implementation in `src/room-model.ts`, `demo/room-app.ts`, `demo/room-store.ts` and `demo/server.ts`. These preserve immutable room revisions, proposal branches, semantic deltas, local restoration and reviewable model changes, with the subsequent asynchronous backlog, Babylon viewer and model-schema work retained.

The superseded `.mjs` source and tests are not restored alongside their TypeScript replacements. The current browser bundle remains a generated deployment artifact. Existing vocabulary and workbench documentation are retained at their current versions.

The combined source passed `npm run validate` and all 441 unique tests in server containers (439 in the full root run plus its two skipped permission checks rerun under the normal user). Its production runtime image also passed all 15 real ScriptBox tests with network access disabled, a read-only root and a non-root user. The integration retains both chair-proposal regressions from #106 and the newer desk/bed acceptance regressions from #118.

This records incorporation of the original feature without replacing the current implementation with its historical prototype.
