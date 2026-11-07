import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloseCode, encodeClientMessage, PROTOCOL_VERSION } from "@frontfall/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameServer, type GameServer, type ServerOptions } from "../src/server.ts";
import { FakeClock } from "./support/fake-clock.ts";
import { FakeSocket, FakeTransport } from "./support/fake-transport.ts";

let staticRoot: string;
let servers: GameServer[] = [];
let sockets: FakeSocket[] = [];

beforeEach(() => {
  staticRoot = mkdtempSync(join(tmpdir(), "frontfall-static-"));
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html>");
  writeFileSync(join(staticRoot, "app.js"), "export {};");
});

afterEach(async () => {
  for (const socket of sockets) socket.terminate();
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

function keep(socket: FakeSocket): FakeSocket {
  sockets.push(socket);
  return socket;
}

describe("a server on a fake clock", () => {
  function start(options: Partial<ServerOptions> = {}) {
    const clock = new FakeClock();
    const transport = new FakeTransport();
    const server = serve({ clock, transport, ...options });
    /** Lets the messages in flight cross, as the fake transport delivers them a turn later. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
    const connect = (autoPong = true) => {
      const socket = keep(transport.connect("/ws", { autoPong }));
      const ended = new Promise<number>((resolve) => socket.once("close", resolve));
      return { socket, ended };
    };
    const hello = (socket: FakeSocket) => {
      socket.send(encodeClientMessage({ type: "hello", version: PROTOCOL_VERSION, name: "Ana" }));
    };
    return { clock, server, settle, connect, hello };
  }

  it("closes a connection that says no hello once its delay is over, and not before", async () => {
    const { clock, settle, connect } = start({ helloTimeoutMs: 10_000 });
    const { socket, ended } = connect();
    await settle();
    clock.advance(9_999);
    await settle();
    expect(socket.readyState).toBe(FakeSocket.OPEN);
    clock.advance(1);
    expect(await ended).toBe(CloseCode.idle);
  });

  it("drops a connection that leaves a ping unanswered for half an interval", async () => {
    const { clock, settle, connect, hello } = start({
      pingIntervalMs: 1_000,
      idleTimeoutMs: 60_000,
    });
    const silent = connect(false);
    const healthy = connect();
    await settle();
    hello(silent.socket);
    hello(healthy.socket);
    await settle();
    clock.advance(1_000);
    await settle();
    expect(silent.socket.readyState).toBe(FakeSocket.OPEN);
    clock.advance(1_000);
    expect(await silent.ended).toBe(1006);
    expect(healthy.socket.readyState).toBe(FakeSocket.OPEN);
  });

  it("closes a connection that stays out of any game for the idle delay", async () => {
    const { clock, settle, connect, hello } = start({
      pingIntervalMs: 1_000,
      idleTimeoutMs: 5_000,
    });
    const { socket, ended } = connect();
    await settle();
    hello(socket);
    await settle();
    // Idle from its hello at 0; the heartbeat looks every second.
    for (let second = 1; second < 5; second++) {
      clock.advance(1_000);
      await settle();
    }
    expect(socket.readyState).toBe(FakeSocket.OPEN);
    clock.advance(1_000);
    expect(await ended).toBe(CloseCode.idle);
  });

  it("drops a client that leaves more than 4 MiB unread", async () => {
    const { settle, connect, hello, server } = start();
    const { socket, ended } = connect();
    await settle();
    hello(socket);
    socket.send(encodeClientMessage({ type: "create" }));
    await settle();
    const [room] = [...server.games.all()];
    const peer = room?.seatOf(1)?.peer;
    if (!peer) throw new Error("not seated");
    // The client reads nothing: what the server sends piles up on its side.
    socket.pause();
    const frame = "x".repeat(2 ** 20);
    for (let i = 0; i < 4; i++) peer.send(frame);
    await settle();
    expect(socket.readyState).toBe(FakeSocket.OPEN);
    peer.send(frame);
    peer.send(frame);
    expect(await ended).toBe(1006);
    expect(server.metrics.slowClients.get()).toBe(1);
  });
});
