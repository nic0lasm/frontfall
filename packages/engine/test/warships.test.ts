import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { installNations } from "../src/bots/index.ts";
import { createGame } from "../src/create-game.ts";
import { isAllied } from "../src/diplomacy.ts";
import type { Order, Player } from "../src/game.ts";
import { orderError } from "../src/orders.ts";
import { StructureKind } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { atWar, patrolRadius, warshipCost } from "../src/warships.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  // Gold counts below leave out the income every player earns (B-GOLD-BASE).
  goldBase: 0,
  spawnPhaseTicks: 0,
  buildTicks: 1,
  portCost: 1000,
  warshipCost: 10_000,
  warshipMax: 2,
  goldPerThousandTroops: 0,
  tradeIntervalTicks: 1000,
};

/**
 * A 60 × 30 map: Ada's land west of x = 10, Bea's east of x = 50, the sea
 * between them. Each has a port in the middle of their coast.
 */
function newGame(overrides: Partial<Balance> = {}) {
  const grid = new WorldGrid(60, 30, { wrapsX: false });
  const kinds = new Uint8Array(grid.size).fill(TileKind.Plains);
  for (let tile = 0; tile < grid.size; tile++) {
    const x = grid.x(tile);
    if (x >= 10 && x < 50) kinds[tile] = TileKind.Water;
  }
  const game = createGame({
    terrain: new Terrain(grid, kinds),
    seed: 3,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...balance, ...overrides },
  });
  for (let tile = 0; tile < grid.size; tile++) {
    if (game.terrain.isOwnable(tile)) game.territory.setOwner(tile, grid.x(tile) < 10 ? 1 : 2);
  }
  const ada = game.player(1) as Player;
  const bea = game.player(2) as Player;
  for (const player of [ada, bea]) {
    player.gold = 1_000_000;
    player.troops = 1_000_000;
  }
  const step = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) step();
  };
  const adaPort = grid.index(9, 15);
  const beaPort = grid.index(50, 15);
  step([
    { player: 1, order: { type: "build", structure: StructureKind.Port, tile: adaPort } },
    { player: 2, order: { type: "build", structure: StructureKind.Port, tile: beaPort } },
  ]);
  run(1);
  return { game, grid, ada, bea, step, run, adaPort, beaPort };
}

const buy = (port: number): Order => ({ type: "warship", port });

