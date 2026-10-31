# Spatial workspace qualification #258

The combined deterministic workflow passes on qualification commit `f9062c46a876d9fc3fc763989d6b0829fa8e5619`: **72 of 72 Linux checks and both real-IFC browser checks pass**, with zero failures, cancellations, skips, or todo cases. Strict validation passes with 385 TypeScript sources.

The runtime artifact is `8268247336ced9e738a57e88628421a0aac01a0c`, published as `codex/spatial-workspace-release-candidate-2`. The qualification commit differs only in the navigation browser test and the Linux archive-extraction helper. No application, model, permission, schema, deployment configuration, or provider behavior changes in this delivery. Aggregate PR #282 remains the canonical runtime change review. Readiness, merge, and human visual acceptance remain maintainer decisions.

## Source and evidence

| Item | Exact identity or result |
| --- | --- |
| Runtime source | `8268247336ced9e738a57e88628421a0aac01a0c` |
| Qualification source | `f9062c46a876d9fc3fc763989d6b0829fa8e5619` |
| Qualification tree | `243240c408da9176a693bcbc73fefe3d7346e9c7` |
| Git ZIP archive SHA-256 | `8681eac624a4c4a807e041979924cdaf9b0a0f96c624478dea080a90a2f4f31f` |
| Original `.dockerignore` SHA-256 | `791f4ca5e59055f35cf9e0386700cc0fffa51b2642183b98f8173b4078804808` |
| Linux and Windows release manifest SHA-256 | `dcc4b28343c409791c4423bf0e39bc6d01bcbf57393e732598498570278ccd6e` |

The [Linux receipt](spatial-linked-qualification-258/linux-summary.json) records every complete test file, command, source hash, count, browser choice, actual container settings, and retained artifact hash. Its `priorPrerequisite` retains the pre-#257 60-test result. `failedCombinedRuns` and `diagnosticProof` preserve the later failures and their evidence. The [IFC receipt](spatial-linked-qualification-258/converter-summary.json) records the actual converter manifest, source identity, shipped composition, camera result, isolation settings, and the earlier prerequisite. [Validator and execution output](spatial-linked-qualification-258/qualification.txt) includes the final raw run summaries. All final recorded artifact hashes were checked.

## Complete supported-Linux run

| Test file | Passed |
| --- | ---: |
| `demo/floor-plan-guide-browser.test.ts` | 1 |
| `demo/request-draft.test.ts` | 8 |
| `demo/canvas-studio-browser.test.ts` | 3 |
| `demo/request-chat.test.ts` | 7 |
| `demo/workspace-shell.test.ts` | 8 |
| `demo/spatial-plan-integration-browser.test.ts` | 1 |
| `demo/spatial-tasks-browser.test.ts` | 1 |
| `demo/spatial-tasks.test.ts` | 22 |
| `demo/spatial-markup-browser.test.ts` | 1 |
| `demo/view-navigation-browser.test.ts` | 1 |
| `demo/model-plan-browser.test.ts` | 1 |
| `demo/spatial-task-layer-browser.test.ts` | 1 |
| `demo/design-system-browser.test.ts` | 3 |
| `demo/preview-build.test.ts` | 2 |
| `demo/spatial-workspace-browser.test.ts` | 2 |
| `scripts/serve-spatial-preview.test.ts` | 10 |

Linux Node `v24.22.1`, Chromium `156.0.8078.4`, util-linux `prlimit 2.38.1`, and Poppler `22.12.0` run the unchanged full PNG and phone-PDF journey and the actual Unix-socket draft feed. The source-preparation budgets and same-origin assertions remain intact. The run covers unsent recovery, explicit acceptance, baseline and alternative isolation, SQLite restart, lost acknowledgements, late replies, task persistence, markup, actual agent-body hits, exact door review, and launcher cleanup and restart.

The Linux test container has network `none`, a read-only root, user `65032:33`, init, all capabilities dropped, and no new privileges. Bounds are 2 CPUs, 4 GiB memory with equal memory-swap, 512 processes, 512 MiB shared memory, and a 1 GiB temporary filesystem. Only owned artifacts and an exact disposable copy of built release assets are writable. The latter permits the launcher's unchanged missing-build test to temporarily rename and restore its own bundle. The release manifest must match before and after the tests. No Git metadata, host modules, account state, or user datasets enter the test image. A Dockerfile-specific ignore file includes tracked tests while keeping the original production `.dockerignore` and Dockerfile as real package-test inputs.

## Real IFC and native-agent composition

