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
| #258 combined qualification | Pending final evidence | [Linux and IFC qualification](spatial-linked-qualification-258.md) |

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
| Supported Linux, real IFC, live provider, persistent local release | Final qualification below; pending until recorded explicitly |

## Integration run record

- `895e6c2`: composed the final initial #257 runtime with the Linux qualifier and isolated launcher. `npm run validate` passed (384 strict source files), demo build passed. Combined controller, fixture/queue, live spatial workflow, markup, Plan and launcher: **48 passed, 0 failed/skipped**.
- `036d649`: added the existing spatial component/launcher checks to the default test path and an explicit browser replay command. `npm run validate` passed; `npm run test:spatial-components`: **28 passed, 0 failed/skipped**. No assertion or validator was removed.
- Clean GitHub CI caught a missing build prerequisite in that newly composed command. `cc21234` builds the demo before component/launcher checks; validation and all 28 checks pass. The initial failed CI runs remain visible in draft #282.
- Parent visual review identified clipped proposal controls under the floating chat header and duplicate phone Assistant navigation. A presentation correction and recapture are required before final visual qualification.
- Final Linux/IFC rerun, one bounded connected-provider case and persistent local deployment are in progress. Earlier Linux **60/60** and real IFC receipts are useful predecessor evidence, not proof of the later combined source.
- [One bounded real-provider case passed](spatial-connected-qualification-258.md): one actual worker invocation, complete independent 1100 mm proposal oracle and explicit UI acceptance. Runtime source `895e6c2`. The run exposed an incidental browsing-level target beside the selected door; #257 is narrowing automatic submission targets to explicit selections while preserving view-level metadata. This finding and the original receipt are retained; no provider retry is used as a substitute for fixing target construction.

## Data and release limits

Production-model delta is zero. Geometry evidence uses disposable projects. The qualifying delta changes one Door width and its existing hosted-by offset; no floor reconstruction or expected-snapshot shortcut supplies the worker result.

Placement is additive optional JSON metadata with append-only recoveries. Old strict binaries reject new fields. Rollback requires a consistent pre-upgrade backup or a fresh disposable preview database. The local launcher refuses unknown existing directories, separates preview model data from the normal AI account home and reports source/build identity. It never copies account credentials.

Section, linked IFC Plan/collision walking, full stairs, VR, team identity/authorization, shared presence, human text/voice and synchronized speech/pointing/drawing remain later gates. Windows PDF preparation has a pre-existing host prerequisite limitation; complete PDF and Unix-socket checks run on supported Linux. Human visual acceptance and merge remain maintainer decisions.
