# IFC server packaging for integration #223

Server owns one `LinkedModelStore` under `<backlog directory>/ifc-links`, with no native repository handle. Tests can specify `createDemoServer({ backlogFile, linkedModelRoot, linkedModelSpool })`; production uses the default root and reads `BIM_FORGE_IFC_SPOOL`. Routes reuse Host checks, security headers, authoritative `backlog.hasProject` and the existing same-origin rule for every method. Closing the HTTP server or model workers closes the store and cancels pending jobs. Without a spool, routes return 503 and health reports `ifcLinks: unavailable`. `configured` means configuration, not worker health; an absent converter still hits the bounded job deadline.

`BIM_FORGE_IFC_SPOOL` is an absolute path inside the app container (`/spool`). It must already exist, resolve outside the private state tree, and cannot contain that tree. Requests cannot supply paths. Compose binds an operator-prepared dedicated SSD directory, `BIM_FORGE_IFC_HOST_SPOOL` (default `/ssd1/bim-preview/ifc-spool`), to `/spool` in both containers. Prepare it with UID/GID 65032:33, mode 0700 and a filesystem quota. The mount exists even when conversion is disabled, so prepare it before using this compose definition; empty `BIM_FORGE_IFC_SPOOL` disables conversion.

The optional `ifc` compose profile uses the already-retained tools image ID `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff` (`bim-qvm-tools:20261025`, linux/amd64). It mounts only a read-only worker release, retained Python environment and retained pinned Python packages, plus the writable spool. Its network is disabled, root is read-only, capabilities are dropped and no-new-privileges is set; limits are 0.5 CPU, 2304 MiB without extra swap, 64 PIDs and 128 descriptors. It has no credentials, application state, native model, host ABI library mounts or Docker socket. The tools image is broader than a dedicated converter image and is a host-specific interim packaging path, not a portable distribution.

`BIM_FORGE_IFC_WORKER_RELEASE` must identify an immutable SSD directory containing the reviewed `link.py` and `runtime_worker.py`. Retained dependency locations are explicit in compose. The Python launcher resolves to the interpreter inside the exact image; no ambient host interpreter or shared-library directory is mounted. Dependency pins remain `experiments/ifc/requirements.txt`, including IfcOpenShell 0.9.0.post1, NumPy 2.2.6 and Shapely 2.1.1. Retain/check full file hash manifests before starting this profile; version pins alone do not pin the installed bytes. Changes to the runtime image, release or dependencies require requalification. The optional `deploy/ifc-link/Dockerfile` remains unbuilt and is not qualified here.

No pull, image build, dependency install, live configuration edit, deployment or cutover occurred. Worker218's final `ecd18db` is included in the base and was not rerun. Parent still owns combined shipped-UI/browser qualification. App packaging should use a source-only layer atop the exact approved existing preview image (observed `sha256:c3497c848dceca6fbf01c08f64649a444e69cfe65570ffca63b2f4b36508bcc3`), copying changed server modules and `src` without rerunning npm ci; root package and lockfile are unchanged. The normal Dockerfile explicitly copies both new server modules for future clean builds.

## Qualification ledger

Evidence root: `/ssd1/bim-forge-qualification/issue223-server-packaging/a01`. Independent item budget: seven of ten attempts used, including setup failures. Base: `98b229b67a4005b0fd8c1c5221f4318d302f5c28`.

| Attempt | Result and correction |
| --- | --- |
| a01 | Setup only: noninteractive sudo unavailable; disposable ownership helper needed DAC_OVERRIDE in addition to CHOWN/FOWNER. No tests ran. These capabilities are absent from app/converter. |
| a02 | Strict lint passed; typecheck found response narrowing and exact-optional-property errors. Corrected both. |
| a03 | Validation/policy passed; existing server tests needed writable `/tmp` and a built asset. Added SSD mounts and server-only demo build. |
| a04 | Existing 14 tests passed; new fixture incorrectly imported pre-existing baseline metadata, which the target CAS guard rejected. |
| a05 | Added explicit-root test seam and diagnostics; confirmed target CAS rejection. Fixture now captures baseline through its HTTP command. |
| a06 | Authorization assertion omitted the existing POST error wording. Included same-origin denial wording. |
| a07 | Validation, explicit five-path policy, demo build, 14 existing tests and all three new tests passed. |

`run-a07.sh` retains the exact container commands. App/converter run as 65032:33 with network none, read-only roots, bounded resources, dropped capabilities and no-new-privileges; the app has no Python mounts and the converter has no app-private mount. Both reported no OOM; app exit was 0, converter was deliberately stopped (143). Source/dependencies are read-only, and build outputs, state, temporary files and evidence are SSD-backed. Compose rendering passed; no compose stack was started. Root free space was 614 MiB after checks (619 MiB initially).

Commands inside the bounded validation/app containers:

```sh
npm run validate
node scripts/validate-policy.ts --changed-files demo/server.ts deploy/preview/Dockerfile deploy/preview/compose.yaml demo/linked-model-server.test.ts docs/design/linked-model-packaging-223.md
npm run build:demo
node --test demo/server.test.ts
# Separate app container, with IFC_PRIVATE_ROOT=/private, IFC_EXTERNAL_SPOOL=/spool,
# IFC_FIXTURE=/fixture/synthetic.ifc and a running spool-only converter:
node --test --test-concurrency=1 demo/linked-model-server.test.ts
```

The new tests prove actual routing/security headers, refusal across projects, real conversion to four meshes, original retrieval, ready-state recovery, pending-job cancellation, unconfigured local/test behavior and rejection of overlapping/symlink spool paths. Native portable bytes including the baseline remain identical. Shipped viewer interaction is deliberately left to the parent browser test.

`inventory.sh` verifies all 19 installed package versions against requirements. Python is 3.11.2, resolving to `/usr/bin/python3.11` inside the image. SHA-256 pins (full file manifests retained in `evidence/`):

| Artifact | SHA-256 |
| --- | --- |
| `link.py` | `7baae62915dfbfa1ddcaebfffcd4f54d4aeba8b0897f9c1210d4b3edf69d0989` |
| `runtime_worker.py` | `1e8a1980ae18a815deae51f01c26b59c1504b9f8af47e743761012fc3a7e826e` |
| requirements | `58a55333b75bf0f7fd46f9084fce3b4828cd7d2ca01bbedb62d8509869ff73c2` |
| `python-runtime.sha256` | `f5c594b02edb29e24596877596b77bd3be87a664a613ddc633a066cefc30ee7b` |
| `python-deps.sha256` | `3762c789b30e07f481fe2b781731c71c2934f8aa3bc2f2a34a95cba46143b846` |
| `python-symlinks.txt` | `1f63f3976a5ddf5a50007c3a52d5ddf51a974599c62fdb08b0e2e1f025dd450d` |

Check manifest hashes, then `sha256sum -c` against the same container mount paths before enabling the profile. Preserve these SSD directories as an immutable release; a missing/changed retained dependency is a packaging blocker. Reproduction needs fresh private state/spool and unique container names (or removal of this run's stopped containers), not production mounts. See `evidence/{validate,policy,build,server-tests,linked-server-tests}.log`, `*-inspect.json` and `compose-resolved.json` for the retained proof.
