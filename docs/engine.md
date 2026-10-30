# Engine API

`@frontfall/engine` is the deterministic simulation every client runs ([ADR 0001](adr/0001-deterministic-lockstep.md)). It has no dependency and no access to the browser, Node, the clock or `Math.random`. This page describes what the client, the server and the tools may use; anything not exported from `packages/engine/src/index.ts` is internal.

## Starting a game

```ts
import { createGame, Terrain, TileKind, WorldGrid } from "@frontfall/engine";

const grid = new WorldGrid(1000, 500); // wraps east-west; { wrapsX: false } for a flat map
const terrain = new Terrain(grid, kinds); // one TileKind per tile, from the map loader
const game = createGame({
  terrain,
  seed, // from the server: every client must use the same one
  players: [
    { id: 1, name: "Ada" },
    { id: 2, name: "Bea" },
  ],
  balance, // optional, defaults to DEFAULT_BALANCE
  teams, // optional: 2, 3 or 4 teams dealt in turn by id (R-MODE-02); a free-for-all without
});
```

Player ids are integers from 1 upwards; `0` (`NEUTRAL`) is the owner of unclaimed land. `createGame` installs every rule in the order they depend on: spawn, diplomacy, attacks, warships, missiles, transport ships, structures, trade, growth, victory.

## Running it

The game advances one tick per turn. A turn lists the orders the server accepted during that tick, in the order it accepted them:

```ts
game.step({
  tick: game.tick, // turns must arrive in sequence; anything else throws
  orders: [
    { player: 1, order: { type: "spawn", tile } },
    { player: 2, order: { type: "attack", target: tile, troops: 500 } },
  ],
});
```

Every order is validated before it runs (`orderError` gives the reason for a refusal), so an order from the network can never corrupt the game: invalid orders and orders of eliminated players are skipped. `step` returns how many orders were carried out.

