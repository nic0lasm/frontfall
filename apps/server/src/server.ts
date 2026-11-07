import { clientAddress as addressOf } from "./address.ts";
import { BunTransport } from "./bun-transport.ts";
import { systemClock } from "./clock.ts";
import { loadMapLimits, type MapLimits } from "./catalog.ts";
import { messageHandler } from "./client-messages.ts";
import { Directory } from "./directory.ts";
import { createRoutes } from "./http/routes.ts";
import { systemIds, type Ids } from "./ids.ts";
import { createLifecycle } from "./lifecycle.ts";
import { addressPseudonym, silentLogger, type Logger } from "./log.ts";
import { Metrics } from "./metrics.ts";
import { isAllowedOrigin } from "./origin.ts";
import { openPersistence, startAuth } from "./persistence.ts";
import type { RoomObserver } from "./room.ts";
import { roomObserver } from "./room-observer.ts";
import { DEFAULT_GAME, type ServerOptions } from "./server-options.ts";
import type { HttpRequest } from "./transport.ts";
import { startTurnTimer } from "./turn-timer.ts";
import { usageInbox } from "./usage-http.ts";
import type { UsageStats } from "./usage.ts";
import { createAdmission } from "./ws/admission.ts";
import { createSessions } from "./ws/sessions.ts";

export { closeReason } from "./client-messages.ts";
export { DEFAULT_GAME, type ServerOptions } from "./server-options.ts";
export { statusPage, type ServerStatus } from "./status-page.ts";
export type * from "./transport.ts";
export { BunTransport } from "./bun-transport.ts";

/** Largest frame a client may send. Orders take a few bytes, hello a few dozen. */
const MAX_PAYLOAD_BYTES = 1024;

/**
 * Players seated at once by default, and bytes of turn logs: what one core and
 * a 512 MiB container serve with room to spare (docs/capacity.md).
 */
const DEFAULT_MAX_PLAYERS = 3000;
const DEFAULT_MAX_LOG_BYTES = 192 * 2 ** 20;

export interface GameServer {
  /**
   * Starts taking HTTP requests and WebSockets on `port` of `host`, every
   * address when unset; 0 picks a free port, which the answer gives.
   */
  listen(port: number, host?: string): Promise<{ port: number }>;
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

/**
 * The directory of games, and the limits of the maps it offers. The public
 * game opens on the map of `publicGame`, with that map's bots to fill a quick game.
 */
function openDirectory(
  options: ServerOptions,
  observer: RoomObserver,
  ids: Ids,
): { games: Directory; maps: MapLimits } {
  const privateGame = { ...DEFAULT_GAME, minPlayers: 1, countdownMs: 0, ...options.privateGame };
  const maps = loadMapLimits(options.staticRoot, privateGame.map);
  const publicMap = options.publicGame?.map ?? DEFAULT_GAME.map;
  const publicGame = {
    ...DEFAULT_GAME,
    soloBots: maps.get(publicMap)?.bots ?? 0,
    ...options.publicGame,
  };
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
    ids,
  });
  return { games, maps };
}

/**
 * Builds the server from its parts, each in its own module: games, what is
 * kept on disk, the routes, admission and sessions of WebSockets, the turn
 * timer and the shutdown. Nothing listens until `listen`.
 */
export function createGameServer(options: ServerOptions): GameServer {
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? systemIds;
  const logger: Logger = options.logger ?? silentLogger;
  const transport = options.transport ?? new BunTransport();
  const simulation = options.simulation ?? options.version;
  const pseudonym = addressPseudonym(ids.bytes(32));
  const metrics = new Metrics();
  const clientAddress = (request: HttpRequest): string =>
    addressOf(request, options.trustProxy ?? true);
  const connectionCount = (): number => transport.connectionCount;

  const { games, maps } = openDirectory(options, roomObserver(metrics, logger), ids);
  const persistence = openPersistence({
    options,
    clock,
    ids,
    logger,
    games,
    maps: new Set(maps.keys()),
    simulation,
  });
  const { usage, moderation } = persistence;
  const reports = usageInbox(
    usage,
    logger,
    (origin) => isAllowedOrigin(origin, options.allowedOrigin),
    () => clock.now(),
  );
  const auth = startAuth(options, persistence.db, clock, ids, logger);
  const lifecycle = createLifecycle({
    clock,
    games,
    version: options.version,
    release: options.release ?? "dev",
    simulation: options.simulation ?? "dev",
    keepsGames: persistence.keepsGames,
    drainMs: options.drainMs ?? 20_000,
  });
  const handler = messageHandler({
    games,
    accounts: auth?.accounts,
    operators: options.operatorAccounts ?? new Set(),
    maps,
    maxBots: options.maxBots ?? 25,
    simulation,
    metrics,
    logger,
    stopping: lifecycle.stopping,
    moderation,
    clock,
    maintenance: lifecycle.maintenance,
  });
  const sessions = createSessions({
    options,
    clock,
    logger,
    metrics,
    games,
    moderation,
    transport,
    handler,
    accountOf: (request) => auth?.accountOf(request)?.id,
    clientAddress,
    pseudonym,
  });
  const timer = startTurnTimer(clock, games, metrics);
  transport.serve({
    maxPayloadBytes: MAX_PAYLOAD_BYTES,
    request: createRoutes({
      options,
      clock,
      logger,
      games,
      metrics,
      moderation,
      usage,
      lifecycle,
      sessions,
      auth,
      reports,
      timer,
      clientAddress,
      connectionCount,
    }),
    upgrade: createAdmission({
      options,
      clock,
      metrics,
      connectionCount,
      clientAddress,
      welcome: sessions.welcome,
    }),
  });
  const heartbeat = sessions.startHeartbeat();

  return {
    listen: (port, host) => transport.listen(port, host),
    games,
    metrics,
    usage,
    close: () =>
      lifecycle
        .close({
          broadcast: sessions.broadcast,
          saveCounts: persistence.saveCounts,
          stopTimers: () => {
            heartbeat.clear();
            timer.stop();
          },
          keepGames: persistence.keepGames,
          disconnect: () => {
            for (const socket of transport.connections()) socket.close(1012, "server restarting");
            return transport.close();
          },
        })
        .finally(() => {
          persistence.close();
        }),
  };
}
