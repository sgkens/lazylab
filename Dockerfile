# lazylab container image: builds the SPA with Bun, then runs server.ts on Bun.
# Build:  docker build -t lazylab:local .
# Run:    docker compose up -d   (see compose.yaml)

ARG BUN_VERSION=1.3.11

# ---- build stage: full deps, produce dist/ ----
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# ---- runtime stage: production deps + server sources + dist ----
FROM oven/bun:${BUN_VERSION}-slim AS runtime
LABEL org.opencontainers.image.title="lazylab" \
      org.opencontainers.image.description="A self-hosted GitLab workspace for developers and their agents" \
      org.opencontainers.image.source="https://gitlab.com/sgkens/lazylab" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    LAZYLAB_DATA_DIR=/data

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY server.ts ./
COPY server ./server
COPY scripts/container-healthcheck.ts ./scripts/container-healthcheck.ts
COPY skills ./skills
COPY --from=build /app/dist ./dist

RUN mkdir -p /data && chown -R bun:bun /data
USER bun
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "scripts/container-healthcheck.ts"]

CMD ["bun", "server.ts"]
