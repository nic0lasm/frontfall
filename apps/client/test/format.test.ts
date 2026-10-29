import { afterEach, describe, expect, it } from "vitest";
import { setLanguage } from "../src/i18n/index.ts";
import { formatCount, formatDuration, formatPercent, formatSpeed } from "../src/ui/format.ts";

describe("HUD numbers", () => {
  afterEach(() => {
    setLanguage("en");
  });

  it("writes counts in full below ten thousand, then compact", () => {
    setLanguage("en");
    expect(formatCount(950)).toBe("950");
    expect(formatCount(9_999)).toBe("9,999");
    expect(formatCount(12_400)).toBe("12.4K");
    expect(formatCount(3_100_000)).toBe("3.1M");
  });

  it("keeps compact figures to three digits so they take about the same room", () => {
    setLanguage("en");
    expect(formatCount(123_456)).toBe("123K");
    expect(formatCount(999_900)).toBe("1M");
    expect(formatCount(1_240_000)).toBe("1.24M");
    expect(formatCount(123_400_000)).toBe("123M");
  });

  it("writes half speed with the reader's decimal mark (R-MODE-07)", () => {
    setLanguage("en");
    expect([0.5, 1, 4].map(formatSpeed)).toEqual(["0.5", "1", "4"]);
    setLanguage("fr");
    expect(formatSpeed(0.5)).toBe("0,5");
  });

  it("follows the reader's language", () => {
    setLanguage("fr");
    expect(formatCount(1_500)).toBe("1 500");
    expect(formatCount(12_400)).toBe("12,4 k");
    expect(formatPercent(0.25)).toBe("25 %");
  });

  it("switches language back and forth with formats made once", () => {
    setLanguage("en");
    expect(formatCount(1_500)).toBe("1,500");
    setLanguage("fr");
    expect(formatCount(1_500)).toBe("1 500");
    setLanguage("en");
    expect(formatCount(1_500)).toBe("1,500");
    expect(formatPercent(0.054)).toBe("5.4%");
    expect(formatPercent(0.25)).toBe("25%");
  });

  it("keeps a decimal for small shares only", () => {
    setLanguage("en");
    expect(formatPercent(0.054)).toBe("5.4%");
    expect(formatPercent(0.256)).toBe("26%");
  });

  it("writes game time as m:ss, then h:mm:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65.9)).toBe("1:05");
    expect(formatDuration(3_600)).toBe("1:00:00");
    expect(formatDuration(3_725)).toBe("1:02:05");
    expect(formatDuration(-3)).toBe("0:00");
  });
});
