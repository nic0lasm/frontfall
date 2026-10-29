import type { Turn } from "@frontfall/engine";
import { describe, expect, it } from "vitest";
import { TurnPacer } from "../src/game/turn-pacer.ts";

const TICK_MS = 100;
const FRAME_MS = 1000 / 60;

/** Deterministic noise in [-1, 1]. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return (state / 2 ** 31) * 2 - 1;
  };
}

/**
 * Plays `count` turns sent by the server every tick, each arriving after
 * `delay(tick)` milliseconds, through a pacer updated every frame; returns
 * when each turn was played and when it was sent.
 */
function simulate(
  count: number,
  delay: (tick: number) => number,
): { sent: number; played: number }[] {
  const arrivals = Array.from({ length: count }, (_, tick) => ({
    tick,
    at: tick * TICK_MS + delay(tick),
  }));
  // The network keeps order: a turn never overtakes the one before it.
  for (let i = 1; i < count; i++) {
    const current = arrivals[i] as { at: number };
    current.at = Math.max(current.at, (arrivals[i - 1] as { at: number }).at);
  }
  const played: { sent: number; played: number }[] = [];
  let now = 0;
  const pacer = new TurnPacer((turns) => {
    for (const turn of turns) played.push({ sent: turn.tick * TICK_MS, played: now });
  }, TICK_MS);
  let next = 0;
  while (played.length < count) {
    const due: Turn[] = [];
    while (next < count && (arrivals[next] as { at: number }).at <= now) {
      due.push({ tick: next, orders: [] });
      next++;
    }
    pacer.push(due, now);
    pacer.update(now);
    now += FRAME_MS;
  }
  return played;
}

describe("TurnPacer", () => {
  it("plays turns at a steady pace with 150 ms of latency and 5 % jitter", () => {
    const jitter = noise(7);
    const played = simulate(600, () => 150 + 7.5 * jitter());
    for (let i = 0; i < played.length; i++) {
      const turn = played[i] as { sent: number; played: number };
      // No tick later than 300 ms after the server ran it.
      expect(turn.played - turn.sent).toBeLessThanOrEqual(300);
      if (i > 0) {
        const gap = turn.played - (played[i - 1] as { played: number }).played;
        // One tick of the game per tick of the clock, give or take a frame.
        expect(gap).toBeGreaterThan(TICK_MS - 2 * FRAME_MS);
        expect(gap).toBeLessThan(TICK_MS + 2 * FRAME_MS);
      }
    }
  });

  it("spreads turns that arrive in bunches", () => {
    // Pairs of turns arrive together, every other tick.
    const played = simulate(200, (tick) => 150 + (tick % 2 === 0 ? TICK_MS : 0));
    const gaps = played
      .slice(1)
      .map((turn, i) => turn.played - (played[i] as { played: number }).played);
    expect(Math.min(...gaps.slice(10))).toBeGreaterThan(TICK_MS / 2);
  });

  it("lets a lone late turn play late rather than hold back the turns after it", () => {
    // Every 30th turn is held up 200 ms, by the network or a busy page.
    const played = simulate(600, (tick) => 150 + (tick % 30 === 15 ? 200 : 0));
    // The next one, which cannot overtake it, comes late too.
    const held = played
      .filter((_, tick) => tick % 30 !== 15 && tick % 30 !== 16)
      .slice(30)
      .map((turn) => turn.played - turn.sent);
    // The others wait no more than the usual delay, give or take a frame.
    expect(Math.max(...held)).toBeLessThanOrEqual(150 + 2 * FRAME_MS);
  });

  it("plays a backlog at once, as after a rejoin", () => {
    const calls: number[] = [];
    const pacer = new TurnPacer((turns) => calls.push(turns.length), TICK_MS);
    pacer.push(
      Array.from({ length: 2000 }, (_, tick) => ({ tick, orders: [] })),
      0,
    );
    pacer.update(0);
    expect(calls).toEqual([2000]);
    expect(pacer.pending).toBe(0);
  });

  it("spreads the turns of a faster game, four to a beat, one every 25 ms (R-MODE-07)", () => {
    const calls: { at: number; count: number }[] = [];
    let now = 0;
    const pacer = new TurnPacer((turns) => calls.push({ at: now, count: turns.length }), 25, 4);
    // Two beats bunched together: jitter, not a backlog.
    pacer.push(
      Array.from({ length: 8 }, (_, tick) => ({ tick, orders: [] })),
      100,
    );
    for (now = 100; now <= 300; now += 5) pacer.update(now);
    expect(calls.reduce((sum, call) => sum + call.count, 0)).toBe(8);
    expect(calls.length).toBeGreaterThan(4);
  });
});