describe("warships (R-UNIT-04)", () => {
  it("are bought at the player's own ready port, B-COST-GROWTH dearer each, up to B-WARSHIP-MAX", () => {
    const { game, grid, ada, step, adaPort, beaPort } = newGame();
    expect(orderError(game, ada, buy(beaPort))).toBe("no ready port of yours on the tile");
    expect(orderError(game, ada, buy(grid.index(5, 5)))).toBe("no ready port of yours on the tile");
    const gold = ada.gold;
    expect(step([{ player: 1, order: buy(adaPort) }])).toBe(1);
    expect(ada.gold).toBe(gold - 10_000);
    const [ship] = game.warships;
    expect(ship).toMatchObject({ player: 1, health: 1000 });
    expect(game.terrain.kind(ship?.patrol ?? -1)).toBe(TileKind.Water);
    expect(warshipCost(game, 1)).toBe(15_000);
    step([{ player: 1, order: buy(adaPort) }]);
    expect(orderError(game, ada, buy(adaPort))).toBe("too many warships");
    ada.gold = 0;
    expect(orderError(game, ada, buy(adaPort))).toBe("too many warships");
  });

  it("patrol within the patrol radius of their patrol tile, and go where a patrol order sends them", () => {
    const { game, grid, step, run, adaPort } = newGame();
    step([{ player: 1, order: buy(adaPort) }]);
    const ship = game.warships[0];
    if (!ship) throw new Error("no ship");
    const radius = patrolRadius(game);
    for (let i = 0; i < 100; i++) {
      run(1);
      expect(game.terrain.kind(ship.tile)).toBe(TileKind.Water);
      expect(grid.distance(ship.tile, ship.patrol)).toBeLessThanOrEqual(radius);
    }
    const far = grid.index(45, 5);
    expect(
      orderError(game, game.player(1) as Player, {
        type: "patrol",
        ship: ship.id,
        tile: grid.index(5, 5),
      }),
    ).toBe("a warship patrols on water");
    step([{ player: 1, order: { type: "patrol", ship: ship.id, tile: far } }]);
    run(40);
    expect(ship.patrol).toBe(far);
    expect(grid.distance(ship.tile, far)).toBeLessThanOrEqual(radius);
  });

  it("sink a transport of a player at war with their owner, and leave everyone else alone", () => {
    const { game, grid, step, run, adaPort } = newGame({ warshipRange: 60 });
    step([{ player: 1, order: buy(adaPort) }]);
    expect(atWar(game, 1, 2)).toBe(false);
    // The landing makes Bea at war with Ada from the moment the ship sails.
    const troops = (game.player(2) as Player).troops;
    expect(
      step([{ player: 2, order: { type: "embark", target: grid.index(9, 3), troops: 5000 } }]),
    ).toBe(1);
    // In range as it leaves: sunk at once, with its troops.
    expect(atWar(game, 1, 2)).toBe(true);
    expect(game.boats).toHaveLength(0);
    expect((game.player(2) as Player).troops).toBeLessThan(troops);
    // Remembered for B-WAR-MEMORY.
    run(game.balance.warMemoryTicks - 5);
    expect(atWar(game, 1, 2)).toBe(true);
    run(10);
    expect(atWar(game, 1, 2)).toBe(false);
  });

  it("fight warships at war, B-WARSHIP-DAMAGE every B-WARSHIP-RELOAD, until one sinks", () => {
    const { game, step, run, adaPort, beaPort } = newGame({ warshipRange: 60 });
    step([
      { player: 1, order: buy(adaPort) },
      { player: 2, order: buy(beaPort) },
    ]);
    run(20);
    expect(game.warships.map((ship) => ship.health)).toEqual([1000, 1000]);
    step([{ player: 1, order: { type: "embargo", target: 2, on: 1 } }]);
    run(1);
    expect(game.warships.map((ship) => ship.health)).toEqual([750, 750]);
    run(game.balance.warshipReloadTicks * 3);
    // Both fire on the same ticks, the older first: on the fourth hit Bea's
    // sinks before it can fire back.
    expect(game.warships.map((ship) => [ship.player, ship.health])).toEqual([[1, 250]]);
  });

  it("take a trade ship under an embargo held for B-EMBARGO-NOTICE, with its gold, one a B-WARSHIP-RELOAD", () => {
    const { game, ada, step, run, adaPort } = newGame({
      warshipRange: 60,
      tradeIntervalTicks: 5,
      embargoNoticeTicks: 3,
      boatSpeed: 1,
    });
    step([{ player: 1, order: buy(adaPort) }]);
    run(10);
    const ships = game.tradeShips.filter((ship) => ship.player === 2);
    expect(ships.length).toBeGreaterThan(0);
    const gold = ada.gold;
    step([{ player: 1, order: { type: "embargo", target: 2, on: 1 } }]);
    run(2);
    expect(game.diplomacyEvents.some((e) => e.type === "captured")).toBe(false);
    run(2);
    expect(ada.gold).toBeGreaterThan(gold);
    run(3 * game.balance.warshipReloadTicks);
    // One ship a shot: B-WARSHIP-RELOAD apart.
    const ticks = game.diplomacyEvents.filter((e) => e.type === "captured").map((e) => e.tick);
    expect(ticks.length).toBeGreaterThan(1);
    for (let i = 1; i < ticks.length; i++) {
      expect((ticks[i] as number) - (ticks[i - 1] as number)).toBeGreaterThanOrEqual(
        game.balance.warshipReloadTicks,
      );
    }
  });

  it("leave an ally's trade ships alone, even under an embargo", () => {
    const { game, ada, step, run, adaPort } = newGame({
      warshipRange: 60,
      tradeIntervalTicks: 5,
      embargoNoticeTicks: 3,
      boatSpeed: 1,
    });
    step([
      { player: 1, order: buy(adaPort) },
      { player: 1, order: { type: "ally", target: 2 } },
      { player: 2, order: { type: "ally", target: 1 } },
    ]);
    expect(isAllied(game, 1, 2)).toBe(true);
    run(10);
    expect(game.tradeShips.some((ship) => ship.player === 2)).toBe(true);
    const gold = ada.gold;
    step([{ player: 1, order: { type: "embargo", target: 2, on: 1 } }]);
    run(5);
    expect(atWar(game, 1, 2)).toBe(false);
    expect(game.tradeShips.some((ship) => ship.player === 2)).toBe(true);
    expect(ada.gold).toBe(gold);
  });

  it("sink with their fallen owner, and count in the state hash", () => {
    const a = newGame();
    const b = newGame();
    a.step([{ player: 1, order: buy(a.adaPort) }]);
    b.step();
    expect(a.game.hash()).not.toBe(b.game.hash());
    for (let tile = 0; tile < a.grid.size; tile++) {
      if (a.game.territory.ownerOf(tile) === 1) a.game.territory.setOwner(tile, 2);
    }
    a.run(2);
    expect(a.game.player(1)?.alive).toBe(false);
    expect(a.game.warships).toHaveLength(0);
  });

  it("are bought by a nation while an enemy transport sails for its coast (R-BOT-11)", () => {
    const { game, grid, step, run } = newGame();
    installNations(game, [2], "normal");
    run(20);
    expect(game.warships).toHaveLength(0);
    step([{ player: 1, order: { type: "embark", target: grid.index(50, 3), troops: 5000 } }]);
    run(game.balance.ticksPerSecond * 5);
    expect(game.warships.map((ship) => ship.player)).toEqual([2]);
  });
});
