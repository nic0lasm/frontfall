import type { GameRecord, Order, Turn } from "@frontfall/engine";
import { TICK_RATE } from "@frontfall/protocol";
import { describe, expect, it } from "vitest";
import type { GameSnapshot, GameUpdate, SoloOptions } from "../src/game/game-runner.ts";
import type { WorkerReply, WorkerRequest } from "../src/game/messages.ts";
import { BASE_PACE } from "../src/game/pace.ts";
import {
  OnlineSession,
  PACER_MS,
  type ServerLink,
  type SessionClock,
} from "../src/game/online-session.ts";
import { ReplaySession } from "../src/game/replay-session.ts";
import type { GameSession, SessionEvents } from "../src/game/session.ts";
import { openSession } from "../src/game/sessions.ts";
import type { SimPort } from "../src/game/sim-port.ts";
import { SOLO_SNAPSHOT_REFUSED, SoloSession } from "../src/game/solo-session.ts";
import type { SessionDeps } from "../src/game/worker-session.ts";
import type { MapInfo } from "../src/maps.ts";

/** A worker that keeps what the page sends and answers when told to. */
class FakePort implements SimPort {
  readonly sent: WorkerRequest[] = [];
  onmessage: SimPort["onmessage"] = null;
  onerror: SimPort["onerror"] = null;
  terminated = false;
  postMessage(request: WorkerRequest): void {
    this.sent.push(request);
  }
  reply(data: WorkerReply): void {
    this.onmessage?.({ data });
  }
  terminate(): void {
    this.terminated = true;
  }
  /** What was sent after the start, by type. */
  types(): string[] {
    return this.sent.slice(1).map((request) => request.type);
  }
}

/** A clock that moves only when the test says so, with the pacer's timer on it. */
class FakeClock implements SessionClock {
  time = 0;
  private timers: { ms: number; run: () => void; next: number }[] = [];
  now(): number {
    return this.time;
  }
  every(ms: number, run: () => void): () => void {
    const timer = { ms, run, next: this.time + ms };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((other) => other !== timer);
    };
  }
  get running(): number {
    return this.timers.length;
  }
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const timer = this.timers.reduce<(typeof this.timers)[number] | undefined>(
        (first, other) => (first === undefined || other.next < first.next ? other : first),
        undefined,
      );
      if (!timer || timer.next > end) break;
      this.time = timer.next;
      timer.next += timer.ms;
      timer.run();
    }
    this.time = end;
  }
}

/** Every event of a session, in order. */
function recorder() {
  const seen: unknown[][] = [];
  const events: SessionEvents = {
    onStart: (info) => seen.push(["start", info.you]),
    onUpdate: (update) => seen.push(["update", update.tick]),
    onClick: (tile, outcome, note) => seen.push(["click", tile, outcome, note]),
    onPeek: (preview) => seen.push(["peek", preview.tile]),
    onError: (message) => seen.push(["error", message]),
    onArrived: (orders) => seen.push(["arrived", orders]),
  };
  return { seen, events };
}

/** Runs `run` with the warnings of the console silenced. */
function quietly(run: () => void): void {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    run();
  } finally {
    console.warn = warn;
  }
}

