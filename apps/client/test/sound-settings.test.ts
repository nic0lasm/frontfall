import { describe, expect, it } from "vitest";
import { parseSound } from "../src/audio/settings.ts";

describe("sound settings", () => {
  it("starts from the defaults and mends anything unreadable", () => {
    const defaults = { volume: 60, muted: false };
    expect(parseSound(null)).toEqual(defaults);
    expect(parseSound("not json")).toEqual(defaults);
    expect(parseSound("42")).toEqual(defaults);
    expect(parseSound('{"volume":"loud","muted":"yes"}')).toEqual(defaults);
  });

  it("keeps what was chosen, the volume within range", () => {
    expect(parseSound('{"volume":30,"muted":true}')).toEqual({ volume: 30, muted: true });
    expect(parseSound('{"volume":250}').volume).toBe(100);
    expect(parseSound('{"volume":-5}').volume).toBe(0);
  });
});
