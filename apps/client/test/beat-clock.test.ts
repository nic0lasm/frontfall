import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BeatClock } from "../src/game/beat-clock.ts";

const BEAT_MS = 100;

describe("BeatClock", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** When each beat ran, from the start of the clock. */
  function startClock(): { beats: number[]; clock: BeatClock } {
    const start = performance.now();
    const beats: number[] = [];
    const clock = new BeatClock(() => beats.push(performance.now() - start), BEAT_MS);
    clock.start();
    return { beats, clock };
  }

  it("beats on a fixed schedule", () => {
    const { beats } = startClock();
    vi.advanceTimersByTime(1000);
    expect(beats).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it("plays the next beat at once for an order, and keeps the pace after it", () => {
    const { beats, clock } = startClock();
    vi.advanceTimersByTime(130);
    expect(clock.pull()).toBe(true);
    expect(beats).toEqual([100, 130]);
    // The beat after keeps its time: the game is not faster for the order.
    vi.advanceTimersByTime(1000 - 130);
    expect(beats).toEqual([100, 130, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it("never runs more than a beat ahead, however fast the orders come", () => {
    const { beats, clock } = startClock();
    for (let t = 0; t < 1000; t += 10) {
      clock.pull();
      vi.advanceTimersByTime(10);
    }
    // At most one beat more than the schedule's 10.
    expect(beats.length).toBeLessThanOrEqual(11);
  });

  it("does nothing once stopped", () => {
    const { beats, clock } = startClock();
    clock.stop();
    expect(clock.pull()).toBe(false);
    vi.advanceTimersByTime(500);
    expect(beats).toEqual([]);
  });
});
