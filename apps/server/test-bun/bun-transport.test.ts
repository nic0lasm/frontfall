import { afterEach, describe, expect, it } from "bun:test";
import { BunTransport, requestTarget } from "../src/bun-transport.ts";
import { peerOutbox } from "../src/room-outbox.ts";
import type { Connection, ConnectionEvents, TransportHandler } from "../src/transport.ts";
import { BINARY, exchange, TEXT, WireSocket } from "./wire.ts";

let transports: BunTransport[] = [];
let sockets: WireSocket[] = [];

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets = [];
  await Promise.all(transports.map((transport) => transport.close()));
  transports = [];
});

const IGNORED: ConnectionEvents = {
  message: () => undefined,
  pong: () => undefined,
  error: () => undefined,
  close: () => undefined,
};

/** A transport carrying `handler`, with defaults for what a test leaves out. */
async function carry(
  handler: Partial<TransportHandler>,
  deadlines?: ConstructorParameters<typeof BunTransport>[0],
): Promise<number> {
  const transport = new BunTransport(deadlines);
  transports.push(transport);
  transport.serve({
    maxPayloadBytes: 1024,
    request: (_, response) => {
      response.send(404);
    },
    upgrade: () => ({ refuse: 403 }),
    ...handler,
  });
  return (await transport.listen(0, "127.0.0.1")).port;
}

async function wire(port: number): Promise<WireSocket> {
  const socket = await WireSocket.open(port);
  sockets.push(socket);
  return socket;
}

describe("the request target", () => {
  it("is the path and query as the client wrote them", () => {
    expect(requestTarget("http://x//evil.example/metrics")).toBe("//evil.example/metrics");
    expect(requestTarget("http://127.0.0.1:8080/api/games?x=1")).toBe("/api/games?x=1");
    expect(requestTarget("http://x")).toBe("/");
    // With no usable Host, Bun gives the target alone.
    expect(requestTarget("/healthz")).toBe("/healthz");
    expect(requestTarget("/a/b?c=d")).toBe("/a/b?c=d");
    expect(requestTarget("//evil.example/metrics")).toBe("//evil.example/metrics");
  });
});

