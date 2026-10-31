# Local spatial preview, issue #279

Issue [#279](https://github.com/Frederik91/bim-forge/issues/279), within [#251](https://github.com/Frederik91/bim-forge/issues/251). This launcher supports the first single-engineer milestone. Construction-model delta is zero. The launcher uses the existing server, queue, schemas and explicit acceptance path. It does not change production deployment configuration.

## Plan and implemented scope

`scripts/serve-spatial-preview.ts` uses the public `createDemoServer` and `CodexAccountConnection.open` APIs. The existing account connection keeps its normal home. Preview storage requires an explicit absolute directory outside that home, with a marker created only for a new directory. Unknown existing directories, foreign files, directory links and invalid markers are refused. An exclusive lock prevents another launcher from opening the same preview database. Port conflicts leave the existing listener running.

The launcher binds `127.0.0.1` and defaults to port 4188. It checks all five served static assets before claiming storage. Its readiness receipt reports PID, URL, canonical data directory, AI and IFC availability booleans, Git revision and dirty status when available, and a SHA-256 of the served source and built assets. The receipt contains no account details or credentials. Rebuild before launch; the hash identifies bytes but does not prove a build is fresh.

Signal shutdown stops HTTP access, awaits the existing workers and account cleanup, and releases the lock. The same owned SQLite database reopens on a clean restart. IFC conversion remains optional through the existing linked-model API and an operator-prepared dedicated spool. The launcher does not start a converter or manage Docker or services.

## Start and stop a local preview

Run these commands from the final integrated checkout with Node 24 or newer. The data-directory leaf must be new for the first launch. Its parent may already exist. If an unknown directory already occupies that path, choose another path rather than marking or copying existing user state.

```powershell
npm ci --ignore-scripts
npm run build:demo
node scripts/serve-spatial-preview.ts --data-dir "$env:LOCALAPPDATA/BIMForge/spatial-preview-251" --port 4188
```

The existing AI account opens normally. Add `--offline` to run without opening an account connection. Open `http://127.0.0.1:4188`. Check `http://127.0.0.1:4188/api/health` for `status: ok`. The readiness receipt reports `aiConnected` separately; HTTP readiness alone does not prove AI availability.

For linked IFC import, append `--ifc-spool <absolute-dedicated-spool>`. Prepare that spool and its isolated converter separately. The spool must already exist, outside preview data and the AI account home. Without a spool, health truthfully reports `ifcLinks: unavailable`.

Press Ctrl+C to stop. Wait for the `stopped` receipt before restarting the same command. A hard kill can leave `.preview-running`. Verify the recorded PID has stopped before manually removing that lock from this owned preview directory. The launcher never kills another process or automatically removes a stale lock.

For a programmatic offline preview:

```typescript
import { parseSpatialPreviewConfig, startSpatialPreview } from './scripts/serve-spatial-preview.ts';

const config = parseSpatialPreviewConfig(['--data-dir', absoluteNewDirectory, '--port', '4188']);
const preview = await startSpatialPreview(config, { connection: null });
try {
	// Use preview.receipt.url with the existing server routes.
} finally {
	await preview.close();
}
```

## Reproduce the evidence

```powershell
npm run validate
npm run build:demo
node --test scripts/serve-spatial-preview.test.ts
node --test --test-force-exit --test-name-pattern='local demo serves|server configuration|authentication endpoints|proposal endpoint|slow proposals|HTTP cancellation|remote runtime' demo/server.test.ts
node scripts/validate-policy.ts --changed-files scripts/serve-spatial-preview.ts scripts/serve-spatial-preview.test.ts scripts/fixtures/local-preview-process.ts docs/evidence/local-spatial-preview-279.md
git diff --check
```

The focused suite uses disposable temporary SQLite state and explicit injected offline connections. A local scripted worker tests actual queue cancellation and drain order without a provider or model call. Real HTTP checks cover health, all served assets and exact portable-project import/read across restart. Other cases cover invalid ports and paths, untouched foreign databases, marker recognition, directory aliases, active and stale locks, occupied ports, startup cleanup, missing assets, and separate IFC storage. The missing-build case temporarily renames this checkout's ignored bundle, then restores it. Run this suite after building and without another process rebuilding this checkout.

Each signal test starts a child process with deliberately delayed account cleanup. It proves the HTTP listener stops while the directory remains locked, then proves the `stopped` receipt and lock release follow cleanup. Windows forcibly terminates a process when another process sends OS signals, so the Windows fixture dispatches SIGINT and SIGTERM through Node's registered signal events over local IPC. POSIX uses actual OS signals. Native Windows console Ctrl+C delivery remains a manual check.

## Attempt ledger and results

- 2026-10-31, attempt 1: isolated `codex/issue-279-local-preview` from `a008d802`. Issue #279 was unpaused and no open issue had `loop-pause-all`. `npm ci --ignore-scripts` passed with 203 packages and zero reported vulnerabilities. Current source APIs were checked in this worktree. The indexed graph confirmed the server owner but was not used as proof of current behavior. Initial launcher build, validation and all nine focused tests passed.
- A broader server and project-store run exposed existing Windows `EPERM` cleanup failures. The isolated existing test `project source HTTP retention` reproduces the failure at `demo/server.test.ts:70`, where its cleanup removes a temporary directory before the database is closed. The hanging owned test process was stopped. No existing test or validator was changed. The full platform-dependent suite is not claimed as passing.
- Attempt 2 added explicit rejection of an IFC spool overlapping the account home, directory-link coverage and stale-lock coverage. Final results are recorded below. The maintainer's epic instruction allows continued repair attempts. Validators and human merge authority remain intact.

Final validation: `npm run validate` passed (`Strict TypeScript valid. 382 source file(s) checked.`, `tsc --noEmit`, policy). The demo build passed. All ten focused launcher tests and seven existing server-route tests passed, with zero failures. Explicit policy validation checked all four changed files. `git diff --check` passed. No connected-provider accuracy, final integrated browser qualification, persistent local deployment, PR readiness, merge or issue closure is claimed. The parent integration lane owns the final #257/#258 preview launch and maintainer change review.
