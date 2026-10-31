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
