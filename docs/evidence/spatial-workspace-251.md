# Inside-first workspace: assembled change review

Epic [#251](https://github.com/Frederik91/bim-forge/issues/251); canonical integrated draft [#282](https://github.com/Frederik91/bim-forge/pull/282). Production base: `bc7fbd392f036a6fda055599854f29670a27f279`. The accepted study remains [#249](https://github.com/Frederik91/bim-forge/pull/249); this implementation uses the existing production owners rather than deploying the throwaway study.

## Experience

An engineer enters a native building and navigates with WASD and explicit mouse-look. Escape releases capture. Fly uses Shift up and Ctrl down. Detailed native Plan and Overview remain nearby; unsupported Section stays disabled. Starting a chat captures a fixed point separately from its source-bound objects and regions. A hovering task agent represents that durable conversation. Clicking it opens the same chat and highlights its associated targets without moving the camera. Return to task is explicit.

The existing worker queue, exact proposal identity, independent validators and accepted-head compare-and-swap remain authoritative. The model changes only after explicit acceptance. Multiple tasks can occupy one point; legacy tasks without reliable placement remain in the list without invented figures.

## Parallel delivery

| Owner | Draft change review | Evidence |
| --- | --- | --- |
| #261 shared contracts | #266 | [Contracts](spatial-contracts-261.md) |
| #252 visual system | #269 | [Design system](spatial-design-system-252.md) |
| #253 single task controller | #272 | [Controller and response ordering](spatial-task-controller-253.md) |
| #254 saved origins and targets | #273 | [Placement and rollback](spatial-placement-254.md) |
| #255 navigation | #271 | [Navigation](spatial-navigation-255.md) |
| #262 native Plan core | #275 | [Plan core](spatial-plan-core-262.md) |
| #263 task graphics | #276 | [Agent graphics](spatial-agent-layer-263.md) |
| #264 actual acceptance fixtures | #277 | [Fixture contract](../../tests/fixtures/spatial-workspace/README.md) |
| #256 live Inside / Plan | #278 | [View integration](spatial-plan-integration-256.md) |
| #257 spatial chat | #281 | [Live task workflow](spatial-workspace-257.md) |
| #259 future team access design | #267 | [Privacy design](team-identity-privacy-259.md) |
| #265 Windows resource cleanup | #268 | [Baseline repair](request-store-cleanup-265.md) |
| #270 centred hosted door | #274 | [Real geometry operation](centred-hosted-door-270.md) |
| #279 isolated local launcher | #280 | [Launcher](local-spatial-preview-279.md) |
| #258 combined qualification | #283 | [Linux and IFC qualification](spatial-linked-qualification-258.md) |

Each lane used a separate branch/worktree. Published foundation, domain, component and Plan branches provide dependency baselines. Draft #282 composes those changes for one main-branch change review. The maintainer authorized this epic-wide assembly and local deployment; the per-task reviews preserve narrow ownership and failure evidence. No issue closure, ready transition or main merge is automated.

## Acceptance audit

| Requirement | Concrete evidence |
| --- | --- |
| Fixed origin, independent targets, reload | Placement schema/storage tests and shipped spatial-workspace browser journey |
| Real body hit and same-point tasks | Actual viewer ray result must be `task` or `chooser`; two durable ticket IDs with identical original points |
| No incidental camera movement | Exact eye/forward/up/project/level/motion assertions before and after body pick and chooser; Return separately tested |
| Actual model-changing proposal | ScriptBox WASM hosted-door operation; 900→1100 mm with offset 3.0→2.9 m and unchanged centre/hosting |
| No implicit publication | Accepted head unchanged before explicit UI decision; complete resulting snapshot compared with an independent oracle |
| Region-only and stale/unplaced context | Production markup replay plus fixture/placement tests; no implicit nearest-object target or invented origin |
| Cancellation, restart, late and conflicting results | Actual queue and persistence fixture journeys; causal controller regression tests |
| One renderer and construction isolation | Preserved engine/canvas; batched wall occlusion, construction picking, framing and serialization assertions |
| Detailed actual native Plan | Shared renderer replaces old live drawing/projection; source-qualified hit mapping, comparison, pan/zoom and narrow checks |
| Keyboard and input safety | Navigation tests, real browser mouse-look, Escape/blur/hidden/editor isolation; Shift/Ctrl Fly controls |
| Future privacy scope | Design-only access/publication contract; no unenforced audience selector or simulated team presence |
| Supported Linux, real IFC, live provider, persistent local release | Exact-source 72/72 Linux checks, 2/2 real IFC gates, one real provider case and verified persistent local runtime below |

## Integration run record

- `895e6c2`: composed the final initial #257 runtime with the Linux qualifier and isolated launcher. `npm run validate` passed (384 strict source files), demo build passed. Combined controller, fixture/queue, live spatial workflow, markup, Plan and launcher: **48 passed, 0 failed/skipped**.
- `036d649`: added the existing spatial component/launcher checks to the default test path and an explicit browser replay command. `npm run validate` passed; `npm run test:spatial-components`: **28 passed, 0 failed/skipped**. No assertion or validator was removed.
- Clean GitHub CI caught a missing build prerequisite in that newly composed command. `cc21234` builds the demo before component/launcher checks; validation and all 28 checks pass. The initial failed CI runs remain visible in draft #282.
- Parent visual review identified clipped proposal controls under the floating chat header and duplicate phone Assistant navigation. The correction reserves the header/navigation height, keeps one transcript scrollport, and allows each action to scroll fully into view and receive a pointer hit. Refreshed desktop/390/320 captures and the unchanged regression checks pass.
- Final Linux **72/72** and real IFC **2/2** qualification passed at `f9062c4`; the persistent local deployment runs the unchanged application bytes from `8268247`. Earlier Linux **60/60** and real IFC receipts remain predecessor evidence rather than substitutes for the final combined pass.
- The next clean Linux run found that a forbidden IFC-spool path under an absent account home raised a filesystem error before the intended separation refusal. `86be8bd` resolves existing ancestors before the overlap check; all 10 unchanged launcher tests pass with both the normal and a genuinely absent account-home path. The path remains absent. This is a boundary-order correction, not a relaxed assertion.
- [One bounded real-provider case passed](spatial-connected-qualification-258.md): one actual worker invocation, complete independent 1100 mm proposal oracle and explicit UI acceptance. Runtime source `895e6c2`. The run exposed an incidental browsing-level target beside the selected door; #257 subsequently narrowed automatic submission targets to explicit selections while preserving view-level metadata. Actual HTTP and persisted-placement assertions prove door-only targets. The original receipt is retained; no provider retry substitutes for fixing target construction.

## Final release qualification

Runtime pin: `8268247336ced9e738a57e88628421a0aac01a0c`, published as `codex/spatial-workspace-release-candidate-2`.

The final qualification source is `f9062c46a876d9fc3fc763989d6b0829fa8e5619`. Its only differences from runtime `8268247` are the navigation browser harness and Linux qualification driver. Application/backend bytes are unchanged. The driver uses an exact Git ZIP archive and native absolute extraction after a host tar invocation failed before any test ran.

**Final result: all 72 checks across all 16 complete Linux suites passed, with zero failures, skips, cancellations or todos. Both real IFC gates passed on that same qualification source.** Strict validation passed for 385 source files. Owned temporary qualification containers were stopped; the user-facing local server and its isolated IFC converter remain running.

The coordinator independently checked all 16 recorded test-source hashes against the qualified Git blobs, all 67 retained Linux artifact hashes and all 16 IFC artifact hashes. The actual IFC fixture hash and terminal `complete` receipt match. Docker inspection confirms the Linux test container exited successfully and the owned converter was stopped after its result. Draft [#283](https://github.com/Frederik91/bim-forge/pull/283) preserves this separate qualification review; #282 includes its complete evidence.

The first complete Linux pass at predecessor `df0e094` recorded **65 passed, 7 failed, 0 skipped** across 16 suites (72 tests, with parent/subtest failure accounting). The failures exposed three concrete causes:

1. Spatial-only CSS also affected consumers mounting the standalone legacy shell. The repair requires the actual spatial stage mount; unchanged minimum model-height, readable phone history and toggle assertions pass again.
2. Two omitted navigation targets compared equal and authorized cross-source Inside pose retention. Rebinding now requires an explicit matching target; the original source-change fallback assertion passes unchanged.
3. The graphics gallery replaces labels each frame. A retained old element measured disconnected/zero width while a fresh query in the same callback measured a connected positive-width element. Atomic current-element query/measurement fixes the harness race, retaining count and bounds checks and adding positive-width checks.

The repaired shell/navigation/shipped-workspace batch passed **12/12**, and strict validation checks 385 source files. Full supported Linux and real IFC reruns use the new exact pin; their final receipts are recorded by #258. The predecessor's full GitHub repository run passed **1,100 tests, 2 optional skips, 0 failures**. These are separate evidence sets, not totals to combine.

The next complete 8268247 run passed **71/72**. Its only failure was the wall test's fixed 1.8-second arrival assumption under CPU-limited software rendering: 18 rendered frames left the eye at 5.4662 m, short of the original lower bound, without crossing the wall. The harness now waits within a fixed deadline to reach that same band, then checks the original strict 5.5–5.75 m bounds on 20 successive rendered observations and at the end. Movement code, resources and collision thresholds are unchanged. The full navigation check passes with this correction; the earlier failed receipt and frame-cadence proof remain recorded.

## Local deployment

The implemented application is running at **http://127.0.0.1:4189/**. Port 4188 still serves the earlier demo and was left untouched. The final server started from clean source `8268247`, process 64028, with build identity `cfbee3d64e5dac36ded9709b1d4c8e7997a60d48b353552f909af1e1658f0682`.

Sanitized machine-readable receipt: [deployment.json](spatial-workspace-251/deployment.json).

Health reports local mode, the existing AI account connected and IFC configured. Four served application/CSS files match their built bytes exactly. The disposable native project and its accepted revision survived the owned-process restart unchanged; the browser confirms one canvas, one retained linked IFC model and an enabled composer. Live keyboard/Plan checks proved WASD, Shift ascent in Fly and typing isolation. No agent request was submitted by the persistent-server smoke checks.

The dedicated preview database is outside the AI account home. Startup records retain its exact canonical location locally under `%LOCALAPPDATA%/BIMForge/spatial-preview-251-evidence/`. That directory also contains `server.stdout.log`, `served-assets.json`, `live-browser.json`, `live-ifc.json` and restart/process receipts. Raw qualification and build logs were moved from untracked working files into its `integration-working-records` directory; the reviewed append-only decision trail remains `.audit/spatial-workspace-251.tsv` in Git.

The desktop application's filesystem alias initially caused Docker to mount a different empty spool. The owned converter was stopped and replaced with one mounting the actual canonical preview spool; a real 7,593-byte IFC then converted through the persistent server and rendered alongside the native model. The replacement remains network-isolated with a read-only root, unprivileged user, dropped capabilities, CPU/memory/PID bounds and only the dedicated spool mount. No credential or account directory is mounted.

Restart the server from this checkout using `node scripts/serve-spatial-preview.ts --data-dir <canonical-owned-preview-directory> --port 4189 --ifc-spool <canonical-owned-spool>`. Use the canonical paths in the local startup/worker receipts, particularly when launching from the packaged desktop application. Stop the previous owned process first; after a crash, verify its process tree is stopped before removing only its stale `.preview-running` lock. Do not adopt an unrelated database or stop an unknown listener.

## Data and release limits

Production-model delta is zero. Geometry evidence uses disposable projects. The qualifying delta changes one Door width and its existing hosted-by offset; no floor reconstruction or expected-snapshot shortcut supplies the worker result.

Placement is additive optional JSON metadata with append-only recoveries. Old strict binaries reject new fields. Rollback requires a consistent pre-upgrade backup or a fresh disposable preview database. The local launcher refuses unknown existing directories, separates preview model data from the normal AI account home and reports source/build identity. It never copies account credentials.

Section, linked IFC Plan/collision walking, full stairs, VR, team identity/authorization, shared presence, human text/voice and synchronized speech/pointing/drawing remain later gates. Windows PDF preparation has a pre-existing host prerequisite limitation; complete PDF and Unix-socket checks run on supported Linux. Human visual acceptance and merge remain maintainer decisions.
