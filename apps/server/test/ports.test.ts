import { describe, expect, it } from "vitest";
import { systemClock } from "../src/clock.ts";
import { Directory } from "../src/directory.ts";
import { systemIds, type Ids } from "../src/ids.ts";
import type { Peer } from "../src/room.ts";
import { DEFAULT_GAME } from "../src/server.ts";
import { FakeClock } from "./support/fake-clock.ts";

const peer: Peer = { send: () => undefined, probe: () => undefined };

/** Ids that count up, so a test knows each one in advance. */
function countingIds(): Ids {
  let next = 0;
  return {
    gameId: () => `game-${String(++next)}`,
    token: () => `token-${String(++next)}`,
    seed: () => ++next,
    bytes: (size) => Buffer.alloc(size, ++next),
    fraction: () => 0.5,
  };
}

describe("systemClock", () => {
  it("reads the machine's time", () => {
    const before = Date.now();
    expect(systemClock.now()).toBeGreaterThanOrEqual(before);
    const first = systemClock.monotonic();
    expect(systemClock.monotonic()).toBeGreaterThanOrEqual(first);
  });

  it("runs a timeout once, and not after it is cleared", async () => {
    let runs = 0;
    systemClock.setTimeout(() => runs++, 1);
    const cleared = systemClock.setTimeout(() => (runs += 10), 1).unref();
    cleared.clear();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runs).toBe(1);
  });

  it("runs an interval until it is cleared", async () => {
    let runs = 0;
    const timer = systemClock.setInterval(() => runs++, 1).unref();
    await new Promise((resolve) => setTimeout(resolve, 30));
    timer.clear();
    const seen = runs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toBeGreaterThan(1);
    expect(runs).toBe(seen);
  });
});

describe("systemIds", () => {
  it("draws ids of the length players share and tokens too long to guess", () => {
    expect(systemIds.gameId()).toMatch(/^[\w-]{12}$/);
    expect(systemIds.token()).toMatch(/^[\w-]{22}$/);
    expect(systemIds.gameId()).not.toBe(systemIds.gameId());
    expect(systemIds.bytes(32)).toHaveLength(32);
  });

  it("draws seeds and fractions in their ranges", () => {
    for (let i = 0; i < 100; i++) {
      const seed = systemIds.seed();
      expect(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 31).toBe(true);
      const fraction = systemIds.fraction();
      expect(fraction >= 0 && fraction < 1).toBe(true);
    }
  });
});

describe("FakeClock", () => {
  it("runs timers in the order they fall due, at the time they were due", () => {
    const clock = new FakeClock(1_000);
    const seen: string[] = [];
    clock.setTimeout(() => seen.push(`b@${String(clock.monotonic())}`), 20);
    clock.setTimeout(() => seen.push(`a@${String(clock.monotonic())}`), 10);
    const every = clock.setInterval(() => seen.push(`i@${String(clock.now() - 1_000)}`), 15);
    clock.advance(31);
    expect(seen).toEqual(["a@10", "i@15", "b@20", "i@30"]);
    every.clear();
    clock.advance(100);
    expect(seen).toHaveLength(4);
    expect(clock.timers).toBe(0);
    expect(clock.now()).toBe(1_131);
  });
});

describe("the server's ids", () => {
  it("takes game ids, seeds and tokens from the ids it is given", () => {
    const games = new Directory({
      maxRooms: 10,
      publicGame: { ...DEFAULT_GAME },
      privateGame: { ...DEFAULT_GAME, minPlayers: 1, countdownMs: 0 },
      ids: countingIds(),
    });
    const room = games.create({ kind: "hosted", visibility: "private", name: null });
    expect(room?.id).toBe("game-1");
    expect(room?.seed).toBe(2);
    const seat = room?.join("Ana", peer, 0);
    expect(typeof seat === "object" ? seat.token : seat).toBe("token-3");
  });
});
