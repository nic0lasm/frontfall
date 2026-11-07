# 0012 · Server ports, SQLite stores, room states and configuration

Status: Proposed · Date: 2026-11-07

## Context

File and line references in this section are to v1.0 (`b898c0a`). Later commits of this series move or remove some of those files.

`apps/server/src/server.ts` is 805 lines and `room.ts` 850. Time and randomness are called directly (`room.ts:502` defaults `now` to `Date.now()`; `server.ts:169,184,214` read the clock), so tests rely on fake timers. Persistence is six JSON files in the data volume, each with its own load, atomic write and fallback code: accounts (`accounts.ts:114`), bans and reports (`moderation.ts:117,229`), client errors (`client-errors.ts:176`), usage (`usage.ts:305`) and saved games (`saved-games.ts`). Bans are edited by hand in `bans.json`. A room's state is a set of flags changed in many places. Configuration is read from the environment in `server-options.ts` and `main.ts`.

## Decision

**Ports.** The server depends on interfaces for the clock, ids, the transport and the stores. `Clock` and `Ids` come first. A transport port with a `FakeTransport` lets `GameServer` be started with `listen(port, host)`, which returns `{ port }`, and stopped with `close()`, with no socket. The test suites and the bench are ported to this API while still on `node:http` and `ws`, which proves the port changes nothing, and then the Bun adapter replaces them ([ADR 0011](0011-bun-toolchain-and-runtime.md)).

**Module split.** `createGameServer` is split into a routes table (keeping today's precedence), admission, sessions, the turn timer, persistence and lifecycle. Client messages go through a typed handler map.

**Room states.** A room has a transition table: states, the events that move between them, and what each state allows. A `RoomOutbox` sends per seat, holds messages for a seat that is catching up, and keeps the 4 MiB backpressure cut.

**Stores.** Every store but the monthly usage exports goes into one SQLite file, `data.db`, in WAL mode with mode 0600. A `SqlDriver` port runs `bun:sqlite` in production and `node:sqlite` under Vitest.

- Every JSON store is imported once, at the first start on a new `data.db`: the import runs only while none has gone through, and a store file that appears later is left in place with a `store_not_imported` warning. Each is read once; usage falls back on `usage.json.bak`. A store that cannot be read stops the start with `import_failed`, and `.broken` and `.before-merges` files are left alone. The originals are renamed `*.imported` and kept, so the step can be undone. The monthly usage exports (`usage/months/`) stay files, which operators collect.
- A `frontfall-admin` command line handles bans, reports and `backup`. `backup` writes a consistent file with `VACUUM INTO`, which the host's backup job copies. Copying the live database file is unsafe, and the docs say so. This replaces editing `bans.json` by hand.
- Accounts hold personal data, so `docs/privacy.md` is updated in the same change.

**Configuration.** A zod schema describes every setting.

- A malformed value stops startup and lists every problem, not the first.
- An optional feature without configuration (sign-in, email, OAuth) is turned off with one warning, as it is today.
- `Logger` gains `error`. Process handlers for uncaught errors and rejections log and then exit with status 1, so the container restarts.

**Scaling stance.** One server process. The seams for more (transport, stores, the directory of rooms) exist, and nothing in this decision builds a cluster.

## Consequences

- Server logic is tested with a fake clock and a fake transport, without sockets or timers.
- A crash during a write no longer leaves a half-written JSON file, because SQLite commits atomically.
- Operators have one file to back up, with a supported way to do it. The first start after the change imports the old files; a failed import must stop the start rather than begin empty, and the import is tested on fixtures, including broken and backup files.
- The data format changes for operators who edit files or copy the volume. The CI check that restarts a self-hosted instance and `operations.md`, `self-hosting.md` and `privacy.md` change with it.
- A stricter configuration can refuse to start where the server used to start with a bad value. This is intended, and the message lists every fault.
- SQLite adds a synchronous disk write to the request path of account calls. Volumes are small, and the load test measures it.

## Alternatives considered

- **Keep the JSON files and add the ports only.** Leaves six formats, six fallback paths and hand edits. Rejected.
- **A separate database server.** One small machine runs the whole service today ([ADR 0001](0001-deterministic-lockstep.md)); a second service is a cost without need. Rejected.
- **Copy the live file for backups.** Can capture a half-written page. Rejected for `VACUUM INTO`.
- **One SQLite file per store.** More files, no shared transaction for a ban that also closes a report. Rejected.

## Deviations from the first proposal

- The monthly usage exports stay files in `usage/months/`; they are not in `data.db`.
- The import is strict where the first proposal kept every fallback: a store that does not read stops the start.
- The Discord webhook is not server configuration; only the announce tool reads it.

## Deferred

- More than one server process.
- Stored room states: a room's state is derived while the process lives and is lost with it, as today.
