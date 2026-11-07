import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameReport } from "@frontfall/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { readDocument, writeDocument } from "../src/database.ts";
import { tempDatabase } from "./support/database.ts";
import {
  botsRange,
  firstOrderRange,
  frameRange,
  shareRange,
  exportMonths,
  humansRange,
  loadUsage,
  minutesRange,
  saveUsage,
  UsageStats,
  usageTable,
} from "../src/usage.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 25, 12);

const GAME: GameReport = {
  kind: "game",
  release: "0.5.0",
  game: "0123456789abcdef",
  mode: "solo",
  map: "world",
  teams: 0,
  nations: true,
  bots: 20,
  humans: 1,
  difficulty: "normal",
  disabled: 0b100100,
  minutes: 12.5,
  outcome: "victory",
  device: "phone",
  touch: true,
  lang: "fr",
  view: "flat",
};

const stats = () => new UsageStats({ release: "0.5.0", maps: new Set(["world", "europe"]) });

let directory: string | undefined;
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("ranges", () => {
  it("puts numbers into the ranges of the export", () => {
    expect([0, 1, 5, 6, 20, 21, 51, 400].map(botsRange)).toEqual([
      "0",
      "1-5",
      "1-5",
      "6-20",
      "6-20",
      "21-50",
      "51+",
      "51+",
    ]);
    expect([1, 2, 3, 4, 5, 8, 9, 64].map(humansRange)).toEqual([
      "1",
      "2",
      "3-4",
      "3-4",
      "5-8",
      "5-8",
      "9+",
      "9+",
    ]);
    expect([0, 1.9, 2, 7, 19, 39, 40, 300].map(minutesRange)).toEqual([
      "0-2",
      "0-2",
      "2-5",
      "5-10",
      "10-20",
      "20-40",
      "40+",
      "40+",
    ]);
  });
});

describe("ranges of play", () => {
  it("puts land shares in fifths and frame times around 60, 30 and 20 images a second", () => {
    expect([0, 19, 20, 79, 80, 100].map(shareRange)).toEqual([
      "0-19",
      "0-19",
      "20-39",
      "60-79",
      "80+",
      "80+",
    ]);
    expect([5, 17, 18, 34, 35, 50, 51].map(frameRange)).toEqual([
      "smooth",
      "smooth",
      "ok",
      "ok",
      "slow",
      "slow",
      "bad",
    ]);
  });
});

describe("what a game says about play", () => {
  it("crosses the outcome with the settings, the features used, the land and the frame time", () => {
    const counted = stats();
    counted.record(
      {
        ...GAME,
        outcome: "defeat",
        used: 0b10000001,
        peak: 45,
        share: 0,
        frameMs: 40,
        view: "globe",
      },
      NOW,
    );
    const total = counted.export(NOW).total;
    expect(total["by_difficulty"]).toEqual({ "normal.defeat": 1 });
    expect(total["by_map"]).toEqual({ "world.defeat": 1 });
    expect(total["by_length"]).toEqual({ "10-20.defeat": 1 });
    expect(total["by_device"]).toEqual({ "phone.defeat": 1 });
    expect(total["by_nations"]).toEqual({ "on.defeat": 1 });
    expect(total["used"]).toEqual({ city: 1, ally: 1 });
    expect(total["used_by"]).toEqual({ "city.defeat": 1, "ally.defeat": 1 });
    expect(total["peak"]).toEqual({ "40-59": 1 });
    expect(total["share"]).toEqual({ "defeat.0-19": 1 });
    expect(total["frame"]).toEqual({ "globe.slow": 1 });
    expect(total["frame_by"]).toEqual({ "phone.slow": 1 });
  });

  it("counts a game from an older page, which says nothing of play, only by its settings", () => {
    const counted = stats();
    counted.record(GAME, NOW);
    const total = counted.export(NOW).total;
    expect(total["by_difficulty"]).toEqual({ "normal.victory": 1 });
    for (const name of ["used", "used_by", "peak", "share", "frame"]) {
      expect(total).not.toHaveProperty(name);
    }
  });

  it("counts a game that used nothing apart", () => {
    const counted = stats();
    counted.record({ ...GAME, used: 0 }, NOW);
    expect(counted.export(NOW).total["used"]).toEqual({ none: 1 });
  });
});

