import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { get } from "node:http";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  PROTOCOL_VERSION,
  CloseCode,
  encodeClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "@frontfall/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createGameServer, type GameServer, type ServerOptions } from "../src/server.ts";

let staticRoot: string;
let server: GameServer | undefined;
let clients: WebSocket[] = [];

beforeEach(() => {
  staticRoot = mkdtempSync(join(tmpdir(), "frontfall-static-"));
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html>");
});

afterEach(async () => {
  for (const client of clients) client.terminate();
  clients = [];
  await server?.close();
  server = undefined;
  rmSync(staticRoot, { recursive: true, force: true });
});

async function start(options: Partial<ServerOptions> = {}): Promise<string> {
  server = createGameServer({
    staticRoot,
    version: "abc123",
    drainMs: 0,
    // Most tests read the list right after a change.
    gameListMs: 0,
    ...options,
  });
  const http = server.http;
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  return `127.0.0.1:${String((http.address() as AddressInfo).port)}`;
}

/** A client that buffers every message, so none is lost between two awaits. */
function open(host: string, headers: Record<string, string> = {}, autoPong = true) {
  const socket = new WebSocket(`ws://${host}/ws`, { headers, autoPong });
  clients.push(socket);
  const inbox: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  socket.on("message", (data: Buffer, isBinary: boolean) => {
    const parsed = parseServerMessage(isBinary ? new Uint8Array(data) : data.toString("utf8"));
    if (parsed.ok) inbox.push(parsed.value);
    waiters.splice(0).forEach((wake) => {
      wake();
    });
  });
  const next = async <T extends ServerMessage["type"]>(type: T) => {
    for (;;) {
      const index = inbox.findIndex((message) => message.type === type);
      if (index >= 0) return inbox.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  const send = (message: ClientMessage) => {
    socket.send(encodeClientMessage(message));
  };
  return { socket, next, send };
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => {
      resolve();
    });
    socket.once("error", reject);
  });
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once("close", resolve));
}

/** A connected client that has said hello. */
async function player(host: string, name: string, autoPong = true) {
  const client = open(host, {}, autoPong);
  await opened(client.socket);
  client.send({ type: "hello", version: PROTOCOL_VERSION, name });
  await client.next("welcome");
  return client;
}

