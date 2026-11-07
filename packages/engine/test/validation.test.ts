import { describe, expect, it } from "vitest";
import { AttackError } from "../src/attacks.ts";
import { BoatError } from "../src/boats.ts";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import { createGame } from "../src/create-game.ts";
import type { Order, Player } from "../src/game.ts";
import { orderError } from "../src/orders.ts";
import { SpawnError } from "../src/spawn.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";
import { ALL_RULES, BUSY, grid as busyGrid, type Fixture } from "./fixtures/busy-game.ts";

/**
 * Every check of an order is made before it is carried out (ADR 0007): an
 * order the rule's check lets through is carried out, and `orderError`
 * gives the reason of every other one. A shared border, a fallen target, a
 * sea route, the owner of an attack called back and the spacing of a start
 * were once judged only when the order ran, and such orders were dropped
 * without a reason.
 */

/** Ada west, Bea east, the sea between, on a 24 × 6 map; Cy on an island in the far east. */
function strip() {
  const grid = new WorldGrid(24, 6, { wrapsX: false });
  const kinds = new Uint8Array(grid.size).fill(TileKind.Plains);
  for (let tile = 0; tile < grid.size; tile++) {
    const x = grid.x(tile);
    if ((x >= 10 && x < 12) || x === 20) kinds[tile] = TileKind.Water;
  }
  const game = createGame({
    terrain: new Terrain(grid, kinds),
    seed: 1,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
      { id: 3, name: "Cy" },
    ],
    balance: { ...DEFAULT_BALANCE, spawnPhaseTicks: 0, boatRange: 4 },
  });
  for (let tile = 0; tile < grid.size; tile++) {
    const x = grid.x(tile);
    const owner = x < 4 ? 1 : x >= 12 && x < 16 ? 2 : x > 20 ? 3 : 0;
    if (owner !== 0) game.territory.setOwner(tile, owner);
  }
  const player = (id: number) => game.player(id) as Player;
  for (const id of [1, 2, 3]) player(id).troops = 10_000;
  return { grid, game, player };
}

describe("orders checked before they run (behavior change)", () => {
  it("refuses an attack on land that does not touch the player's, and names the reason (R-ATTACK-09)", () => {
    const { grid, game, player } = strip();
    const order: Order = { type: "attack", target: grid.index(14, 2), troops: 100 };
    expect(orderError(game, player(1), order)).toBe(AttackError.Border);
    expect(game.apply(1, order)).toBe(false);
    // Unowned land next to her is fine.
    expect(orderError(game, player(1), { ...order, target: grid.index(4, 2) })).toBeUndefined();
  });

  it("refuses an attack on the land of a player out of the game", () => {
    const { grid, game, player } = strip();
    game.territory.setOwner(grid.index(4, 2), 2);
    player(2).alive = false;
    const order: Order = { type: "attack", target: grid.index(4, 2), troops: 100 };
    expect(orderError(game, player(1), order)).toBe(AttackError.Fallen);
  });

  it("refuses to call back an attack that is not the player's, or has no troops left (R-ATTACK-06)", () => {
    const { grid, game, player } = strip();
    expect(game.apply(1, { type: "attack", target: grid.index(4, 2), troops: 100 })).toBe(true);
    const id = (game.attacks[0] as { id: number }).id;
    expect(orderError(game, player(2), { type: "retreat", attack: id })).toBe(AttackError.Retreat);
    expect(orderError(game, player(1), { type: "retreat", attack: id + 1 })).toBe(
      AttackError.Retreat,
    );
    expect(game.apply(1, { type: "retreat", attack: id })).toBe(true);
    expect(orderError(game, player(1), { type: "retreat", attack: id })).toBe(AttackError.Retreat);
  });

  it("refuses a landing out of reach by sea, and carries out one in reach (R-UNIT-02)", () => {
    const { grid, game, player } = strip();
    // Bea's coast is two tiles of water from Ada's land, Cy's island far past B-BOAT-RANGE.
    game.territory.setOwner(grid.index(9, 2), 1);
    const near: Order = { type: "embark", target: grid.index(12, 2), troops: 100 };
    const far: Order = { type: "embark", target: grid.index(21, 2), troops: 100 };
    expect(orderError(game, player(1), far)).toBe(BoatError.Route);
    expect(orderError(game, player(1), near)).toBeUndefined();
    expect(game.apply(1, near)).toBe(true);
    expect(game.boats).toHaveLength(1);
  });

  it("refuses a start on another player's land or too close to their start (R-SPAWN-02)", () => {
    const grid = new WorldGrid(40, 10, { wrapsX: false });
    const game = createGame({
      terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
      seed: 1,
      players: [
        { id: 1, name: "Ada" },
        { id: 2, name: "Bea" },
      ],
      balance: { ...DEFAULT_BALANCE, spawnPhaseTicks: 10, spawnDistance: 10, spawnRadius: 2 },
    });
    const ada = game.player(1) as Player;
    const bea = game.player(2) as Player;
    expect(game.apply(1, { type: "spawn", tile: grid.index(5, 5) })).toBe(true);
    expect(orderError(game, bea, { type: "spawn", tile: grid.index(5, 5) })).toBe(SpawnError.Taken);
    expect(orderError(game, bea, { type: "spawn", tile: grid.index(10, 5) })).toBe(SpawnError.Near);
    expect(orderError(game, bea, { type: "spawn", tile: grid.index(30, 5) })).toBeUndefined();
    // Moving one's own start is judged against the others' only.
    expect(orderError(game, ada, { type: "spawn", tile: grid.index(6, 5) })).toBeUndefined();
  });

  it("carry out every order of the busy games that orderError accepts, and none it refuses", () => {
    const check = (fixture: Fixture): number => {
      const game = fixture.newGame();
      let checked = 0;
      let seed = 7;
      const draw = (n: number): number => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return (seed >>> 8) % n;
      };
      while (game.tick < 400) {
        // Orders drawn at random, most of them refused, each given to orderError then to apply.
        for (const player of game.players()) {
          if (!player.alive) continue;
          const tile = draw(busyGrid.size);
          const candidates: Order[] = [
            { type: "attack", target: tile, troops: 1 + draw(50) },
            { type: "embark", target: tile, troops: 1 + draw(50) },
            { type: "retreat", attack: 1 + draw(game.nextAttackId + 2) },
            { type: "spawn", tile },
            { type: "tribute", target: 1 + draw(5) },
            { type: "gift", target: 1 + draw(5), troops: draw(20), gold: draw(20) },
          ];
          for (const order of candidates) {
            const refused = orderError(game, player, order);
            expect(game.apply(player.id, order), `${order.type} at ${String(game.tick)}`).toBe(
              refused === undefined,
            );
            checked++;
          }
        }
        game.step({ tick: game.tick, orders: fixture.orders(game) });
      }
      return checked;
    };
    expect(check(BUSY)).toBeGreaterThan(5000);
    expect(check(ALL_RULES)).toBeGreaterThan(5000);
  });
});
