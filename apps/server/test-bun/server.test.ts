import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloseCode, encodeClientMessage, PROTOCOL_VERSION } from "@frontfall/protocol";
import { createGameServer, type GameServer, type ServerOptions } from "../src/server.ts";
import { FakeTransport, type FakeSocket } from "../test/support/fake-transport.ts";
import { CLOSE, exchange, TEXT, WireSocket } from "./wire.ts";

/** Servers on Bun.serve, the transport of production, taken apart after each test. */
let staticRoot: string;
let servers: GameServer[] = [];
let sockets: (FakeSocket | WireSocket)[] = [];

beforeEach(() => {
  staticRoot = mkdtempSync(join(tmpdir(), "frontfall-static-"));
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html>");
  writeFileSync(join(staticRoot, "app.js"), "export {};");
});

afterEach(async () => {
  for (const socket of sockets) {
    if (socket instanceof WireSocket) socket.destroy();
    else socket.terminate();
  }
  sockets = [];
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
  rmSync(staticRoot, { recursive: true, force: true });
});

function serve(options: Partial<ServerOptions> = {}): GameServer {
  const server = createGameServer({
    staticRoot,
    version: "abc123",
    drainMs: 0,
    gameListMs: 0,
    ...options,
  });
  servers.push(server);
  return server;
}

async function onBun(options: Partial<ServerOptions> = {}) {
  const server = serve(options);
  const { port } = await server.listen(0, "127.0.0.1");
  return { server, port, base: `http://127.0.0.1:${String(port)}` };
}

async function wire(
  port: number,
  headers: Record<string, string> = {},
  options: { autoPong?: boolean; key?: string; path?: string } = {},
): Promise<WireSocket> {
  const socket = await WireSocket.open(port, options.path ?? "/ws", headers, options);
  sockets.push(socket);
  return socket;
}

const hello = encodeClientMessage({ type: "hello", version: PROTOCOL_VERSION, name: "Ana" });

/** How a WebSocket through the fake ended: refused with a status, welcome, or closed with a code. */
function fakeOutcome(socket: FakeSocket): Promise<string> {
  sockets.push(socket);
  return new Promise((resolve) => {
    socket.once("error", (error: Error) => {
      resolve(`refused ${error.message.replace("Unexpected server response: ", "")}`);
    });
    socket.once("open", () => {
      socket.once("close", (code: number) => {
        resolve(`closed ${String(code)}`);
      });
      socket.send(hello);
      socket.once("message", () => {
        resolve("welcome");
      });
    });
  });
}

/** The same on Bun, through a socket written by hand. */
async function bunOutcome(port: number, path: string, headers: Record<string, string>) {
  const socket = await wire(port, headers, { path });
  if (socket.status !== 101) return `refused ${String(socket.status)}`;
  socket.send(hello);
  const first = await socket.next();
  if (first?.opcode === TEXT) return "welcome";
  return `closed ${String(first?.opcode === CLOSE ? first.payload.readUInt16BE(0) : 1006)}`;
}

/** What the server decided of an answer; each transport adds headers of its own (date, connection). */
const HEADERS = [
  "allow",
  "cache-control",
  "content-security-policy",
  "content-type",
  "etag",
  "location",
  "x-content-type-options",
  "x-frontfall-version",
];

async function seen(response: Response) {
  return {
    status: response.status,
    headers: Object.fromEntries(HEADERS.map((name) => [name, response.headers.get(name)])),
    body: await response.text(),
  };
}

/** The same server twice: on the fake transport, and on Bun.serve. */
async function both(options: Partial<ServerOptions> = {}) {
  const fake = new FakeTransport();
  serve({ ...options, transport: fake });
  return { fake, ...(await onBun(options)) };
}

