import { describe, expect, it } from "vitest";
import { STANDARD_RULES, createGame } from "../src/create-game.ts";
import { Game, type GameSetup } from "../src/game.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

const grid = new WorldGrid(8, 4);

function setup(overrides: Partial<GameSetup> = {}): GameSetup {
  return {
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 7,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    ...overrides,
  };
}

describe("STANDARD_RULES", () => {
  // Order rules and tick systems run in the order they were installed: this order is part of the game.
  it("installs the rules in a pinned order", () => {
    expect(STANDARD_RULES.map((rule) => rule.name)).toEqual([
      "spawn",
      "doctrines",
      "diplomacy",
      "gifts",
      "quick-messages",
      "attacks",
      "warships",
      "missiles",
      "boats",
      "capitals",
      "structures",
      "trade",
      "economy",
      "landmarks",
      "victory",
    ]);
    expect(Object.isFrozen(STANDARD_RULES)).toBe(true);
  });

  it("is what createGame installs, rule after rule", () => {
    const made = createGame(setup({ rules: { capitals: true } }));
    const game = new Game(setup({ rules: { capitals: true } }));
    game.terrain.prepare();
    for (const rule of STANDARD_RULES) rule.install(game);
    for (let tick = 0; tick < 5; tick++) {
      made.step({ tick, orders: [{ player: 1, order: { type: "spawn", tile: 9 } }] });
      game.step({ tick, orders: [{ player: 1, order: { type: "spawn", tile: 9 } }] });
    }
    expect(game.hash()).toBe(made.hash());
    expect(game.persistedParts().map((part) => part.name)).toEqual(
      made.persistedParts().map((part) => part.name),
    );
  });

  it("lets a rule the game does not play with install nothing (R-CAP)", () => {
    const capitals = STANDARD_RULES.find((rule) => rule.name === "capitals");
    const without = new Game(setup());
    capitals?.install(without);
    expect(without.persistedParts()).toEqual([]);
    const played = new Game(setup({ rules: { capitals: true } }));
    capitals?.install(played);
    expect(played.persistedParts().map((part) => part.name)).toEqual(["capitals", "capital falls"]);
  });
});