describe("UsageStats", () => {
  it("tells games left or lost within two minutes apart, and times the first order", () => {
    expect([undefined, 0, 9, 10, 59, 60, 119, 120].map(firstOrderRange)).toEqual([
      "none",
      "0-10",
      "0-10",
      "10-30",
      "30-60",
      "60-120",
      "60-120",
      "120+",
    ]);
    const usage = stats();
    usage.record(
      { ...GAME, game: "a".repeat(16), minutes: 1, outcome: "left", firstOrder: 4 },
      NOW,
    );
    usage.record({ ...GAME, game: "b".repeat(16), minutes: 1.5, outcome: "defeat" }, NOW);
    usage.record({ ...GAME, game: "c".repeat(16), minutes: 12 }, NOW);
    expect(usage.export(NOW).total).toMatchObject({
      early: { "solo.left": 1, "solo.defeat": 1 },
      first_order: { "0-10": 1, none: 2 },
    });
  });

  it("adds one to each dimension of a game, today and in total", () => {
    const usage = stats();
    expect(usage.record(GAME, NOW)).toBe(true);
    const { total, days, since } = usage.export(NOW);
    expect(since).toBe("2026-10-25");
    expect(days).toEqual([{ day: "2026-10-25", counts: total }]);
    expect(total).toMatchObject({
      games: { solo: 1 },
      outcome: { "solo.victory": 1 },
      map: { world: 1 },
      teams: { "0": 1 },
      nations: { on: 1 },
      bots: { "6-20": 1 },
      humans: { "1": 1 },
      difficulty: { normal: 1 },
      minutes: { "10-20": 1 },
      device: { phone: 1 },
      touch: { yes: 1 },
      lang: { fr: 1 },
      view: { flat: 1 },
      release: { "0.5.0": 1 },
      disabled: { port: 1, warships: 1 },
    });
    expect(total.rules).toBeUndefined();
  });

  it("counts the special rules a game was played with (R-MODE-08)", () => {
    const usage = stats();
    usage.record(
      { ...GAME, rules: { collapsingFronts: true, capitals: true, doctrines: false } },
      NOW,
    );
    usage.record(
      {
        ...GAME,
        game: "b".repeat(16),
        rules: { collapsingFronts: true, capitals: false, doctrines: true },
      },
      NOW,
    );
    expect(usage.export(NOW).total.rules).toEqual({
      collapsingFronts: 2,
      capitals: 1,
      doctrines: 1,
    });
  });

  it("counts a game once however often it is reported, and one vote per game", () => {
    const usage = stats();
    expect(usage.record(GAME, NOW)).toBe(true);
    expect(usage.record({ ...GAME, outcome: "closed" }, NOW + 1000)).toBe(false);
    const vote = {
      kind: "feedback",
      release: "0.5.0",
      game: GAME.game,
      mode: "solo",
      outcome: "victory",
      vote: "up",
    } as const;
    expect(usage.record(vote, NOW)).toBe(true);
    expect(usage.record({ ...vote, vote: "down" }, NOW)).toBe(false);
    const { total } = usage.export(NOW);
    expect(total.games).toEqual({ solo: 1 });
    expect(total.votes).toEqual({ up: 1 });
    expect(total.votes_by).toEqual({ "solo.victory.up": 1 });
  });

  it("names unknown maps and other releases without repeating them", () => {
    const usage = stats();
    usage.record({ ...GAME, game: "1111111111111111", map: "my-secret-map" }, NOW);
    usage.record({ ...GAME, game: "2222222222222222", map: "generated", release: "0.4.0" }, NOW);
    const { total } = usage.export(NOW);
    expect(total.map).toEqual({ other: 1, generated: 1 });
    expect(total.release).toEqual({ "0.5.0": 1, other: 1 });
  });

  it("counts errors and the reasons given with a thumbs down", () => {
    const usage = stats();
    usage.record({ kind: "error", release: "0.5.0", type: "webgl" }, NOW);
    usage.record({ kind: "error", release: "0.5.0", type: "webgl" }, NOW);
    usage.record(
      {
        kind: "feedback",
        release: "0.5.0",
        game: GAME.game,
        mode: "solo",
        outcome: "defeat",
        vote: "down",
        reason: "unclear",
      },
      NOW,
    );
    const { total } = usage.export(NOW);
    expect(total.errors).toEqual({ webgl: 2 });
    expect(total.reasons).toEqual({ unclear: 1 });
  });

  it("keeps 90 days, newest first, and the total of every day", () => {
    const usage = stats();
    usage.record({ ...GAME, game: "1111111111111111" }, NOW - 100 * DAY);
    usage.record({ ...GAME, game: "2222222222222222" }, NOW - DAY);
    usage.record({ ...GAME, game: "3333333333333333" }, NOW);
    const exported = usage.export(NOW);
    expect(exported.days.map((day) => day.day)).toEqual(["2026-10-25", "2026-10-24"]);
    expect(exported.total.games).toEqual({ solo: 3 });
  });

  it("renders its totals for Prometheus", () => {
    const usage = stats();
    usage.record(GAME, NOW);
    const lines = usage.renderMetrics();
    expect(lines).toContain("# TYPE frontfall_usage_total counter");
    expect(lines).toContain('frontfall_usage_total{dimension="games",value="solo"} 1');
  });
});

