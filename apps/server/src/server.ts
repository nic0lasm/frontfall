import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CloseCode,
  encodeServerMessage,
  parseClientMessage,
  TICK_RATE,
  type Frame,
} from "@frontfall/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import { Accounts, accountsFile } from "./accounts.ts";
import { createAuth, type Auth } from "./auth.ts";
import { loadMapLimits } from "./catalog.ts";
import { Directory } from "./directory.ts";
import { addressPseudonym, silentLogger } from "./log.ts";
import { Metrics, type Snapshot } from "./metrics.ts";
import { Moderation, validTarget } from "./moderation.ts";
import { clientAddress as addressOf, isLocalRequest, isLoopbackRequest } from "./address.ts";
import { isAllowedOrigin } from "./origin.ts";
import { AddressRate, TokenBucket } from "./rate-limit.ts";
import type { RoomObserver } from "./room.ts";
import {
  cachedJson,
  SECURITY_HEADERS,
  sendCachedJson,
  sendJson,
  serveStatic,
  type CachedJson,
} from "./http-replies.ts";
import {
  DEFAULT_GAME,
  DEFAULT_PING_INTERVAL_MS,
  DRAIN_CHECK_MS,
  type ServerOptions,
} from "./server-options.ts";
import { messageHandler, toFrame, type Session } from "./client-messages.ts";
import { gamesDirectory, loadGames, saveGame } from "./saved-games.ts";
import { statusPage, type ServerStatus } from "./status-page.ts";
import { usageInbox } from "./usage-http.ts";
import { clientErrorsFile, loadClientErrors, saveClientErrors } from "./client-errors.ts";
import {
  exportMonths,
  loadUsage,
  monthsDirectory,
  saveUsage,
  usageFile,
  UsageStats,
  usageTable,
} from "./usage.ts";

export { closeReason } from "./client-messages.ts";
export { DEFAULT_GAME, type ServerOptions } from "./server-options.ts";
export { statusPage, type ServerStatus } from "./status-page.ts";

/** Largest frame a client may send. Orders take a few bytes, hello a few dozen. */
const MAX_PAYLOAD_BYTES = 1024;

/**
 * A client that leaves this much unread, a sleeping tab or a stalled network,
 * is dropped: it rejoins from its last turn, and its backlog never weighs on the
 * server. A 4-hour game sent whole takes about 1.5 MiB, in frames paced apart.
 */
const MAX_BUFFERED_BYTES = 4 * 2 ** 20;

/** Passes of the turn timer in one tick, each over a share of the games. */
const TURN_PASSES = 10;

/**
 * Players seated at once by default, and bytes of turn logs: what one core and
 * the 512 MiB heap of the image serve with room to spare (docs/capacity.md).
 */
const DEFAULT_MAX_PLAYERS = 3000;
const DEFAULT_MAX_LOG_BYTES = 192 * 2 ** 20;

export interface GameServer {
  readonly http: Server;
  readonly games: Directory;
  readonly metrics: Metrics;
  /** Counts of what players do, from the reports of their pages; /api/stats exports them. */
  readonly usage: UsageStats;
  /**
   * Stops opening games and lets the running ones go on, for `drainMs` at
   * most, then tells every player the server is restarting and stops.
   */
  close(): Promise<void>;
}

