# Published ScriptBox package and preview release

The maintainer approved PR 104 and requested deployment on 25 October 2026. The PR targets `product/issue-100-residential-floor`; merging it does not merge the other stacked PRs into `main`.

## Dependency change

- Pin `@frederik91/scriptbox` to npm version `0.1.1`; preserve registry URL and SHA-512 integrity in `package-lock.json`.
- Remove the tracked 0.1.0 tarball, its Docker COPY instruction and Docker-context exceptions. There is no fallback package or executor.
- Registry metadata identifies upstream commit `129f538fb28de883e7dfc1753f4c9524c8c37445`. Comparing it with the previously qualified `9a9b327` shows publication/version/documentation changes, not changes to runtime source or the guest artifact.

## Verification before merge

All builds and tests ran on `192.168.1.17`, using the pinned Node 24 image documented in the integration guide.

- `npm install --ignore-scripts --save-exact @frederik91/scriptbox@0.1.1`: installed successfully; audit reported no vulnerabilities.
- `npm run validate`: strict TypeScript, typecheck and policy validation passed.
- `npm test`: 330 tests, 328 passed, 2 existing skips, no failures.
- Preview Dockerfile: built directly from the registry dependency and lockfile.
- Production-style image: all 12 real-package integration tests passed with networking disabled, non-root user, read-only root, dropped capabilities, 1 GiB memory and a bounded temporary filesystem.

The previous [validation report](issue-103-scriptbox.md) and raw logs describe the original 0.1.0 qualification. They are retained as historical evidence rather than relabelled as 0.1.1 results.

## Deployment requirements

Publish the merged commit's browser bundle and runtime image together. Preserve the existing account directory and project database. Check for active request work before replacement, back up database files before the new execution-evidence table is opened, and retain the previous image/static-release pointers for recovery. A data rollback must account for newer script-review fields; it must not silently overwrite accepted user work.

Verify the live HTTPS health endpoint, installed package version, browser assets, existing account connection and a disposable AI proposal after deployment. Do not claim deployment from the image build alone.
