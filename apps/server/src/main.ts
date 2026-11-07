import { fileURLToPath } from "node:url";
import { systemClock } from "./clock.ts";
import { ConfigError, loadConfig, serverOptions, type ServerConfig } from "./config.ts";
import { exitOnCrash } from "./crash.ts";
import { NewerSchemaError } from "./database.ts";
import { ImportError } from "./import-json.ts";
import { jsonLogger } from "./log.ts";
import { createGameServer, type GameServer } from "./server.ts";
import { openBunSqlite } from "./sql/bun-sqlite.ts";

/** Past the drain, sockets get this long to close before the process exits anyway. */
const EXIT_GRACE_MS = 5_000;

declare const __FRONTFALL_RELEASE__: string | undefined;
/** Release of the game, the root package.json version, set when the server is bundled. */
const release = typeof __FRONTFALL_RELEASE__ === "string" ? __FRONTFALL_RELEASE__ : "dev";
declare const __FRONTFALL_SIMULATION__: string | undefined;
/** Simulation build of the sources, set when the server is bundled; see docs/protocol.md. */
const simulation = typeof __FRONTFALL_SIMULATION__ === "string" ? __FRONTFALL_SIMULATION__ : "dev";

const logger = jsonLogger();
exitOnCrash(process, logger, (status) => process.exit(status));

/** The settings of the environment; a wrong one stops the start, with every wrong one named. */
function readConfig(): ServerConfig {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    logger.error("config_invalid", {
      count: error.problems.length,
      problems: error.problems.join("; "),
    });
    process.exit(1);
  }
}

/**
 * The server, with data.db opened through bun:sqlite. A JSON store of an
 * earlier release that does not import stops the start, naming the file,
 * and so does a data.db from a newer release.
 */
function startServer(config: ServerConfig): GameServer {
  try {
    return createGameServer({
      ...serverOptions(config, {
        staticRoot: fileURLToPath(new URL("../../client/dist", import.meta.url)),
        release,
        simulation,
        logger,
      }),
      openSql: openBunSqlite,
    });
  } catch (error) {
    if (error instanceof NewerSchemaError) {
      logger.error("database_too_new", { schema: error.schema, known: error.known });
      process.exit(1);
    }
    if (!(error instanceof ImportError)) throw error;
    logger.error("import_failed", { store: error.store, file: error.file, error: error.message });
    process.exit(1);
  }
}

const config = readConfig();
const server = startServer(config);

let stopping = false;

function shutdown(): void {
  // A second signal, such as Ctrl+C pressed again, does not wait for the games.
  if (stopping) process.exit(0);
  stopping = true;
  logger.info("server_stopping", { drainSeconds: config.drainSeconds });
  systemClock.setTimeout(() => process.exit(0), config.drainSeconds * 1000 + EXIT_GRACE_MS).unref();
  void server.close().then(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

void server.listen(config.port).then(() => {
  logger.info("server_started", {
    port: config.port,
    version: config.version,
    release,
    simulation,
    operators: config.operatorAccounts.size,
  });
});
