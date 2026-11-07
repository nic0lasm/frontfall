import { describe, expect, it } from "vitest";
import type { GameUpdate } from "../src/game/game-runner.ts";
import { withHidden } from "../src/ui/hidden-players.ts";

const update = {
  players: [
    { id: 1, name: "Alice" },
    { id: 2, name: "Rude name" },
  ],
  events: [
    { type: "quick", a: 2, b: 1, phrase: 3 },
    { type: "quick", a: 1, b: 2, phrase: 4 },
    { type: "gift", a: 2, b: 1 },
  ],
} as unknown as GameUpdate;

describe("hidden players (R-DIPLO-08)", () => {
  it("names a hidden player by number and drops their quick messages, nothing else", () => {
    const shown = withHidden(update, new Set([2]));
    expect(shown.players.map((p) => p.name)).toEqual(["Alice", "Player 2"]);
    expect(shown.events).toEqual([
      { type: "quick", a: 1, b: 2, phrase: 4 },
      { type: "gift", a: 2, b: 1 },
    ]);
    expect(update.players[1]?.name).toBe("Rude name");
  });

  it("leaves the update as it is when nobody is hidden", () => {
    expect(withHidden(update, new Set())).toBe(update);
  });
});
