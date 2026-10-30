import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_VERSION,
  ClientMessage,
  encodeClientMessage,
  encodeServerMessage,
  parseClientMessage,
  parseServerMessage,
  type Frame,
  type ServerMessage,
} from "@frontfall/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createGameServer, type GameServer } from "../src/server.ts";

/** Fixed by default so CI is reproducible; set FUZZ_SEED to explore other inputs. */
const SEED = Number(process.env.FUZZ_SEED ?? 0x5eed_2026) >>> 0;

/** mulberry32: tiny, fast and good enough to pick bytes. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

type Random = () => number;

const int = (rng: Random, below: number): number => Math.floor(rng() * below);
const pick = <T>(rng: Random, items: readonly T[]): T => items[int(rng, items.length)] as T;

/** Integers around the edges the decoders check: zero, varint byte boundaries, 2^31, 2^53. */
function edgyInt(rng: Random): number {
  const edges = [0, 1, 127, 128, 16_383, 16_384, 0xffff, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1];
  const value = rng() < 0.5 ? pick(rng, edges) : int(rng, 2 ** 31);
  return rng() < 0.05 ? Number.MAX_SAFE_INTEGER - int(rng, 2) : value;
}

/** A message the server accepts, to start mutations from. */
function validClientMessage(rng: Random): ClientMessage {
  switch (int(rng, 13)) {
    case 0:
      return {
        type: "hello",
        version: PROTOCOL_VERSION,
        name: pick(rng, ["Léa", "Nico", "a b", "x".repeat(20)]),
      };
    case 1:
      return { type: "play" };
    case 2:
      return { type: "create" };
    case 3:
      return { type: "join", game: "Xk3_9aB-q2Lm" };
    case 4:
      return { type: "rejoin", token: "q8Vb1aV9mN3x0WcY2tLk4Q", from: edgyInt(rng) };
    case 5:
      return pick(rng, [{ type: "start" }, { type: "leave" }] as const);
    case 6:
      return { type: "hash", tick: edgyInt(rng), hash: int(rng, 2 ** 32) };
    case 7:
      return { type: "order", order: { type: "spawn", tile: Math.min(edgyInt(rng), 2 ** 31 - 1) } };
    case 8:
      return {
        type: "order",
        order: {
          type: "build",
          structure: int(rng, 256),
          tile: Math.min(edgyInt(rng), 2 ** 31 - 1),
        },
      };
    case 9:
      return {
        type: "order",
        order: { type: "demolish", tile: Math.min(edgyInt(rng), 2 ** 31 - 1) },
      };
    case 10:
      return { type: "order", order: { type: "ally", target: 1 + int(rng, 0xffff) } };
    case 11:
      return { type: "order", order: { type: "betray", target: 1 + int(rng, 0xffff) } };
    default:
      return {
        type: "order",
        order: {
          type: "attack",
          target: Math.min(edgyInt(rng), 2 ** 31 - 1),
          troops: Math.max(1, edgyInt(rng)),
        },
      };
  }
}

/** Turns sent by mistake in the other direction: same framing, other kind byte. */
function validTurnsFrame(rng: Random): Uint8Array {
  const message: ServerMessage = {
    type: "turns",
    turns: Array.from({ length: int(rng, 3) + 1 }, (_, index) => ({
      tick: 40 + index,
      orders: Array.from({ length: int(rng, 3) }, () => ({
        player: int(rng, 0xffff) + 1,
        order: { type: "spawn" as const, tile: int(rng, 2 ** 31) },
      })),
    })),
  };
  return encodeServerMessage(message) as Uint8Array;
}

function randomBytes(rng: Random, length: number): Uint8Array {
  return Uint8Array.from({ length }, () => int(rng, 256));
}

function mutateBytes(rng: Random, source: Uint8Array): Uint8Array {
  const bytes = Array.from(source);
  const steps = int(rng, 4) + 1;
  for (let step = 0; step < steps; step++) {
    const at = int(rng, bytes.length + 1);
    switch (int(rng, 6)) {
      case 0:
        if (at < bytes.length) bytes[at] = int(rng, 256);
        break;
      case 1:
        if (at < bytes.length) bytes[at] = (bytes[at] ?? 0) ^ (1 << int(rng, 8));
        break;
      case 2:
        bytes.length = at;
        break;
      case 3:
        bytes.push(...randomBytes(rng, int(rng, 8) + 1));
        break;
      case 4:
        bytes.splice(at, 0, pick(rng, [0x00, 0x7f, 0x80, 0xff]));
        break;
      default:
        bytes.splice(at, 1);
    }
  }
  return Uint8Array.from(bytes);
}

