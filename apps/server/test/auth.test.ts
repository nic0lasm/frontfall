import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "@frontfall/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Accounts, accountsFile, nameKey } from "../src/accounts.ts";
import { createGameServer, type GameServer, type ServerOptions } from "../src/server.ts";

const SECRET = "a-session-secret-of-at-least-32-characters";

let staticRoot: string;
let dataDir: string;
let server: GameServer | undefined;
let provider: Server | undefined;
/** What the fake service answers for the player who signs in. */
let user: Record<string, unknown>;
let tokenRequests: URLSearchParams[];

beforeEach(() => {
  staticRoot = mkdtempSync(join(tmpdir(), "frontfall-static-"));
  dataDir = mkdtempSync(join(tmpdir(), "frontfall-data-"));
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html>");
  user = { id: "80351110224678912", username: "nelly", global_name: "Nelly" };
  tokenRequests = [];
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

/** A service that hands out the code "good" and knows one player, `user`. */
async function fakeProvider(): Promise<string> {
  provider = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/token") {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        const form = new URLSearchParams(body);
        tokenRequests.push(form);
        if (form.get("code") !== "good") response.writeHead(400).end("{}");
        else
          response
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ access_token: "token-1", token_type: "Bearer" }));
      });
      return;
    }
    if (path === "/user" && request.headers.authorization === "Bearer token-1") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(user));
      return;
    }
    response.writeHead(401).end();
  });
  const http = provider;
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
}

async function start(
  options: Partial<ServerOptions> = {},
  sessionSecret = SECRET,
): Promise<string> {
  const service = await fakeProvider();
  const endpoints = {
    authorize: `${service}/authorize`,
    token: `${service}/token`,
    user: `${service}/user`,
    scope: "identify",
  };
  server = createGameServer({
    staticRoot,
    version: "abc123",
    dataDir,
    allowedOrigin: "https://play.example",
    auth: {
      publicUrl: "https://play.example/game",
      sessionSecret,
      clients: { discord: { id: "client-1", secret: "client-secret" } },
      endpoints: { discord: endpoints },
    },
    ...options,
  });
  const http = server.http;
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
}

