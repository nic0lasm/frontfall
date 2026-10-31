import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { createGame } from "../src/create-game.ts";
import type { Order, Player } from "../src/game.ts";
import { orderError } from "../src/orders.ts";
import { StructureKind, structureCost } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { tradeGold, tradeRange } from "../src/trade.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  // Gold counts below leave out the income every player earns (B-GOLD-BASE).
  goldBase: 0,
  spawnPhaseTicks: 0,
  buildTicks: 5,
  cityCost: 1000,
  fortCost: 400,
  portCost: 2000,
  costGrowthPercent: 150,
  buildSpacing: 4,
  goldPerThousandTroops: 0,
};

/**
 * A 40 × 20 map: Ada's land west of x = 10, Bea's east of x = 30, and the sea
 * between them; a lake of one tile sits inside Ada's land at (3, 3).
 */
function newGame(overrides: Partial<Balance> = {}) {
  const grid = new WorldGrid(40, 20, { wrapsX: false });
  const kinds = new Uint8Array(grid.size).fill(TileKind.Plains);
  for (let tile = 0; tile < grid.size; tile++) {
    const x = grid.x(tile);
    if (x >= 10 && x < 30) kinds[tile] = TileKind.Water;
  }
  kinds[grid.index(3, 3)] = TileKind.Water;
  const game = createGame({
    terrain: new Terrain(grid, kinds),
    seed: 1,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...balance, ...overrides },
  });
  for (let tile = 0; tile < grid.size; tile++) {
    if (!game.terrain.isOwnable(tile)) continue;
    game.territory.setOwner(tile, grid.x(tile) < 10 ? 1 : 2);
  }
  const ada = game.player(1) as Player;
  const bea = game.player(2) as Player;
  for (const player of [ada, bea]) {
    player.gold = 100_000;
    player.troops = 1_000_000;
  }
  const step = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) step();
  };
  const port = (x: number, y: number): Order => ({
    type: "build",
    structure: StructureKind.Port,
    tile: grid.index(x, y),
  });
  return { game, grid, ada, bea, step, run, port };
}

describe("ports", () => {
  it("go on a coastal tile of the player's own land (R-BUILD-02)", () => {
    const { game, ada, port } = newGame();
    expect(orderError(game, ada, port(5, 10))).toBe("a port needs a coast");
    expect(orderError(game, ada, port(9, 10))).toBeUndefined();
    // A lake shore is a coast too.
    expect(orderError(game, ada, port(3, 4))).toBeUndefined();
    expect(orderError(game, ada, port(30, 10))).toBe("the tile is not yours");
  });

  it("cost B-COST-PORT, then B-COST-GROWTH more for each port owned (R-BUILD-02)", () => {
    const { game, ada, step, port } = newGame();
    expect(structureCost(game, 1, StructureKind.Port)).toBe(2000);
    expect(step([{ player: 1, order: port(9, 2) }])).toBe(1);
    expect(ada.gold).toBe(98_000);
    expect(structureCost(game, 1, StructureKind.Port)).toBe(3000);
    expect(structureCost(game, 1, StructureKind.City)).toBe(1000);
  });
});

