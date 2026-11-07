import { describe, expect, it } from "vitest";
import { addressPseudonym, jsonLogger, silentLogger } from "../src/log.ts";

describe("jsonLogger", () => {
  it("writes one JSON object per line with time, level and event", () => {
    const lines: string[] = [];
    const logger = jsonLogger((line) => lines.push(line));
    logger.info("game_started", { game: "abc", players: 3 });
    logger.warn("desync", { tick: 50 });
    logger.error("uncaught_exception", { error: "boom" });
    expect(lines.every((line) => line.endsWith("\n"))).toBe(true);
    const [first, second, third] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(first).toMatchObject({ level: "info", event: "game_started", game: "abc", players: 3 });
    expect(Number.isNaN(Date.parse(String(first?.time)))).toBe(false);
    expect(second).toMatchObject({ level: "warn", event: "desync", tick: 50 });
    expect(third).toMatchObject({ level: "error", event: "uncaught_exception", error: "boom" });
  });

  it("can stay silent", () => {
    expect(() => {
      silentLogger.info("x");
      silentLogger.warn("y");
      silentLogger.error("z");
    }).not.toThrow();
  });
});

describe("addressPseudonym", () => {
  it("is stable for one address and never contains it", () => {
    const pseudonym = addressPseudonym();
    const value = pseudonym("203.0.113.9");
    expect(pseudonym("203.0.113.9")).toBe(value);
    expect(pseudonym("203.0.113.10")).not.toBe(value);
    expect(value).not.toContain("203");
    expect(value).toHaveLength(12);
  });

  it("changes with the secret, so it cannot be looked up across restarts", () => {
    expect(addressPseudonym()("203.0.113.9")).not.toBe(addressPseudonym()("203.0.113.9"));
  });
});
