# Server capacity

How many games and players one game server holds, how it was measured, and what it does once full. The limits themselves are listed in [server.md](server.md#configuration).

## What costs what

The server never simulates a game: it relays orders and sends every player one turn every 100 ms. Its cost is therefore one WebSocket send per player per tick, about 10 µs each, most of it in the system call. Lobbies, orders and the public list barely count. Turn logs grow with play, about 2 MiB for a busy 4-hour game.

## Measured, 29 October 2026

Bench: `pnpm load -- --spawn-server --players 16 --ramp 50,100,200,300,350 --minutes 2 --order-interval 1000 --client-procs 3 --heap-mib 512` ([performance.md](performance.md#server-load)). Private games of 16 players, each sending one order a second, which is more than people do. Machine: 4 × Xeon at 2.1 GHz, Node 22; the server runs in its own process with the heap of the image, the simulated players in three others.

| Players | Server CPU, one core | Memory (RSS) | Event loop p99 | Turn late by, p95 | Order to turn, p95 |
| ------: | -------------------: | -----------: | -------------: | ----------------: | -----------------: |
|     800 |                 17 % |      136 MiB |         3.4 ms |           +2.4 ms |              96 ms |
|    1600 |                 30 % |      154 MiB |         3.2 ms |           +1.8 ms |              97 ms |
|    3200 |                 49 % |      179 MiB |        11.1 ms |           +8.8 ms |             100 ms |
|    4800 |                 70 % |      210 MiB |        10.9 ms |           +8.5 ms |             101 ms |
|    5600 |                 85 % |      227 MiB |        14.6 ms |      **+39.8 ms** |             112 ms |

No turn was lost, reordered or desynchronised at any step. The server falls behind from about 5600 players: one Node.js thread does all the sending, so a second core does not help.

Two harder cases, at 3040 players:

- **Every player reloads at once** (`--rejoin-storm 60 --rejoin-from-zero`): all 3040 rejoined from the first turn and were caught up within 4.6 s (p50 2.5 s), with no failure.
- **A tenth of the players stop reading** (`--slow-clients 10`, 4 minutes): server memory stays flat at 179 MiB. A client that leaves 4 MiB unread is dropped and rejoins.

## The production server

The game runs in a container of 2 CPUs and 768 MiB, with a 512 MiB heap, beside the website, Caddy and the preview server on the same machine. The defaults keep about half the measured ceiling in reserve for them, for a slower processor and for bursts:

| Limit                       | Default | Why                                                                              |
| --------------------------- | ------: | -------------------------------------------------------------------------------- |
| `FRONTFALL_MAX_PLAYERS`     |    3000 | About half a core; turns stay within 10 ms of their time                         |
| `FRONTFALL_MAX_CONNECTIONS` |    5000 | Players, plus pages connecting or rejoining; well below the falling-behind point |
| `FRONTFALL_MAX_LOG_MIB`     |     192 | With 210 MiB at 4800 players, the container stays under half its memory          |
| `FRONTFALL_MAX_GAMES`       |     500 | Unchanged                                                                        |

So the production server holds about **3000 players at once, some 190 full games of 16 or many more small ones**. Measure again with the bench before raising a limit, and on the machine itself if it changes.

## When full

- Past `FRONTFALL_MAX_PLAYERS` seated players, or `FRONTFALL_MAX_LOG_MIB` of turn logs, "Play now", creating and joining a game get `too_many_games`: the page says the server is full. Players of a running game always get their seat back.
- Past `FRONTFALL_MAX_CONNECTIONS`, a new connection is closed with code `4006`: the page says the server is full and tries again by itself after 15 s, then up to a minute.
- Every reconnection waits a random half to one and a half times its delay, so that after a restart pages come back spread over time.
- `frontfall_refused_connections_total{reason}` counts the players turned away, `frontfall_slow_clients_total` the connections dropped for reading too slowly.
