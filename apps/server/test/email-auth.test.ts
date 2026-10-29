import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountsFile } from "../src/accounts.ts";
import type { Logger } from "../src/log.ts";
import { mailbox, mailFailure, readSmtpSettings, type MailMessage } from "../src/mail.ts";
import { createGameServer, type GameServer } from "../src/server.ts";

const SECRET = "a-session-secret-of-at-least-32-characters";
const ORIGIN = "https://play.example";

let staticRoot: string;
let dataDir: string;
let server: GameServer | undefined;
/** Emails the server sent, in order. */
let sent: MailMessage[];
let fail: boolean;
let lines: string[];

beforeEach(() => {
  staticRoot = mkdtempSync(join(tmpdir(), "frontfall-static-"));
  dataDir = mkdtempSync(join(tmpdir(), "frontfall-data-"));
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html>");
  sent = [];
  fail = false;
  lines = [];
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(staticRoot, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

const logger: Logger = {
  info: (event, fields) => lines.push(JSON.stringify({ event, ...fields })),
  warn: (event, fields) => lines.push(JSON.stringify({ event, ...fields })),
};

async function start(dailyLimit?: number): Promise<string> {
  server = createGameServer({
    staticRoot,
    version: "abc123",
    dataDir,
    allowedOrigin: ORIGIN,
    logger,
    auth: {
      publicUrl: `${ORIGIN}/game`,
      sessionSecret: SECRET,
      clients: {},
      mail: {
        mailer: {
          send: (message) => {
            if (fail)
              return Promise.reject(
                Object.assign(new Error("550 <nelly@example.org> unknown"), { responseCode: 550 }),
              );
            sent.push(message);
            return Promise.resolve();
          },
        },
        ...(dailyLimit !== undefined && { dailyLimit }),
      },
    },
  });
  const http = server.http;
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
}

function post(
  base: string,
  path: string,
  body: unknown,
  cookie?: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** Lets the server finish sending what it started after answering. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function tokenOf(message: MailMessage | undefined): string {
  return /#signin=([\w-]+)/.exec(message?.text ?? "")?.[1] ?? "";
}

function sessionOf(response: Response): string | undefined {
  for (const header of response.headers.getSetCookie()) {
    const match = /^frontfall_session=([^;]+)/.exec(header);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

async function signIn(base: string, email: string, name = "Nelly"): Promise<string> {
  expect((await post(base, "/auth/email", { email, name })).status).toBe(202);
  await settle();
  const response = await post(base, "/auth/email/confirm", { token: tokenOf(sent.at(-1)) });
  expect(response.status).toBe(200);
  return sessionOf(response) ?? "";
}

describe("sign-in by email", () => {
  it("is offered once a mailbox is set up", async () => {
    const base = await start();
    expect(await (await fetch(`${base}/api/me`)).json()).toEqual({
      providers: [],
      email: true,
      account: null,
    });
  });

  it("sends a link to the game that signs the player in, once", async () => {
    const base = await start();
    const asked = await post(base, "/auth/email", {
      email: " Nelly@Example.org ",
      name: "Nelly",
      language: "fr",
    });
    expect(asked.status).toBe(202);
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("nelly@example.org");
    expect(sent[0]?.subject).toContain("connexion");
    expect(sent[0]?.text).toMatch(/https:\/\/play\.example\/game\/#signin=[\w-]{43}\n/);
    const token = tokenOf(sent[0]);
    const confirmed = await post(base, "/auth/email/confirm", { token });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({
      providers: [],
      email: true,
      account: { name: "Nelly", provider: "email", methods: ["email"] },
    });
    const session = sessionOf(confirmed) ?? "";
    expect(session).not.toBe("");
    const me = await fetch(`${base}/api/me`, {
      headers: { cookie: `frontfall_session=${session}` },
    });
    expect(((await me.json()) as { account: unknown }).account).toEqual({
      name: "Nelly",
      provider: "email",
      methods: ["email"],
    });
    const again = await post(base, "/auth/email/confirm", { token });
    expect(again.status).toBe(400);
    expect(sessionOf(again)).toBeUndefined();
  });

  it("finds the same account with the same address, however it is typed", async () => {
    const base = await start();
    await signIn(base, "nelly@example.org");
    await signIn(base, "NELLY@example.org", "Someone");
    const file = JSON.parse(readFileSync(accountsFile(dataDir), "utf8")) as {
      accounts: { name: string }[];
    };
    expect(file.accounts.map(({ name }) => name)).toEqual(["Nelly"]);
  });

  it("keeps neither the address nor the token in the accounts file or the logs", async () => {
    const base = await start();
    await signIn(base, "nelly@example.org");
    const token = tokenOf(sent[0]);
    const text = readFileSync(accountsFile(dataDir), "utf8");
    expect(text).not.toMatch(/nelly@|example\.org/);
    expect(text).not.toContain(token);
    fail = true;
    await post(base, "/auth/email", { email: "other@example.org" });
    await settle();
    const log = lines.join("\n");
    expect(log).toContain("smtp 550");
    expect(log).not.toMatch(/@|example\.org/);
    expect(log).not.toContain(token);
  });

  it("refuses a link that has expired, or a token it never sent", async () => {
    const base = await start();
    expect((await post(base, "/auth/email/confirm", { token: "made-up" })).status).toBe(400);
    expect((await post(base, "/auth/email/confirm", {})).status).toBe(400);
  });

  it("answers the same for every address, and holds back links to one address", async () => {
    const base = await start();
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await post(base, "/auth/email", { email: "nelly@example.org" })).status);
    await settle();
    expect(statuses).toEqual([202, 202, 202]);
    // Two links, then the address waits ten minutes: the third answer said nothing of it.
    expect(sent).toHaveLength(2);
  });

  it("limits how many links one network may ask for", async () => {
    const base = await start();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push(
        (await post(base, "/auth/email", { email: `p${String(i)}@example.org` })).status,
      );
    expect(statuses).toEqual([202, 202, 202, 429]);
  });

  it("counts an IPv6 network as one, whatever address it picks in its /64", async () => {
    const base = await start();
    const statuses: number[] = [];
    for (let i = 1; i <= 4; i++)
      statuses.push(
        (
          await post(base, "/auth/email", { email: `p${String(i)}@example.org` }, undefined, {
            "x-client-ip": `2001:db8:0:1::${String(i)}`,
          })
        ).status,
      );
    expect(statuses).toEqual([202, 202, 202, 429]);
  });

  it("keeps one network from spending the day's links alone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const base = await start();
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        statuses.push(
          (await post(base, "/auth/email", { email: `p${String(i)}@example.org` })).status,
        );
        vi.setSystemTime(Date.now() + 301_000);
      }
      expect(statuses.slice(0, 10).every((status) => status === 202)).toBe(true);
      expect(statuses[10]).toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts links by the mailbox they reach", async () => {
    expect(mailbox("ana+games@example.org")).toBe("ana@example.org");
    expect(mailbox("a.n.a+x@googlemail.com")).toBe("ana@gmail.com");
    expect(mailbox("a.na@example.org")).toBe("a.na@example.org");
    const base = await start();
    for (const email of ["nelly+1@example.org", "nelly+2@example.org", "nelly+3@example.org"])
      expect((await post(base, "/auth/email", { email })).status).toBe(202);
    await settle();
    expect(sent).toHaveLength(2);
  });

  it("stops sending for the day at the mailbox's limit", async () => {
    const base = await start(1);
    expect((await post(base, "/auth/email", { email: "a@example.org" })).status).toBe(202);
    expect((await post(base, "/auth/email", { email: "b@example.org" })).status).toBe(503);
  });

  it("refuses what is not an address, and requests from other sites", async () => {
    const base = await start();
    expect((await post(base, "/auth/email", { email: "nelly" })).status).toBe(400);
    expect((await post(base, "/auth/email", { email: `${"a".repeat(250)}@x.org` })).status).toBe(
      400,
    );
    const foreign = await fetch(`${base}/auth/email`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ email: "nelly@example.org" }),
    });
    expect(foreign.status).toBe(403);
    expect((await fetch(`${base}/auth/email`)).status).toBe(405);
    await settle();
    expect(sent).toHaveLength(0);
  });
});

