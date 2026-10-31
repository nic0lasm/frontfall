import { describe, expect, it } from "vitest";
import { installAttacks } from "../src/attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { Game, type Order, type Player } from "../src/game.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";
import { WHOLE_PRICES } from "./whole-prices.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  spawnPhaseTicks: 0,
  ...WHOLE_PRICES,
  attackSpeedDivisor: 1000,
  // Fronts go straight for the aim, so tests can tell which tile is taken next.
  attackSpread: 0,
};

/** A 10 x 3 cylinder; columns given by the caller are owned by players. */
function newGame(
  owners: Record<number, number[]> = {},
  kinds?: Uint8Array,
  overrides: Partial<Balance> = {},
) {
  const grid = new WorldGrid(10, 3);
  const game = new Game({
    terrain: new Terrain(grid, kinds ?? new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 3,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...balance, ...overrides },
  });
  installAttacks(game);
  const attacks = { list: () => game.attacks };
  for (const [player, columns] of Object.entries(owners)) {
    for (const x of columns) {
      for (let y = 0; y < 3; y++) game.territory.setOwner(grid.index(x, y), Number(player));
    }
  }
  const ada = game.player(1) as Player;
  const bea = game.player(2) as Player;
  const run = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  const attack = (player: number, target: number, troops: number) => ({
    player,
    order: { type: "attack", target, troops } as Order,
  });
  return { grid, game, attacks, ada, bea, run, attack };
}

describe("expansion into unowned land", () => {
  it("takes the tiles closest to the aim first, one per tick at low speed (R-ATTACK-03)", () => {
    const { grid, game, ada, run, attack } = newGame({ 1: [0] });
    ada.troops = 100;
    expect(run([attack(1, grid.index(3, 0), 25)])).toBe(1);
    expect(ada.troops).toBe(75);
    expect(game.territory.ownerOf(grid.index(1, 0))).toBe(1);
    expect(game.territory.tileCount(1)).toBe(4);
  });

  it("pays more for relief and stops when troops run out, returning the rest (R-MAP-06, R-ATTACK-05)", () => {
    const kinds = new Uint8Array(30).fill(TileKind.Plains);
    kinds[1] = TileKind.Mountains;
    const { grid, game, ada, attacks, run, attack } = newGame({ 1: [0] }, kinds);
    ada.troops = 35;
    run([attack(1, grid.index(1, 0), 35)]);
    // The mountain costs 30, leaving 5: not enough for another tile.
    expect(game.territory.ownerOf(1)).toBe(1);
    run();
    expect(attacks.list()).toEqual([]);
    expect(ada.troops).toBe(5);
    expect(game.territory.tileCount(1)).toBe(4);
  });

  it("ends once no reachable tile is left, returning the troops (R-ATTACK-05)", () => {
    const { grid, game, ada, attacks, run, attack } = newGame({ 1: [0] }, undefined, {
      attackSpeedDivisor: 1,
    });
    ada.troops = 1000;
    run([attack(1, grid.index(5, 1), 1000)]);
    for (let i = 0; i < 10; i++) run();
    expect(game.territory.tileCount(1)).toBe(30);
    expect(attacks.list()).toEqual([]);
    expect(ada.troops).toBe(1000 - 27 * 10);
  });

  it("crosses the east-west seam", () => {
    const { grid, game, ada, run, attack } = newGame({ 1: [0] });
    ada.troops = 10;
    run([attack(1, grid.index(9, 1), 10)]);
    expect(game.territory.ownerOf(grid.index(9, 1))).toBe(1);
  });

  it("fills the hollows of its front before pushing the tip further (B-ATTACK-SPREAD)", () => {
    // Ada holds column 0 and (1, 1); the aim is straight east along row 1.
    const straight = newGame({ 1: [0] });
    const wide = newGame({ 1: [0] }, undefined, { attackSpread: 4 });
    for (const { grid, game, ada, run, attack } of [straight, wide]) {
      game.territory.setOwner(grid.index(1, 1), 1);
      ada.troops = 100;
      run([attack(1, grid.index(5, 1), 50)]);
    }
    expect(straight.game.territory.ownerOf(straight.grid.index(2, 1))).toBe(1);
    // (1, 0) shares two sides with Ada's land, the tip (2, 1) only one.
    expect(wide.game.territory.ownerOf(wide.grid.index(2, 1))).toBe(NEUTRAL);
    expect(wide.game.territory.tileCount(1)).toBe(5);
  });

  it("speeds up with more troops (B-ATTACK-SPEED)", () => {
    const { grid, game, ada, run, attack } = newGame({ 1: [0] }, undefined, {
      attackSpeedDivisor: 100,
    });
    ada.troops = 200;
    // 1 + 200 / 100 = 3 tiles in the first tick.
    run([attack(1, grid.index(5, 1), 200)]);
    expect(game.territory.tileCount(1)).toBe(3 + 3);
  });

  it("merges a second order into the running attack and follows the new aim", () => {
    const { grid, ada, attacks, run, attack } = newGame({ 1: [0] });
    ada.troops = 100;
    run([attack(1, grid.index(3, 0), 30), attack(1, grid.index(7, 2), 30)]);
    expect(attacks.list()).toHaveLength(1);
    expect(attacks.list()[0]?.aim).toBe(grid.index(7, 2));
    expect(ada.troops).toBe(40);
  });

  it("refuses a target that does not touch the player's land (R-ATTACK-09)", () => {
    const kinds = new Uint8Array(30).fill(TileKind.Plains);
    for (let y = 0; y < 3; y++) {
      kinds[y * 10 + 1] = TileKind.Water;
      kinds[y * 10 + 9] = TileKind.Water;
    }
    const { grid, ada, run, attack } = newGame({ 1: [0] }, kinds);
    ada.troops = 100;
    expect(run([attack(1, grid.index(5, 1), 50)])).toBe(0);
    expect(ada.troops).toBe(100);
  });
});

