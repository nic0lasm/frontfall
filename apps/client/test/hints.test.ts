import { describe, expect, it } from "vitest";
import type { GameUpdate } from "../src/game/game-runner.ts";
import { due, hintsTexts } from "../src/ui/hints.ts";
import { hintsSeen, markHint, turnHintsOff } from "../src/ui/guide-state.ts";

/** Only the fields a hint reads. */
function update(patch: Record<string, unknown> = {}): GameUpdate {
  return {
    phase: "play",
    you: 1,
    players: [{ id: 1, alive: true, gold: 0 }],
    incoming: [],
    diplomacy: { embargoedBy: [], incoming: [] },
    fallout: [],
    build: { cityCost: 100 },
    ...patch,
  } as unknown as GameUpdate;
}

function memory(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  } as unknown as Storage;
}

describe("due hints", () => {
  it("wait for something to happen, and for the attacks to open", () => {
    expect(due(update(), [])).toBeUndefined();
    expect(due(update({ phase: "spawn", incoming: [{}] }), [])).toBeUndefined();
    expect(due(update({ incoming: [{}] }), [])).toBe("attacked");
    expect(due(update({ diplomacy: { embargoedBy: [2], incoming: [] } }), [])).toBe("embargo");
    expect(due(update({ diplomacy: { embargoedBy: [], incoming: [{}] } }), [])).toBe("request");
    expect(due(update({ fallout: [{}] }), [])).toBe("fallout");
  });

  it("tell idle gold once it would pay for several cities", () => {
    expect(due(update({ players: [{ id: 1, alive: true, gold: 299 }] }), [])).toBeUndefined();
    expect(due(update({ players: [{ id: 1, alive: true, gold: 300 }] }), [])).toBe("gold");
  });

  it("show each hint once, and none to a player who is out", () => {
    expect(due(update({ incoming: [{}] }), ["attacked"])).toBeUndefined();
    expect(due(update({ players: [{ id: 1, alive: false, gold: 900 }] }), [])).toBeUndefined();
  });

  it("have a text in both languages for every hint", () => {
    expect(Object.keys(hintsTexts.fr).sort()).toEqual(Object.keys(hintsTexts.en).sort());
    for (const text of Object.values(hintsTexts.en)) expect(text).not.toMatch(/\d/);
  });
});

describe("hint storage", () => {
  it("remembers what was shown, and stops for good when turned off", () => {
    const storage = memory();
    expect(hintsSeen(storage)).toEqual([]);
    markHint(storage, "attacked");
    markHint(storage, "gold");
    expect(hintsSeen(storage)).toEqual(["attacked", "gold"]);
    turnHintsOff(storage);
    markHint(storage, "fallout");
    expect(hintsSeen(storage)).toEqual(["off"]);
  });
});
