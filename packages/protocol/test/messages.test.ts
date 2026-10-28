import { describe, expect, it } from "vitest";
import {
  encodeClientMessage,
  encodeServerMessage,
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "../src/messages.ts";

const CLIENT_MESSAGES: ClientMessage[] = [
  { type: "hello", version: 1, name: "Nico" },
  { type: "hello", version: 1, name: "Nico", build: "0d25e267bbae" },
  { type: "play" },
  { type: "play", name: "Partie de Nico" },
  { type: "create" },
  { type: "create", visibility: "public", name: "4v4 Europe" },
  { type: "hold" },
  { type: "active" },
  { type: "join", game: "Xk3_9aB-q2Lm" },
  { type: "rejoin", token: "0123456789abcdefABCDEF", from: 1200 },
  { type: "start" },
  { type: "leave" },
  {
    type: "configure",
    options: {
      map: "europe",
      bots: 6,
      difficulty: "easy",
      nations: true,
      teams: 2,
      disabled: 9,
      capacity: 8,
      autoStart: false,
    },
    name: "Europe en équipes",
  },
  { type: "hash", tick: 50, hash: 0xdeadbeef },
  { type: "order", order: { type: "spawn", tile: 4096 } },
  { type: "order", order: { type: "attack", target: 2 ** 31 - 1, troops: 2 ** 40 } },
];

const SERVER_MESSAGES: ServerMessage[] = [
  { type: "welcome", version: 1 },
  {
    type: "lobby",
    game: "Xk3_9aB-q2Lm",
    visibility: "public",
    name: "Partie de Nico",
    map: "world",
    bots: 3,
    difficulty: "normal",
    nations: true,
    teams: 0,
    disabled: 0,
    capacity: 16,
    autoStart: true,
    speed: 1,
    rules: { collapsingFronts: true },
    minPlayers: 2,
    players: [
      { id: 1, name: "Nico" },
      { id: 2, name: "Léa" },
    ],
    you: 2,
    host: 1,
    startsIn: 12_000,
    token: "q8Vb1aV9mN3x0WcY2tLk4Q",
    holdable: true,
    configured: 0,
  },
  {
    type: "started",
    game: "Xk3_9aB-q2Lm",
    map: "world",
    seed: 123456,
    bots: 0,
    difficulty: "hard",
    nations: true,
    teams: 4,
    disabled: 32,
    tickRate: 10,
    speed: 2,
    rules: { collapsingFronts: false },
    players: [{ id: 1, name: "Nico" }],
    you: 1,
    token: "0123456789abcdefABCDEF",
  },
  {
    type: "turns",
    turns: [
      { tick: 7, orders: [] },
      {
        tick: 8,
        orders: [
          { player: 2, order: { type: "spawn", tile: 9 } },
          { player: 1, order: { type: "attack", target: 10, troops: 300 } },
        ],
      },
    ],
  },
  { type: "desync", tick: 150, hash: 8, expected: 7 },
  { type: "desync", tick: 200, hash: 1, expected: null },
  { type: "ended", reason: "abandoned" },
  { type: "error", code: "game_full", message: "the game is full" },
];

describe("client messages", () => {
  it.each(CLIENT_MESSAGES)("round-trips $type", (message) => {
    expect(parseClientMessage(encodeClientMessage(message))).toEqual({ ok: true, value: message });
  });

  it("sends orders as binary frames and everything else as text", () => {
    expect(
      encodeClientMessage({ type: "order", order: { type: "spawn", tile: 1 } }),
    ).toBeInstanceOf(Uint8Array);
    expect(typeof encodeClientMessage({ type: "play" })).toBe("string");
  });

  it("refuses an order sent as text", () => {
    const raw = JSON.stringify({ type: "order", order: { type: "spawn", tile: 1 } });
    expect(parseClientMessage(raw)).toEqual({
      ok: false,
      error: "order must be sent as a binary frame",
    });
  });

  it("refuses a turns frame from a client", () => {
    const frame = encodeServerMessage({ type: "turns", turns: [{ tick: 0, orders: [] }] });
    expect(parseClientMessage(frame)).toEqual({ ok: false, error: "unexpected turns frame" });
  });

  it("rejects malformed JSON without throwing", () => {
    expect(parseClientMessage("{")).toEqual({ ok: false, error: "malformed JSON" });
  });

  it("rejects unknown types and unknown fields", () => {
    expect(parseClientMessage(JSON.stringify({ type: "cheat" })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "play", extra: 1 })).ok).toBe(false);
  });

  it("rejects left-out options outside the six known bits", () => {
    const options = {
      map: "world",
      bots: 0,
      difficulty: "easy",
      nations: true,
      teams: 0,
      capacity: 16,
      autoStart: true,
    };
    const configure = (disabled: number) =>
      parseClientMessage(JSON.stringify({ type: "configure", options: { ...options, disabled } }));
    expect(configure(63).ok).toBe(true);
    expect(configure(64).ok).toBe(false);
    expect(configure(-1).ok).toBe(false);
  });

  it("takes the speeds 1, 2 and 4 only, or none (R-MODE-07)", () => {
    const options = {
      map: "world",
      bots: 0,
      difficulty: "easy",
      nations: true,
      teams: 0,
      disabled: 0,
      capacity: 16,
      autoStart: true,
    };
    const configure = (speed?: number) =>
      parseClientMessage(JSON.stringify({ type: "configure", options: { ...options, speed } }));
    expect([undefined, 1, 2, 4].map((speed) => configure(speed).ok)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([0, 3, 8, 1.5].map((speed) => configure(speed).ok)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("takes special rules by name only, each on or off, or none (R-MODE-08)", () => {
    const options = {
      map: "world",
      bots: 0,
      difficulty: "easy",
      nations: true,
      teams: 0,
      disabled: 0,
      capacity: 16,
      autoStart: true,
    };
    const configure = (rules?: unknown) =>
      parseClientMessage(JSON.stringify({ type: "configure", options: { ...options, rules } }));
    expect(configure(undefined).ok).toBe(true);
    expect(configure({ collapsingFronts: true }).ok).toBe(true);
    expect(configure({ collapsingFronts: false }).ok).toBe(true);
    expect(configure({}).ok).toBe(false);
    expect(configure({ collapsingFronts: 1 }).ok).toBe(false);
    expect(configure({ collapsingFronts: true, doctrines: true }).ok).toBe(false);
  });

  it("keeps seats between 2 and 16 and names of a sane size", () => {
    const options = {
      map: "world",
      bots: 0,
      difficulty: "easy",
      nations: true,
      teams: 0,
      disabled: 0,
      autoStart: true,
    };
    const configure = (capacity: number) =>
      parseClientMessage(JSON.stringify({ type: "configure", options: { ...options, capacity } }));
    expect(configure(2).ok).toBe(true);
    expect(configure(16).ok).toBe(true);
    expect(configure(1).ok).toBe(false);
    expect(configure(17).ok).toBe(false);
    const create = (name: string) =>
      parseClientMessage(JSON.stringify({ type: "create", visibility: "public", name }));
    expect(create("x".repeat(64)).ok).toBe(true);
    expect(create("x".repeat(65)).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "create", visibility: "secret" })).ok).toBe(
      false,
    );
  });

  it("rejects game ids that could not come from the server", () => {
    expect(parseClientMessage(JSON.stringify({ type: "join", game: "../x" })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "join", game: "a".repeat(33) })).ok).toBe(
      false,
    );
  });

  it("accepts a hello from any version, so the server can report the mismatch", () => {
    const raw = JSON.stringify({ type: "hello", version: 99, name: "x", future: true });
    expect(parseClientMessage(raw).ok).toBe(true);
  });
});

