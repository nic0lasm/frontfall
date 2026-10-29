import { DEFAULT_RULES } from "@frontfall/protocol";
import type { AuthOptions } from "./auth.ts";
import type { Logger } from "./log.ts";
import type { RoomSettings } from "./room.ts";

export type GameSettings = Omit<RoomSettings, "visibility" | "name">;

export interface ServerOptions {
  /** Directory of the built client. */
  staticRoot: string;
  /** Only WebSockets opened by pages of this origin are accepted. Unset accepts any. */
  allowedOrigin?: string | undefined;
  /** Build identifier, returned by /healthz so a deployment can be checked. */
  version: string;
  /** Release of the game, such as 0.4.0, returned by /healthz next to the build. */
  release?: string;
  /**
   * Simulation build (docs/protocol.md): pages that send another one in
   * `hello` are asked to reload. Unset compares with the build instead.
   */
  simulation?: string;
  pingIntervalMs?: number;
  maxConnectionsPerAddress?: number;
  /** Open WebSockets the whole server accepts. */
  maxConnections?: number;
  /** Games not yet started, public or private, that one address may hold. */
  maxLobbiesPerAddress?: number;
  maxRooms?: number;
  /** How long the public list of games is reused before it is built again; 1 s by default. */
  gameListMs?: number;
  /** Players seated at once; new ones get `too_many_games` beyond, those of running games still rejoin. */
  maxPlayers?: number;
  /** Bytes all turn logs may take together before new players are turned away. */
  maxLogBytes?: number;
  /** Bots the host of a private game may add, within the map's player count. */
  maxBots?: number;
  /** /healthz fails once no turn has been closed for this long. */
  stallAfterMs?: number;
  /** A connection must say hello within this delay. */
  helloTimeoutMs?: number;
  /** A connection whose seat is claimed must answer a ping within this delay. */
  probeTimeoutMs?: number;
  /** A connection that is in no game for this long is closed. */
  idleTimeoutMs?: number;
  /** On close, how long running games may go on before they are stopped. */
  drainMs?: number;
  /** More of /status, as HTML that is already escaped, such as usage figures. */
  statusSections?: () => string;
  /** Messages a connection may send per second on average, and at once. */
  messageRate?: { perSecond: number; burst: number };
  /** WebSockets one address may open per second on average, and at once. */
  upgradeRate?: { perSecond: number; burst: number };
  /** Reports one address may send per second on average, and at once (R-MODE-06). */
  reportRate?: { perSecond: number; burst: number };
  /** Public games opened by "play", which start on their own after a countdown. */
  publicGame?: Partial<GameSettings>;
  /** Games a host creates, public or private, and starts themselves. */
  privateGame?: Partial<GameSettings>;
  logger?: Logger;
  /**
   * Directory the server keeps data in between restarts: the usage counts in
   * `usage/`, and in `games/` the games running when it stopped, which the
   * next run of the same simulation build takes back. Unset keeps the counts
   * in memory only, and running games end with the server.
   */
  dataDir?: string | undefined;
  /**
   * Sign-in with Discord or Google (docs/server.md#accounts). Needs `dataDir`,
   * where the accounts are kept; without it, or without any service, the
   * game is played as a guest only and the page shows no sign-in button.
   */
  auth?: AuthOptions | undefined;
  /** How often the usage counts are written to the data directory. */
  usageSaveIntervalMs?: number;
}

/** Cloudflare drops a WebSocket that stays silent for 100 s. */
export const DEFAULT_PING_INTERVAL_MS = 25_000;

/** How often a draining server looks for games still running. */
export const DRAIN_CHECK_MS = 250;

export const DEFAULT_GAME: GameSettings = {
  map: "world",
  capacity: 16,
  autoStart: true,
  bots: 0,
  difficulty: "normal",
  nations: true,
  teams: 0,
  disabled: 0,
  speed: 1,
  rules: { ...DEFAULT_RULES },
  minPlayers: 2,
  countdownMs: 60_000,
  hostIdleMs: 2 * 60_000,
  soloBots: 0,
  reconnectGraceMs: 5 * 60_000,
  lobbyGraceMs: 30_000,
  maxDurationMs: 4 * 60 * 60 * 1000,
  lobbyTimeoutMs: 10 * 60 * 1000,
  maxOrdersPerTurn: 10,
  seatsPerAddress: 3,
  // A busy 4-hour game logs about 2 MiB; the order limits allow ten times more.
  maxLogBytes: 16 * 1024 * 1024,
};
