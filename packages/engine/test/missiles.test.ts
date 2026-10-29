import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { NATION_DIFFICULTIES, installNations } from "../src/bots/index.ts";
import { createGame } from "../src/create-game.ts";
import type { Order, Player } from "../src/game.ts";
import {
  MissileError,
  MissileSize,
  blastRadius,
  missileTile,
  type Missile,
} from "../src/missiles.ts";
import { orderError } from "../src/orders.ts";
import { StructureKind } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  // Gold counts below leave out the income every player earns (B-GOLD-BASE).
  goldBase: 0,
  // Troops set by hand above the cap stay put (B-DESERTION).
  desertionBasisPoints: 0,
  spawnPhaseTicks: 0,
  buildTicks: 1,
  longBuildTicks: 2,
  siloCost: 1000,
  airDefenseCost: 1000,
  missileCost: 500,
  heavyMissileCost: 2000,
  missileRadius: 3,
  heavyMissileRadius: 4,
  missileSpeed: 5,
  siloReloadTicks: 20,
  falloutTicks: 30,
  // Tests below read a light strike alone; fallout and the troops it kills have their own.
  lightFalloutTicks: 0,
  missileTroopsPercent: 100,
  airDefenseRadius: 8,
  airDefenseReloadTicks: 15,
  goldPerThousandTroops: 0,
  growthBasisPoints: 0,
};

/**
 * A 60 × 20 plain: Ada holds the columns west of x = 20, Bea those from 40,
 * Cy the middle. Ada has a ready silo at (5, 10).
 */
function newGame(overrides: Partial<Balance> = {}, wrapsX = false) {
  const grid = new WorldGrid(60, 20, { wrapsX });
  const game = createGame({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 9,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
      { id: 3, name: "Cy" },
    ],
    balance: { ...balance, ...overrides },
  });
  for (let tile = 0; tile < grid.size; tile++) {
    const x = grid.x(tile);
    game.territory.setOwner(tile, x < 20 ? 1 : x >= 40 ? 2 : 3);
  }
  for (const player of game.players()) {
    player.gold = 100_000;
    player.troops = 120_000;
  }
  const step = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) step();
  };
  const build = (player: number, structure: number, tile: number): Order => ({
    type: "build",
    structure,
    tile,
  });
  const silo = grid.index(5, 10);
  step([{ player: 1, order: build(1, StructureKind.Silo, silo) }]);
  run(2);
  const ada = game.player(1) as Player;
  const bea = game.player(2) as Player;
  return { game, grid, ada, bea, step, run, build, silo };
}

const launch = (target: number, size: number = MissileSize.Light): Order => ({
  type: "missile",
  target,
  size,
});

describe("missile silos (R-BUILD-04)", () => {
  it("take B-BUILD-TIME-LONG to build, launch one missile, then reload for B-SILO-RELOAD", () => {
    const grid = new WorldGrid(60, 20, { wrapsX: false });
    const game = createGame({
      terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
      seed: 1,
      players: [{ id: 1, name: "Ada" }],
      balance: { ...balance, longBuildTicks: 10 },
    });
    for (let tile = 0; tile < grid.size; tile++) game.territory.setOwner(tile, 1);
    const ada = game.player(1) as Player;
    ada.gold = 10_000;
    ada.troops = 1000;
    const target = grid.index(50, 10);
    game.step({
      tick: 0,
      orders: [
        {
          player: 1,
          order: { type: "build", structure: StructureKind.Silo, tile: grid.index(5, 5) },
        },
      ],
    });
    expect(ada.gold).toBe(9000);
    expect(orderError(game, ada, launch(target))).toBe(MissileError.Silo);
    while (game.tick < 10) game.step({ tick: game.tick, orders: [] });
    expect(orderError(game, ada, launch(target))).toBeUndefined();
    expect(game.step({ tick: game.tick, orders: [{ player: 1, order: launch(target) }] })).toBe(1);
    expect(ada.gold).toBe(8500);
    expect(orderError(game, ada, launch(target))).toBe(MissileError.Silo);
    const launched = game.tick;
    while (game.tick < launched - 1 + balance.siloReloadTicks) {
      game.step({ tick: game.tick, orders: [] });
    }
    expect(orderError(game, ada, launch(target))).toBeUndefined();
  });
});

