# Game server

`apps/server` is one Node.js process that serves the built client, fills games with players and relays their turns. It never simulates a game ([ADR 0001](adr/0001-deterministic-lockstep.md)); the messages it exchanges with clients are described in [protocol.md](protocol.md). The container image runs it on port 8080 behind a reverse proxy ([ADR 0004](adr/0004-sub-path-hosting.md)).

## Configuration

| Variable                                                       | Default                                 | Meaning                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                                                         | `8080`                                  | HTTP and WebSocket port                                                                                                                                                                                                                                                                                                                                            |
| `FRONTFALL_STATIC`                                             | `../../client/dist`                     | Directory of the built client                                                                                                                                                                                                                                                                                                                                      |
| `FRONTFALL_ORIGINE`                                            | unset                                   | Only pages from this origin may open a WebSocket, such as `https://nclsmgr.com`. Unset allows any                                                                                                                                                                                                                                                                  |
| `FRONTFALL_VERSION`                                            | `dev`                                   | Build identifier returned by `/healthz`; the image sets it to the commit                                                                                                                                                                                                                                                                                           |
| `FRONTFALL_MAX_GAMES`                                          | `500`                                   | Games open or running at once                                                                                                                                                                                                                                                                                                                                      |
| `FRONTFALL_MAX_CONNECTIONS`                                    | `5000`                                  | Open WebSocket connections at once; further ones are closed with code `4006`, and the page says the server is full                                                                                                                                                                                                                                                 |
| `FRONTFALL_MAX_PLAYERS`                                        | `3000`                                  | Players seated in games at once; further `play`, `create` and `join` requests get `too_many_games`, while players of a running game still rejoin ([capacity.md](capacity.md))                                                                                                                                                                                      |
| `FRONTFALL_MAX_LOG_MIB`                                        | `192`                                   | Mebibytes the turn logs of every game may take together before new players are turned away the same way                                                                                                                                                                                                                                                            |
| `NODE_OPTIONS`                                                 | `--max-old-space-size=512` in the image | Caps the JavaScript heap; raise it with the container's memory limit                                                                                                                                                                                                                                                                                               |
| `FRONTFALL_COUNTDOWN_SECONDS`                                  | `60`                                    | Countdown of a game opened by "Play now", from its first player; 1 at least                                                                                                                                                                                                                                                                                        |
| `FRONTFALL_DRAIN_SECONDS`                                      | `20`                                    | After `SIGTERM`, how long running games may go on; keep it below the container's stop grace period                                                                                                                                                                                                                                                                 |
| `FRONTFALL_DATA`                                               | unset                                   | Directory kept across restarts, such as `/var/lib/frontfall`: the usage counts go in `usage/`, the games running at a restart in `games/` ([Shutdown](#shutdown)), reports and bans in `moderation/` ([Reports and bans](#reports-and-bans)), accounts in `accounts/` ([Accounts](#accounts)). Unset keeps the counts in memory and ends the games with the server |
| `FRONTFALL_SEATS_PER_ADDRESS`                                  | `3`                                     | Seats players from one address may take in a public game; 0 for no limit, as for a LAN party behind one router                                                                                                                                                                                                                                                     |
| `FRONTFALL_CONNECTIONS_PER_MINUTE`                             | `30`                                    | WebSockets one address may open per minute on average, after a first 40 at once                                                                                                                                                                                                                                                                                    |
| `FRONTFALL_PUBLIC_URL`                                         | unset                                   | Address players open, path included, such as `https://nclsmgr.com/frontfall`: Discord and Google send players back under it ([Accounts](#accounts))                                                                                                                                                                                                                |
| `FRONTFALL_SESSION_SECRET`                                     | unset                                   | 32 characters or more, random and kept secret: it signs the session cookies. Another one signs every player out, and changes nothing else ([Accounts](#accounts))                                                                                                                                                                                                  |
| `FRONTFALL_OAUTH_DISCORD_ID`, `FRONTFALL_OAUTH_DISCORD_SECRET` | unset                                   | Client id and secret of a Discord application: sign-in with Discord ([Accounts](#accounts))                                                                                                                                                                                                                                                                        |
| `FRONTFALL_OAUTH_GOOGLE_ID`, `FRONTFALL_OAUTH_GOOGLE_SECRET`   | unset                                   | Client id and secret of a Google OAuth client: sign-in with Google ([Accounts](#accounts))                                                                                                                                                                                                                                                                         |
| `FRONTFALL_SMTP_FILE`                                          | unset                                   | JSON file of the mailbox sign-in links are sent from: sign-in by email ([Accounts](#sign-in-by-email))                                                                                                                                                                                                                                                             |
| `FRONTFALL_EMAIL_DAILY_LIMIT`                                  | `150`                                   | Sign-in links sent in a day, all players together; keep it under the mailbox's own limit ([Accounts](#sign-in-by-email))                                                                                                                                                                                                                                           |

## Games

| Setting                        | Value                      | Notes                                                                                                               |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Players per game               | 2 to 16, set by the host   | A game set to start when full (the default) starts as its last seat is taken                                        |
| Players to start a public game | 2                          | The host starts it; any number for a private game                                                                   |
| "Play now" countdown           | 60 seconds                 | From the first player, 30 s at least after the second; alone at the end, the map's default bots fill in             |
| Host away                      | 2 minutes                  | With other players waiting, the role goes to the one seen most recently                                             |
| Seat kept after a drop         | 5 minutes                  | The player rejoins with their token and every missed turn                                                           |
| Lobby seat kept after a drop   | 30 seconds                 | The player gets their place back, and the host keeps the role (see below)                                           |
| Longest game                   | 4 hours                    | Then the game ends with reason `timeout`                                                                            |
| Games at once                  | 500                        | Further `play` and `create` requests get `too_many_games`                                                           |
| Players at once                | 3000                       | Further `play`, `create` and `join` requests get `too_many_games`; a seat taken back with `rejoin` is always served |
| Turn log of one game           | 16 MiB                     | Then the game ends with reason `timeout`; a busy 4-hour game logs about 2 MiB                                       |
| Bots in a game                 | 25                         | Seats shrink to fit the map's `players.max`, never below the players present                                        |
| Game not started               | 10 minutes after it opened | Then the game ends with reason `expired`                                                                            |
| Lobbies per address            | 3 not yet started          | Public and private; further `create` requests get `too_many_lobbies`                                                |
| Seats per address              | 3 in a public game         | Private games have none; further `join` requests get `too_many_seats`, and "Play now" looks for another game        |
| Removed players                | Until the game starts      | The host removes a player with `kick`; their address then gets `removed` from that game                             |
| Public games listed            | 100                        | Waiting ones first, the fewest free seats first, then the oldest                                                    |

A connection that drops without a close frame, as when a phone goes to sleep or the network fails, keeps its seat in a lobby for 30 seconds: the client takes it back with the token of the `lobby` message, or lands in the game if it started meanwhile. A page that closes its socket itself, on a reload or when the tab closes, gives its lobby seat up at once.

A game is freed as soon as it ends: when its last player leaves before the start, when it has not started ten minutes after it opened, when every player has been gone for five minutes, or at the time limit. Its turn log, about one byte per quiet tick, goes with it.

All running games share one timer that closes a turn of each every 100 ms. It runs ten passes a tick, on a fixed schedule, each over a tenth of the games, so that the sends of thousands of players never hold the server for long at once. The `frontfall_turn_duration_seconds` histogram measures how long one pass takes.

A player who rejoins gets the turns they missed one frame of 2000 turns at a time, the next once the last has gone out to the network. A connection that leaves more than 4 MiB unread, such as a tab asleep on a stalled network, is dropped and counted in `frontfall_slow_clients_total`: the page rejoins from its last turn.

Games offer the maps listed in `maps/index.json` of the built client, read once at start. Without that file, only the default map, World, can be picked.

## Limits

One bad client must not spoil a game or the server. Each limit closes the offending connection with a code listed in [protocol.md](protocol.md#close-codes) and is counted in `frontfall_rejected_messages_total`.

| Limit                       | Value                                                         | On breach                              |
| --------------------------- | ------------------------------------------------------------- | -------------------------------------- |
| Connections in all          | 5000                                                          | Upgrade refused with `503`             |
| Connections per address     | 16, for players behind one router or mobile carrier           | Upgrade refused with `429`             |
| New connections per address | 30 a minute, bursts of 40                                     | Upgrade refused with `429`             |
| Frame size                  | 1 KiB                                                         | Closed with `1009`                     |
| Messages per connection     | 20 per second, bursts of 40                                   | Closed with `4002`                     |
| Invalid frame               | any frame that fails decoding or checks                       | Closed with `4001`                     |
| Time to say `hello`         | 10 seconds                                                    | Closed with `4003`                     |
| Time out of any game        | 5 minutes after `hello` or the last game                      | Closed with `4003`                     |
| Silence                     | a ping unanswered for 12.5 seconds; pings go every 25 seconds | Connection dropped                     |
| Orders per player           | 10 per turn                                                   | Further orders of the turn are dropped |
| Turn log of a game          | 64 MiB                                                        | Game ends with `timeout`               |

The address of a player is the `X-Client-IP` header, which the reverse proxy must set and overwrite. The server believes that header only when the connection itself comes from a private or loopback address, as a proxy on the same host or Docker network does; from any other peer the header is ignored and the TCP peer address is used. Player names follow the rules in [protocol.md](protocol.md#hello).

## Reports and bans

A player can report another one of the same game from their menu, with one reason out of four (`R-MODE-06`, [protocol.md](protocol.md#report)). The server never acts on reports by itself: they are for the operator to read. A report holds its time, the game, the reason, the number and name the reported player played under, and two references: one for the address of the reporter, one for the address of the reported player. A reference is a keyed hash of the address, 16 characters long. The key is drawn once and kept in `moderation/key` under the data directory, so the same address keeps the same reference across restarts, while nobody without the key can link a reference to an address. Reports are kept 30 days, 500 at most and 20 about one address, the oldest dropped first, in `moderation/reports.json`, written a second after the last one. One address sends 5 reports at once and one every two minutes after that. A report counts once per game and player, and once a day per pair of addresses, so one angry player cannot pile reports on another across games. Players of one public address cannot report each other: they share one reference. Players of one private address, on a LAN without a proxy, can. Bans that ran out leave the file the next time it is written.

The ban list, `moderation/bans.json`, names addresses or references, each banned until a date or for good. A banned address cannot connect: its WebSocket closes with code `4005` and the page says the operator banned the network. A ban takes effect at once, on the connections already open too, without a restart. Mind that one address can be a whole household, a school, or many phones of one mobile carrier: prefer a ban of a few days.

From the host, inside the container (the name may differ on yours):

```sh
admin() { docker exec frontfall-frontfall-1 node -e "fetch('http://127.0.0.1:8080/admin/'+process.argv[2],{method:process.argv[1]}).then(async(r)=>console.log(r.status,await r.text()))" "$@"; }
admin GET 'reports?days=7'                            # newest first, then the players most reported
admin POST 'bans?target=Jm0pQ2xvd2Zy4kTe&days=7&note=insults'  # a reference from a report, for 7 days
admin POST 'bans?target=203.0.113.7'                  # an address, for good
admin DELETE 'bans?target=203.0.113.7'                # lifts it
admin POST bans                                       # reads bans.json again, after an edit by hand
admin GET bans
```

`/admin/reports` gives `reports`, newest first, and `targets`: for each reference reported, the number of reports and of different addresses that sent them, the names used, the reasons and whether it is banned. A ban added this way is written to `bans.json`; the file can also be edited by hand, then read again with `POST /admin/bans`:

```json
{
  "bans": [
    { "target": "Jm0pQ2xvd2Zy4kTe", "until": "2026-12-01T00:00:00.000Z", "note": "insults" },
    { "target": "203.0.113.7", "until": null }
  ]
}
```

A file that does not read is refused with `422` and the bans in force stay as they were; at start, the server then runs with no ban and logs `bans_not_loaded`. Without a data directory, reports and bans live in memory, and the references change at every start.

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

| Event                 | Level | Fields                                                                                    |
| --------------------- | ----- | ----------------------------------------------------------------------------------------- |
| `server_started`      | info  | `port`, `version`                                                                         |
| `server_stopping`     | info  |                                                                                           |
| `game_started`        | info  | `game`, `visibility`, `players`                                                           |
| `game_finished`       | info  | `game`, `reason`, `ticks`                                                                 |
| `player_rejoined`     | info  | `game`, `player`, `from`                                                                  |
| `desync`              | warn  | `game`, `tick`, `hash` (the player out of step), `expected` (the majority's, or `null`)   |
| `connection_rejected` | warn  | `client`, `reason`                                                                        |
| `client_error`        | warn  | `type`, `release`, `message` (scrubbed, see [privacy.md](privacy.md)); 60 an hour at most |
| `game_saved`          | info  | `game`, `ticks`: kept for the next run, at a restart                                      |
| `game_not_saved`      | warn  | `game`, `error`: the game ends with reason `restart` instead                              |
| `game_restored`       | info  | `game`, `ticks`: taken back from the last run                                             |
| `game_not_restored`   | warn  | `file`, `reason`: `simulation` for another simulation build, or `unreadable`              |
| `usage_in_memory`     | warn  | `reason`: no data directory, the usage counts are lost at the next restart                |
| `usage_not_loaded`    | warn  | `error`: the counts kept by the last run could not be read                                |
| `usage_month_bad`     | warn  | `error`: a month file was set aside                                                       |
| `usage_not_saved`     | warn  | `error`                                                                                   |
| `player_reported`     | info  | `game`, `player`, `reason` ([Reports and bans](#reports-and-bans))                        |
| `player_banned`       | info  | `days`, `null` for good                                                                   |
| `ban_lifted`          | info  |                                                                                           |
| `bans_reloaded`       | info  | `bans`: entries now in force                                                              |
| `bans_not_loaded`     | warn  | `error`: the ban file does not read; the server starts with no ban                        |

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
| `frontfall_usage_total{dimension,value}`              | counter   | Reports of players' pages ([privacy.md](privacy.md))                                                         |
| `process_resident_memory_bytes`                       | gauge     | Resident memory of the process                                                                               |
| `process_cpu_seconds_total`                           | counter   | CPU time used by the process                                                                                 |

## HTTP routes

| Path                   | Answer                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/healthz`             | `ok`, or `503` (see below), with the build in the `X-Frontfall-Version` header and the release in `X-Frontfall-Release`           |
| `/api/games`           | Public games that have not started, and the number of games running, as JSON                                                      |
| `/status`              | A page for people: players online, games running, lobbies, an announced restart, release and build                                |
| `/api/status`          | The same as JSON: `version`, `release`, `simulation`, `keepsGames`, `state`, `players`, `running`, `lobbies`, `restartInMs`       |
| `/admin/maintenance`   | `POST ?minutes=N` announces a restart in N minutes to every player, `0` calls it off; from inside the container only              |
| `/admin/reports`       | `GET ?days=N`: the reports of the last N days, 30 at most; from inside the container only ([Reports and bans](#reports-and-bans)) |
| `/admin/bans`          | `GET` lists the bans, `POST` adds one or reads the file again, `DELETE` lifts one; from inside the container only                 |
| `/api/stats`           | Usage counts per day and in total, as JSON ([privacy.md](privacy.md)); the last 7 days are also on `/status`                      |
| `/api/usage`           | `POST` only: a report of a player's page ([privacy.md](privacy.md)); `204`, or `400`, `403`, `413`, `415`, `429`                  |
| `/api/me`              | The services offered and the account signed in, as JSON; `POST {"name"}` renames it, `DELETE` deletes it ([Accounts](#accounts))  |
| `/api/me/achievements` | `POST` only: the page's achievements, kept with the account; answers with them all ([Accounts](#achievements-of-an-account))      |
| `/auth/<service>`      | Sends the player to sign in with `discord` or `google`; the service sends them back to `/auth/<service>/callback`                 |
| `/auth/email`          | `POST {"email", "name", "language"}` only: sends a sign-in link; `202` whoever the address is ([Accounts](#sign-in-by-email))     |
| `/auth/email/confirm`  | `POST {"token"}` only: signs in the player who opened the link, once                                                              |
| `/auth/logout`         | `POST` only: signs the player out                                                                                                 |
| `/metrics`             | Metrics, from the host only                                                                                                       |
| `/ws`                  | WebSocket upgrade                                                                                                                 |
| anything else          | Files of the built client                                                                                                         |

HTML, scripts, styles, JSON, SVG and map files (`.bin`) of 1 KiB or more are sent gzipped to browsers that accept it, with `Vary: Accept-Encoding`. Each file is compressed once, on its first request. Every file carries an `ETag` drawn from its content; maps and other files without a hashed name are sent with `no-cache`, so browsers revalidate them and get `304 Not Modified` until they change. Caddy and Cloudflare pass the compressed body on, and would not compress `.bin` files themselves.

## Accounts

Players may sign in with Discord, Google or a link sent by email to keep their name and achievements for themselves. It is optional: everything is played as a guest too, and a server without the settings below offers no sign-in at all (the menu shows no button).

The server needs `FRONTFALL_DATA`, `FRONTFALL_PUBLIC_URL`, `FRONTFALL_SESSION_SECRET`, and the id and secret of at least one service or a mailbox ([below](#sign-in-by-email)). It does the OAuth 2.0 exchange itself, with a `state` and PKCE: the page only follows a link to `/auth/<service>`, and the service sends the player back to `/auth/<service>/callback`, where the server trades the code for a token, asks the service who the player is, and forgets the token. Discord is asked for `identify` only, Google for `openid profile`. The server must be able to reach `discord.com`, `oauth2.googleapis.com` and `openidconnect.googleapis.com`.

The player then holds a `frontfall_session` cookie for 30 days: `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, limited to the path of the public address, so that two games under one domain keep apart. It is signed with the session secret and holds only the account's id, its count of sign-outs and its expiry: signing out ends the account's sessions on every device. It goes with every request, the game socket included: a connection opened signed in plays under the account's name, whatever its `hello` says, and a guest who asks for a name an account holds gets `invalid_name` ([protocol](protocol.md#hello)). Two names are the same name when they differ only by case, accents, spaces or punctuation.

The accounts are kept in `accounts/accounts.json` under the data directory, readable by the server's user only and replaced at once on every change. The file starts with a salt of 256 random bits, drawn when it is created; each account is an id, the service, an HMAC of the service's id keyed by that salt, the name, the days it was created and last signed in, and its count of sign-outs. Nothing else from the service is kept: no email, no picture, not the name there, which only suggests the first name. The accounts depend on no setting: back up the data directory and they come back with it. A file that cannot be read, as with wrong permissions, turns sign-in off until it is fixed (`accounts_off` in the log), rather than be overwritten; one that is read but not understood is set aside as `accounts.json.broken-<time>` and the server starts with none. A player deletes their account from the menu; nothing of it is left in the file.

One address may make 20 requests to `/auth/` and `/api/me` at once, then one every 6 seconds; beyond, `429`. Sign-in failures are logged as `sign_in_failed` with the service and a reason, never an id.

An account file written by this version may hold accounts made by email or achievements, which releases up to 0.6.4 do not understand: they set the file aside as `accounts.json.broken-<time>` and start with none. To go back to an older release, keep that file and put it back when you return.

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

Limits: one address may ask for 3 links, then one every 5 minutes (`429`); one email address gets 2 links, then one every 10 minutes, the others held back without a word; and the server sends `FRONTFALL_EMAIL_DAILY_LIMIT` links a day in all, then answers `503` until the next day (UTC), logged once as `sign_in_links_held`. An account made by email is not the account of the same address at Google: the game never asks Google for it.

### Achievements of an account

Signed in, the menu posts the device's achievements to `/api/me/achievements` (8 KiB at most) and keeps what comes back, so that they follow the player. The server adds them to the account's: each achievement keeps its higher level and earlier day, each count its larger value, and nothing is ever taken away; at most 64 achievements and 8 counts, with ids of lowercase letters, digits and dashes. Two devices played apart between two visits to the menu keep the larger count, not their sum. They are counted by the page, as before: an account only carries them. Deleting the account deletes them.

## Health check

`/healthz` answers `200 ok` while the turn timer runs. The timer runs whether or not any game is in progress, so an idle server is healthy. It answers `503 stalled` when no turn has been closed for 5 seconds, and `200 ok` again from the next turn, and `503 stopping` to requests still in flight while it shuts down. A blocked event loop does not answer at all, which a check with a timeout reports as well. The deployment waits for this route, the image's `HEALTHCHECK` polls it, and an external uptime check alerts on it: Better Stack requests it from outside every 3 minutes and emails the maintainer when it fails, so an outage is known within about 6 minutes. What to do then is in [operations.md](operations.md). Docker only marks an unhealthy container as such; it does not restart it.

## Shutdown

Games live in memory, so a restart would cut them short. Four things keep that from happening:

1. **The deployment announces the update, then waits.** Before rolling out a new image, the Publish workflow reads `running` from `/api/games`, the games started with a player connected or away but still holding a seat. If some are running and the server reports in `/api/status` that it keeps its games, with the same simulation build as the new image, it deploys at once: the games are kept across the restart (below). Otherwise, it asks the server, through its deploy command, to announce the update in 10 minutes (`ANNONCE_MINUTES`): every page shows a band counting the minutes down, players who arrive meanwhile included. Then it waits for `running` to reach 0, for those 10 minutes at most. A server that does not answer counts as one with games running: the workflow announces and waits as well. Run the workflow by hand with `now` ticked to deploy at once.
2. **The server drains.** On `SIGTERM` it stops opening games: `play`, `create` and `join` get the error `restarting`, while players of a running game can still `rejoin`. Lobbies end at once with reason `restart`. Running games play on until their players leave or lose their seat, for `FRONTFALL_DRAIN_SECONDS` at most, and their players see the band with the time left; `/healthz` answers `503 stopping` meanwhile. A server with a data directory does not drain: it keeps its games at once (below).
3. **Games still running are kept.** With a data directory (`FRONTFALL_DATA`, reported as `keepsGames` in `/api/status`), the server writes at once each game still running with a player to `games/<id>.json`: the seed, the settings, the seats with their names and reconnect tokens, and the turn log, with the [simulation build](protocol.md#simulation-build). Nothing the clients compute is in it: they rebuild the game from its turns as on any rejoin, so the server never keeps a state the players have not agreed on. The files are readable by the server's user only (`0600`, in a `0700` directory). The players are not told the game ended: every WebSocket closes with code `1012`, and the pages try again until the server is back.
4. **The next run takes them back.** On start, the server reads every file in `games/` and deletes it, whether it loads or not. A game of the same simulation build runs again from its last turn, every seat waiting for its player as after a dropped connection: the pages reconnect, rejoin with their token and receive the turns they missed. The time limit goes on where it was, and the minutes the server was down count for nothing. A game of another simulation build would desynchronise and is dropped (`game_not_restored`), like a file that does not read; its players reconnect, are sent away to reload, and find the game over. Without a data directory, or when a file cannot be written, the game ends with reason `restart` and the page says it was stopped for an update.

The process exits 5 seconds after the drain at the latest. A second `SIGTERM` or `SIGINT` exits at once. With the default 20 seconds, a drain fits within the 30-second stop grace period of the production host; a longer drain needs a longer grace period, or Docker kills the process before players are told.

## Usage counts

With `FRONTFALL_DATA`, `usage/usage.json` holds the counts, saved every 5 minutes; the save before it stays as `usage.json.bak`, and the server falls back on that copy if the file is damaged (the damaged one is kept as `usage.json.broken`) or missing. To start the counts again from nothing, delete both files.
`usage/months/2026-10.json` holds one month: `{ "version": 1, "month": "2026-10", "days": { "2026-10-25": { dimension: { value: count } } } }`. A monthly file is added to and never cut down: a day keeps the larger of the file's figures and the server's, and a file that cannot be read is set aside as `.broken-<time>`.