| Order                                    | Rules                      | Effect                                                                                                                                                                                                                                                            |
| ---------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ type: "spawn", tile }`                | `R-SPAWN-01` to `-05`      | During the spawn phase: start at `tile`, or move the start there.                                                                                                                                                                                                 |
| `{ type: "attack", target, troops }`     | `R-ATTACK-01` to `-09`     | After the spawn phase: send `troops` against the owner of `target` (a player, or unowned land). The front advances towards `target`.                                                                                                                              |
| `{ type: "retreat", attack }`            | `R-ATTACK-06`              | Call back one of your attacks by id (`game.attacks`); its troops return, minus `B-RETREAT-PENALTY`.                                                                                                                                                               |
| `{ type: "build", structure, tile }`     | `R-BUILD-01` to `-09`      | After the spawn phase: build a `StructureKind` (`City` 0, `Fort` 1, `Port` 2, `Silo` 3, `AirDefense` 4, `Palace` 5, `Mosque` 6) on one of the player's tiles, for `structureCost(game, player, kind)` gold. `placementError` gives the reason it cannot go there. |
| `{ type: "demolish", tile }`             | `R-BUILD-06`               | Remove the player's structure on `tile`, with no refund.                                                                                                                                                                                                          |
| `{ type: "embark", target, troops }`     | `R-UNIT-02`, `R-ATTACK-09` | After the spawn phase: ship `troops` from the player's coast closest by sea to the coastal tile `target`, which they do not own. On arrival the ship takes `target` and attacks its owner from there.                                                             |
| `{ type: "ally", target }`               | `R-DIPLO-01`, `R-DIPLO-03` | After the spawn phase: ask player `target` for an alliance, accept their request, or ask to renew a running alliance in its last part. `allyError` gives the reason it is refused.                                                                                |
| `{ type: "betray", target }`             | `R-DIPLO-04`               | End the alliance with `target` at once; the player is a traitor for `B-TRAITOR-DURATION`.                                                                                                                                                                         |
| `{ type: "warship", port }`              | `R-UNIT-04`                | After the spawn phase: buy a warship at the player's ready port on tile `port`, for `warshipCost(game, player)` gold. `warshipError` gives the reason it is refused.                                                                                              |
| `{ type: "patrol", ship, tile }`         | `R-UNIT-04`                | Send the player's warship `ship` to patrol around the water tile `tile`, which it must be able to reach within `B-BOAT-RANGE`. `patrolError` gives the reason it is refused.                                                                                      |
| `{ type: "missile", target, size }`      | `R-UNIT-05`, `R-UNIT-06`   | After the spawn phase: launch a `MissileSize` (`Light` 0, `Heavy` 1) at the land tile `target` from the player's loaded silo closest to it (`launchSilo`), for `missileCost(game, size)` gold. `missileError` gives the reason it is refused.                     |
| `{ type: "embargo", target, on }`        | `R-DIPLO-05`               | After the spawn phase: start (`on` 1) or lift (`on` 0) an embargo on player `target`'s trade. `embargoError` gives the reason it is refused.                                                                                                                      |
| `{ type: "gift", target, troops, gold }` | `R-DIPLO-06`               | After the spawn phase: send player `target` `troops` and `gold`, either of them 0, at once; troops beyond their population cap stay home (`giftedTroops`). `giftError` gives the reason it is refused.                                                            |
| `{ type: "quick", target, phrase }`      | `R-DIPLO-07`               | After the spawn phase: send player `target` the preset quick message `phrase`, 0 to `QUICK_MESSAGES` − 1. It only reaches `game.diplomacyEvents`; `quickError` gives the reason it is refused.                                                                    |

After the turn's orders, each tick runs the rules in the order `createGame` installs them: the spawn phase, alliances and embargoes running out (gifts have no tick of their own), attacks, warships, missiles in flight and striking, transport ships, structures changing hands with their tiles, trade, growth and income, then victory. Bots and nations decide after these, in their own systems. Observers registered with `game.onApplied` hear of every order once it is carried out, humans' and computer players' alike: nations remember that way what is done to them (`R-BOT-20`), and an observer never applies an order itself.

Computer players do not go through turns: they run inside the engine and call `game.apply(player, order)` during a tick, the same path and checks as turn orders (`R-BOT-03`).

Offline, nobody relays turns: a `TurnClock` closes them from local orders. It has no timer of its own, so the page drives it at `B-TICK-RATE` and a test or a headless run drives it in a loop:

```ts
const clock = new TurnClock(game);
clock.submit(1, { type: "attack", target: tile, troops: 500 }); // queued for the next tick
const turn = clock.advance(); // runs the tick and returns the turn it closed
```

`pnpm sim` plays a whole game this way on a generated map with scripted players, and prints tick times, standings and the final state hash (options: `--width`, `--height`, `--players`, `--seed`, `--ticks`, `--interval`).

`pnpm determinism` plays 10,000 ticks of eight bots on World twice in Node and once each in a Chromium, a Firefox and a WebKit worker (`--browsers chromium` for one only), and fails unless every run reaches the same state hash; CI runs it on every push. Hashes are compared every 1,000 ticks, so a failure names the stretch where the runs parted.

Golden replays in `packages/engine/test/replays/` are desync reports (see below) of scripted games on Europe and World, with the hash pinned every 50 ticks. The bench tests play them in Node with today's `DEFAULT_BALANCE`, and `pnpm determinism` plays them again in the Chromium, Firefox and WebKit workers. WebKit on Linux is not the Safari players run, but it runs the same JavaScript engine, which is what the hashes depend on. `game.hash()` folds in every balance value and every player's start tile from the map, so a client whose map manifest lists other nations (its JSON is not covered by the terrain's `sha256`) parts from the others at the first hash, at tick 0. Changing a rule or any balance value makes the replays fail with the first tick that differs. When the change is meant, `pnpm golden` writes them again; commit the new files with the change (see "Changing a rule or the balance" in CONTRIBUTING.md). A failure after a change that should not alter games is a bug, not a reason to regenerate.

The sources use only syntax that type stripping can erase (`erasableSyntaxOnly`), so Node runs them without a build step.

## Reading the state

| What                           | How                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tick and phase                 | `game.tick`, `game.phase` (`"spawn"` or `"play"`)                                                                                                                                                                                                                                                                               |
| Players                        | `game.players()` in id order, `game.player(id)`: `troops`, `gold`, `alive`                                                                                                                                                                                                                                                      |
| Owner of a tile                | `game.territory.ownerOf(tile)`; the whole map in `game.territory.owners` (`Uint16Array`, read only)                                                                                                                                                                                                                             |
| Territory size, borders        | `game.territory.tileCount(id)`, `borderCount(id)`, `borderTile(id, i)`, `isBorder(tile)`                                                                                                                                                                                                                                        |
| Tiles changed since last frame | `game.territory.changes()`, then `clearChanges()`; redraw everything if `changesOverflowed`                                                                                                                                                                                                                                     |
| Attacks under way              | `game.attacks`: `id`, `player`, `target` owner, aimed tile `aim`, `troops`                                                                                                                                                                                                                                                      |
| Warships                       | `game.warships`: `id`, `player`, `tile`, `health`, `patrol`, `path`, `step`, `reloadAt`; `game.fights`: `a` < `b`, `until`; `atWar(game, a, b)`, `patrolRadius`                                                                                                                                                                 |
| Missiles                       | `game.missiles`: `id`, `player`, `size`, `from` silo tile, `to`, `launchedAt`, `arrivesAt`, `tried` (air defenses by id); `missileTile(game, missile, tick)`, `blastRadius`, `airDefenseRadius`. `game.fallout`: `tile`, `radius`, `until`; `game.usable(tile)` is false under fallout                                          |
| Trade                          | `game.tradeShips`: `id`, `player` paid on arrival, `from` and `to` port tiles, `path`, `step`; `game.embargoes`: `from`, `to`, `since`; `embargoed(game, a, b)`                                                                                                                                                                 |
| Ships at sea                   | `game.boats`: `id`, `player`, `target` coast, `troops`, `path` of water tiles, `step`; see below                                                                                                                                                                                                                                |
| Structures                     | `game.structures`: `id`, `player`, `kind`, `tile`, `readyAt`, `reloadAt` (silos and air defenses); `isReady`, `structureAt`, `workingCities`, `cityLimit`, `cityShare`, `fortified`, `fortRadius`                                                                                                                               |
| Diplomacy                      | `game.alliances`: `a` < `b`, `until`, `renewA`, `renewB`; `game.allianceRequests`: `from`, `to`, `expiresAt`; `game.player(id).traitorUntil`; `isAllied`, `alliesOf`, `isTraitor`, `canRenew`                                                                                                                                   |
| Diplomatic events              | `game.diplomacyEvents`: `tick`, `type` (`allied`, `ended`, `betrayed`, `embargo`, `lifted`, `captured`, `missile`, `stopped`, `gift`, `quick` with its `phrase`), `a`, `b`, oldest first; an interface empties it as it reads (`splice(0)`); unread, it keeps the latest `DIPLOMACY_LOG_SIZE` (256). Not part of the state hash |
| Start tiles                    | `game.player(id).start`                                                                                                                                                                                                                                                                                                         |
| Result                         | `game.winner`, `game.decidedAt`; in a team game `game.winningTeam`, and each player's `team`, from 1                                                                                                                                                                                                                            |
| Geometry                       | `game.terrain.topology`: `neighbors`, `distance`, `tilesWithin`, `toLatLon` ([ADR 0002](adr/0002-topology.md))                                                                                                                                                                                                                  |
| Terrain                        | `game.terrain.kind(tile)`, `isOwnable(tile)`, `isCoast(tile)`, `landmassOf(tile)`                                                                                                                                                                                                                                               |

A ship's `path` lists the water tiles from the departure coast to the landing coast, in order, neither coast included. The ship is on `path[step]` until `step` reaches `path.length`, the tick it lands. `landmassOf(tile)` numbers the land masses of the map (ownable tiles connected over land, `-1` for water and impassable tiles): a click on a land mass where the player holds no tile is a job for a ship, not an attack.

For computer players, `reachableCoasts(game, player, limit, accept?)` lists the coastal tiles a ship of theirs can reach, closest by sea first, keeping only those `accept` lets through; bots use it to look past the land masses they already stand on (R-BOT-05), and `seaRoute(game, player, target)` gives the route an embark order would take, or `undefined`. Both walk the sea breadth-first, up to `B-BOAT-RANGE` tiles; call them a few times per second at most, not every tick for every bot.

The state objects are live: read them, never write them. A renderer reads after each `step`; the engine never calls the renderer ([ADR 0003](adr/0003-renderer-split.md)).

## Balance

`DEFAULT_BALANCE` holds the values of [balance.md](balance.md), converted to ticks and integers. Each field names its `B-` key. Tests and private lobbies may pass their own `balance`; a multiplayer game must use the same one on every client.

## Desync reports

When a client's state hash disagrees with the other players', it can save a `DesyncReport` (format version `DESYNC_REPORT_VERSION`, now 2; version 2 added the nations and their starts; the reader refuses version 1, whose hashes no longer match a replay since the hash covers the start tiles): plain JSON with everything needed to play the game again on another machine.

| Field     | Content                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `version` | `2`. Readers refuse any other.                                                                                                  |
| `build`   | `release`, the build's release name, and `protocol`, the `PROTOCOL_VERSION` it spoke.                                           |
| `map`     | The published map: `id`, the manifest's `format` and `version`, and `sha256`, the hash of its terrain file.                     |
| `seed`    | The game's seed.                                                                                                                |
| `balance` | Every balance value the game ran with, the defaults included.                                                                   |
| `players` | Every player, humans, bots and nations, as `{ id, name }` with the ids the game used, and `start` for a nation's map tile.      |
| `bots`    | `ids` of the computer players and their `difficulty`.                                                                           |
| `nations` | `ids` of the nations, at the bots' difficulty; absent when the game had none.                                                   |
| `you`     | The id of the player whose client wrote the report.                                                                             |
| `ticks`   | Ticks the client had run.                                                                                                       |
| `turns`   | `{ tick, orders: [{ player, order }] }` for every tick with orders, in tick order; other ticks ran without orders.              |
| `hashes`  | `{ tick, local, expected }` for each checked tick: the client's hash after it, and the hash most other players sent, or `null`. |

`readDesyncReport(json)` checks a parsed file and returns the report, or throws `DesyncReportError`. `replayDesyncReport(report, terrain)` plays it again and returns `firstDesync`, the first tick where `local` and `expected` differ, and `firstLocalMismatch`, the first tick where the replay does not give `local` back; the second should never happen, since it means the engine is not deterministic or the report was damaged.

```sh
pnpm sim -- --replay report.json
```

loads the published map the report names, refuses a map whose terrain hash differs, replays the game, prints the first desync tick, and exits with 1 when the replay does not reproduce the client's hashes.

## Game records

A `GameRecord` (format version `GAME_RECORD_VERSION`, now 1) keeps a finished game to watch again (#50). It has the fields of a desync report from `map` to `turns`, without `hashes`, and two of its own:

| Field   | Content                                                                                                                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build` | `release` and `protocol` as in a desync report, and `build`, the page's [simulation build](protocol.md#simulation-build). Only the same simulation build replays a record. |
| `hash`  | The state hash after `ticks` ticks. A replay that reaches another one ran different rules, or the file was damaged.                                                        |

