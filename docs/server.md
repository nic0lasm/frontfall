# Game server

`apps/server` is one Bun process that serves the built client, fills games with players and relays their turns. It never simulates a game ([ADR 0001](adr/0001-deterministic-lockstep.md)); the messages it exchanges with clients are described in [protocol.md](protocol.md). The container image runs it on port 8080 behind a reverse proxy ([ADR 0004](adr/0004-sub-path-hosting.md)).

## Configuration

| Variable                                                       | Default             | Meaning                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                         | `8080`              | HTTP and WebSocket port                                                                                                                                                                                                                                                                                 |
| `FRONTFALL_STATIC`                                             | `../../client/dist` | Directory of the built client                                                                                                                                                                                                                                                                           |
| `FRONTFALL_ORIGINE`                                            | unset               | Only pages from this origin may open a WebSocket, such as `https://nclsmgr.com`; several origins are separated by commas. Unset allows any                                                                                                                                                              |
| `FRONTFALL_VERSION`                                            | `dev`               | Build identifier returned by `/healthz`; the image sets it to the commit                                                                                                                                                                                                                                |
| `FRONTFALL_MAX_GAMES`                                          | `500`               | Games open or running at once                                                                                                                                                                                                                                                                           |
| `FRONTFALL_MAX_CONNECTIONS`                                    | `5000`              | Open WebSocket connections at once; further ones are closed with code `4006`, and the page says the server is full                                                                                                                                                                                      |
| `FRONTFALL_MAX_PLAYERS`                                        | `3000`              | Players seated in games at once; further `play`, `create` and `join` requests get `too_many_games`, while players of a running game still rejoin ([capacity.md](capacity.md))                                                                                                                           |
| `FRONTFALL_MAX_LOG_MIB`                                        | `192`               | Mebibytes the turn logs of every game may take together before new players are turned away the same way                                                                                                                                                                                                 |
| `FRONTFALL_GAMES_PER_ADDRESS`                                  | `10`                | Games one address may have open or be playing at once; 0 for no limit, as for a LAN party behind one router                                                                                                                                                                                             |
| `FRONTFALL_COUNTDOWN_SECONDS`                                  | `60`                | Countdown of a game opened by "Play now", from its first player; 1 at least                                                                                                                                                                                                                             |
| `FRONTFALL_DRAIN_SECONDS`                                      | `20`                | After `SIGTERM`, how long running games may go on; keep it below the container's stop grace period                                                                                                                                                                                                      |
| `FRONTFALL_DATA`                                               | unset               | Directory kept across restarts, such as `/var/lib/frontfall`: everything the server keeps is in one SQLite file there, `data.db` ([Data](#data)); without it, the usage counts, the reports and the bans live in memory only and sign-in is off                                                         |
| `FRONTFALL_SEATS_PER_ADDRESS`                                  | `3`                 | Seats players from one address may take in a public game; 0 for no limit, as for a LAN party behind one router                                                                                                                                                                                          |
| `FRONTFALL_CONNECTIONS_PER_MINUTE`                             | `30`                | WebSockets one address may open per minute on average, after a first 40 at once                                                                                                                                                                                                                         |
| `FRONTFALL_TRUST_PROXY`                                        | `true`              | `false` ignores `X-Client-IP` from every peer, for a server players reach directly from its own network, where any of them could send it                                                                                                                                                                |
| `FRONTFALL_PUBLIC_URL`                                         | unset               | Address players open, path included, such as `https://nclsmgr.com/frontfall`: Discord and Google send players back under it ([Accounts](#accounts))                                                                                                                                                     |
| `FRONTFALL_SESSION_SECRET`                                     | unset               | 32 characters or more, random and kept secret: it signs the session cookies. Another one signs every player out, and changes nothing else ([Accounts](#accounts))                                                                                                                                       |
| `FRONTFALL_OAUTH_DISCORD_ID`, `FRONTFALL_OAUTH_DISCORD_SECRET` | unset               | Client id and secret of a Discord application: sign-in with Discord ([Accounts](#accounts))                                                                                                                                                                                                             |
| `FRONTFALL_OAUTH_GOOGLE_ID`, `FRONTFALL_OAUTH_GOOGLE_SECRET`   | unset               | Client id and secret of a Google OAuth client: sign-in with Google ([Accounts](#accounts))                                                                                                                                                                                                              |
| `FRONTFALL_SMTP_FILE`                                          | unset               | JSON file of the mailbox sign-in links are sent from: sign-in by email ([Accounts](#sign-in-by-email))                                                                                                                                                                                                  |
| `FRONTFALL_EMAIL_DAILY_LIMIT`                                  | `150`               | Sign-in links sent in a day, all players together; keep it under the mailbox's own limit ([Accounts](#sign-in-by-email))                                                                                                                                                                                |
| `FRONTFALL_LOGIN_BIND`                                         | `false`             | `true` ties each sign-in link to the browser that asked for it (a 15-minute HttpOnly cookie, required at confirmation), which closes the login CSRF. It also refuses a link opened in another browser or app, as when the mail is read on a phone: the page then says to open it where it was asked for |
| `FRONTFALL_OPERATOR_ACCOUNTS`                                  | unset               | Ids of the operator's accounts, separated by commas or spaces: each may give themselves bonuses in their private games, to test ([Operator bonuses](#operator-bonuses)). Unset, no one can                                                                                                              |

### How the settings are read

`src/config.ts` describes every variable above with a zod schema, and `src/main.ts` reads the environment through it before anything starts.

- A variable that is unset or empty (as `${FRONTFALL_ORIGINE:-}` leaves it in a compose file) takes its default.
- A variable that is set but wrong stops the start with status 1. The server logs one `config_invalid` error that lists every wrong variable, not the first, and never repeats the value of a secret: `{"level":"error","event":"config_invalid","count":2,"problems":"PORT: must be a whole number from 0 to 65535, not \"http\"; FRONTFALL_TRUST_PROXY: must be true or false, not \"yes\""}`. Wrong means: a count (`PORT`, the `*_MAX_*` and `*_PER_ADDRESS` limits, `FRONTFALL_EMAIL_DAILY_LIMIT`) that is not a whole number of 0 or more; a duration or size (`*_SECONDS`, `FRONTFALL_CONNECTIONS_PER_MINUTE`, `FRONTFALL_MAX_LOG_MIB`) that is not a number of 0 or more; a flag (`FRONTFALL_TRUST_PROXY`, `FRONTFALL_LOGIN_BIND`) that is not `true` or `false`; an address (`FRONTFALL_PUBLIC_URL`) that is not an `http` or `https` URL; an origin in `FRONTFALL_ORIGINE` with a path or a trailing slash, which no browser would ever send; a `FRONTFALL_SESSION_SECRET` under 32 characters; and a service with only one of its id and its secret.
- A feature with nothing set up is off, as it always was. Sign-in with a service or by email that is set up but cannot run, because `FRONTFALL_PUBLIC_URL` or `FRONTFALL_SESSION_SECRET` is missing, is turned off with one `accounts_off` warning. A mailbox file that cannot be read turns sign-in by email off with one `email_sign_in_off` warning: the file is not an environment variable, so the server still starts.
- An error that nothing caught, or a promise rejected with no one waiting, is logged as `uncaught_exception` or `unhandled_rejection` (with the message and the stack) and the process exits with status 1, so that the container restarts.

## Games

| Setting                        | Value                              | Notes                                                                                                                                     |
| ------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Players per game               | 2 to 16, set by the host           | A game set to start when full (the default) starts as its last seat is taken                                                              |
| Players to start a public game | 2                                  | The host starts it; any number for a private game                                                                                         |
| "Play now" countdown           | 60 seconds                         | From the first player, 30 s at least after the second; alone at the end, the map's default bots fill in                                   |
| Host away                      | 2 minutes                          | With other players waiting, the role goes to the one seen most recently                                                                   |
| Seat kept after a drop         | 5 minutes                          | The player rejoins with their token and every missed turn                                                                                 |
| Lobby seat kept after a drop   | 30 seconds                         | The player gets their place back, and the host keeps the role (see below)                                                                 |
| Longest game                   | 4 hours                            | Then the game ends with reason `timeout`                                                                                                  |
| Games at once                  | 500                                | Further `play` and `create` requests get `too_many_games`                                                                                 |
| Players at once                | 3000                               | Further `play`, `create` and `join` requests get `too_many_games`; a seat taken back with `rejoin` is always served                       |
| Turn log of one game           | 16 MiB                             | Then the game ends with reason `timeout`; a busy 4-hour game logs about 2 MiB                                                             |
| Bots in a game                 | 25                                 | Seats shrink to fit the map's `players.max`, never below the players present                                                              |
| Game not started               | 10 minutes after it opened         | Then the game ends with reason `expired`                                                                                                  |
| Lobbies per address            | 3 not yet started                  | Public and private; further `create` requests get `too_many_lobbies`                                                                      |
| Seats per address              | 3 in a public game                 | Private games have none; further `join` requests get `too_many_seats`, and "Play now" looks for another game                              |
| Removed players                | Until the game starts              | The host removes a player with `kick`; their address then gets `removed` from that game                                                   |
| Public games listed            | 100                                | Waiting ones first, the fewest free seats first, then the oldest                                                                          |
| Games per address              | 10 (`FRONTFALL_GAMES_PER_ADDRESS`) | Games an address opened and still plays in, waiting or running; further `create`, and `play` with no game to join, get `too_many_lobbies` |

A connection that drops without a close frame, as when a phone goes to sleep or the network fails, keeps its seat in a lobby for 30 seconds: the client takes it back with the token of the `lobby` message, or lands in the game if it started meanwhile. A page that closes its socket itself, on a reload or when the tab closes, gives its lobby seat up at once.

A game is freed as soon as it ends: when its last player leaves before the start, when it has not started ten minutes after it opened, when every player has been gone for five minutes, or at the time limit. Its turn log, about one byte per quiet tick, goes with it.

All running games share one timer that closes a turn of each every 100 ms. It runs ten passes a tick, on a fixed schedule, each over a tenth of the games, so that the sends of thousands of players never hold the server for long at once. The `frontfall_turn_duration_seconds` histogram measures how long one pass takes.

Orders are limited over the whole game as well as per turn: a player has a burst of 30 and 6 orders a second after it, which is more than a hand keeps up for long and less than a script sends. What comes past is dropped, never queued, and counted in `frontfall_throttled_orders_total`; the log says `orders_throttled` for a player at their first dropped order and again at the fiftieth, with the game and the player number, never an address. A burst of dropped orders alone is a person clicking fast; a count that keeps climbing is a script. The limit does not change a game: the dropped orders never reach a turn, so a record replays the same.

A player who rejoins gets the turns they missed one frame of 2000 turns at a time, the next once the last has gone out to the network. A connection that leaves more than 4 MiB unread, such as a tab asleep on a stalled network, is dropped and counted in `frontfall_slow_clients_total`: the page rejoins from its last turn.

Games offer the maps listed in `maps/index.json` of the built client, read once at start. Without that file, only the default map, World, can be picked.

## Limits

One bad client must not spoil a game or the server. Each limit closes the offending connection with a code listed in [protocol.md](protocol.md#close-codes) and is counted in `frontfall_rejected_messages_total`.

| Limit                       | Value                                                         | On breach                                                                 |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Connections in all          | 5000                                                          | Upgrade refused with `503`                                                |
| Connections per address     | 16, for players behind one router or mobile carrier           | Upgrade refused with `429`                                                |
| New connections per address | 30 a minute, bursts of 40                                     | Upgrade refused with `429`                                                |
| Frame size                  | 1 KiB                                                         | Closed with `1009`                                                        |
| Messages per connection     | 20 per second, bursts of 40                                   | Closed with `4002`                                                        |
| Invalid frame               | any frame that fails decoding or checks                       | Closed with `4001`                                                        |
| Time to say `hello`         | 10 seconds                                                    | Closed with `4003`                                                        |
| Time out of any game        | 5 minutes after `hello` or the last game                      | Closed with `4003`                                                        |
| Silence                     | a ping unanswered for 12.5 seconds; pings go every 25 seconds | Connection dropped                                                        |
| Unread output               | 4 MiB waiting to be sent to a client that stopped reading     | Connection dropped                                                        |
| Orders per player           | 10 per turn                                                   | Further orders of the turn are dropped                                    |
| Order rate per player       | 6 a second, with a burst of 30                                | Orders past it are dropped, counted in `frontfall_throttled_orders_total` |
| Turn log of a game          | 64 MiB                                                        | Game ends with `timeout`                                                  |

The address of a player is the `X-Client-IP` header, which the reverse proxy must set and overwrite. The server believes that header only when the connection itself comes from a private or loopback address, as a proxy on the same host or Docker network does; from any other peer the header is ignored and the TCP peer address is used. A value that is not an IP address is ignored too. An IPv6 player counts by its /64, the block one home or server is given, for every limit per address and for bans: banning `2001:db8:0:1::5` bans `2001:db8:0:1::/64`, which the ban list also takes as written. Player names follow the rules in [protocol.md](protocol.md#hello).

## Reports and bans

A player can report another one of the same game from their menu, with one reason out of four (`R-MODE-06`, [protocol.md](protocol.md#report)). The server never acts on reports by itself: they are for the operator to read. A report holds its time, the game, the reason, the number and name the reported player played under, and two references: one for the address of the reporter, one for the address of the reported player. A reference is a keyed hash of the address, 16 characters long. The key is drawn once and kept in `data.db`, so the same address keeps the same reference across restarts, while nobody without the key can link a reference to an address. Reports are kept 30 days, 500 at most and 20 about one address, the oldest dropped first, in `data.db`, written a second after the last one. One address sends 5 reports at once and one every two minutes after that. A report counts once per game and player, and once a day per pair of addresses, so one angry player cannot pile reports on another across games. Players of one public address cannot report each other: they share one reference. Players of one private address, on a LAN without a proxy, can. Bans that ran out leave `data.db` the next time the list is written.

The ban list, in `data.db`, names addresses or references, each banned until a date or for good. A banned address cannot connect: its WebSocket closes with code `4005` and the page says the operator banned the network. A ban takes effect at once, on the connections already open too, without a restart. Mind that one address can be a whole household, a school, or many phones of one mobile carrier: prefer a ban of a few days.

From the host, inside the container (the name may differ on yours):

```sh
admin() { docker exec frontfall-frontfall-1 bun -e "fetch('http://127.0.0.1:8080/admin/'+process.argv[2],{method:process.argv[1]}).then(async(r)=>console.log(r.status,await r.text()))" "$@"; }
admin GET 'reports?days=7'                            # newest first, then the players most reported
admin POST 'bans?target=Jm0pQ2xvd2Zy4kTe&days=7&note=insults'  # a reference from a report, for 7 days
admin POST 'bans?target=203.0.113.7'                  # an address, for good
admin DELETE 'bans?target=203.0.113.7'                # lifts it
admin POST bans                                       # reads the ban list in data.db again
admin GET bans
```

`/admin/reports` gives `reports`, newest first, and `targets`: for each reference reported, the number of reports and of different addresses that sent them, the names used, the reasons and whether it is banned. A ban added this way is written to `data.db`.

`frontfall-admin`, in the container, does the same without a running server, and replaces editing `bans.json` by hand. A ban it adds or lifts is read at once by a running server, which closes the connections it now bans; a stopped one reads it at its start:

```sh
docker exec frontfall-frontfall-1 frontfall-admin bans list
docker exec frontfall-frontfall-1 frontfall-admin bans add Jm0pQ2xvd2Zy4kTe --days 7 --note insults
docker exec frontfall-frontfall-1 frontfall-admin bans add 203.0.113.7       # for good
docker exec frontfall-frontfall-1 frontfall-admin bans remove 203.0.113.7
docker exec frontfall-frontfall-1 frontfall-admin reports list --days 7
```

A ban list that does not read, as a row changed by hand, is refused with `422` and the bans in force stay as they were; at start, the server then runs with no ban and logs `bans_not_loaded`. Without a data directory, reports and bans live in memory, and the references change at every start.

## Data

With `FRONTFALL_DATA`, the server keeps everything in one SQLite file there, `data.db`: the accounts, the ban list, the reports and the key of their references, the usage counts and the error groups, and the games running at a restart. It is in WAL mode, so SQLite keeps `data.db-wal` and `data.db-shm` beside it while the server runs; all three are readable by the server's user only (`0600`). The schema carries its version, and a newer server brings an older file up to date at its start. An older server, or an older `frontfall-admin`, does not open a file from a newer release: it stops with `database_too_new`, naming both versions. Only the monthly files of the usage counts stay files (`usage/months/`), written for collecting.

**From the JSON files of releases up to 1.0.** The first start of this release imports, once, every JSON store it finds in the data directory: `accounts/accounts.json`, `moderation/key`, `moderation/bans.json`, `moderation/reports.json`, `usage/usage.json` (or its `.bak` copy, as those releases fell back on it, also when `usage.json` cannot be read), `usage/errors.json` and `games/*.json`. Each file read is renamed with `.imported` and kept as it was, and the log has one `store_imported` line per store. Every store is read and checked before anything is written: one that exists and does not read, even from its copy, stops the start with `import_failed`, naming the file, rather than start without it. Fix the file, or move it out of the data directory to start without that store. A ban list that gives one target twice, as an address and its `::ffff:` form or two addresses of one IPv6 `/64`, keeps the ban that lasts longest, since those releases banned the target while either ran. Files the old releases set aside (`.broken`, `.before-merges`) are left as they are. To undo the import, stop the server, rename the `.imported` files back and move `data.db` away.

The import runs at the first start on a new `data.db`, and again only while it has not got through, as after an `import_failed`. Once through, it marks every store as done, found or not. A JSON file of a store that shows up at a later start, from an old backup put back in the volume or written by an older release after a rollback, is never read, so it cannot replace the bans, the accounts' salt or the key of the references in `data.db`. The server logs `store_not_imported` for each such file at every start until it is moved away. If the server stopped between the import and the renames, the next start renames the files it read, when their bytes are still the same.

**`frontfall-admin`**, in the image, works on `data.db` beside the server (`FRONTFALL_DATA`, or `--data <dir>`): `bans list`, `bans add <target> [--days N] [--note TEXT]`, `bans remove <target>`, `reports list [--days N]` and `backup <file>`. `backup` writes a consistent copy with SQLite's `VACUUM INTO`, while the server runs, to a file that must not exist yet, readable by its owner only. Copy that file, never `data.db` itself: a copy of the live file can catch a page half written, or leave out what is still in `data.db-wal`. To restore, stop the server, put the copy in place as `data.db`, remove `data.db-wal` and `data.db-shm`, give it to the server's user (uid 1000 in the image) and start again.

## Logs

The server writes one JSON object per line on standard output, read with `docker logs`:

```json
{
  "time": "2026-10-23T21:40:12.031Z",
  "level": "info",
  "event": "game_started",
  "game": "Xk3_9aB-q2Lm",
  "visibility": "public",
  "players": 5
}
```

| Event                 | Level | Fields                                                                                         |
| --------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| `server_started`      | info  | `port`, `version`                                                                              |
| `server_stopping`     | info  |                                                                                                |
| `game_started`        | info  | `game`, `visibility`, `players`                                                                |
| `game_finished`       | info  | `game`, `reason`, `ticks`                                                                      |
| `player_rejoined`     | info  | `game`, `player`, `from`                                                                       |
| `desync`              | warn  | `game`, `tick`, `hash` (the player out of step), `expected` (the majority's, or `null`)        |
| `connection_rejected` | warn  | `client`, `reason`                                                                             |
| `client_error`        | warn  | `type`, `release`, scrubbed `message`, [`group`](#errors-of-players); 60 an hour, at most      |
| `game_saved`          | info  | `game`, `ticks`: kept for the next run, at a restart                                           |
| `game_not_saved`      | warn  | `game`, `error`: the game ends with reason `restart` instead                                   |
| `game_restored`       | info  | `game`, `ticks`: taken back from the last run                                                  |
| `game_not_restored`   | warn  | `file`, `reason`: `simulation` for another simulation build, or `unreadable`                   |
| `usage_in_memory`     | warn  | `reason`: no data directory, the usage counts are lost at the next restart                     |
| `usage_not_loaded`    | warn  | `error`: the counts kept by the last run could not be read                                     |
| `usage_month_bad`     | warn  | `error`: a month file was set aside                                                            |
| `usage_not_saved`     | warn  | `error`                                                                                        |
| `player_reported`     | info  | `game`, `player`, `reason` ([Reports and bans](#reports-and-bans))                             |
| `player_banned`       | info  | `days`, `null` for good                                                                        |
| `ban_lifted`          | info  |                                                                                                |
| `bans_reloaded`       | info  | `bans`: entries now in force                                                                   |
| `bans_not_loaded`     | warn  | `error`: the ban list in `data.db` does not read; the server starts with no ban                |
| `accounts_off`        | warn  | `reason`: sign-in is set up but cannot run                                                     |
| `email_sign_in_off`   | warn  | `reason`: the SMTP file cannot be used                                                         |
| `store_imported`      | info  | `store`, `files`, `rows`: a JSON store of an earlier release, now in `data.db` ([Data](#data)) |
| `store_not_imported`  | warn  | `store`, `file`: a JSON file of a store `data.db` already holds, left unread ([Data](#data))   |
| `import_failed`       | error | `store`, `file`, `error`: a JSON store does not read; the process exits with status 1          |
| `database_too_new`    | error | `schema`, `known`: `data.db` is from a newer release; the process exits with status 1          |
| `config_invalid`      | error | `count`, `problems`: a setting is wrong; the process exits with status 1                       |
| `uncaught_exception`  | error | `error`, `stack`: the process exits with status 1                                              |
| `unhandled_rejection` | error | `error`, `stack`: the process exits with status 1                                              |

Client addresses never appear in clear. `client` is a keyed hash of the address: stable while the process runs, so repeated abuse from one address can be spotted, and impossible to link to the address or across restarts, because the key is drawn at random on start. Player names are not logged.

## Metrics

`GET /metrics` returns the metrics in the Prometheus text format. It answers only requests that reach the server directly from a private or loopback address: any other request, and any request carrying `X-Client-IP`, `X-Forwarded-For`, `Forwarded`, `X-Real-IP` or `CF-Connecting-IP`, which every reverse proxy adds, gets `404`. On the production host:

```sh
curl -s localhost:8080/metrics
```

| Metric                                                | Type      | Meaning                                                                                                      |
| ----------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `frontfall_games{state}`                              | gauge     | Games `open`, `starting` (counting down) and `running`                                                       |
| `frontfall_players`                                   | gauge     | Players seated in a game with an open connection                                                             |
| `frontfall_connections`                               | gauge     | Open WebSocket connections                                                                                   |
| `frontfall_games_started_total{visibility,map,teams}` | counter   | Games that started                                                                                           |
| `frontfall_games_finished_total{reason}`              | counter   | Games that finished: `abandoned`, `timeout`, `expired`, `empty`                                              |
| `frontfall_desyncs_total`                             | counter   | Games in which a client's state hash differed from the majority's                                            |
| `frontfall_rejoins_total`                             | counter   | Players who took their seat back after a dropped connection                                                  |
| `frontfall_messages_received_total`                   | counter   | Messages received from clients                                                                               |
| `frontfall_rejected_messages_total{reason}`           | counter   | Connections closed: `invalid`, `oversized`, `rate_limited`, `idle`, `banned`                                 |
| `frontfall_reports_total{reason}`                     | counter   | Reports of a player by another                                                                               |
| `frontfall_game_duration_minutes`                     | histogram | Length of the games that finished                                                                            |
| `frontfall_turn_duration_seconds`                     | histogram | Time of one pass of the turn timer, a tenth of the games                                                     |
| `frontfall_refused_connections_total{reason}`         | counter   | Players turned away: `connections` (code `4006`), `players` (`too_many_games` while full), `address` (`429`) |
| `frontfall_slow_clients_total`                        | counter   | Connections dropped for leaving 4 MiB unread                                                                 |
| `frontfall_throttled_orders_total`                    | counter   | Orders dropped for coming faster than a person plays (6 a second after a burst of 30)                        |
| `frontfall_usage_total{dimension,value}`              | counter   | Reports of players' pages ([privacy.md](privacy.md))                                                         |
| `process_resident_memory_bytes`                       | gauge     | Resident memory of the process                                                                               |
| `process_cpu_seconds_total`                           | counter   | CPU time used by the process                                                                                 |

## HTTP routes

| Path                   | Answer                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/healthz`             | `ok`, or `503` (see below), with the build in the `X-Frontfall-Version` header and the release in `X-Frontfall-Release`                                                                        |
| `/api/games`           | Public games that have not started, and the number of games running, as JSON                                                                                                                   |
| `/status`              | A page for people: players online, games running, lobbies, an announced restart, release and build                                                                                             |
| `/api/status`          | As JSON: `version`, `release`, `simulation`, `keepsGames`, `state`, `players`, `running`, `lobbies`, `restartInMs`, `startedAt`                                                                |
| `/admin/maintenance`   | `POST ?minutes=N` announces a restart in N minutes to every player, `0` calls it off; from inside the container only                                                                           |
| `/admin/reports`       | `GET ?days=N`: the reports of the last N days, 30 at most; from inside the container only ([Reports and bans](#reports-and-bans))                                                              |
| `/admin/bans`          | `GET` lists the bans, `POST` adds one or reads the file again, `DELETE` lifts one; from inside the container only                                                                              |
| `/admin/errors`        | `GET ?days=N`: players' errors of the last N days, grouped; from inside the container only ([errors](#errors-of-players))                                                                      |
| `/api/stats`           | Usage counts per day and in total, as JSON ([privacy.md](privacy.md)); the last 7 days are also on `/status`                                                                                   |
| `/api/usage`           | `POST` only: a report of a player's page ([privacy.md](privacy.md)); `204`, or `400`, `403`, `413`, `415`, `429`                                                                               |
| `/api/me`              | The services offered and the account signed in, as JSON; `POST {"name"}` renames it, `DELETE` deletes it ([Accounts](#accounts))                                                               |
| `/api/me/achievements` | `POST` only: the page's achievements, kept with the account; answers with them all ([Accounts](#achievements-of-an-account))                                                                   |
| `/api/me/merge`        | `POST {"merge"}` only: merges, or not, the other account a way just added leads to ([Accounts](#several-ways-to-sign-in))                                                                      |
| `/api/me/unlink`       | `POST {"method"}` only: takes a way to sign in off the account, never the last                                                                                                                 |
| `/auth/<service>/link` | `POST` only, from the game's page, signed in: answers where to go to add the service to the account                                                                                            |
| `/auth/<service>`      | Sends the player to sign in with `discord` or `google`; the service sends them back to `/auth/<service>/callback`                                                                              |
| `/auth/email`          | `POST {"email", "name", "language", "link"}` only: sends a sign-in link, or with `link` one that adds the address to the account; `202` whoever the address is ([Accounts](#sign-in-by-email)) |
| `/auth/email/confirm`  | `POST {"token"}` only: signs in the player who opened the link, once                                                                                                                           |
| `/auth/logout`         | `POST` only: signs the player out                                                                                                                                                              |
| `/metrics`             | Metrics, from the host only                                                                                                                                                                    |
| `/ws`                  | WebSocket upgrade                                                                                                                                                                              |
| anything else          | Files of the built client                                                                                                                                                                      |

HTML, scripts, styles, JSON, SVG and map files (`.bin`) of 1 KiB or more are sent gzipped to browsers that accept it, with `Vary: Accept-Encoding`. Each file is compressed once, on its first request. Every file carries an `ETag` drawn from its content; maps and other files without a hashed name are sent with `no-cache`, so browsers revalidate them and get `304 Not Modified` until they change. Caddy and Cloudflare pass the compressed body on, and would not compress `.bin` files themselves.

## Accounts

Players may sign in with Discord, Google or a link sent by email to keep their name and achievements for themselves. It is optional: everything is played as a guest too, and a server without the settings below offers no sign-in at all (the menu shows no button).

The server needs `FRONTFALL_DATA`, `FRONTFALL_PUBLIC_URL`, `FRONTFALL_SESSION_SECRET`, and the id and secret of at least one service or a mailbox ([below](#sign-in-by-email)). It does the OAuth 2.0 exchange itself, with a `state` and PKCE: the page only follows a link to `/auth/<service>`, and the service sends the player back to `/auth/<service>/callback`, where the server trades the code for a token, asks the service who the player is, and forgets the token. Discord is asked for `identify` only, Google for `openid profile`. The server must be able to reach `discord.com`, `oauth2.googleapis.com` and `openidconnect.googleapis.com`.

The player then holds a `frontfall_session` cookie for 30 days: `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, limited to the path of the public address, so that two games under one domain keep apart. It is signed with the session secret and holds only the account's id, its count of sign-outs and its expiry: signing out ends the account's sessions on every device. It goes with every request, the game socket included: a connection opened signed in plays under the account's name, whatever its `hello` says, and a guest who asks for a name an account holds gets `invalid_name` ([protocol](protocol.md#hello)). Two names are the same name when they differ only by case, accents, spaces or punctuation.

The accounts are kept in `data.db` ([Data](#data)), one row each, written in one transaction on every change. The database keeps a salt of 256 random bits, drawn at the first start; each account is an id, the service, an HMAC of the service's id keyed by that salt, the name, the days it was created and last signed in, and its count of sign-outs. Nothing else from the service is kept: no email, no picture, not the name there, which only suggests the first name. The accounts depend on no setting: back up `data.db` and they come back with it. Accounts that cannot be read, as a database that does not open or a row that is not an account, turn sign-in off until it is fixed (`accounts_off` in the log), rather than be written over. A player deletes their account from the menu; nothing of it is left in the database.

One address may make 20 requests to `/auth/` and `/api/me` at once, then one every 6 seconds; beyond, `429`. Sign-in failures are logged as `sign_in_failed` with the service and a reason, never an id.

Releases up to 1.0 kept the accounts in `accounts/accounts.json`. The first start of this one imports that file into `data.db` and renames it `accounts.json.imported`, unchanged; an older release does not read `data.db`. To go back to one, stop the server, rename the `.imported` files back, and keep `data.db` aside until you return: accounts made since are only in it. Back on this release with that `data.db`, what the older release wrote meanwhile is not read: the server logs `store_not_imported` for each of its files, which you then move away.

### Sign-in by email

With `FRONTFALL_SMTP_FILE`, the menu also offers **Sign in with email**: no password, a link that works once, for 15 minutes. The file is the JSON of a mailbox, the same as other services of a server may already read:

```json
{
  "hote": "ssl0.ovh.net",
  "port": 465,
  "utilisateur": "game@example.org",
  "motDePasse": "…",
  "expediteur": "game@example.org"
}
```

Port 465 is TLS from the start, 587 STARTTLS; both require TLS 1.2 and a valid certificate. Other fields are ignored. A file that cannot be read, or a wrong field, turns sign-in by email off with `email_sign_in_off` in the log, which names the field but never its value. The server must reach the mailbox's host on that port.

`POST /auth/email` takes the address the player typed, lowercased. It answers `202` whether or not an account has it, and whether the link was sent or held back: nobody can learn from it who plays here. The server draws a token of 256 random bits, keeps only its SHA-256 hash, with the HMAC of the address and the name typed in the menu, for 15 minutes in memory, and sends `<public address>/#signin=<token>`. The token is after `#`, so it never reaches a server's logs. The page asks the player to press **Finish signing in**, so that a mail filter that opens links signs nobody in, and posts the token to `/auth/email/confirm`: the first use deletes it and sets the session cookie. The account is found by the HMAC of the address, made on that first use if there is none; the address itself is kept nowhere, neither in the file nor in the logs, where a send shows as `sign_in_link_sent` or `sign_in_link_failed` with the SMTP code only. A restart forgets the links not yet used.

Limits: one address may ask for 3 links, then one every 5 minutes (`429`); one email address gets 2 links, then one an hour and at most 3 a day, the others held back without a word; and the server sends `FRONTFALL_EMAIL_DAILY_LIMIT` links a day in all, then answers `503` until the next day (UTC), logged once as `sign_in_links_held`. An account made by email is not the account of the same address at Google: the game never asks Google for it.

### Several ways to sign in

A signed-in player may add the other services, or an address, to their account from the menu's profile card, and then sign in with any of them. Nothing is ever joined by itself: the game never learns a player's address from Google or Discord, so two ways become one account only when the player, signed in, goes through the other one.

- A service is added by `POST /auth/<service>/link`, from the game's page only (the `Origin` is checked, so no other site can start it). The server answers where to go, with the sign-in cookie, and the page goes there; back at `/auth/<service>/callback`, the service is added to the account still signed in in that browser, the one that asked, and to no other.
- An address is added by `POST /auth/email` with `"link": true`, signed in. The email names no account, and its link only finishes in a browser signed in to that account (`403` elsewhere, and the link is spent): the owner of an address cannot be led to hand it to someone else's account.
- When the way added already leads to another account, nothing changes yet: `/api/me` names that account (`merge`), and the page asks the player whether to merge it, saying which name stays and which is freed. On yes (`POST /api/me/merge {"merge": true}`), the account signed in keeps its id, name and sessions, and takes the other's ways to sign in, achievements (merged as below), the earlier day of creation and the ids of the accounts merged into it. The other account goes away with its sessions, and its name becomes free. The server logs `accounts_merged` with both ids and the service. Before the first merge it ever does, it keeps the accounts as they were, in the form of the file of the earlier releases, in `data.db` (the `accounts.before-merges` document), kept as it is after that. A question not answered within 10 minutes, or a restart, drops the merge.
- `POST /api/me/unlink {"method"}` takes a service or the address off the account, all of that kind, as long as another way is left (`409` for the last). Signing in again that way then makes a new account.

Each account keeps the first way it was made with, and the others in `links`, each the service and the HMAC of its id; merged accounts leave their ids in `mergedIds`. The file's version does not change: a release before this one reads it and keeps those fields, but only the first way of each account signs in to it there, the others making new accounts.

### Achievements of an account

Signed in, the menu posts the device's achievements to `/api/me/achievements` (8 KiB at most) and keeps what comes back, so that they follow the player. The server adds them to the account's: each achievement keeps its higher level and earlier day, each count its larger value, and nothing is ever taken away; at most 64 achievements and 8 counts, with ids of lowercase letters, digits and dashes. Two devices played apart between two visits to the menu keep the larger count, not their sum. They are counted by the page, as before: an account only carries them. Deleting the account deletes them.

## Operator bonuses

The operator of a server may want to try a long game, a late-game structure or a balance change without playing an hour to afford it. `FRONTFALL_OPERATOR_ACCOUNTS` lists the ids of their accounts ([Accounts](#accounts)), or of accounts merged into them, separated by commas; a player signed in to one of them, host of a private game, then sees "Operator's test" among the lobby's settings (`R-MODE-09`, [protocol](protocol.md#configure)), with four boxes: double gold (from troops, workers and the base income), double troops (population cap and growth), structures at half price, and double defense (their land costs twice the troops to take). Each ticked box applies to that player alone, never to anyone else, for the whole game.

They are never offered in a public game or "Play now", nor to a guest, nor by name: only the signed-in account counts, so nobody can claim them by taking a name. They are not hidden from the other players either: the lobby and the end screen of that game say who has which, and the game counts towards no player's statistics or achievements. Every client simulates the bonuses, as they are part of the game's setup (`operatorBonuses` in `started`), so they change no rule of other games, and a game without them plays and hashes as it did before they existed. The server logs `operator_bonuses` with the game's id and the bonuses when they are set, and `server_started` gives the number of operator accounts it read.

An account's id is in `data.db`, next to the service it signs in with, the name it plays under and the day it last signed in. From the host, inside the container (the name may differ on yours):

```sh
docker exec frontfall-frontfall-1 bun -e 'const db=new (require("bun:sqlite").Database)(process.env.FRONTFALL_DATA+"/data.db",{readonly:true});for(const {body} of db.query("SELECT body FROM accounts").all()){const a=JSON.parse(body);console.log(a.id,a.provider,new Date(a.seenAt).toISOString().slice(0,10),a.name)}'
```

Set `FRONTFALL_OPERATOR_ACCOUNTS` to those ids in the container's environment, and restart it.

## Health check

`/healthz` answers `200 ok` while the turn timer runs. The timer runs whether or not any game is in progress, so an idle server is healthy. It answers `503 stalled` when no turn has been closed for 5 seconds, and `200 ok` again from the next turn, and `503 stopping` to requests still in flight while it shuts down. A blocked event loop does not answer at all, which a check with a timeout reports as well. The deployment waits for this route, the image's `HEALTHCHECK` polls it, and an external uptime check alerts on it: Better Stack requests it from outside every 3 minutes and emails the maintainer when it fails, so an outage is known within about 6 minutes. What to do then is in [operations.md](operations.md). Docker only marks an unhealthy container as such; it does not restart it.

## Shutdown

Games live in memory, so a restart would cut them short. Four things keep that from happening:

1. **The deployment announces the update, then waits.** Before rolling out a new image, the Publish workflow reads `running` from `/api/games`, the games started with a player connected or away but still holding a seat. If some are running and the server reports in `/api/status` that it keeps its games, with the same simulation build as the new image, it deploys at once: the games are kept across the restart (below). Otherwise, it asks the server, through its deploy command, to announce the update in 10 minutes (`ANNONCE_MINUTES`): every page shows a band counting the minutes down, players who arrive meanwhile included. Then it waits for `running` to reach 0, for those 10 minutes at most. A server that does not answer counts as one with games running: the workflow announces and waits as well. Run the workflow by hand with `now` ticked to deploy at once.
2. **The server drains.** On `SIGTERM` it stops opening games: `play`, `create` and `join` get the error `restarting`, while players of a running game can still `rejoin`. Lobbies end at once with reason `restart`. Running games play on until their players leave or lose their seat, for `FRONTFALL_DRAIN_SECONDS` at most, and their players see the band with the time left; `/healthz` answers `503 stopping` meanwhile. A server with a data directory does not drain: it keeps its games at once (below).
3. **Games still running are kept.** With a data directory (`FRONTFALL_DATA`, reported as `keepsGames` in `/api/status`), the server writes at once each game still running with a player to `data.db`: the seed, the settings, the seats with their names and reconnect tokens, and the turn log, with the [simulation build](protocol.md#simulation-build). Nothing the clients compute is in it: they rebuild the game from its turns as on any rejoin, so the server never keeps a state the players have not agreed on. Like the rest of `data.db`, they are readable by the server's user only. The players are not told the game ended: every WebSocket closes with code `1012`, and the pages try again until the server is back.
4. **The next run takes them back.** On start, the server reads every saved game and deletes it, whether it loads or not. A game of the same simulation build runs again from its last turn, every seat waiting for its player as after a dropped connection: the pages reconnect, rejoin with their token and receive the turns they missed. The time limit goes on where it was, and the minutes the server was down count for nothing. A game of another simulation build would desynchronise and is dropped (`game_not_restored`), like a save that does not read; its players reconnect, are sent away to reload, and find the game over. Without a data directory, or when a save cannot be written, the game ends with reason `restart` and the page says it was stopped for an update.

The process exits 5 seconds after the drain at the latest. A second `SIGTERM` or `SIGINT` exits at once. With the default 20 seconds, a drain fits within the 30-second stop grace period of the production host; a longer drain needs a longer grace period, or Docker kills the process before players are told.

## Errors of players

Each error a page reports ([privacy.md](privacy.md#reports)) goes into a group: the same kind of error, with the same scrubbed message, from the same place in the game's code (file, line and column of the built script). A group counts its reports per day, and how many came from each release, browser family, kind of device and screen (menu, lobby, solo, online, replay); nothing in it tells pages apart. The server keeps 300 groups for 30 days, dropping the one reported longest ago first, in `data.db` beside the usage counts, saved with them; groups that do not read are set aside as the `errors.broken-<time>` document.

`/admin/errors` lists the groups of the last 7 days, the most reported first, with the same `admin` function as for [reports](#reports-and-bans):

```sh
admin GET errors                # the last 7 days
admin GET 'errors?days=30'      # everything kept
```

```json
{
  "days": 7,
  "groups": [
    {
      "id": "3f9c0a1b2c4d",
      "type": "exception",
      "message": "Cannot read properties of undefined (reading <text>)",
      "where": "game-screen-DUPHboWD.js:1:20345",
      "recent": 12,
      "total": 15,
      "first": "2026-10-27",
      "last": "2026-10-29",
      "releases": { "0.8.0": 15 },
      "browsers": { "safari": 11, "chromium": 4 },
      "devices": { "phone": 12, "desktop": 3 },
      "screens": { "online": 15 }
    }
  ]
}
```

`where` names a file of the release's build: `bun run build` at that release's tag gives the same file, and the line and column point into it. The `client_error` lines of the log carry the same `group`. `errors` on `/status` and in `/api/stats` count the reports by kind only.

## Usage counts

With `FRONTFALL_DATA`, `data.db` holds the counts, saved every 5 minutes and at the stop, in one transaction with the error groups. Counts that do not read are set aside as the `usage.broken-<time>` document and the server starts from none. Releases up to 1.0 kept them in `usage/usage.json`, with the save before as `usage.json.bak`: the first start imports the file, or the copy when the file is damaged or missing, as those releases fell back on it.
`usage/months/2026-10.json` holds one month: `{ "version": 1, "month": "2026-10", "days": { "2026-10-25": { dimension: { value: count } } } }`. A monthly file is added to and never cut down: a day keeps the larger of the file's figures and the server's, and a file that cannot be read is set aside as `.broken-<time>`.

## Code layout

`createGameServer` (`src/server.ts`) only builds the parts and wires them; each concern has its own module in `apps/server/src`.

| Module                              | Concern                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config.ts`, `main.ts`, `crash.ts`  | The environment read through a zod schema, the options built from it, the start and the process-level handlers                                                                                                                                                                                                                                                                       |
| `http/routes.ts`                    | An ordered route table. The order is part of the behavior: `/healthz` and `/api/usage` answer any method, the admin routes only a request from inside the container, and everything after the `methods` step is read-only. `test/routes.test.ts` pins the status of each path and method                                                                                             |
| `http/admin.ts`                     | The routes under `/admin/`                                                                                                                                                                                                                                                                                                                                                           |
| `ws/admission.ts`                   | Whether a request to open a WebSocket is let in: path, origin, room on the server, room for the address                                                                                                                                                                                                                                                                              |
| `ws/sessions.ts`                    | The open connections: hello timeout, rate limit, parsing, pings, idle connections, what a seat is sent through                                                                                                                                                                                                                                                                       |
| `client-messages.ts`                | A typed handler map, one small function per message type, after the `hello` and seat-refresh steps                                                                                                                                                                                                                                                                                   |
| `room.ts`                           | One game, from its lobby to its end. Every change of state goes through one table, `ROOM_STATES`: `open` and `starting` (a lobby, counting down or not) may go to either, to `running` or to `finished`; `running` only to `finished`; `finished` nowhere. A game restored after a restart enters `running` from the `open` of its new room. A change the table does not list throws |
| `room-outbox.ts`                    | Everything a room sends: it encodes each message once and hands it to the peer of each seat, or of one. The outbox of each connection sends a catch-up frame by frame, holds the other messages until its end, and drops a client that leaves more than 4 MiB unread                                                                                                                 |
| `turn-timer.ts`                     | The shared timer that closes the turns of the running games                                                                                                                                                                                                                                                                                                                          |
| `persistence.ts`                    | What is loaded at the start and saved on a schedule and at the end: games, usage counts, client errors, bans, accounts                                                                                                                                                                                                                                                               |
| `database.ts`, `sql/`               | `data.db`: its schema, WAL mode and mode 0600, and the `SqlDriver` port, on `bun:sqlite` in production and `node:sqlite` under Vitest                                                                                                                                                                                                                                                |
| `import-json.ts`                    | The one-time import of the JSON stores of earlier releases ([Data](#data))                                                                                                                                                                                                                                                                                                           |
| `admin-command.ts`, `admin-main.ts` | `frontfall-admin`: bans, reports and backups of `data.db`                                                                                                                                                                                                                                                                                                                            |
| `lifecycle.ts`                      | Closing, the restart announcement, `/api/status` and the drain                                                                                                                                                                                                                                                                                                                       |

## Clock, ids and transport

The server reads the time, sets timers and draws random values only through two ports, `Clock` (`src/clock.ts`) and `Ids` (`src/ids.ts`), and speaks HTTP and WebSocket only through a `Transport` (`src/transport.ts`). `createGameServer` takes all three in its options, with the machine's clock, `node:crypto` and `Bun.serve` (`src/bun-transport.ts`) as the defaults; `listen(port, host)` starts it and gives the port back, and `close()` stops it. A boundary test (`tools/test/boundaries.test.ts`) fails if another server file reads the clock, sets a timer, draws a random value, imports `node:http`, `ws` or `bun`, or calls `Bun.serve`.

The Bun transport sends every frame to one connection, never through a topic shared by a room: a seat that catches up gets the turns it missed before any live one ([room-outbox.ts](../apps/server/src/room-outbox.ts)). It reads the bytes a client has not taken yet from `getBufferedAmount()`, and hands the next frame of a catch-up on at Bun's `drain` event. An HTTP connection that sends nothing for 10 seconds is closed, which covers headers that trickle in and a body that never ends. Once a request is fully read, its handler has 30 seconds to answer, enough for the two calls to a sign-in provider; then the connection is idle again. The request target is the path as the client wrote it, so `//host/path` and `/\host/path` are refused with `400`, with or without a `Host` header. A target in absolute form (`GET http://other/x`) is served as `/x`: Bun builds the URL from the `Host` header, so the transport cannot tell it from `GET /x`, where `node:http` refused it. Frames past the server's 1 KiB limit close the connection with `1009`; past 64 KiB, Bun refuses them before reading them. Bun's own pings and idle timeout of WebSockets are off: the server pings and drops silent sockets itself.

The tests run the server on a `FakeTransport` and, where time matters, a `FakeClock` (`test/support/`): requests and sockets reach it without a network, and a test moves the time itself. Vitest runs on Node, so every suite there, the fuzzed connections (`test/fuzz.test.ts`) included, uses the fake. What the wire alone decides runs on Bun, with `bun run test:bun` (`test-bun/`): a request still half sent at shutdown, request targets such as `//host/path`, a refused and a broken handshake, frames over the size limit, a client that stops reading and one that stops answering pings, the pacing of a catch-up, the answers of the fake and of `Bun.serve` side by side, and nodemailer sending through STARTTLS to a local SMTP server, with a certificate made for the run. The load test (`bench/test/load.test.ts`) starts the server with Bun in a child process.
