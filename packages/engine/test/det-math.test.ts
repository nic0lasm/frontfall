import { describe, expect, it } from "vitest";
import { detExp, detLn, detPow } from "../src/integer-math.ts";

describe("detPow", () => {
  it("agrees with Math.pow to a few parts in a billion", () => {
    for (const [x, p] of [
      [1, 0.6],
      [1000, 0.6],
      [2_500_000, 0.6],
      [25_000, 0.73],
      [7, 0.73],
      [123456789, 0.73],
    ] as const) {
      // The reference may differ in the last bit between engines; a test needs no more.
      // eslint-disable-next-line no-restricted-properties
      expect(Math.abs(detPow(x, p) / Math.pow(x, p) - 1)).toBeLessThan(1e-9);
    }
  });

  it("is exact at the ends", () => {
    expect(detPow(0, 0.6)).toBe(0);
    expect(detLn(1)).toBe(0);
    expect(detExp(0)).toBe(1);
  });
});