describe("attacks between players", () => {
  it("costs more against a dense defender, who loses troops with each tile (R-ATTACK-03)", () => {
    const { grid, game, ada, bea, run, attack } = newGame({ 1: [0, 1], 2: [2, 3] });
    ada.troops = 1000;
    bea.troops = 60;
    // Bea holds 6 tiles with 60 troops: 10 per tile, so a tile costs 10 + 10.
    run([attack(1, grid.index(2, 1), 100)]);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(1);
    expect(bea.troops).toBe(50);
    expect(game.territory.tileCount(2)).toBe(5);
  });

  it("refuses to attack an eliminated player", () => {
    const { grid, ada, bea, run, attack } = newGame({ 1: [0], 2: [1] });
    ada.troops = 100;
    bea.alive = false;
    expect(run([attack(1, grid.index(1, 0), 50)])).toBe(0);
  });

  it("makes opposite attacks fight before any tile changes hands (R-ATTACK-07)", () => {
    const { grid, game, ada, bea, attacks, run, attack } = newGame({ 1: [0, 1], 2: [2, 3] });
    ada.troops = 100;
    bea.troops = 100;
    run([attack(1, grid.index(2, 0), 80), attack(2, grid.index(1, 0), 30)]);
    // 30 troops on each side cancel out; Ada's remaining 50 take one tile at 10 + 70 / 6.
    expect(attacks.list().map((a) => [a.player, a.troops])).toEqual([[1, 29]]);
    expect(game.territory.tileCount(1)).toBe(7);
    expect([ada.troops, bea.troops]).toEqual([20, 59]);
  });

  it("loses the troops of an attack whose player was eliminated", () => {
    const { grid, game, ada, attacks, run, attack } = newGame({ 1: [0] });
    ada.troops = 100;
    run([attack(1, grid.index(5, 0), 100)]);
    ada.alive = false;
    run();
    expect(attacks.list()).toEqual([]);
    expect(game.territory.ownerOf(grid.index(5, 0))).toBe(NEUTRAL);
  });
});

