import { describe, expect, it } from "vitest";
import { readTotal, usageReport } from "../src/usage-report.ts";

const total = {
  games: { solo: 40 },
  outcome: { "solo.victory": 10, "solo.defeat": 25, "solo.closed": 5 },
  by_difficulty: { "easy.victory": 8, "easy.defeat": 4, "normal.defeat": 21, "normal.victory": 2 },
  early: { "solo.defeat": 6 },
  used: { city: 30, port: 4 },
  used_by: { "port.victory": 3, "port.defeat": 1 },
  frame: { "flat.smooth": 20, "flat.slow": 5 },
};

describe("usageReport", () => {
  it("tells the win rate of each difficulty, in the order of the difficulties", () => {
    const text = usageReport(readTotal({ total }), "2026-10-25", "0.9.4");
    expect(text).toContain("40 games");
    expect(text).toMatch(/\| easy \| 12 \|.* 67 % \|/);
    expect(text).toMatch(/\| normal \| 23 \|.* 9 % \|/);
    expect(text.indexOf("| easy")).toBeLessThan(text.indexOf("| normal"));
    expect(text).toContain("Games over in under two minutes: 6 of 40 (15 %)");
  });

  it("flags a rate over few games and reads features and frames", () => {
    const text = usageReport(readTotal({ total }), null, "0.9.4");
    expect(text).toMatch(/\| port \| 4 \|.* 75 % \(few\) \|/);
    expect(text).toContain("city 75 % (30)");
    expect(text).toContain("flat.smooth 80 % (20)");
  });

  it("refuses an answer that is not /api/stats and drops values that are not counts", () => {
    expect(() => readTotal({})).toThrow(/total/);
    expect(readTotal({ total: { map: { world: 2, bad: "x", neg: -1 }, odd: 3 } })).toEqual({
      map: { world: 2 },
    });
  });
});
