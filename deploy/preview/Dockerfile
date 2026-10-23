FROM node@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=65032:33 package.json ./package.json
COPY --chown=65032:33 demo/server.ts ./demo/server.ts
COPY --chown=65032:33 src ./src
COPY --chown=65032:33 scripts/chatgpt-transfer.ts scripts/container-healthcheck.ts ./scripts/

USER 65032:33
CMD ["node", "demo/server.ts"]
