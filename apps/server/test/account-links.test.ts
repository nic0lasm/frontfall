import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Accounts, accountsFile } from "../src/accounts.ts";
import type { Logger } from "../src/log.ts";
import type { MailMessage } from "../src/mail.ts";
import { createGameServer, type GameServer } from "../src/server.ts";

const SECRET = "a-session-secret-of-at-least-32-characters";
const ORIGIN = "https://play.example";
const NOW = 1_800_000_000_000;

let staticRoot: string;
let dataDir: string;
let server: GameServer | undefined;
let provider: Server | undefined;
let sent: MailMessage[];
let lines: string[];
/** Who the fake Discord says is signing in. */
let user: Record<string, unknown>;

beforeEach(() => {
  staticRoot = mkdtempSync(join(tmpdir(), "frontfall-static-"));
  dataDir = mkdtempSync(join(tmpdir(), "frontfall-data-"));
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html>");
  sent = [];
  lines = [];
  user = { id: "80351110224678912", username: "nelly", global_name: "Nelly" };
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await new Promise<void>((resolve) => {
    if (provider)
      provider.close(() => {
        resolve();
      });
    else resolve();
  });
  provider = undefined;
  rmSync(staticRoot, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

const logger: Logger = {
  info: (event, fields) => lines.push(JSON.stringify({ event, ...fields })),
  warn: (event, fields) => lines.push(JSON.stringify({ event, ...fields })),
};

describe("ways to sign in to one account", () => {
  const achievements = (level: number, at: number, games: number) => ({
    earned: { "first-win": { at, level } },
    counts: { games },
  });

  it("finds the account by a way added to it", () => {
    const accounts = new Accounts(undefined);
    const nelly = accounts.signIn("discord", "1", "Nelly", NOW);
    expect(accounts.link(nelly.id, "google", accounts.subject("google", "g1"))).toEqual({
      ok: true,
      merged: undefined,
    });
    expect(accounts.signIn("google", "g1", "Someone", NOW)).toBe(nelly);
    expect(accounts.methods(nelly)).toEqual(["discord", "google"]);
  });

  it("merges another account only once asked, keeping the most of both", () => {
    const file = accountsFile(dataDir);
    const accounts = new Accounts(file);
    const nelly = accounts.signIn("discord", "1", "Nelly", NOW);
    const other = accounts.signIn("google", "g1", "Nelly Two", NOW - 86_400_000);
    accounts.mergeAchievements(nelly.id, achievements(1, NOW, 3));
    accounts.mergeAchievements(other.id, achievements(2, NOW - 5, 7));
    const subject = accounts.subject("google", "g1");

    const held = accounts.link(nelly.id, "google", subject);
    expect(held).toMatchObject({ ok: false, error: "other", other: { name: "Nelly Two" } });
    expect(accounts.size).toBe(2);
    expect(existsSync(`${file}.before-merges`)).toBe(false);

    const merged = accounts.link(nelly.id, "google", subject, true);
    expect(merged).toMatchObject({ ok: true, merged: { id: other.id } });
    expect(accounts.size).toBe(1);
    expect(accounts.signIn("google", "g1", "x", NOW)).toBe(nelly);
    expect(nelly.name).toBe("Nelly");
    expect(accounts.owner("Nelly Two")).toBeUndefined();
    expect(nelly.achievements).toEqual(achievements(2, NOW - 5, 7));
    expect(nelly.createdAt).toBe(other.createdAt);
    expect(accounts.knownIds(nelly.id)).toEqual([nelly.id, other.id]);
    // The file as it was before, kept aside once.
    const copy = JSON.parse(readFileSync(`${file}.before-merges`, "utf8")) as {
      accounts: unknown[];
    };
    expect(copy.accounts).toHaveLength(2);

    const again = new Accounts(file);
    expect(again.load()).toEqual({ usable: true });
    expect(again.signIn("google", "g1", "x", NOW).id).toBe(nelly.id);
    expect(again.knownIds(nelly.id)).toEqual([nelly.id, other.id]);
  });

  it("takes a way off as long as another is left", () => {
    const accounts = new Accounts(undefined);
    const nelly = accounts.signIn("discord", "1", "Nelly", NOW);
    accounts.link(nelly.id, "email", accounts.subject("email", "n@example.org"));
    expect(accounts.unlink(nelly.id, "google")).toMatchObject({ ok: false, error: "invalid" });
    expect(accounts.unlink(nelly.id, "discord")).toEqual({ ok: true });
    expect(accounts.methods(nelly)).toEqual(["email"]);
    expect(accounts.unlink(nelly.id, "email")).toMatchObject({ ok: false, error: "last" });
    expect(accounts.signIn("email", "n@example.org", "x", NOW)).toBe(nelly);
    expect(accounts.signIn("discord", "1", "Nelly", NOW)).not.toBe(nelly);
  });
});

async function fakeDiscord(): Promise<string> {
  provider = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/token") {
      request.resume();
      request.on("end", () => {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ access_token: "token-1" }));
      });
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(user));
  });
  const http = provider;
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
}

