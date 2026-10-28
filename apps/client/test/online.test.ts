import {
  PROTOCOL_VERSION,
  CloseCode,
  encodeServerMessage,
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "@frontfall/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import {
  OnlineClient,
  retryDelay,
  socketUrl,
  type OnlineEvents,
  type SocketLike,
} from "../src/net/online.ts";

describe("socketUrl", () => {
  it("follows the page path so a prefix such as /frontfall/ is kept", () => {
    expect(socketUrl("https://nclsmgr.com/frontfall/")).toBe("wss://nclsmgr.com/frontfall/ws");
  });

  it("uses plain ws for local development and drops query and hash", () => {
    expect(socketUrl("http://localhost:5173/?game=abc#map")).toBe("ws://localhost:5173/ws");
  });
});

describe("retryDelay", () => {
  it("backs off exponentially up to ten seconds", () => {
    expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([500, 1000, 2000, 4000, 10_000]);
  });
});

type Listener = (event: never) => void;

class FakeSocket implements SocketLike {
  binaryType: BinaryType = "blob";
  readyState = 0;
  readonly sent: ClientMessage[] = [];
  closedWith: number | undefined;
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string | Uint8Array): void {
    const parsed = parseClientMessage(data);
    if (!parsed.ok) throw new Error(parsed.error);
    this.sent.push(parsed.value);
  }

  close(code = 1000): void {
    this.closedWith = code;
    this.drop(code);
  }

  connect(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  receive(message: ServerMessage): void {
    const frame = encodeServerMessage(message);
    const data =
      typeof frame === "string"
        ? frame
        : frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
    this.emit("message", { data });
  }

  drop(code = 1006): void {
    this.readyState = 3;
    this.emit("close", { code });
  }

  private emit(type: string, event: object): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
}

const START: Extract<ServerMessage, { type: "started" }> = {
  type: "started",
  game: "Xk3_9aB-q2Lm",
  map: "world",
  seed: 5,
  bots: 0,
  difficulty: "normal",
  nations: true,
  teams: 0,
  disabled: 0,
  tickRate: 10,
  speed: 1,
  rules: { collapsingFronts: true },
  players: [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ],
  you: 2,
  token: "0123456789abcdefABCDEF",
};

let sockets: FakeSocket[];
let timers: { callback: () => void; ms: number }[];
let log: string[];
let turns: number[];

function client(events: OnlineEvents = {}) {
  return new OnlineClient({
    url: "ws://test/ws",
    name: "Bob",
    build: "abc",
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    setTimer: (callback, ms) => timers.push({ callback, ms }),
    events: {
      status: (status, retry) =>
        log.push(retry === undefined ? status : `${status}:${String(retry)}`),
      lobby: (lobby) => log.push(`lobby:${String(lobby.players.length)}`),
      started: (game) => log.push(`started:${String(game.you)}`),
      turns: (received) => turns.push(...received.map((turn) => turn.tick)),
      desync: (tick, hash, expected) =>
        log.push(`desync:${String(tick)}:${String(hash)}:${String(expected)}`),
      ended: (reason) => log.push(`ended:${reason}`),
      error: (code) => log.push(`error:${code}`),
      ...events,
    },
  });
}

function latest(): FakeSocket {
  const socket = sockets.at(-1);
  if (!socket) throw new Error("no socket");
  return socket;
}

function welcomed(): FakeSocket {
  const socket = latest();
  socket.connect();
  socket.receive({ type: "welcome", version: PROTOCOL_VERSION });
  return socket;
}

beforeEach(() => {
  sockets = [];
  timers = [];
  log = [];
  turns = [];
});

