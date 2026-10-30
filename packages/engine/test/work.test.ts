import { describe, expect, it } from "vitest";
import { captureCost, installAttacks } from "../src/attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { installEconomy, soldiers, workers } from "../src/economy.ts";
import { Game, type Order, type Player } from "../src/game.ts";
import { GiftError, giftError } from "../src/gifts.ts";
import { orderError } from "../src/orders.ts";
import { loadSnapshot, saveSnapshot } from "../src/snapshot.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";
import { WHOLE_PRICES } from "./whole-prices.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  // Gold counts below leave out the income every player earns (B-GOLD-BASE).
  goldBase: 0,
  // Troops set by hand above the cap stay put (B-DESERTION).
  desertionBasisPoints: 0,
  spawnPhaseTicks: 0,
  // No population cap: troops stay where the tests put them.
  popBase: 0,
  popLand: 0,
  popPerCity: 0,
  startTroops: 0,
  goldPerThousandTroops: 5,
  workMaxPercent: 80,
  ...WHOLE_PRICES,
  tileWeightTenths: [100, 100, 100],
};

/** Ada holds the left half of a 10 x 2 strip, Bea the right half. */
function newGame(overrides: Partial<Balance> = {}) {
  const grid = new WorldGrid(10, 2, { wrapsX: false });
  const setup = {
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 1,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...balance, ...overrides },
  };
  const create = () => {
    const game = new Game(setup);
    installEconomy(game);
    installAttacks(game);
    return game;
  };
  const game = create();
  for (let tile = 0; tile < grid.size; tile++) {
    game.territory.setOwner(tile, grid.x(tile) < 5 ? 1 : 2);
  }
  const ada = game.player(1) as Player;
  const bea = game.player(2) as Player;
  const run = (ticks = 1, orders: { player: number; order: Order }[] = []) => {
    for (let i = 0; i < ticks; i++) {
      game.step({ tick: game.tick, orders: i === 0 ? orders : [] });
    }
  };
  const work = (share: number) => {
    run(1, [{ player: 1, order: { type: "work", share } }]);
  };
  return { grid, game, ada, bea, run, work, create };
}

describe("work share (R-ECO-07)", () => {
  it("starts at nothing and splits the troops at home once set", () => {
    const { ada, work } = newGame();
    ada.troops = 1000;
    expect([workers(ada), soldiers(ada)]).toEqual([0, 1000]);
    work(30);
    expect(ada.workShare).toBe(30);
    expect([workers(ada), soldiers(ada)]).toEqual([300, 700]);
  });

  it("refuses a share outside 0 to B-WORK-MAX", () => {
    const { game, ada } = newGame();
    for (const share of [-1, 81, 1.5, Number.NaN]) {
      expect(orderError(game, ada, { type: "work", share })).toBe("invalid work share");
    }
    expect(orderError(game, ada, { type: "work", share: 80 })).toBeUndefined();
    expect(orderError(game, ada, { type: "work", share: 0 })).toBeUndefined();
  });

  it("pays B-WORK-GOLD more of the base income for the share of the cap at work", () => {
    // A cap of 4000 that troops do not grow into.
    const paid = {
      goldBase: 1000,
      goldPerThousandTroops: 0,
      popBase: 4000,
      growthBase: 0,
      growthDivisor: Number.MAX_SAFE_INTEGER,
    };
    const idle = newGame(paid);
    const busy = newGame(paid);
    for (const { ada } of [idle, busy]) ada.troops = 1000;
    busy.work(50);
    idle.run();
    idle.run(9);
    busy.run(9);
    // 500 workers fill an eighth of the cap: 150 % of an eighth more than 1000 a second.
    expect(idle.ada.gold).toBe(1000);
    expect(busy.ada.gold).toBe(1187);
  });

  it("sends soldiers only, by land and by sea", () => {
    const { game, grid, ada, work } = newGame();
    ada.troops = 1000;
    work(60);
    const attack = (troops: number): Order => ({
      type: "attack",
      target: grid.index(5, 0),
      troops,
    });
    expect(orderError(game, ada, attack(401))).toBe("not enough troops");
    expect(orderError(game, ada, attack(400))).toBeUndefined();
    const embark: Order = { type: "embark", target: grid.index(5, 0), troops: 401 };
    expect(orderError(game, ada, embark)).toBe("not enough troops");
    expect(giftError(game, ada, 2, 401, 0)).toBe(GiftError.Troops);
  });

  it("leaves land cheaper to take when its troops work", () => {
    const { game, grid, bea, run } = newGame();
    bea.troops = 1000;
    const tile = grid.index(5, 0);
    // 1000 soldiers over 10 tiles: 100 a tile on top of the land's 10.
    expect(captureCost(game, tile, bea)).toBe(110);
    run(1, [{ player: 2, order: { type: "work", share: 80 } }]);
    expect(captureCost(game, tile, bea)).toBe(30);
  });

  it("keeps the share in a snapshot", () => {
    const { game, ada, work, create } = newGame();
    ada.troops = 1000;
    work(25);
    const loaded = loadSnapshot(saveSnapshot(game, "test"), "test", create);
    expect(loaded.ok && loaded.game.player(1)?.workShare).toBe(25);
  });
});
