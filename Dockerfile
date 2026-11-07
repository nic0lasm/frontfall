# syntax=docker/dockerfile:1

# The one place that names the Bun version and pins its image. The build stage copies the binary from it.
FROM oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS bun

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
WORKDIR /app
# Bun installs and runs the scripts and bundles the server; Node runs the build tools that need it.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/contracts/package.json packages/contracts/
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY tools/package.json tools/
COPY e2e/package.json e2e/
COPY bench/package.json bench/
RUN bun install --frozen-lockfile
COPY . .
# Both builds embed the simulation build (docs/protocol.md); FRONTFALL_VERSION, the commit, is for /healthz.
ARG FRONTFALL_VERSION=dev
RUN FRONTFALL_VERSION=$FRONTFALL_VERSION bun run --filter @frontfall/client --filter @frontfall/server build

# The server runs on Bun alone: one runtime, no package manager, no node_modules.
FROM bun AS run
# Commit the image was built from, reported by /healthz.
ARG FRONTFALL_VERSION=dev
WORKDIR /app
ENV NODE_ENV=production \
    FRONTFALL_VERSION=$FRONTFALL_VERSION \
    PORT=8080 \
    FRONTFALL_STATIC=/app/public
# Bun has no heap cap: the container's memory limit bounds the server (mem_limit in
# compose.yaml, sized from the load test in docs/capacity.md).
COPY --from=build --chown=bun:bun /app/apps/server/dist/server.mjs ./server.mjs
COPY --from=build --chown=bun:bun /app/apps/server/dist/frontfall-admin.mjs ./frontfall-admin.mjs
COPY --from=build --chown=bun:bun /app/apps/client/dist ./public
# The operator's command for data.db: `docker exec <container> frontfall-admin bans list`.
RUN printf '#!/bin/sh\nexec bun /app/frontfall-admin.mjs "$@"\n' > /usr/local/bin/frontfall-admin \
  && chmod 755 /usr/local/bin/frontfall-admin
# The only place the server may write besides /tmp, mounted as a volume in production; a new
# named volume takes this owner. The server also starts without it. The user bun is uid 1000,
# as the node user was, so a volume keeps its owner across the change.
RUN install -d -o bun -g bun /var/lib/frontfall
USER bun
EXPOSE 8080
# Checked every second while starting up (a Docker that knows --start-interval), so that
# `docker compose up --wait` returns as soon as the game answers. Bun's own fetch: the image
# has no other HTTP client to rely on.
HEALTHCHECK --interval=30s --timeout=3s --retries=3 --start-period=30s --start-interval=1s \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:8080/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "server.mjs"]
