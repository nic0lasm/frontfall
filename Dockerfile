# syntax=docker/dockerfile:1

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
WORKDIR /app
# Bun installs and runs the scripts; Node runs the build tools that need it and, in the next stage, the server.
RUN npm install --global bun@1.4.4
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

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS run
# Commit the image was built from, reported by /healthz.
ARG FRONTFALL_VERSION=dev
WORKDIR /app
ENV NODE_ENV=production \
    FRONTFALL_VERSION=$FRONTFALL_VERSION \
    PORT=8080 \
    FRONTFALL_STATIC=/app/public
# Keeps the heap, and so the resident memory, well inside a 1 GiB container.
ENV NODE_OPTIONS=--max-old-space-size=512
# Package managers are not needed at runtime.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
     /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build --chown=node:node /app/apps/server/dist/server.mjs ./server.mjs
COPY --from=build --chown=node:node /app/apps/client/dist ./public
# The only place the server may write besides /tmp, mounted as a volume in production; a new
# named volume takes this owner. The server also starts without it.
RUN install -d -o node -g node /var/lib/frontfall
USER node
EXPOSE 8080
# Checked every second while starting up (a Docker that knows --start-interval), so that
# `docker compose up --wait` returns as soon as the game answers.
HEALTHCHECK --interval=30s --timeout=3s --retries=3 --start-period=30s --start-interval=1s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.mjs"]