describe("HTTP on Bun.serve", () => {
  it("passes the method, the target, the headers and the peer, and sends headers given twice", async () => {
    const port = await carry({
      request: (request, response) => {
        response.send(
          200,
          { "set-cookie": ["a=1", "b=2"], "x-seen": `${request.method} ${request.url}` },
          `${request.header("x-twice") ?? ""}|${request.peer ?? ""}|${String(request.header("x-none"))}`,
        );
      },
    });
    const text = await exchange(
      port,
      "PUT /a?b=1 HTTP/1.1\r\nHost: x\r\nX-Twice: 1\r\nX-Twice: 2\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    );
    expect(text).toMatch(/^HTTP\/1\.1 200/);
    expect(text).toContain("set-cookie: a=1\r\nset-cookie: b=2\r\n");
    expect(text).toContain("x-seen: PUT /a?b=1\r\n");
    expect(text.endsWith("1, 2|127.0.0.1|undefined")).toBe(true);
  });

  it("reads a body up to its limit, and says when it is past it", async () => {
    const port = await carry({
      request: (request, response) => {
        void request.body(8).then((body) => {
          response.send(
            200,
            {},
            body.kind === "read" ? new TextDecoder().decode(body.bytes) : body.kind,
          );
        });
      },
    });
    const base = `http://127.0.0.1:${String(port)}`;
    expect(await (await fetch(base, { method: "POST", body: "12345678" })).text()).toBe("12345678");
    expect(await (await fetch(base, { method: "POST", body: "123456789" })).text()).toBe(
      "too_large",
    );
    expect(await (await fetch(base)).text()).toBe("");
  });

  it("sends no body to HEAD or with 204, and keeps the length of a HEAD answer", async () => {
    const port = await carry({
      request: (request, response) => {
        response.send(
          request.url === "/none" ? 204 : 200,
          { "content-type": "text/plain" },
          "hello",
        );
      },
    });
    const head = await exchange(port, "HEAD / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    expect(head).toMatch(/content-length: 5\r\n/i);
    expect(head.endsWith("\r\n\r\n")).toBe(true);
    const none = await exchange(port, "GET /none HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    expect(none).toMatch(/^HTTP\/1\.1 204/);
    expect(none.endsWith("\r\n\r\n")).toBe(true);
  });

  it("cuts the connection on abort, with no answer at all", async () => {
    const port = await carry({
      request: (_, response) => {
        response.abort();
      },
    });
    const text = await exchange(
      port,
      "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    ).catch(() => "");
    expect(text).toBe("");
  });

  it("gives a handler past the idle timeout its time to answer, then makes the connection idle again", async () => {
    // Bun checks its timeouts every 4 seconds or so: an idle timeout of 2 cuts at 4.
    const port = await carry(
      {
        request: (request, response) => {
          const wait = request.url === "/slow" ? 5000 : 0;
          setTimeout(() => {
            response.send(200, {}, "done");
          }, wait);
        },
      },
      { idle: 2, answer: 6 },
    );
    const started = Date.now();
    const kept = exchange(port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n").then((text) => ({
      text,
      after: Date.now() - started,
    }));
    const slow = await exchange(port, "GET /slow HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    expect(slow).toMatch(/^HTTP\/1\.1 200/);
    expect(slow.endsWith("\r\n\r\ndone")).toBe(true);
    // Answered at once and kept open: closed by the idle timeout, not after the answer's 6 seconds.
    const { text, after } = await kept;
    expect(text).toMatch(/^HTTP\/1\.1 200/);
    expect(after).toBeLessThan(6000);
  }, 15_000);

  it("refuses an upgrade with a bare status and closes", async () => {
    const port = await carry({ upgrade: () => ({ refuse: 429 }) });
    const socket = await wire(port);
    expect(socket.status).toBe(429);
    await socket.ended;
  });
});

describe("WebSockets on Bun.serve", () => {
  /** A transport that accepts every WebSocket and hands its connection to the test. */
  async function accepting(events: Partial<ConnectionEvents> = {}) {
    let opened: (connection: Connection) => void = () => undefined;
    const connection = new Promise<Connection>((resolve) => (opened = resolve));
    let released = 0;
    const transport = new BunTransport();
    transports.push(transport);
    transport.serve({
      maxPayloadBytes: 1024,
      request: (_, response) => {
        response.send(404);
      },
      upgrade: () => ({
        accept: (accepted) => {
          opened(accepted);
          return { ...IGNORED, ...events };
        },
        released: () => released++,
      }),
    });
    const { port } = await transport.listen(0, "127.0.0.1");
    return { transport, port, connection, released: () => released };
  }

  it("passes frames both ways, text as text and bytes as bytes", async () => {
    const got: unknown[] = [];
    const { port, connection } = await accepting({ message: (frame) => got.push(frame) });
    const socket = await wire(port);
    const server = await connection;
    socket.send("hi");
    socket.send(Uint8Array.of(1, 2));
    server.send("back");
    server.send(Uint8Array.of(3));
    expect((await socket.next())?.opcode).toBe(TEXT);
    expect((await socket.next())?.opcode).toBe(BINARY);
    await Bun.sleep(20);
    expect(got).toEqual(["hi", Uint8Array.of(1, 2)]);
  });

  it("lists the open connections, and releases the slot once one closes", async () => {
    const codes: number[] = [];
    const { transport, port, connection, released } = await accepting({
      close: (code) => codes.push(code),
    });
    const socket = await wire(port);
    const server = await connection;
    expect(transport.connectionCount).toBe(1);
    expect([...transport.connections()]).toEqual([server]);
    server.close(4000, "bye");
    expect(server.open).toBe(false);
    expect(await socket.closeCode()).toBe(4000);
    await Bun.sleep(20);
    expect(transport.connectionCount).toBe(0);
    expect(codes).toEqual([4000]);
    expect(released()).toBe(1);
  });

  it("paces a catch-up by what the client reads, and holds the rest until its end", async () => {
    const { port, connection } = await accepting();
    const socket = await wire(port);
    const server = await connection;
    socket.pause();
    const peer = peerOutbox(server, { slow: () => undefined, probe: () => undefined });
    const frame = new Uint8Array(2 ** 20);
    let handed = 0;
    peer.replay?.(
      (function* () {
        for (let i = 0; i < 32; i++) {
          handed++;
          yield frame;
        }
      })(),
      "last",
    );
    peer.send("held");
    await Bun.sleep(100);
    // Only what fits in the buffers is taken from the log while the client reads nothing.
    expect(handed).toBeLessThan(32);
    expect(server.bufferedAmount).toBeLessThan(8 * 2 ** 20);
    socket.resume();
    const kinds: number[] = [];
    for (let i = 0; i < 34; i++) kinds.push((await socket.next())?.opcode ?? 0);
    expect(handed).toBe(32);
    expect(kinds.slice(0, 32).every((kind) => kind === BINARY)).toBe(true);
    expect(kinds.slice(32)).toEqual([TEXT, TEXT]);
  });

  it("drops a connection on terminate, which reports 1006", async () => {
    const codes: number[] = [];
    const { port, connection } = await accepting({ close: (code) => codes.push(code) });
    const socket = await wire(port);
    (await connection).terminate();
    await socket.ended;
    await Bun.sleep(20);
    expect(codes).toEqual([1006]);
  });
});
