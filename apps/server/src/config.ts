import { z } from "zod";
import { PROVIDERS, type Provider } from "./accounts.ts";
import type { AuthOptions } from "./auth.ts";
import type { Logger } from "./log.ts";
import { readSmtpSettings, smtpMailer } from "./mail.ts";
import type { ServerOptions } from "./server-options.ts";

/** A session secret shorter than this is too easy to guess. */
const MIN_SECRET_LENGTH = 32;

/** A variable set to nothing, as `${VAR:-}` in a compose file leaves it, counts as unset. */
const blank = (value: unknown): unknown => (value === "" ? undefined : value);

/** Text as it is; unset or blank gives undefined. */
const text = z.preprocess(blank, z.string().optional());

/** A secret: read like text, but no problem ever repeats its value. */
const secret = text;

/** A whole number from 0 to `max`. */
function count(max = Number.MAX_SAFE_INTEGER) {
  return z.preprocess(
    blank,
    z
      .string()
      .transform((value, ctx) => {
        const number = Number(value);
        if (!/^\d+$/.test(value) || number > max) {
          ctx.addIssue({
            code: "custom",
            message: `must be a whole number from 0 to ${String(max)}, not "${value}"`,
          });
          return z.NEVER;
        }
        return number;
      })
      .optional(),
  );
}

/** A number of 0 or more, with decimals allowed. */
const amount = z.preprocess(
  blank,
  z
    .string()
    .transform((value, ctx) => {
      if (!/^\d+(?:\.\d+)?$/.test(value)) {
        ctx.addIssue({
          code: "custom",
          message: `must be a number of 0 or more, not "${value}"`,
        });
        return z.NEVER;
      }
      return Number(value);
    })
    .optional(),
);

/** `true` or `false`, nothing else. */
const flag = z.preprocess(
  blank,
  z
    .string()
    .transform((value, ctx) => {
      if (value !== "true" && value !== "false") {
        ctx.addIssue({ code: "custom", message: `must be true or false, not "${value}"` });
        return z.NEVER;
      }
      return value === "true";
    })
    .optional(),
);

/** An address with a scheme, such as https://nclsmgr.com/frontfall. */
const address = z.preprocess(
  blank,
  z
    .string()
    .transform((value, ctx) => {
      if (!URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol)) {
        ctx.addIssue({
          code: "custom",
          message: `must be an http or https address, such as https://example.org, not "${value}"`,
        });
        return z.NEVER;
      }
      return value;
    })
    .optional(),
);

/** Origins pages are served from, separated by commas: scheme, host and port, no path. */
const origins = z.preprocess(
  blank,
  z
    .string()
    .transform((value, ctx) => {
      for (const entry of value.split(",").map((item) => item.trim())) {
        if (entry === "") continue;
        const valid =
          URL.canParse(entry) &&
          /^https?:$/.test(new URL(entry).protocol) &&
          new URL(entry).origin === entry;
        if (!valid) {
          ctx.addIssue({
            code: "custom",
            message: `"${entry}" must be an origin such as https://example.org, with no path or trailing slash`,
          });
        }
      }
      return value;
    })
    .optional(),
);

/** What the environment can set, by the name of the variable. */
const environment = z.object({
  PORT: count(65_535),
  FRONTFALL_VERSION: text,
  FRONTFALL_STATIC: text,
  FRONTFALL_ORIGINE: origins,
  FRONTFALL_DATA: text,
  FRONTFALL_DRAIN_SECONDS: amount,
  FRONTFALL_COUNTDOWN_SECONDS: amount,
  FRONTFALL_SEATS_PER_ADDRESS: count(),
  FRONTFALL_CONNECTIONS_PER_MINUTE: amount,
  FRONTFALL_TRUST_PROXY: flag,
  FRONTFALL_MAX_GAMES: count(),
  FRONTFALL_GAMES_PER_ADDRESS: count(),
  FRONTFALL_MAX_CONNECTIONS: count(),
  FRONTFALL_MAX_PLAYERS: count(),
  FRONTFALL_MAX_LOG_MIB: amount,
  FRONTFALL_OPERATOR_ACCOUNTS: text,
  FRONTFALL_PUBLIC_URL: address,
  FRONTFALL_SESSION_SECRET: secret.pipe(
    z
      .string()
      .min(MIN_SECRET_LENGTH, `must be ${String(MIN_SECRET_LENGTH)} characters or more`)
      .optional(),
  ),
  FRONTFALL_OAUTH_DISCORD_ID: text,
  FRONTFALL_OAUTH_DISCORD_SECRET: secret,
  FRONTFALL_OAUTH_GOOGLE_ID: text,
  FRONTFALL_OAUTH_GOOGLE_SECRET: secret,
  FRONTFALL_SMTP_FILE: text,
  FRONTFALL_EMAIL_DAILY_LIMIT: count(),
  FRONTFALL_LOGIN_BIND: flag,
});