describe("achievements of an account", () => {
  const progress = (earned: Record<string, { at: number; level: number }>, games: number) => ({
    earned,
    counts: { wins: 0, cities: 0, games },
  });

  it("are kept with the account, and never go back", async () => {
    const base = await start();
    const cookie = `frontfall_session=${await signIn(base, "nelly@example.org")}`;
    const first = await post(
      base,
      "/api/me/achievements",
      progress({ "first-win": { at: 200, level: 1 }, veteran: { at: 100, level: 1 } }, 12),
      cookie,
    );
    expect(first.status).toBe(200);
    // Another device: a later first win, a higher tier, fewer games.
    const second = await post(
      base,
      "/api/me/achievements",
      progress({ "first-win": { at: 300, level: 1 }, veteran: { at: 150, level: 2 } }, 5),
      cookie,
    );
    expect(await second.json()).toEqual(
      progress({ "first-win": { at: 200, level: 1 }, veteran: { at: 100, level: 2 } }, 12),
    );
  });

  it("are refused to guests and when they are not achievements", async () => {
    const base = await start();
    expect((await post(base, "/api/me/achievements", progress({}, 1))).status).toBe(401);
    const cookie = `frontfall_session=${await signIn(base, "nelly@example.org")}`;
    for (const body of [
      { earned: { "first-win": { at: 1, level: 9 } }, counts: {} },
      { earned: { constructor: { at: -1, level: 1 } }, counts: {} },
      { earned: {}, counts: { games: 1.5 } },
      { earned: [], counts: {} },
    ])
      expect((await post(base, "/api/me/achievements", body, cookie)).status).toBe(400);
  });

  it("go with the account when it is deleted", async () => {
    const base = await start();
    const cookie = `frontfall_session=${await signIn(base, "nelly@example.org")}`;
    await post(base, "/api/me/achievements", progress({ veteran: { at: 1, level: 1 } }, 3), cookie);
    const deleted = await fetch(`${base}/api/me`, {
      method: "DELETE",
      headers: { origin: ORIGIN, cookie },
    });
    expect(deleted.status).toBe(200);
    expect(readFileSync(accountsFile(dataDir), "utf8")).not.toContain("veteran");
  });
});

