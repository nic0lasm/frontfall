import { fileURLToPath } from "node:url";
import { PROVIDERS } from "./accounts.ts";
import type { AuthOptions } from "./auth.ts";
import { readSmtpSettings, smtpMailer } from "./mail.ts";
import { jsonLogger } from "./log.ts";
import { createGameServer } from "./server.ts";

/**
 * Running games may go on this long after SIGTERM. The container's stop
 * grace period must be longer, or Docker kills the games without a word.
 */
const DEFAULT_DRAIN_SECONDS = 20;

/** Past the drain, sockets get this long to close before the process exits anyway. */
const EXIT_GRACE_MS = 5_000;

const port = Number(process.env.PORT ?? 8080);
const logger = jsonLogger();
const version = process.env.FRONTFALL_VERSION ?? "dev";

declare const __FRONTFALL_RELEASE__: string | undefined;
/** Release of the game, the root package.json version, set when the server is bundled. */
const release = typeof __FRONTFALL_RELEASE__ === "string" ? __FRONTFALL_RELEASE__ : "dev";
declare const __FRONTFALL_SIMULATION__: string | undefined;
/** Simulation build of the sources, set when the server is bundled; see docs/protocol.md. */
const simulation = typeof __FRONTFALL_SIMULATION__ === "string" ? __FRONTFALL_SIMULATION__ : "dev";

/** Reads a numeric setting from the environment, ignoring it when unset or invalid. */
function optionalNumber<T>(name: string, use: (value: number) => T): T | undefined {
  const value = Number(process.env[name]);
  return process.env[name] && Number.isFinite(value) && value >= 0 ? use(value) : undefined;
}

const drainSeconds =
  optionalNumber("FRONTFALL_DRAIN_SECONDS", (seconds) => seconds) ?? DEFAULT_DRAIN_SECONDS;

/** Public games on one network, such as a LAN party, need more than three seats from it. */
const seatsPerAddress =
  optionalNumber("FRONTFALL_SEATS_PER_ADDRESS", (seats) => ({ seatsPerAddress: seats })) ?? {};

/**
 * Sign-in with Discord or Google: each service whose application id and
 * secret are set. By email: when an SMTP file is given. Either way the game
 * must know its public address and have a secret to sign sessions with.
 * See docs/self-hosting.md.
 */
function authSettings(): AuthOptions | undefined {
  const publicUrl = process.env.FRONTFALL_PUBLIC_URL;
  const sessionSecret = process.env.FRONTFALL_SESSION_SECRET;
  const clients: AuthOptions["clients"] = {};
  for (const provider of PROVIDERS) {
    const prefix = `FRONTFALL_OAUTH_${provider.toUpperCase()}`;
    const id = process.env[`${prefix}_ID`];
    const secret = process.env[`${prefix}_SECRET`];
    if (id && secret) clients[provider] = { id, secret };
  }
  const mail = mailSettings();
  if (Object.keys(clients).length === 0 && !mail) return undefined;
  if (!publicUrl || !sessionSecret || sessionSecret.length < 32) {
    logger.warn("accounts_off", {
      reason:
        "FRONTFALL_PUBLIC_URL and a FRONTFALL_SESSION_SECRET of 32 characters or more are needed",
    });
    return undefined;
  }
  return { publicUrl, sessionSecret, clients, ...(mail && { mail }) };
}

/** The mailbox sign-in links are sent from, read from FRONTFALL_SMTP_FILE. */
function mailSettings(): AuthOptions["mail"] {
  const file = process.env.FRONTFALL_SMTP_FILE;
  if (!file) return undefined;
  try {
    const mailer = smtpMailer(readSmtpSettings(file));
    return {
      mailer,
      ...optionalNumber("FRONTFALL_EMAIL_DAILY_LIMIT", (limit) => ({
        dailyLimit: Math.floor(limit),
      })),
    };
  } catch (error) {
    logger.warn("email_sign_in_off", { reason: (error as Error).message });
    return undefined;
  }
}

const server = createGameServer({
  staticRoot:
    process.env.FRONTFALL_STATIC ?? fileURLToPath(new URL("../../client/dist", import.meta.url)),
  allowedOrigin: process.env.FRONTFALL_ORIGINE,
  version,
  release,
  simulation,
  logger,
  dataDir: process.env.FRONTFALL_DATA || undefined,
  auth: authSettings(),
  publicGame: {
    ...optionalNumber("FRONTFALL_COUNTDOWN_SECONDS", (seconds) => ({
      // A quick game must count down: without it, a lone player would wait for nothing.
      countdownMs: Math.max(1, seconds) * 1000,
    })),
    ...seatsPerAddress,
  },
  privateGame: { ...seatsPerAddress },
  ...optionalNumber("FRONTFALL_CONNECTIONS_PER_MINUTE", (perMinute) => ({
    upgradeRate: { perSecond: Math.max(1, perMinute) / 60, burst: 40 },
  })),
  ...optionalNumber("FRONTFALL_MAX_GAMES", (maxRooms) => ({ maxRooms })),
  ...optionalNumber("FRONTFALL_MAX_CONNECTIONS", (maxConnections) => ({ maxConnections })),
  ...optionalNumber("FRONTFALL_MAX_PLAYERS", (maxPlayers) => ({ maxPlayers })),
  ...optionalNumber("FRONTFALL_MAX_LOG_MIB", (mib) => ({ maxLogBytes: mib * 2 ** 20 })),
  drainMs: drainSeconds * 1000,
});

let stopping = false;

function shutdown(): void {
  // A second signal, such as Ctrl+C pressed again, does not wait for the games.
  if (stopping) process.exit(0);
  stopping = true;
  logger.info("server_stopping", { drainSeconds });
  setTimeout(() => process.exit(0), drainSeconds * 1000 + EXIT_GRACE_MS).unref();
  void server.close().then(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.http.listen(port, () => {
  logger.info("server_started", { port, version, release, simulation });
});
