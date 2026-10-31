# Linked IFC qualification prerequisite #258

This record covers the linked IFC prerequisite for [#258](https://github.com/Frederik91/bim-forge/issues/258), within epic #251. The prerequisite passes on 2026-10-31. Combined qualification still depends on #256 and #257.

## Plan

Add `scripts/qualify-linked-ifc.ps1`, `demo/linked-navigation-qualification.test.ts`, and this record. Reuse the existing fixture generator, external converter, and `demo/linked-workspace-browser.test.ts`. Open the current shell's Model explorer in the existing browser test. Generate a tiny IFC from source in disposable storage. Run the actual worker under the repository's container isolation limits. Keep accepted native model bytes unchanged. Capture linked pointer selection, source context, and desktop and narrow screenshots. Retain converter receipts and source hashes for inspection.

No production application code, model data, validator, deployment configuration, credential, or provider connection changes. Construction-model delta is zero. The generated IFC is a qualification source, not accepted project content.

## Replay

From a Windows PowerShell session with Docker Linux containers, Node 24+, and installed Playwright Chromium:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
./scripts/qualify-linked-ifc.ps1
```

The runner creates a unique local image, a fresh temporary directory, and a named worker. It mounts only its private spool into the worker. The fixture generator sees only copied generator source and its own output directory. The browser test creates a disposable server on a dynamic loopback port and its own native store. The runner stops only its own worker in `finally`, retains the stopped container and image, and prints the artifact directory. Existing files are never deleted. Optional `-OutputRoot` must name a directory that does not exist.

The root `.dockerignore` excludes `experiments`, so building `deploy/ifc-link/Dockerfile` directly against the repository fails. The runner copies that unchanged Dockerfile and the three required converter inputs into its fresh build context. No deployment-file change is needed.

## Results

Source baseline is `d6f078da7cf9967e3b38a84a94ee8ac6750118ae`, with the qualification changes in this delivery. Windows Node 24 and Docker 29.9.2 run the existing production server and Linux converter. The converter uses IfcOpenShell `0.9.0.post1`.

The generator produces an IFC4 file with rotated millimetre geometry and unfamiliar retained properties. The 7,593-byte source has SHA-256 `a52ff45c732be3870dbcc368e7212d9736c6a6a536ba72901dccf05e083adfc5`. The actual converter reports 153 entities, 9 indexed objects, 4 meshes, 40 vertices, and 64 triangles. Its terminal receipt is `{"kind":"complete"}`. The camera test validates the prepared artifacts with `parseLinkedPrepared`, checks every manifest artifact hash and size, and checks the source hash against the generated IFC.

The runner verifies the actual Docker container configuration before the browser tests. The worker has network `none`, a read-only root, init enabled, user `65032:33`, all capabilities dropped, and `no-new-privileges:true`. Limits remain 0.5 CPU, 2,304 MiB memory with equal memory-swap, 64 processes, and the 32 MiB restricted `/tmp` mount. Its only bind mount is the fresh private spool. The unchanged worker also applies its CPU, address-space, file-size, descriptor, diagnostic, and deadline limits.

| Evidence | Observed result |
| --- | --- |
| Shipped workspace, actual HTTP upload and spool conversion | Passed. Source hierarchy and original properties appear from the converted IFC. |
| Actual pointer selection in the shipped viewer | Passed. Linked selection retains native scope selection, and only one canvas is visible. |
| Reference in request | Passed. A source-pinned read-only context file is attached to the unsent draft. The prompt has no raw source metadata. No request ticket is submitted. |
| Accepted native state | Passed. The server's accepted repository serialization is byte-for-byte unchanged. |
| Visibility and narrow viewport | Passed. Linked geometry toggles off and on. The 390-pixel viewport has no horizontal overflow. This assertion is narrower than overall mobile usability approval. |
| Actual converted geometry in the ModelViewer Inside seam | Passed. A real converted wall is picked by a pointer click in Fly perspective view, retaining its source hash, namespace, revision, occurrence, transform, and GlobalId. |
| Repeated camera transitions | Passed. Four Plan-intent, Overview framing, and Inside-resume cycles retain one engine, the same scene, one canvas, and one active FXAA pass. This test does not render a Plan cut. |
| Stale pose and disposal | Passed. A different source pin is rejected. Native snapshot JSON remains unchanged. Disposal leaves zero engines. No browser page errors occur in either test. |
| Strict validation | Passed. `npm run validate` checks 378 TypeScript source files. Explicit policy validation checks all 9 changed files. `git diff --check` passes. |

Committed evidence includes [validator and browser output](spatial-linked-qualification-258/qualification.txt), [converter receipt, source identity, isolation settings, and camera result](spatial-linked-qualification-258/converter-summary.json), [desktop workspace](spatial-linked-qualification-258/linked-workspace-desktop.png), [narrow workspace](spatial-linked-qualification-258/linked-workspace-phone.png), and [Inside camera seam](spatial-linked-qualification-258/linked-inside-seam.png). The seam capture uses a dedicated test page with the real production ModelViewer. It does not show the forthcoming #256 controls.

## Run ledger and retained handles

The user renewed epic work with "Continue with as many attempts as you need". That renewal overrides attempts-only stops for this epic. Every isolation limit and validator remains in force.

| Attempt | Outcome and correction |
| --- | --- |
| Direct converter image build | Failed because the root Docker context excludes converter sources. A fresh minimal context fixes the packaging prerequisite without changing deployment files. |
| Runner 1 | Generated real IFC and started the isolated worker. The browser stopped before upload because the current shell starts Model explorer closed. The test now opens the actual navigation control. All existing assertions remain. |
| Runner 2 | Real conversion and the shipped workspace test passed. The first separate camera-seam attempt chose a horizontal triangle. The test now finds a vertical wall face from the real tessellation. The corrected camera check passed. |
| Runner 3 | Fresh source generation, actual isolation assertions, real conversion, shipped workspace test, and Inside camera test all passed. The screenshot was then constrained to the page width and the camera test passed again against the retained converted output. |
| Final strict check | TypeScript reported an inference error in the test's triangle destructuring. Explicit `Vector3[]` annotation fixes the test type. Strict validation then passed without weakening a check. |

The final retained root is `C:/Users/Frederik Tegnander/AppData/Local/Temp/bim-forge-ifc-258-prerequisite-run3`. Its `spool` contains the original IFC, request, converter stdout, terminal receipt, and actual output artifacts. Its `artifacts` contains raw Docker inspections, browser logs, screenshots, and validation output. The replay script can create a fresh run after #256 and #257 integrate.

All three owned workers are stopped. Final worker `bd25a0bbf79af308db056d2b87321f0a8de983ac6afc3a1ada13d5dbb9101741` is named `bim-forge-ifc-258-906bbb39b7d54c95a2d78c02c40488f8`. Its image is `bim-forge-ifc-qualification:258-906bbb39b7d54c95a2d78c02c40488f8`, resolved to `sha256:22bdcf5dde735377529719094df7180b8f45884a46cd94f8ad8687945e6f59dd`.

Earlier stopped worker IDs are `d78ca6a318aa53fee3295f4698c9b9a7eae6f8460acef97853957bec4b0071e9` and `c3e6d3767fa9945a1f1cf77dfa1494f64c878c051c6445e07696af45b5c567a8`. Their roots end in `prerequisite-run1` and `prerequisite-run2`. The initial standalone build context remains under temporary root `bim-forge-ifc-258-d6f078d`, with image tag `bim-forge-ifc-qualification:258-d6f078d`. No parent worker, existing preview, or other container was stopped. The dynamic test servers and browsers close at test completion. No live qualification process remains.

## Limits

This prerequisite does not qualify combined #256/#257 task flows, linked IFC Plan cuts, Section, linked Walk collision support, connected-provider behavior, human review, release, or deployment. It does not test camera behavior during a pending native proposal comparison. The converter explicitly reports unapplied georeferencing, unmapped properties and relationships, and source objects without representation. Those diagnostics remain visible and are not acceptance of survey coordinates or IFC round-trip fidelity.

The narrow screenshot shows clipped header and rail labels in this baseline even though horizontal overflow is absent. Overall narrow-screen review remains with the combined UI qualification. The Windows PDF utility path and Unix socket limitations are outside this prerequisite. No final #258 pull request is opened, and no issue or pull request is closed or marked ready.

## Linux browser regression

The independent Linux prerequisite starts from combined source `a008d802`, including live #256 integration and the latest #253 ordering fix. `scripts/qualify-linux-browser.ps1` creates a fresh archive of an exact local commit. The image installs development dependencies, Linux Chromium, and browser dependencies from public packages. A Dockerfile-specific ignore file includes the tracked tests while preserving the original repository `.dockerignore` inside the image. The runtime has no external network, credentials, production data, or Git metadata. It uses only loopback test servers and disposable fixture workers.

Run the unchanged complete floor-plan browser test, including phone PDF conversion with `/usr/bin/prlimit` and Poppler, and every request-draft test, including Unix sockets. Also run Canvas Studio, chat, shell, live Plan, task-controller, markup, navigation, native Plan, task graphics, design-system, and package-build tests. Keep each suite's screenshots, traces, TAP output, and source hash separate. Record actual image and source identities and all counts. This remains preparation for the final #257 integration qualification.

### Replay the supported Linux suites

Use PowerShell 7 and Docker Linux containers. The default base is the existing local image `bim-forge-spatial-local:domain-35f867e`. The runner resolves and records its image ID, then gives that immutable image a uniquely owned local build tag. Dependency installation occurs only during the image build. The final test container runs with network `none` and verifies that only loopback exists.

```powershell
./scripts/qualify-linux-browser.ps1 -SourceRef 5d20e8187f6158f1a310ffe6537a97dc42f8b84f
```

After #257 integrates, replace `-SourceRef` with the final combined commit. `-Tests` accepts an explicit array of complete `demo/*.test.ts` files. The default list contains the 14 files below. Empty lists, missing files, nonzero exits, missing test counts, failures, cancellations, skips, and todo cases fail qualification. The runner performs strict validation before the tests.

The test image contains the exact Git archive plus the generated QA runner and source receipt. It contains no Git metadata and mounts no host dependencies, account state, or user models. The read-only test root has only the owned artifact directory mounted at `/artifacts` and `/qualification/artifacts`. The second mount supports an unchanged Plan test's fixed output path. Limits remain 2 CPUs, 4 GiB memory with equal memory-swap, 512 processes, 512 MiB shared memory, and a 1 GiB temporary filesystem. The container uses user `65032:33`, init, dropped capabilities, and no new privileges. The runner inspects the actual configuration before execution.

### Retain the navigation assertions

The first complete run on `a008d802` passed 58 of 60 tests, with no skips. One failure was the Plan test's fixed output path under the read-only source root. Mounting only the owned artifact output resolves that setup error.

The other failure occurred after headless-shell pointer lock was granted. Event diagnostics showed trusted positive and negative pointer-warp pairs reaching the focused locked canvas. Their net movement was zero, so the existing final-orientation assertion correctly failed. The runtime was not edited. A separate full-Chromium probe confirmed a nonzero final camera turn with the same mouse moves.

Full Chromium also exposed that a fixed 160 ms key interval could end before a rendered frame in this constrained environment. Commit `5d20e8187f6158f1a310ffe6537a97dc42f8b84f` updates only the browser test to accept the repository's existing `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` convention and wait two animation frames before key release. Every assertion and threshold remains unchanged. The complete navigation test passed after that correction. The Linux runner selects `/opt/qualification-browsers/chromium-1248/chrome-linux64/chrome` for this suite and records the exact path and test hash.

Temporary diagnostic runs, including the failed full-browser timing and virtual-display probes, remain under `C:/Users/Frederik Tegnander/AppData/Local/Temp/bim-forge-linux-browser-258-nav-*`. The first raw full-run failure remains under `bim-forge-linux-browser-258-run2`. These diagnostics are not counted as passing qualification. The failed initial build under `run1` used a raw local image ID in `FROM`; the runner now uses the verified image's unique local tag.

### Final pinned run

Final source is `5d20e8187f6158f1a310ffe6537a97dc42f8b84f`, tree `de32cceb03433694282a5a86158a0aa71a050bdc`. Its archive SHA-256 is `e06589dc6da24908d8b5ee769985662b69701f108145a047c726e162f59fb37b`. The original `.dockerignore` SHA-256 remains `791f4ca5e59055f35cf9e0386700cc0fffa51b2642183b98f8173b4078804808` and is checked inside the image. The unchanged preview-build tests inspect the original production Dockerfile and ignore file.

All 60 tests pass, with zero failures, cancellations, skips, or todo cases. Strict validation passes with 379 TypeScript sources. The run uses Linux Node `v24.22.1`, Chromium `156.0.8078.4`, `prlimit` from util-linux `2.38.1`, and Poppler `22.12.0`.

| Complete suite | Passed |
| --- | ---: |
| `floor-plan-guide-browser.test.ts` | 1 |
| `request-draft.test.ts` | 8 |
| `canvas-studio-browser.test.ts` | 3 |
| `request-chat.test.ts` | 7 |
| `workspace-shell.test.ts` | 8 |
| `spatial-plan-integration-browser.test.ts` | 1 |
| `spatial-tasks-browser.test.ts` | 1 |
| `spatial-tasks.test.ts` | 22 |
| `spatial-markup-browser.test.ts` | 1 |
| `view-navigation-browser.test.ts` | 1 |
| `model-plan-browser.test.ts` | 1 |
| `spatial-task-layer-browser.test.ts` | 1 |
| `design-system-browser.test.ts` | 3 |
| `preview-build.test.ts` | 2 |

The unchanged floor-plan journey covers PNG preparation, source-bound confirmation, unsent reload, explicit acceptance, the As-is baseline, an alternative-only partition delta, SQLite restart, phone PDF confirmation, and readiness revocation after PDF removal. All eight request-draft cases pass, including the actual Unix-socket HTTP feed's read-only, same-origin, uncached, and completion assertions. The PNG and PDF source-preparation budgets remain unchanged. The final and initial receipts confirm byte-identical hashes for both complete test files.

The [Linux receipt](spatial-linked-qualification-258/linux-summary.json) records the exact test hashes, commands, counts, browser choice, image ID, actual container settings, and hashes of retained artifacts. [The output summary](spatial-linked-qualification-258/qualification.txt) includes every suite result. The [phone PDF capture](spatial-linked-qualification-258/linux-phone-pdf-confirmed.png) shows confirmed source context. All recorded artifact hashes were checked after test execution.

Raw artifacts remain under `C:/Users/Frederik Tegnander/AppData/Local/Temp/bim-forge-linux-browser-258-run3/artifacts`. They include three complete browser traces, per-suite TAP logs, Plan and Inside screenshots, markup captures, source measurement evidence, and the disposable floor fixture's actual accepted project and model delta. Repository construction-model delta is zero. The disposable fixture changes only through the test's explicit acceptance steps.

Final image `bim-forge-linux-browser:258-9e8c8f360a254f37bcd85f8680c5b1aa` resolves to `sha256:26925635b4f709e08e1432361a65b77d00c6e9edf5ff3c05d2f56a85e69d01f7`. Final container `03f2e41e47650a41b01e7183d201dc1e582d36e1945fce8c82f841d2fd30b3fc` exits with code 0. All seven owned Linux test and diagnostic containers are stopped. Their short IDs are `03f2e41e4765`, `8877ae61dbb1`, `feba9ff02ecf`, `930138c7bf6e`, `989d8b3f774c`, `98d32b7fb4e4`, and `b2097fbb0f07`. Images and temporary directories remain for inspection. No parent container or existing preview was stopped.

The parent explicitly approved 13 combined qualification paths for this coherent prerequisite, including the navigation test adjustment and retained evidence. No policy file, validator, or runtime application module changes.

This Linux run excludes the separate real-IFC converter prerequisite above and `geometry-workflow-browser.test.ts`, which requires its dedicated geometry/provider qualification environment. It does not claim the final #257 task graphics integration, connected-provider accuracy, human approval, release, or deployment. The phone capture still shows cramped navigation labels in this baseline; passing the PDF and overflow assertions is not overall mobile UX approval.
