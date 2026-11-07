import { describe, expect, it } from "vitest";
import { AttackError } from "../src/attacks.ts";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import { Game, type Order, type Player } from "../src/game.ts";
import { orderError } from "../src/orders.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

const grid = new WorldGrid(4, 2);
// Row 0: water, plains, hills, impassable. Row 1: plains everywhere.
const kinds = Uint8Array.from([
  TileKind.Water,
  TileKind.Plains,
  TileKind.Hills,
  TileKind.Impassable,
  ...Array<number>(4).fill(TileKind.Plains),
]);

function newGame(spawnPhaseTicks: number): { game: Game; ada: Player } {
  const game = new Game({
    terrain: new Terrain(grid, kinds),
    seed: 1,
    players: [{ id: 1, name: "Ada" }],
    balance: { ...DEFAULT_BALANCE, spawnPhaseTicks },
  });
  const ada = game.player(1);
  if (!ada) throw new Error("player missing");
  return { game, ada };
}

describe("orderError", () => {
  it("accepts a spawn on ownable land during the spawn phase", () => {
    const { game, ada } = newGame(10);
    expect(orderError(game, ada, { type: "spawn", tile: 1 })).toBeUndefined();
    expect(orderError(game, ada, { type: "spawn", tile: 2 })).toBeUndefined();
  });

  it.each<[string, Order]>([
    ["the tile is outside the map", { type: "spawn", tile: -1 }],
    ["the tile is outside the map", { type: "spawn", tile: 8 }],
    ["the tile is outside the map", { type: "spawn", tile: 1.5 }],
    ["the tile cannot be owned", { type: "spawn", tile: 0 }],
    ["the tile cannot be owned", { type: "spawn", tile: 3 }],
    ["attacks start after the spawn phase", { type: "attack", target: 5, troops: 1 }],
    ["attacks start after the spawn phase", { type: "retreat", attack: 1 }],
  ])("refuses during the spawn phase: %s", (reason, order) => {
    const { game, ada } = newGame(10);
    expect(orderError(game, ada, order)).toBe(reason);
  });

  it("refuses spawning once the game is under way (R-SPAWN-01)", () => {
    const { game, ada } = newGame(0);
    expect(orderError(game, ada, { type: "spawn", tile: 1 })).toBe("the spawn phase is over");
  });

  it("checks the troops and the target of an attack", () => {
    const { game, ada } = newGame(0);
    ada.troops = 100;
    game.territory.setOwner(4, 1);
    const attack = (target: number, troops: number): Order => ({ type: "attack", target, troops });

    expect(orderError(game, ada, attack(5, 100))).toBeUndefined();
    expect(orderError(game, ada, attack(5, 101))).toBe("not enough troops");
    expect(orderError(game, ada, attack(5, 0))).toBe("invalid troop count");
    expect(orderError(game, ada, attack(5, 2.5))).toBe("invalid troop count");
    expect(orderError(game, ada, attack(4, 10))).toBe("the target is already owned");
    expect(orderError(game, ada, attack(0, 10))).toBe("the tile cannot be owned");
    expect(orderError(game, ada, attack(9, 10))).toBe("the tile is outside the map");
  });

  it("checks the attack named by a retreat", () => {
    const { game, ada } = newGame(0);
    // No attack 3 of hers is under way.
    expect(orderError(game, ada, { type: "retreat", attack: 3 })).toBe(AttackError.Retreat);
    expect(orderError(game, ada, { type: "retreat", attack: 0 })).toBe("invalid attack id");
    expect(orderError(game, ada, { type: "retreat", attack: 1.5 })).toBe("invalid attack id");
  });
});