describe("encirclement", () => {
  /** Columns 0-4 of a 10 x 3 flat strip: Ada around a pocket of Bea. */
  function pocketGame(pocketOwner: number, extra: Record<number, number[]> = {}) {
    const built = newGame({ 1: [0, 1, 2, 3, 4], ...extra });
    const { grid, game } = built;
    game.territory.setOwner(grid.index(2, 1), pocketOwner);
    game.territory.setOwner(grid.index(3, 1), pocketOwner);
    game.territory.setOwner(grid.index(4, 1), 2);
    game.territory.setOwner(grid.index(5, 1), 2);
    return built;
  }

  it("captures the defender's land left enclosed by the attacker (R-ATTACK-08)", () => {
    const { grid, game, ada, bea, run, attack } = pocketGame(2);
    ada.troops = 1000;
    bea.troops = 10;
    // Taking (4, 1) cuts (2-3, 1) off from the rest of Bea's land at (5, 1).
    run([attack(1, grid.index(4, 1), 100)]);
    expect(game.territory.ownerOf(grid.index(4, 1))).toBe(1);
    expect(game.territory.ownerOf(grid.index(5, 1))).toBe(2);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(1);
    expect(game.territory.ownerOf(grid.index(3, 1))).toBe(1);
  });

  it("leaves a pocket that still touches a third party", () => {
    const { grid, game, ada, run, attack } = pocketGame(2);
    game.territory.setOwner(grid.index(2, 0), NEUTRAL);
    ada.troops = 1000;
    run([attack(1, grid.index(4, 1), 100)]);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(2);
  });

  it("captures a pocket closed by expansion into unowned land", () => {
    const { grid, game, ada, run, attack } = pocketGame(2);
    game.territory.setOwner(grid.index(4, 1), NEUTRAL);
    game.territory.setOwner(grid.index(7, 1), 2);
    ada.troops = 1000;
    run([attack(1, grid.index(4, 1), 100)]);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(1);
    expect(game.territory.ownerOf(grid.index(3, 1))).toBe(1);
    expect(game.territory.ownerOf(grid.index(7, 1))).toBe(2);
  });

  it("leaves a pocket its owner is attacking from, such as a beachhead", () => {
    const { grid, game, ada, bea, run, attack } = pocketGame(2);
    game.territory.setOwner(grid.index(4, 1), NEUTRAL);
    game.territory.setOwner(grid.index(7, 1), 2);
    ada.troops = 1000;
    bea.troops = 10;
    // Bea's attack is too small to take a tile, but it is still under way when Ada closes the ring.
    run([attack(1, grid.index(4, 1), 100), attack(2, grid.index(2, 0), 1)]);
    expect(game.territory.ownerOf(grid.index(4, 1))).toBe(1);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(2);
    expect(game.territory.ownerOf(grid.index(3, 1))).toBe(2);
  });

  it("still captures a pocket far from where its owner's attack is aimed", () => {
    const { grid, game, ada, bea, run, attack } = pocketGame(2);
    game.territory.setOwner(grid.index(4, 1), NEUTRAL);
    game.territory.setOwner(grid.index(7, 1), 2);
    ada.troops = 1000;
    bea.troops = 10;
    // A token attack aimed at the other end of Ada's land does not shelter the pocket.
    run([attack(1, grid.index(4, 1), 100), attack(2, grid.index(0, 0), 1)]);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(1);
    expect(game.territory.ownerOf(grid.index(3, 1))).toBe(1);
  });

  it("captures a pocket across the east-west seam", () => {
    const { grid, game, ada, bea, run, attack } = newGame({ 1: [7, 8, 9, 0, 1] });
    for (const x of [9, 0, 1, 2]) game.territory.setOwner(grid.index(x, 1), 2);
    ada.troops = 1000;
    bea.troops = 10;
    run([attack(1, grid.index(1, 1), 100)]);
    expect(game.territory.ownerOf(grid.index(9, 1))).toBe(1);
    expect(game.territory.ownerOf(grid.index(0, 1))).toBe(1);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(2);
  });

  it("leaves all that is left of a player to be fought for, enclosed or not", () => {
    const { grid, game, ada, bea, run, attack } = pocketGame(2);
    game.territory.setOwner(grid.index(5, 1), NEUTRAL);
    ada.troops = 1000;
    bea.troops = 10;
    const before = game.territory.tileCount(2);
    run([attack(1, grid.index(4, 1), 100)]);
    expect(game.territory.ownerOf(grid.index(4, 1))).toBe(1);
    expect(game.territory.tileCount(2)).toBe(before - 1);
  });

  it("captures the pocket of a player the attack was not aimed at", () => {
    const grid = new WorldGrid(10, 3);
    const game = new Game({
      terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
      seed: 3,
      players: [1, 2, 3].map((id) => ({ id, name: `P${String(id)}` })),
      balance,
    });
    installAttacks(game);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 3; y++) game.territory.setOwner(grid.index(x, y), 1);
    // Carol's (2, 1) only escapes through Bea's (3, 1) and (4, 1).
    game.territory.setOwner(grid.index(2, 1), 3);
    game.territory.setOwner(grid.index(3, 1), 2);
    game.territory.setOwner(grid.index(4, 1), 2);
    for (let x = 5; x < 10; x++) game.territory.setOwner(grid.index(x, 1), 3);
    (game.player(1) as Player).troops = 1000;
    game.step({
      tick: 0,
      orders: [{ player: 1, order: { type: "attack", target: grid.index(3, 1), troops: 100 } }],
    });
    expect(game.territory.ownerOf(grid.index(3, 1))).toBe(1);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(1);
  });

  it("leaves pockets larger than the limit (B-ENCIRCLE-MAX)", () => {
    const built = newGame({ 1: [0, 1, 2, 3, 4] }, undefined, { encircleMaxTiles: 1 });
    const { grid, game, ada, run, attack } = built;
    game.territory.setOwner(grid.index(2, 1), 2);
    game.territory.setOwner(grid.index(3, 1), 2);
    game.territory.setOwner(grid.index(4, 1), 2);
    game.territory.setOwner(grid.index(5, 1), 2);
    ada.troops = 1000;
    run([attack(1, grid.index(4, 1), 100)]);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(2);
  });
});

