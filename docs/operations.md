# Operations

How the public server at [nclsmgr.com/frontfall](https://nclsmgr.com/frontfall/) runs, and what to do when it misbehaves. Configuration, limits, logs and metrics of the game server itself are described in [server.md](server.md).

The host is configured in [nic0lasm/nclsmgr.com](https://github.com/nic0lasm/nclsmgr.com); its [deploy/frontfall/README.md](https://github.com/nic0lasm/nclsmgr.com/blob/main/deploy/frontfall/README.md) sums up, in French, what the host expects from the image and what it provides in return.

## Where things are

| What            | Where                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Host            | A Debian VPS behind Cloudflare; Caddy terminates TLS, strips `/frontfall` and forwards to the game                                            |
| Game            | Compose project `frontfall` in `/opt/frontfall`, one container `frontfall-frontfall-1`, on the internal network `frontfall`                   |
| Running version | `IMAGE_TAG` in `/opt/frontfall/.env`, the 12-character commit of `main` the image was built from                                              |
| Release         | `version` in the root `package.json`; the client's beta label and `/healthz` (`X-Frontfall-Release`) show it. Bumped with each tagged release |
| Images          | `ghcr.io/nic0lasm/frontfall:<tag>`, built by the Publish workflow for every push to `main`                                                    |
| Deployment      | Publish connects over SSH to the `frontfall` account, whose only command is `/usr/local/sbin/frontfall-deployer <tag>`                        |
| Compose file    | Maintained with the host configuration, outside this repository: the game repository only chooses the image tag                               |
| Uptime check    | Better Stack requests `/healthz` every 3 minutes and emails the maintainer when it fails                                                      |

The container restarts on its own after a crash or a reboot (`restart: unless-stopped`), but stays down after a manual `docker stop`. Docker reports it `unhealthy` after three failed health checks in a row; that does not restart it.

## Is it up?

```sh
curl -sSi https://nclsmgr.com/frontfall/healthz
```

`200 ok` with the running commit in `X-Frontfall-Version` means the server plays. `503 stalled` means it accepts requests but closes no turns; restart it. No answer, or a Cloudflare error page, means the container or Caddy is down. On the host:

```sh
docker ps --filter name=frontfall          # status and health
docker stats --no-stream frontfall-frontfall-1
docker exec frontfall-frontfall-1 bun -e "fetch('http://127.0.0.1:8080/metrics').then((r) => r.text()).then(console.log)"
```

## If Cloudflare is down

Players reach the game through Cloudflare. When Cloudflare has an incident, the game can be up behind it and still unreachable: the container keeps running and the games in progress go on without their players, who come back to their seat within five minutes of dropping out (`reconnectGraceMs`, see [server.md](server.md)).

**1. Tell the origin from Cloudflare.** Open [cloudflarestatus.com](https://www.cloudflarestatus.com/), then ask the origin itself. Port 80 and 443 of the host are closed to everyone but Cloudflare's ranges (`restreindre-origine.sh` in the host repository), so let your own address in for the length of the test. On the host, with `MY_IP` the public address of the machine you test from:

```sh
sudo iptables -I NCLSMGR-ORIGINE 1 -s MY_IP/32 -j RETURN
```

From that machine, with `ORIGIN_IP` the address of the host:

```sh
curl -sSik --resolve nclsmgr.com:443:ORIGIN_IP https://nclsmgr.com/frontfall/healthz
```

`-k` is needed: the host presents a Cloudflare origin certificate, which no browser or curl trusts by itself. `200 ok` with `X-Frontfall-Version` means the game plays and only the way in is cut. Do the same on `/frontfall/api/status` for the count of games and players. Then close the door again, on the host:

```sh
sudo systemctl restart nclsmgr-pare-feu-origine
```

The restart rebuilds the filter from Cloudflare's ranges, so the rule for your address is gone; a reboot does the same.

**2. What is, and is not, possible.** Direct access is a way to check the host, not a way to let players in: the origin certificate is signed for Cloudflare only, so a browser refuses the connection, and the site sends `Strict-Transport-Security` with `preload`, so there is no click-through. Letting players in without Cloudflare would take a public certificate on the host and DNS records that bypass the proxy, which is not prepared. During a Cloudflare incident the plan is therefore to check the host as above, say wherever the game is announced that the game is up and Cloudflare is the cause, and wait.

**3. Tried once.** The test of step 1 was run on the date and with the result noted here: not yet.

## Read the logs

The container logs to journald, one JSON object per line:

```sh
journalctl -t frontfall-frontfall-1 --since "30 min ago"
journalctl -t frontfall-frontfall-1 -f                                  # follow
journalctl -t frontfall-frontfall-1 -o cat --since today | jq -c 'select(.level != "info")'
```

`docker logs frontfall-frontfall-1` shows the same lines. Journald rotates them itself; `journalctl --disk-usage` shows the space they take.

## Restart

```sh
docker restart frontfall-frontfall-1
```

Games in progress live in memory. On a restart the server drains first (see [server.md](server.md#shutdown)): it stops opening games, lets running ones go on for `FRONTFALL_DRAIN_SECONDS`, then ends them with reason `restart` and the page tells players why. Prefer a quiet moment: `curl -s https://nclsmgr.com/frontfall/api/games` gives `running`, the games a restart would stop. Deployments from main announce the update to players and wait for it to reach 0, for 10 minutes at most. To warn players before a manual restart: `docker exec frontfall-frontfall-1 bun -e "fetch('http://127.0.0.1:8080/admin/maintenance?minutes=5', { method: 'POST' }).then((r) => r.text()).then(console.log)"`. The image runs Bun and carries no other tool: `wget`, `curl` and `node` are not to be relied on inside it.

## Roll back

A bad release is undone by deploying the previous image with the same command Publish uses. On the host, as the administrator:

```sh
cat /opt/frontfall/.env                                     # the running tag
docker image ls ghcr.io/nic0lasm/frontfall                  # tags kept on the host, newest first
sudo -u frontfall env SSH_ORIGINAL_COMMAND=<tag> /usr/local/sbin/frontfall-deployer
curl -sI https://nclsmgr.com/frontfall/healthz | grep -i x-frontfall-
```

The deployer pulls the image if the host no longer has it, waits for the container to be healthy and prints `Déployé : <tag>`. It takes under a minute when the image is on the host. Any tag of a commit on `main` works: `git log --first-parent --format=%h --abbrev=12 origin/main` lists them.

The next push to `main` deploys again. Revert the faulty commit on `main` before anything else is merged, or the rollback lasts only until then.

## Back up and restore

The data volume (usage counts, accounts, reports and bans in `data.db`, and the monthly usage files in `usage/months/`) is copied every night, encrypted, to storage outside the host. From this release on, the copy must be taken from `frontfall-admin backup`, never from the live `data.db` ([self-hosting](self-hosting.md#backing-up-and-restoring)): the host job runs `docker exec frontfall-frontfall-1 sh -c 'frontfall-admin backup /tmp/frontfall.db >&2 && cat /tmp/frontfall.db; status=$?; rm -f /tmp/frontfall.db; exit $status'` with its output written to a file readable by root only, then copies `usage/months/` out of the volume (`docker cp frontfall-frontfall-1:/var/lib/frontfall/usage/months …`). `docker cp` cannot take the backup file itself: `/tmp` in the container is a `tmpfs` mount, which it does not read. A restore puts it back as `data.db`, owned by uid 1000, with `data.db-wal` and `data.db-shm` removed. On the host, as the administrator:

```sh
sudo nclsmgr-restaurer-frontfall --essai       # rehearsal: reads the latest copy, checks every file, touches nothing
sudo nclsmgr-restaurer-frontfall --confirmer   # restore: stops the game, replaces the volume, starts it again
```

The rehearsal of 28 October 2026 took 3 seconds for 7 files. A real restore adds the stop (up to 30 seconds, running games are cut) and the wait for a healthy container, so plan for about two minutes. The previous content of the volume is set aside and removed only once the game is healthy again. [Self-hosting](self-hosting.md#backing-up-and-restoring) covers a server of your own.

## Bans and reports

```sh
docker exec frontfall-frontfall-1 frontfall-admin reports list --days 7
docker exec frontfall-frontfall-1 frontfall-admin bans add <reference-or-address> --days 7 --note insults
docker exec frontfall-frontfall-1 frontfall-admin bans list
docker exec frontfall-frontfall-1 frontfall-admin bans remove <reference-or-address>
```

The running server reads a ban at once and closes the connections it bans ([server.md](server.md#reports-and-bans)).

## After an alert

1. Check `/healthz` from your own machine: a Cloudflare or network incident is not a game outage.
2. On the host, `docker ps --filter name=frontfall`. If the container is stopped, start it with `docker start frontfall-frontfall-1`.
3. Read the last logs. A `server_started` line right before the alert means the container crashed and restarted; the lines before it say why.
4. If the alert follows a deployment, roll back to the previous tag.
5. If `/healthz` says `stalled`, restart, then look at `frontfall_turn_duration_seconds` and the number of games before the alert.