/** The `name=value` part of each Set-Cookie header. */
function cookies(response: Response): Map<string, string> {
  const found = new Map<string, string>();
  for (const header of response.headers.getSetCookie()) {
    const [pair = ""] = header.split(";");
    const eq = pair.indexOf("=");
    found.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return found;
}

/** Goes through the whole sign-in and returns the session cookie. */
async function signIn(
  base: string,
  code = "good",
): Promise<{ response: Response; session?: string }> {
  const started = await fetch(`${base}/auth/discord`, { redirect: "manual" });
  expect(started.status).toBe(302);
  const location = new URL(started.headers.get("location") ?? "");
  const state = location.searchParams.get("state") ?? "";
  const signInCookie = cookies(started).get("frontfall_sign_in") ?? "";
  const response = await fetch(
    `${base}/auth/discord/callback?code=${code}&state=${encodeURIComponent(state)}`,
    { redirect: "manual", headers: { cookie: `frontfall_sign_in=${signInCookie}` } },
  );
  const session = cookies(response).get("frontfall_session");
  return { response, ...(session ? { session } : {}) };
}

function me(base: string, session?: string): Promise<Response> {
  return fetch(`${base}/api/me`, {
    headers: session ? { cookie: `frontfall_session=${session}` } : {},
  });
}

describe("sign-in", () => {
  it("answers that only guests play when no service is set up", async () => {
    server = createGameServer({ staticRoot, version: "abc123", dataDir });
    const http = server.http;
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
    expect(await (await me(base)).json()).toEqual({ providers: [], account: null });
    expect((await fetch(`${base}/auth/discord`, { redirect: "manual" })).status).toBe(404);
  });

  it("sends the player to the service with a state and a PKCE challenge", async () => {
    const base = await start();
    const response = await fetch(`${base}/auth/discord`, { redirect: "manual" });
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-1");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://play.example/game/auth/discord/callback",
    );
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("state")).toMatch(/^[\w-]{20,}$/);
    const [header = ""] = response.headers.getSetCookie();
    expect(header).toContain("Path=/game/auth/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
  });

  it("signs the player in, under the name they have at the service", async () => {
    const base = await start();
    const { response, session } = await signIn(base);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://play.example/game/");
    expect(session).toBeDefined();
    const [form] = tokenRequests;
    expect(form?.get("code_verifier")).toMatch(/^[\w-]{40,}$/);
    expect(await (await me(base, session)).json()).toEqual({
      providers: ["discord"],
      email: false,
      account: { name: "Nelly", provider: "discord", methods: ["discord"] },
    });
  });

  it("keeps no id of the service and no email in the accounts file", async () => {
    const base = await start();
    await signIn(base);
    const text = readFileSync(accountsFile(dataDir), "utf8");
    expect(text).not.toContain("80351110224678912");
    expect(text).not.toContain("nelly");
    expect(text).toContain("Nelly");
  });

  it("finds the same account at the next sign-in", async () => {
    const base = await start();
    const first = await signIn(base);
    const second = await signIn(base);
    const one = (await (await me(base, first.session)).json()) as { account: unknown };
    const two = (await (await me(base, second.session)).json()) as { account: unknown };
    expect(two.account).toEqual(one.account);
  });

  it("gives a free name when the one at the service is taken", async () => {
    const base = await start();
    await signIn(base);
    user = { id: "2", username: "nelly2", global_name: "Nelly" };
    const { session } = await signIn(base);
    const body = (await (await me(base, session)).json()) as { account: { name: string } };
    expect(body.account.name).toMatch(/^Nelly\d{4}$/);
  });

  it("refuses a callback whose state does not match", async () => {
    const base = await start();
    const started = await fetch(`${base}/auth/discord`, { redirect: "manual" });
    const signInCookie = cookies(started).get("frontfall_sign_in") ?? "";
    const response = await fetch(`${base}/auth/discord/callback?code=good&state=forged`, {
      redirect: "manual",
      headers: { cookie: `frontfall_sign_in=${signInCookie}` },
    });
    expect(response.headers.get("location")).toBe("https://play.example/game/?signin=failed");
    expect(cookies(response).get("frontfall_session")).toBeUndefined();
  });

  it("goes back to the menu when the service refuses the code", async () => {
    const base = await start();
    const { response, session } = await signIn(base, "bad");
    expect(response.headers.get("location")).toBe("https://play.example/game/?signin=failed");
    expect(session).toBeUndefined();
  });

  it("ignores a session cookie that was tampered with", async () => {
    const base = await start();
    const { session = "" } = await signIn(base);
    const forged = session.replace(/^[^.]+/, "someone-else");
    expect(((await (await me(base, forged)).json()) as { account: unknown }).account).toBeNull();
  });

  it("renames the account, and refuses a name another account holds", async () => {
    const base = await start();
    const { session: first = "" } = await signIn(base);
    user = { id: "2", username: "bob", global_name: "Bob" };
    const { session: second = "" } = await signIn(base);
    const rename = (session: string, name: string, origin = "https://play.example") =>
      fetch(`${base}/api/me`, {
        method: "POST",
        headers: {
          cookie: `frontfall_session=${session}`,
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({ name }),
      });
    expect((await rename(first, "Captain Nelly")).status).toBe(200);
    expect((await rename(second, "captain-nelly")).status).toBe(409);
    expect((await rename(second, "Captain Nelly", "https://evil.example")).status).toBe(403);
    expect((await rename(second, "")).status).toBe(400);
  });

  it("refuses changes from other pages even with no origin set for the socket", async () => {
    const base = await start({ allowedOrigin: undefined });
    const { session = "" } = await signIn(base);
    const ask = (method: string, path: string, origin: string) =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          cookie: `frontfall_session=${session}`,
          "content-type": "application/json",
          origin,
        },
        ...(method === "DELETE" ? {} : { body: JSON.stringify({ name: "Mallory" }) }),
      });
    for (const [method, path] of [
      ["DELETE", "/api/me"],
      ["POST", "/api/me"],
      ["POST", "/auth/logout"],
      ["POST", "/api/me/achievements"],
    ] as const)
      expect((await ask(method, path, "https://evil.example")).status).toBe(403);
    // The game's own page, at its public address, still may.
    expect((await ask("POST", "/api/me", "https://play.example")).status).toBe(200);
  });

  it("deletes the account and signs the player out", async () => {
    const base = await start();
    const { session = "" } = await signIn(base);
    const response = await fetch(`${base}/api/me`, {
      method: "DELETE",
      headers: { cookie: `frontfall_session=${session}`, origin: "https://play.example" },
    });
    expect(response.status).toBe(200);
    expect(cookies(response).get("frontfall_session")).toBe("");
    expect(((await (await me(base, session)).json()) as { account: unknown }).account).toBeNull();
    expect(readFileSync(accountsFile(dataDir), "utf8")).not.toContain("Nelly");
  });

  it("keeps the accounts when the session secret changes, and only signs players out", async () => {
    const base = await start();
    const { session } = await signIn(base);
    await server?.close();
    await new Promise<void>((resolve) => {
      provider?.close(() => {
        resolve();
      });
    });
    const again = await start({}, "another-session-secret-of-32-characters-or-more");
    expect(((await (await me(again, session)).json()) as { account: unknown }).account).toBeNull();
    const { session: renewed } = await signIn(again);
    const body = (await (await me(again, renewed)).json()) as { account: { name: string } };
    // The same account, not a new one under "Nelly1234".
    expect(body.account.name).toBe("Nelly");
    const file = JSON.parse(readFileSync(accountsFile(dataDir), "utf8")) as { accounts: unknown[] };
    expect(file.accounts).toHaveLength(1);
  });

  it("signs the player out on every device", async () => {
    const base = await start();
    const { session: one = "" } = await signIn(base);
    const { session: two = "" } = await signIn(base);
    const response = await fetch(`${base}/auth/logout`, {
      method: "POST",
      headers: { cookie: `frontfall_session=${one}`, origin: "https://play.example" },
    });
    expect(response.status).toBe(200);
    for (const session of [one, two])
      expect(((await (await me(base, session)).json()) as { account: unknown }).account).toBeNull();
  });

  it("turns sign-in off rather than overwrite an accounts file it cannot read", async () => {
    mkdirSync(accountsFile(dataDir), { recursive: true });
    const base = await start();
    expect(await (await me(base)).json()).toEqual({ providers: [], account: null });
  });

  it("limits how often one address may call the sign-in routes", async () => {
    const base = await start();
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await me(base)).status);
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("keeps the accounts over a restart", async () => {
    const base = await start();
    const { session } = await signIn(base);
    await server?.close();
    await new Promise((resolve) => provider?.close(resolve));
    const again = await start();
    expect(base).not.toBe(again);
    const body = (await (await me(again, session)).json()) as { account: { name: string } };
    expect(body.account.name).toBe("Nelly");
  });
});

