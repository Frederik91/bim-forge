FROM node@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

WORKDIR /app
ENV NODE_ENV=production
ENV CODEX_CA_CERTIFICATE=/etc/ssl/certs/ca-certificates.crt

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=65032:33 demo/server.ts demo/change-requests.ts demo/request-source-store.ts demo/versioned-project-store.ts demo/versioned-project-contract.ts ./demo/
COPY --chown=65032:33 src ./src
COPY --chown=65032:33 scripts/container-healthcheck.ts ./scripts/

USER 65032:33
CMD ["node", "demo/server.ts"]