type Environment = z.infer<typeof environment>;

/** Sign-in, as far as the environment sets it up. */
export interface SignInConfig {
  publicUrl: string | undefined;
  sessionSecret: string | undefined;
  /** Services with both their id and their secret. */
  clients: Partial<Record<Provider, { id: string; secret: string }>>;
  /** JSON file of the mailbox sign-in links are sent from. */
  smtpFile: string | undefined;
  loginBind: boolean;
  emailDailyLimit: number | undefined;
}

/** The settings of a run, checked. Unset ones are undefined: the server has its own defaults. */
export interface ServerConfig {
  port: number;
  version: string;
  staticRoot: string | undefined;
  allowedOrigin: string | undefined;
  dataDir: string | undefined;
  drainSeconds: number;
  countdownSeconds: number | undefined;
  seatsPerAddress: number | undefined;
  connectionsPerMinute: number | undefined;
  trustProxy: boolean;
  maxGames: number | undefined;
  gamesPerAddress: number | undefined;
  maxConnections: number | undefined;
  maxPlayers: number | undefined;
  maxLogMib: number | undefined;
  operatorAccounts: ReadonlySet<string>;
  signIn: SignInConfig;
}

/** Running games may go on this long after SIGTERM, unless FRONTFALL_DRAIN_SECONDS says otherwise. */
export const DEFAULT_DRAIN_SECONDS = 20;

/** The two halves of a service's credentials are set together or not at all. */
function pairProblems(raw: Environment): string[] {
  const problems: string[] = [];
  for (const provider of PROVIDERS) {
    const prefix = `FRONTFALL_OAUTH_${provider.toUpperCase()}`;
    const id = raw[`${prefix}_ID` as keyof Environment];
    const key = raw[`${prefix}_SECRET` as keyof Environment];
    if (id && !key) problems.push(`${prefix}_SECRET: is needed with ${prefix}_ID`);
    if (key && !id) problems.push(`${prefix}_ID: is needed with ${prefix}_SECRET`);
  }
  return problems;
}

function build(raw: Environment): ServerConfig {
  const clients: SignInConfig["clients"] = {};
  for (const provider of PROVIDERS) {
    const prefix = `FRONTFALL_OAUTH_${provider.toUpperCase()}`;
    const id = raw[`${prefix}_ID` as keyof Environment];
    const key = raw[`${prefix}_SECRET` as keyof Environment];
    if (typeof id === "string" && typeof key === "string") clients[provider] = { id, secret: key };
  }
  return {
    port: raw.PORT ?? 8080,
    version: raw.FRONTFALL_VERSION ?? "dev",
    staticRoot: raw.FRONTFALL_STATIC,
    allowedOrigin: raw.FRONTFALL_ORIGINE,
    dataDir: raw.FRONTFALL_DATA,
    drainSeconds: raw.FRONTFALL_DRAIN_SECONDS ?? DEFAULT_DRAIN_SECONDS,
    countdownSeconds: raw.FRONTFALL_COUNTDOWN_SECONDS,
    seatsPerAddress: raw.FRONTFALL_SEATS_PER_ADDRESS,
    connectionsPerMinute: raw.FRONTFALL_CONNECTIONS_PER_MINUTE,
    trustProxy: raw.FRONTFALL_TRUST_PROXY ?? true,
    maxGames: raw.FRONTFALL_MAX_GAMES,
    gamesPerAddress: raw.FRONTFALL_GAMES_PER_ADDRESS,
    maxConnections: raw.FRONTFALL_MAX_CONNECTIONS,
    maxPlayers: raw.FRONTFALL_MAX_PLAYERS,
    maxLogMib: raw.FRONTFALL_MAX_LOG_MIB,
    // Separated by commas or spaces.
    operatorAccounts: new Set(
      (raw.FRONTFALL_OPERATOR_ACCOUNTS ?? "").split(/[\s,]+/).filter((id) => id !== ""),
    ),
    signIn: {
      publicUrl: raw.FRONTFALL_PUBLIC_URL,
      sessionSecret: raw.FRONTFALL_SESSION_SECRET,
      clients,
      smtpFile: raw.FRONTFALL_SMTP_FILE,
      loginBind: raw.FRONTFALL_LOGIN_BIND ?? false,
      emailDailyLimit: raw.FRONTFALL_EMAIL_DAILY_LIMIT,
    },
  };
}