describe("missiles (R-UNIT-05)", () => {
  it("cannot target an ally's land, and cost B-COST-MISSILE or B-COST-HEAVY-MISSILE", () => {
    const { game, grid, ada, step } = newGame();
    step([
      { player: 1, order: { type: "ally", target: 2 } },
      { player: 2, order: { type: "ally", target: 1 } },
    ]);
    expect(orderError(game, ada, launch(grid.index(50, 10)))).toBe(MissileError.Ally);
    expect(orderError(game, ada, launch(grid.index(30, 10), 2))).toBe(MissileError.Size);
    ada.gold = 1999;
    expect(orderError(game, ada, launch(grid.index(30, 10), MissileSize.Heavy))).toBe(
      MissileError.Gold,
    );
    expect(orderError(game, ada, launch(grid.index(30, 10)))).toBeUndefined();
  });

  it("strike after flying B-MISSILE-SPEED tiles a tick: the land goes to nobody with what stands on it, and troops go with it", () => {
    const { game, grid, bea, step, build } = newGame();
    const target = grid.index(50, 10);
    step([{ player: 2, order: build(2, StructureKind.City, target) }]);
    expect(game.structures.some((s) => s.tile === target)).toBe(true);
    const tilesBefore = game.territory.tileCount(2);
    const troopsBefore = bea.troops;
    step([{ player: 1, order: launch(target) }]);
    const missile = game.missiles[0] as Missile;
    // 45 tiles at 5 a tick.
    expect(missile.arrivesAt - missile.launchedAt).toBe(9);
    while (game.missiles.length > 0) {
      expect(game.territory.ownerOf(target)).toBe(2);
      step();
    }
    expect(game.tick).toBe(missile.arrivesAt);
    expect(game.territory.ownerOf(target)).toBe(NEUTRAL);
    const radius = blastRadius(game, MissileSize.Light);
    let hit = 0;
    for (const tile of grid.tilesWithin(target, radius)) {
      if (grid.squaredDistance(tile, target) <= radius * radius) {
        hit++;
        expect(game.territory.ownerOf(tile)).toBe(NEUTRAL);
      }
    }
    expect(game.territory.tileCount(2)).toBe(tilesBefore - hit);
    expect(game.territory.ownerOf(grid.index(50, 10 + radius + 1))).toBe(2);
    expect(game.structures.some((s) => s.tile === target)).toBe(false);
    expect(bea.troops).toBe(troopsBefore - Math.floor((troopsBefore * hit) / tilesBefore));
  });

  it("cannot reach an ally's land with their blast, but may hit the player's own", () => {
    const { game, grid, ada, step } = newGame();
    step([
      { player: 1, order: { type: "ally", target: 3 } },
      { player: 3, order: { type: "ally", target: 1 } },
    ]);
    // Bea's land at x = 41 is 2 tiles from Cy's: inside a light blast of 3.
    expect(orderError(game, ada, launch(grid.index(41, 10)))).toBe(MissileError.Near);
    expect(orderError(game, ada, launch(grid.index(50, 10)))).toBeUndefined();
    expect(orderError(game, ada, launch(grid.index(10, 10)))).toBeUndefined();
  });

  it("fall harmlessly and are paid back when land under the blast became an ally's while they flew", () => {
    const { game, grid, ada, step } = newGame();
    const target = grid.index(50, 10);
    step([{ player: 1, order: launch(target) }]);
    const paid = ada.gold;
    // Not the target itself: a tile of Cy's next to it, then an alliance with Cy.
    game.territory.setOwner(grid.index(52, 10), 3);
    step([
      { player: 1, order: { type: "ally", target: 3 } },
      { player: 3, order: { type: "ally", target: 1 } },
    ]);
    while (game.missiles.length > 0) step();
    expect(game.territory.ownerOf(target)).toBe(2);
    expect(ada.gold).toBe(paid + balance.missileCost);
  });

  it("take the short way across the east-west seam", () => {
    const { game, grid, ada, step, build } = newGame({}, true);
    // A silo near the west edge, a target near the east edge: 6 tiles apart the short way.
    const west = grid.index(1, 3);
    step([{ player: 1, order: build(1, StructureKind.Silo, west) }]);
    step();
    step();
    const target = grid.index(55, 3);
    ada.gold = 100_000;
    step([{ player: 1, order: launch(target) }]);
    const missile = game.missiles.find((m) => m.to === target) as Missile;
    expect(missile.from).toBe(west);
    expect(missile.arrivesAt - missile.launchedAt).toBe(2);
    const middle = missileTile(game, missile, missile.launchedAt + 1);
    expect([58, 59, 0, 1]).toContain(grid.x(middle));
    while (game.missiles.length > 0) step();
    expect(game.territory.ownerOf(target)).toBe(NEUTRAL);
    expect(game.territory.ownerOf(grid.index(57, 3))).toBe(NEUTRAL);
  });
});