describe("OnlineClient", () => {
  it("says hello with the protocol version, then joins what the player asked for", () => {
    const online = client();
    const socket = latest();
    expect(socket.binaryType).toBe("arraybuffer");
    online.play();
    expect(socket.sent).toEqual([]);
    socket.connect();
    expect(socket.sent).toEqual([
      { type: "hello", version: PROTOCOL_VERSION, name: "Bob", build: "abc" },
    ]);
    socket.receive({ type: "welcome", version: PROTOCOL_VERSION });
    expect(socket.sent.at(-1)).toEqual({ type: "play" });
    expect(log).toEqual(["connecting", "online"]);

    online.join("Xk3_9aB-q2Lm");
    online.create();
    online.create("public", "Europe 4v4");
    online.play("Partie de Bob");
    online.configure(
      {
        map: "europe",
        bots: 4,
        difficulty: "hard",
        nations: true,
        teams: 0,
        disabled: 0,
        capacity: 8,
        autoStart: true,
      },
      "Europe 2v2",
    );
    online.start();
    online.hold();
    online.active();
    online.order({ type: "spawn", tile: 4 });
    online.hash(50, 7);
    online.leave();
    expect(socket.sent.slice(2)).toEqual([
      { type: "join", game: "Xk3_9aB-q2Lm" },
      { type: "create", visibility: "private" },
      { type: "create", visibility: "public", name: "Europe 4v4" },
      { type: "play", name: "Partie de Bob" },
      {
        type: "configure",
        options: {
          map: "europe",
          bots: 4,
          difficulty: "hard",
          nations: true,
          teams: 0,
          disabled: 0,
          capacity: 8,
          autoStart: true,
        },
        name: "Europe 2v2",
        seq: 1,
      },
      { type: "start" },
      { type: "hold" },
      { type: "active" },
      { type: "order", order: { type: "spawn", tile: 4 } },
      { type: "hash", tick: 50, hash: 7 },
      { type: "leave" },
    ]);
  });

  it("delivers lobby updates, the start and turns in order", () => {
    const online = client();
    const socket = welcomed();
    online.play();
    socket.receive({
      type: "lobby",
      game: START.game,
      visibility: "public",
      name: "Partie de Alice",
      map: "world",
      bots: 0,
      difficulty: "normal",
      nations: true,
      teams: 0,
      disabled: 0,
      capacity: 16,
      autoStart: true,
      speed: 1,
      rules: { collapsingFronts: true },
      minPlayers: 2,
      players: START.players,
      you: 2,
      host: 1,
      startsIn: 1000,
      token: START.token,
      holdable: true,
      configured: 0,
    });
    socket.receive(START);
    socket.receive({ type: "turns", turns: [{ tick: 0, orders: [] }] });
    socket.receive({ type: "turns", turns: [{ tick: 1, orders: [] }] });
    socket.receive({ type: "desync", tick: 1, hash: 8, expected: 7 });
    expect(log.slice(2)).toEqual(["lobby:2", "started:2", "desync:1:8:7"]);
    expect(turns).toEqual([0, 1]);
  });

  it("tells a lobby that predates the host's latest change from the answer to it", () => {
    const behind: boolean[] = [];
    const online = client({
      lobby: (_lobby, late) => behind.push(late),
    });
    const socket = welcomed();
    online.create("private");
    const options = {
      map: "world",
      bots: 2,
      difficulty: "normal",
      nations: true,
      teams: 0,
      disabled: 0,
      capacity: 2,
      autoStart: true,
      speed: 1,
      rules: { collapsingFronts: true },
    } as const;
    const lobby: Extract<ServerMessage, { type: "lobby" }> = {
      type: "lobby",
      game: START.game,
      visibility: "private",
      name: null,
      ...options,
      minPlayers: 1,
      players: [{ id: 1, name: "Bob" }],
      you: 1,
      host: 1,
      startsIn: null,
      token: START.token,
      holdable: false,
      configured: 0,
    };
    socket.receive(lobby);
    online.configure({ ...options, bots: 0 });
    online.configure({ ...options, bots: 0, difficulty: "hard" });
    expect(socket.sent.slice(-2).map((message) => (message as { seq?: number }).seq)).toEqual([
      1, 2,
    ]);
    // Answers in order: only the last one shows the form as the host left it.
    socket.receive({ ...lobby, bots: 0, configured: 1 });
    socket.receive({ ...lobby, bots: 0, difficulty: "hard", configured: 2 });
    expect(behind).toEqual([false, true, false]);

    // A new connection numbers from 1 again, as the server does from the rejoin.
    socket.drop();
    timers.shift()?.callback();
    const again = welcomed();
    again.receive(lobby);
    online.configure(options);
    expect(again.sent.at(-1)).toMatchObject({ type: "configure", seq: 1 });
    again.receive({ ...lobby, configured: 1 });
    expect(behind.slice(3)).toEqual([false, false]);
  });

  it("takes its seat back after a drop and asks only for the missing turns", () => {
    const online = client();
    let socket = welcomed();
    online.play();
    socket.receive(START);
    socket.receive({ type: "turns", turns: [0, 1, 2].map((tick) => ({ tick, orders: [] })) });

    socket.drop();
    expect(log.at(-1)).toBe("offline:500");
    timers.shift()?.callback();
    socket = welcomed();
    expect(socket.sent.at(-1)).toEqual({ type: "rejoin", token: START.token, from: 3 });

    socket.receive(START);
    socket.receive({ type: "turns", turns: [2, 3, 4].map((tick) => ({ tick, orders: [] })) });
    expect(turns).toEqual([0, 1, 2, 3, 4]);
    expect(log.filter((entry) => entry.startsWith("started"))).toHaveLength(1);
  });

  it("asks again while the server checks the previous connection", () => {
    const online = client();
    let socket = welcomed();
    online.play();
    socket.receive(START);
    socket.drop();
    timers.shift()?.callback();
    socket = welcomed();
    socket.receive({ type: "error", code: "token_in_use", message: "" });
    expect(timers.at(-1)?.ms).toBe(1000);
    timers.at(-1)?.callback();
    expect(socket.sent.filter((message) => message.type === "rejoin")).toHaveLength(2);
    expect(log).not.toContain("error:token_in_use");
  });

  it("reports the end of the game when its seat was given away", () => {
    const online = client();
    let socket = welcomed();
    online.play();
    socket.receive(START);
    socket.drop();
    timers.shift()?.callback();
    socket = welcomed();
    socket.receive({ type: "error", code: "token_invalid", message: "" });
    expect(log.at(-1)).toBe("ended:seatLost");

    socket.drop();
    timers.shift()?.callback();
    socket = welcomed();
    expect(socket.sent.at(-1)).toEqual({
      type: "hello",
      version: PROTOCOL_VERSION,
      name: "Bob",
      build: "abc",
    });
  });

  it("joins the same game again when the connection drops in the lobby", () => {
    const online = client();
    let socket = welcomed();
    online.join("Xk3_9aB-q2Lm");
    socket.drop();
    timers.shift()?.callback();
    socket = welcomed();
    expect(socket.sent.at(-1)).toEqual({ type: "join", game: "Xk3_9aB-q2Lm" });
  });

  it("takes its lobby seat back after a drop, or joins the game again once it is gone", () => {
    const online = client();
    let socket = welcomed();
    online.create();
    socket.receive({
      type: "lobby",
      game: START.game,
      visibility: "private",
      name: null,
      map: "world",
      bots: 0,
      difficulty: "normal",
      nations: true,
      teams: 0,
      disabled: 0,
      capacity: 16,
      autoStart: true,
      speed: 1,
      rules: { collapsingFronts: true },
      minPlayers: 1,
      players: START.players,
      you: 1,
      host: 1,
      startsIn: null,
      holdable: false,
      configured: 0,
      token: START.token,
    });

    socket.drop();
    timers.shift()?.callback();
    socket = welcomed();
    expect(socket.sent.at(-1)).toEqual({ type: "rejoin", token: START.token, from: 0 });
    socket.receive({ type: "error", code: "token_invalid", message: "" });
    // The host's request was to open a game: once inside one, it joins that one again.
    expect(socket.sent.at(-1)).toEqual({ type: "join", game: START.game });
    expect(log).not.toContain("error:token_invalid");
  });

  it("starts a game that began while it was away from the lobby", () => {
    const online = client();
    let socket = welcomed();
    online.play();
    socket.receive({
      type: "lobby",
      game: START.game,
      visibility: "public",
      name: "Partie de Alice",
      map: "world",
      bots: 0,
      difficulty: "normal",
      nations: true,
      teams: 0,
      disabled: 0,
      capacity: 16,
      autoStart: true,
      speed: 1,
      rules: { collapsingFronts: true },
      minPlayers: 2,
      players: START.players,
      you: 2,
      host: 1,
      startsIn: 1000,
      holdable: true,
      configured: 0,
      token: START.token,
    });
    socket.drop();
    timers.shift()?.callback();
    socket = welcomed();
    socket.receive(START);
    socket.receive({ type: "turns", turns: [0, 1].map((tick) => ({ tick, orders: [] })) });
    expect(log.filter((entry) => entry.startsWith("started"))).toEqual(["started:2"]);
    expect(turns).toEqual([0, 1]);
  });

  it("passes an announced restart on", () => {
    const seen: (number | null)[] = [];
    client({ maintenance: (inMs) => seen.push(inMs) });
    const socket = welcomed();
    socket.receive({ type: "maintenance", inMs: 60_000 });
    socket.receive({ type: "maintenance", inMs: null });
    expect(seen).toEqual([60_000, null]);
  });

  it("passes other errors and the end of the game on", () => {
    const online = client();
    const socket = welcomed();
    online.play();
    socket.receive({ type: "error", code: "game_full", message: "full" });
    socket.receive(START);
    socket.receive({ type: "ended", reason: "timeout" });
    expect(log.slice(-3)).toEqual(["error:game_full", "started:2", "ended:timeout"]);
  });

  it("stops and asks for a reload on turns it cannot read", () => {
    const online = client();
    const socket = welcomed();
    online.play();
    socket.receive(START);
    (socket as unknown as { emit(type: string, event: object): void }).emit("message", {
      data: new Uint8Array([1, 0, 1, 1, 1, 99]).buffer,
    });
    expect(log.at(-1)).toBe("outdated");
    expect(socket.closedWith).toBe(1000);
    expect(timers).toEqual([]);
  });

  it("reconnects to fetch turns it missed", () => {
    const online = client();
    let socket = welcomed();
    online.play();
    socket.receive(START);
    socket.receive({ type: "turns", turns: [{ tick: 0, orders: [] }] });
    socket.receive({ type: "turns", turns: [{ tick: 2, orders: [] }] });
    expect(turns).toEqual([0]);
    expect(socket.closedWith).toBe(1000);
    timers.shift()?.callback();
    socket = welcomed();
    expect(socket.sent.at(-1)).toEqual({ type: "rejoin", token: START.token, from: 1 });
  });

  it("stops and asks for a reload when the server runs another version", () => {
    client();
    latest().connect();
    latest().drop(CloseCode.versionMismatch);
    expect(log.at(-1)).toBe("outdated");
    expect(timers).toEqual([]);
  });

  it("does not reconnect after close, and ignores what it cannot read", () => {
    const online = client();
    const socket = welcomed();
    socket.receive({ type: "turns", turns: [] });
    (socket as unknown as { emit(type: string, event: object): void }).emit("message", {
      data: 42,
    });
    online.close();
    expect(socket.closedWith).toBe(1000);
    expect(timers).toEqual([]);
    online.order({ type: "spawn", tile: 1 });
    expect(socket.sent).toHaveLength(1);
  });

  it("does not open a new connection when closed while waiting to retry", () => {
    const online = client();
    welcomed().drop();
    expect(timers).toHaveLength(1);
    online.close();
    timers.shift()?.callback();
    expect(sockets).toHaveLength(1);
  });

  it("stops for good when the server refuses its messages", () => {
    for (const code of [CloseCode.invalidMessage, CloseCode.rateLimited]) {
      log = [];
      timers = [];
      client();
      welcomed().drop(code);
      expect(log.at(-1)).toBe("rejected");
      expect(timers).toEqual([]);
    }
  });

  it("stops for good when the server's operator banned the network (R-MODE-06)", () => {
    client();
    welcomed().drop(CloseCode.banned);
    expect(log.at(-1)).toBe("banned");
    expect(timers).toEqual([]);
  });

  it("sends a report of another player (R-MODE-06)", () => {
    const online = client();
    const socket = welcomed();
    online.report(2, "abuse");
    expect(socket.sent.at(-1)).toEqual({ type: "report", player: 2, reason: "abuse" });
    socket.receive({ type: "reported", player: 2 });
    expect(log.at(-1)).toBe("online");
  });

  it("refuses an invitation id the protocol cannot carry, without sending it", () => {
    const online = client();
    const socket = welcomed();
    online.join("not a game id!");
    expect(log.at(-1)).toBe("error:not_found");
    expect(socket.sent).toHaveLength(1);
  });

  it("takes its seat back after a reload, asking for every turn", () => {
    const online = client();
    let socket = welcomed();
    online.resume(START.token);
    expect(socket.sent.at(-1)).toEqual({ type: "rejoin", token: START.token, from: 0 });
    socket.receive({ type: "error", code: "token_in_use", message: "" });
    timers.at(-1)?.callback();
    expect(socket.sent.at(-1)).toEqual({ type: "rejoin", token: START.token, from: 0 });

    socket.receive(START);
    socket.receive({ type: "turns", turns: [0, 1, 2].map((tick) => ({ tick, orders: [] })) });
    expect(log.filter((entry) => entry.startsWith("started"))).toEqual(["started:2"]);
    expect(turns).toEqual([0, 1, 2]);

    socket.drop();
    timers.at(-1)?.callback();
    socket = welcomed();
    expect(socket.sent.at(-1)).toEqual({ type: "rejoin", token: START.token, from: 3 });
  });

  it("takes its seat back from the tick of a snapshot, and from the start if the snapshot fails (#39)", () => {
    const online = client();
    let socket = welcomed();
    online.resume(START.token, 1200);
    expect(socket.sent.at(-1)).toEqual({ type: "rejoin", token: START.token, from: 1200 });
    socket.receive({ type: "error", code: "token_in_use", message: "" });
    timers.at(-1)?.callback();
    expect(socket.sent.at(-1)).toEqual({ type: "rejoin", token: START.token, from: 1200 });

    socket.receive(START);
    socket.receive({ type: "turns", turns: [1200, 1201].map((tick) => ({ tick, orders: [] })) });
    expect(log.filter((entry) => entry.startsWith("started"))).toEqual(["started:2"]);
    expect(turns).toEqual([1200, 1201]);

    // The page could not load the snapshot: every turn again, over a new connection.
    online.replayFromStart();
    expect(socket.closedWith).toBe(1000);
    timers.at(-1)?.callback();
    socket = welcomed();
    expect(socket.sent.at(-1)).toEqual({ type: "rejoin", token: START.token, from: 0 });
    socket.receive(START);
    socket.receive({ type: "turns", turns: [0, 1].map((tick) => ({ tick, orders: [] })) });
    expect(turns).toEqual([1200, 1201, 0, 1]);
    expect(log.filter((entry) => entry.startsWith("started"))).toEqual(["started:2"]);
  });

  it("says when the seat it came back for is gone", () => {
    const online = client();
    const socket = welcomed();
    online.resume(START.token);
    socket.receive({ type: "error", code: "token_invalid", message: "" });
    expect(log.at(-1)).toBe("error:token_invalid");
    socket.drop();
    timers.at(-1)?.callback();
    expect(welcomed().sent).toHaveLength(1);
  });
});