describe("the fake transport and Bun.serve", () => {
  it.each([
    ["GET", "/healthz", {}],
    ["GET", "/", {}],
    ["HEAD", "/app.js", {}],
    ["GET", "/missing.js", {}],
    ["POST", "/", {}],
    ["GET", "/api/games", {}],
    ["GET", "/api/me", {}],
    ["GET", "/metrics", { "x-forwarded-for": "1.2.3.4" }],
    ["GET", "/admin/reports", { origin: "https://evil.example" }],
    ["GET", "/admin/bans", {}],
    ["POST", "/admin/maintenance?minutes=500", {}],
    ["POST", "/api/usage", { "content-type": "text/csv" }],
  ])("give the same answer to %s %s", async (method, path, headers) => {
    const { fake, base } = await both();
    const init = { method, headers };
    const [onFake, onWire] = await Promise.all([
      fake.fetch(`${base}${path}`, init).then(seen),
      fetch(`${base}${path}`, init).then(seen),
    ]);
    expect(onFake).toEqual(onWire);
  });

  it.each([
    ["a report", JSON.stringify({ kind: "error", release: "dev", type: "webgl" })],
    ["a body that is not one", "{"],
    ["a body past the limit", "x".repeat(4000)],
  ])("give the same answer to %s sent to /api/usage", async (_, body) => {
    const { fake, base } = await both();
    const init = { method: "POST", headers: { "content-type": "application/json" }, body };
    const [onFake, onWire] = await Promise.all([
      fake.fetch(`${base}/api/usage`, init).then(seen),
      fetch(`${base}/api/usage`, init).then(seen),
    ]);
    expect(onFake).toEqual(onWire);
  });

  it("give the same answer to a WebSocket refused, turned away or welcome", async () => {
    const { fake, port } = await both({
      allowedOrigin: "https://play.example",
      maxConnectionsPerAddress: 1,
    });
    const own = { origin: "https://play.example" };
    const cases: [string, Record<string, string>][] = [
      ["/other", own],
      ["/ws", { origin: "https://evil.example" }],
      ["/ws", own],
      ["/ws", own],
    ];
    const onFake: string[] = [];
    const onWire: string[] = [];
    for (const [path, headers] of cases) {
      onFake.push(await fakeOutcome(fake.connect(path, { headers })));
      onWire.push(await bunOutcome(port, path, headers));
    }
    expect(onWire).toEqual(["refused 403", "refused 403", "welcome", "refused 429"]);
    expect(onFake).toEqual(onWire);

    const full = await both({ maxConnections: 0 });
    expect(await fakeOutcome(full.fake.connect("/ws"))).toBe(`closed ${String(CloseCode.full)}`);
    expect(await bunOutcome(full.port, "/ws", {})).toBe(`closed ${String(CloseCode.full)}`);
  });
});

