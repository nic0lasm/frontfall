import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { createGame } from "../src/create-game.ts";
import { Game, type Order } from "../src/game.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

/**
 * A scripted four-player game: fixed map, seed and orders. Its state hash is
 * pinned below, so any change to the rules' outcome, however small, is seen.
 */
function scriptedGame(ticks: number): Game {
  const grid = new WorldGrid(64, 32);
  const kinds = new Uint8Array(grid.size);
  for (let tile = 0; tile < grid.size; tile++) {
    const x = grid.x(tile);
    const y = grid.y(tile);
    // Two continents split by a sea along x = 0 and x = 32, with a mountain ridge.
    kinds[tile] =
      x % 32 < 2
        ? TileKind.Water
        : y === 0 || y === 31
          ? TileKind.Impassable
          : x % 32 === 16 && y > 8
            ? TileKind.Mountains
            : (x + y) % 7 === 0
              ? TileKind.Hills
              : TileKind.Plains;
  }
  const game = createGame({
    terrain: new Terrain(grid, kinds),
    seed: 20261023,
    players: [1, 2, 3, 4].map((id) => ({ id, name: `P${String(id)}` })),
    balance: { ...DEFAULT_BALANCE, spawnPhaseTicks: 10, spawnDistance: 12 },
  });
  for (let tick = 0; tick < ticks; tick++) {
    const orders: { player: number; order: Order }[] = [];
    if (tick === 0) {
      orders.push({ player: 1, order: { type: "spawn", tile: grid.index(8, 8) } });
      orders.push({ player: 2, order: { type: "spawn", tile: grid.index(24, 20) } });
    }
    if (tick >= 10 && tick % 15 === 0) {
      for (const player of game.players()) {
        if (!player.alive || player.start === undefined) continue;
        const target = grid.index(grid.x(player.start) + 12 + (tick % 9), grid.y(player.start));
        const troops = Math.floor(player.troops / 3);
        if (troops > 0)
          orders.push({ player: player.id, order: { type: "attack", target, troops } });
      }
    }
    if (tick === 200) orders.push({ player: 3, order: { type: "retreat", attack: 1 } });
    game.step({ tick, orders });
  }
  return game;
}

describe("Game.hash", () => {
  it("tells apart games that differ in any balance value, whatever the key order", () => {
    const grid = new WorldGrid(8, 8);
    const terrain = new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains));
    const hashWith = (balance: Balance) =>
      new Game({ terrain, seed: 1, players: [{ id: 1, name: "Ada" }], balance }).hash();
    const reference = hashWith(DEFAULT_BALANCE);
    const reversed = Object.fromEntries(Object.entries(DEFAULT_BALANCE).reverse()) as Balance;
    expect(hashWith(reversed)).toBe(reference);
    for (const key of Object.keys(DEFAULT_BALANCE) as (keyof Balance)[]) {
      const value = DEFAULT_BALANCE[key];
      const changed =
        typeof value === "number" ? value + 1 : value.map((v, i) => (i === 0 ? v + 1 : v));
      expect(hashWith({ ...DEFAULT_BALANCE, [key]: changed }), key).not.toBe(reference);
    }
  });

  it("is the same for the same game, and changes with any part of the state", () => {
    const a = scriptedGame(50);
    const b = scriptedGame(50);
    expect(a.hash()).toBe(b.hash());

    const before = a.hash();
    const player = a.player(1);
    if (player) player.goldRemainder++;
    expect(a.hash()).not.toBe(before);
    a.territory.setOwner(5, 4);
    expect(a.hash()).not.toBe(before);
  });

  it("matches the pinned value of the scripted game (R-FAIR-01)", () => {
    // Update this value only for a deliberate change to the rules, and say so in the changelog.
    const game = scriptedGame(600);
    expect(game.players().map((p) => game.territory.tileCount(p.id))).toEqual([0, 900, 193, 188]);
    expect(game.hash()).toBe(241190506);
  });
});
