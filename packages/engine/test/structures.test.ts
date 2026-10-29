import { describe, expect, it } from "vitest";
import { captureCost, defenderLoss } from "../src/attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { createGame } from "../src/create-game.ts";
import { Disable, type Order, type Player } from "../src/game.ts";
import { orderError } from "../src/orders.ts";
import {
  StructureKind,
  cityLimit,
  cityShare,
  disableBit,
  fortRadius,
  fortified,
  structureCost,
  workingCities,
} from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  // Gold counts below leave out the income every player earns (B-GOLD-BASE).
  goldBase: 0,
  // Troops set by hand above the cap stay put (B-DESERTION).
  desertionBasisPoints: 0,
  spawnPhaseTicks: 0,
  buildTicks: 5,
  cityCost: 1000,
  fortCost: 400,
  costGrowthPercent: 150,
  buildSpacing: 4,
  cityLand: 200,
  fortRadius: 5,
  fortStrengthPercent: 200,
  fortLossPercent: 50,
  // No income, so gold only moves with orders.
  goldPerThousandTroops: 0,
};

/** Ada holds the west half of a 40 × 20 plain, Bea the east half. */
function newGame(overrides: Partial<Balance> = {}) {
  const grid = new WorldGrid(40, 20, { wrapsX: false });
  const game = createGame({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 1,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...balance, ...overrides },
  });
  for (let tile = 0; tile < grid.size; tile++) {
    game.territory.setOwner(tile, grid.x(tile) < 20 ? 1 : 2);
  }
  const ada = game.player(1) as Player;
  const bea = game.player(2) as Player;
  ada.gold = 100_000;
  bea.gold = 100_000;
  // Troops at the cap, so growth leaves the numbers below alone.
  ada.troops = 1_000_000;
  bea.troops = 1_000_000;
  const step = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) step();
  };
  const build = (player: number, structure: StructureKind, x: number, y: number) =>
    step([{ player, order: { type: "build", structure, tile: grid.index(x, y) } }]);
  return { game, grid, ada, bea, step, run, build };
}