describe("a server on Bun.serve", () => {
  it("answers a request still in flight at shutdown, and fails its health check", async () => {
    const { server, port } = await onBun();
    servers = servers.filter((one) => one !== server);
    const socket = connect(port, "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    // Half a request keeps the connection busy, so close() leaves it open.
    socket.write("GET /healthz HTTP/1.1\r\nHost: x\r\n");
    await Bun.sleep(50);
    const closed = server.close();
    const reply = new Promise<string>((resolve) => {
      let text = "";
      socket.on("data", (chunk: Buffer) => (text += chunk.toString()));
      socket.on("close", () => {
        resolve(text);
      });
    });
    socket.end("Connection: close\r\n\r\n");
    const text = await reply;
    await closed;
    expect(text).toMatch(/^HTTP\/1\.1 503/);
    expect(text.slice(text.indexOf("\r\n\r\n"))).toContain("stopping");
  });

  it("refuses a request target that names another host, as written on the wire", async () => {
    const { port } = await onBun();
    const ask = (target: string) =>
      exchange(port, `GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    expect(await ask("//evil.example/metrics")).toMatch(/^HTTP\/1\.1 400/);
    // A backslash reads as a slash to the URL parser, not to a proxy.
    expect(await ask("/\\evil.example/metrics")).toMatch(/^HTTP\/1\.1 400/);
    expect(await ask("/%5Chealthz")).not.toMatch(/^HTTP\/1\.1 400/);
  });

  it("reads the target whole when the request has no Host, or one Bun cannot use", async () => {
    const { port } = await onBun();
    // A health checker that speaks HTTP/1.0 sends no Host: it must reach /healthz, not the page.
    const bare = (target: string) => exchange(port, `GET ${target} HTTP/1.0\r\n\r\n`);
    const healthz = await bare("/healthz");
    expect(healthz).toMatch(/^HTTP\/1\.1 200/);
    expect(healthz.endsWith("\r\n\r\nok")).toBe(true);
    const odd = await exchange(
      port,
      "GET /healthz HTTP/1.1\r\nHost: a/b\r\nConnection: close\r\n\r\n",
    );
    expect(odd.endsWith("\r\n\r\nok")).toBe(true);
    expect(await bare("//evil.example/healthz")).toMatch(/^HTTP\/1\.1 400/);
    expect(await bare("/\\evil.example/healthz")).toMatch(/^HTTP\/1\.1 400/);
  });

  it("gives the address its connection back when the handshake is refused", async () => {
    const { port } = await onBun({ maxConnectionsPerAddress: 2 });
    const address = { "x-client-ip": "203.0.113.9" };
    for (let i = 0; i < 3; i++) {
      const refused = await wire(port, address, { key: "not-a-key" });
      expect(refused.status).toBe(400);
      await refused.ended;
    }
    expect((await wire(port, address)).status).toBe(101);
  });

  it("closes oversized frames, and counts them", async () => {
    const { server, port } = await onBun();
    // Past the server's limit, then past the size Bun reads at all.
    for (const size of [2048, 100_000]) {
      const socket = await wire(port);
      socket.send(hello);
      expect((await socket.next())?.opcode).toBe(TEXT);
      socket.send("x".repeat(size));
      expect(await socket.closeCode()).toBe(1009);
    }
    await Bun.sleep(20);
    expect(server.metrics.rejected.get({ reason: "oversized" })).toBe(2);
  });

  it("drops a client that stops reading what it is sent, and counts it", async () => {
    const { server, port } = await onBun();
    const socket = await wire(port);
    socket.send(hello);
    await socket.next();
    socket.send(encodeClientMessage({ type: "create" }));
    await socket.next();
    const [room] = [...server.games.all()];
    const peer = room?.seatOf(1)?.peer;
    if (!peer) throw new Error("not seated");
    // The client reads nothing: what the server sends piles up on its side.
    socket.pause();
    const frame = "x".repeat(2 ** 20);
    for (let i = 0; i < 64; i++) peer.send(frame);
    socket.resume();
    await socket.ended;
    expect(server.metrics.slowClients.get()).toBe(1);
  });

  it("drops a client that stops answering pings, and keeps one that answers", async () => {
    const { port } = await onBun({ pingIntervalMs: 50 });
    const silent = await wire(port, {}, { autoPong: false });
    const healthy = await wire(port);
    await silent.ended;
    await Bun.sleep(150);
    healthy.send(hello);
    expect((await healthy.next())?.opcode).toBe(TEXT);
  });

  it("frees a lobby seat at once when the page closes its socket, and keeps it on a drop", async () => {
    const { server, port } = await onBun();
    const seat = async () => {
      const socket = await wire(port);
      socket.send(hello);
      await socket.next();
      socket.send(encodeClientMessage({ type: "create" }));
      await socket.next();
      return socket;
    };
    const closing = await seat();
    // A close frame with 1001, as from a page that goes away.
    closing.send(Uint8Array.of(0x03, 0xe9), CLOSE);
    await closing.closeCode();
    await Bun.sleep(20);
    expect([...server.games.all()]).toHaveLength(0);
    const dropped = await seat();
    dropped.destroy();
    await dropped.ended;
    await Bun.sleep(20);
    expect([...server.games.all()].map((room) => room.state)).toEqual(["open"]);
  });
});