describe("retreat", () => {
  it("calls an attack back, returning its troops minus the penalty (R-ATTACK-06)", () => {
    const { grid, game, ada, attacks, run, attack } = newGame({ 1: [0] });
    ada.troops = 500;
    run([attack(1, grid.index(5, 1), 400)]);
    const running = attacks.list()[0];
    if (!running) throw new Error("attack missing");
    const left = running.troops;
    const tiles = game.territory.tileCount(1);

    expect(run([{ player: 1, order: { type: "retreat", attack: running.id } }])).toBe(1);
    expect(attacks.list()).toEqual([]);
    expect(ada.troops).toBe(100 + left - Math.floor((left * 25) / 100));
    expect(game.territory.tileCount(1)).toBe(tiles);
  });

  it("only lets a player call back their own attacks", () => {
    const { grid, ada, bea, attacks, run, attack } = newGame({ 1: [0], 2: [5] });
    ada.troops = 500;
    bea.troops = 500;
    run([attack(1, grid.index(3, 1), 400)]);
    const id = attacks.list()[0]?.id ?? 0;
    expect(run([{ player: 2, order: { type: "retreat", attack: id } }])).toBe(0);
    expect(run([{ player: 1, order: { type: "retreat", attack: id + 7 } }])).toBe(0);
    expect(attacks.list()).toHaveLength(1);
  });
});

describe("pace of an attack on a player (R-ATTACK-03)", () => {
  /**
   * Ada holds the west column of a 10 x 40 strip, Bea the next eight and the
   * east column is free, so Bea is never surrounded: a straight front of 40 tiles.
   */
  function front(overrides: Partial<Balance> = {}) {
    const grid = new WorldGrid(10, 40, { wrapsX: false });
    const game = new Game({
      terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
      seed: 3,
      players: [
        { id: 1, name: "Ada" },
        { id: 2, name: "Bea" },
      ],
      balance: {
        ...balance,
        attackSpeedDivisor: 1,
        attackPacePercent: 50,
        attackPaceOddsTenths: 8,
        ...overrides,
      },
    });
    installAttacks(game);
    for (let tile = 0; tile < grid.size; tile++) {
      const x = grid.x(tile);
      if (x < 9) game.territory.setOwner(tile, x === 0 ? 1 : 2);
    }
    const ada = game.player(1) as Player;
    const bea = game.player(2) as Player;
    // 320 tiles and 3,200 soldiers: odds of 1 to 1 against an attack of 3,200.
    bea.troops = 3200;
    const strike = (troops: number) => {
      ada.troops = troops;
      game.step({
        tick: game.tick,
        orders: [{ player: 1, order: { type: "attack", target: grid.index(5, 20), troops } }],
      });
      return game.territory.tileCount(1) - 40;
    };
    return { strike };
  }

  it("takes B-ATTACK-PACE of the front per tick at odds of 1 to 1", () => {
    // A front of 40 tiles: half of it.
    expect(front().strike(3200)).toBe(20);
  });

  it("goes faster the more soldiers it holds, down to odds of B-ATTACK-PACE-ODDS", () => {
    expect(front().strike(1600)).toBe(10);
    expect(front().strike(3200)).toBe(20);
    expect(front().strike(4000)).toBe(25);
    expect(front().strike(8000)).toBe(25);
  });

  it("slows in proportion to the odds against it, never under one tile", () => {
    expect(front().strike(400)).toBe(2);
    expect(front().strike(40)).toBe(1);
  });

  it("leaves only B-ATTACK-SPEED at a pace of 0", () => {
    // 1 + isqrt(5000) = 71 tiles allowed: the whole front of 40 falls at once.
    expect(front({ attackPacePercent: 0 }).strike(5000)).toBe(40);
  });
});
