# Docker preview runtime

This deployment keeps the existing TLS proxy and static release mechanism. Nginx remains network-isolated and talks to the Node runtime through `/run/bim-preview/api.sock`. Only the Node container has outbound network access. ChatGPT credentials live in `/srv/bim-preview/state`, outside the image and static release.

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

Verify `/api/health` through HTTPS. The public session reports `disconnected`, `pending`, `failed`, or `connected`; it never returns OAuth tokens.

## Pair a ChatGPT plan

In the app, choose **Connect ChatGPT → Continue with ChatGPT**. Open the OpenAI link or scan the QR, enter the short code, and complete consent. The app updates automatically. No commands are needed on the browser device.

The container runs the pinned Codex app-server and owns token persistence and refresh.

The same persistent directory is mounted at `/var/lib/bim-forge/codex`; existing Codex credentials remain reusable. Prior SIWC `connection.json` files are left intact but are not used by this runtime. Do not mount another app's credentials or copy tokens into the browser. Keep this prototype restricted to trusted users; it has one shared server account. Commercial/hosted service distribution needs the approved Sign in with ChatGPT integration.

## Roll back

Set `BIM_FORGE_IMAGE` in `/opt/bim-preview/.env` to the previous reviewed image and run `docker compose up --detach --wait`. Restore the previous `compose.yaml` and `nginx.conf` together if their interface changed. The persistent credential directory is not part of an image rollback; do not delete it. Use **Disconnect ChatGPT** to clear this installation's Codex login; manage account access in ChatGPT separately.