describe("saving the counts", () => {
  it("writes them to data.db, without the ids of the games, and reads them back", () => {
    const data = tempDatabase();
    try {
      const usage = stats();
      usage.record(GAME, NOW);
      saveUsage(usage, data.db, NOW);
      const again = stats();
      expect(loadUsage(again, data.reopen(), NOW)).toBeUndefined();
      expect(again.export(NOW)).toEqual(usage.export(NOW));
      expect(readDocument(data.db, "usage")).not.toContain(GAME.game);
    } finally {
      data.remove();
    }
  });

  it("starts empty without counts, and sets aside counts that do not read", () => {
    const data = tempDatabase();
    try {
      const usage = stats();
      expect(loadUsage(usage, data.db, NOW)).toBeUndefined();
      writeDocument(data.db, "usage", "{ not json");
      expect(loadUsage(usage, data.db, NOW)?.message).toContain(`usage.broken-${String(NOW)}`);
      // Set aside, so that the next save does not write over what could be mended.
      expect(readDocument(data.db, `usage.broken-${String(NOW)}`)).toBe("{ not json");
      expect(readDocument(data.db, "usage")).toBeUndefined();
      expect(usage.export(NOW).days).toEqual([]);
    } finally {
      data.remove();
    }
  });
});

describe("usageTable", () => {
  it("summarises the last days for the status page", () => {
    const usage = stats();
    usage.record(GAME, NOW);
    usage.record({ ...GAME, game: "1111111111111111", mode: "public", device: "desktop" }, NOW);
    const html = usageTable(usage.export(NOW));
    expect(html).toContain("<td>2026-10-25</td><td>1</td><td>1</td><td>0</td><td>50 %</td>");
    expect(usageTable(stats().export(NOW))).toContain(
      "No games counted yet / Aucune partie comptée",
    );
  });

  it("exports one file per month and never cuts an old one down", () => {
    directory = mkdtempSync(join(tmpdir(), "frontfall-data-"));
    const months = join(directory, "months");
    const usage = stats();
    usage.record(GAME, NOW);
    exportMonths(usage, months, NOW);
    const file = join(months, `${new Date(NOW).toISOString().slice(0, 7)}.json`);
    const first = JSON.parse(readFileSync(file, "utf8")) as { days: Record<string, unknown> };
    expect(Object.keys(first.days)).toEqual([new Date(NOW).toISOString().slice(0, 10)]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    // A restart that lost the days still leaves the month as it was.
    exportMonths(stats(), months, NOW);
    expect(readFileSync(file, "utf8")).toBe(JSON.stringify({ ...first }));
  });

  it("keeps the larger figures when the file holds more than the memory", () => {
    directory = mkdtempSync(join(tmpdir(), "frontfall-data-"));
    const months = join(directory, "months");
    const full = stats();
    full.record(GAME, NOW);
    full.record({ ...GAME, game: "other-game" }, NOW);
    exportMonths(full, months, NOW);
    const file = join(months, "2026-10.json");
    const before = readFileSync(file, "utf8");
    const partial = stats();
    partial.record(GAME, NOW);
    exportMonths(partial, months, NOW);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("sets an unreadable month aside and says so", () => {
    directory = mkdtempSync(join(tmpdir(), "frontfall-data-"));
    const months = join(directory, "months");
    mkdirSync(months);
    writeFileSync(join(months, "2026-10.json"), "{ not json");
    const usage = stats();
    usage.record(GAME, NOW);
    const problems: string[] = [];
    exportMonths(usage, months, NOW, (message) => problems.push(message));
    expect(problems).toHaveLength(1);
    expect(readFileSync(join(months, `2026-10.json.broken-${String(NOW)}`), "utf8")).toBe(
      "{ not json",
    );
  });
});
