import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authSettings,
  ConfigError,
  DEFAULT_DRAIN_SECONDS,
  loadConfig,
  serverOptions,
  type ServerConfig,
} from "../src/config.ts";
import type { LogFields, Logger } from "../src/log.ts";

const SECRET = "s".repeat(40);

/** The problems loadConfig reports for an environment. */
function problemsOf(env: Record<string, string>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

/** A logger that keeps what it is told. */
function recorder(): {
  logger: Logger;
  lines: { level: string; event: string; fields?: LogFields }[];
} {
  const lines: { level: string; event: string; fields?: LogFields }[] = [];
  const at =
    (level: string) =>
    (event: string, fields?: LogFields): void => {
      lines.push({ level, event, ...(fields && { fields }) });
    };
  return { logger: { info: at("info"), warn: at("warn"), error: at("error") }, lines };
}

const BUILD = { staticRoot: "/app/client", release: "1.2.3", simulation: "abc" };

describe("loadConfig", () => {
  it("starts from an empty environment with the defaults", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      port: 8080,
      version: "dev",
      drainSeconds: DEFAULT_DRAIN_SECONDS,
      trustProxy: true,
      signIn: { loginBind: false, clients: {} },
    });
    expect(config.dataDir).toBeUndefined();
    expect(config.allowedOrigin).toBeUndefined();
    expect(config.operatorAccounts.size).toBe(0);
  });

  it("reads every variable", () => {
    const config = loadConfig({
      PORT: "9000",
      FRONTFALL_VERSION: "abc123",
      FRONTFALL_STATIC: "/srv/client",
      FRONTFALL_ORIGINE: "https://nclsmgr.com, https://www.nclsmgr.com",
      FRONTFALL_DATA: "/var/lib/frontfall",
      FRONTFALL_DRAIN_SECONDS: "7.5",
      FRONTFALL_COUNTDOWN_SECONDS: "30",
      FRONTFALL_SEATS_PER_ADDRESS: "0",
      FRONTFALL_CONNECTIONS_PER_MINUTE: "120",
      FRONTFALL_TRUST_PROXY: "false",
      FRONTFALL_MAX_GAMES: "10",
      FRONTFALL_GAMES_PER_ADDRESS: "0",
      FRONTFALL_MAX_CONNECTIONS: "200",
      FRONTFALL_MAX_PLAYERS: "100",
      FRONTFALL_MAX_LOG_MIB: "1.5",
      FRONTFALL_OPERATOR_ACCOUNTS: "a1, b2  c3",
      FRONTFALL_PUBLIC_URL: "https://nclsmgr.com/frontfall",
      FRONTFALL_SESSION_SECRET: SECRET,
      FRONTFALL_OAUTH_DISCORD_ID: "123",
      FRONTFALL_OAUTH_DISCORD_SECRET: "shh",
      FRONTFALL_SMTP_FILE: "/run/secrets/smtp",
      FRONTFALL_EMAIL_DAILY_LIMIT: "100",
      FRONTFALL_LOGIN_BIND: "true",
    });
    expect(config).toMatchObject({
      port: 9000,
      version: "abc123",
      staticRoot: "/srv/client",
      allowedOrigin: "https://nclsmgr.com, https://www.nclsmgr.com",
      dataDir: "/var/lib/frontfall",
      drainSeconds: 7.5,
      countdownSeconds: 30,
      seatsPerAddress: 0,
      connectionsPerMinute: 120,
      trustProxy: false,
      maxGames: 10,
      gamesPerAddress: 0,
      maxConnections: 200,
      maxPlayers: 100,
      maxLogMib: 1.5,
      signIn: {
        publicUrl: "https://nclsmgr.com/frontfall",
        sessionSecret: SECRET,
        clients: { discord: { id: "123", secret: "shh" } },
        smtpFile: "/run/secrets/smtp",
        emailDailyLimit: 100,
        loginBind: true,
      },
    });
    expect([...config.operatorAccounts]).toEqual(["a1", "b2", "c3"]);
  });

  it("treats a variable set to nothing as unset, as a compose file leaves it", () => {
    const config = loadConfig({
      PORT: "",
      FRONTFALL_ORIGINE: "",
      FRONTFALL_TRUST_PROXY: "",
      FRONTFALL_DATA: "",
      FRONTFALL_MAX_GAMES: "",
      FRONTFALL_PUBLIC_URL: "",
    });
    expect(config).toMatchObject({ port: 8080, trustProxy: true });
    expect(config.allowedOrigin).toBeUndefined();
    expect(config.dataDir).toBeUndefined();
    expect(config.maxGames).toBeUndefined();
  });

  it("lists every variable that is set but wrong, not the first", () => {
    const problems = problemsOf({
      PORT: "http",
      FRONTFALL_MAX_GAMES: "-3",
      FRONTFALL_MAX_PLAYERS: "1.5",
      FRONTFALL_DRAIN_SECONDS: "soon",
      FRONTFALL_TRUST_PROXY: "yes",
      FRONTFALL_LOGIN_BIND: "1",
      FRONTFALL_ORIGINE: "https://ok.example, nclsmgr.com, https://x.example/",
      FRONTFALL_PUBLIC_URL: "not a url",
      FRONTFALL_SESSION_SECRET: "short",
    });
    expect(problems.map((problem) => problem.split(":")[0])).toEqual([
      "PORT",
      "FRONTFALL_ORIGINE",
      "FRONTFALL_ORIGINE",
      "FRONTFALL_DRAIN_SECONDS",
      "FRONTFALL_TRUST_PROXY",
      "FRONTFALL_MAX_GAMES",
      "FRONTFALL_MAX_PLAYERS",
      "FRONTFALL_PUBLIC_URL",
      "FRONTFALL_SESSION_SECRET",
      "FRONTFALL_LOGIN_BIND",
    ]);
    expect(problems.join("\n")).toContain('"nclsmgr.com" must be an origin');
    expect(problems.join("\n")).toContain('"https://x.example/" must be an origin');
  });

  it("puts every problem in the message of the error", () => {
    expect.assertions(2);
    try {
      loadConfig({ PORT: "x", FRONTFALL_MAX_GAMES: "y" });
    } catch (error) {
      expect((error as Error).message).toContain("PORT");
      expect((error as Error).message).toContain("FRONTFALL_MAX_GAMES");
    }
  });

  it("limits the port", () => {
    expect(loadConfig({ PORT: "0" }).port).toBe(0);
    expect(problemsOf({ PORT: "65536" })).toHaveLength(1);
  });

  it("accepts only http and https addresses", () => {
    expect(problemsOf({ FRONTFALL_PUBLIC_URL: "ftp://example.org" })).toHaveLength(1);
    expect(problemsOf({ FRONTFALL_PUBLIC_URL: "http://localhost:8080" })).toEqual([]);
  });

  it("never repeats a secret in a problem", () => {
    const problems = problemsOf({ FRONTFALL_SESSION_SECRET: "tooshort-secret-value" });
    expect(problems).toEqual(["FRONTFALL_SESSION_SECRET: must be 32 characters or more"]);
  });

  it("asks for both halves of a service's credentials", () => {
    expect(problemsOf({ FRONTFALL_OAUTH_GOOGLE_ID: "id" })).toEqual([
      "FRONTFALL_OAUTH_GOOGLE_SECRET: is needed with FRONTFALL_OAUTH_GOOGLE_ID",
    ]);
    expect(problemsOf({ FRONTFALL_OAUTH_DISCORD_SECRET: "key" })).toEqual([
      "FRONTFALL_OAUTH_DISCORD_ID: is needed with FRONTFALL_OAUTH_DISCORD_SECRET",
    ]);
    expect(
      loadConfig({ FRONTFALL_OAUTH_GOOGLE_ID: "id", FRONTFALL_OAUTH_GOOGLE_SECRET: "key" }).signIn
        .clients,
    ).toEqual({ google: { id: "id", secret: "key" } });
  });
});