describe("HTTP", () => {
  it("answers the health check with the build version, never cached", async () => {
    const response = await fetch(`http://${await start()}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("x-frontfall-version")).toBe("abc123");
    expect(response.headers.get("x-frontfall-release")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("names the release next to the build when it knows it", async () => {
    const response = await fetch(`http://${await start({ release: "0.4.0" })}/healthz`);
    expect(response.headers.get("x-frontfall-release")).toBe("0.4.0");
  });

  it("fails the health check once turns stop being closed", async () => {
    // With no delay allowed, the last turn is always too old.
    const response = await fetch(`http://${await start({ stallAfterMs: 0 })}/healthz`);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("stalled");
    expect(response.headers.get("x-frontfall-version")).toBe("abc123");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("stays healthy while the turn timer keeps up, with no game running", async () => {
    const host = await start({ stallAfterMs: 500 });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect((await fetch(`http://${host}/healthz`)).status).toBe(200);
  });

  it("fails the health check of a request still in flight at shutdown", async () => {
    const host = await start();
    const [address, port] = host.split(":");
    const socket = connect(Number(port), address);
    await new Promise((resolve) => socket.once("connect", resolve));
    // Half a request keeps the connection busy, so close() leaves it open.
    socket.write("GET /healthz HTTP/1.1\r\nHost: x\r\n");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const closed = server?.close();
    server = undefined;
    const reply = new Promise<string>((resolve) => {
      let text = "";
      socket.on("data", (chunk: Buffer) => (text += chunk.toString()));
      socket.on("end", () => {
        resolve(text);
      });
    });
    socket.end("Connection: close\r\n\r\n");
    const text = await reply;
    await closed;
    expect(text).toMatch(/^HTTP\/1\.1 503/);
    expect(text.slice(text.indexOf("\r\n\r\n"))).toContain("stopping");
  });

  it("serves the client, caching hashed assets only", async () => {
    writeFileSync(join(staticRoot, "app.js"), "export {};");
    const host = await start();
    const page = await fetch(`http://${host}/`);
    expect(await page.text()).toBe("<!doctype html>");
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    // The page cannot be framed, and runs only what it loads from its own origin.
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(page.headers.get("referrer-policy")).toBe("same-origin");

    const head = await fetch(`http://${host}/app.js`, { method: "HEAD" });
    expect(head.headers.get("content-type")).toContain("text/javascript");
    expect(await head.text()).toBe("");
    expect((await fetch(`http://${host}/missing.js`)).status).toBe(404);
  });

  it("marks files under /assets/ as immutable", async () => {
    mkdirSync(join(staticRoot, "assets"));
    writeFileSync(join(staticRoot, "assets/index-1a2b.js"), "export {};");
    const response = await fetch(`http://${await start()}/assets/index-1a2b.js`);
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("serves metrics to the host only, never through the proxy", async () => {
    const host = await start();
    const direct = await fetch(`http://${host}/metrics`);
    expect(direct.status).toBe(200);
    expect(direct.headers.get("content-type")).toContain("text/plain");
    const text = await direct.text();
    expect(text).toContain('frontfall_games{state="open"} 0');
    expect(text).toContain("frontfall_turn_duration_seconds_count");
    for (const header of ["x-client-ip", "x-forwarded-for", "forwarded"]) {
      const proxied = await fetch(`http://${host}/metrics`, { headers: { [header]: "1.2.3.4" } });
      expect(proxied.status).toBe(404);
    }
  });

  it("sends large files gzipped to clients that accept it", async () => {
    const map = new Uint8Array(64 * 1024).fill(3);
    writeFileSync(join(staticRoot, "world.bin"), map);
    const host = await start();
    const raw = (encoding?: string) =>
      new Promise<{ headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
        get(
          `http://${host}/world.bin`,
          { headers: encoding ? { "accept-encoding": encoding } : {} },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => {
              resolve({ headers: response.headers, body: Buffer.concat(chunks) });
            });
          },
        ).on("error", reject);
      });

    const zipped = await raw("gzip, deflate, br");
    expect(zipped.headers["content-encoding"]).toBe("gzip");
    expect(zipped.headers.vary).toBe("Accept-Encoding");
    expect(zipped.headers["content-type"]).toBe("application/octet-stream");
    expect(Number(zipped.headers["content-length"])).toBe(zipped.body.length);
    expect(gunzipSync(zipped.body).equals(Buffer.from(map))).toBe(true);

    for (const encoding of [undefined, "br", "gzip;q=0"]) {
      const plain = await raw(encoding);
      expect(plain.headers["content-encoding"]).toBeUndefined();
      expect(plain.body.length).toBe(map.length);
    }
  });

  it("lets browsers revalidate files with their ETag", async () => {
    writeFileSync(join(staticRoot, "world.json"), JSON.stringify({ id: "world" }));
    const host = await start();
    const first = await fetch(`http://${host}/world.json`);
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^W\/"[\w-]{22}"$/);
    const again = await fetch(`http://${host}/world.json`, {
      headers: { "if-none-match": `"other", ${etag?.slice(2) ?? ""}` },
    });
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
    expect(await again.text()).toBe("");
    const changed = await fetch(`http://${host}/world.json`, {
      headers: { "if-none-match": 'W/"stale"' },
    });
    expect(changed.status).toBe(200);
  });

  it("rejects other methods", async () => {
    const response = await fetch(`http://${await start()}/`, { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("WebSocket", () => {
  const fast = { publicGame: { countdownMs: 50, soloBots: 0 } };
  /** Seats asked for in `configure`; the map and bots may leave fewer. */
  const SEATS = { capacity: 4, autoStart: false } as const;

  it("plays a public game: lobby, countdown, start, then the same turns for everyone", async () => {
    const host = await start(fast);
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");

    alice.send({ type: "play" });
    expect(await alice.next("lobby")).toMatchObject({
      visibility: "public",
      name: "Alice's game",
      players: [{ id: 1, name: "Alice" }],
      host: 1,
      startsIn: null,
    });
    bob.send({ type: "play" });
    const lobby = await bob.next("lobby");
    expect(lobby.players).toHaveLength(2);
    expect(lobby.startsIn).toBeGreaterThan(0);

    const [a, b] = await Promise.all([alice.next("started"), bob.next("started")]);
    expect(a.seed).toBe(b.seed);
    expect(a.game).toBe(lobby.game);
    expect([a.you, b.you]).toEqual([1, 2]);

    alice.send({ type: "order", order: { type: "spawn", tile: 7 } });
    for (;;) {
      const { turns } = await bob.next("turns");
      const orders = turns.flatMap((turn) => turn.orders);
      if (orders.length === 0) continue;
      expect(orders).toEqual([{ player: 1, order: { type: "spawn", tile: 7 } }]);
      break;
    }
  });

  it("lists public games over HTTP, with an ETag for the menu's polling", async () => {
    const host = await start();
    const alice = await player(host, "Alice");
    alice.send({ type: "play", name: "Partie de Alice" });
    const { game } = await alice.next("lobby");
    const response = await fetch(`http://${host}/api/games`);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.json()).toEqual({
      games: [
        {
          id: game,
          name: "Partie de Alice",
          host: "Alice",
          map: "world",
          bots: 0,
          nations: true,
          teams: 0,
          disabled: 0,
          rules: { collapsingFronts: true, capitals: false },
          players: 1,
          capacity: 16,
          state: "waiting",
        },
      ],
      running: 0,
    });
    const etag = response.headers.get("etag") ?? "";
    expect(etag).not.toBe("");
    const again = await fetch(`http://${host}/api/games`, { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    const bob = await player(host, "Bob");
    bob.send({ type: "join", game });
    await bob.next("lobby");
    const changed = await fetch(`http://${host}/api/games`, { headers: { "if-none-match": etag } });
    expect(changed.status).toBe(200);
  });

  it("opens a named public game that waits for its host to start it", async () => {
    const host = await start({ publicGame: { countdownMs: 50 } });
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");
    alice.send({ type: "create", visibility: "public", name: "fuck off" });
    expect((await alice.next("error")).code).toBe("invalid_game_name");
    // Without a name, the game is named after its host, a name always valid.
    const named = await player(host, "Maximilien-Alexandre");
    named.send({ type: "create", visibility: "public" });
    expect((await named.next("lobby")).name).toBe("Maximilien-Alexandre's game");
    named.send({ type: "leave" });
    alice.send({ type: "create", visibility: "public", name: "  Europe   4v4 " });
    const lobby = await alice.next("lobby");
    expect(lobby).toMatchObject({ visibility: "public", name: "Europe 4v4", host: 1 });
    alice.send({ type: "start" });
    expect((await alice.next("error")).code).toBe("not_enough_players");

    // Bob joins from the list; the game keeps waiting for its host.
    bob.send({ type: "join", game: lobby.game });
    expect((await bob.next("lobby")).game).toBe(lobby.game);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await alice.next("lobby")).startsIn).toBeNull();
    expect(server?.games.find(lobby.game)?.state).toBe("open");

    alice.send({
      type: "configure",
      options: {
        map: "world",
        bots: 0,
        difficulty: "normal",
        nations: true,
        teams: 2,
        disabled: 0,
        capacity: 8,
        autoStart: false,
      },
      name: "Équipes du soir",
    });
    expect(await bob.next("lobby")).toMatchObject({
      name: "Équipes du soir",
      teams: 2,
      capacity: 8,
      autoStart: false,
    });
    // A public game stays at speed 1 (R-MODE-07).
    alice.send({
      type: "configure",
      options: {
        map: "world",
        bots: 0,
        difficulty: "normal",
        nations: true,
        teams: 2,
        disabled: 0,
        capacity: 8,
        autoStart: false,
        speed: 2,
      },
    });
    expect((await alice.next("error")).code).toBe("invalid_settings");
    alice.send({ type: "start" });
    expect((await bob.next("started")).teams).toBe(2);
    const listed = (await (await fetch(`http://${host}/api/games`)).json()) as {
      games: { state: string }[];
    };
    expect(listed.games.map((game) => game.state)).toEqual(["running"]);
  });

  it("lets the host of a quick game stop its countdown", async () => {
    const host = await start({ publicGame: { countdownMs: 300 } });
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");
    alice.send({ type: "play" });
    await alice.next("lobby");
    bob.send({ type: "play" });
    await bob.next("lobby");
    expect(await alice.next("lobby")).toMatchObject({ holdable: true });
    bob.send({ type: "hold" });
    expect((await bob.next("error")).code).toBe("not_host");
    alice.send({ type: "hold" });
    expect(await bob.next("lobby")).toMatchObject({ startsIn: null, holdable: false });
    await new Promise((resolve) => setTimeout(resolve, 500));
    alice.send({ type: "active" });
    alice.send({ type: "start" });
    expect((await bob.next("started")).players).toHaveLength(2);
  });

  it("plays a private game by invitation, started by its host", async () => {
    const host = await start();
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");
    alice.send({ type: "create" });
    const { game, host: hostId } = await alice.next("lobby");
    expect(hostId).toBe(1);
    expect(await (await fetch(`http://${host}/api/games`)).json()).toEqual({
      games: [],
      running: 0,
    });

    bob.send({ type: "join", game });
    await bob.next("lobby");
    bob.send({ type: "start" });
    expect((await bob.next("error")).code).toBe("not_host");
    // Its host may speed it up (R-MODE-07).
    alice.send({
      type: "configure",
      options: {
        map: "world",
        bots: 0,
        difficulty: "normal",
        nations: true,
        teams: 0,
        disabled: 0,
        capacity: 16,
        autoStart: false,
        speed: 4,
        rules: { collapsingFronts: true, capitals: true },
      },
    });
    expect(await bob.next("lobby")).toMatchObject({
      speed: 4,
      rules: { collapsingFronts: true, capitals: true },
    });
    alice.send({ type: "start" });
    const started = await bob.next("started");
    expect(started.speed).toBe(4);
    expect(started.rules).toEqual({ collapsingFronts: true, capitals: true });
    expect(started.players).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  });

  it("lets the host pick a published map, bots and difficulty", async () => {
    mkdirSync(join(staticRoot, "maps"));
    const entry = (id: string, max: number) => ({
      id,
      name: { en: id, fr: id },
      width: 64,
      height: 32,
      topology: "flat",
      players: { min: 2, recommended: 8, max },
      manifest: `${id}.json`,
      thumbnail: `${id}.png`,
    });
    writeFileSync(
      join(staticRoot, "maps", "index.json"),
      JSON.stringify({ format: 1, maps: [entry("world", 64), entry("europe", 20)] }),
    );
    const host = await start({ privateGame: { capacity: 4 } });
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");
    alice.send({ type: "create" });
    const lobby = await alice.next("lobby");
    expect(lobby).toMatchObject({
      map: "world",
      bots: 0,
      difficulty: "normal",
      nations: true,
      teams: 0,
    });
    bob.send({ type: "join", game: lobby.game });
    await bob.next("lobby");
    await alice.next("lobby");

    bob.send({
      type: "configure",
      options: {
        map: "europe",
        bots: 2,
        difficulty: "hard",
        nations: true,
        teams: 0,
        disabled: 0,
        ...SEATS,
      },
    });
    expect((await bob.next("error")).code).toBe("not_host");
    alice.send({
      type: "configure",
      options: {
        map: "mars",
        bots: 2,
        difficulty: "hard",
        nations: true,
        teams: 0,
        disabled: 0,
        ...SEATS,
      },
      seq: 7,
    });
    expect((await alice.next("error")).code).toBe("invalid_settings");
    // Numbered, a refusal comes with the settings that hold, for a form gone ahead.
    expect(await alice.next("lobby")).toMatchObject({ map: "world", configured: 7 });
    alice.send({
      type: "configure",
      options: {
        map: "world",
        bots: 26,
        difficulty: "hard",
        nations: true,
        teams: 0,
        disabled: 0,
        ...SEATS,
      },
    });
    expect((await alice.next("error")).code).toBe("invalid_settings");
    // Europe holds 20: 19 bots would leave one seat for two players.
    alice.send({
      type: "configure",
      options: {
        map: "europe",
        bots: 19,
        difficulty: "hard",
        nations: true,
        teams: 0,
        disabled: 0,
        ...SEATS,
      },
    });
    expect((await alice.next("error")).code).toBe("invalid_settings");
    alice.send({
      type: "configure",
      options: {
        map: "europe",
        bots: 18,
        difficulty: "hard",
        nations: true,
        teams: 0,
        disabled: 0,
        ...SEATS,
      },
      seq: 8,
    });
    expect(await alice.next("lobby")).toMatchObject({ map: "europe", configured: 8 });
    expect(await bob.next("lobby")).toMatchObject({
      configured: 0,
      map: "europe",
      bots: 18,
      difficulty: "hard",
      nations: true,
      teams: 0,
      capacity: 2,
    });
    alice.send({
      type: "configure",
      options: {
        map: "europe",
        bots: 16,
        difficulty: "hard",
        nations: false,
        teams: 0,
        disabled: 32,
        ...SEATS,
      },
    });
    expect(await bob.next("lobby")).toMatchObject({
      bots: 16,
      nations: false,
      teams: 0,
      capacity: 4,
    });

    alice.send({ type: "start" });
    expect(await bob.next("started")).toMatchObject({
      map: "europe",
      bots: 16,
      difficulty: "hard",
      nations: false,
      teams: 0,
      disabled: 32,
    });
    alice.send({
      type: "configure",
      options: {
        map: "world",
        bots: 0,
        difficulty: "easy",
        nations: true,
        teams: 0,
        disabled: 0,
        ...SEATS,
      },
    });
    expect((await alice.next("error")).code).toBe("game_started");
  });

  it("explains why a game cannot be joined", async () => {
    const host = await start({ privateGame: { capacity: 1, autoStart: false } });
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");
    bob.send({ type: "join", game: "nosuchgame00" });
    expect((await bob.next("error")).code).toBe("not_found");

    alice.send({ type: "create" });
    const { game } = await alice.next("lobby");
    bob.send({ type: "join", game });
    expect((await bob.next("error")).code).toBe("game_full");
    alice.send({ type: "play" });
    expect((await alice.next("error")).code).toBe("already_in_game");
    bob.send({ type: "start" });
    expect((await bob.next("error")).code).toBe("not_in_game");
  });

  it("lets a player leave and join another game", async () => {
    const host = await start();
    const alice = await player(host, "Alice");
    alice.send({ type: "create" });
    await alice.next("lobby");
    alice.send({ type: "leave" });
    expect((await alice.next("ended")).reason).toBe("left");
    expect(server?.games.size).toBe(0);
    alice.send({ type: "play" });
    expect((await alice.next("lobby")).visibility).toBe("public");
  });

  it("gives a dropped player their seat back with every missed turn", async () => {
    const host = await start();
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");
    alice.send({ type: "create" });
    const { game } = await alice.next("lobby");
    bob.send({ type: "join", game });
    await bob.next("lobby");
    alice.send({ type: "start" });
    const { token } = await bob.next("started");
    await bob.next("turns");

    bob.socket.close();
    await closed(bob.socket);
    alice.send({ type: "order", order: { type: "spawn", tile: 3 } });
    let last: number;
    for (;;) {
      const { turns } = await alice.next("turns");
      last = turns.at(-1)?.tick ?? 0;
      if (turns.some((turn) => turn.orders.length > 0)) break;
    }

    const back = await player(host, "Bob");
    back.send({ type: "rejoin", token, from: 0 });
    expect((await back.next("started")).you).toBe(2);
    const replayed = [];
    while (replayed.length <= last) replayed.push(...(await back.next("turns")).turns);
    expect(replayed.map((turn) => turn.tick).slice(0, last + 1)).toEqual(
      Array.from({ length: last + 1 }, (_, tick) => tick),
    );
    expect(replayed.flatMap((turn) => turn.orders)).toEqual([
      { player: 1, order: { type: "spawn", tile: 3 } },
    ]);

    const thief = await player(host, "Mallory");
    thief.send({ type: "rejoin", token, from: 0 });
    expect((await thief.next("error")).code).toBe("token_in_use");
    thief.send({ type: "rejoin", token: "0123456789abcdefghij", from: 0 });
    expect((await thief.next("error")).code).toBe("token_invalid");
  });

  it("drops a stale connection when its seat is claimed, so the owner can rejoin", async () => {
    const host = await start({ probeTimeoutMs: 30 });
    const alice = await player(host, "Alice");
    // Bob's connection is half-open: it stays up but never answers pings.
    const stale = await player(host, "Bob", false);
    alice.send({ type: "create" });
    const { game } = await alice.next("lobby");
    stale.send({ type: "join", game });
    await stale.next("lobby");
    alice.send({ type: "start" });
    const { token } = await stale.next("started");

    const back = await player(host, "Bob");
    back.send({ type: "rejoin", token, from: 0 });
    expect((await back.next("error")).code).toBe("token_in_use");
    expect(await closed(stale.socket)).toBe(1006);
    back.send({ type: "rejoin", token, from: 0 });
    expect((await back.next("started")).you).toBe(2);
  });

  it("closes a connection that speaks another protocol version", async () => {
    const client = open(await start());
    await opened(client.socket);
    client.send({ type: "hello", version: 0, name: "Old" });
    expect(await closed(client.socket)).toBe(CloseCode.versionMismatch);
  });

  it("closes a connection from a page of another build", async () => {
    const host = await start();
    const old = open(host);
    await opened(old.socket);
    old.send({ type: "hello", version: PROTOCOL_VERSION, name: "Old", build: "0123456789ab" });
    expect(await closed(old.socket)).toBe(CloseCode.versionMismatch);

    const same = open(host);
    await opened(same.socket);
    same.send({ type: "hello", version: PROTOCOL_VERSION, name: "Same", build: "abc123" });
    await same.next("welcome");
    const dev = open(host);
    await opened(dev.socket);
    dev.send({ type: "hello", version: PROTOCOL_VERSION, name: "Dev", build: "dev" });
    await dev.next("welcome");
  });

  it("ignores what a page of another build or protocol sends after its hello", async () => {
    const host = await start();
    for (const hello of [{ build: "0123456789ab", version: PROTOCOL_VERSION }, { version: 0 }]) {
      const old = open(host);
      await opened(old.socket);
      old.send({ type: "hello", name: "Old", ...hello });
      old.send({ type: "hello", version: PROTOCOL_VERSION, name: "Old" });
      old.send({ type: "create" });
      expect(await closed(old.socket)).toBe(CloseCode.versionMismatch);
    }
    expect(server?.games.size).toBe(0);
    // A stale page is told to reload, not counted as misbehaving.
    expect(server?.metrics.rejected.get({ reason: "invalid" })).toBe(0);
  });

  it("keeps the pages of another commit with the same simulation build", async () => {
    const host = await start({ version: "newcommit", simulation: "5e5e5e5e5e5e" });
    const kept = open(host);
    await opened(kept.socket);
    kept.send({ type: "hello", version: PROTOCOL_VERSION, name: "Kept", build: "5e5e5e5e5e5e" });
    await kept.next("welcome");

    const other = open(host);
    await opened(other.socket);
    other.send({ type: "hello", version: PROTOCOL_VERSION, name: "Other", build: "newcommit" });
    expect(await closed(other.socket)).toBe(CloseCode.versionMismatch);
  });

  it("asks for another name when the name is not allowed", async () => {
    const client = open(await start());
    await opened(client.socket);
    client.send({ type: "hello", version: PROTOCOL_VERSION, name: "<b>" });
    expect((await client.next("error")).code).toBe("invalid_name");
    client.send({ type: "hello", version: PROTOCOL_VERSION, name: "Bold" });
    await client.next("welcome");
    client.send({ type: "hello", version: PROTOCOL_VERSION, name: "Again" });
    expect(await closed(client.socket)).toBe(CloseCode.invalidMessage);
  });

  it("closes a connection that skips hello or sends an invalid frame", async () => {
    const host = await start();
    const early = open(host);
    await opened(early.socket);
    early.send({ type: "play" });
    expect(await closed(early.socket)).toBe(CloseCode.invalidMessage);

    const garbage = open(host);
    await opened(garbage.socket);
    garbage.socket.send(new Uint8Array([2, 0x80]));
    expect(await closed(garbage.socket)).toBe(CloseCode.invalidMessage);

    const text = open(host);
    await opened(text.socket);
    text.socket.send("{");
    expect(await closed(text.socket)).toBe(CloseCode.invalidMessage);
  });

  it("closes with a shortened reason when the error quotes non-ASCII input", async () => {
    const client = await player(await start(), "Accent");
    const reason = new Promise<Buffer>((resolve) =>
      client.socket.once("close", (_code: number, text: Buffer) => {
        resolve(text);
      }),
    );
    client.socket.send(`{"type":"play","${"é".repeat(80)}":1}`);
    const text = await reason;
    expect(text.byteLength).toBeLessThanOrEqual(123);
    expect(text.toString("utf8")).toMatch(/^✖ Unrecognized key: "é+$/);
  });

  it("closes oversized frames", async () => {
    const client = await player(await start(), "Big");
    client.socket.send("x".repeat(2048));
    expect(await closed(client.socket)).toBe(1009);
  });

  it("closes a connection that never says hello", async () => {
    const client = open(await start({ helloTimeoutMs: 30 }));
    await opened(client.socket);
    expect(await closed(client.socket)).toBe(CloseCode.idle);
  });

  it("closes a connection that sends too many messages", async () => {
    const host = await start({ messageRate: { perSecond: 1, burst: 3 } });
    const client = await player(host, "Flood");
    for (let index = 0; index < 5; index++) {
      client.send({ type: "order", order: { type: "spawn", tile: index } });
    }
    expect(await closed(client.socket)).toBe(CloseCode.rateLimited);
    expect(server?.metrics.rejected.get({ reason: "rate_limited" })).toBe(1);
  });

  it("keeps other games at their pace while one connection floods", async () => {
    const host = await start({ messageRate: { perSecond: 5, burst: 10 } });
    const alice = await player(host, "Alice");
    alice.send({ type: "create" });
    await alice.next("lobby");
    alice.send({ type: "start" });
    await alice.next("started");
    const flood = await player(host, "Flood");
    const floodClosed = closed(flood.socket);
    for (let index = 0; index < 200; index++) flood.send({ type: "hash", tick: index, hash: 1 });
    const startedAt = Date.now();
    for (let count = 0; count < 5; count++) await alice.next("turns");
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(await floodClosed).toBe(CloseCode.rateLimited);
  });

  it("closes a connection that stays out of any game too long", async () => {
    const host = await start({ idleTimeoutMs: 50, pingIntervalMs: 20 });
    const idle = await player(host, "Idle");
    const waiting = await player(host, "Waiting");
    waiting.send({ type: "create" });
    await waiting.next("lobby");
    expect(await closed(idle.socket)).toBe(CloseCode.idle);
    expect(waiting.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("logs games and rejected connections without client addresses", async () => {
    const lines: string[] = [];
    const host = await start({
      logger: {
        info: (event, fields) => lines.push(JSON.stringify({ event, ...fields })),
        warn: (event, fields) => lines.push(JSON.stringify({ event, ...fields })),
      },
    });
    const alice = await player(host, "Alice");
    alice.send({ type: "create" });
    await alice.next("lobby");
    alice.send({ type: "start" });
    await alice.next("started");
    const rude = open(host, { "x-client-ip": "203.0.113.77" });
    await opened(rude.socket);
    rude.socket.send("{");
    await closed(rude.socket);
    expect(lines.some((line) => line.includes('"event":"game_started"'))).toBe(true);
    expect(lines.some((line) => line.includes('"event":"connection_rejected"'))).toBe(true);
    expect(lines.join("\n")).not.toContain("203.0.113.77");
  });

  it("refuses pages from another origin", async () => {
    const host = await start({ allowedOrigin: "https://nclsmgr.com" });
    const foreign = open(host, { origin: "https://evil.example" });
    await expect(opened(foreign.socket)).rejects.toThrow("403");
    const own = open(host, { origin: "https://nclsmgr.com" });
    await expect(opened(own.socket)).resolves.toBeUndefined();
  });

  it("refuses upgrades outside /ws", async () => {
    const socket = new WebSocket(`ws://${await start()}/other`);
    clients.push(socket);
    await expect(opened(socket)).rejects.toThrow("403");
  });

  it("limits connections per player address, as reported by the proxy", async () => {
    const host = await start({ maxConnectionsPerAddress: 2 });
    const first = open(host, { "x-client-ip": "203.0.113.9" });
    const second = open(host, { "x-client-ip": "203.0.113.9" });
    await Promise.all([opened(first.socket), opened(second.socket)]);
    await expect(opened(open(host, { "x-client-ip": "203.0.113.9" }).socket)).rejects.toThrow(
      "429",
    );
    await expect(
      opened(open(host, { "x-client-ip": "198.51.100.4" }).socket),
    ).resolves.toBeUndefined();

    first.socket.close();
    await closed(first.socket);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(
      opened(open(host, { "x-client-ip": "203.0.113.9" }).socket),
    ).resolves.toBeUndefined();
  });

  it("gives the address its connection back when the handshake is refused", async () => {
    const host = await start({ maxConnectionsPerAddress: 2 });
    const [address, port] = host.split(":");
    for (let i = 0; i < 3; i++) {
      const socket = connect(Number(port), address);
      const reply = new Promise<string>((resolve, reject) => {
        let text = "";
        socket.on("data", (chunk: Buffer) => (text += chunk.toString()));
        socket.on("error", reject);
        socket.on("close", () => {
          resolve(text);
        });
      });
      socket.write(
        "GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: not-a-key\r\n" +
          "X-Client-IP: 203.0.113.9\r\n\r\n",
      );
      expect(await reply).toMatch(/^HTTP\/1\.1 400/);
    }
    await expect(
      opened(open(host, { "x-client-ip": "203.0.113.9" }).socket),
    ).resolves.toBeUndefined();
  });

  it("limits how fast one address opens connections", async () => {
    const host = await start({ upgradeRate: { perSecond: 0.001, burst: 2 } });
    const headers = { "x-client-ip": "203.0.113.9" };
    for (let i = 0; i < 2; i++) {
      const client = open(host, headers);
      await opened(client.socket);
      client.socket.close();
      await closed(client.socket);
    }
    await expect(opened(open(host, headers).socket)).rejects.toThrow("429");
    await expect(
      opened(open(host, { "x-client-ip": "198.51.100.4" }).socket),
    ).resolves.toBeUndefined();
  });

  it("lets the host remove a player, who cannot join that game again (R-MODE-05)", async () => {
    const host = await start();
    const alice = await player(host, "Alice");
    alice.send({ type: "create" });
    const { game } = await alice.next("lobby");
    const bob = await player(host, "Bob");
    bob.send({ type: "join", game });
    const seated = await bob.next("lobby");
    await alice.next("lobby");
    bob.send({ type: "kick", player: 1 });
    expect((await bob.next("error")).code).toBe("not_host");
    alice.send({ type: "kick", player: seated.you });
    expect((await bob.next("ended")).reason).toBe("removed");
    expect((await alice.next("lobby")).players.map((p) => p.name)).toEqual(["Alice"]);
    bob.send({ type: "join", game });
    expect((await bob.next("error")).code).toBe("removed");
  });

  it("takes a report of another player, and shows it to the operator only (R-MODE-06)", async () => {
    const host = await start({ reportRate: { perSecond: 0.001, burst: 1 } });
    /** A player at their own address, as the proxy reports it. */
    const at = async (name: string, ip: string) => {
      const client = open(host, { "x-client-ip": ip });
      await opened(client.socket);
      client.send({ type: "hello", version: PROTOCOL_VERSION, name });
      await client.next("welcome");
      return client;
    };
    const alice = await at("Alice", "198.51.100.1");
    alice.send({ type: "report", player: 1, reason: "abuse" });
    expect((await alice.next("error")).code).toBe("not_in_game");
    alice.send({ type: "create" });
    const { game, you } = await alice.next("lobby");
    const bob = await at("Bob", "198.51.100.2");
    bob.send({ type: "join", game });
    const seated = await bob.next("lobby");
    const carol = await at("Carol", "198.51.100.3");
    carol.send({ type: "join", game });
    const third = await carol.next("lobby");
    // Alice's housemate shares her address, and so her reference: no report between them.
    const dave = await at("Dave", "198.51.100.1");
    dave.send({ type: "join", game });
    await dave.next("lobby");
    dave.send({ type: "report", player: you, reason: "abuse" });
    expect((await dave.next("error")).code).toBe("not_found");
    alice.send({ type: "report", player: you, reason: "abuse" });
    expect((await alice.next("error")).code).toBe("not_found");
    alice.send({ type: "report", player: seated.you, reason: "name" });
    expect(await alice.next("reported")).toEqual({ type: "reported", player: seated.you });
    // The same report again is taken without counting twice; another one is over the rate.
    alice.send({ type: "report", player: seated.you, reason: "name" });
    expect((await alice.next("reported")).player).toBe(seated.you);
    alice.send({ type: "report", player: third.you, reason: "cheating" });
    expect((await alice.next("error")).code).toBe("too_many_reports");
    bob.send({ type: "report", player: you, reason: "other" });
    expect((await bob.next("reported")).player).toBe(you);

    const url = `http://${host}/admin/reports`;
    expect((await fetch(url, { headers: { "x-client-ip": "1.2.3.4" } })).status).toBe(404);
    const { reports, targets } = (await (await fetch(url)).json()) as {
      reports: { reason: string; name: string; target: string }[];
      targets: { target: string; reports: number; names: string[] }[];
    };
    expect(reports.map((r) => [r.reason, r.name])).toEqual([
      ["other", "Alice"],
      ["name", "Bob"],
    ]);
    expect(targets.map((t) => [t.names, t.reports])).toEqual([
      [["Alice"], 1],
      [["Bob"], 1],
    ]);
    expect(JSON.stringify(reports)).not.toContain("198.51.100");
  });

  it("lets the operator ban an address, closing its connections (R-MODE-06)", async () => {
    const host = await start();
    const troll = open(host, { "x-client-ip": "203.0.113.9" });
    await opened(troll.socket);
    const url = `http://${host}/admin/bans`;
    expect(
      (
        await fetch(`${url}?target=203.0.113.9`, {
          method: "POST",
          headers: { "x-client-ip": "1.2.3.4" },
        })
      ).status,
    ).toBe(404);
    expect((await fetch(`${url}?target=nobody`, { method: "POST" })).status).toBe(400);
    const gone = closed(troll.socket);
    const answer = await fetch(`${url}?target=203.0.113.9&days=7&note=insults`, { method: "POST" });
    expect(await answer.json()).toMatchObject({
      bans: [{ target: "203.0.113.9", note: "insults" }],
      closed: 1,
    });
    expect(await gone).toBe(CloseCode.banned);

    const again = open(host, { "x-client-ip": "203.0.113.9" });
    expect(await closed(again.socket)).toBe(CloseCode.banned);
    const other = open(host, { "x-client-ip": "198.51.100.4" });
    await opened(other.socket);

    expect((await fetch(`${url}?target=203.0.113.9`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${url}?target=203.0.113.9`, { method: "DELETE" })).status).toBe(404);
    await expect(
      opened(open(host, { "x-client-ip": "203.0.113.9" }).socket),
    ).resolves.toBeUndefined();
  });

  it("refuses connections beyond the server-wide cap with a code saying the server is full", async () => {
    const host = await start({ maxConnections: 1 });
    const first = open(host);
    await opened(first.socket);
    expect(await closed(open(host).socket)).toBe(CloseCode.full);
    expect(server?.metrics.refused.get({ reason: "connections" })).toBe(1);
  });

  it("turns new players away once full, and still lets a player back into their game", async () => {
    const host = await start({ maxPlayers: 2 });
    const alice = await player(host, "Alice");
    alice.send({ type: "create" });
    const { game } = await alice.next("lobby");
    const bob = await player(host, "Bob");
    bob.send({ type: "join", game });
    await bob.next("lobby");
    alice.send({ type: "start" });
    const { token } = await alice.next("started");
    // The count is taken at the next tick.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const carol = await player(host, "Carol");
    carol.send({ type: "play" });
    expect((await carol.next("error")).code).toBe("too_many_games");
    alice.socket.close();
    await closed(alice.socket);
    const back = await player(host, "Alice");
    back.send({ type: "rejoin", token, from: 0 });
    await back.next("started");
    expect((await back.next("turns")).turns[0]?.tick).toBe(0);
  });

  it("caps the number of games open at once", async () => {
    const host = await start({ maxRooms: 1 });
    const first = await player(host, "A");
    const second = await player(host, "B");
    first.send({ type: "create" });
    await first.next("lobby");
    second.send({ type: "create" });
    expect((await second.next("error")).code).toBe("too_many_games");
    second.send({ type: "play" });
    expect((await second.next("error")).code).toBe("too_many_games");
  });

  it("caps the lobbies of one address, but not Play now", async () => {
    const host = await start();
    const players = await Promise.all(["A", "B", "C", "D"].map((name) => player(host, name)));
    for (const one of players.slice(0, 3)) {
      one.send({ type: "create" });
      await one.next("lobby");
    }
    const [, , , last] = players;
    if (!last) throw new Error("no fourth player");
    last.send({ type: "create", visibility: "public", name: "One more" });
    expect((await last.next("error")).code).toBe("too_many_lobbies");
    last.send({ type: "play" });
    expect((await last.next("lobby")).visibility).toBe("public");
  });

  it("drops a client that stops answering pings", async () => {
    const host = await start({ pingIntervalMs: 30 });
    const silent = open(host, {}, false);
    const healthy = open(host);
    await Promise.all([opened(silent.socket), opened(healthy.socket)]);
    expect(await closed(silent.socket)).toBe(1006);
    expect(healthy.socket.readyState).toBe(WebSocket.OPEN);
  });

  /** Alice hosts a private game that Bob joined; it runs once both have `started`. */
  async function runningGame(host: string) {
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");
    alice.send({ type: "create" });
    const { game } = await alice.next("lobby");
    bob.send({ type: "join", game });
    await bob.next("lobby");
    alice.send({ type: "start" });
    await Promise.all([alice.next("started"), bob.next("started")]);
    return { alice, bob };
  }

  it("lets running games play on while it drains, and refuses new ones", async () => {
    const host = await start({ drainMs: 60_000 });
    const { alice, bob } = await runningGame(host);
    const waiting = await player(host, "Carol");
    waiting.send({ type: "create" });
    await waiting.next("lobby");
    const late = await player(host, "Dave");

    let done = false;
    const closing = server?.close().then(() => {
      done = true;
    });
    server = undefined;
    expect((await waiting.next("ended")).reason).toBe("restart");
    late.send({ type: "play" });
    expect((await late.next("error")).code).toBe("restarting");
    expect(await (await fetch(`http://${host}/healthz`)).text()).toBe("stopping");
    expect(await (await fetch(`http://${host}/api/games`)).json()).toEqual({
      games: [],
      running: 1,
    });

    const before = (await alice.next("turns")).turns.at(-1)?.tick ?? 0;
    await new Promise((resolve) => setTimeout(resolve, 300));
    let after = before;
    while (after < before + 2) after = (await alice.next("turns")).turns.at(-1)?.tick ?? 0;
    expect(done).toBe(false);

    alice.send({ type: "leave" });
    bob.send({ type: "leave" });
    await closing;
    expect(done).toBe(true);
  });

  it("counts a game as running while its players may still come back", async () => {
    const host = await start();
    const { alice, bob } = await runningGame(host);
    alice.socket.terminate();
    bob.socket.terminate();
    await Promise.all([closed(alice.socket), closed(bob.socket)]);
    expect(await (await fetch(`http://${host}/api/games`)).json()).toMatchObject({ running: 1 });
  });

  it("stops the games still running when the drain runs out, saying why", async () => {
    const host = await start({ drainMs: 200 });
    const { alice } = await runningGame(host);
    const code = closed(alice.socket);
    const closing = server?.close();
    server = undefined;
    expect((await alice.next("ended")).reason).toBe("restart");
    expect(await code).toBe(1012);
    await closing;
  });

  describe("with a data directory", () => {
    let dataDir: string;
    beforeEach(() => {
      dataDir = mkdtempSync(join(tmpdir(), "frontfall-data-"));
    });
    afterEach(() => {
      rmSync(dataDir, { recursive: true, force: true });
    });

    /** A running game with turns, stopped by the end of the drain; the token and the last tick. */
    async function savedGame(simulation: string) {
      const host = await start({ drainMs: 0, dataDir, simulation });
      const alice = await player(host, "Alice");
      const bob = await player(host, "Bob");
      alice.send({ type: "create" });
      const { game } = await alice.next("lobby");
      bob.send({ type: "join", game });
      await bob.next("lobby");
      // The special rules come back with the game (R-MODE-08).
      alice.send({
        type: "configure",
        options: {
          map: "world",
          bots: 0,
          difficulty: "normal",
          nations: true,
          teams: 0,
          disabled: 0,
          ...SEATS,
          rules: { collapsingFronts: true, capitals: true },
        },
      });
      await bob.next("lobby");
      alice.send({ type: "start" });
      const [started] = await Promise.all([alice.next("started"), bob.next("started")]);
      alice.send({ type: "order", order: { type: "spawn", tile: 5 } });
      let tick = 0;
      while (tick < 3) tick = (await alice.next("turns")).turns.at(-1)?.tick ?? 0;
      const code = closed(alice.socket);
      await server?.close();
      server = undefined;
      expect(await code).toBe(1012);
      return { game, token: started.token, tick };
    }

    it("keeps the games still running for the next run, which gives the seats back", async () => {
      const { game, token, tick } = await savedGame("5e5e5e5e5e5e");
      const file = join(dataDir, "games", `${game}.json`);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readFileSync(file, "utf8")).not.toContain("127.0.0.1");

      const host = await start({ dataDir, simulation: "5e5e5e5e5e5e" });
      expect(existsSync(file)).toBe(false);
      const back = await player(host, "Alice");
      back.send({ type: "rejoin", token, from: 0 });
      expect(await back.next("started")).toMatchObject({
        game,
        you: 1,
        token,
        rules: { collapsingFronts: true, capitals: true },
      });
      const turns = [];
      while (turns.length <= tick) turns.push(...(await back.next("turns")).turns);
      expect(turns.slice(0, tick + 1).map((turn) => turn.tick)).toEqual(
        Array.from({ length: tick + 1 }, (_, index) => index),
      );
      expect(turns.flatMap((turn) => turn.orders)).toEqual([
        { player: 1, order: { type: "spawn", tile: 5 } },
      ]);
      expect(await (await fetch(`http://${host}/api/games`)).json()).toMatchObject({ running: 1 });
    });

    it("does not drain, and says it keeps its games", async () => {
      const host = await start({ drainMs: 60_000, dataDir });
      expect(await (await fetch(`http://${host}/api/status`)).json()).toMatchObject({
        keepsGames: true,
      });
      const alice = await player(host, "Alice");
      const bob = await player(host, "Bob");
      alice.send({ type: "create" });
      const { game } = await alice.next("lobby");
      bob.send({ type: "join", game });
      await bob.next("lobby");
      alice.send({ type: "start" });
      await Promise.all([alice.next("started"), bob.next("started")]);
      const began = performance.now();
      await server?.close();
      server = undefined;
      expect(performance.now() - began).toBeLessThan(5_000);
      expect(existsSync(join(dataDir, "games", `${game}.json`))).toBe(true);
    });

    it("drops the games of another simulation build", async () => {
      const { game, token } = await savedGame("5e5e5e5e5e5e");
      const host = await start({ dataDir, simulation: "a1a1a1a1a1a1" });
      expect(existsSync(join(dataDir, "games", `${game}.json`))).toBe(false);
      const back = await player(host, "Alice");
      back.send({ type: "rejoin", token, from: 0 });
      expect((await back.next("error")).code).toBe("token_invalid");
    });

    it("starts despite a broken file, which it removes", async () => {
      mkdirSync(join(dataDir, "games"));
      writeFileSync(join(dataDir, "games", "broken.json"), "{");
      writeFileSync(join(dataDir, "games", "cut.json.tmp"), "{");
      await start({ dataDir });
      expect(readdirSync(join(dataDir, "games"))).toEqual([]);
    });
  });

  it("reads a ban list edited by hand when asked to, keeping the old one if it does not read", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "frontfall-data-"));
    try {
      const host = await start({ dataDir });
      const url = `http://${host}/admin/bans`;
      mkdirSync(join(dataDir, "moderation"), { recursive: true });
      const file = join(dataDir, "moderation", "bans.json");
      writeFileSync(file, JSON.stringify({ bans: [{ target: "203.0.113.9" }] }));
      expect(await (await fetch(url, { method: "POST" })).json()).toEqual({
        bans: [{ target: "203.0.113.9", until: null }],
        closed: 0,
      });
      expect(await closed(open(host, { "x-client-ip": "203.0.113.9" }).socket)).toBe(
        CloseCode.banned,
      );
      writeFileSync(file, "{ not json");
      expect((await fetch(url, { method: "POST" })).status).toBe(422);
      expect(((await (await fetch(url)).json()) as { bans: unknown[] }).bans).toHaveLength(1);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps a lobby seat across a dropped connection, host role included", async () => {
    const host = await start();
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");
    alice.send({ type: "create" });
    const { game, token } = await alice.next("lobby");
    bob.send({ type: "join", game });
    await bob.next("lobby");

    // No close frame, as when a phone goes to sleep.
    alice.socket.close();
    await closed(alice.socket);
    const back = await player(host, "Alice");
    back.send({ type: "rejoin", token, from: 0 });
    const lobby = await back.next("lobby");
    expect(lobby).toMatchObject({ game, you: 1, host: 1 });
    expect(lobby.players).toHaveLength(2);

    // A page that closes its socket, as on a reload, gives the seat up at once.
    bob.socket.close(1000);
    expect((await back.next("lobby")).players).toEqual([{ id: 1, name: "Alice" }]);
  });

  it("announces a restart to every player, from inside the container only", async () => {
    const host = await start();
    const alice = await player(host, "Alice");
    const url = `http://${host}/admin/maintenance?minutes=5`;
    expect(
      (await fetch(url, { method: "POST", headers: { "x-client-ip": "1.2.3.4" } })).status,
    ).toBe(404);
    expect((await fetch(url)).status).toBe(400);
    const answer = await fetch(url, { method: "POST" });
    expect(await answer.json()).toEqual({ minutes: 5, running: 0 });
    expect((await alice.next("maintenance")).inMs).toBe(300_000);

    // Players who arrive later are told too.
    const bob = await player(host, "Bob");
    expect((await bob.next("maintenance")).inMs).toBeGreaterThan(290_000);
    const status = (await (await fetch(`http://${host}/api/status`)).json()) as Record<
      string,
      unknown
    >;
    expect(status).toMatchObject({ version: "abc123", state: "ok", running: 0, lobbies: 0 });
    expect(status.restartInMs).toBeGreaterThan(290_000);
    const page = await (await fetch(`http://${host}/status`)).text();
    expect(page).toContain("Players online / Joueurs en ligne");
    expect(page).toContain("dans 5 min");

    await fetch(`http://${host}/admin/maintenance?minutes=0`, { method: "POST" });
    expect((await alice.next("maintenance")).inMs).toBeNull();
    expect(await (await fetch(`http://${host}/api/status`)).json()).toMatchObject({
      restartInMs: null,
    });
  });

  it("warns the players of running games when it starts to drain", async () => {
    const host = await start({ drainMs: 200 });
    const { alice } = await runningGame(host);
    const closing = server?.close();
    server = undefined;
    expect((await alice.next("maintenance")).inMs).toBe(200);
    await closing;
  });

  it("tells players the server is restarting when it closes", async () => {
    const host = await start();
    const client = await player(host, "X");
    client.send({ type: "create" });
    await client.next("lobby");
    const code = closed(client.socket);
    const closing = server?.close();
    server = undefined;
    expect(await code).toBe(1012);
    await closing;
  });
});