describe("fallout (R-UNIT-06)", () => {
  it("leaves the land under a heavy missile unusable for B-FALLOUT-TIME", () => {
    const { game, grid, bea, step } = newGame();
    const target = grid.index(30, 10);
    step([{ player: 1, order: launch(target, MissileSize.Heavy) }]);
    while (game.missiles.length > 0) step();
    expect(game.territory.ownerOf(target)).toBe(NEUTRAL);
    expect(game.usable(target)).toBe(false);
    expect(game.fallout).toHaveLength(1);
    // Bea's attack on Cy cannot cross the burnt land; Cy's own land around it still falls.
    const cyBefore = game.territory.tileCount(3);
    step([{ player: 2, order: { type: "attack", target: grid.index(36, 10), troops: 100_000 } }]);
    for (let i = 0; i < 20; i++) step();
    expect(game.territory.tileCount(3)).toBeLessThan(cyBefore);
    expect(game.territory.ownerOf(target)).toBe(NEUTRAL);
    const cleared = (game.fallout[0]?.until ?? 0) - game.tick;
    for (let i = 0; i < cleared; i++) step();
    expect(game.usable(target)).toBe(true);
    bea.troops = 100_000;
    step([{ player: 2, order: { type: "attack", target, troops: 50_000 } }]);
    for (let i = 0; i < 40 && game.territory.ownerOf(target) !== 2; i++) step();
    expect(game.territory.ownerOf(target)).toBe(2);
    expect(game.fallout).toHaveLength(0);
  });
});

describe("a light strike (R-UNIT-05, R-UNIT-06)", () => {
  it("kills B-MISSILE-TROOPS of the share of troops its land held, never more than all", () => {
    for (const percent of [300, 100_000]) {
      const { game, grid, bea, step } = newGame({ missileTroopsPercent: percent });
      const target = grid.index(50, 10);
      const tilesBefore = game.territory.tileCount(2);
      const troopsBefore = bea.troops;
      step([{ player: 1, order: launch(target) }]);
      while (game.missiles.length > 0) step();
      const hit = tilesBefore - game.territory.tileCount(2);
      const share = Math.min(tilesBefore, Math.floor((hit * percent) / 100));
      // Past all of them, the army is wiped out and grows back from nothing.
      if (percent === 300) {
        expect(bea.troops).toBe(troopsBefore - Math.floor((troopsBefore * share) / tilesBefore));
      } else expect(bea.troops).toBeLessThan(10);
    }
  });

  it("leaves its land unusable for B-FALLOUT-TIME-LIGHT", () => {
    const { game, grid, step } = newGame({ lightFalloutTicks: 10 });
    const target = grid.index(50, 10);
    step([{ player: 1, order: launch(target) }]);
    while (game.missiles.length > 0) step();
    expect(game.usable(target)).toBe(false);
    expect(game.fallout).toHaveLength(1);
    for (let i = 0; i < 10; i++) step();
    expect(game.usable(target)).toBe(true);
  });
});