describe("serverOptions", () => {
  const options = (env: Record<string, string>, logger: Logger = recorder().logger) =>
    serverOptions(loadConfig(env), { ...BUILD, logger });

  it("leaves the server's own defaults when nothing is set", () => {
    const result = options({});
    expect(result).toMatchObject({
      staticRoot: "/app/client",
      version: "dev",
      release: "1.2.3",
      simulation: "abc",
      drainMs: 20_000,
      publicGame: { map: "lyon" },
      privateGame: {},
    });
    for (const key of [
      "upgradeRate",
      "trustProxy",
      "maxRooms",
      "maxGamesPerAddress",
      "maxConnections",
      "maxPlayers",
      "maxLogBytes",
      "auth",
    ]) {
      expect(result).not.toHaveProperty(key, expect.anything());
    }
    expect(result.publicGame).not.toHaveProperty("countdownMs");
  });

  it("turns the settings into options", () => {
    const result = options({
      FRONTFALL_STATIC: "/srv/client",
      FRONTFALL_COUNTDOWN_SECONDS: "0",
      FRONTFALL_SEATS_PER_ADDRESS: "8",
      FRONTFALL_CONNECTIONS_PER_MINUTE: "120",
      FRONTFALL_TRUST_PROXY: "false",
      FRONTFALL_MAX_GAMES: "10",
      FRONTFALL_GAMES_PER_ADDRESS: "0",
      FRONTFALL_MAX_CONNECTIONS: "200",
      FRONTFALL_MAX_PLAYERS: "100",
      FRONTFALL_MAX_LOG_MIB: "2",
      FRONTFALL_DRAIN_SECONDS: "5",
      FRONTFALL_OPERATOR_ACCOUNTS: "a1",
    });
    expect(result).toMatchObject({
      staticRoot: "/srv/client",
      // A quick game counts down at least one second.
      publicGame: { map: "lyon", countdownMs: 1000, seatsPerAddress: 8 },
      privateGame: { seatsPerAddress: 8 },
      upgradeRate: { perSecond: 2, burst: 40 },
      trustProxy: false,
      maxRooms: 10,
      maxGamesPerAddress: 0,
      maxConnections: 200,
      maxPlayers: 100,
      maxLogBytes: 2 * 2 ** 20,
      drainMs: 5000,
    });
    expect([...(result.operatorAccounts ?? [])]).toEqual(["a1"]);
  });

  it("never opens fewer than one connection a minute worth of rate", () => {
    expect(options({ FRONTFALL_CONNECTIONS_PER_MINUTE: "0" }).upgradeRate).toEqual({
      perSecond: 1 / 60,
      burst: 40,
    });
  });
});

