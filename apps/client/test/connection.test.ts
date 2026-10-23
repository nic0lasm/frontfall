import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect, retryDelay, socketUrl } from "../src/connection.ts";

describe("socketUrl", () => {
  it("follows the page path so a prefix such as /frontfall/ is kept", () => {
    expect(socketUrl("https://nclsmgr.com/frontfall/")).toBe("wss://nclsmgr.com/frontfall/ws");
  });

  it("uses plain ws for local development and drops query and hash", () => {
    expect(socketUrl("http://localhost:5173/?debug#map")).toBe("ws://localhost:5173/ws");
  });
});

describe("retryDelay", () => {
  it("backs off exponentially up to ten seconds", () => {
    expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([500, 1000, 2000, 4000, 10_000]);
  });
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: { data: string | undefined }) => void)[]>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string | undefined }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  emit(type: string, data?: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

describe("connect", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends through the socket once open and passes on valid messages only", () => {
    const received: unknown[] = [];
    connect("ws://test/ws", {
      onOpen: (send) => {
        send({ type: "join", lobby: "public", name: "Guest" });
      },
      onMessage: (message) => received.push(message),
      onClose: () => undefined,
    });
    const socket = FakeSocket.instances[0];
    socket?.emit("open");
    socket?.emit("message", JSON.stringify({ type: "joined", player: "p1", seed: 4 }));
    socket?.emit("message", "not json");

    expect(socket?.sent).toEqual([
      JSON.stringify({ type: "join", lobby: "public", name: "Guest" }),
    ]);
    expect(received).toEqual([{ type: "joined", player: "p1", seed: 4 }]);
  });

  it("reconnects with growing delays and resets them after a success", () => {
    const delays: number[] = [];
    connect("ws://test/ws", {
      onOpen: () => undefined,
      onMessage: () => undefined,
      onClose: (delay) => delays.push(delay),
    });

    FakeSocket.instances[0]?.emit("close");
    vi.advanceTimersByTime(500);
    FakeSocket.instances[1]?.emit("close");
    vi.advanceTimersByTime(1000);
    FakeSocket.instances[2]?.emit("open");
    FakeSocket.instances[2]?.emit("close");

    expect(FakeSocket.instances).toHaveLength(3);
    expect(delays).toEqual([500, 1000, 500]);
  });
});