Bots and nations are not in the turns: they decide again, from the same state, as they did in the game. `readGameRecord(json)` checks a parsed record and `replayGameRecord(record, terrain)` plays it to its last tick and returns the hash it reaches; `recreateGame(record, terrain)` sets up the game before its first tick, for a viewer that plays it at its own pace. Both readers refuse turns out of order or past `ticks`, and a `you` that is not one of the players.

## Snapshots

A snapshot is the whole state of a game between two ticks, in a compact binary form (#39): a client that joins late, or comes back, loads one and plays only the turns after it instead of every turn from the start. `saveSnapshot(game, build)` writes one, where `build` names the simulation, the page's `BUILD` ([simulation build](protocol.md#simulation-build)). `loadSnapshot(bytes, build, create)` loads one into the new game `create()` returns, set up like the original: same setup, same rules, same bots and nations, before its first tick (`recreateGame` gives one). It never throws: a snapshot it cannot load comes back as `{ ok: false, reason }`, and the caller plays the turns from the start in a game of its own. `readSnapshotHeader(bytes)` reads the header alone.

The checks come in this order, and nothing of the state is read before the first five pass:

1. at most `SNAPSHOT_MAX_BYTES` (1 MiB);
2. the four magic bytes and format `SNAPSHOT_FORMAT`, now 2 (version 2 added each player's work share);
3. the same `build` as the reader's;
4. the game from `create()` has not started, and its `game.setupDigest()` matches: seed, balance, map, players, teams and what the game leaves out;
5. the checksum of the state's bytes;
6. the same rule parts, by name, in the same order;
7. every value in range, and the border lists consistent with the owners;
8. once loaded, `game.hash()` equal to the hash in the header.

### Format

Numbers are variable-length: seven bits a byte, low bits first, the high bit set on every byte but the last. Signed numbers fold their sign into the lowest bit first (`n ≥ 0` gives `2n`, `n < 0` gives `−2n − 1`), and every number is a safe integer. A word is four bytes, low byte first. Text is a count of UTF-16 code units, then each unit as a number. A path is its length, then each tile as a signed step from the one before, the first from 0. An optional value is a signed number, `−1` for none. A list is its count, then its entries.

The header:

| Field    | Encoding                                             |
| -------- | ---------------------------------------------------- |
| magic    | `70 70 83 78` (`FFSN`), each as a number             |
| format   | number, `2`                                          |
| build    | text                                                 |
| setup    | word: `setupDigest()` of the game                    |
| tick     | number: ticks run; the next turn to play is this one |
| hash     | word: `game.hash()` at that tick                     |
| checksum | word: 32-bit FNV-1a of every byte after it           |

The state follows, to the last byte:

| Part        | Content                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| random      | the four words of `game.random`, each as a signed number, as the generator holds them                                                                                                                                                                  |
| players     | in id order: `troops`, `gold`, `goldRemainder` (signed), `workShare`, `alive` (0 or 1), `start` (optional), `traitorUntil`                                                                                                                             |
| owners      | the owner of every tile, as runs: a count, then `owner, length` for each run                                                                                                                                                                           |
| borders     | for each player id from 1 to the highest: the border list, its count then its tiles, in list order                                                                                                                                                     |
| fallout map | `falloutUntil` of every tile, as runs like the owners                                                                                                                                                                                                  |
| units       | for attacks, boats, structures, trade ships, warships and missiles: the next id, then the list, each entry its fields in the order of its type; boats, trade ships and warships end with their path, missiles with the list of air defenses that tried |
| lists       | fallout, fights, alliances (`renewA` and `renewB` as 0 or 1), alliance requests, request cooldowns, embargoes, quick cooldowns                                                                                                                         |
| outcome     | `winner`, `winningTeam`, `decidedAt` (optional)                                                                                                                                                                                                        |
| rule parts  | a count, then for each part registered with `game.persist`: its name (text), then its bytes, a count then the bytes                                                                                                                                    |

The rule parts today are `trade` (the open ports in the order they opened: opened again in that order, they find the same routes), `bots <difficulty> <ids>` and `nations <difficulty> <grace seconds> <ids>` (the tick each player may search again for a coast, a city site, a port site, and for nations a silo site, by player id). Diplomacy events, the change log of the territory and every cache of the map are not part of a snapshot: a loaded game starts with no events and tells its renderer to redraw everything.

On World with 16 hard bots, a snapshot weighs at most 107 KB (87 KB once compressed) over a whole game; with the 64 nations of the map added, 162 KB. Saving takes under 90 ms and loading under 200 ms. The size follows the map and how divided it is, not how long the game has lasted.

A change to what the state holds changes the format: a new field, a new list or a new rule part means a new `SNAPSHOT_FORMAT`, and the tests of `test/snapshot.test.ts` and `bench/test/snapshots-*.test.ts` load and play on from snapshots at many ticks to the same hashes as the game that never stopped.

## Helpers

- `Random`: the seeded generator. Anything random in a game comes from `game.random`.
- `clamp`, `divFloor`, `mulDiv`, `percentOf`, `isqrt`: exact integer arithmetic for game state.
- `TerritoryMap`, `BoundedFloodFill`: the ownership store and a bounded fill, for engine code.

## Extending the engine

A new rule is a function `installX(game)` that registers order handlers (`game.onOrder`) and tick systems (`game.onTick`), cites its rule identifiers, and is added to `createGame` in the right place. Its state lives on `Game` or `Player`, so that `game.hash()` covers it and snapshots carry it; state that must stay in a closure, like the cooldowns of computer players or the order the ports opened in, is registered with `game.persist(name, { save, load })` so that snapshots carry it too. A cache that the state and the map fully determine may live in a closure without either. It draws randomness from `game.random`, or, for a new rule that should leave every other draw of the game as it was, from `derivedRandom(game.seed, tick, id, usage)` with a usage of its own in `DrawUsage` and comes with tests that name the rules they cover. A change to any outcome changes the pinned hash in `test/hash.test.ts` and the golden replays: update them on purpose (`pnpm golden`), and record the change in the changelog.