describe("trade", () => {
  /** Ada's port at (9, 10), Bea's at (30, 10): 20 water tiles apart, ready on tick 6. */
  function trading(overrides: Partial<Balance> = {}) {
    // Every roll succeeds, so a ship leaves at each interval.
    const setup = newGame({ tradeIntervalTicks: 10, tradeOdds: 1, ...overrides });
    setup.step([
      { player: 1, order: setup.port(9, 10) },
      { player: 2, order: setup.port(30, 10) },
    ]);
    setup.ada.gold = 0;
    setup.bea.gold = 0;
    return setup;
  }

  it("sends a ship every B-TRADE-INTERVAL to another player's port, and pays both sides (R-UNIT-03)", () => {
    const { game, ada, bea, run } = trading();
    run(5 + 10);
    expect(game.tradeShips.map((ship) => ship.player)).toEqual([1, 2]);
    expect(game.tradeShips[0]?.path.length).toBe(20);
    // 20 tiles at B-BOAT-SPEED 2: ten ticks at sea.
    run(9);
    expect(ada.gold).toBe(0);
    run(1);
    // Both ships arrive: each side is paid for its own and for the other's, 1016 each for 20 tiles.
    expect(tradeGold(20)).toBe(1016);
    expect(ada.gold).toBe(2 * 1016);
    expect(bea.gold).toBe(2 * 1016);
  });

  it("tells the interface what each side was paid, at the dock (R-UNIT-03)", () => {
    const { game, grid, run } = trading();
    run(5 + 10 + 10);
    const trades = game.diplomacyEvents.filter((event) => event.type === "trade");
    // Two ships arrive and each pays both sides: four events, one gain each.
    expect(trades).toHaveLength(4);
    for (const event of trades) expect(event.gold).toBe(1016);
    expect(trades.filter((event) => event.a === 1)).toHaveLength(2);
    const docks = new Set(trades.map((event) => event.tile));
    expect(docks).toEqual(new Set([grid.index(9, 10), grid.index(30, 10)]));
  });

  it("keeps at most B-TRADE-MAX ships of one port at sea", () => {
    const { game, run } = trading({ tradeIntervalTicks: 2, tradeMax: 2 });
    run(5 + 8);
    expect(game.tradeShips.filter((ship) => ship.player === 1)).toHaveLength(2);
  });

  it("never trades between two ports of one player", () => {
    const { game, step, run, port } = newGame({ tradeIntervalTicks: 10 });
    step([
      { player: 1, order: port(9, 2) },
      { player: 1, order: port(9, 16) },
    ]);
    run(40);
    expect(game.tradeShips).toHaveLength(0);
  });

  it("stops under an embargo of either side, and loses ships already at sea (R-DIPLO-05)", () => {
    const { game, ada, bea, step, run } = trading();
    run(5 + 10);
    expect(game.tradeShips).toHaveLength(2);
    step([{ player: 2, order: { type: "embargo", target: 1, on: 1 } }]);
    expect(game.diplomacyEvents.at(-1)).toMatchObject({ type: "embargo", a: 2, b: 1 });
    run(30);
    expect(game.tradeShips).toHaveLength(0);
    expect(ada.gold + bea.gold).toBe(0);
    step([{ player: 2, order: { type: "embargo", target: 1, on: 0 } }]);
    expect(game.diplomacyEvents.at(-1)).toMatchObject({ type: "lifted", a: 2, b: 1 });
    run(20);
    expect(ada.gold).toBeGreaterThan(0);
  });

  it("refuses an embargo on oneself, twice on the same player, or lifting one that is not there", () => {
    const { game, ada, step } = trading();
    expect(orderError(game, ada, { type: "embargo", target: 1, on: 1 })).toBe(
      "a player cannot ally with themselves",
    );
    expect(orderError(game, ada, { type: "embargo", target: 2, on: 0 })).toBe(
      "not under your embargo",
    );
    step([{ player: 1, order: { type: "embargo", target: 2, on: 1 } }]);
    expect(orderError(game, ada, { type: "embargo", target: 2, on: 1 })).toBe(
      "already under your embargo",
    );
    expect(orderError(game, ada, { type: "embargo", target: 9, on: 1 })).toBe(
      "no such player in the game",
    );
  });

  it("pays nothing for a ship whose port of arrival is gone", () => {
    const { game, grid, ada, bea, step, run } = trading();
    run(5 + 10);
    step([{ player: 2, order: { type: "demolish", tile: grid.index(30, 10) } }]);
    run(10);
    // Bea's ship still reaches Ada's port and pays both; Ada's finds no port.
    expect(ada.gold).toBe(1016);
    expect(bea.gold).toBe(1016);
    run(20);
    expect(game.tradeShips).toHaveLength(0);
    expect(ada.gold).toBe(1016);
  });

  it("sinks a fallen player's ships", () => {
    const { game, grid, bea, run } = trading();
    run(5 + 10);
    for (let tile = 0; tile < grid.size; tile++) {
      if (game.territory.ownerOf(tile) === 1) game.territory.setOwner(tile, 2);
    }
    // Eliminated at the end of this tick, after trade: the ship sinks on the next.
    run(2);
    expect(game.player(1)?.alive).toBe(false);
    expect(game.tradeShips.map((ship) => ship.player)).toEqual([2]);
    // Bea's ship sails on to the port that is now her own, which pays nothing.
    run(10);
    expect(bea.gold).toBe(0);
  });

  it("puts trade ships and embargoes in the state hash", () => {
    const a = trading();
    const b = trading();
    a.run(15);
    b.run(15);
    expect(a.game.hash()).toBe(b.game.hash());
    a.step([{ player: 1, order: { type: "embargo", target: 2, on: 1 } }]);
    b.step();
    expect(a.game.hash()).not.toBe(b.game.hash());
  });
  it("reaches farther on larger maps, like the spawn radius (B-TRADE-RANGE)", () => {
    const range = (width: number, height: number) =>
      tradeRange(
        createGame({
          terrain: new Terrain(new WorldGrid(width, height), new Uint8Array(width * height)),
          seed: 1,
          players: [],
        }),
      );
    expect(range(256, 128)).toBe(DEFAULT_BALANCE.tradeRange);
    expect(range(1024, 512)).toBe(DEFAULT_BALANCE.tradeRange);
    expect(range(2048, 1024)).toBe(2 * DEFAULT_BALANCE.tradeRange);
  });
});