The existing `experiments/ifc-link/fixture.py` generator produces a real IFC4 file with rotated millimetre geometry and unfamiliar retained properties. Its 7,593 bytes have SHA-256 `a52ff45c732be3870dbcc368e7212d9736c6a6a536ba72901dccf05e083adfc5`. The unchanged IfcOpenShell `0.9.0.post1` converter reports 153 entities, 9 indexed objects, 4 meshes, 40 vertices, and 64 triangles. Its actual terminal receipt is `{"kind":"complete"}`. The prepared-artifact parser, every manifest hash and size, and the original source hash are checked.

The actual worker retains network isolation, a read-only root, user `65032:33`, dropped capabilities, no new privileges, 0.5 CPU, 2,304 MiB memory with equal memory-swap, 64 processes, and the restricted 32 MiB `/tmp` mount. Its only bind mount is a fresh private spool. Its existing CPU, address-space, file-size, diagnostic, descriptor, and deadline limits remain unchanged. The root Docker ignore file excludes converter sources, so the replay runner copies the unchanged converter Dockerfile and its three inputs into a minimal disposable build context.

The shipped workspace uploads these IFC bytes through the real server and waits for the actual spool conversion. Pointer picking retains the IFC source context without changing native scope. The attached context pins the actual source hash and pointer-picked GlobalId, includes occurrence and placement identity, and remains unsent until an explicit action. Referencing alone creates no ticket.

An offline clarification fixture then creates a placed native task through the actual queue. The real task body, native wall, and converted IFC are pointer-picked separately in the same original canvas. Opening the task body preserves the complete eye pose. Linked framing preserves the saved task identity and exact placement. The accepted native repository serialization remains byte-for-byte unchanged throughout. A separate real-geometry ModelViewer check verifies Inside/Fly picking, repeated Plan-intent and Overview return, the same engine and scene, one active FXAA pass, stale-pose rejection, and disposal to zero engines. Plan intent in this seam does not render an IFC cut.

Current captures show the [native task composition](spatial-linked-qualification-258/linked-native-agent-composition.png), [linked desktop workspace](spatial-linked-qualification-258/linked-workspace-desktop.png), [linked narrow workspace](spatial-linked-qualification-258/linked-workspace-phone.png), [Inside camera seam](spatial-linked-qualification-258/linked-inside-seam.png), and [Linux phone-PDF confirmation](spatial-linked-qualification-258/linux-phone-pdf-confirmed.png). Native and IFC framing are exercised sequentially with their shared task layer present; the captures do not claim that every object is visible in one camera frame.

## Construction-model delta

Repository and production-model delta is zero. In the IFC composition test, accepted native bytes do not change. The deterministic native spatial journey explicitly accepts only the fixture's hosted door from 900 to 1100 mm while preserving its physical centre and adjusting its existing host offset. The floor reconstruction fixture explicitly accepts two rooms, retains an As-is baseline, and changes the shared partition only in its alternative. Exact expected snapshots and deltas are asserted. The actual accepted fixture project and model-delta JSON remain in the Linux artifacts.

## Failure ledger and repairs

The user renewed this epic with "Continue with as many attempts as you need". That renewal overrides attempts-only stops. No validator, collision threshold, source-preparation budget, or container limit was weakened.

| Attempt or evidence | Outcome and correction |
| --- | --- |
| Initial converter packaging | The root Docker context excluded converter inputs. A minimal owned context with unchanged inputs fixes the packaging prerequisite. |
| Initial linked workspace | Model explorer starts closed. The test now opens its real navigation control; all prior assertions remain. |
| Pre-#257 Linux prerequisite | 60 of 60 checks passed. Headless shell produced cancelling pointer-warp pairs; the existing executable-path convention selects full Chromium for navigation. Real key release waits for rendered frames. |
| First combined `df0e094` | 65 of 72 passed. Shell width/history and hidden-control checks, omitted-target source-pin invalidation, and a detached-label measurement failed. Real IFC checks passed. |
| Runtime repair in `c80a269` | The owner scoped spatial CSS to the actual mounted stage and restored legacy shell layout. Cross-pin pose retention now requires an explicit matching navigation target. Existing assertions stayed unchanged. |
| Anchor proof and `525c2a9` | Retained nodes measured `isConnected=false,width=0`; a fresh query in the same callback measured connected widths `182.28125` and `64.96875`. Atomic query and measurement removes the stale-handle race. Two-label bounds, body picks, and occlusion remain; positive width is also required. |
| Combined `8268247` | 71 of 72 passed. The only failure was a fixed 1,800 ms Walk hold. Diagnostic input reached Y `5.4662`, below the wall band, after only 18 frames in `1803.9` ms. Movement intentionally caps elapsed time to 0.05 seconds per frame. No wall crossing occurred. |
| Walk harness `b93f0ce` | The key remains held until actual Y exceeds 5.5 within a bounded wait. Twenty further rendered observations and the final assertion retain the strict `5.5 < Y < 5.75` wall band. The key always releases in `finally`. No speed or performance claim is made. |
| Native archive extraction | Windows `tar.exe` failed with a `Program Files/MacType` directory error despite the owned absolute target. No tests ran. Git ZIP plus absolute `Expand-Archive` removes that current-directory dependency. The host's underlying directory drift was not investigated. |
| Final `f9062c4` | All 72 Linux checks and both real-IFC checks passed. Strict validation, artifact hashes, policy checks, and diff checks pass. |

