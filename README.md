# Frontfall

**A real-time multiplayer territorial strategy game, played on a world with no edges.**

[![CI](https://github.com/nic0lasm/frontfall/actions/workflows/ci.yml/badge.svg)](https://github.com/nic0lasm/frontfall/actions/workflows/ci.yml)
[![CodeQL](https://github.com/nic0lasm/frontfall/actions/workflows/codeql.yml/badge.svg)](https://github.com/nic0lasm/frontfall/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/nic0lasm/frontfall/badge)](https://scorecard.dev/viewer/?uri=github.com/nic0lasm/frontfall)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Version française](README.fr.md)

## At a glance

|                  |                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------- |
| **What it is**   | Expand your territory, outgrow your neighbours, hold the map. In the browser, no install. |
| **The twist**    | The world wraps east to west. Phase 2 puts it on a 3D globe: no edge to hide behind.      |
| **Status**       | Early development. The engine foundations, relay server and map renderer are in place.    |
| **Play**         | Public server at `nclsmgr.com/frontfall` once the first playable version ships.           |
| **Requirements** | A browser with WebGL 2.                                                                   |
| **License**      | MIT                                                                                       |

## Roadmap

- [x] Deterministic engine foundations: seeded random generator, world grid that wraps east-west
- [x] Turn relay server with lobbies, health check and graceful shutdown
- [x] Three.js map view with endless east-west panning
- [ ] Territory, troops and attacks
- [ ] Bots, so a game is fun with few players
- [ ] Maps generated from open geographic data
- [ ] First public multiplayer release (v1.0)
- [ ] Phase 2: the same game on a 3D globe

## Run it locally

Requirements: Node.js 22.12 or later (24 recommended) and pnpm 10 (`corepack enable` provides it).

```sh
pnpm install
pnpm dev        # client on http://localhost:5173, server on :8080
```

Other commands:

| Command              | What it does                                      |
| -------------------- | ------------------------------------------------- |
| `pnpm test`          | Unit tests (Vitest)                               |
| `pnpm test:coverage` | Tests with coverage; CI fails below 90 % of lines |
| `pnpm lint`          | ESLint with type-aware rules                      |
| `pnpm typecheck`     | TypeScript in strict mode, every package          |
| `pnpm build`         | Production client and bundled server              |

Or with Docker:

```sh
docker build -t frontfall .
docker run --rm -p 8080:8080 frontfall   # http://localhost:8080
```

## How it works

Every client runs the same simulation. The server never computes the game: it collects each player's orders, numbers them into turns ten times per second, and sends the same turns to everyone. Identical inputs on a deterministic engine give identical games, with a fraction of the bandwidth of streaming state.

```
              players (browser)
   +-------------------------------------+
   |  apps/client                        |
   |  Three.js view  +  HTML interface   |
   |          |                          |
   |  packages/engine                    |
   |  deterministic simulation           |
   +------------------|------------------+
                      |  WebSocket: orders in, turns out
   +------------------v------------------+
   |  apps/server  (Node.js)             |
   |  lobbies, turn relay, static files  |
   +-------------------------------------+
   packages/protocol: message schemas shared by both sides
```

| Choice                 | Why                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------- |
| TypeScript, strict     | One language for engine, client and server                                          |
| Deterministic engine   | Integer maths and a seeded generator; lint rules forbid the clock and `Math.random` |
| Cylindrical world grid | No left or right edge today; the globe changes the projection, not the rules        |
| Three.js               | WebGL rendering that scales from the flat map to the globe                          |
| zod schemas            | Every message is validated on arrival, on both sides                                |
| Single small container | Read-only filesystem, non-root user, multi-arch image scanned before release        |

## Contributing

Bug reports, ideas and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); questions and ideas go to [Discussions](https://github.com/nic0lasm/frontfall/discussions). Security issues are reported privately, as described in [SECURITY.md](SECURITY.md).

## Inspiration and credits

Frontfall is an independent game in the tradition of browser territory games such as OpenFront. It shares no code, assets or text with them. See [CREDITS.md](CREDITS.md) for the libraries and data it relies on.

## License

[MIT](LICENSE) © 2026 Nicolas Maigre
