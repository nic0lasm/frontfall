import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { installEconomy, populationCap } from "../src/economy.ts";
import { Game, type Player } from "../src/game.ts";
import { StructureKind } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  spawnPhaseTicks: 0,
  popPerTile: 100,
  popPerCityPercent: 10,
  growthBasisPoints: 1000,
  growthFloorPercent: 100,
  goldPerThousandTroops: 5,
  // No base population, so caps below are tiles and cities only.
  startTroops: 0,
};

function newGame(overrides: Partial<Balance> = {}) {
  const grid = new WorldGrid(10, 10);
  const game = new Game({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 1,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...balance, ...overrides },
  });
  installEconomy(game);
  const ada = game.player(1) as Player;
  const bea = game.player(2) as Player;
  for (let tile = 0; tile < 10; tile++) game.territory.setOwner(tile, 1);
  const run = (ticks = 1) => {
    for (let i = 0; i < ticks; i++) game.step({ tick: game.tick, orders: [] });
  };
  return { game, ada, bea, run };
}

describe("economy", () => {
  it("caps population by territory and cities (R-ECO-01, R-BUILD-01)", () => {
    const { game, ada } = newGame({ cityLand: 1 });
    expect(populationCap(game, ada)).toBe(1000);
    // Two working cities add 10 % each of what the land holds.
    for (const [id, tile] of [
      [1, 2],
      [2, 7],
    ] as const) {
      game.structures.push({
        id,
        player: 1,
        kind: StructureKind.City,
        tile,
        readyAt: 0,
        reloadAt: 0,
      });
    }
    expect(populationCap(game, ada)).toBe(1200);
  });

  it("adds the map's starting troops as a base, so a fresh start grows (R-ECO-01)", () => {
    const { game, ada } = newGame({ startTroops: 400 });
    expect(populationCap(game, ada)).toBe(1400);
  });

  it("counts land beyond B-POP-FALLOFF-SHARE for less (R-ECO-06)", () => {
    // 10 of 100 tiles is 10 % of the land: past 5 %, each tile holds a quarter.
    const { game, ada } = newGame({ popFalloffSharePercent: 5, popFalloffPercent: 25 });
    expect(populationCap(game, ada)).toBe(5 * 100 + 5 * 25);
    const within = newGame({ popFalloffSharePercent: 10, popFalloffPercent: 25 });
    expect(populationCap(within.game, within.ada)).toBe(1000);
    // Off by default.
    const off = newGame({ popFalloffSharePercent: 5, popFalloffPercent: 100 });
    expect(populationCap(off.game, off.ada)).toBe(1000);
  });

  it("grows troops fastest far from the cap and stops at it (R-ECO-02)", () => {
    const { ada, run } = newGame();
    // 10 % of the gap per second at 10 ticks per second: 1 % per tick.
    run();
    expect(ada.troops).toBe(10);
    ada.troops = 900;
    run();
    expect(ada.troops).toBe(901);
    ada.troops = 999;
    run();
    expect(ada.troops).toBe(1000);
    run(5);
    expect(ada.troops).toBe(1000);
  });

  it("grows a mid-sized army faster than an empty one under B-GROWTH-FLOOR (R-ECO-02)", () => {
    const { ada, run } = newGame({ growthFloorPercent: 20 });
    const gain = (troops: number) => {
      ada.troops = troops;
      run();
      return ada.troops - troops;
    };
    // Cap 1000, 1 % of the gap per tick, weighted from 20 % (empty) to 100 % (full).
    expect(gain(0)).toBe(2);
    expect(gain(400)).toBe(3);
    expect(gain(400)).toBeGreaterThan(gain(0));
    expect(gain(400)).toBeGreaterThan(gain(900));
    expect(gain(999)).toBe(1);
    expect(gain(1000)).toBe(0);
  });

  it("keeps troops above the cap without growing them when nobody deserts", () => {
    const { ada, run } = newGame({ desertionBasisPoints: 0 });
    ada.troops = 5000;
    run();
    expect(ada.troops).toBe(5000);
  });

  it("lets B-DESERTION of the troops above the cap leave each second (R-ECO-02)", () => {
    // Cap 1000; 5 % of the excess per second is 0.5 % per tick.
    const { ada, run } = newGame({ desertionBasisPoints: 500 });
    ada.troops = 5000;
    run();
    expect(ada.troops).toBe(5000 - 20);
    // Half the excess is gone in about 14 s, nearly all of it in two minutes.
    run(1200);
    expect(ada.troops).toBeGreaterThanOrEqual(1000);
    expect(ada.troops).toBeLessThan(1020);
    // At the cap, nobody leaves and nothing grows.
    ada.troops = 1000;
    run();
    expect(ada.troops).toBe(1000);
  });

  it("pays gold in whole coins without losing the fractions (R-ECO-03, R-ECO-04)", () => {
    const { ada, run } = newGame({ popPerTile: 0, desertionBasisPoints: 0 });
    // 1000 idle troops earn 5 gold per second: half a coin per tick.
    ada.troops = 1000;
    run();
    expect(ada.gold).toBe(0);
    run();
    expect(ada.gold).toBe(1);
    run(8);
    expect(ada.gold).toBe(5);
  });

  it("eliminates a player without land, who loses everything (R-ECO-05)", () => {
    const { bea, run } = newGame();
    bea.troops = 300;
    bea.gold = 40;
    run();
    expect([bea.alive, bea.troops, bea.gold]).toEqual([false, 0, 0]);
  });

  it("hands all the gold of a player to whoever took their last tile (R-ECO-08)", () => {
    const { game, ada, bea, run } = newGame();
    game.territory.setOwner(50, 2);
    bea.gold = 40;
    ada.gold = 7;
    // Ada takes Bea's last tile at the end of a tick; the economy settles it on the next.
    game.onTick(() => {
      if (game.tick === 0) game.territory.setOwner(50, 1);
    });
    run(2);
    expect([bea.alive, bea.gold]).toEqual([false, 0]);
    // 7 + 40, and what the tick earned.
    expect(ada.gold).toBeGreaterThanOrEqual(47);
    expect(game.diplomacyEvents).toEqual([{ tick: 1, type: "eliminated", a: 1, b: 2, gold: 40 }]);
  });

  it("loses the gold of a player whose last tile went back to nobody (R-ECO-08)", () => {
    const { game, ada, bea, run } = newGame();
    game.territory.setOwner(50, 2);
    game.territory.setOwner(50, 0);
    bea.gold = 40;
    run();
    expect([bea.alive, bea.gold, ada.gold < 40]).toEqual([false, 0, true]);
    expect(game.diplomacyEvents).toEqual([]);
  });

  it("does nothing during the spawn phase", () => {
    const { ada, bea, run } = newGame({ spawnPhaseTicks: 5 });
    ada.troops = 1000;
    run(3);
    expect([ada.troops, ada.gold, bea.alive]).toEqual([1000, 0, true]);
  });
});