Raw failed full runs remain under temporary directories ending `bim-forge-linux-browser-258-final-df0e094` and `bim-forge-linux-browser-258-final-8268247`. The anchor proof is in `bim-forge-linux-browser-258-anchor-old-df0/test.tap`; Walk cadence is in `bim-forge-linux-browser-258-walk-cadence-826/test.tap`. Earlier setup and targeted runs are retained rather than represented as passing final qualification.

## Replay and retained handles

Run from a dedicated worktree at qualification commit `f9062c46a876d9fc3fc763989d6b0829fa8e5619`, using PowerShell 7, Node 24+, Docker Linux containers, and installed host Playwright Chromium for the IFC test:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run validate
./scripts/qualify-linux-browser.ps1 -SourceRef f9062c46a876d9fc3fc763989d6b0829fa8e5619
./scripts/qualify-linked-ifc.ps1
```

Both runners accept a fresh explicit absolute `-OutputRoot`. The Linux runner also accepts an explicit array of complete `demo/*.test.ts` and `scripts/*.test.ts` files. Empty lists, missing files, failures, cancellations, skipped tests, todo cases, and missing test counts fail qualification. The runner keeps each suite's outputs separate and stops only its own worker. Images and output directories remain for inspection.

Final artifacts are in `C:/Users/Frederik Tegnander/AppData/Local/Temp/bim-forge-linux-browser-258-final-f9062c4/artifacts` and `C:/Users/Frederik Tegnander/AppData/Local/Temp/bim-forge-ifc-258-final-f9062c4/artifacts`. They contain per-suite TAP logs, three full Linux browser traces, the real linked composition trace, screenshots, converter requests and receipts, source pins, accepted fixture bytes, and model deltas.

Final Linux container `30d675bca42251206f7af2e54ce1ad1fd948331e752f3adc15ad042bcb44ec53` exits with code 0. Its image is `sha256:5b71227a573a6f8739a2324aab36328a1e5e9b8d0d3d8b619b4a67ab0afa4839`. Final IFC worker `3753c134257cf3e4f28df51e95139df49e5ebb5aa3ee2ae69abc59d7971b08dd` is stopped after the successful receipt. Its image is `sha256:7fc581946a4f928e9f093313062d76e3e6c1b82a6b525c5824eac4f2c103f735`. Test servers and browsers close. The parent's preview, persistent converter, and existing 4188 prototype remain untouched.

## Parent-owned local preview

The parent deployed runtime `8268247` at [the local preview](http://127.0.0.1:4189/). This lane independently read its ready receipt, confirmed process `64028` and healthy local status, and compared all four served bundle and stylesheet byte hashes with the qualified worktree build. AI was connected and IFC was configured. The ready receipt records clean source at startup and build identity `cfbee3d64e5dac36ded9709b1d4c8e7997a60d48b353552f909af1e1658f0682`. These facts and the parent's separately reported unchanged accepted head after restart are distinguished in the IFC receipt. This lane did not deploy or make provider calls. These checks do not constitute human visual acceptance.

## Limits and review decision

This run uses controlled native fixtures and generated real IFC. It does not assess a user-project copy, survey accuracy, arbitrary IFC compatibility, or production model data. Georeferencing remains retained but unapplied; unmapped properties and relationships remain explicit converter diagnostics. Linked IFC Plan cuts, Section, and linked-floor Walk support are unqualified. Team privacy and identity enforcement remain separate design work.

The parent's [bounded connected-provider evidence](spatial-connected-qualification-258.md) is separate from these deterministic checks. No additional provider interpretation accuracy is claimed here. Review the captures and these limits before changing readiness or authorizing merge. No issue closure, main merge, or automatic rollout is authorized by this report.
