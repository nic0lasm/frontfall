import { describe, expect, it } from "vitest";
import { scrubMessage } from "../src/scrub.ts";
import { parseUsageReport, type GameReport } from "../src/usage.ts";

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
  disabled: 0,
  minutes: 12.5,
  outcome: "victory",
  device: "desktop",
  touch: false,
  lang: "fr",
  view: "flat",
};

describe("parseUsageReport", () => {
  it("reads the three kinds of report", () => {
    expect(parseUsageReport(JSON.stringify(GAME))).toEqual({ ok: true, value: GAME });
    const error = { kind: "error", release: "0.5.0", type: "webgl" };
    expect(parseUsageReport(JSON.stringify(error))).toEqual({ ok: true, value: error });
    const vote = {
      kind: "feedback",
      release: "0.5.0",
      game: "0123456789abcdef",
      mode: "public",
      outcome: "defeat",
      vote: "down",
      reason: "too_hard",
    };
    expect(parseUsageReport(JSON.stringify(vote))).toEqual({ ok: true, value: vote });
  });

  it("takes the special rules of a game, or none from an older page (R-MODE-08)", () => {
    const special = { ...GAME, rules: { collapsingFronts: true, capitals: true } };
    expect(parseUsageReport(JSON.stringify(special))).toEqual({ ok: true, value: special });
    expect(parseUsageReport(JSON.stringify({ ...GAME, rules: { other: true } })).ok).toBe(false);
  });

  it("refuses any field it does not know, such as a name", () => {
    expect(parseUsageReport(JSON.stringify({ ...GAME, name: "Léa" })).ok).toBe(false);
    expect(parseUsageReport(JSON.stringify({ ...GAME, outcome: "won" })).ok).toBe(false);
    expect(parseUsageReport(JSON.stringify({ ...GAME, game: "persistent-id" })).ok).toBe(false);
    expect(parseUsageReport("not json").ok).toBe(false);
  });

  it("takes a reason with a thumbs down only, and only from the fixed list", () => {
    const vote = {
      kind: "feedback",
      release: "0.5.0",
      game: "0123456789abcdef",
      mode: "solo",
      outcome: "victory",
      vote: "up",
    };
    expect(parseUsageReport(JSON.stringify(vote)).ok).toBe(true);
    expect(parseUsageReport(JSON.stringify({ ...vote, reason: "too_hard" })).ok).toBe(false);
    expect(
      parseUsageReport(JSON.stringify({ ...vote, vote: "down", reason: "anything I like" })).ok,
    ).toBe(false);
  });
});

describe("scrubMessage", () => {
  it("takes out addresses, paths, quoted text and numbers", () => {
    expect(scrubMessage("Failed to fetch https://nclsmgr.com/frontfall/maps/world.bin?x=1")).toBe(
      "Failed to fetch <url>",
    );
    expect(scrubMessage('No player named "Léa" at tile 12345')).toBe(
      "No player named <text> at tile #",
    );
    expect(scrubMessage("ENOENT: open /home/someone/file")).toBe("ENOENT: open <path>");
  });

  it("keeps the message short", () => {
    expect(scrubMessage("x".repeat(500))).toHaveLength(120);
  });
});
