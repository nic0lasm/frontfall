# Changelog

All notable changes to Frontfall are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Build cities and forts in a game: a panel above the toolbar, or C, F and X, picks what the next click builds or demolishes, with the cost of each and the cities your land supports. Structures show on the map, faded while being built.
- Engine: cities and forts ([docs/rules.md](docs/rules.md#6-structures)). Gold now buys structures: a city adds a twentieth of what the land holds to the population cap, a fort makes nearby land dearer to take and cheaper to lose, and both change hands with their tile. Players may own one city plus one more for every 10,000 tiles of land (40,000 on World), structures keep their distance, and bots build cities near their start. Protocol version 5 carries the new `build` and `demolish` orders.
- Ally and betray in a game: a right click, a long press or a leaderboard row opens a player's menu to ask for an alliance, accept, renew or betray. Requests wait under the banner with a countdown, allies are marked in the leaderboard and outlined on the map, and a feed tells everyone who allied and who betrayed whom.
- Engine: alliances and betrayal ([docs/rules.md](docs/rules.md#5-diplomacy)). Players ask each other for an alliance of 5 minutes, renewable in its last minute; allies cannot attack each other, and breaking an alliance marks the betrayer, whose land is half price for 30 seconds. Bots accept an alliance from a smaller player they are not fighting, one ally at most, and never betray.

## [0.2.0] - 2026-10-24

Online with friends: a player creates a private game from the menu, picks the map, the bots and their difficulty, and shares a link; every browser plays the same game in lockstep, and a desync is detected, reported and can be replayed. Eight maps, with the Panama and Suez canals open.

### Added

- **Online games in the browser**: the menu lists public games and opens private ones; the lobby shows the players, the countdown, the invitation link and the host's start button, and says when the page is outdated or a game expired. Every client runs the server's turns in its worker, with the bots the server asks for, and reports state hashes for desync detection ([docs/client.md](docs/client.md#playing-online)).
- Protocol version 3: the host of a private game picks the map, the number of bots and their difficulty (`configure`); the server accepts only published maps, and a small map or many bots leaves fewer seats. The `desync` message and log carry both hashes (protocol version 4).
- Online turns are evened out by a jitter buffer, so turns that the network bunches still play one per tick; a hidden tab keeps playing. Solo games run their turns down the same path.
- An online order keeps its ring on the map until the turn that carries it comes back from the server.
- A reload takes the online seat back: the tab rejoins the game, replays every turn and plays on with the others. Leaving from the menu gives the seat up.
- A desync offers a report to download. Engine: `DesyncReport` (version 1) holds the seed, map, balance, players, bots, turns and hashes of a game; `pnpm sim -- --replay report.json` plays one again and names the first tick where the client parted from the others ([docs/engine.md](docs/engine.md)).
- **Five more maps**: Americas, Africa and Asia from Natural Earth, and three small drawn maps, Island, Strait and Ring, for quick games and as test cases for a single landmass, a narrow strait and the east-west seam. The menu and the lobby list Earth maps and quick maps apart. The eight maps weigh under 400 kB compressed.
- Ships sail through the Panama and Suez canals on the World, Americas, Africa and Asia maps.
- Engine: golden replays of scripted games on Europe and World pin the state hash every 50 ticks; they run in Node with the tests and in Chromium and Firefox workers with `pnpm determinism`, and fail on the first tick that differs. The state hash now covers every balance value. `pnpm golden` writes them again after a change meant to alter games.
- End-to-end tests: a four-player private game without a desync, a reload during a game, and a forced desync whose downloaded report is replayed.

### Fixed

- Player colours show in the leaderboard and the lobby on servers whose content security policy forbids inline styles, as the public server does. The end-to-end tests run behind the same policy.

### Changed

- Nations on the continental maps start on their own continent and away from the map's edges.
- The server fits the seats of a private game to its map.
- The client is versioned 0.2.0, and the beta label shows it.

## [0.1.0] - 2026-10-24

The first playable beta: a solo game in the browser against bots on a map of the Earth or of Europe, with expansion, attacks, encirclement, retreat and ships across the sea, from the menu to the end screen. The relay server and protocol for online games are already in place.

### Added

- **Online games, protocol version 2** ([docs/protocol.md](docs/protocol.md)): a version handshake, binary frames for orders and turns, public games that start after a countdown or when full, private games joined by invitation link (`?game=<id>`), a list of public games at `/api/games`, reconnection with every missed turn, desync detection from client state hashes, and player name rules.
- Pages from an older build are asked to reload instead of joining a game they could desynchronise. Online games are played on the World map.
- Server protection and monitoring ([docs/server.md](docs/server.md)): a message rate limit per connection, idle connections closed, JSON logs that never record client addresses, and Prometheus metrics at `/metrics`, answered only to requests from the host.
- `/healthz` answers `503` when the turn timer has stalled for 5 seconds or the server is shutting down, so an uptime check sees a server that accepts requests but no longer plays.
- The image caps the Node.js heap at 512 MiB, and `FRONTFALL_MAX_GAMES` and `FRONTFALL_MAX_CONNECTIONS` set the server's limits.
- Large static files, map files included, are served gzipped to browsers that accept it.
- Static files carry an `ETag`, so browsers revalidate maps and get `304 Not Modified` instead of downloading them again.
- Server limits: open connections in all, private games per address, orders per player per turn and the size of a game's turn log; a game not started within ten minutes ends with reason `expired`.
- Engine: the rules of a complete game of expansion, from `createGame`: `Topology` with flat and wrapping grids, exact integer arithmetic, the game state and its tick loop, validation of every order, the spawn phase, growth of troops and gold, expansion into unowned land, attacks between players, encirclement, retreat and victory ([docs/engine.md](docs/engine.md)).
- Engine: encirclement captures enclosed land of any player next to an attack's new tiles, not only of the player under attack, and also after expansion into unowned land (R-ATTACK-08). All fronts of a tick are planned before any attack moves.
- Engine: the population cap starts from the map's starting troops, so new and small players grow from the first tick (R-ECO-01). Bots of every difficulty are calmer: hard bots no longer wipe out a casual player within minutes on World.
- Engine: bots that have nothing left to take by land send transport ships to free or weaker land away from their own shore, with up to B-BOAT-MAX ships at sea (R-BOT-05). Large empires look at more of their border, so they no longer miss a narrow land front. A falloff of the population cap past a share of the map is available (R-ECO-06, off by default). A beachhead whose troops are still attacking is no longer captured by encirclement (R-ATTACK-08). Together these let a leader reach the 75 % win on World: between hard bots it now takes 7 to 8 minutes, where the leader used to stall around 62 %.
- Engine: only the pocket next to where an attack is aimed is spared from encirclement, so a token attack no longer shelters all of a player's land (R-ATTACK-08). Bots wait a few decisions before searching the sea again when it offered nothing, and no longer send a ship that cannot pay for a free beach.
- Engine: attacks spread as a wedge towards their aim instead of a thin line, and move twice as fast for the same cost (B-ATTACK-SPEED 4, B-ATTACK-SPREAD). Spawn spacing, radius and starting troops grow with the map (R-SPAWN-06).
- Engine: transport ships carry troops across the sea and land them on another coast, so players on different continents meet (`embark` order, R-UNIT-02).
- `pnpm determinism`, run in CI: the same bot game on World reaches the same state hash in Node and in a Chromium worker.
- Engine: `game.hash()`, a hash of the whole game state, pinned by a scripted test game.
- Engine: `TurnClock` closes turns from local orders for solo games and tests; `pnpm sim` plays a whole game headless and reports tick times.
- Project foundations: deterministic engine (seeded random generator, world grid that wraps east-west), turn relay server with lobbies, Three.js map view with endless east-west panning, CI, container image and automated deployment.
- Game rules specification ([docs/rules.md](docs/rules.md)) with rule identifiers, and starting balance values ([docs/balance.md](docs/balance.md)).
- Architecture decision records: deterministic lockstep, topology, renderer split, hosting under a sub-path.
- Clean-room policy and a CI job that compares every pull request with the reference codebase, by tokens for code and by hash for other files.
- End-to-end tests of the built game at `/` and under `/frontfall/`, run in CI and against the public server after each deployment.
- `/healthz` reports the running build in the `X-Frontfall-Version` header; the deployment waits for the new version to answer.
- Images are tagged with the version on `v*` tags.
- WebSocket connections are limited per player address, and the number of open games is capped.
- Pre-commit hook that formats and lints staged files.
- Map proposal issue form.
- **Maps from open data**: World (2048 × 1024, wraps east to west) and Europe (1280 × 1080), generated from Natural Earth by `pnpm maps` with coasts, relief, ocean depth, polar ice and 64 and 40 starting nations. The map format is specified in [docs/map-format.md](docs/map-format.md) and the generator in [docs/maps.md](docs/maps.md); the engine loads and verifies a map in about 30 ms.
- WebSocket protocol reference ([docs/protocol.md](docs/protocol.md)): connection URL, limits, and every message with an example.
- The interface is available in English and French, chosen from the browser's languages; the client can switch language without reloading ([docs/client.md](docs/client.md#translations)).
- The game says it is a beta, with its version, on the menu and during a game, until 1.0 ([docs/client.md](docs/client.md#beta)).
- **A new look for the map**: shaded relief, shallow and deep seas, surf along the coasts, crisp borders, tiles that fade in as fronts move, and player names with their troops on their land ([docs/client.md](docs/client.md#drawing-the-map)).
- Ships in the solo game: a click on a coast across the sea sends troops by ship, ships are drawn gliding at sea, and a click that sends nothing says why on the map ([docs/client.md](docs/client.md#controls)).
- Attacks under way are listed during a game, each with a Retreat button that calls it back ([docs/client.md](docs/client.md#controls)).
- The HUD states the win condition and shows how far the leader and the player are from it, with the time played.
- **Solo game in the browser**: a menu with map, bot count and difficulty, a game against bots run in a Web Worker, a HUD with troops, gold, land, attack ratio and leaderboard, pause, a help panel and an end screen ([docs/client.md](docs/client.md)).
- Engine: bots that expand into free land and attack their weakest neighbour, with three difficulty levels (`B-BOT-*` in [docs/balance.md](docs/balance.md)).
- Map controls: pan and zoom with the keyboard, zoom towards the cursor, pinch to zoom on touch screens, and a clear message when the browser cannot run WebGL 2.
- **The README is now the project's front page**, in English and French: brand banner, a Play now section, the milestone table, an architecture diagram, self-hosting and a four-step contribution guide. Bug and feature forms label new issues for triage.

### Changed

- The game stays in beta until v1.0, which is now the complete game on the 3D globe. The balanced flat-map version becomes v0.5, and the globe and performance milestones become v0.6 and v0.7.
- The roadmap now ships phase 1 as playable versions instead of milestones M1 to M5: v0.1 is a solo game against bots on a map of the Earth, v0.2 online games with friends, v0.3 structures, diplomacy and nations, v0.4 ships and missiles, then v1.0. Each version lists the checks that make it playable ([docs/roadmap.md](docs/roadmap.md)).
- The engine compiles without browser or Node types, and its lint rules also reject `Date`, `crypto` and floating-point `Math` functions whose results vary between browsers.
- Node.js 24 is required.
- Static files are served with cache headers: hashed assets are immutable, the page is revalidated.
- Desync detection compares every player's hash for the same tick and flags only those who differ from the majority, so one client cannot end a game for everyone with a false hash.
- The server trusts the `X-Client-IP` header only from a proxy on a private address, and accepts WebSocket connections without an `Origin` header, as sent by bots and tools.
- A client that cannot read a turn asks for a reload instead of playing on out of step, and one that notices a gap in its turns rejoins to fetch the missing ones.

[Unreleased]: https://github.com/nic0lasm/frontfall/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/nic0lasm/frontfall/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nic0lasm/frontfall/releases/tag/v0.1.0
