import { describe, expect, it } from "vitest";
import { Random } from "../src/random.ts";

function take(random: Random, count: number): number[] {
  return Array.from({ length: count }, () => random.nextUint32());
}

describe("Random", () => {
  it("produces the same sequence for the same seed", () => {
    expect(take(new Random(42), 100)).toEqual(take(new Random(42), 100));
  });

  it("produces different sequences for adjacent seeds", () => {
    expect(take(new Random(1), 8)).not.toEqual(take(new Random(2), 8));
  });

  it("stays on a known sequence across platforms and releases", () => {
    expect(take(new Random(2026), 4)).toMatchInlineSnapshot(`
      [
        1436751614,
        742089593,
        1736781944,
        1312845263,
      ]
    `);
  });

  it("resumes exactly from a saved state", () => {
    const original = new Random(7);
    take(original, 10);
    const restored = Random.fromState(original.state());
    expect(take(restored, 50)).toEqual(take(original, 50));
  });

  it("keeps nextInt within bounds and covers the whole range", () => {
    const random = new Random(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const value = random.nextInt(-3, 4);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThan(4);
      seen.add(value);
    }
    expect(seen.size).toBe(7);
  });

  it("rejects empty or fractional ranges", () => {
    const random = new Random(0);
    expect(() => random.nextInt(5, 5)).toThrow(RangeError);
    expect(() => random.nextInt(0, 1.5)).toThrow(RangeError);
  });
});