const JSON_PIECES = [
  "{",
  "}",
  "[",
  "]",
  ",",
  ":",
  '"type"',
  '"hello"',
  '"order"',
  '"join"',
  '"hash"',
  '"rejoin"',
  '"version"',
  '"name"',
  '"game"',
  '"tick"',
  '"__proto__"',
  '"constructor"',
  "null",
  "true",
  "-1",
  "1e308",
  "0.5",
  "9007199254740993",
  '"\\u0000"',
  '"\\ud800"',
];

function jsonish(rng: Random): string {
  return Array.from({ length: int(rng, 24) + 1 }, () => pick(rng, JSON_PIECES)).join("");
}

function mutateText(rng: Random, source: string): string {
  const chars = Array.from(source);
  const steps = int(rng, 3) + 1;
  for (let step = 0; step < steps; step++) {
    const at = int(rng, chars.length + 1);
    switch (int(rng, 4)) {
      case 0:
        chars.length = at;
        break;
      case 1:
        chars.splice(at, 1, String.fromCharCode(int(rng, 0x80)));
        break;
      case 2:
        chars.splice(at, 0, pick(rng, JSON_PIECES));
        break;
      default:
        chars.splice(at, 0, String.fromCodePoint(int(rng, 0x110000)));
    }
  }
  return chars.join("");
}

/** One frame a hostile or broken client could send. */
function fuzzFrame(rng: Random): Frame {
  const roll = rng();
  if (roll < 0.15) return randomBytes(rng, int(rng, 40));
  if (roll < 0.25) return jsonish(rng);
  if (roll < 0.3) return mutateBytes(rng, validTurnsFrame(rng));
  const valid = encodeClientMessage(validClientMessage(rng));
  if (roll < 0.35) return valid;
  return typeof valid === "string" ? mutateText(rng, valid) : mutateBytes(rng, valid);
}

function describeFrame(frame: Frame): string {
  return typeof frame === "string"
    ? `text ${JSON.stringify(frame)}`
    : `binary ${Buffer.from(frame).toString("hex")}`;
}

/**
 * Every decoded binary frame must be the canonical encoding of what it decoded
 * to, and every decoded message must satisfy the schema it was parsed with.
 */
function checkFrame(frame: Frame): boolean {
  const client = parseClientMessage(frame);
  parseServerMessage(frame);
  if (!client.ok) return false;
  ClientMessage.parse(client.value);
  const again = encodeClientMessage(client.value);
  if (typeof frame !== "string") expect(again).toEqual(frame);
  expect(parseClientMessage(again)).toEqual(client);
  return true;
}

describe("message parsing under fuzzing", () => {
  it("decodes 100,000 random, truncated and mutated frames without throwing", () => {
    const rng = random(SEED);
    let accepted = 0;
    for (let index = 0; index < 100_000; index++) {
      const frame = fuzzFrame(rng);
      try {
        if (checkFrame(frame)) accepted++;
      } catch (error) {
        throw new Error(`seed ${String(SEED)}, frame ${String(index)}: ${describeFrame(frame)}`, {
          cause: error,
        });
      }
    }
    // Some mutations stay valid, most do not: both paths were exercised.
    expect(accepted).toBeGreaterThan(1_000);
    expect(accepted).toBeLessThan(50_000);
  });
});

