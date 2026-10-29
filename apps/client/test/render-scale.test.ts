import { describe, expect, it } from "vitest";
import { MAX_PIXEL_RATIO, MIN_PIXEL_RATIO, RenderScale } from "../src/render/render-scale.ts";

/** Draws `count` frames `ms` apart from `start`; the ratios seen after each change. */
function play(scale: RenderScale, start: number, count: number, ms: number): number[] {
  const changes: number[] = [];
  for (let i = 0; i < count; i++) {
    if (scale.frame(start + i * ms, true)) changes.push(scale.ratio);
  }
  return changes;
}

describe("RenderScale", () => {
  it("draws at the device's ratio, capped to 2", () => {
    expect(new RenderScale(1).ratio).toBe(1);
    expect(new RenderScale(2).ratio).toBe(2);
    expect(new RenderScale(3).ratio).toBe(MAX_PIXEL_RATIO);
  });

  it("keeps the ratio while frames keep the display's pace", () => {
    const scale = new RenderScale(2);
    expect(play(scale, 0, 600, 1000 / 60)).toEqual([]);
    expect(scale.ratio).toBe(2);
  });

  it("steps down while frames are slow, never below the floor", () => {
    const scale = new RenderScale(2);
    const changes = play(scale, 0, 2000, 40);
    expect(changes.length).toBeGreaterThan(2);
    for (let i = 1; i < changes.length; i++) {
      expect(changes[i] as number).toBeLessThan(changes[i - 1] as number);
    }
    expect(scale.ratio).toBe(MIN_PIXEL_RATIO);
  });

  it("learns nothing from frames that were not drawn, or from a long gap", () => {
    const scale = new RenderScale(2);
    for (let i = 0; i < 600; i++) expect(scale.frame(i * 40, i % 2 === 0)).toBe(false);
    // A hidden tab: one frame every few seconds.
    expect(play(scale, 100_000, 100, 3000)).toEqual([]);
    expect(scale.ratio).toBe(2);
  });

  it("steps back up once frames keep up again", () => {
    const scale = new RenderScale(2);
    const down = play(scale, 0, 30, 40);
    expect(down).toHaveLength(1);
    expect(play(scale, 10_000, 100, 1000 / 60)).toEqual([2]);
  });

  it("holds off a step up that proved too slow, longer each time", () => {
    const scale = new RenderScale(2);
    // Slow at 2, fast below it: the GPU keeps up only at the lower ratio.
    const frames = (start: number, ms: number) => {
      let now = start;
      const changes: number[] = [];
      while (now < start + ms) {
        now += scale.ratio === 2 ? 40 : 1000 / 60;
        if (scale.frame(now, true)) changes.push(scale.ratio);
      }
      return changes;
    };
    // Down, up, down again, then held below for 30 s.
    expect(frames(0, 5_000)).toEqual([1.6, 2, 1.6]);
    expect(frames(5_000, 25_000)).toEqual([]);
    // Tried again, failed, and held twice as long.
    expect(frames(30_000, 10_000)).toEqual([2, 1.6]);
    expect(frames(40_000, 50_000)).toEqual([]);
  });
});

describe("RenderScale under a cap", () => {
  it("never draws sharper than the cap", () => {
    expect(new RenderScale(3, 1).ratio).toBe(1);
    expect(new RenderScale(2, 1.5).ratio).toBe(1.5);
    expect(new RenderScale(1, 1.5).ratio).toBe(1);
  });

  it("says once that frames are too slow with nothing left to lower", () => {
    const scale = new RenderScale(1, 1);
    play(scale, 0, 2000, 40);
    expect(scale.ratio).toBe(MIN_PIXEL_RATIO);
    expect(scale.takeFloored()).toBe(true);
    expect(scale.takeFloored()).toBe(false);
    expect(scale.frameMs).toBeGreaterThan(30);
  });

  it("does not say it while a lower ratio is left to try", () => {
    const scale = new RenderScale(2);
    play(scale, 0, 30, 40);
    expect(scale.takeFloored()).toBe(false);
  });
});