describe("SMTP file", () => {
  it("reads the fields the site's mail service uses, and names a wrong one without its value", () => {
    const file = join(dataDir, "smtp.json");
    const fields = {
      hote: "ssl0.ovh.net",
      port: 465,
      utilisateur: "game@example.org",
      motDePasse: "hunter2",
      expediteur: "game@example.org",
      destinataire: "admin@example.org",
    };
    writeFileSync(file, JSON.stringify(fields));
    expect(readSmtpSettings(file)).toEqual({
      host: "ssl0.ovh.net",
      port: 465,
      user: "game@example.org",
      password: "hunter2",
      from: "game@example.org",
    });
    writeFileSync(file, JSON.stringify({ ...fields, port: 25, motDePasse: "hunter2" }));
    expect(() => readSmtpSettings(file)).toThrow(/"port"/);
    expect(() => readSmtpSettings(join(dataDir, "missing"))).toThrow(/cannot be read/);
  });

  it("logs a failure by its code only", () => {
    expect(mailFailure({ responseCode: 535, message: "bad nelly@example.org" })).toBe("smtp 535");
    expect(mailFailure({ code: "ETIMEDOUT" })).toBe("ETIMEDOUT");
    expect(mailFailure(new Error("nelly@example.org"))).toBe("send failed");
  });
});