export function createGameServer(options: ServerOptions): GameServer {
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  // Players behind one home router or a mobile carrier share an address.
  const maxConnectionsPerAddress = options.maxConnectionsPerAddress ?? 16;
  const maxConnections = options.maxConnections ?? 5_000;
  const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
  const probeTimeoutMs = options.probeTimeoutMs ?? 5_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
  const messageRate = options.messageRate ?? { perSecond: 20, burst: 40 };
  // A whole household reconnecting after a restart fits in the burst; a script
  // that opens connections in a loop runs dry at one every two seconds.
  const upgradeRate = options.upgradeRate ?? { perSecond: 0.5, burst: 40 };
  const stallAfterMs = options.stallAfterMs ?? 5000;
  const drainMs = options.drainMs ?? 20_000;
  const gameListMs = options.gameListMs ?? 1000;
  /** End of the last pass of the turn timer, and whether close() has begun. */
  let lastTurnAt = performance.now();
  let stopping = false;
  let closing: Promise<void> | undefined;
  /** When an announced restart is due, as `Date.now()` time. */
  let maintenanceAt: number | undefined;
  /** When this run of the server began: a reader polling /api/status sees a restart by it changing. */
  const startedAt = new Date().toISOString();
  const logger = options.logger ?? silentLogger;
  const pseudonym = addressPseudonym();
  const metrics = new Metrics();

  const observer: RoomObserver = {
    started(room) {
      metrics.gamesStarted.inc({
        visibility: room.settings.visibility,
        map: room.settings.map,
        teams: String(room.settings.teams),
      });
      logger.info("game_started", {
        game: room.id,
        visibility: room.settings.visibility,
        players: room.playerCount,
      });
    },
    finished(room, reason) {
      metrics.gamesFinished.inc({ reason });
      if (room.log.length > 0) metrics.gameMinutes.observe(room.log.length / TICK_RATE / 60);
      logger.info("game_finished", { game: room.id, reason, ticks: room.log.length });
    },
    desync(room, tick, hash, expected) {
      metrics.desyncs.inc();
      logger.warn("desync", { game: room.id, tick, hash, expected: expected ?? null });
    },
  };
  const privateGame = { ...DEFAULT_GAME, minPlayers: 1, countdownMs: 0, ...options.privateGame };
  const maps = loadMapLimits(options.staticRoot, privateGame.map);
  const publicMap = options.publicGame?.map ?? DEFAULT_GAME.map;
  const publicGame = {
    ...DEFAULT_GAME,
    soloBots: maps.get(publicMap)?.bots ?? 0,
    ...options.publicGame,
  };
  const maxBots = options.maxBots ?? 25;
  const games = new Directory({
    maxRooms: options.maxRooms ?? 500,
    maxPlayers: options.maxPlayers ?? DEFAULT_MAX_PLAYERS,
    maxLogBytes: options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES,
    maxLobbiesPerOwner: options.maxLobbiesPerAddress ?? 3,
    ...(options.maxGamesPerAddress !== undefined && {
      maxGamesPerOwner: options.maxGamesPerAddress,
    }),
    publicGame,
    privateGame,
    observer,
  });
  const simulation = options.simulation ?? options.version;
  const savedGames = options.dataDir === undefined ? undefined : gamesDirectory(options.dataDir);
  if (savedGames !== undefined) {
    const { games: saved, refused } = loadGames(savedGames, simulation);
    const now = Date.now();
    for (const game of saved) {
      if (games.restore(game, now))
        logger.info("game_restored", { game: game.id, ticks: game.log.ends.length });
      else refused.push({ file: game.id, reason: "unreadable" });
    }
    for (const { file, reason } of refused) logger.warn("game_not_restored", { file, reason });
  }
  /**
   * Saves the running games for the next run, which takes them back if it has
   * the same simulation build. Their players are not told the game ended:
   * their pages reconnect until the server is back.
   */
  const keepGames = (): void => {
    if (savedGames === undefined) return;
    const now = Date.now();
    for (const room of games.all()) {
      const saved = room.playerCount > 0 ? room.save(now) : undefined;
      if (!saved) continue;
      try {
        saveGame(savedGames, simulation, saved);
        room.suspend();
        logger.info("game_saved", { game: room.id, ticks: room.log.length });
      } catch (error) {
        logger.warn("game_not_saved", { game: room.id, error: (error as Error).message });
      }
    }
  };
  const usage = new UsageStats({ release: options.release ?? "dev", maps: new Set(maps.keys()) });
  const usageAt = options.dataDir === undefined ? undefined : usageFile(options.dataDir);
  const errorsAt = options.dataDir === undefined ? undefined : clientErrorsFile(options.dataDir);
  if (usageAt === undefined) {
    logger.warn("usage_in_memory", { reason: "no data directory" });
  } else {
    const error = loadUsage(usage, usageAt);
    if (error) logger.warn("usage_not_loaded", { error: error.message });
  }
  if (errorsAt !== undefined) {
    const error = loadClientErrors(usage.errors, errorsAt);
    if (error) logger.warn("client_errors_not_loaded", { error: error.message });
  }
  /** Writes the usage counts, if there is somewhere to keep them; never stops the server. */
  const keepUsage = (): void => {
    if (usageAt === undefined) return;
    try {
      saveUsage(usage, usageAt, Date.now());
      exportMonths(usage, monthsDirectory(usageAt), Date.now(), (message) => {
        logger.warn("usage_month_bad", { error: message });
      });
    } catch (error) {
      logger.warn("usage_not_saved", { error: (error as Error).message });
    }
    if (errorsAt === undefined) return;
    try {
      saveClientErrors(usage.errors, errorsAt, Date.now());
    } catch (error) {
      logger.warn("client_errors_not_saved", { error: (error as Error).message });
    }
  };
  const moderation = new Moderation(options.dataDir, Date.now(), options.reportRate);
  try {
    moderation.reload();
  } catch (error) {
    logger.warn("bans_not_loaded", { error: (error as Error).message });
  }
  const usageSaver = setInterval(keepUsage, options.usageSaveIntervalMs ?? 5 * 60_000);
  usageSaver.unref();
  const reports = usageInbox(usage, logger, (origin) =>
    isAllowedOrigin(origin, options.allowedOrigin),
  );
  const auth = startAuth();
  /** When the oldest ping a socket has not answered yet was sent. */
  const unanswered = new WeakMap<WebSocket, number>();
  const ping = (socket: WebSocket, now: number): void => {
    if (!unanswered.has(socket)) unanswered.set(socket, now);
    socket.ping();
  };
  /** The last public list sent, and when it was built. */
  let gameList: { at: number; body: CachedJson } | undefined;
  const clientAddress = (request: IncomingMessage): string =>
    addressOf(request, options.trustProxy ?? true);
  const connectionsByAddress = new Map<string, number>();
  const upgrades = new AddressRate(upgradeRate.perSecond, upgradeRate.burst, Date.now());

  const http = createServer((request, response) => {
    // `//host/path` or `/\host/path` would parse as another host's path, past a proxy's matchers.
    if (
      !request.url?.startsWith("/") ||
      request.url.startsWith("//") ||
      request.url.includes("\\")
    ) {
      response.writeHead(400).end();
      return;
    }
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/healthz") {
      // An event loop that is blocked cannot answer at all; this catches a turn
      // timer that has stopped or fallen far behind while requests still get through.
      const status = stopping
        ? "stopping"
        : performance.now() - lastTurnAt > stallAfterMs
          ? "stalled"
          : "ok";
      response
        .writeHead(status === "ok" ? 200 : 503, {
          "content-type": "text/plain",
          "cache-control": "no-store",
          "x-frontfall-version": options.version,
          ...(options.release ? { "x-frontfall-release": options.release } : {}),
        })
        .end(status);
      return;
    }
    if (path === "/admin/maintenance" && isLoopbackRequest(request)) {
      announce(request, response);
      return;
    }
    if (path.startsWith("/admin/")) {
      if (!isLoopbackRequest(request)) response.writeHead(404).end();
      else if (path === "/admin/reports") reportsAnswer(request, response);
      else if (path === "/admin/bans") bansAnswer(request, response);
      else if (path === "/admin/errors") errorsAnswer(request, response);
      else response.writeHead(404).end();
      return;
    }
    if (auth?.handle(request, response, path, clientAddress(request))) return;
    if (path === "/api/me" && (request.method === "GET" || request.method === "HEAD")) {
      // Guests only: the page shows no sign-in button.
      sendJson(response, { providers: [], account: null });
      return;
    }
    if (path === "/api/usage") {
      reports.handle(request, response, clientAddress(request));
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    if (path === "/api/games") {
      // Every menu asks every few seconds: the list is built once a second at most.
      const now = performance.now();
      if (gameList === undefined || now - gameList.at >= gameListMs) {
        gameList = {
          at: now,
          body: cachedJson({ games: games.publicGames(), running: running() }),
        };
      }
      sendCachedJson(request, response, gameList.body);
      return;
    }
    if (path === "/api/status") {
      sendJson(response, status());
      return;
    }
    if (path === "/status") {
      response
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          ...SECURITY_HEADERS,
        })
        .end(
          request.method === "HEAD"
            ? undefined
            : statusPage(
                status(),
                usageTable(usage.export(Date.now())) + (options.statusSections?.() ?? ""),
              ),
        );
      return;
    }
    if (path === "/api/stats") {
      // Totals by the day: a minute late is fine, and spares the server repeated scrapes.
      sendJson(response, usage.export(Date.now()), "public, max-age=60");
      return;
    }
    if (path === "/metrics" && isLocalRequest(request)) {
      response
        .writeHead(200, {
          "content-type": "text/plain; version=0.0.4",
          "cache-control": "no-store",
        })
        .end(metrics.render(snapshot(), usage.renderMetrics()));
      return;
    }
    serveStatic(options.staticRoot, path, request, response);
  });

  // Headers that trickle in, or a body that never ends, must not hold a socket
  // for minutes: a proxy usually cuts them sooner, a server reached directly relies on this.
  http.headersTimeout = 10_000;
  http.requestTimeout = 30_000;

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  http.on("upgrade", (request, socket, head) => {
    const path =
      request.url?.startsWith("//") || request.url?.includes("\\")
        ? ""
        : new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== "/ws" || !isAllowedOrigin(request.headers.origin, options.allowedOrigin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    if (sockets.clients.size >= maxConnections) {
      // Opened and closed at once with a code the page understands: it says the
      // server is full and waits longer, where a refused handshake looks like a network fault.
      metrics.refused.inc({ reason: "connections" });
      sockets.handleUpgrade(request, socket, head, (ws) => {
        ws.close(CloseCode.full, "server full");
      });
      return;
    }
    const address = clientAddress(request);
    const connections = connectionsByAddress.get(address) ?? 0;
    if (connections >= maxConnectionsPerAddress || !upgrades.take(address, Date.now())) {
      metrics.refused.inc({ reason: "address" });
      socket.end("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      return;
    }
    connectionsByAddress.set(address, connections + 1);
    // On the raw socket, not the WebSocket: a refused handshake never makes one,
    // and its slot would otherwise stay taken until the server restarts.
    socket.once("close", () => {
      const remaining = (connectionsByAddress.get(address) ?? 1) - 1;
      if (remaining > 0) connectionsByAddress.set(address, remaining);
      else connectionsByAddress.delete(address);
    });
    sockets.handleUpgrade(request, socket, head, (ws) => {
      sockets.emit("connection", ws, request);
    });
  });

  const { handle, reject, seatOf } = messageHandler({
    games,
    accounts: auth?.accounts,
    operators: options.operatorAccounts ?? new Set(),
    maps,
    maxBots,
    simulation,
    metrics,
    logger,
    stopping: () => stopping,
    moderation,
    maintenance: (now) =>
      maintenanceAt !== undefined && maintenanceAt > now
        ? maintenanceMessage(maintenanceAt - now)
        : undefined,
  });

  const sessions = new Set<Session>();

  sockets.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    /** A catch-up under way: the frames left, and the messages held until its end. */
    let replaying: { frames: Iterator<Frame>; held: Frame[] } | undefined;
    // One frame at a time, the next once the last is handed to the network: a
    // rejoin from the first turn of a long game never piles up in memory.
    const pump = (): void => {
      const current = replaying;
      if (!current || socket.readyState !== socket.OPEN) return;
      const next = current.frames.next();
      if (next.done !== true) {
        socket.send(next.value, pump);
        return;
      }
      replaying = undefined;
      for (const frame of current.held) socket.send(frame);
    };
    const session: Session = {
      socket,
      address: clientAddress(request),
      client: pseudonym(clientAddress(request)),
      account: auth?.accountOf(request)?.id,
      messages: new TokenBucket(messageRate.perSecond, messageRate.burst, Date.now()),
      name: undefined,
      room: undefined,
      seat: undefined,
      idleSince: undefined,
      closing: false,
      peer: {
        send(frame) {
          if (socket.readyState !== socket.OPEN) return;
          if (replaying) {
            // The catch-up runs on to the newest turn; other messages wait for its end.
            if (typeof frame === "string") replaying.held.push(frame);
            return;
          }
          if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
            metrics.slowClients.inc();
            socket.terminate();
            return;
          }
          socket.send(frame);
        },
        replay(frames, last) {
          replaying = { frames: frames[Symbol.iterator](), held: last === undefined ? [] : [last] };
          pump();
        },
        probe() {
          const sentAt = Date.now();
          ping(socket, sentAt);
          setTimeout(() => {
            const since = unanswered.get(socket);
            if (since !== undefined && since <= sentAt) socket.terminate();
          }, probeTimeoutMs).unref();
        },
      },
    };
    if (turnAwayBanned(session)) return;
    sessions.add(session);

    const helloTimer = setTimeout(() => {
      if (session.name === undefined) reject(session, CloseCode.idle, "no hello", "idle");
    }, helloTimeoutMs);

    socket.on("pong", () => unanswered.delete(socket));
    // Protocol errors, such as an oversized frame: ws closes the socket itself.
    socket.on("error", (error: Error & { code?: string }) => {
      const label = error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH" ? "oversized" : "invalid";
      metrics.rejected.inc({ reason: label });
      logger.warn("connection_rejected", { client: session.client, reason: label });
    });

    socket.on("message", (data, isBinary) => {
      if (session.closing) return;
      metrics.messages.inc();
      if (!session.messages.take(Date.now())) {
        reject(session, CloseCode.rateLimited, "too many messages", "rate_limited");
        return;
      }
      const parsed = parseClientMessage(toFrame(data, isBinary));
      if (!parsed.ok) {
        reject(session, CloseCode.invalidMessage, parsed.error, "invalid");
        return;
      }
      handle(session, parsed.value);
    });

    socket.on("close", (code) => {
      clearTimeout(helloTimer);
      sessions.delete(session);
      const current = seatOf(session);
      // 1000 and 1001 come from a page that closed the socket itself; a lost
      // network or a phone gone to sleep closes it without a code (1006).
      if (current)
        current.room.disconnect(current.seat, Date.now(), code === 1000 || code === 1001);
      games.sweep();
    });
  });

  // Each pass closes the turns of a tenth of the games: every game still gets
  // one turn per tick, and the server answers in between. Passes keep to a
  // fixed schedule, so that the delays of timers never add up into slower games.
  const passMs = 1000 / TICK_RATE / TURN_PASSES;
  let pass = 0;
  let passAt = performance.now();
  let ticker: NodeJS.Timeout;
  const turnPass = (): void => {
    const started = performance.now();
    games.update(Date.now(), { index: pass % TURN_PASSES, of: TURN_PASSES });
    pass++;
    lastTurnAt = performance.now();
    metrics.turnDuration.observe((lastTurnAt - started) / 1000);
    // Late by more than a tick, as after a stall, the schedule starts afresh.
    passAt = Math.max(passAt + passMs, lastTurnAt - passMs * TURN_PASSES);
    ticker = setTimeout(turnPass, Math.max(0, passAt - lastTurnAt));
  };
  ticker = setTimeout(turnPass, passMs);

  /**
   * Games a restart would cut short: started, with a player connected or
   * still holding a seat to come back to. A deployment waits for none to be
   * left; lobbies are told and closed.
   */
  function running(): number {
    let count = 0;
    for (const room of games.all()) {
      if (room.state === "running" && room.playerCount > 0) count++;
    }
    return count;
  }

  function maintenanceMessage(inMs: number | null): Frame {
    return encodeServerMessage({
      type: "maintenance",
      inMs: inMs === null ? null : Math.max(0, Math.round(inMs)),
    });
  }

  /** Tells every connection that has said hello. */
  function broadcastAll(frame: Frame): void {
    for (const session of sessions) if (session.name !== undefined) session.peer.send(frame);
  }

  /**
   * POST /admin/maintenance?minutes=N, from inside the container: tells every
   * player the server restarts in N minutes; 0 calls it off. The answer gives
   * the games running, which the restart would stop.
   */
  function announce(request: IncomingMessage, response: ServerResponse): void {
    const minutes = Number(
      new URL(request.url ?? "/", "http://localhost").searchParams.get("minutes"),
    );
    if (request.method !== "POST" || !Number.isFinite(minutes) || minutes < 0 || minutes > 120) {
      response.writeHead(400, { "content-type": "text/plain" }).end("POST ?minutes=0 to 120");
      return;
    }
    maintenanceAt = minutes > 0 ? Date.now() + minutes * 60_000 : undefined;
    broadcastAll(maintenanceMessage(minutes > 0 ? minutes * 60_000 : null));
    logger.info("maintenance_announced", { minutes });
    sendJson(response, { minutes, running: running() });
  }

  /** Closes the connection of a banned address, with the code that tells its page not to retry. */
  function turnAwayBanned(session: Session): boolean {
    const ban = moderation.banned(session.address, Date.now());
    if (!ban) return false;
    session.closing = true;
    metrics.rejected.inc({ reason: "banned" });
    logger.warn("connection_rejected", { client: session.client, reason: "banned" });
    session.socket.close(
      CloseCode.banned,
      ban.until === null ? "banned" : `banned until ${ban.until}`,
    );
    return true;
  }

  /** GET /admin/reports?days=N, from inside the container: the reports of the last N days, 30 at most. */
  function reportsAnswer(request: IncomingMessage, response: ServerResponse): void {
    const days = Number(
      new URL(request.url ?? "/", "http://localhost").searchParams.get("days") ?? 30,
    );
    if (request.method !== "GET" || !Number.isFinite(days) || days <= 0) {
      response.writeHead(400, { "content-type": "text/plain" }).end("GET ?days=1 to 30");
      return;
    }
    sendJson(response, moderation.read(Date.now(), Math.min(days, 30)));
  }

  /**
   * GET /admin/errors?days=N, from inside the container: the errors players'
   * pages reported in the last N days, 30 at most, grouped, the most reported first.
   */
  function errorsAnswer(request: IncomingMessage, response: ServerResponse): void {
    const days = Number(
      new URL(request.url ?? "/", "http://localhost").searchParams.get("days") ?? 7,
    );
    if (request.method !== "GET" || !Number.isInteger(days) || days <= 0) {
      response.writeHead(400, { "content-type": "text/plain" }).end("GET ?days=1 to 30");
      return;
    }
    sendJson(response, usage.errors.read(Date.now(), Math.min(days, 30)));
  }

  /**
   * /admin/bans, from inside the container. GET lists the bans. POST
   * ?target=T[&days=N][&note=text] bans an address or a reference, for N days
   * or for good; POST without a target reads the ban file again. DELETE
   * ?target=T lifts a ban. Connections of addresses now banned are closed.
   */
  function bansAnswer(request: IncomingMessage, response: ServerResponse): void {
    const query = new URL(request.url ?? "/", "http://localhost").searchParams;
    const now = Date.now();
    const target = query.get("target");
    const days = query.has("days") ? Number(query.get("days")) : undefined;
    const usage =
      "GET, POST ?target=address-or-reference&days=N&note=text, POST to reload, DELETE ?target=";
    if (target !== null && !validTarget(target)) {
      response.writeHead(400, { "content-type": "text/plain" }).end(usage);
      return;
    }
    if (request.method === "POST" && target === null && days === undefined) {
      try {
        moderation.reload();
      } catch (error) {
        response.writeHead(422, { "content-type": "text/plain" }).end((error as Error).message);
        return;
      }
      logger.info("bans_reloaded", { bans: moderation.list(now).length });
    } else if (
      request.method === "POST" &&
      target !== null &&
      (days === undefined || (Number.isFinite(days) && days > 0))
    ) {
      moderation.ban(target, days, query.get("note")?.slice(0, 200) ?? undefined, now);
      logger.info("player_banned", { days: days ?? null });
    } else if (request.method === "DELETE" && target !== null) {
      if (!moderation.unban(target, now)) {
        response.writeHead(404, { "content-type": "text/plain" }).end("no such ban");
        return;
      }
      logger.info("ban_lifted", {});
    } else if (request.method !== "GET") {
      response.writeHead(400, { "content-type": "text/plain" }).end(usage);
      return;
    }
    let closed = 0;
    if (request.method !== "GET") {
      for (const session of sessions) if (!session.closing && turnAwayBanned(session)) closed++;
    }
    sendJson(response, { bans: moderation.list(now), closed });
  }

  /** Sign-in, when a service or a mailbox is set up and accounts have somewhere to be kept. */
  function startAuth(): Auth | undefined {
    const settings = options.auth;
    if (!settings || (Object.keys(settings.clients).length === 0 && !settings.mail))
      return undefined;
    if (options.dataDir === undefined) {
      logger.warn("accounts_off", { reason: "no data directory" });
      return undefined;
    }
    const accounts = new Accounts(accountsFile(options.dataDir), (error) => {
      logger.warn("accounts_not_saved", {
        reason: (error as NodeJS.ErrnoException).code ?? "write",
      });
    });
    const { error, usable } = accounts.load();
    if (error) logger.warn("accounts_not_loaded", { error: error.message });
    // Starting empty would replace a file that is still there at the first sign-in.
    if (!usable) {
      logger.warn("accounts_off", { reason: "accounts file cannot be read" });
      return undefined;
    }
    logger.info("accounts_loaded", { accounts: accounts.size });
    // Unset, the socket accepts any page; changes to an account never do.
    return createAuth(
      settings,
      accounts,
      logger,
      (origin) => !!options.allowedOrigin && isAllowedOrigin(origin, options.allowedOrigin),
    );
  }

  function status(): ServerStatus {
    const now = Date.now();
    let lobbies = 0;
    let players = 0;
    for (const room of games.all()) {
      if (room.state === "open" || room.state === "starting") lobbies++;
      players += room.connectedCount;
    }
    return {
      version: options.version,
      release: options.release ?? "dev",
      simulation: options.simulation ?? "dev",
      keepsGames: savedGames !== undefined,
      state: stopping ? "stopping" : "ok",
      players,
      running: running(),
      lobbies,
      restartInMs: maintenanceAt !== undefined && maintenanceAt > now ? maintenanceAt - now : null,
      startedAt,
    };
  }

  function snapshot(): Snapshot {
    const counts = { open: 0, starting: 0, running: 0 };
    let players = 0;
    for (const room of games.all()) {
      if (room.state !== "finished") counts[room.state]++;
      players += room.connectedCount;
    }
    return { games: counts, players, connections: sockets.clients.size };
  }

  /** Closes connections that have stayed out of any game for too long. */
  function closeIdle(now: number): void {
    for (const session of sessions) {
      if (session.name === undefined) continue;
      if (seatOf(session)) {
        session.idleSince = undefined;
        continue;
      }
      session.idleSince ??= now;
      if (now - session.idleSince >= idleTimeoutMs) {
        reject(session, CloseCode.idle, "idle for too long", "idle");
      }
    }
  }

  // A socket that left a ping unanswered for a whole interval is gone, even if
  // TCP has not noticed yet. Timer drift is allowed for with half an interval.
  const heartbeat = setInterval(() => {
    const now = Date.now();
    closeIdle(now);
    for (const socket of sockets.clients) {
      const since = unanswered.get(socket);
      if (since !== undefined && now - since >= pingIntervalMs / 2) socket.terminate();
      else ping(socket, now);
    }
  }, pingIntervalMs);

  return {
    http,
    games,
    metrics,
    usage,
    close() {
      if (closing) return closing;
      stopping = true;
      // Lobbies would never start: they end now. Running games play on.
      for (const room of games.all()) if (room.state !== "running") room.stop("restart");
      games.sweep();
      // Games that are kept need no drain: they stop at once and go on after the restart.
      const drainFor = savedGames === undefined ? drainMs : 0;
      const deadline = performance.now() + drainFor;
      if (drainFor > 0 && running() > 0) broadcastAll(maintenanceMessage(drainFor));
      closing = new Promise<void>((resolve) => {
        const finish = (): void => {
          clearInterval(usageSaver);
          keepUsage();
          try {
            moderation.flush();
          } catch (error) {
            logger.warn("reports_not_saved", { error: (error as Error).message });
          }
          clearInterval(heartbeat);
          clearTimeout(ticker);
          keepGames();
          games.stopAll("restart");
          for (const socket of sockets.clients) socket.close(1012, "server restarting");
          http.close(() => {
            resolve();
          });
        };
        const check = (): void => {
          if (running() > 0 && performance.now() < deadline) setTimeout(check, DRAIN_CHECK_MS);
          else finish();
        };
        check();
      });
      return closing;
    },
  };
}
