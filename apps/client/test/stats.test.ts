import { describe, expect, it } from "vitest";
import { readStats } from "../src/stats/stats.ts";

// Shaped like an /api/stats answer (docs/privacy.md, "What is published").
const answer = {
  release: "0.5.0",
  since: "2026-10-23",
  total: {
    games: { solo: 7, public: 3 },
    map: { world: 4, europe: 4, island: 2 },
    minutes: { "40+": 1, "2-5": 3, "0-2": 2, "10-20": 4 },
  },
  days: [
    { day: "2026-10-26", counts: { games: { solo: 2, public: 3 } } },
    { day: "2026-10-23", counts: { games: { solo: 5 } } },
  ],
};

describe("statistics page", () => {
  it("counts every mode per day, oldest first, with the days without a game", () => {
    expect(readStats(answer).perDay).toEqual([
      { label: "2026-10-23", value: 5 },
      { label: "2026-10-24", value: 0 },
      { label: "2026-10-25", value: 0 },
      { label: "2026-10-26", value: 5 },
    ]);
  });

  it("puts the most played map first and the lengths in the order of their range", () => {
    const stats = readStats(answer);
    expect(stats.maps.map((bar) => bar.label)).toEqual(["europe", "world", "island"]);
    expect(stats.minutes.map((bar) => bar.label)).toEqual(["0-2", "2-5", "10-20", "40+"]);
    expect(stats.release).toBe("0.5.0");
    expect(stats.since).toBe("2026-10-23");
  });

  it("leaves out what is not a count", () => {
    const stats = readStats({
      total: { map: { world: 2, bad: -1, text: "3", half: 1.5 } },
      days: [{ day: "not a day", counts: {} }, null, { day: "2026-02-30", counts: {} }],
    });
    expect(stats.maps).toEqual([{ label: "world", value: 2 }]);
    expect(stats.perDay).toEqual([]);
    expect(stats.since).toBeNull();
  });

  it("shows the last 90 days of a saved file that holds more", () => {
    const perDay = readStats({
      total: {},
      days: [
        { day: "2026-10-26", counts: { games: { solo: 1 } } },
        { day: "1970-01-01", counts: { games: { solo: 1 } } },
      ],
    }).perDay;
    expect(perDay).toHaveLength(90);
    expect(perDay[0]?.label).toBe("2026-07-29");
  });

  it("names what is missing from an answer that is not one", () => {
    expect(() => readStats({ games: [] })).toThrow(/needs total and days/);
    expect(() => readStats(null)).toThrow(/needs total and days/);
  });
});
