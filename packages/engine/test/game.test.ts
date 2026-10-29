import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import { Game, type GameSetup, type Order } from "../src/game.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

const grid = new WorldGrid(8, 4);

function setup(overrides: Partial<GameSetup> = {}): GameSetup {
  return {
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 7,
    players: [
      { id: 2, name: "Bea" },
      { id: 1, name: "Ada" },
    ],
    ...overrides,
  };
}

const spawn = (tile: number): Order => ({ type: "spawn", tile });

describe("Terrain", () => {
  it("tells ownable land from water and impassable terrain (R-MAP-01, R-MAP-02)", () => {
    const kinds = Uint8Array.from([0, 1, 2, 3, 4, 1, 1, 1]);
    const terrain = new Terrain(new WorldGrid(8, 1), kinds);
    expect([0, 1, 2, 3, 4].map((tile) => terrain.isOwnable(tile))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(terrain.kind(3)).toBe(TileKind.Mountains);
  });

  it("rejects a terrain that does not fit its map or has unknown kinds", () => {
    expect(() => new Terrain(grid, new Uint8Array(3))).toThrow(RangeError);
    expect(() => new Terrain(new WorldGrid(2, 1), Uint8Array.from([1, 9]))).toThrow(RangeError);
  });
});

describe("Game", () => {
  it("starts at tick zero, with every player alive and empty-handed", () => {
    const game = new Game(setup());
    expect(game.tick).toBe(0);
    expect(game.players().map((p) => [p.id, p.name, p.troops, p.gold, p.alive])).toEqual([
      [1, "Ada", 0, 0, true],
      [2, "Bea", 0, 0, true],
    ]);
    expect(game.player(3)).toBeUndefined();
    expect(game.territory.tileCount(0)).toBe(grid.size);
  });

  it("rejects balance values the rules cannot run with", () => {
    const withBalance = (change: Partial<typeof DEFAULT_BALANCE>) =>
      setup({ balance: { ...DEFAULT_BALANCE, ...change } });
    expect(() => new Game(withBalance({ attackSpeedDivisor: 0 }))).toThrow(/attackSpeedDivisor/);
    expect(() => new Game(withBalance({ encircleMaxTiles: 1.5 }))).toThrow(/encircleMaxTiles/);
    expect(() => new Game(withBalance({ boatRange: 70_000 }))).toThrow(/boatRange/);
    expect(() => new Game(withBalance({ buildSpacing: 0 }))).toThrow(/buildSpacing/);
    expect(() => new Game(withBalance({ cityCost: -1 }))).toThrow(/cityCost/);
    expect(() => new Game(withBalance({ costGrowthPercent: 90 }))).toThrow(/costGrowthPercent/);
    expect(() => new Game(withBalance({ cityLand: -1 }))).toThrow(/cityLand/);
    expect(() => new Game(withBalance({ boatSpeed: 3 }))).not.toThrow();
  });

  it("rejects invalid or duplicate player ids", () => {
    expect(() => new Game(setup({ players: [{ id: 0, name: "N" }] }))).toThrow(RangeError);
    expect(() => new Game(setup({ players: [{ id: 1.5, name: "N" }] }))).toThrow(RangeError);
    const twice = [
      { id: 1, name: "A" },
      { id: 1, name: "B" },
    ];
    expect(() => new Game(setup({ players: twice }))).toThrow(RangeError);
  });

  it("runs turns in sequence only", () => {
    const game = new Game(setup());
    game.step({ tick: 0, orders: [] });
    expect(game.tick).toBe(1);
    expect(() => game.step({ tick: 0, orders: [] })).toThrow(RangeError);
    expect(() => game.step({ tick: 2, orders: [] })).toThrow(RangeError);
  });

  it("applies orders in turn order, then runs systems in registration order (R-FAIR-03)", () => {
    const game = new Game(setup());
    const log: string[] = [];
    game.onOrder((_, player, order) => {
      log.push(`order ${String(player.id)} ${order.type}`);
      return player.id === 2;
    });
    game.onTick(() => log.push("growth"));
    game.onTick((g) => log.push(`attacks at ${String(g.tick)}`));

    const applied = game.step({
      tick: 0,
      orders: [
        { player: 2, order: spawn(3) },
        { player: 1, order: spawn(4) },
        { player: 9, order: spawn(5) },
      ],
    });

    expect(applied).toBe(1);
    expect(log).toEqual(["order 2 spawn", "order 1 spawn", "growth", "attacks at 0"]);
  });

  it("asks handlers in turn until one accepts, and ignores eliminated players", () => {
    const game = new Game(setup());
    const asked: string[] = [];
    game.onOrder(() => {
      asked.push("first");
      return false;
    });
    game.onOrder(() => {
      asked.push("second");
      return true;
    });
    game.onOrder(() => {
      asked.push("third");
      return true;
    });
    const bea = game.player(2);
    if (bea) bea.alive = false;

    expect(
      game.step({
        tick: 0,
        orders: [
          { player: 1, order: spawn(1) },
          { player: 2, order: spawn(2) },
        ],
      }),
    ).toBe(1);
    expect(asked).toEqual(["first", "second"]);
  });

  it("never hands an invalid order to a handler", () => {
    const game = new Game(setup());
    const seen: Order[] = [];
    game.onOrder((_, __, order) => {
      seen.push(order);
      return true;
    });
    const applied = game.step({
      tick: 0,
      orders: [
        { player: 1, order: spawn(grid.size) },
        { player: 1, order: spawn(2) },
      ],
    });
    expect(applied).toBe(1);
    expect(seen).toEqual([spawn(2)]);
  });

  it("holds the spawn phase for its configured length (R-SPAWN-01)", () => {
    const game = new Game(setup({ balance: { ...DEFAULT_BALANCE, spawnPhaseTicks: 2 } }));
    const phases = [];
    for (let tick = 0; tick < 3; tick++) {
      phases.push(game.phase);
      game.step({ tick, orders: [] });
    }
    expect(phases).toEqual(["spawn", "spawn", "play"]);
  });

  it("draws the same random numbers from the same seed", () => {
    const draws = (seed: number) => {
      const game = new Game(setup({ seed }));
      return [1, 2, 3].map(() => game.random.nextInt(0, 1000));
    };
    expect(draws(7)).toEqual(draws(7));
    expect(draws(7)).not.toEqual(draws(8));
  });
});

describe("Game.apply", () => {
  it("carries out a valid order of a living player outside any turn (R-BOT-03)", () => {
    const game = new Game(setup());
    game.onOrder(() => true);
    expect(game.apply(1, spawn(3))).toBe(true);
    expect(game.apply(1, spawn(-1))).toBe(false);
    expect(game.apply(9, spawn(3))).toBe(false);
    expect(game.tick).toBe(0);
  });
});