describe("structures", () => {
  it("takes the gold at once and works after B-BUILD-TIME (R-BUILD)", () => {
    const { game, ada, build, run } = newGame();
    expect(build(1, StructureKind.City, 5, 5)).toBe(1);
    expect(ada.gold).toBe(99_000);
    expect(game.structures).toHaveLength(1);
    expect(workingCities(game, ada)).toBe(0);
    run(3);
    expect(workingCities(game, ada)).toBe(0);
    run(1);
    expect(workingCities(game, ada)).toBe(1);
  });

  it("raises the cost of each structure of a kind by B-COST-GROWTH (R-BUILD)", () => {
    const { game, ada, build } = newGame();
    expect(structureCost(game, 1, StructureKind.City)).toBe(1000);
    build(1, StructureKind.City, 2, 2);
    expect(structureCost(game, 1, StructureKind.City)).toBe(1500);
    build(1, StructureKind.City, 8, 2);
    expect(structureCost(game, 1, StructureKind.City)).toBe(2250);
    // Forts count apart, and so does every other player.
    expect(structureCost(game, 1, StructureKind.Fort)).toBe(400);
    expect(structureCost(game, 2, StructureKind.City)).toBe(1000);
    expect(ada.gold).toBe(100_000 - 1000 - 1500);
  });

  it("builds only on the player's own land (R-BUILD)", () => {
    const { game, grid, ada } = newGame();
    const order: Order = { type: "build", structure: StructureKind.Fort, tile: grid.index(30, 5) };
    expect(orderError(game, ada, order)).toBe("the tile is not yours");
  });

  it("keeps B-BUILD-SPACING between any two structures (R-BUILD-07)", () => {
    const { game, grid, bea, build } = newGame();
    build(1, StructureKind.Fort, 18, 5);
    const near = (x: number): Order => ({
      type: "build",
      structure: StructureKind.City,
      tile: grid.index(x, 5),
    });
    expect(orderError(game, bea, near(21))).toBe("too close to another structure");
    expect(orderError(game, bea, near(22))).toBeUndefined();
  });

  it("allows one city, and one more for every B-CITY-LAND tiles (R-BUILD-07)", () => {
    const { game, grid, ada, build } = newGame();
    // 400 tiles of land: three cities.
    expect(cityLimit(game, 1)).toBe(3);
    build(1, StructureKind.City, 2, 2);
    build(1, StructureKind.City, 8, 2);
    build(1, StructureKind.City, 14, 2);
    const fourth: Order = { type: "build", structure: StructureKind.City, tile: grid.index(2, 10) };
    expect(orderError(game, ada, fourth)).toBe("not enough land for another city");
    // Forts are not limited by land.
    const fort: Order = { type: "build", structure: StructureKind.Fort, tile: grid.index(2, 10) };
    expect(orderError(game, ada, fort)).toBeUndefined();
  });

  it("counts only the cities a player's land supports once land is lost (R-BUILD-07)", () => {
    const { game, grid, ada, build, run } = newGame();
    build(1, StructureKind.City, 2, 2);
    build(1, StructureKind.City, 8, 2);
    build(1, StructureKind.City, 14, 2);
    run(5);
    expect(workingCities(game, ada)).toBe(3);
    // Down to 300 tiles: two cities' worth.
    for (let y = 10; y < 20; y++)
      for (let x = 10; x < 20; x++) game.territory.setOwner(grid.index(x, y), 2);
    expect(workingCities(game, ada)).toBe(2);
  });

  it("prices a palace as the next two cities, and counts it as two after (R-BUILD-08)", () => {
    const { game, ada, build } = newGame();
    build(1, StructureKind.City, 2, 2);
    // The second and third cities: 1500 + 2250.
    expect(structureCost(game, 1, StructureKind.Palace)).toBe(3750);
    build(1, StructureKind.Palace, 8, 2);
    expect(ada.gold).toBe(100_000 - 1000 - 3750);
    expect(cityShare(game, 1)).toBe(3);
    // The next city is the fourth.
    expect(structureCost(game, 1, StructureKind.City)).toBe(3375);
    expect(structureCost(game, 1, StructureKind.Palace)).toBe(3375 + 5062);
    expect(structureCost(game, 2, StructureKind.Palace)).toBe(2500);
  });

  it("raises the population cap as two cities once ready (R-BUILD-08)", () => {
    const { game, ada, build, run } = newGame();
    build(1, StructureKind.Palace, 5, 5);
    expect(workingCities(game, ada)).toBe(0);
    run(4);
    expect(workingCities(game, ada)).toBe(2);
  });

  it("needs land for two cities, and counts within the land's cities when land is lost (R-BUILD-08)", () => {
    const { game, grid, ada, build, run } = newGame();
    // 400 tiles: three cities' worth.
    build(1, StructureKind.City, 2, 2);
    build(1, StructureKind.Palace, 8, 2);
    const order = (structure: StructureKind): Order => ({
      type: "build",
      structure,
      tile: grid.index(2, 10),
    });
    expect(orderError(game, ada, order(StructureKind.City))).toBe(
      "not enough land for another city",
    );
    expect(orderError(game, ada, order(StructureKind.Palace))).toBe(
      "not enough land for another city",
    );
    run(5);
    expect(workingCities(game, ada)).toBe(3);
    // Down to 300 tiles: two cities' worth.
    for (let y = 10; y < 20; y++)
      for (let x = 10; x < 20; x++) game.territory.setOwner(grid.index(x, y), 2);
    expect(workingCities(game, ada)).toBe(2);
  });

  it("refuses a palace with only one more city's land (R-BUILD-08)", () => {
    const { game, grid, ada, build } = newGame();
    build(1, StructureKind.City, 2, 2);
    build(1, StructureKind.City, 8, 2);
    const palace: Order = {
      type: "build",
      structure: StructureKind.Palace,
      tile: grid.index(2, 10),
    };
    expect(orderError(game, ada, palace)).toBe("not enough land for another city");
  });

  it("changes hands with its tile, and goes with the cities in a private game (R-BUILD-08)", () => {
    const { game, grid, ada, bea, build, run } = newGame();
    build(1, StructureKind.Palace, 18, 5);
    run(5);
    game.territory.setOwner(grid.index(18, 5), 2);
    run(1);
    expect(workingCities(game, ada)).toBe(0);
    expect(workingCities(game, bea)).toBe(2);
    const off = newGame();
    const noCities = createGame({
      terrain: off.game.terrain,
      seed: 1,
      players: [{ id: 1, name: "Ada" }],
      balance,
      disabled: Disable.City,
    });
    for (let tile = 0; tile < off.grid.size; tile++) noCities.territory.setOwner(tile, 1);
    const solo = noCities.player(1) as Player;
    solo.gold = 100_000;
    const palace: Order = { type: "build", structure: StructureKind.Palace, tile: 5 };
    expect(orderError(noCities, solo, palace)).toBe("left out of this game");
    // Its bit is the cities', not the code's own, which leaves out warships.
    expect(disableBit(StructureKind.Palace)).toBe(Disable.City);
    const noWarships = createGame({
      terrain: off.game.terrain,
      seed: 1,
      players: [{ id: 1, name: "Ada" }],
      balance,
      disabled: Disable.Warships,
    });
    for (let tile = 0; tile < off.grid.size; tile++) noWarships.territory.setOwner(tile, 1);
    (noWarships.player(1) as Player).gold = 100_000;
    expect(orderError(noWarships, noWarships.player(1) as Player, palace)).toBeUndefined();
  });

  it("refuses without enough gold, an unknown structure, or during the spawn phase", () => {
    const { game, grid, ada } = newGame();
    const tile = grid.index(5, 5);
    ada.gold = 999;
    expect(orderError(game, ada, { type: "build", structure: StructureKind.City, tile })).toBe(
      "not enough gold",
    );
    expect(orderError(game, ada, { type: "build", structure: 7, tile })).toBe("unknown structure");
    expect(orderError(game, ada, { type: "build", structure: 0.5, tile })).toBe(
      "unknown structure",
    );
    const early = newGame({ spawnPhaseTicks: 10 });
    expect(
      orderError(early.game, early.ada, { type: "build", structure: StructureKind.City, tile }),
    ).toBe("building starts after the spawn phase");
  });

  it("makes tiles near a ready fort dearer to take and cheaper to lose (R-BUILD-03)", () => {
    const { game, grid, ada, build, run } = newGame();
    const inside = grid.index(14, 5);
    const outside = grid.index(14, 15);
    const plain = captureCost(game, inside, ada);
    const loss = defenderLoss(game, inside, ada);
    build(1, StructureKind.Fort, 18, 5);
    // Not before it is ready.
    expect(captureCost(game, inside, ada)).toBe(plain);
    run(5);
    expect(fortRadius(game)).toBe(5);
    expect(fortified(game, inside, 1)).toBe(true);
    expect(captureCost(game, inside, ada)).toBe(plain * 2);
    expect(defenderLoss(game, inside, ada)).toBe(Math.floor(loss / 2));
    expect(captureCost(game, outside, ada)).toBe(plain);
    expect(defenderLoss(game, outside, ada)).toBe(loss);
    // A fort only helps its owner: Bea's tiles in its radius are not covered.
    expect(fortified(game, grid.index(21, 5), 2)).toBe(false);
  });

  it("covers its new owner's land once captured, and stops at once for the old one (R-BUILD-03)", () => {
    const { game, grid, build, run } = newGame();
    build(1, StructureKind.Fort, 18, 5);
    run(5);
    game.territory.setOwner(grid.index(18, 5), 2);
    expect(fortified(game, grid.index(17, 5), 1)).toBe(false);
    run(1);
    expect(fortified(game, grid.index(18, 5), 2)).toBe(true);
    expect(fortified(game, grid.index(21, 5), 2)).toBe(true);
  });

  it("refuses a build on water or off the map", () => {
    const grid = new WorldGrid(4, 1, { wrapsX: false });
    const kinds = Uint8Array.from([
      TileKind.Plains,
      TileKind.Water,
      TileKind.Plains,
      TileKind.Plains,
    ]);
    const game = createGame({
      terrain: new Terrain(grid, kinds),
      seed: 1,
      players: [{ id: 1, name: "Ada" }],
      balance,
    });
    const ada = game.player(1) as Player;
    ada.gold = 100_000;
    const build = (tile: number): Order => ({ type: "build", structure: StructureKind.City, tile });
    expect(orderError(game, ada, build(1))).toBe("the tile cannot be owned");
    expect(orderError(game, ada, build(4))).toBe("the tile is outside the map");
  });

  it("changes hands with its tile, even while being built (R-BUILD)", () => {
    const { game, grid, ada, bea, build, run } = newGame();
    build(1, StructureKind.City, 18, 5);
    game.territory.setOwner(grid.index(18, 5), 2);
    run(1);
    expect(game.structures[0]?.player).toBe(2);
    run(5);
    expect(workingCities(game, bea)).toBe(1);
    expect(workingCities(game, ada)).toBe(0);
  });

  it("is demolished by its owner only, with no refund (R-BUILD-06)", () => {
    const { game, grid, ada, bea, build, step } = newGame();
    build(1, StructureKind.Fort, 5, 5);
    const demolish: Order = { type: "demolish", tile: grid.index(5, 5) };
    expect(orderError(game, bea, demolish)).toBe("no structure of yours on the tile");
    expect(orderError(game, ada, { type: "demolish", tile: grid.index(6, 5) })).toBe(
      "no structure of yours on the tile",
    );
    const gold = ada.gold;
    expect(step([{ player: 1, order: demolish }])).toBe(1);
    expect(game.structures).toHaveLength(0);
    expect(ada.gold).toBeGreaterThanOrEqual(gold);
    // The next fort costs the base again.
    expect(structureCost(game, 1, StructureKind.Fort)).toBe(400);
  });

  it("is part of the state hash", () => {
    const a = newGame();
    const b = newGame();
    a.build(1, StructureKind.City, 5, 5);
    b.step();
    b.ada.gold = a.ada.gold;
    expect(a.game.hash()).not.toBe(b.game.hash());
  });
});
