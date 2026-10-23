# Docker preview runtime

This deployment keeps the existing TLS proxy and static release mechanism. Nginx remains network-isolated and talks to the Node runtime through `/run/bim-preview/api.sock`. Only the Node container has outbound network access. Codex owns ChatGPT credentials below `/srv/bim-preview/state`, outside the image and static release.

## Build and install a reviewed revision

Build an immutable image tag from the exact reviewed commit:

```sh
docker build --file deploy/preview/Dockerfile --tag bim-forge-preview-app:<commit> .
```

The host needs these paths before Compose starts:

```sh
install -d -m 0770 -o 65032 -g 33 /run/bim-preview
install -d -m 0700 -o 65032 -g 33 /srv/bim-preview/state
install -d -m 0755 -o root -g root /opt/bim-preview
```

Copy `compose.yaml` and `nginx.conf` to `/opt/bim-preview`, then create `/opt/bim-preview/.env`:

```dotenv
BIM_FORGE_IMAGE=bim-forge-preview-app:<commit>
BIM_FORGE_PUBLIC_ORIGIN=https://192.168.1.17:9443
```

Validate and start the stack:

```sh
docker compose --project-directory /opt/bim-preview --file /opt/bim-preview/compose.yaml config --quiet
docker compose --project-directory /opt/bim-preview --file /opt/bim-preview/compose.yaml up --detach --wait
```

Verify `/api/health` through HTTPS and confirm that `/api/auth/session` reports `disconnected` before sign-in.

## Connect a ChatGPT plan

Open the preview, choose **Connect ChatGPT**, and request a one-time code. Open the displayed OpenAI URL on any phone or computer, sign in, and enter the code. The dialog checks the server automatically and changes to the connected account when authorization completes.

Device-code authorization must be enabled in the account's ChatGPT security settings or by the workspace administrator. The preview never returns tokens to the browser and does not expose the Codex app-server transport over the network.

This is a private, self-hosted preview integration. Reassess the production sign-in design against the current Sign in with ChatGPT requirements before any public or commercial launch.

## Roll back

Set `BIM_FORGE_IMAGE` in `/opt/bim-preview/.env` to the previous reviewed image and run `docker compose up --detach --wait`. Restore the previous `compose.yaml` and `nginx.conf` together if their interface changed. The persistent Codex directory is not part of an image rollback; do not delete it. Use the preview's **Disconnect ChatGPT** action to clear the installation's Codex session.
