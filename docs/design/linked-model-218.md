# Bounded read-only IFC runtime (#218)

Related: [#218](https://github.com/Frederik91/bim-forge/issues/218), [spike #202](ifc-link-202.md), parent #197. Base is merged main `882a50b7599ff926fb0648c2e070c51a2cffccfd`. The ownership/API seam was [published before coding](https://github.com/Frederik91/bim-forge/issues/218#issuecomment-6461110961).

## Ownership and acceptance plan

| Files | Responsibility | Acceptance evidence |
| --- | --- | --- |
| `src/linked-model.ts` | Typed source/occurrence references, bounded artifact boundary, read-only request context | Identity, topology, transforms, counts and source envelopes checked independently of client manifests |
| `demo/linked-model-store.ts`, `linked-model-routes.ts` | Private immutable original, durable job receipts, cancellation/restart fencing, project-scoped serving | Actual converter; corruption/cross-project refusal; source retained after failure/restart |
| `demo/linked-model-client.ts`, `linked-model-ui.ts` | File upload, asynchronous status/cancel, hierarchy, raw original properties/losses, visibility and context-only reference | Chromium upload, inspector, reference, hide/show |
| `demo/linked-model-render.ts` | Disposable meshes owned by source refs in the existing Babylon scene | Actual canvas hit; full source/occurrence identity; native baseline bytes unchanged |
| `experiments/ifc-link/runtime_worker.py`, `test_runtime_worker.py` | Hard native-process supervision inside the isolated sidecar | Process-group deadline/cancel, descendant termination and interrupted worker receipt |
| `deploy/ifc-link/*` | Optional sidecar packaging seam | Network disabled; no socket, credentials, native model or app-state mounts |
| `demo/linked-model-{runtime,sidecar}.test.ts`, `linked-model-browser-fixture.ts` | Disposable server-container qualification | Real kernel/Chromium and separate app/converter containers |

No native entities, schemas, review decisions or baseline/Main pointers change. The single production viewer, `#request-chat-mount`, shared server and room-app wiring remain parent-owned. This branch supplies working runtime modules and a disposable browser mount; it does not publish or enable a production UI independently.

## Runtime and authority

```text
original IFC upload (no URL fetching)
  -> private content-addressed original + durable job receipt
  -> private job spool
  -> isolated converter sidecar -> hard-limited child -> existing link.py
  -> terminal receipt after child exit
  -> source/hash/size/topology/envelope checks -> private derived artifacts
  -> existing scene + hierarchy/inspector
  -> read-only source reference in an unsent request
```

Original bytes are authoritative and separately retained even if conversion fails. Every link has a server-generated UUID namespace/occurrence and a revision equal to its original SHA-256. STEP numbers stay diagnostic pointers. GlobalId plus namespace/revision/hash identifies an original object; occurrence adds its rigid source-to-project matrix. This version admits identity occurrence transforms only; it preserves product-to-source placements and unapplied georeferencing. The lower-level render helper supports validated rigid occurrence transforms for a future reviewed caller. There is no survey certification or cross-export reconciliation.

The native portable-document limits stay unchanged. No source object is inserted into a native snapshot, selected native scope, accepted target or baseline. The request helper emits explicit read-only context text and never submits or approves anything. Properties remain attached to their original object/type; relationships, units, diagnostics and unsupported semantics remain visible inventories. Tessellation is derived and cannot replace the original source.

`parseLinkedPrepared` validates the application boundary. `verify_link` is not called as a security validator for client manifests. The application accepts no uploaded manifest, index, render artifact, transform, path, executable or external URL. Publication checks the source tuple, occurrence, fixed filenames, byte counts, SHA-256, unique object/mesh identities, indexed references, triangle ranges, total counts and finite source/project envelopes. Private reads refuse symlinks. Completed derived artifacts are copied out of the shared spool to immutable application-private files before marking the job ready.

Source admission remains 2 MiB, 2,000 IFC entities, 64 products, 50,000 vertices, 100,000 triangles, 8 MiB complete artifacts, IFC4 metre/mm and the existing placement bounds. Two uploads and two pending conversions are admitted; retention stops at eight links per project and 32 per installation. The spool contains bounded per-job originals, outputs and capped logs. No automatic deletion of history is introduced. Operators must use a dedicated SSD directory with an appropriate filesystem quota for a larger deployment; increasing retention limits requires review.

The converter child has a 35-second hard wall deadline, 30-second CPU limit, 2 GiB address-space limit, 8 MiB per-file limit, 64 descriptors and no core dumps. The existing cooperative conversion budget is still 30 seconds. Cancellation kills the whole process group immediately on the next supervisor check (50 ms polling); the application fences publication as soon as cancellation is persisted. The supervisor publishes a terminal receipt only after child exit. Container CPU/memory/PID limits remain an outer boundary. An application restart marks pending jobs failed and writes cancellation; a converter restart fails already-started jobs instead of resuming partial output. A late terminal/manifest cannot move a cancelled or interrupted application job to ready. A 90-second application deadline also fails queued work if the sidecar is unavailable. Retrying means attaching a fresh occurrence; failed originals and receipts remain inspectable.

## Parent integration seam

Exact exports:

```ts
const links = LinkedModelStore.open({ root: privateLinkRoot, spool: privateSpool });
// After existing host checks/security headers, before generic project/static routing:
if (await handleLinkedModelRoute({ request, response, store: links,
  hasProject: id => backlog.hasProject(id),
  authorize: request => sameOriginRequest(request, publicOrigin),
})) return;
// Shutdown calls links.close() as well as the existing model-worker close path.
```

`GET/POST /api/projects/:project/ifc-links` lists/attaches. A POST carries raw `application/x-step` bytes and a percent-encoded `X-Source-Name`. `GET /:id`, `GET /:id/prepared`, `GET /:id/original`, and `POST /:id/cancel` complete the route surface. Every method uses the parent's same-origin rule and authoritative project-existence predicate. No static source path is exposed.

```ts
const layer = new LinkedModelLayer(existingModelScene.scene);
const panel = new LinkedModelPanel({
  host, client: new LinkedModelClient(),
  changed: links => viewer.setLinkedModels(links),
  selected: selection => viewer.selectLinkedReference(selection),
  reference: selection => appendUnsentContext(linkedReferenceText(selection)),
});
panel.setProject(projectId); // null clears references during project transitions
```

`setLinkedModels` and `selectLinkedReference` above are the minimal parent-owned forwarding methods: call `layer.setLinks(links)` / `layer.select(selection)` and request viewer frames. On a canvas click use `layer.objectAt(x,y)` before the native `objectAt`; a hit invokes a source-selection callback to `panel.select(selection)` and returns before native selection. The helper uses the nearest scene hit, so native geometry can occlude a linked mesh. Hover/reference-drag/native scope remain native-owned. Call `layer.dispose()` before disposing the existing scene. Do not recreate the layer on polling, target, baseline, mode or chat changes. Linked geometry has an independent visibility toggle rather than inheriting native level or roof membership. Baseline controls must retain their current write restrictions.

The current display contract requires `LinkedDisplay.id` and job ID to equal `prepared.manifest.occurrence.id`. A prepared artifact can itself describe another valid occurrence, so this is explicitly checked at both actual display boundaries: the layer rejects the complete input before mutating meshes, and the panel marks a mismatched artifact unavailable without rendering it. The store already enforces this invariant. Supporting independent display/occurrence identities would require an intentional ownership-key change, rather than passing differing IDs to these helpers.

Panel polling commits the job list/statuses before fetching artifacts. Each ready artifact is fetched and admitted independently; one failed or mismatched artifact produces a per-link error without discarding a healthy ready link or another job's running/cancel status. Subsequent polls can advance healthy jobs and retry only unavailable artifacts. Cached display data is removed if its job is no longer ready. Project-switch/abort fences still apply to every individual fetch result.

Use one `LinkedModelStore` instance per application data root. It owns a new `links.sqlite`, private `sources/` and `prepared/`; it does not use the model database. A restart can resume reading ready originals/artifacts, but cannot resume pending authority. The store deliberately has no model-repository handle.

The current preview image explicitly copies server modules and lacks Python/IfcOpenShell. Parent packaging must copy the new store/routes and mount a dedicated spool into the app; the sidecar's only writable persistent mount is that spool. `deploy/ifc-link/compose.yaml` is an optional fragment with `network_mode: none`, a read-only root, dropped capabilities, no-new-privileges, 0.5 CPU / 2304 MiB / 64 PIDs and UID 65032:33. Prepare the private spool with matching ownership/mode 0700. The converter image definition installs the existing exact dependency pins from `experiments/ifc/requirements.txt`; a reviewed immutable image tag/digest is required by the compose fragment. The new image was not built or deployed during this work; correctness qualification reuses the retained pinned dependencies/image. Do not mount a Docker socket or add converter permissions to the model/agent API.

## Qualification and attempt ledger

All builds/tests run in isolated server containers at `frederik@192.168.1.17`; all snapshots, dependencies and evidence are on `/ssd1`. The owner-authorized ten-attempt allowance applies; no validators or global factory limits changed.

| Attempt | Source | Result / inspected cause |
| --- | --- | --- |
| a01 | `18eb723` | Docker could not create nested mount points in a read-only source snapshot; no code executed. Create snapshot mount directories before mounting. |
| a02 | `18eb723` | Strict lint passed; TypeScript rejected mapping a Babylon typed-array union into vectors in the browser fixture. Normalize with `Array.from`; fixed at `9771f97`. |
| a03 | `9771f97` | Root validation, scoped policy, build, 26 Python tests and three actual runtime tests passed. Chromium launch lacked desktop libraries. |
| a04 | `886e940` | Same checks passed; Chromium first page crashed at the 128-PID / 1-CPU envelope. Inspect and rerun with browser diagnostics and bounded 256 PIDs / 2 CPUs. No code workaround. |
| a05 | `27a657b` | Root validation, 12-path policy, build, 26 Python tests and all four runtime/browser tests passed; exit 0, no OOM. |
| a06 | `53244d6` | Root validation, 14-path policy, build, 27 Python tests and 47 focused/native/runtime/browser tests passed. Separate app/converter containers also passed the spool-only workflow and ready-state restart recovery. Screenshot inspection prompted a UI readability correction and better fixture framing. |
| a07 | `963d995` | Final code: root validation (279 strict TypeScript sources), 14-path policy, build, 27 Python tests and 47 focused/native/runtime/browser tests passed; exit 0, no OOM. Original properties are visible first; diagnostics are expandable. |

The reusable browser bundle is `/ssd1/bim-forge-qualification/issue218/browser-deps/extracted`, downloaded/extracted using the exact Debian12 tools base with apt lists/cache/packages on SSD. No system install or Docker layer was created. Mount it read-only at `/browser-libs` and set `LD_LIBRARY_PATH=/browser-libs/usr/lib/x86_64-linux-gnu:/browser-libs/lib/x86_64-linux-gnu`. Mount retained `compact213/browsers` read-only at `/browsers`; executable `/browsers/chromium-1248/chrome-linux64/chrome`. `ldd.log` has no missing libraries; Chrome reports 156.0.8078.4. The package hash-manifest hash is `b2f87a5c38a895e7d5137b2412ae23165619afa4a60983ecb511e8c04f22ccc3`. Only dependency download used network; all qualification runs use `network:none`.

Reproduction commands inside the retained tools container, read-only source/deps, writable SSD evidence/dist/tmp:

```sh
export PYTHONPATH=/python-deps PYTHONDONTWRITEBYTECODE=1
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
export IFC_PYTHON=/qualification/python/bin/python
export IFC_FIXTURE=/evidence/fixture/synthetic.ifc IFC_EVIDENCE=/evidence
npm run validate
node scripts/validate-policy.ts --changed-files <the exact PR paths>
npm run build:demo
"$IFC_PYTHON" -m unittest discover -s experiments/ifc-link -p 'test_*.py' -v
"$IFC_PYTHON" experiments/ifc-link/fixture.py /evidence/fixture
node --test --test-concurrency=1 demo/linked-model-runtime.test.ts
```

Retained a05 logs: `/ssd1/bim-forge-qualification/issue218/a05/evidence/`. Validator hash `88e8cd20531b8823d1c48c3b8105b5404ba43f7d38b4f6163180db78d31aec15`, runtime/browser log hash `6afe381540492141adf6cd57283fdecfbe5d6f586e08dfd7d65203f7a621ddf0`. The source-bound synthetic original is 7,593 bytes, hash `a52ff45c732be3870dbcc368e7212d9736c6a6a536ba72901dccf05e083adfc5`. It yields nine indexed objects and four meshes; no capacity or arbitrary-vendor claim follows. Existing Python cases cover missing/duplicate GlobalIds, unsupported units/contexts/placements, source/geometry/artifact/time limits and source preservation.

The browser mount is deliberately disposable and uses the existing `ModelScene` class with one canvas. Parent integration and paired static/runtime preview publication require their own combined checks. Human review is required before merging this coordination/storage/runtime-security change. No live data, deployment, automation, model acceptance or merge was performed.

### Final retained evidence

Final code is `963d995`; later receipt-only documentation commits do not change executable code. The a07 source tar SHA-256 is `cd1ed5693c3e544015b02d26b1925ad60ec55acbc9f2915a3f1ca80b71c282b8`. Run root: `/ssd1/bim-forge-qualification/issue218/a07/`; `run.sh` retains every Docker mount/limit/environment/command and `evidence/container-inspect.json` records network/resource/exit state. Source and dependencies were read-only; evidence, home, temporary files and dist outputs were SSD-backed. Final envelope: network none, UID/GID 1000, dropped capabilities, no-new-privileges, 2 CPUs, 3 GiB memory with no extra swap, 256 PIDs and an outer 240-second timeout/5-second kill grace. The earlier 128-PID browser crash is retained as a04 evidence; increasing a qualification container's bounded process budget did not alter runtime converter limits or validators.

```text
Strict TypeScript valid. 279 source file(s) checked.
tsc --noEmit: exit 0
Policy valid. 14 changed file(s) checked.
Python: Ran 27 tests ... OK
Node focused/native/runtime/browser: tests 47, pass 47, fail 0, skipped 0
Separate app/converter containers: tests 1, pass 1, fail 0, skipped 0
```

The 47 Node tests include the four new runtime/browser checks plus existing `demo/model-scene.test.ts`, `src/design-targets.test.ts` and `demo/request-context.test.ts`. Python adds hard termination of a child and its descendant, cancellation and an actual worker restart to the existing 24 importer cases. The source/model delta is inspectable in the browser: the blue derived IFC and native room share one scene; the native portable document including As-is baseline is byte-identical after linking/inspection/reference. No linked entity appears in a native snapshot or accepted head. The original hash remains separate from the derived geometry/index hashes, which are rechecked on private reads.

The separate-container check is retained in a06 `sidecar.sh`, `evidence/sidecar-test.log`, and the app/converter inspect JSON. The app container has no Python worker/dependency mounts and uses only the store API. The converter has read-only worker/Python dependencies, a temporary filesystem and the dedicated spool; it has no application-private state, fixture mount, network, credential or Docker socket access. Its own envelope is 0.5 CPU / 2304 MiB / 64 PIDs. The app test queues a new source, waits for actual conversion, reads four meshes, closes/reopens the private store, and confirms ready status, unchanged original and read-only manifest. Store, worker and sidecar test bytes are unchanged between a06 and final a07. These are correctness/isolation checks; the optional new converter Dockerfile/compose fragment was not built or deployed.

| Retained artifact | SHA-256 |
| --- | --- |
| a07 `evidence/validate.log` | `043e839af97db1038b1bf9918058b9912ee6480f8c93be7f43085b0a75878dec` |
| a07 `evidence/runtime-tests.log` | `ac384cc540186f388c8f0db5f06f396ba60465a4c5fb2aea64c79823a7ac963c` |
| a07 `evidence/ifc218-inspection.png` | `8831eeb167debced9146f33329e42bf5306ef872663a8d9abd09bc2823d43d86` |
| a06 `evidence/sidecar-test.log` | `d2bfe1bef2c86f3c114dfc62d9d7b115e68c1db248c6dcaf2bb89e6b236e8de9` |

All seven attempts are retained under `/ssd1/bim-forge-qualification/issue218/`; three of the ten authorized attempts remain. No full `npm test` suite was claimed: the root validators, browser build, meaningful native-focused cases, real importer/runtime/browser checks and isolated-sidecar recovery check above were executed.

### Parent review corrections and final requalification

This receipt supersedes the earlier final-code and remaining-attempt statements. Parent review found that cleanup skipped a live descendant group after its leader exited. The focused regression at `bfa14ec` starts a real descendant, waits for its readiness, then exits the leader with status 0 or 7. Against the original supervisor both subcases failed: the descendant wrote `late` after `supervise` returned. `supervisor-cleanup/red/evidence/regression.log` retains both failures; no validator was changed.

The fix at `3815df4` always sends SIGKILL to the owned process group, including after leader exit, tolerates only `ProcessLookupError` when the group has already disappeared, and waits for the leader. Existing hard wall/CPU/memory/file limits remain unchanged. The same regression passes after the fix and also checks that the descendant is dead (or a terminated zombie pending reaping), not merely that no marker appeared. Existing cancellation/deadline and actual converter runs exercise already-gone-group races without raising an error.

Parent also identified a public display-ID mismatch and collection-wide artifact-fetch failure. Final executable source `fb1f006` enforces the documented display/occurrence equality before changing any layer meshes and before panel admission. A valid actual prepared artifact under a different display ID is rejected while the previously displayed meshes stay intact. Repeated valid `setLinks`/hide/show retains the same four meshes. Polling commits statuses first, isolates each artifact fetch failure and exposes the affected link's error. A Chromium fixture uses the real prepared A artifact, a deliberately failing B client response, a running C progressing from index to geometry, and a valid artifact under mismatched D. A's hierarchy/selection/reference remains usable, B/D show their individual errors, and C's progress/cancel action continues updating on later polls.

| Additional attempt | Source | Result |
| --- | --- | --- |
| supervisor-cleanup/red | `bfa14ec` | Expected failure: normal and failed leader exits both permit descendant late publication. |
| supervisor-cleanup/green | `3815df4` | Root validation/build/policy, 28 Python tests and 47 focused/native/runtime/browser tests passed before the two further review findings arrived. |
| review-final | `fb1f006` | Combined final code passed root validation (279 strict TS sources), explicit 14-path policy, browser build, 28 Python tests, 47 Node tests and the paired-container sidecar/recovery test; zero failures/skips, container exit 0, no OOM. |

These three additional runs consume the original remaining allowance: **ten of ten total qualification attempts are now used**, counting the intentional failing-before proof. No count was reset. No executable changes follow `fb1f006`; later receipt/PR updates are documentation only. Further qualification retries require renewed owner authorization.

The exact source snapshot, commands and bounded-container metadata are retained at `/ssd1/bim-forge-qualification/issue218/review-final/`: `source.tar`, `run.sh`, `sidecar.sh`, and `evidence/*inspect.json`. The same source was used for both the main qualification and isolated paired-container check. Native model delta remains zero; shared server/room-app/viewer/package mounts and preview publication remain parent-owned under #223.

| Retained artifact | SHA-256 |
| --- | --- |
| review-final `source.tar` | `ff58ecbc5a3f9adbd5fdc55dc6958a1520a48e62bd0a95dac7f7c2cf6ab95a1c` |
| review-final `evidence/validate.log` | `043e839af97db1038b1bf9918058b9912ee6480f8c93be7f43085b0a75878dec` |
| review-final `evidence/python-tests.log` | `634858dbd0e4a2b8e6eae03fcd766e1e0d095f1cb563bc9a1d9606711cece235` |
| review-final `evidence/runtime-tests.log` | `e8d570b71b9aca40596868e21c34b2f6ba8a2d57171e7022dbe7d29c2021059e` |
| review-final `evidence/sidecar-test.log` | `ddef8e316a883a23e7eb4ddea6d8d74533b63f00c2b24adbd85f7a9b10d45fbb` |
| supervisor-cleanup/red `evidence/regression.log` | `bb8c48d425acb631066ae2ec2c41d80fbf29d6dcbac4358c1b19a45d10d1fbe0` |