/** Opens a game socket with these headers and says hello as `name`; resolves with the first answer. */
async function hello(base: string, name: string, cookie?: string): Promise<unknown> {
  const socket = new WebSocket(`${base.replace("http", "ws")}/ws`, {
    headers: { origin: "https://play.example", ...(cookie ? { cookie } : {}) },
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const answer = new Promise((resolve) => {
    socket.once("message", (data: Buffer, isBinary: boolean) => {
      resolve(parseServerMessage(isBinary ? new Uint8Array(data) : data.toString("utf8")));
    });
  });
  socket.send(encodeClientMessage({ type: "hello", version: PROTOCOL_VERSION, name }));
  const message = await answer;
  socket.close();
  return message;
}

describe("names of accounts", () => {
  it("are refused to guests", async () => {
    const base = await start();
    await signIn(base);
    const answer = (await hello(base, "nelly")) as {
      ok: boolean;
      value: { type: string; code?: string };
    };
    expect(answer.value).toMatchObject({ type: "error", code: "invalid_name" });
  });

  it("are the name a signed-in player plays under, whatever the page says", async () => {
    const base = await start();
    const { session = "" } = await signIn(base);
    // "admin" is refused to anyone; the server goes by the account's name instead.
    const answer = (await hello(base, "admin", `frontfall_session=${session}`)) as {
      value: { type: string };
    };
    expect(answer.value.type).toBe("welcome");
  });
});

/** A socket that said hello, with the server's messages as they come. */
async function playerSocket(base: string, name: string, cookie?: string) {
  const socket = new WebSocket(`${base.replace("http", "ws")}/ws`, {
    headers: { origin: "https://play.example", ...(cookie ? { cookie } : {}) },
  });
  const inbox: ServerMessage[] = [];
  const waiting: (() => void)[] = [];
  socket.on("message", (data: Buffer, isBinary: boolean) => {
    const parsed = parseServerMessage(isBinary ? new Uint8Array(data) : data.toString("utf8"));
    if (parsed.ok) inbox.push(parsed.value);
    for (const wake of waiting.splice(0)) wake();
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const next = async <T extends ServerMessage["type"]>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> => {
    for (;;) {
      const index = inbox.findIndex((message) => message.type === type);
      if (index >= 0)
        return inbox.splice(0, index + 1).at(-1) as Extract<ServerMessage, { type: T }>;
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
  };
  const send = (message: ClientMessage): void => {
    socket.send(encodeClientMessage(message));
  };
  send({ type: "hello", version: PROTOCOL_VERSION, name });
  await next("welcome");
  return { socket, next, send };
}

describe("operator's gold bonus (R-MODE-09)", () => {
  const options = {
    map: "world",
    bots: 0,
    difficulty: "normal",
    nations: true,
    teams: 0,
    disabled: 0,
    capacity: 4,
    autoStart: false,
  } as const;

  it("is offered to a listed account only, and doubles that player's gold alone", async () => {
    const operators = new Set<string>();
    const base = await start({ operatorAccounts: operators });
    const { session = "" } = await signIn(base);
    const [account] = (
      JSON.parse(readFileSync(accountsFile(dataDir), "utf8")) as { accounts: { id: string }[] }
    ).accounts;
    if (!account) throw new Error("no account");

    // Signed in but not listed: the same as a guest.
    const before = await playerSocket(base, "x", `frontfall_session=${session}`);
    before.send({ type: "create", visibility: "private" });
    expect((await before.next("lobby")).operator).toBe(false);
    before.send({ type: "configure", options, operatorGold: true });
    expect(await before.next("error")).toMatchObject({ code: "not_operator" });
    before.socket.close();

    operators.add(account.id);
    const nico = await playerSocket(base, "x", `frontfall_session=${session}`);
    nico.send({ type: "create", visibility: "private" });
    const lobby = await nico.next("lobby");
    expect(lobby).toMatchObject({ operator: true, goldBonus: null });
    nico.send({ type: "configure", options, operatorGold: true });
    expect((await nico.next("lobby")).goldBonus).toBe(lobby.you);

    const guest = await playerSocket(base, "Guest");
    guest.send({ type: "join", game: lobby.game });
    expect(await guest.next("lobby")).toMatchObject({ operator: false, goldBonus: lobby.you });
    nico.send({ type: "start" });
    expect((await guest.next("started")).goldBonus).toBe(1);
    nico.socket.close();
    guest.socket.close();
  });

  it("is never offered in a public game", async () => {
    const operators = new Set<string>();
    const base = await start({ operatorAccounts: operators });
    const { session = "" } = await signIn(base);
    const { accounts } = JSON.parse(readFileSync(accountsFile(dataDir), "utf8")) as {
      accounts: { id: string }[];
    };
    for (const { id } of accounts) operators.add(id);
    const nico = await playerSocket(base, "x", `frontfall_session=${session}`);
    nico.send({ type: "create", visibility: "public", name: "Open game" });
    expect((await nico.next("lobby")).operator).toBe(false);
    nico.send({ type: "configure", options, operatorGold: true });
    expect(await nico.next("error")).toMatchObject({ code: "not_operator" });
    nico.socket.close();
  });
});

describe("Accounts", () => {
  it("folds case, accents and punctuation into one name", () => {
    expect(nameKey("Élodie-B.")).toBe(nameKey("elodie b"));
  });

  it("sets an unreadable file aside rather than overwriting it", () => {
    const file = accountsFile(dataDir);
    const accounts = new Accounts(file);
    accounts.signIn("google", "1", "Ana", Date.now());
    writeFileSync(file, "{ not json");
    const again = new Accounts(file);
    const loaded = again.load();
    expect(loaded.usable).toBe(true);
    expect(loaded.error?.message).toMatch(/kept as .*accounts\.json\.broken-\d+/);
    expect(again.size).toBe(0);
  });

  it("keeps working in memory when its file cannot be written", () => {
    // A directory where the file should be: every write fails.
    const file = join(dataDir, "blocked");
    mkdirSync(join(file, "accounts.json"), { recursive: true });
    const errors: Error[] = [];
    const accounts = new Accounts(join(file, "accounts.json"), (error) => errors.push(error));
    const ana = accounts.signIn("google", "1", "Ana", Date.now());
    expect(accounts.rename(ana.id, "Anna")).toMatchObject({ ok: true });
    expect(accounts.get(ana.id)?.name).toBe("Anna");
    expect(errors.length).toBeGreaterThan(0);
    // A deletion the file never got is refused, so the account cannot come back at the next start.
    expect(accounts.remove(ana.id)).toBe(false);
    expect(accounts.get(ana.id)?.name).toBe("Anna");
  });

  it("gives a name to a player whose name at the service has nothing usable", () => {
    const accounts = new Accounts(undefined);
    expect(accounts.signIn("discord", "1", "!!!", Date.now()).name).toBe("Player");
    expect(accounts.signIn("discord", "2", "", Date.now()).name).toMatch(/^Player\d{4}$/);
  });
});
