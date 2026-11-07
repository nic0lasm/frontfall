import { encodeServerMessage, type Frame } from "@frontfall/protocol";
import type { Clock } from "./clock.ts";
import type { Directory } from "./directory.ts";
import { DRAIN_CHECK_MS } from "./server-options.ts";
import type { ServerStatus } from "./status-page.ts";

/**
 * Games a restart would cut short: started, with a player connected or
 * still holding a seat to come back to. A deployment waits for none to be
 * left; lobbies are told and closed.
 */
export function runningGames(games: Directory): number {
  let count = 0;
  for (const room of games.all()) {
    if (room.state === "running" && room.playerCount > 0) count++;
  }
  return count;
}

/** The announcement of a restart in `inMs`, or of none when it is null. */
export function maintenanceMessage(inMs: number | null): Frame {
  return encodeServerMessage({
    type: "maintenance",
    inMs: inMs === null ? null : Math.max(0, Math.round(inMs)),
  });
}

/** What shutting down does, in the order it does it; the server's other parts provide them. */
export interface Shutdown {
  /** Tells every connection that has said hello. */
  broadcast(frame: Frame): void;
  /** Writes the usage counts and the reports. */
  saveCounts(): void;
  /** Stops the turn timer and the heartbeat. */
  stopTimers(): void;
  /** Saves the running games for the next run. */
  keepGames(): void;
  /** Closes every connection and the transport. */
  disconnect(): Promise<void>;
}

export interface LifecycleSettings {
  clock: Clock;
  games: Directory;
  version: string;
  release: string;
  simulation: string;
  /** Whether running games are saved on close: they then need no drain. */
  keepsGames: boolean;
  /** How long running games may go on after close() when they are not kept. */
  drainMs: number;
}

/** Whether the server is closing, the restart it announced, and the drain at the end. */
export interface Lifecycle {
  /** Whether close() has begun: no new game opens. */
  stopping: () => boolean;
  /** The announcement of a restart due after `now`, if one is. */
  maintenance: (now: number) => Frame | undefined;
  /**
   * Announces a restart in `minutes`, or calls it off at 0. Returns the
   * message every player is to be told.
   */
  announce(minutes: number): Frame;
  /** What /api/status and /status report. */
  status(): ServerStatus;
  /**
   * Lobbies end at once, running games play on for `drainMs` at most, and
   * then everything stops. A second call returns the first one's promise.
   */
  close(parts: Shutdown): Promise<void>;
}

export function createLifecycle(settings: LifecycleSettings): Lifecycle {
  const { clock, games } = settings;
  let stopping = false;
  let closing: Promise<void> | undefined;
  /** When an announced restart is due, as `clock.now()` time. */
  let maintenanceAt: number | undefined;
  /** When this run of the server began: a reader polling /api/status sees a restart by it changing. */
  const startedAt = new Date(clock.now()).toISOString();

  const dueIn = (now: number): number | undefined =>
    maintenanceAt !== undefined && maintenanceAt > now ? maintenanceAt - now : undefined;

  return {
    stopping: () => stopping,
    maintenance(now) {
      const left = dueIn(now);
      return left === undefined ? undefined : maintenanceMessage(left);
    },
    announce(minutes) {
      maintenanceAt = minutes > 0 ? clock.now() + minutes * 60_000 : undefined;
      return maintenanceMessage(minutes > 0 ? minutes * 60_000 : null);
    },
    status() {
      let lobbies = 0;
      let players = 0;
      for (const room of games.all()) {
        if (room.state === "open" || room.state === "starting") lobbies++;
        players += room.connectedCount;
      }
      return {
        version: settings.version,
        release: settings.release,
        simulation: settings.simulation,
        keepsGames: settings.keepsGames,
        state: stopping ? "stopping" : "ok",
        players,
        running: runningGames(games),
        lobbies,
        restartInMs: dueIn(clock.now()) ?? null,
        startedAt,
      };
    },
    close(parts) {
      if (closing) return closing;
      stopping = true;
      // Lobbies would never start: they end now. Running games play on.
      for (const room of games.all()) if (room.state !== "running") room.stop("restart");
      games.sweep();
      // Games that are kept need no drain: they stop at once and go on after the restart.
      const drainFor = settings.keepsGames ? 0 : settings.drainMs;
      const deadline = clock.monotonic() + drainFor;
      if (drainFor > 0 && runningGames(games) > 0) {
        parts.broadcast(maintenanceMessage(drainFor));
      }
      closing = new Promise<void>((resolve) => {
        const finish = (): void => {
          parts.saveCounts();
          parts.stopTimers();
          parts.keepGames();
          games.stopAll("restart");
          void parts.disconnect().then(resolve);
        };
        const check = (): void => {
          if (runningGames(games) > 0 && clock.monotonic() < deadline) {
            clock.setTimeout(check, DRAIN_CHECK_MS);
          } else finish();
        };
        check();
      });
      return closing;
    },
  };
}
