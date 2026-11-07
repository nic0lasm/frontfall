import { Accounts } from "./accounts.ts";
import { createAuth, type Auth } from "./auth.ts";
import type { Clock } from "./clock.ts";
import { loadClientErrors, saveClientErrors } from "./client-errors.ts";
import { openDatabase } from "./database.ts";
import type { Directory } from "./directory.ts";
import type { Ids } from "./ids.ts";
import { ignoredStoreFiles, importJsonStores } from "./import-json.ts";
import type { Logger } from "./log.ts";
import { Moderation } from "./moderation.ts";
import { isAllowedOrigin } from "./origin.ts";
import { loadGames, saveGame } from "./saved-games.ts";
import type { ServerOptions } from "./server-options.ts";
import { transaction, type SqlDriver } from "./sql/driver.ts";
import { openNodeSqlite } from "./sql/node-sqlite.ts";
import { exportMonths, loadUsage, monthsDirectory, saveUsage, UsageStats } from "./usage.ts";

export interface PersistenceSettings {
  options: ServerOptions;
  clock: Clock;
  ids: Ids;
  logger: Logger;
  games: Directory;
  /** The maps the server knows, which the usage counts accept. */
  maps: ReadonlySet<string>;
  /** Simulation build the saved games belong to. */
  simulation: string;
}

/** What the server keeps in its data directory, loaded at the start and saved on a schedule and at the end. */
export interface Persistence {
  /** data.db in the data directory; undefined without one, when everything stays in memory. */
  readonly db: SqlDriver | undefined;
  readonly usage: UsageStats;
  readonly moderation: Moderation;
  /** Whether running games are saved on close and taken back at the next start. */
  readonly keepsGames: boolean;
  /**
   * Saves the running games for the next run, which takes them back if it has
   * the same simulation build. Their players are not told the game ended:
   * their pages reconnect until the server is back.
   */
  keepGames: () => void;
  /** Stops the periodic save, then writes the usage counts and the reports; never throws. */
  saveCounts: () => void;
  /** Closes data.db, once everything is saved. */
  close: () => void;
}

/**
 * Opens data.db in the data directory, imports the JSON files of the earlier
 * releases once, loads what the last run kept (the games, the usage counts,
 * the client errors, the bans), and starts saving the usage counts every few
 * minutes. A JSON store that does not import throws (`ImportError`): the
 * server does not start rather than start without it. Whatever else cannot
 * be read is logged and left out.
 */
export function openPersistence(settings: PersistenceSettings): Persistence {
  const { options, clock, ids, logger, games, simulation } = settings;
  const db =
    options.dataDir === undefined
      ? undefined
      : openDatabase(options.dataDir, options.openSql ?? openNodeSqlite);
  if (db !== undefined && options.dataDir !== undefined) {
    try {
      for (const { store, files, rows } of importJsonStores(db, options.dataDir, clock.now())) {
        logger.info("store_imported", { store, files: files.length, rows });
      }
      for (const { store, file } of ignoredStoreFiles(db, options.dataDir)) {
        logger.warn("store_not_imported", { store, file });
      }
    } catch (error) {
      db.close();
      throw error;
    }
  }
  if (db !== undefined) {
    const { games: saved, refused } = loadGames(db, simulation);
    const now = clock.now();
    for (const game of saved) {
      if (games.restore(game, now))
        logger.info("game_restored", { game: game.id, ticks: game.log.ends.length });
      else refused.push({ file: game.id, reason: "unreadable" });
    }
    for (const { file, reason } of refused) logger.warn("game_not_restored", { file, reason });
  }
  const keepGames = (): void => {
    if (db === undefined) return;
    const now = clock.now();
    for (const room of games.all()) {
      const saved = room.playerCount > 0 ? room.save(now) : undefined;
      if (!saved) continue;
      try {
        saveGame(db, simulation, saved);
        room.suspend();
        logger.info("game_saved", { game: room.id, ticks: room.log.length });
      } catch (error) {
        logger.warn("game_not_saved", { game: room.id, error: (error as Error).message });
      }
    }
  };

  const usage = new UsageStats({ release: options.release ?? "dev", maps: settings.maps });
  if (db === undefined) {
    logger.warn("usage_in_memory", { reason: "no data directory" });
  } else {
    const error = loadUsage(usage, db, clock.now());
    if (error) logger.warn("usage_not_loaded", { error: error.message });
    const errorsLost = loadClientErrors(usage.errors, db, clock.now());
    if (errorsLost) logger.warn("client_errors_not_loaded", { error: errorsLost.message });
  }
  /** Writes the usage counts, if there is somewhere to keep them; never stops the server. */
  const keepUsage = (): void => {
    if (db === undefined || options.dataDir === undefined) return;
    try {
      transaction(db, () => {
        saveUsage(usage, db, clock.now());
        saveClientErrors(usage.errors, db, clock.now());
      });
    } catch (error) {
      logger.warn("usage_not_saved", { error: (error as Error).message });
    }
    try {
      exportMonths(usage, monthsDirectory(options.dataDir), clock.now(), (message) => {
        logger.warn("usage_month_bad", { error: message });
      });
    } catch (error) {
      logger.warn("usage_not_saved", { error: (error as Error).message });
    }
  };
  const moderation = new Moderation(db, clock.now(), options.reportRate, clock, ids);
  try {
    moderation.reload();
  } catch (error) {
    logger.warn("bans_not_loaded", { error: (error as Error).message });
  }
  const usageSaver = clock.setInterval(keepUsage, options.usageSaveIntervalMs ?? 5 * 60_000);
  usageSaver.unref();

  let closed = false;
  return {
    db,
    usage,
    moderation,
    keepsGames: db !== undefined,
    keepGames,
    saveCounts() {
      usageSaver.clear();
      keepUsage();
      try {
        moderation.flush();
      } catch (error) {
        logger.warn("reports_not_saved", { error: (error as Error).message });
      }
    },
    close() {
      if (closed) return;
      closed = true;
      db?.close();
    },
  };
}

/** Sign-in, when a service or a mailbox is set up and accounts have somewhere to be kept. */
export function startAuth(
  options: ServerOptions,
  db: SqlDriver | undefined,
  clock: Clock,
  ids: Ids,
  logger: Logger,
): Auth | undefined {
  const settings = options.auth;
  if (!settings || (Object.keys(settings.clients).length === 0 && !settings.mail)) return undefined;
  if (db === undefined) {
    logger.warn("accounts_off", { reason: "no data directory" });
    return undefined;
  }
  const accounts = new Accounts(
    db,
    (error) => {
      logger.warn("accounts_not_saved", {
        reason: (error as NodeJS.ErrnoException).code ?? "write",
      });
    },
    { clock, ids },
  );
  const { error, usable } = accounts.load();
  if (error) logger.warn("accounts_not_loaded", { error: error.message });
  // Starting empty would let a later write replace accounts that are still there.
  if (!usable) {
    logger.warn("accounts_off", { reason: "accounts cannot be read" });
    return undefined;
  }
  logger.info("accounts_loaded", { accounts: accounts.size });
  // Unset, the socket accepts any page; changes to an account never do.
  return createAuth(
    settings,
    accounts,
    logger,
    (origin) => !!options.allowedOrigin && isAllowedOrigin(origin, options.allowedOrigin),
    clock,
    ids,
  );
}