describe("server messages", () => {
  it.each(SERVER_MESSAGES)("round-trips $type", (message) => {
    expect(parseServerMessage(encodeServerMessage(message))).toEqual({ ok: true, value: message });
  });

  it("refuses turns that are not consecutive", () => {
    expect(() =>
      encodeServerMessage({
        type: "turns",
        turns: [
          { tick: 1, orders: [] },
          { tick: 3, orders: [] },
        ],
      }),
    ).toThrow(RangeError);
  });

  it("refuses an order frame from the server", () => {
    const frame = encodeClientMessage({ type: "order", order: { type: "spawn", tile: 1 } });
    expect(parseServerMessage(frame)).toEqual({ ok: false, error: "unexpected order frame" });
  });

  it("encodes a turn of 32 orders at least 3 times smaller than JSON", () => {
    const orders = Array.from({ length: 32 }, (_, index) => ({
      player: index + 1,
      order:
        index % 2 === 0
          ? { type: "spawn" as const, tile: 1_000_000 + index * 977 }
          : { type: "attack" as const, target: 2_000_000 + index * 131, troops: 25_000 + index },
    }));
    const message: ServerMessage = { type: "turns", turns: [{ tick: 36_000, orders }] };
    const binary = encodeServerMessage(message);
    expect(binary).toBeInstanceOf(Uint8Array);
    expect(binary.length * 3).toBeLessThanOrEqual(JSON.stringify(message).length);
  });
});
