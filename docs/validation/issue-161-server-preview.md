# Versioned house server-preview deployment

The maintainer authorized deployment for testing on 26 October 2026, after the original draft-only handback. PR #170 remains a draft; deployment does not merge it into main.

- URL: `https://192.168.1.17:9443/`.
- Deployed source: `6a0272239e8251cfa658c1190f0e727bb653c2dc`.
- Runtime image: `bim-forge-preview-app:6a0272239e8251cfa658c1190f0e727bb653c2dc`, ID `sha256:ad0fc684258957715524d5cc7352a53127aafaa4288e9a7adcf9cb88db011263`.
- Previous runtime/static source: `8a1f3a955ecea90bceef574ff8b9eab4249669ce`.
- Static release switched at `2026-10-26T11:41:12.826Z`; the previous release is retained.

Packaging adds the versioned project store and contract to the Dockerfile and explicit build-context allowlist. Root validation, changed-path validation, frontend build and actual runtime image build passed in server containers. A canary used the real runtime image with a read-only root, no network and a separate consistent copy of the preview database. Startup and migration verification passed before cutover.

Ingress and the old app were stopped for a complete private state backup, including credentials and database/WAL files. The immutable new image passed its health check, then the matching static release was published and ingress resumed. Existing security settings and public origin were retained. Backup permissions remain private; no credentials were included in public assets or repository evidence.

After cutover, verification against the actual stopped-state backup confirmed all six project serializations were unchanged and all 17 requests remained. Foreign keys were valid and the obsolete project body column was gone. HTTP checks through the deployed Nginx socket verified the revision manifest and all three frontend asset hashes, health, six saved projects and public auth status `connected`.

The browser opened the real HTTPS preview, selected the existing home-office project, and retained accepted revision `7b268b9079`, four requests and four accepted ancestry entries. Saved projects, browser recovery, retained history and the 3D model rendered. No requests were submitted and no proposals were accepted for deployment verification. The model delta is zero authored entity/relationship changes; accepted project heads are preserved.

Raw logs, manifest, migration checks, image identity and cutover receipts are under `/ssd1/bim-forge-qualification/house-161/deploy-170-6a02722`. Its `private/` directory retains the pre-migration state archive and isolated database copies; do not publish it. The canary is stopped. The normal preview containers remain running.

Rollback across this storage migration requires a matching database snapshot as well as image/frontend restoration; see [the deployment instructions](../../deploy/preview/README.md#roll-back). Preserve any state created after cutover before considering restoration.
