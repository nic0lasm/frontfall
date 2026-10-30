import { describe, expect, it } from "vitest";
import { installAttacks } from "../src/attacks.ts";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import {
  CITY_STATE_CAP_PERCENT,
  CITY_STATE_INTERVAL_SECONDS,
  installCityStates,
} from "../src/bots/city-states.ts";
import { populationCap } from "../src/economy.ts";
import { Game, type Player } from "../src/game.ts";
import { installStructures } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";

/**
 * A strip of 60 x 3 plains, no wrap: the city-state (player 1) holds
 * columns 20 to 29, Ada 0 to 19, and columns 30 to 59 are free.
 */
function strip() {
  const grid = new WorldGrid(60, 3, { wrapsX: false });
  const game = new Game({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 5,
    players: [
      { id: 1, name: "Sparta" },
      { id: 2, name: "Ada" },
    ],
    balance: {
      ...DEFAULT_BALANCE,
      spawnPhaseTicks: 0,
      attackSpeedDivisor: 1000,
      encircleMaxTiles: 1,
    },
  });
  installAttacks(game);
  installStructures(game);
  installCityStates(game, [1]);
  for (let tile = 0; tile < grid.size; tile++) {
    const x = grid.x(tile);
    game.territory.setOwner(tile, x < 20 ? 2 : x < 30 ? 1 : NEUTRAL);
  }
  const state = game.player(1) as Player;
  const ada = game.player(2) as Player;
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) game.step({ tick: game.tick, orders: [] });
  };
  return { grid, game, state, ada, run };
}

const decisions = (game: Game, count: number) =>
  count * CITY_STATE_INTERVAL_SECONDS[1] * game.balance.ticksPerSecond;

describe("city-states (R-BOT-29)", () => {
  it("are priced as bots, hold a third of a player's cap, and build nothing", () => {
    const { game, state, run } = strip();
    expect(game.bots.has(1)).toBe(true);
    expect(game.cityStates.has(1)).toBe(true);
    expect(game.cityStates.has(2)).toBe(false);
    const cap = populationCap(game, state);
    const factors = game.popFactors.get(1);
    game.popFactors.delete(1);
    const full = populationCap(game, state);
    if (factors) game.popFactors.set(1, factors);
    expect(Math.abs(cap * 100 - full * CITY_STATE_CAP_PERCENT)).toBeLessThan(100);
    state.gold = 100_000_000;
    run(decisions(game, 4));
    expect(game.structures).toHaveLength(0);
  });

  it("take free land first, then turn on a neighbour", () => {
    const { game, grid, state, ada, run } = strip();
    state.troops = populationCap(game, state);
    ada.troops = 10;
    run(decisions(game, 6));
    expect(game.territory.ownerOf(grid.index(35, 1))).toBe(1);
    run(decisions(game, 20));
    expect(game.territory.tileCount(2)).toBeLessThan(60);
  });
});