describe("authSettings", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const signIn = (env: Record<string, string>): ServerConfig["signIn"] => loadConfig(env).signIn;
  const full = {
    FRONTFALL_PUBLIC_URL: "https://nclsmgr.com/frontfall",
    FRONTFALL_SESSION_SECRET: SECRET,
    FRONTFALL_OAUTH_DISCORD_ID: "123",
    FRONTFALL_OAUTH_DISCORD_SECRET: "shh",
  };

  it("is off, without a word, when nothing is set up", () => {
    const { logger, lines } = recorder();
    expect(authSettings(signIn({}), logger)).toBeUndefined();
    expect(
      authSettings(
        signIn({
          FRONTFALL_PUBLIC_URL: full.FRONTFALL_PUBLIC_URL,
          FRONTFALL_SESSION_SECRET: SECRET,
        }),
        logger,
      ),
    ).toBeUndefined();
    expect(lines).toEqual([]);
  });

  it("is on with a service, the public address and a secret", () => {
    const { logger, lines } = recorder();
    expect(authSettings(signIn(full), logger)).toEqual({
      publicUrl: "https://nclsmgr.com/frontfall",
      sessionSecret: SECRET,
      clients: { discord: { id: "123", secret: "shh" } },
    });
    expect(lines).toEqual([]);
  });

  it("turns off with one warning when a service is set up but the address or the secret is not", () => {
    for (const missing of ["FRONTFALL_PUBLIC_URL", "FRONTFALL_SESSION_SECRET"]) {
      const { logger, lines } = recorder();
      const env = Object.fromEntries(Object.entries(full).filter(([name]) => name !== missing));
      expect(authSettings(signIn(env), logger)).toBeUndefined();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: "warn", event: "accounts_off" });
    }
  });

  it("turns email sign-in off with one warning when the SMTP file cannot be read", () => {
    const { logger, lines } = recorder();
    dir = mkdtempSync(join(tmpdir(), "frontfall-config-"));
    const env = { ...full, FRONTFALL_SMTP_FILE: join(dir, "missing.json") };
    // The service still signs in; the mailbox does not.
    expect(authSettings(signIn(env), logger)).toMatchObject({ clients: { discord: {} } });
    expect(authSettings(signIn(env), logger)?.mail).toBeUndefined();
    expect(lines.map((line) => line.event)).toEqual(["email_sign_in_off", "email_sign_in_off"]);
    // With the mailbox alone, nothing is left to sign in with: no second warning for the address.
    const alone = recorder();
    expect(
      authSettings(signIn({ FRONTFALL_SMTP_FILE: join(dir, "missing.json") }), alone.logger),
    ).toBeUndefined();
    expect(alone.lines.map((line) => line.event)).toEqual(["email_sign_in_off"]);
  });

  it("sets up the mailbox from the SMTP file, with its limits", () => {
    const { logger, lines } = recorder();
    dir = mkdtempSync(join(tmpdir(), "frontfall-config-"));
    const file = join(dir, "smtp.json");
    writeFileSync(
      file,
      JSON.stringify({
        hote: "smtp.example.org",
        port: 587,
        utilisateur: "mailer",
        motDePasse: "pw",
        expediteur: "game@example.org",
      }),
    );
    const auth = authSettings(
      signIn({
        FRONTFALL_PUBLIC_URL: "https://nclsmgr.com",
        FRONTFALL_SESSION_SECRET: SECRET,
        FRONTFALL_SMTP_FILE: file,
        FRONTFALL_EMAIL_DAILY_LIMIT: "50",
        FRONTFALL_LOGIN_BIND: "true",
      }),
      logger,
    );
    expect(auth?.clients).toEqual({});
    expect(auth?.mail).toMatchObject({ dailyLimit: 50, bindToBrowser: true });
    expect(lines).toEqual([]);
  });
});