async function start(): Promise<string> {
  const service = await fakeDiscord();
  server = createGameServer({
    staticRoot,
    version: "abc123",
    dataDir,
    allowedOrigin: ORIGIN,
    logger,
    auth: {
      publicUrl: `${ORIGIN}/game`,
      sessionSecret: SECRET,
      clients: { discord: { id: "client-1", secret: "client-secret" } },
      endpoints: {
        discord: {
          authorize: `${service}/authorize`,
          token: `${service}/token`,
          user: `${service}/user`,
          scope: "identify",
        },
      },
      mail: {
        mailer: {
          send: (message) => {
            sent.push(message);
            return Promise.resolve();
          },
        },
      },
    },
  });
  const http = server.http;
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
}

function post(base: string, path: string, body: unknown, session?: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      ...(session ? { cookie: `frontfall_session=${session}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function cookie(response: Response, name: string): string | undefined {
  for (const header of response.headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]+)`).exec(header);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function tokenOf(message: MailMessage | undefined): string {
  return /#signin=([\w-]+)/.exec(message?.text ?? "")?.[1] ?? "";
}

async function emailSignIn(base: string, email: string, name: string): Promise<string> {
  expect((await post(base, "/auth/email", { email, name })).status).toBe(202);
  await settle();
  const response = await post(base, "/auth/email/confirm", { token: tokenOf(sent.at(-1)) });
  return cookie(response, "frontfall_session") ?? "";
}

/** Goes through Discord; `link` adds it to the account of `session`. */
async function discord(base: string, session?: string, link = false): Promise<Response> {
  const started = link
    ? await post(base, "/auth/discord/link", {}, session)
    : await fetch(`${base}/auth/discord`, { redirect: "manual" });
  const location = link
    ? ((await started.json()) as { location: string }).location
    : (started.headers.get("location") ?? "");
  const state = new URL(location).searchParams.get("state") ?? "";
  const cookies = [`frontfall_sign_in=${cookie(started, "frontfall_sign_in") ?? ""}`];
  if (session) cookies.push(`frontfall_session=${session}`);
  return fetch(`${base}/auth/discord/callback?code=good&state=${encodeURIComponent(state)}`, {
    redirect: "manual",
    headers: { cookie: cookies.join("; ") },
  });
}

async function me(base: string, session: string): Promise<{ account: unknown }> {
  return (await (
    await fetch(`${base}/api/me`, { headers: { cookie: `frontfall_session=${session}` } })
  ).json()) as { account: unknown };
}

describe("adding a way to sign in", () => {
  it("adds Discord to an account made by email", async () => {
    const base = await start();
    const session = await emailSignIn(base, "nelly@example.org", "Nelly");
    const back = await discord(base, session, true);
    expect(back.headers.get("location")).toBe(`${ORIGIN}/game/`);
    expect(await me(base, session)).toMatchObject({
      account: { name: "Nelly", provider: "email", methods: ["email", "discord"] },
    });
    // Signing in with Discord now finds the same account.
    const again = cookie(await discord(base), "frontfall_session") ?? "";
    expect(await me(base, again)).toMatchObject({ account: { name: "Nelly" } });
  });

  it("starts only from a form of the game's own page", async () => {
    const base = await start();
    const session = await emailSignIn(base, "nelly@example.org", "Nelly");
    const elsewhere = await fetch(`${base}/auth/discord/link`, {
      method: "POST",
      redirect: "manual",
      headers: { origin: "https://evil.example", cookie: `frontfall_session=${session}` },
    });
    expect(elsewhere.status).toBe(403);
    expect((await fetch(`${base}/auth/discord/link`, { redirect: "manual" })).status).toBe(405);
  });

  it("merges an existing account only once the player says yes", async () => {
    const base = await start();
    const discordSession = cookie(await discord(base), "frontfall_session") ?? "";
    const session = await emailSignIn(base, "nelly@example.org", "Nelly Mail");
    await discord(base, session, true);
    expect(await me(base, session)).toMatchObject({
      account: {
        name: "Nelly Mail",
        methods: ["email"],
        merge: { name: "Nelly", methods: ["discord"] },
      },
    });
    expect(lines.some((line) => line.includes("accounts_merged"))).toBe(false);

    const answer = await post(base, "/api/me/merge", { merge: true }, session);
    expect(await answer.json()).toEqual({
      providers: ["discord"],
      email: true,
      account: { name: "Nelly Mail", provider: "email", methods: ["email", "discord"] },
    });
    expect(lines.some((line) => line.includes('"event":"accounts_merged"'))).toBe(true);
    // The merged account's session ends; its way to sign in leads here now.
    expect(await me(base, discordSession)).toMatchObject({ account: null });
    const again = cookie(await discord(base), "frontfall_session") ?? "";
    expect(await me(base, again)).toMatchObject({ account: { name: "Nelly Mail" } });
    expect(existsSync(`${accountsFile(dataDir)}.before-merges`)).toBe(true);
  });

  it("merges only the account named to the player", async () => {
    const base = await start();
    await discord(base);
    const first = await emailSignIn(base, "one@example.org", "One");
    const second = await emailSignIn(base, "two@example.org", "Two");
    await discord(base, first, true);
    await discord(base, second, true);
    await post(base, "/api/me/merge", { merge: true }, first);
    // Discord now leads to One, not to the account Two was asked about.
    const answer = await post(base, "/api/me/merge", { merge: true }, second);
    expect(await answer.json()).toMatchObject({ account: { name: "Two", methods: ["email"] } });
    expect(await me(base, first)).toMatchObject({ account: { methods: ["email", "discord"] } });
  });

  it("lets the other account be when the player says no", async () => {
    const base = await start();
    await discord(base);
    const session = await emailSignIn(base, "nelly@example.org", "Nelly Mail");
    await discord(base, session, true);
    await post(base, "/api/me/merge", { merge: false }, session);
    expect(await me(base, session)).toEqual({
      providers: ["discord"],
      email: true,
      account: { name: "Nelly Mail", provider: "email", methods: ["email"] },
    });
    const again = cookie(await discord(base), "frontfall_session") ?? "";
    expect(await me(base, again)).toMatchObject({ account: { name: "Nelly" } });
  });

  it("adds an address only where the account is signed in", async () => {
    const base = await start();
    const session = cookie(await discord(base), "frontfall_session") ?? "";
    const asked = await post(base, "/auth/email", { email: "n@example.org", link: true }, session);
    expect(asked.status).toBe(202);
    await settle();
    const message = sent.at(-1);
    expect(message?.subject).toBe("Add this address to your Frontfall account");
    expect(message?.text).not.toContain("Nelly");
    const token = tokenOf(message);
    // Opened by someone else, signed in elsewhere or not at all: refused, and spent.
    expect((await post(base, "/auth/email/confirm", { token })).status).toBe(403);
    expect((await post(base, "/auth/email/confirm", { token }, session)).status).toBe(400);

    await post(base, "/auth/email", { email: "n@example.org", link: true }, session);
    await settle();
    const done = await post(base, "/auth/email/confirm", { token: tokenOf(sent.at(-1)) }, session);
    expect(await done.json()).toMatchObject({ account: { methods: ["discord", "email"] } });
  });

  it("asks a signed-in player for the link that adds an address", async () => {
    const base = await start();
    expect((await post(base, "/auth/email", { email: "n@example.org", link: true })).status).toBe(
      401,
    );
  });

  it("takes a way off, never the last", async () => {
    const base = await start();
    const session = cookie(await discord(base), "frontfall_session") ?? "";
    expect((await post(base, "/api/me/unlink", { method: "discord" }, session)).status).toBe(409);
    await post(base, "/auth/email", { email: "n@example.org", link: true }, session);
    await settle();
    await post(base, "/auth/email/confirm", { token: tokenOf(sent.at(-1)) }, session);
    const removed = await post(base, "/api/me/unlink", { method: "discord" }, session);
    expect(await removed.json()).toMatchObject({
      account: { provider: "email", methods: ["email"] },
    });
  });
});
