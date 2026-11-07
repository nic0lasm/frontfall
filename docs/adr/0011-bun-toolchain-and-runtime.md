# 0011 · Bun toolchain and server runtime

Status: Proposed · Date: 2026-11-07

## Context

File and line references in this section are to v1.0 (`b898c0a`). Later commits of this series move or remove some of those files.

The repository is a pnpm workspace (`package.json:9`, `pnpm@10.28.0`) on Node 24 (`.nvmrc`). The server image runs Node with a heap cap (`Dockerfile:28`, `NODE_OPTIONS=--max-old-space-size=512`) so resident memory stays inside a 1 GiB container. Its health check calls `wget` (`Dockerfile:42`). The server speaks HTTP with `node:http` and WebSocket with `ws` (`apps/server/src/server.ts:1,9`). It sends a game's turns by looping over the sockets of a room and checking `bufferedAmount` against 4 MiB (`server.ts:62,457`), which cuts a client that falls behind.

The 6,132 lines of server tests (`apps/server/test/`) use `GameServer.http`, the `_socket` of `ws`, `node:net` half-requests, and fake timers in the email-auth suite.

## Decision

- **Toolchain.** Bun replaces pnpm for install, workspaces and scripts. `bun.lock` replaces `pnpm-lock.yaml`. CI uses `setup-bun` pinned by commit SHA. The provenance check exempts `bun.lock` the way it exempts `pnpm-lock.yaml` today, since a lockfile is not hand-written text.
- **What stays on Node 24.** Vitest, Playwright and Vite. They are tested on Node, and the browser tests gain nothing from a runtime swap. The engine determinism job runs on Node twice and adds a run on Bun and one in Chromium, so a runtime difference shows up as a hash difference.
- **Server runtime.** The server runs on Bun with `Bun.serve` only. The `node:http` server and `ws` go. The server image builds with Bun; see [ADR 0012](0012-server-ports-and-stores.md) for the ports around it.
- **Sends are per peer.** Each seat has an outbox. The server does not use room-wide pub/sub topics, because a seat that catches up gets turns from the log first and must not receive live turns out of order. The 4 MiB backpressure cut stays.
- **Mail.** nodemailer stays. It is verified on Bun against a local SMTP server, including STARTTLS, in a `bun test` suite.
- **Memory.** The heap cap is replaced by a container memory limit, sized from the load test (`bun run load`) run on Bun, with the resident size recorded in the pull request.
- **Tests.** Vitest keeps the server logic, through a transport-neutral harness. A small `bun test` suite (`bun run test:bun`) covers the Bun adapter: upgrade, half-requests, backpressure, SMTP. It also covers `bun:sqlite` and the `frontfall-admin` command, which only run on Bun.
- **Health check.** `wget` is replaced by `bun -e` with `fetch`, because the runtime image carries one runtime and no extra tools.

## Consequences

- One tool installs, runs scripts and runs the server. Install is faster.
- Two runtimes remain in the repository (Node for tests and the browser tools, Bun for install and the server), and the determinism job covers both.
- The container needs a memory limit it did not need before; a mistake in sizing shows as an out-of-memory kill. The load test and its figure are the evidence.
- Operator documents that show `node -e` or `wget` commands, the mentions of `pnpm` across the docs (over a hundred), Dependabot and the maintainer's host jobs must change. The container user stays uid 1000, so the volume ownership the host backup relies on does not change.
- Bun is younger than Node. A bug in its HTTP or WebSocket layer is ours to find. The adapter is thin and the `bun test` suite targets the cases that differ.

## Alternatives considered

- **Keep Node and pnpm.** Nothing is broken. The gain here is one toolchain and a lighter image, and it is the maintainer's call whether that is worth the migration.
- **Bun for tests too.** The suites use the Vitest APIs for fake timers and mocks, and porting 6,132 lines to another runner would gain nothing. `bun test` is kept to what needs Bun itself: the adapter, SQLite and the admin command.
- **Room-wide topics (`server.publish`).** Fewer lines, but a catching-up seat would see live turns before its backlog. Rejected.
- **Keep `ws` on Bun.** It works but runs through a compatibility layer and keeps a dependency the runtime does not need. Rejected.

## Deferred

- Running Vitest on Bun.
