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

Verify `/api/health` through HTTPS and confirm that `/api/auth/session` reports `remote-pairing` before pairing.

## Pair a ChatGPT plan

The required OAuth callback is local to the browser computer. From a trusted checkout on that computer, run:

```sh
npm run chatgpt:pair -- --remote <user>@<preview-host>
```

The SSH user must be able to run `docker exec` and `docker restart` for `bim-preview-app`. The helper fetches the server's stable host ID and saved registration hint, completes OAuth locally, transfers a strict credential document over SSH stdin, restarts only the app container, waits for its Unix-socket health check, verifies the host ID, and deletes its temporary local files. It never transfers or replaces the host ID. Do not copy a laptop `connection.json` over the server file.

## Roll back

Set `BIM_FORGE_IMAGE` in `/opt/bim-preview/.env` to the previous reviewed image and run `docker compose up --detach --wait`. Restore the previous `compose.yaml` and `nginx.conf` together if their interface changed. The persistent credential directory is not part of an image rollback; do not delete it. To disconnect safely, use the preview's **Disconnect ChatGPT** action so remote revocation is attempted before local credentials are cleared.
