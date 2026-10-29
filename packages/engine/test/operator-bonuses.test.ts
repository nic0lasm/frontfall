import { describe, expect, it } from "vitest";
import { captureCost } from "../src/attacks.ts";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import { installEconomy, populationCap } from "../src/economy.ts";
import {
  Game,
  OPERATOR_FACTOR,
  OperatorBonus,
  type OperatorBonuses,
  type Player,
} from "../src/game.ts";
import { StructureKind, structureCost } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

function newGame(operator?: OperatorBonuses) {
  const grid = new WorldGrid(10, 10);
  const game = new Game({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 1,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...DEFAULT_BALANCE, spawnPhaseTicks: 0 },
    ...(operator === undefined ? {} : { operator }),
  });
  installEconomy(game);
  for (let tile = 0; tile < 10; tile++) game.territory.setOwner(tile, 1);
  for (let tile = 10; tile < 20; tile++) game.territory.setOwner(tile, 2);
  for (const id of [1, 2]) (game.player(id) as Player).troops = 500;
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) game.step({ tick: game.tick, orders: [] });
  };
  return { game, run };
}

const player = (game: Game, id: number) => game.player(id) as Player;

describe("operator's bonuses (R-MODE-09)", () => {
  it("doubles the gold of its player only", () => {
    const plain = newGame();
    const bonus = newGame({ player: 1, bonuses: OperatorBonus.Gold });
    // Troops alone: the same in both games, so only the income differs.
    for (const { game } of [plain, bonus]) player(game, 1).workShare = 0;
    plain.run(1);
    bonus.run(1);
    expect(player(plain.game, 1).gold).toBeGreaterThan(0);
    const doubled = OPERATOR_FACTOR * player(plain.game, 1).gold;
    expect(Math.abs(player(bonus.game, 1).gold - doubled)).toBeLessThanOrEqual(1);
    expect(player(bonus.game, 2).gold).toBe(player(plain.game, 2).gold);
  });

  it("doubles the population cap and the growth of its player", () => {
    const plain = newGame();
    const bonus = newGame({ player: 1, bonuses: OperatorBonus.Troops });
    const ada = player(bonus.game, 1);
    expect(populationCap(bonus.game, ada)).toBe(
      OPERATOR_FACTOR * populationCap(plain.game, player(plain.game, 1)),
    );
    expect(populationCap(bonus.game, player(bonus.game, 2))).toBe(
      populationCap(plain.game, player(plain.game, 2)),
    );
    plain.run(10);
    bonus.run(10);
    expect(ada.troops - 500).toBeGreaterThan(player(plain.game, 1).troops - 500);
    expect(player(bonus.game, 2).troops).toBe(player(plain.game, 2).troops);
  });

  it("halves the price of its player's structures", () => {
    const plain = newGame();
    const bonus = newGame({ player: 1, bonuses: OperatorBonus.Building });
    for (const kind of [StructureKind.City, StructureKind.Fort, StructureKind.Port]) {
      expect(structureCost(bonus.game, 1, kind)).toBe(
        Math.floor(structureCost(plain.game, 1, kind) / OPERATOR_FACTOR),
      );
      expect(structureCost(bonus.game, 2, kind)).toBe(structureCost(plain.game, 2, kind));
    }
  });

  it("doubles the price of its player's land, and of no one else's", () => {
    const plain = newGame();
    const bonus = newGame({ player: 1, bonuses: OperatorBonus.Defense });
    expect(captureCost(bonus.game, 5, player(bonus.game, 1), 2)).toBe(
      OPERATOR_FACTOR * captureCost(plain.game, 5, player(plain.game, 1), 2),
    );
    expect(captureCost(bonus.game, 15, player(bonus.game, 2), 1)).toBe(
      captureCost(plain.game, 15, player(plain.game, 2), 1),
    );
  });

  it("leaves the hash and setup digest of games without them as they were", () => {
    const none = newGame();
    const zero = newGame({ player: 1, bonuses: 0 });
    expect(zero.game.hash()).toBe(none.game.hash());
    expect(zero.game.setupDigest()).toBe(none.game.setupDigest());
    const bonus = newGame({ player: 1, bonuses: OperatorBonus.Gold });
    expect(bonus.game.hash()).not.toBe(none.game.hash());
    expect(bonus.game.setupDigest()).not.toBe(none.game.setupDigest());
    const more = newGame({ player: 1, bonuses: OperatorBonus.Gold | OperatorBonus.Troops });
    expect(more.game.hash()).not.toBe(bonus.game.hash());
  });

  it("refuses a player the game does not have, and unknown bonuses", () => {
    expect(() => newGame({ player: 3, bonuses: OperatorBonus.Gold })).toThrow(RangeError);
    expect(() => newGame({ player: 1, bonuses: 16 })).toThrow(RangeError);
  });
});