/** Every setting that is set but wrong, one line each, in the order the variables are read. */
export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`invalid configuration: ${problems.join("; ")}`);
  }
}

/**
 * Reads the settings from the environment. A variable that is set but wrong, a
 * number that is not one, an address that is not an address, half of a
 * service's credentials, throws a ConfigError that lists all of them, not the
 * first. A variable that is unset or empty is not a problem.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const parsed = environment.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const pairs = pairProblems(parsed.data);
  if (pairs.length > 0) throw new ConfigError(pairs);
  return build(parsed.data);
}

/** What the build of the server fixes, and the means to log. */
export interface BuildSettings {
  /** Directory of the built client, unless the environment names another. */
  staticRoot: string;
  release: string;
  simulation: string;
  logger: Logger;
}

/** The mailbox sign-in links are sent from, read from the SMTP file; off, with a warning, when it cannot be. */
function mailSettings(signIn: SignInConfig, logger: Logger): AuthOptions["mail"] {
  if (!signIn.smtpFile) return undefined;
  try {
    return {
      mailer: smtpMailer(readSmtpSettings(signIn.smtpFile)),
      ...(signIn.loginBind ? { bindToBrowser: true } : {}),
      ...(signIn.emailDailyLimit !== undefined ? { dailyLimit: signIn.emailDailyLimit } : {}),
    };
  } catch (error) {
    logger.warn("email_sign_in_off", { reason: (error as Error).message });
    return undefined;
  }
}

/**
 * Sign-in with Discord or Google: each service whose application id and
 * secret are set. By email: when an SMTP file is given. Either way the game
 * must know its public address and have a secret to sign sessions with;
 * without them sign-in is off, with one warning. See docs/self-hosting.md.
 */
export function authSettings(signIn: SignInConfig, logger: Logger): AuthOptions | undefined {
  const mail = mailSettings(signIn, logger);
  if (Object.keys(signIn.clients).length === 0 && !mail) return undefined;
  if (!signIn.publicUrl || !signIn.sessionSecret) {
    logger.warn("accounts_off", {
      reason: `FRONTFALL_PUBLIC_URL and a FRONTFALL_SESSION_SECRET of ${String(MIN_SECRET_LENGTH)} characters or more are needed`,
    });
    return undefined;
  }
  return {
    publicUrl: signIn.publicUrl,
    sessionSecret: signIn.sessionSecret,
    clients: signIn.clients,
    ...(mail && { mail }),
  };
}

/** The options of the game server for a configuration. */
export function serverOptions(config: ServerConfig, build: BuildSettings): ServerOptions {
  const seats =
    config.seatsPerAddress === undefined ? {} : { seatsPerAddress: config.seatsPerAddress };
  const { signIn } = config;
  return {
    staticRoot: config.staticRoot ?? build.staticRoot,
    allowedOrigin: config.allowedOrigin,
    version: config.version,
    release: build.release,
    simulation: build.simulation,
    logger: build.logger,
    dataDir: config.dataDir,
    auth: authSettings(signIn, build.logger),
    operatorAccounts: config.operatorAccounts,
    publicGame: {
      // "Play now" opens on Lyon: small enough to fill with a few players and bots.
      map: "lyon",
      // A quick game must count down: without it, a lone player would wait for nothing.
      ...(config.countdownSeconds !== undefined && {
        countdownMs: Math.max(1, config.countdownSeconds) * 1000,
      }),
      ...seats,
    },
    privateGame: { ...seats },
    ...(config.connectionsPerMinute !== undefined && {
      upgradeRate: { perSecond: Math.max(1, config.connectionsPerMinute) / 60, burst: 40 },
    }),
    // Players who reach the server straight from its own network could name any address.
    ...(!config.trustProxy && { trustProxy: false }),
    ...(config.maxGames !== undefined && { maxRooms: config.maxGames }),
    ...(config.gamesPerAddress !== undefined && { maxGamesPerAddress: config.gamesPerAddress }),
    ...(config.maxConnections !== undefined && { maxConnections: config.maxConnections }),
    ...(config.maxPlayers !== undefined && { maxPlayers: config.maxPlayers }),
    ...(config.maxLogMib !== undefined && { maxLogBytes: config.maxLogMib * 2 ** 20 }),
    drainMs: config.drainSeconds * 1000,
  };
}