/** Lets the start, which waits for the manifest, and the requests after it go out. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const MAP = { id: "pangaea" } as MapInfo;
const OPTIONS: SoloOptions = {
  map: "pangaea",
  seed: 1,
  bots: 2,
  difficulty: "normal",
  playerName: "Ada",
};
const ORDER: Order = { type: "retreat", attack: 4 };
const SNAPSHOT = { tick: 30 } as unknown as GameSnapshot;

function deps(port: FakePort, refusals: string[] = []): SessionDeps {
  return {
    worker: () => port,
    manifest: () => Promise.resolve(undefined),
    noteRefusal: (reason) => refusals.push(reason),
  };
}

function update(tick: number, hashes?: { tick: number; hash: number }[]): GameUpdate {
  return { tick, ...(hashes ? { hashes } : {}) } as unknown as GameUpdate;
}

function link() {
  const calls: unknown[][] = [];
  const server: Required<ServerLink> = {
    order: (order) => calls.push(["order", order.type]),
    hash: (tick, hash) => calls.push(["hash", tick, hash]),
    snapshot: (snapshot) => calls.push(["snapshot", snapshot.tick]),
    replayFromStart: () => calls.push(["replayFromStart"]),
    report: (player, reason) => calls.push(["report", player, reason]),
  };
  return { calls, server };
}

describe("solo session", () => {
  it("starts the worker with its own clock and plays the orders there", async () => {
    const port = new FakePort();
    const { events } = recorder();
    const session: GameSession = new SoloSession(OPTIONS, MAP, events, undefined, deps(port));
    expect(session.capabilities).toMatchObject({
      kind: "solo",
      canPause: true,
      canOrder: true,
      canSetSpeed: true,
      relayed: false,
      canHide: false,
      guided: true,
    });
    session.sendOrder(ORDER);
    session.setPaused(true);
    session.setSpeed(2);
    session.requestSnapshot();
    session.pushTurns([{ tick: 0, orders: [] }]);
    session.desync(3, null);
    session.reportPlayer(2, "cheating");
    await settle();
    expect(port.sent[0]).toMatchObject({ type: "start", online: false, keep: false });
    expect(port.types()).toEqual(["order", "pause", "speed"]);
    await expect(session.desyncReport()).resolves.toBeUndefined();
  });

  it("keeps the snapshots the worker takes, and says when the kept game is refused", async () => {
    const port = new FakePort();
    const refusals: string[] = [];
    const kept: GameSnapshot[] = [];
    const { seen, events } = recorder();
    const session = new SoloSession(
      OPTIONS,
      MAP,
      events,
      (snapshot) => kept.push(snapshot),
      deps(port, refusals),
    );
    session.requestSnapshot();
    await settle();
    expect(port.sent[0]).toMatchObject({ keep: true });
    expect(port.types()).toEqual(["snapshot"]);
    port.reply({ type: "snapshot", snapshot: SNAPSHOT });
    expect(kept).toEqual([SNAPSHOT]);
    quietly(() => {
      port.reply({ type: "snapshotRefused", reason: "format" });
    });
    expect(refusals).toEqual(["format"]);
    expect(seen).toEqual([["error", SOLO_SNAPSHOT_REFUSED]]);
  });

  it("passes on the worker's answers, the latest peek only, and records in order", async () => {
    const port = new FakePort();
    const { seen, events } = recorder();
    const session = new SoloSession(OPTIONS, MAP, events, undefined, deps(port));
    session.click(5, 30, "city", 2, 1);
    session.click(6, 30);
    session.peek(7, "fort");
    session.peek(8, "fort", 3);
    const first = session.record();
    const second = session.record();
    await settle();
    expect(port.sent.slice(1)).toEqual([
      { type: "click", tile: 5, ratio: 30, mode: "city", reach: 2, seen: 1 },
      { type: "click", tile: 6, ratio: 30, mode: "attack" },
      { type: "peek", seq: 1, tile: 7, mode: "fort" },
      { type: "peek", seq: 2, tile: 8, mode: "fort", reach: 3 },
      { type: "record" },
      { type: "record" },
    ]);
    port.reply({ type: "started", you: 1 } as unknown as WorkerReply);
    port.reply({ type: "update", update: update(1) });
    port.reply({ type: "click", tile: 5, outcome: "build", order: ORDER });
    port.reply({ type: "peek", seq: 1, tile: 7 } as unknown as WorkerReply);
    port.reply({ type: "peek", seq: 2, tile: 8 } as unknown as WorkerReply);
    const a = { seed: 1 } as unknown as GameRecord;
    port.reply({ type: "record", record: a });
    port.reply({ type: "record", record: undefined });
    port.reply({ type: "error", message: "broken" });
    port.onerror?.({ message: "crashed" });
    expect(seen).toEqual([
      ["start", 1],
      ["update", 1],
      ["click", 5, "build", undefined],
      ["peek", 8],
      ["error", "broken"],
      ["error", "crashed"],
    ]);
    await expect(first).resolves.toBe(a);
    await expect(second).resolves.toBeUndefined();
    session.dispose();
    expect(port.terminated).toBe(true);
  });

  it("says so when the map's manifest cannot be fetched", async () => {
    const port = new FakePort();
    const { seen, events } = recorder();
    new SoloSession(OPTIONS, MAP, events, undefined, {
      ...deps(port),
      manifest: () => Promise.reject(new Error("HTTP 404")),
    });
    await settle();
    expect(port.sent).toEqual([]);
    expect(seen).toEqual([["error", "HTTP 404"]]);
  });
});

describe("replay session", () => {
  it("watches a record at the pace of the bar, with no order and no record of its own", async () => {
    const port = new FakePort();
    const { events } = recorder();
    const session = new ReplaySession(OPTIONS, MAP, events, deps(port));
    expect(session.capabilities).toMatchObject({
      kind: "replay",
      canPause: true,
      canOrder: false,
      canSetSpeed: true,
      recordable: false,
      guided: false,
    });
    session.sendOrder();
    session.click();
    session.setSpeed(4);
    session.setPaused(true);
    await expect(session.record()).resolves.toBeUndefined();
    await settle();
    expect(port.sent[0]).toMatchObject({ type: "start", online: false, keep: false });
    expect(port.types()).toEqual(["speed", "pause"]);
  });
});

describe("online session", () => {
  function online(server: ServerLink, options: SoloOptions = { ...OPTIONS, you: 2, speed: 1 }) {
    const port = new FakePort();
    const clock = new FakeClock();
    const refusals: string[] = [];
    const { seen, events } = recorder();
    const session: GameSession = new OnlineSession(options, MAP, events, server, {
      ...deps(port, refusals),
      clock,
    });
    return { port, clock, seen, session, refusals };
  }

  it("sends orders and hashes to the server and never pauses", async () => {
    const { calls, server } = link();
    const { port, seen, session } = online(server);
    expect(session.capabilities).toMatchObject({
      kind: "online",
      canPause: false,
      canOrder: true,
      canSetSpeed: false,
      relayed: true,
      canHide: true,
      canReport: true,
    });
    session.sendOrder(ORDER);
    session.setPaused(true);
    session.setSpeed(2);
    session.reportPlayer(3, "abuse");
    await settle();
    expect(port.sent[0]).toMatchObject({ type: "start", online: true, keep: false });
    expect(port.types()).toEqual([]);
    port.reply({ type: "click", tile: 9, outcome: "attack", order: ORDER });
    port.reply({ type: "click", tile: 9, outcome: "own" });
    port.reply({ type: "update", update: update(4, [{ tick: 4, hash: 77 }]) });
    port.reply({ type: "snapshot", snapshot: SNAPSHOT });
    quietly(() => {
      port.reply({ type: "snapshotRefused", reason: "format" });
    });
    expect(calls).toEqual([
      ["order", "retreat"],
      ["report", 3, "abuse"],
      ["order", "retreat"],
      ["hash", 4, 77],
      ["snapshot", 30],
      ["replayFromStart"],
    ]);
    expect(seen).toEqual([
      ["click", 9, "attack", undefined],
      ["click", 9, "own", undefined],
      ["update", 4],
    ]);
  });

  it("evens out the server's turns and counts the player's own orders as they play", async () => {
    const { server } = link();
    const { port, clock, seen, session } = online(server);
    const turn = (tick: number, players: number[]): Turn => ({
      tick,
      orders: players.map((player) => ({ player, order: ORDER })),
    });
    const interval = 1000 / TICK_RATE / BASE_PACE;
    const at = (time: number): void => {
      clock.advance(time - clock.time);
    };
    // Turns that all arrive 30 ms after their tick: each plays as it comes.
    for (let tick = 0; tick < 5; tick++) {
      at(tick * interval + 30);
      session.pushTurns([turn(tick, tick === 0 ? [2, 1] : [])]);
    }
    await settle();
    expect(port.types()).toEqual(["turns", "turns", "turns", "turns", "turns"]);
    // One that comes early waits for the same delay, and plays from the timer.
    at(5 * interval);
    session.pushTurns([turn(5, [2, 2])]);
    at(5 * interval + 20);
    await settle();
    expect(port.types()).toHaveLength(5);
    at(5 * interval + 30 + PACER_MS);
    await settle();
    expect(port.types()).toHaveLength(6);
    expect(seen).toEqual([
      ["arrived", 1],
      ["arrived", 2],
    ]);
    expect(clock.running).toBe(1);
    session.dispose();
    expect(clock.running).toBe(0);
    expect(port.terminated).toBe(true);
  });

  it("asks the worker for a desync report and passes on a flagged hash", async () => {
    const { server } = link();
    const { port, session } = online({ order: server.order, hash: server.hash });
    expect(session.capabilities.canReport).toBe(false);
    session.desync(12, 99);
    const report = session.desyncReport();
    await settle();
    expect(port.sent.slice(1)).toEqual([
      { type: "desync", tick: 12, expected: 99 },
      { type: "report" },
    ]);
    port.reply({ type: "report", report: undefined });
    await expect(report).resolves.toBeUndefined();
    // A link that keeps no snapshot and cannot replay from the start ignores both.
    port.reply({ type: "snapshot", snapshot: SNAPSHOT });
    quietly(() => {
      port.reply({ type: "snapshotRefused", reason: "format" });
    });
  });
});

describe("the session of a mode", () => {
  it("is a replay with a record, online with a link, solo otherwise", () => {
    const { events } = recorder();
    const real = globalThis.Worker;
    const ports: FakePort[] = [];
    globalThis.Worker = function (): FakePort {
      const port = new FakePort();
      ports.push(port);
      return port;
    } as unknown as typeof Worker;
    try {
      const record = { seed: 1 } as unknown as GameRecord;
      const replay = openSession({ ...OPTIONS, record }, MAP, events, link().server);
      const remote = openSession(OPTIONS, MAP, events, link().server);
      const solo = openSession(OPTIONS, MAP, events);
      expect([replay, remote, solo].map((s) => s.capabilities.kind)).toEqual([
        "replay",
        "online",
        "solo",
      ]);
      for (const session of [replay, remote, solo]) session.dispose();
      expect(ports.every((port) => port.terminated)).toBe(true);
    } finally {
      globalThis.Worker = real;
    }
  });
});
