# Network protocol

Version 23. Clients and the game server talk over one WebSocket per player. The schemas live in [`packages/protocol`](../packages/protocol/src), which the client and the server both import; this page describes them for anyone writing a bot, a replay tool or another client.

The server never simulates the game ([ADR 0001](adr/0001-deterministic-lockstep.md)). It fills games with players, gives every player a number, then closes the orders it receives into one numbered turn every 100 ms and sends the same turns to every player. Each client runs the engine on those turns and reaches the same state.

## Connection

The socket opens at `ws` next to the page: `wss://nclsmgr.com/frontfall/ws` in production, `ws://localhost:8080/ws` locally. The server refuses the upgrade with `403` when an `Origin` header is sent and is not the configured one, with `429` when the player's address already holds too many connections, and with `503` when the server holds as many connections as it accepts. Browsers always send `Origin`; tools such as bots may leave it out.

Two kinds of frames travel on the socket:

- **Text frames** carry one JSON object with a `type` field. All control messages use them.
- **Binary frames** carry orders (client to server) and turns (server to client), which make up nearly all of the traffic. Their encoding is described [below](#binary-frames).

Every frame is validated after decoding. A client frame that cannot be decoded, has unknown fields or breaks a rule closes the connection with code `4001`. Frames larger than 1 KiB close it with `1009`.

The server pings every 25 seconds and drops a connection that missed the previous ping. Browsers answer pings on their own.

## A game, step by step

```text
client                                   server
  | -- hello { version: 23, name } ----------> |
  | <------------------ welcome { version } -- |
  | -- play ---------------------------------> |   or create, or join { game }
  | <-------------- lobby { players, ... } --- |   again after every change
  | <------- started { seed, players, ... } -- |
  | <----------------------- turns (binary) -- |   one frame per beat, from tick 0
  | -- order (binary) -----------------------> |
  | <------- turns: tick n holds the order --- |
  | -- hash { tick, hash } ------------------> |   every 50 ticks
```

1. **Hello.** The first message of every connection. The server checks the protocol version and the player name, then answers `welcome`. A connection that sends nothing within 10 seconds is closed with `4003`.
2. **Lobby.** The player plays now (`play`), opens a game of their own, public and named or private (`create`), or joins one by id (`join`). Every game has a host, its first player, who sets its options with `configure`. The server sends `lobby` to everyone in the game each time something changes.
3. **Start.** The host starts the game with `start`; a game set to start when full starts as soon as its last seat is taken. A game opened by `play` also counts down 60 seconds from its first player, with at least 30 seconds left when the second one arrives: if the first player is still alone at the end, bots stand in for opponents. Its host may stop the countdown once with `hold`. Every player receives `started` with the seed, the final player numbers and a reconnect token.
4. **Turns.** From tick 0, the server sends one frame every 100 ms, a beat, with as many turns as the game's `speed` (`R-MODE-07`), with or without orders: one turn every 100 ms at speed 1, four every 100 ms at speed 4. A client runs tick `n` only after receiving turn `n`.
5. **End.** The server sends `ended` when every player is gone, when the game reaches four hours, or when a game has not started ten minutes after it opened. A client that leaves earlier sends `leave`. Either way, the connection can join another game.

### Player numbers

Players are numbered from 1 in the order they joined. Numbers in `lobby` messages can change while players come and go; the numbers in `started` are final and are the ids the engine uses (0 is the neutral owner of the map).

### Reconnecting

If the connection drops during a game, the seat stays reserved for five minutes. The client opens a new connection, says `hello`, then sends `rejoin` with its token and the first tick it has not run. The server answers with `started` again, then every turn from that tick, in frames of up to 2,000 turns, then the live turns. While the player is away, the game goes on without their orders.

A token works for one connection at a time. If the server still holds a connection for the seat, it answers `token_in_use` and checks that connection with a ping: a connection that does not answer within 5 seconds is dropped, and the next `rejoin` succeeds.

Before a game starts, a dropped connection keeps its seat for 30 seconds, unless the page closed it with code 1000 or 1001. The client sends `rejoin` with the token of its last `lobby` message and `from` 0: it is back in the lobby, with the host role if it had it, or receives `started` and every turn if the game began meanwhile. If the seat is gone (`token_invalid`), the client joins again with the same request, or by id once it was in a private game.

## Client messages

### `hello`

```json
{ "type": "hello", "version": 23, "name": "Léa", "build": "0d25e267bbae" }
```

First message of every connection. `version` is `PROTOCOL_VERSION`. A server running another version closes the connection with `4000`: the page is out of date and must be reloaded. This message keeps the same shape in every version of the protocol, so the mismatch can always be reported.

`build`, optional, is the page's [simulation build](#simulation-build). The server also closes the connection with `4000` when it runs another simulation build, since the game would desynchronise. `dev` builds, on either side, are always accepted.

The name is cleaned up (Unicode NFC, trimmed, runs of spaces collapsed) and must then hold 1 to 20 characters: letters and digits of any script, spaces, `.`, `_`, `'` and `-`, starting with a letter or a digit. Names that pass for the people running the game, such as `admin` or `Frontfall`, are refused, and so are web addresses and coarse words, as for game names: a host's name shows in the public list. A connection opened with the cookie of a signed-in player plays under the account's name, whatever `name` says; a guest who asks for a name an account holds, ignoring case, accents and punctuation, is refused ([accounts](server.md#accounts)). A refused name gets an `invalid_name` error and the client may send `hello` again. Once accepted, a second `hello` closes the connection. Two players never share a name in a game: one who joins under a name already there, ignoring case, gets it with a number, `Léa 2`, shortened to stay within 20 characters.

### `play`

```json
{ "type": "play", "name": "Partie de Nico" }
```

Joins the game opened by `play` still waiting with the most players and a free seat, never a game that waits for its host, or opens a new one under `name` (optional; a name the rules below refuse falls back to "<player>'s game"). A game opened this way counts down 60 seconds from its first player, leaves at least half of that, 30 seconds, when the second player arrives, so a third can still come, and starts with the map's default bots if that player is still alone (the catalog's recommended players minus one, 24 at most).

### `create`

```json
{ "type": "create", "visibility": "public", "name": "Europe 4v4" }
```

Opens a game whose host is the creator and which starts only when the host says so, or when it is full if the host asks for that. `visibility` is `private` when left out. A public game is listed at [`/api/games`](#http-endpoints) under `name`; a private one is only reached by its link. The game id in the next `lobby` message is the invitation: the client shares it as a link, `https://nclsmgr.com/frontfall/?game=<id>`. Game ids hold 72 random bits.

A game name is cleaned like a player name, then must hold 3 to 32 characters: letters and digits of any script, spaces and `. _ ' ! ? # & ( ) + : , -`, starting with a letter or a digit. Web addresses and a short list of coarse words, French and English, are refused with `invalid_game_name`. When a waiting public game already has the name, the server adds ` (2)`, ` (3)`... One address holds at most three games that have not started, public and private together; `play` is not counted, as it joins a waiting game whenever one has a seat.

### `join`

```json
{ "type": "join", "game": "Xk3_9aB-q2Lm" }
```

Joins a game by id, public or private, before it starts.

### `rejoin`

```json
{ "type": "rejoin", "token": "q8Vb1aV9mN3x0WcY2tLk4Q", "from": 1200 }
```

Takes back a seat after a dropped connection; see [Reconnecting](#reconnecting). `from` is the first tick the client has not received. After a reload, it is the tick of the [snapshot](engine.md#snapshots) the page kept of the game, if any: the browser stores one in IndexedDB 30 seconds into the game, then every two minutes, and starts from it. A page that cannot load its snapshot reconnects and rejoins from 0. A rejoin with `from` 0 rebuilds the game from the first turn, so it clears a [`desync`](#desync) flag: the hashes the client sends next decide afresh.

### `configure`

```json
{
  "type": "configure",
  "options": {
    "map": "europe",
    "bots": 6,
    "difficulty": "hard",
    "nations": true,
    "teams": 0,
    "disabled": 0,
    "capacity": 8,
    "autoStart": true,
    "speed": 1,
    "rules": { "collapsingFronts": false, "capitals": true }
  },
  "name": "Europe 2v2",
  "seq": 3
}
```

The host sets the game's map, its number of bots, how hard computer players play and whether the map's nations play, and `teams`: 0 for a free-for-all, or 2, 3 or 4 teams, and `disabled`: what the game leaves out (`R-MODE-03`), as a sum of 1 for cities, 2 forts, 4 ports, 8 missile silos, 16 air defenses and 32 warships, 0 for nothing, until the game starts. `capacity`, the seats for human players, from 2 to 16, and `autoStart`, whether the game starts as soon as they are all taken. `speed`, optional, is the game's pace (`R-MODE-07`): 1, 2 or 4 ticks per beat of the server; left out, it stays as it was. A public game refuses any speed but 1 with `invalid_settings`. `rules`, optional, holds the special rules (`R-MODE-08`), each one `true` or `false` by name: `collapsingFronts` (`R-ATTACK-10`) and `capitals`, capital mode (`R-CAP`), where taking a player's capital conquers them; left out, they stay as they were, and a public game refuses any but the defaults with `invalid_settings`. Every option is sent each time, `speed` and `rules` aside; `name`, optional, renames a public game and is ignored for a private one. `map` is the id of a map in `maps/index.json`; `difficulty` is `easy`, `normal` or `hard`. The server adds at most 25 bots. Bots and seats share the most players the map allows (`players.max` in the catalog): the game keeps the seats asked for when they fit and fewer otherwise, but never fewer than the players already in. Every player receives the new options and `capacity` in `lobby`. Nations come on top of the players and bots. A new game starts on World, without bots, with nations, at `normal`, with 16 seats, set to start when full, at speed 1, with collapsing fronts and without capital mode.

`seq`, optional, numbers the player's `configure` messages, from 1 for each seat and again from 1 after a reconnection: `rejoin` sets `configured` back to 0. The server echoes the last one it handled as `configured` in `lobby`, so that a host who changes several settings in a row can tell an answer to an earlier change from the answer to the latest one, and keeps the form as filled until then. A refused `configure` that carries `seq` is followed by `lobby` to that player alone, with the settings that hold and `configured` set to that `seq`.

### `start`

```json
{ "type": "start" }
```

The host starts the game with the players present: at least two in a public game, any number in a private one.

### `hold`

```json
{ "type": "hold" }
```

The host of a game opened by `play` stops its countdown, once. The game then waits for the host's `start`, or for its last seat to be taken when it starts when full.

### `active`

```json
{ "type": "active" }
```

The player is at the screen. A host who has sent nothing for two minutes while other players wait hands the role to the player seen most recently, so a lobby never hangs on someone who walked away. The role goes to a connected player when there is one; a host who leaves while nobody else is connected hands it to a player whose seat waits for them. The client of this repository sends it at most every 30 seconds while the player touches the page.

### `kick`

```json
{ "type": "kick", "player": 3 }
```

The host removes the player with this lobby number before the game starts (`R-MODE-05`). That player receives `ended` with reason `removed` and their seat is freed; every other player receives the new `lobby`. From then on, `join` from the removed player's address to this game gets `removed`, and `play` no longer sends them to it. The host cannot remove themself.

### `report`

```json
{ "type": "report", "player": 3, "reason": "abuse" }
```

Tells the operator of the server that another player of the current game misbehaves (`R-MODE-06`), in the lobby or during play. `reason` is one of `abuse` (insults or harassment), `name` (an offensive name), `cheating` and `other`; a report carries no text of its own. The server answers `reported`, and again for a player this address already reported in this game or, under any number, during the last day, which counts once. A player from the reporter's own public address gets `not_found`. One address may send 5 reports at once and one every two minutes after that, answered `too_many_reports` beyond. Nobody else is told, the reported player included. What the server keeps is in [server.md](server.md#reports-and-bans).

### `leave`

```json
{ "type": "leave" }
```

Leaves the current game for good. Before the start, the seat is freed; after it, the seat cannot be taken back. The server answers `ended` with reason `left`.

### `hash`

```json
{ "type": "hash", "tick": 1250, "hash": 3735928559 }
```

The client's 32-bit hash of its game state after running `tick`, sent for every tick that is a multiple of `HASH_INTERVAL` (50); other ticks are ignored, and so is a second hash from the same player for the same tick. Once every connected player has reported a tick, or a minute of play later, the server compares the hashes. Players whose hash differs from the majority's receive `desync`; when no majority exists, as with two players who disagree, every player who reported does. A client sending wrong hashes can only single itself out. The client of this repository computes them in its worker with the engine's `game.hash()` as it runs the turns, and sends them.

### `order`

Binary frame. An order of the local player, in the shape of the engine's `Order`:

| Order      | Fields                                          | Meaning                                                                                                             |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `spawn`    | `tile`                                          | Choose a starting tile during the spawn phase                                                                       |
| `attack`   | `target`, `troops` (`> 0`)                      | Send troops towards a tile                                                                                          |
| `retreat`  | `attack` (`> 0`)                                | Call back one of the player's attacks by its id                                                                     |
| `embark`   | `target`, `troops` (`> 0`)                      | Ship troops to a coastal tile                                                                                       |
| `build`    | `structure` (0 to 255), `tile`                  | Build a structure on one of the player's tiles: `0` city, `1` fort, `2` port, `3` silo, `4` air defense, `5` palace |
| `demolish` | `tile`                                          | Demolish one of the player's structures                                                                             |
| `ally`     | `target` (player 1 to 65535)                    | Ask for an alliance, accept one, or renew one                                                                       |
| `betray`   | `target` (player 1 to 65535)                    | End an alliance at once, as a betrayal                                                                              |
| `embargo`  | `target` (player), `on` (0, 1)                  | Start (1) or lift (0) an embargo on a player's trade                                                                |
| `warship`  | `port` (tile)                                   | Buy a warship at one of your ports                                                                                  |
| `patrol`   | `ship` (id), `tile`                             | Send one of your warships to patrol around a water tile                                                             |
| `missile`  | `target`, `size` (0 to 255)                     | Launch a missile (`0`) or a heavy missile (`1`) at a land tile                                                      |
| `gift`     | `target` (player), `troops`, `gold` (0 or more) | Send a player troops and gold                                                                                       |
| `quick`    | `target` (player), `phrase` (0 to 255)          | Send a player a preset quick message, by number                                                                     |
| `work`     | `share` (0 to 100)                              | Put a share of the troops at home to work: they earn more gold but neither attack nor defend                        |

Tiles are indexes in the map, below 2^31. The server checks only the shape of an order; whether it can be carried out is decided by the engine of every client, the same way everywhere. Orders sent outside a running game are ignored.

## Server messages

### `welcome`

```json
{ "type": "welcome", "version": 23 }
```

The hello was accepted.

### `lobby`

```json
{
  "type": "lobby",
  "game": "Xk3_9aB-q2Lm",
  "visibility": "public",
  "name": "Partie de Nico",
  "map": "world",
  "bots": 0,
  "difficulty": "normal",
  "nations": true,
  "teams": 0,
  "disabled": 0,
  "capacity": 16,
  "autoStart": true,
  "speed": 1,
  "rules": { "collapsingFronts": true, "capitals": false },
  "minPlayers": 2,
  "players": [
    { "id": 1, "name": "Nico" },
    { "id": 2, "name": "Léa" }
  ],
  "you": 2,
  "host": 1,
  "startsIn": 30000,
  "holdable": true,
  "token": "q8Vb1aV9mN3x0WcY2tLk4Q",
  "configured": 0
}
```

The game being filled, sent after every change, the host's `configure` included. `name` is the listed name of a public game, `null` for a private one. `host` is the number of the player who sets the options and starts the game. `minPlayers` is how many players `start` needs. `startsIn` is the time left before the start in milliseconds, or `null` while no countdown runs; `holdable` says whether the host can still stop it. `token` takes this seat back after a dropped connection, before the start and after; it is the same as in `started`. `configured` is the `seq` of the last `configure` from this player the server handled, applied or refused, 0 before any. `speed` is the game's pace, always 1 in a public game, and `rules` its special rules (`R-MODE-08`).

### `started`

```json
{
  "type": "started",
  "game": "Xk3_9aB-q2Lm",
  "map": "world",
  "seed": 1834567,
  "bots": 0,
  "difficulty": "normal",
  "nations": true,
  "teams": 0,
  "disabled": 0,
  "tickRate": 10,
  "speed": 1,
  "rules": { "collapsingFronts": true, "capitals": false },
  "players": [
    { "id": 1, "name": "Nico" },
    { "id": 2, "name": "Léa" }
  ],
  "you": 2,
  "token": "q8Vb1aV9mN3x0WcY2tLk4Q"
}
```

Everything a client needs to create the same game as the others: map, seed, players, the number of bots each client adds and runs itself, whether it adds the map's nations, all at `difficulty`, what the game leaves out (`disabled`), its special rules (`rules`, `R-MODE-08`), and the number of `teams`, into which every client deals humans, bots and nations in id order (`R-MODE-02`). Bots take the numbers after the last player, then nations those after the last bot, in the order of the map's manifest. The server relays only human orders. `tickRate` is the server's beats per second and `speed` the turns of each beat, so turns come `tickRate` × `speed` per second (`R-MODE-07`); a client plays them at that pace. `token` is secret: it lets this player rejoin after a dropped connection. The message is sent again after a successful `rejoin`.

### `turns`

Binary frame. One or more consecutive turns:

```json
{
  "type": "turns",
  "turns": [
    { "tick": 1250, "orders": [] },
    {
      "tick": 1251,
      "orders": [{ "player": 2, "order": { "type": "attack", "target": 81234, "troops": 3000 } }]
    }
  ]
}
```

Live play sends one turn per frame. Within a turn, orders are listed in the order the server received them, and every client applies them in that order.

### `desync`

```json
{ "type": "desync", "tick": 1250, "hash": 3735928559, "expected": 305419896 }
```

This player's hash for `tick` differed from the majority's: its game no longer matches the others. `hash` is the one this player sent, `expected` the majority's, or `null` when no majority exists. With the seed, the options and the turns the client already holds, they make a complete report of the desync. Sent once per player, and again when that player rejoins without replaying the game from the first turn.

### `ended`

```json
{ "type": "ended", "reason": "abandoned" }
```

The game is over for this connection. Reasons: `abandoned` (every player is gone), `timeout` (four hours, or a turn log grown past its size limit), `expired` (not started ten minutes after it opened), `left` (answer to `leave`), `restart` (the server restarted for an update; see [server.md](server.md#shutdown)), `removed` (the host removed this player from the lobby with `kick`).

### `error`

```json
{ "type": "error", "code": "game_full", "message": "the game is full" }
```

A request was refused; the connection stays open. `message` is for people, `code` for programs:

| Code                 | Answer to                                      | Meaning                                                                |
| -------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| `invalid_name`       | `hello`                                        | The name breaks the name rules                                         |
| `invalid_game_name`  | `create`, `configure`                          | The game name breaks the game name rules                               |
| `not_found`          | `join`, `kick`, `report`                       | No game has this id, or no other player has this number                |
| `game_full`          | `join`                                         | The game has no free seat                                              |
| `too_many_seats`     | `join`                                         | Players from this address already hold three seats of this public game |
| `removed`            | `join`                                         | The host removed a player from this address from this game             |
| `game_started`       | `join`, `configure`, `start`, `hold`, `kick`   | The game has already started                                           |
| `already_in_game`    | `play`, `create`, `join`                       | Leave the current game first                                           |
| `not_in_game`        | `configure`, `start`, `hold`, `kick`, `report` | The connection is not in a game                                        |
| `not_host`           | `configure`, `start`, `hold`, `kick`           | Only the host can change, start or hold the game, or remove a player   |
| `not_enough_players` | `start`                                        | A public game needs a second player                                    |
| `invalid_settings`   | `configure`                                    | No published map has this id, or too many bots or seats for it         |
| `too_many_games`     | `play`, `create`                               | The server holds as many games as it can                               |
| `too_many_lobbies`   | `create`                                       | This address already holds three games that have not started           |
| `token_invalid`      | `rejoin`                                       | The game is over or the seat was given up                              |
| `token_in_use`       | `rejoin`                                       | Another connection holds the seat; retry in 1 s                        |
| `restarting`         | `play`, `create`, `join`                       | The server is about to restart; try again in a minute                  |
| `too_many_reports`   | `report`                                       | This address sent too many reports lately; try again in a few minutes  |

### `reported`

```json
{ "type": "reported", "player": 3 }
```

The server received this connection's `report` of `player`.

### `maintenance`

```json
{ "type": "maintenance", "inMs": 600000 }
```

The server restarts for an update in `inMs` milliseconds. A server with a data directory keeps the games still running then and takes them back when it is up again, unless the update changes the [simulation build](#simulation-build): their pages reconnect and rejoin as after any drop. On another simulation build, the pages are sent away to reload and find the game over. Without a data directory, those games end with reason `restart`. Sent to every connection that has said `hello`, right after `welcome` to those that arrive later, and again when the server starts to drain. `inMs` is `null` when the restart was called off.

## Close codes

| Code   | Meaning                                                          |
| ------ | ---------------------------------------------------------------- |
| `1009` | A frame was larger than 1 KiB                                    |
| `1012` | The server restarted: reconnect, and rejoin a game that was kept |
| `4000` | Another protocol version or build: reload the page               |
| `4001` | A frame could not be decoded or broke a rule                     |
| `4002` | More than 20 messages per second on average, or bursts above 40  |
| `4003` | No `hello` within 10 seconds, or out of any game for 5 minutes   |
| `4004` | Another connection took over this player (reserved)              |
| `4005` | The operator banned this address: do not reconnect               |

## Binary frames

Integers are unsigned LEB128 varints: 7 bits per byte, low bits first, the high bit set on every byte but the last. Values go up to 2^53 - 1, use at most 8 bytes and must be minimally encoded. Tick 1,251 takes two bytes; an attack of 3,000 troops on tile 81,234 takes six.

The first byte of a frame gives its kind:

| Byte | Frame   | Direction        | Content                                |
| ---- | ------- | ---------------- | -------------------------------------- |
| `1`  | `turns` | server to client | first tick, turn count, then each turn |
| `2`  | `order` | client to server | one order                              |

A turn is its order count, then for each order the player number and the order. An order is its kind code followed by its fields, in this order:

| Code | Order      | Fields                     |
| ---- | ---------- | -------------------------- |
| `0`  | `spawn`    | `tile`                     |
| `1`  | `attack`   | `target`, `troops`         |
| `2`  | `retreat`  | `attack`                   |
| `3`  | `embark`   | `target`, `troops`         |
| `4`  | `build`    | `structure`, `tile`        |
| `5`  | `demolish` | `tile`                     |
| `6`  | `ally`     | `target`                   |
| `7`  | `betray`   | `target`                   |
| `8`  | `embargo`  | `target`, `on`             |
| `9`  | `warship`  | `port`                     |
| `10` | `patrol`   | `ship`, `tile`             |
| `11` | `missile`  | `target`, `size`           |
| `12` | `gift`     | `target`, `troops`, `gold` |
| `13` | `quick`    | `target`, `phrase`         |
| `14` | `work`     | `share`                    |

The table is `ORDER_KINDS` in [`orders.ts`](../packages/protocol/src/orders.ts). New orders are added at the end, so existing codes never change. A frame with trailing bytes, an unknown kind or a count larger than the rest of the frame could hold is refused. A client that receives a `turns` frame it cannot read stops and asks for a reload: skipping a turn would desynchronise its game.

A turn with 32 orders takes about a tenth of its JSON size (214 bytes against 2,059 in the protocol tests' example); an empty turn takes 4 to 6 bytes with its header, depending on the tick.

## HTTP endpoints

| Path         | Answer                                                           |
| ------------ | ---------------------------------------------------------------- |
| `/healthz`   | `ok`, with the running build in the `X-Frontfall-Version` header |
| `/api/games` | The public games, see below                                      |

`/api/games` answers `{ "games": [...], "running": n }`, where `running` counts the games under way with a player who holds a seat, which a deployment waits for. `games` lists at most 100 public games: those waiting first, the fewest free seats first, then the oldest, then those running, which cannot be joined. Each holds `id`, `name`, `host` (the host's name), `map`, `bots`, `nations`, `teams`, `disabled`, `rules`, `players`, `capacity` and `state` (`waiting` or `running`), and nothing that lets anyone take a seat. The answer carries an `ETag`: a client asking again with `If-None-Match` gets an empty `304` while nothing changed.

## Versioning

Client and server ship together in one image, so a mismatch only affects pages loaded before a deployment. Two checks catch them, both answered with close code `4000` and a reload. `PROTOCOL_VERSION` changes when a message changes shape or an order kind is added: version 2 added `retreat` and `embark`, version 3 the game options (`configure`, `bots` and `difficulty` in `lobby`, `difficulty` in `started`), version 4 the hashes in `desync`, version 5 `build` and `demolish`, version 6 `ally` and `betray`, version 7 `nations` in the game options, `lobby` and `started`, version 8 `teams` in the same three places, version 9 `embargo`, version 10 `warship` and `patrol`, version 11 `missile`, version 12 `gift` and `disabled` in the game options, `lobby` and `started`, version 13 `quick`, version 14 `token` in `lobby`, `rejoin` before the start, the `restart` reason of `ended`, the `restarting` error and `maintenance`, version 15 `5`, the palace, among the structures of `build`, version 16 `visibility` and `name` in `create` for public games of one's own, `name` in `play` and `configure`, `capacity` and `autoStart` in the game options, `hold` and `active`, and `seq` in `configure`, and `name`, `autoStart`, `minPlayers`, `holdable`, `configured` and a host for every game in `lobby`, version 17 `kick`, the `removed` reason of `ended`, and the `removed` and `too_many_seats` errors, version 18 `report` and `reported`, the `too_many_reports` error and close code `4005`, version 19 `speed` in the game options, `lobby` and `started`, with as many turns per frame, version 20 `work`, version 22 `rules`, the special rules, in the game options, `lobby` and `started`, version 23 `capitals` among them. The `build` sent in `hello` catches everything else, such as a change of the engine or the balance, which leaves the protocol as it is but would desynchronise an older page. The protocol makes no promise of compatibility between simulation builds: an older page of another one is always sent away.

### Simulation build

The simulation build names what decides how a game plays out from its turns, and nothing else: twelve hex digits of a SHA-256 over the sources of the engine and its balance (`packages/engine/src`), of the protocol (`packages/protocol/src`), the maps' data (`.bin` and `.json` in `apps/client/public/maps`) and the client's setup of a game (`apps/client/src/game/simulation.ts`: the ids, names and order of the players, the rules installed). Each file counts with its path; carriage returns in text are dropped, so every checkout gives the same value. `tools/simulation-build.mjs` computes it when the client and the server are built (`node tools/simulation-build.mjs` prints it); outside a build both sides use `dev`.

A release that changes only the interface, the server or the documentation keeps the simulation build, so the pages already open stay in their games. Snapshots ([engine.md](engine.md#snapshots)) and saved replays carry it too, and load in any release of the same simulation build. Code that changes a game's outcome belongs in one of these places; anything the client feeds to the engine that is not in a turn goes in `simulation.ts`.
