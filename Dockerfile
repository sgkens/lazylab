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
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    LAZYLAB_DATA_DIR=/data

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY server.ts ./
COPY server ./server
COPY --from=build /app/dist ./dist

RUN mkdir -p /data && chown -R bun:bun /data
USER bun
VOLUME ["/data"]
EXPOSE 3000

CMD ["bun", "server.ts"]
