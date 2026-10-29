# Hosting your own server

Frontfall is one Docker image: a Node.js server that serves the game's pages and relays the turns of online games. It needs no database and no other service. A small virtual machine with 1 GB of memory runs it; the games themselves are simulated in the players' browsers.

## Try it on your machine

```sh
docker run --rm -p 8080:8080 ghcr.io/nic0lasm/frontfall:latest
```

Open http://localhost:8080. Solo games work at once. For online games, send the invitation link to someone who can reach your machine, or open it in a second tab.

## Run it for good

The [`compose.yaml`](../compose.yaml) at the root of the repository is a ready setup: copy it to your server, then

```sh
docker compose up -d
docker compose ps          # "healthy" after a few seconds
```

What it sets, and why:

| Line                                        | Why                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `image`                                     | `latest` follows each release of `main`. To choose when to update, pin a commit tag such as `ghcr.io/nic0lasm/frontfall:0d25e267bbae`, or a release tag such as `0.4.0`                                |
| `FRONTFALL_DATA` and the volume             | The usage counts, reports and bans survive restarts in the `frontfall-data` volume, and so do the games in progress, unless the new image changes the [simulation build](protocol.md#simulation-build) |
| `FRONTFALL_ORIGINE`                         | The address players open, such as `https://games.example.org`: other sites then cannot open games on your server from their pages                                                                      |
| `FRONTFALL_SEATS_PER_ADDRESS`, not set      | A public game takes at most 3 players from one address. Players behind one router, as at a LAN party, share it: set 0 to lift the limit, or a higher number                                            |
| `FRONTFALL_CONNECTIONS_PER_MINUTE`, not set | One address opens at most 30 connections a minute after a first 40. Raise it if many players reach the server through one address                                                                      |
| `read_only` and `tmpfs`                     | The server writes only to its data volume and `/tmp`                                                                                                                                                   |
| `stop_grace_period`                         | On a stop, running games get 20 seconds to end, and players are told why                                                                                                                               |
| `restart` and `mem_limit`                   | Back after a crash or a reboot; the image keeps its heap at 512 MB, well inside 1 GB                                                                                                                   |

The usage counts also keep a copy of the previous save and one file per month in `usage/months/` of the volume, which you can keep or collect ([server](server.md#usage-counts)).

Every setting the server reads is listed in [server.md](server.md#configuration).

### Sign-in with Discord or Google

Optional: without it, players play as guests and the menu shows no sign-in. To offer it, create an application at the [Discord developer portal](https://discord.com/developers/applications) (OAuth2, redirect `https://<your address>/auth/discord/callback`) or an OAuth client of type "Web application" in the [Google Cloud console](https://console.cloud.google.com/apis/credentials) (redirect `https://<your address>/auth/google/callback`), then set, next to `FRONTFALL_DATA`:

```yaml
FRONTFALL_PUBLIC_URL: https://games.example.org
FRONTFALL_SESSION_SECRET: ${FRONTFALL_SESSION_SECRET} # openssl rand -base64 48, kept in an .env file
FRONTFALL_OAUTH_DISCORD_ID: "123456789012345678"
FRONTFALL_OAUTH_DISCORD_SECRET: ${FRONTFALL_OAUTH_DISCORD_SECRET}
```

The Google pair is `FRONTFALL_OAUTH_GOOGLE_ID` and `FRONTFALL_OAUTH_GOOGLE_SECRET`. The container must reach Discord and Google over HTTPS. Changing the session secret signs every player out and does nothing else; the accounts live in the data volume ([server.md](server.md#accounts)).

### Sign-in by email

Optional too: a link sent by email, no password. Give the server a mailbox it may send from: any SMTP account on port 465 or 587, such as the one of your domain. Write its JSON in a file readable by the container's user (uid 1000) only, mount it and point `FRONTFALL_SMTP_FILE` at it, with `FRONTFALL_PUBLIC_URL` and `FRONTFALL_SESSION_SECRET` as above:

```yaml
environment:
  FRONTFALL_SMTP_FILE: /run/secrets/smtp
volumes:
  - ./smtp.json:/run/secrets/smtp:ro # {"hote", "port", "utilisateur", "motDePasse", "expediteur"}
```

The container must reach that host on that port. The game sends at most 150 links a day (`FRONTFALL_EMAIL_DAILY_LIMIT`), and keeps no address: see [server.md](server.md#sign-in-by-email) for the format, the limits and what is logged. With email alone, the Discord and Google settings may stay unset.

To update: `docker compose pull && docker compose up -d`. To build the image from the source instead: `docker build -t frontfall .`, then set `FRONTFALL_IMAGE=frontfall` when running `docker compose`.

## Backing up and restoring

Everything worth keeping is in the data volume (`frontfall-data` in the sample `compose.yaml`, prefixed by the project name: see `docker volume ls`; the commands below use `frontfall_frontfall-data`): `usage/` (counts and monthly files), `accounts/accounts.json` (sign-in accounts: it holds personal data, so keep any copy encrypted), `moderation/` (reports and bans, and the `key` that keeps report references stable). `games/` only lets running games resume after a restart; leave it out. The sign-in secrets live in your own env file, not in the volume: back it up too.

The server writes each file by renaming a finished copy, so copying the volume while the game runs gives consistent files. For example, a nightly encrypted copy with [restic](https://restic.net/):

```sh
restic backup --exclude games --exclude '*.tmp*' \
  "$(docker volume inspect frontfall_frontfall-data --format '{{ .Mountpoint }}')"
```

To restore, stop the game, empty the volume, put the files back with their owner (the `node` user of the container), and start it again:

```sh
docker compose stop
restic restore latest --target /tmp/restore
docker run --rm -v frontfall_frontfall-data:/data -v /tmp/restore:/restore alpine \
  sh -c 'rm -rf /data/* && cp -a /restore/*/. /data/ && chown -R 1000:1000 /data'
docker compose up -d
```

Rehearse it once on a spare machine and time it: a backup you have never restored is a guess. Checking afterwards is quick: `/status` shows the usage table again, and a player signs in with the same account.

## HTTPS and a domain

Browsers need HTTPS for anything but `localhost`, so put a reverse proxy in front. It must forward WebSocket upgrades on `/ws`, and set the `X-Client-IP` header to the player's address, which the server uses for its limits per address. The server trusts that header only from a private or loopback address, as a proxy on the same host or Docker network is. Without a proxy, when players reach the server straight from its own network as at a LAN party, set `FRONTFALL_TRUST_PROXY=false` so none of them can pass for another address.

With [Caddy](https://caddyserver.com/), which gets the certificate itself:

```caddyfile
games.example.org {
	reverse_proxy localhost:8080 {
		header_up X-Client-IP {client_ip}
	}
}
```

With nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Client-IP $remote_addr;
    proxy_read_timeout 120s;
}
```

The game also works under a path, such as `https://example.org/frontfall/`: have the proxy strip the prefix (`handle_path /frontfall/*` in Caddy, `location /frontfall/ { proxy_pass http://127.0.0.1:8080/; … }` in nginx). Its pages and its WebSocket use relative addresses, so nothing else changes ([ADR 0004](adr/0004-sub-path-hosting.md)).

A proxy that closes quiet connections must allow at least 30 seconds: the server pings every 25.

## Is it working?

| Address       | Answer                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `/healthz`    | `ok`, with the build in `X-Frontfall-Version`; `503` when the server is stuck or stopping                |
| `/status`     | A page with the players online, the games running and the version                                        |
| `/stats.html` | Charts of the games played: per day, by map and by length, from `/api/stats`                             |
| `/metrics`    | Prometheus metrics, only from the host: `docker compose exec frontfall wget -qO- localhost:8080/metrics` |

Players can report each other from their menu. Read the reports and ban an abusive player's network, without a restart, as [server.md](server.md#reports-and-bans) shows; reports and bans are kept in the data volume.

Logs are one JSON object per line: `docker compose logs -f`. [operations.md](operations.md) describes how the public server is run, from restarts to rollbacks; most of its commands work on yours with the name of your container.

The game serves its pages with a content security policy that keeps them out of frames and only runs their own code. A proxy may replace that header with its own.

Each release of Frontfall checks this setup: CI builds the image, starts it with `compose.yaml`, plays solo and private games against it, and restarts it to check that the data volume is kept.

## Announce public games on Discord

A small script polls your server and posts to a Discord channel when a public game opens, with a link to join it. Create a webhook in the channel's settings (Integrations, Webhooks), then run it on any machine that reaches the server, from a checkout of the repository with its packages installed (`pnpm install`):

```sh
FRONTFALL_URL=https://example.org/frontfall/ \
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/… \
pnpm announce
```

`ANNOUNCE_SECONDS` sets how often it asks, 30 by default. It posts the game's name, its host's name and map, and the seats taken, all of which `/api/games` already shows to anyone, and mentions nobody. The games already open when it starts are not announced, and a game is never announced twice. It also posts when a running public game ends, without a winner, since the server never learns who won. A game that leaves the list while the server restarts or stops is not taken for one that ended: the script compares `startedAt` in `/api/status` before and after each list, and posts no end while the list is full, as running games come after the open ones. A game that ends during a restart is never announced as ended; one the server keeps across it (`FRONTFALL_DATA`) is, once it ends or nobody comes back to it. The script expects its address to reach one server, without a cache in front of `/api/games`: two servers behind one address, or a proxy that serves an old list while the server restarts, could make a game look ended. It reports each round where `/api/status` gives no `startedAt`, as an older server does, and posts no ends then. Keep the webhook's address secret: anyone who has it can post in the channel.