describe("air defense (R-BUILD-05)", () => {
  function defended(chance: number, overrides: Partial<Balance> = {}) {
    const setup = newGame({ airDefenseChancePercent: chance, ...overrides });
    const { grid, step, build, run } = setup;
    step([{ player: 2, order: build(2, StructureKind.AirDefense, grid.index(50, 10)) }]);
    run(2);
    return setup;
  }

  it("stops a missile flying within its radius at B-AIR-DEFENSE-CHANCE, then reloads", () => {
    const { game, grid, step, run } = defended(100, { airDefenseReloadTicks: 1000 });
    const target = grid.index(52, 12);
    step([{ player: 1, order: launch(target) }]);
    while (game.missiles.length > 0) step();
    expect(game.territory.ownerOf(target)).toBe(2);
    const defense = game.structures.find((s) => s.kind === StructureKind.AirDefense);
    expect(defense?.reloadAt).toBeGreaterThan(game.tick);
    // The next missile, while it reloads, gets through.
    run(balance.siloReloadTicks);
    step([{ player: 1, order: launch(target) }]);
    while (game.missiles.length > 0) step();
    expect(game.territory.ownerOf(target)).toBe(NEUTRAL);
  });

  it("never stops a missile at 0 %, nor one of its owner or an ally", () => {
    const zero = defended(0);
    const target = zero.grid.index(52, 12);
    zero.step([{ player: 1, order: launch(target) }]);
    while (zero.game.missiles.length > 0) zero.step();
    expect(zero.game.territory.ownerOf(target)).toBe(NEUTRAL);

    const allied = defended(100);
    // Cy's defense next to Bea's land does not cover Ada, its ally.
    allied.step([
      { player: 3, order: allied.build(3, StructureKind.AirDefense, allied.grid.index(35, 10)) },
      { player: 1, order: { type: "ally", target: 3 } },
      { player: 3, order: { type: "ally", target: 1 } },
    ]);
    allied.run(2);
    allied.game.structures.splice(
      allied.game.structures.findIndex(
        (s) => s.player === 2 && s.kind === StructureKind.AirDefense,
      ),
      1,
    );
    allied.step([{ player: 1, order: launch(target) }]);
    while (allied.game.missiles.length > 0) allied.step();
    expect(allied.game.territory.ownerOf(target)).toBe(NEUTRAL);
  });

  it("no longer protects its owner once the launcher holds its tile", () => {
    const { game, grid, step } = defended(100);
    game.territory.setOwner(grid.index(50, 10), 1);
    const target = grid.index(52, 12);
    step([{ player: 1, order: launch(target) }]);
    while (game.missiles.length > 0) step();
    expect(game.territory.ownerOf(target)).toBe(NEUTRAL);
  });

  it("count in the state hash with the missiles and the fallout", () => {
    const a = newGame();
    const b = newGame();
    expect(a.game.hash()).toBe(b.game.hash());
    a.step([{ player: 1, order: launch(a.grid.index(30, 10), MissileSize.Heavy) }]);
    b.step();
    expect(a.game.hash()).not.toBe(b.game.hash());
  });
});

describe("nations and missiles (R-BOT-12)", () => {
  it("build a silo after two cities, an air defense against a silo, and fire at the leader's closest city", () => {
    const { game, grid, step } = newGame();
    const bea = game.player(2) as Player;
    bea.start = grid.index(50, 10);
    bea.gold = 10_000_000;
    const adaCity = grid.index(15, 10);
    // Cities placed by hand: this small map supports one each.
    const city = (player: number, tile: number) =>
      game.structures.push({
        id: game.nextStructureId++,
        player,
        kind: StructureKind.City,
        tile,
        readyAt: 0,
        reloadAt: 0,
      });
    city(2, grid.index(45, 4));
    city(2, grid.index(55, 16));
    city(1, adaCity);
    city(1, grid.index(5, 2));
    installNations(game, [2], "normal", 0);
    let fired = false;
    for (let i = 0; i < 300 && !fired; i++) {
      step();
      fired = game.missiles.some((m) => m.player === 2);
    }
    const kinds = game.structures.filter((s) => s.player === 2).map((s) => s.kind);
    expect(kinds).toContain(StructureKind.Silo);
    // Ada's silo is a threat.
    expect(kinds).toContain(StructureKind.AirDefense);
    // Ada, with a third of the land, leads the others; her city closest to Bea's start is the target.
    expect(game.missiles.find((m) => m.player === 2)?.to).toBe(adaCity);
  });

  it("wait B-NATION-MISSILE-PAUSE between two launches, longer than a silo's reload", () => {
    const { game, grid, step } = newGame();
    const bea = game.player(2) as Player;
    bea.start = grid.index(50, 10);
    bea.gold = 100_000_000;
    for (const [player, tile] of [
      [2, grid.index(45, 4)],
      [2, grid.index(55, 16)],
      [1, grid.index(15, 10)],
      [1, grid.index(5, 2)],
    ] as const) {
      game.structures.push({
        id: game.nextStructureId++,
        player,
        kind: StructureKind.City,
        tile,
        readyAt: 0,
        reloadAt: 0,
      });
    }
    installNations(game, [2], "easy", 0);
    const launches: number[] = [];
    let seen = 0;
    const pause = NATION_DIFFICULTIES.easy.missilePauseSeconds * game.balance.ticksPerSecond;
    expect(pause).toBeGreaterThan(game.balance.siloReloadTicks);
    for (let i = 0; i < 1000 + 2 * pause && launches.length < 2; i++) {
      step();
      for (const m of game.missiles) {
        if (m.player === 2 && m.id > seen) {
          seen = m.id;
          launches.push(game.tick);
        }
      }
    }
    expect(launches).toHaveLength(2);
    expect((launches[1] as number) - (launches[0] as number)).toBeGreaterThanOrEqual(pause);
  });
});
