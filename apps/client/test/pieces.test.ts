import { describe, expect, it } from "vitest";
import { PIECE_KINDS } from "../src/render/pieces.ts";

describe("pieces", () => {
  it("has one glyph for each building and unit the map draws", () => {
    expect([...PIECE_KINDS].sort()).toEqual(
      [
        "airDefense",
        "capital",
        "city",
        "fort",
        "heavyMissile",
        "missile",
        "palace",
        "port",
        "silo",
        "trade",
        "transport",
        "warship",
      ].sort(),
    );
  });
});