describe("server under fuzzed connections", () => {
  let staticRoot: string;
  let server: GameServer;
  let host: string;

  beforeAll(async () => {
    staticRoot = mkdtempSync(join(tmpdir(), "frontfall-fuzz-"));
    server = createGameServer({
      staticRoot,
      version: "fuzz",
      maxConnectionsPerAddress: 10_000,
      upgradeRate: { perSecond: 10_000, burst: 10_000 },
      drainMs: 0,
    });
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    host = `127.0.0.1:${String((server.http.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await server.close();
    rmSync(staticRoot, { recursive: true, force: true });
  });

  function connect(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://${host}/ws`);
      socket.once("open", () => {
        resolve(socket);
      });
      socket.once("error", reject);
    });
  }

  /** Two players in a running private game, recording when each turn arrives. */
  async function honestGame() {
    const [alice, bob] = await Promise.all([connect(), connect()]);
    const arrivals: { tick: number; at: number }[] = [];
    const inbox = new Map<WebSocket, string[]>([
      [alice, []],
      [bob, []],
    ]);
    for (const [socket, texts] of inbox) {
      socket.on("message", (data: Buffer, isBinary: boolean) => {
        if (!isBinary) {
          texts.push(data.toString("utf8"));
          return;
        }
        if (socket !== bob) return;
        const parsed = parseServerMessage(new Uint8Array(data));
        if (parsed.ok && parsed.value.type === "turns") {
          for (const turn of parsed.value.turns)
            arrivals.push({ tick: turn.tick, at: performance.now() });
        }
      });
    }
    const until = async (socket: WebSocket, type: string): Promise<Record<string, unknown>> => {
      const texts = inbox.get(socket) ?? [];
      for (;;) {
        const index = texts.findIndex((text) => text.includes(`"type":"${type}"`));
        if (index >= 0)
          return JSON.parse(texts.splice(index, 1)[0] ?? "{}") as Record<string, unknown>;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    const send = (socket: WebSocket, message: ClientMessage) => {
      socket.send(encodeClientMessage(message));
    };
    send(alice, { type: "hello", version: PROTOCOL_VERSION, name: "Alice" });
    send(bob, { type: "hello", version: PROTOCOL_VERSION, name: "Bob" });
    await Promise.all([until(alice, "welcome"), until(bob, "welcome")]);
    send(alice, { type: "create" });
    const { game } = await until(alice, "lobby");
    send(bob, { type: "join", game: game as string });
    await until(bob, "lobby");
    send(alice, { type: "start" });
    await until(bob, "started");
    return {
      arrivals,
      order: () => {
        send(alice, { type: "order", order: { type: "attack", target: 1234, troops: 50 } });
      },
      close: () => {
        alice.terminate();
        bob.terminate();
      },
    };
  }

  /**
   * Opens a connection, maybe says hello, then sends the frames until the
   * server hangs up. Frames are drawn before connecting, so a seed always
   * produces the same frames whatever order the connections open in.
   */
  async function hostileConnection(hello: boolean, frames: readonly Frame[]): Promise<number> {
    const socket = await connect();
    const done = new Promise<void>((resolve) =>
      socket.once("close", () => {
        resolve();
      }),
    );
    if (hello)
      socket.send(encodeClientMessage({ type: "hello", version: PROTOCOL_VERSION, name: "Fuzz" }));
    let sent = 0;
    for (const frame of frames) {
      if (socket.readyState !== WebSocket.OPEN) break;
      socket.send(frame);
      sent++;
    }
    // Connections whose frames were all valid stay open: close them from this side.
    setTimeout(() => {
      socket.terminate();
    }, 50).unref();
    await done;
    return sent;
  }

  it("keeps serving health checks and other games while fed thousands of bad frames", async () => {
    const game = await honestGame();
    const rng = random(SEED ^ 0xdead_beef);
    const fuzzStart = performance.now();
    const firstTick = game.arrivals.length;
    let sent = 0;
    try {
      while (sent < 4_000) {
        game.order();
        const batch = Array.from({ length: 40 }, () => {
          const hello = rng() < 0.6;
          const frames = Array.from({ length: int(rng, 6) + 1 }, () => fuzzFrame(rng));
          return hostileConnection(hello, frames);
        });
        sent += (await Promise.all(batch)).reduce((sum, count) => sum + count, 0);
      }
    } catch (error) {
      throw new Error(`seed ${String(SEED)}`, { cause: error });
    }
    // Leave a few more turns to arrive after the last bad frame.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const elapsed = performance.now() - fuzzStart;
    game.close();

    const health = await fetch(`http://${host}/healthz`);
    expect(health.status).toBe(200);

    const during = game.arrivals.slice(firstTick);
    expect(during.map((turn) => turn.tick)).toEqual(
      Array.from({ length: during.length }, (_, index) => firstTick + index),
    );
    // The game kept its pace: about one turn per 133 ms (a normal game runs 3 ticks in 4 beats), without long stalls.
    expect(during.length).toBeGreaterThan((elapsed / 133) * 0.8);
    const gaps = during.slice(1).map((turn, index) => turn.at - (during[index]?.at ?? 0));
    expect(Math.max(...gaps)).toBeLessThan(500);
  }, 30_000);
});
