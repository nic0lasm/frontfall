import { describe, expect, it } from "vitest";
import { collapseDepth, installAttacks } from "../src/attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { Game, type Order, type Player } from "../src/game.ts";
import { loadSnapshot, saveSnapshot } from "../src/snapshot.ts";
import { StructureKind } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  spawnPhaseTicks: 0,
  neutralCost: 10,
  reliefCostTenths: [10, 10, 10],
  // One tile per tick, so a stretch giving way stands out.
  attackSpeedDivisor: 1000,
  attackSpread: 0,
  collapseOddsTenths: 30,
  collapseBuildupTicks: 3,
  collapseDepth: 3,
  collapseCostPercent: 50,
};

const WIDTH = 20;
const HEIGHT = 9;

/**
 * A flat 20 x 9 map: Ada holds the first column, Bea the rest but the last,
 * left unowned so that Bea's land is never a pocket (R-ATTACK-08).
 */
function newGame(collapsingFronts = true, overrides: Partial<Balance> = {}) {
  const { grid, game } = blankGame(collapsingFronts, overrides);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      game.territory.setOwner(grid.index(x, y), x === 0 ? 1 : x < WIDTH - 1 ? 2 : 0);
    }
  }
  const ada = game.player(1) as Player;
  const bea = game.player(2) as Player;
  const run = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  const attack = (troops: number) => ({
    player: 1,
    order: { type: "attack", target: grid.index(WIDTH - 2, 4), troops } as Order,
  });
  return { grid, game, ada, bea, run, attack };
}

/** The same game before anyone owns land, as a snapshot loads into. */
function blankGame(collapsingFronts: boolean, overrides: Partial<Balance>) {
  const grid = new WorldGrid(WIDTH, HEIGHT, { wrapsX: false });
  const game = new Game({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 5,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...balance, ...overrides },
    rules: { collapsingFronts },
  });
  installAttacks(game);
  return { grid, game };
}

describe("collapsing fronts (R-ATTACK-10)", () => {
  it("is off unless the setup turns it on (R-MODE-08)", () => {
    const { game, ada, run, attack } = newGame(false);
    ada.troops = 10_000;
    run([attack(10_000)]);
    for (let i = 0; i < 9; i++) run();
    // One tile per tick, nothing more.
    expect(game.territory.tileCount(1)).toBe(HEIGHT + 10);
    expect(game.attacks[0]?.pressure).toBe(0);
    expect(game.diplomacyEvents).toEqual([]);
  });

  it("breaks an overwhelmed front by a stretch once the pressure has built up", () => {
    const { grid, game, ada, run, attack } = newGame();
    ada.troops = 10_000;
    run([attack(10_000)]);
    run();
    expect(game.attacks[0]?.pressure).toBe(2);
    expect(game.territory.tileCount(1)).toBe(HEIGHT + 2);
    run();
    // The third tile, then the stretch behind it, within 3 tiles of it.
    expect(game.territory.tileCount(1)).toBeGreaterThan(HEIGHT + 3 + 10);
    expect(game.attacks[0]?.pressure).toBe(0);
    const event = game.diplomacyEvents.at(-1);
    expect(event).toMatchObject({ type: "collapsed", a: 1, b: 2 });
    const tip = event?.tile as number;
    expect(game.territory.ownerOf(tip)).toBe(1);
    // Every tile taken past the regular advance lies within the depth of the tip.
    for (let tile = 0; tile < grid.size; tile++) {
      if (game.territory.ownerOf(tile) !== 1 || grid.x(tile) <= 3) continue;
      expect(game.terrain.topology.squaredDistance(tile, tip)).toBeLessThanOrEqual(9);
    }
  });

  it("charges B-COLLAPSE-COST of the usual price, and the defender loses their troops per tile", () => {
    const { game, ada, bea, run, attack } = newGame();
    ada.troops = 10_000;
    run([attack(10_000)]);
    run();
    const before = game.attacks[0]?.troops as number;
    const tiles = game.territory.tileCount(1);
    run();
    const taken = game.territory.tileCount(1) - tiles;
    // One tile at the full price of 10, the others at half price: 5 each.
    expect(before - (game.attacks[0]?.troops as number)).toBe(10 + (taken - 1) * 5);
    expect(bea.troops).toBe(0);
  });

  it("holds where the garrison facing the attack is strong enough", () => {
    const { game, ada, bea, run, attack } = newGame();
    // 162 tiles, 1,620 soldiers: 10 a tile, 90 along the front, 270 at the odds of 3.
    bea.troops = 1_620;
    ada.troops = 260;
    run([attack(260)]);
    for (let i = 0; i < 5; i++) run();
    expect(game.attacks[0]?.pressure ?? 0).toBe(0);
    expect(game.diplomacyEvents).toEqual([]);
  });

  it("does not give way within reach of a ready fort (R-BUILD-03)", () => {
    const { grid, game, ada, run, attack } = newGame(true, { fortRadius: 4 });
    game.structures.push({
      id: 1,
      player: 2,
      kind: StructureKind.Fort,
      tile: grid.index(6, 4),
      readyAt: 0,
      reloadAt: 0,
    });
    ada.troops = 10_000;
    run([attack(10_000)]);
    run();
    run();
    for (let tile = 0; tile < grid.size; tile++) {
      if (game.territory.ownerOf(tile) !== 1) continue;
      // Only the regular advance reaches into the fort's cover, one tile a tick.
      if (game.terrain.topology.distance(tile, grid.index(6, 4)) <= 4) {
        expect(grid.x(tile)).toBeLessThanOrEqual(3);
      }
    }
  });

  it("measures its depth on a map of 2^19 tiles, at least B-COLLAPSE-DEPTH", () => {
    expect(collapseDepth(newGame().game)).toBe(3);
  });

  it("enters the setup digest only when on", () => {
    const off = newGame(false).game;
    const on = newGame(true).game;
    const plain = new Game({
      terrain: off.terrain,
      seed: 5,
      players: [
        { id: 1, name: "Ada" },
        { id: 2, name: "Bea" },
      ],
      balance,
    });
    expect(plain.setupDigest()).toBe(off.setupDigest());
    expect(on.setupDigest()).not.toBe(off.setupDigest());
  });

  it("keeps the pressure of attacks across a snapshot", () => {
    const create = () => blankGame(true, { collapseBuildupTicks: 50 }).game;
    const { game, ada, run, attack } = newGame(true, { collapseBuildupTicks: 50 });
    ada.troops = 10_000;
    run([attack(10_000)]);
    for (let i = 0; i < 4; i++) run();
    expect(game.attacks[0]?.pressure).toBe(5);
    const loaded = loadSnapshot(saveSnapshot(game, "test"), "test", create);
    expect(loaded.ok ? "" : loaded.reason).toBe("");
    if (!loaded.ok) return;
    expect(loaded.game.attacks.map((a) => a.pressure)).toEqual([5]);
    expect(loaded.game.hash()).toBe(game.hash());
  });
});
