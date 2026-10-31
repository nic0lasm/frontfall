import { describe, expect, it, vi } from "vitest";
import { installAttacks } from "../src/attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { installBoats } from "../src/boats.ts";
import type { BotDifficulty } from "../src/bots/difficulty.ts";
import {
  installBots,
  installNations,
  NATION_DIFFICULTIES,
  NATION_WORK_PERCENT,
} from "../src/bots/index.ts";
import { installDiplomacy } from "../src/diplomacy.ts";
import { installEconomy, populationCap } from "../src/economy.ts";
import { Game, type GameRules, type Order, type Player } from "../src/game.ts";
import { installSpawn, spawnSettings } from "../src/spawn.ts";
import { StructureKind, installStructures } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  spawnPhaseTicks: 10,
  spawnDistance: 12,
  // Caps small enough for the few troops the tests hand out: 4834 for 60 tiles.
  popBase: 2500,
};
const intervalOf = (difficulty: BotDifficulty) =>
  NATION_DIFFICULTIES[difficulty].intervalSeconds * balance.ticksPerSecond;
const interval = intervalOf("hard");

/**
 * A strip of 60 x 3 plains, no wrap: Ada holds columns 0 to 19, the nation
 * (player 1) 20 to 39 and Bea 40 to 59. One tile per tick for every attack,
 * so a fight lasts. The nation decides on the ticks where (tick + 1) is a
 * multiple of its interval, hard unless told otherwise.
 */
function strip(
  overrides: Partial<Balance> = {},
  difficulty: BotDifficulty = "hard",
  rules: Partial<GameRules> = {},
) {
  const grid = new WorldGrid(60, 3, { wrapsX: false });
  const game = new Game({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 5,
    players: [
      { id: 1, name: "Norland" },
      { id: 2, name: "Ada" },
      { id: 3, name: "Bea" },
    ],
    // No encirclement either: a pocket would end a fight at once.
    balance: {
      ...balance,
      spawnPhaseTicks: 0,
      attackSpeedDivisor: 1000,
      encircleMaxTiles: 1,
      ...overrides,
    },
    rules,
  });
  installAttacks(game);
  installStructures(game);
  installNations(game, [1], difficulty, 0);
  for (let tile = 0; tile < grid.size; tile++) {
    const x = grid.x(tile);
    game.territory.setOwner(tile, x < 20 ? 2 : x < 40 ? 1 : 3);
  }
  const nation = game.player(1) as Player;
  const ada = game.player(2) as Player;
  const bea = game.player(3) as Player;
  nation.start = grid.index(30, 1);
  const apply = vi.spyOn(game, "apply");
  // Orders that move troops or build; work shares (R-BOT-15) have tests of their own.
  const ordersOf = (player: number) =>
    apply.mock.calls
      .filter(([id, order]) => id === player && order.type !== "work")
      .map(([, order]) => order);
  const workOf = (player: number) =>
    apply.mock.calls
      .filter(([id, order]) => id === player && order.type === "work")
      .map(([, order]) => (order.type === "work" ? order.share : -1));
  const run = (ticks: number, orders: { player: number; order: Order }[] = []) => {
    for (let i = 0; i < ticks; i++) {
      game.step({ tick: game.tick, orders: i === 0 ? orders : [] });
    }
  };
  /** Ada attacks the nation on the tick just before its next decision. */
  const adaAttacks = (troops = 3000) => {
    run(intervalOf(difficulty) - 2);
    run(1, [{ player: 2, order: { type: "attack", target: grid.index(25, 1), troops } }]);
  };
  return { grid, game, nation, ada, bea, ordersOf, workOf, run, adaAttacks };
}

describe("nations", () => {
  it("keep back B-NATION-RETAIN of their strongest neighbour's troops, at hard (R-BOT-26)", () => {
    const { game, ordersOf, run, nation, ada, bea } = strip();
    nation.troops = 4000;
    ada.troops = 4000;
    // Bea is easy prey, but Ada could break in if the nation sent everything.
    bea.troops = 10;
    run(3 * interval);
    const kept = (4000 * NATION_DIFFICULTIES.hard.retainPercent) / 100;
    const sent = ordersOf(1).flatMap((order) => (order.type === "attack" ? [order.troops] : []));
    expect(sent.length).toBeGreaterThan(0);
    for (const troops of sent)
      expect(troops).toBeLessThanOrEqual(populationCap(game, nation) - kept);
  });

  it("keep playing through attacks too small to threaten them (B-NATION-THREAT)", () => {
    // Easy nations do not hunt the leader (R-BOT-14), which Ada becomes.
    const { game, grid, nation, ada, bea, ordersOf, run, adaAttacks } = strip({}, "easy");
    nation.troops = 4000;
    ada.troops = 5000;
    // Above B-NATION-SPARE of her cap, under the nation's troops.
    bea.troops = 2000;
    // Under a tenth of the nation's troops: it plays on, and turns on Bea rather than answer Ada.
    adaAttacks(300);
    run(1);
    expect(game.attacks.some((attack) => attack.player === 2 && attack.target === 1)).toBe(true);
    // An easy nation lets a player be three times in four (R-BOT-26): it may take a few decisions.
    run(4 * intervalOf("easy"));
    const targets = ordersOf(1).flatMap((order) =>
      order.type === "attack" ? [grid.x(order.target)] : [],
    );
    expect(targets.length).toBeGreaterThan(0);
    for (const x of targets) expect(x).toBeGreaterThanOrEqual(40);
  });

  it("answer the attacker, and only the attacker, once strong enough (R-BOT-08)", () => {
    const { game, nation, ada, bea, ordersOf, run, adaAttacks } = strip();
    nation.troops = 4800;
    ada.troops = 5000;
    bea.troops = 10;
    adaAttacks();
    run(1);
    const orders = ordersOf(1);
    expect(orders).toHaveLength(1);
    const order = orders[0] as Order;
    expect(order.type).toBe("attack");
    expect(order.type === "attack" && game.territory.ownerOf(order.target)).toBe(2);
  });

  it("build a fort facing the attacker when their gold allows (R-BOT-08)", () => {
    const { game, grid, nation, ada, run, adaAttacks } = strip({ fortCost: 100 });
    nation.troops = 2000;
    nation.gold = 100;
    ada.troops = 5000;
    // A threat, but small enough that the front holds near x = 20 while the fort goes up.
    adaAttacks(300);
    run(1);
    expect(game.structures.map((s) => [s.kind, s.player])).toEqual([[StructureKind.Fort, 1]]);
    // Behind the front at x = 20, so the first tiles lost do not take it.
    const fort = game.structures[0];
    expect(fort && game.territory.isBorder(fort.tile)).toBe(false);
    expect(fort && grid.x(fort.tile)).toBeGreaterThan(22);
    expect(fort && grid.x(fort.tile)).toBeLessThanOrEqual(30);
    // One fort per front, even while it is being built.
    nation.gold = 1000;
    run(interval);
    expect(game.structures).toHaveLength(1);
  });

  it("leave alone neighbours their attack could not dent, at hard (B-NATION-TOO-WEAK)", () => {
    const { ordersOf, run, nation, ada, bea } = strip();
    nation.troops = 4000;
    ada.troops = 1_000_000;
    bea.troops = 1_000_000;
    run(3 * interval);
    expect(ordersOf(1).filter((order) => order.type === "attack")).toEqual([]);
  });

  it("put troops to work while full and left alone, and call them back when attacked (R-BOT-15)", () => {
    const { game, nation, ada, workOf, run, adaAttacks } = strip();
    installEconomy(game);
    installDiplomacy(game);
    // Allied with both neighbours, so the nation has nobody to attack.
    for (const player of [2, 3]) {
      run(1, [
        { player, order: { type: "ally", target: 1 } },
        { player: 1, order: { type: "ally", target: player } },
      ]);
    }
    const cap = populationCap(game, nation);
    nation.troops = Math.floor(cap / 2);
    run(interval);
    expect(workOf(1)).toEqual([]);
    nation.troops = cap;
    run(interval);
    expect(workOf(1)).toEqual([NATION_WORK_PERCENT]);
    expect(nation.workShare).toBe(NATION_WORK_PERCENT);
    ada.troops = 10 * cap;
    run(1, [{ player: 2, order: { type: "betray", target: 1 } }]);
    adaAttacks(nation.troops);
    run(interval);
    expect(workOf(1)).toEqual([NATION_WORK_PERCENT, 0]);
    expect(nation.workShare).toBe(0);
  });

  it("keep their troops under arms where a neighbour could break their front (R-BOT-16)", () => {
    const { game, nation, ada, bea, workOf, run } = strip({}, "hard", { collapsingFronts: true });
    installEconomy(game);
    const cap = populationCap(game, nation);
    // Half of Ada's soldiers are well over three times the nation's 3-tile front, once at work.
    ada.troops = 10 * cap;
    bea.troops = 10 * cap;
    nation.troops = cap;
    run(2 * interval);
    expect(workOf(1)).toEqual([]);
  });

  it("turn on a player only from their trigger share of the cap (R-BOT-26)", () => {
    const { game, ordersOf, run, nation, ada, bea } = strip();
    const cap = populationCap(game, nation);
    // Under half the cap, below every nation's trigger, with neighbours far weaker.
    nation.troops = Math.floor((cap * 45) / 100);
    ada.troops = 10;
    bea.troops = 10;
    run(interval);
    expect(ordersOf(1)).toEqual([]);
    nation.troops = cap;
    run(interval);
    expect(ordersOf(1).map((order) => order.type)).toEqual(["attack"]);
  });

  it("leave alone a player whose army is down, and do not answer them, at easy (B-NATION-SPARE)", () => {
    const { game, ordersOf, run, nation, ada, bea, adaAttacks } = strip({}, "easy");
    const spare = NATION_DIFFICULTIES.easy.sparePercent;
    const low = (player: Player) => {
      player.troops = Math.floor((populationCap(game, player) * spare) / 100) - 50;
    };
    for (let i = 0; i < 12; i++) {
      nation.troops = populationCap(game, nation);
      low(ada);
      low(bea);
      run(intervalOf("easy"));
    }
    const attacks = () => ordersOf(1).filter((order) => order.type === "attack");
    expect(attacks()).toEqual([]);
    // An attack from a player that leaves them low is not answered either.
    nation.troops = populationCap(game, nation);
    ada.troops = 3000;
    adaAttacks(2900);
    run(2);
    expect(attacks()).toEqual([]);
  });

  it("turn again on a player back over B-NATION-SPARE, at easy", () => {
    const { game, ordersOf, run, nation, ada, bea } = strip({}, "easy");
    const spare = NATION_DIFFICULTIES.easy.sparePercent;
    const attacks = () => ordersOf(1).filter((order) => order.type === "attack");
    for (let i = 0; i < 24 && attacks().length === 0; i++) {
      nation.troops = populationCap(game, nation);
      // Over the share, and under the nation's troops: an easy nation holds half a player's cap.
      ada.troops = Math.floor((populationCap(game, ada) * (spare + 10)) / 100);
      bea.troops = ada.troops;
      run(intervalOf("easy"));
    }
    expect(attacks().length).toBeGreaterThan(0);
  });

  it("sail before fighting a neighbour down to scraps (R-BOT-18)", () => {
    // A strip that wraps: the nation on columns 0 to 29, two tiles of Ada at 30, then sea,
    // and a free island at 60 to 62, 17 tiles west of the nation's shore across the seam.
    const grid = new WorldGrid(80, 4);
    const kinds = new Uint8Array(grid.size).fill(TileKind.Water);
    for (let x = 0; x < 80; x++) {
      kinds[grid.index(x, 0)] = TileKind.Impassable;
      kinds[grid.index(x, 3)] = TileKind.Impassable;
      if (x <= 30 || (x >= 60 && x <= 62)) {
        for (const y of [1, 2]) kinds[grid.index(x, y)] = TileKind.Plains;
      }
    }
    const game = new Game({
      terrain: new Terrain(grid, kinds),
      seed: 5,
      players: [
        { id: 1, name: "Norland" },
        { id: 2, name: "Ada" },
      ],
      balance: { ...balance, spawnPhaseTicks: 0, attackSpeedDivisor: 1000 },
    });
    installAttacks(game);
    installBoats(game);
    installNations(game, [1], "hard", 0);
    for (let x = 0; x <= 30; x++) {
      for (const y of [1, 2]) game.territory.setOwner(grid.index(x, y), x < 30 ? 1 : 2);
    }
    (game.player(1) as Player).troops = 100_000;
    (game.player(2) as Player).troops = 2;
    const apply = vi.spyOn(game, "apply");
    for (let i = 0; i < interval; i++) game.step({ tick: game.tick, orders: [] });
    const orders = apply.mock.calls.filter(([id]) => id === 1).map(([, order]) => order);
    const moves = orders.filter((o) => o.type === "attack" || o.type === "embark");
    expect(moves).toHaveLength(1);
    const order = moves[0] as Order;
    expect(order.type).toBe("embark");
    expect(order.type === "embark" && game.terrain.landmassOf(order.target)).toBe(
      game.terrain.landmassOf(grid.index(61, 1)),
    );
  });

  it("feed an attack that is building pressure, with collapsing fronts on (R-BOT-16)", () => {
    const feeds = (collapsingFronts: boolean) => {
      const { game, grid, ordersOf, run, nation, ada, bea } = strip(
        { collapseBuildupTicks: 1000 },
        "hard",
        { collapsingFronts },
      );
      // Only a front on a player with more land is pressed: the nation keeps two columns.
      for (let tile = 0; tile < grid.size; tile++) {
        if (grid.x(tile) >= 22 && grid.x(tile) < 40) game.territory.setOwner(tile, 3);
      }
      // The attack overwhelms Ada's 3-tile front; what stays home is above the nation's
      // reserve, but under its trigger share (R-BOT-26). It starts just before the
      // nation decides, while Ada still holds more land than the nation.
      nation.troops = 5700;
      ada.troops = 7000;
      bea.troops = 7000;
      run(interval - 11);
      run(1, [{ player: 1, order: { type: "attack", target: grid.index(15, 1), troops: 4000 } }]);
      run(interval);
      return ordersOf(1).filter((order) => order.type === "attack" && grid.x(order.target) < 20)
        .length;
    };
    expect(feeds(true)).toBeGreaterThan(feeds(false));
  });

  it("attack no player during B-NATION-GRACE, but still answer an attacker (R-BOT-09)", () => {
    const grid = new WorldGrid(60, 3, { wrapsX: false });
    const game = new Game({
      terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
      seed: 5,
      players: [
        { id: 1, name: "Norland" },
        { id: 2, name: "Ada" },
      ],
      balance: { ...balance, spawnPhaseTicks: 0, attackSpeedDivisor: 1000, encircleMaxTiles: 1 },
    });
    installAttacks(game);
    installNations(game, [1], "hard", 10);
    for (let tile = 0; tile < grid.size; tile++) {
      game.territory.setOwner(tile, grid.x(tile) < 30 ? 1 : 2);
    }
    const nation = game.player(1) as Player;
    const ada = game.player(2) as Player;
    const apply = vi.spyOn(game, "apply");
    const run = (ticks: number, orders: { player: number; order: Order }[] = []) => {
      for (let i = 0; i < ticks; i++) {
        game.step({ tick: game.tick, orders: i === 0 ? orders : [] });
      }
    };
    nation.troops = 9000;
    ada.troops = 10;
    // Ten seconds of grace: Ada, easy prey, is left alone.
    run(60);
    expect(apply.mock.calls.filter(([, order]) => order.type !== "work")).toEqual([]);
    // Her attack is answered all the same.
    ada.troops = 6000;
    run(1, [{ player: 2, order: { type: "attack", target: grid.index(25, 1), troops: 5000 } }]);
    run(interval);
    expect(apply.mock.calls.some(([id, order]) => id === 1 && order.type === "attack")).toBe(true);
    apply.mockClear();
    // Once it is over, she is fair game without attacking first, from the nation's trigger share.
    nation.troops = 9000;
    run(100);
    expect(apply.mock.calls.some(([id, order]) => id === 1 && order.type === "attack")).toBe(true);
  });

  it("refuse unknown players", () => {
    const { game } = strip();
    expect(() => {
      installNations(game, [9], "easy");
    }).toThrow(RangeError);
  });
});

describe("nation starts (R-BOT-07)", () => {
  /** Plains 40 x 20 with a human, a nation whose home is set, and a bot. */
  function spawnGame(home: number) {
    const grid = new WorldGrid(40, 20);
    const game = new Game({
      terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
      seed: 9,
      players: [
        { id: 1, name: "You" },
        { id: 2, name: "Norland", start: home },
        { id: 3, name: "Bot" },
      ],
      balance,
    });
    installSpawn(game);
    installEconomy(game);
    const run = (ticks: number, orders: { player: number; order: Order }[] = []) => {
      for (let i = 0; i < ticks; i++) {
        game.step({ tick: game.tick, orders: i === 0 ? orders : [] });
      }
    };
    return { grid, game, run };
  }

  it("start on their tile when the spawn phase ends, however close a human picked", () => {
    const { grid, game, run } = spawnGame(220);
    const human = grid.index(14, 5);
    expect(grid.distance(human, 220)).toBeLessThan(balance.spawnDistance);
    run(1, [{ player: 1, order: { type: "spawn", tile: human } }]);
    expect(game.player(2)?.start).toBeUndefined();
    run(balance.spawnPhaseTicks - 1);
    expect(game.player(2)?.start).toBe(220);
    expect(game.territory.ownerOf(220)).toBe(2);
    // Their areas overlap: the human's tiles stay theirs.
    expect(game.territory.tileCount(2)).toBeGreaterThan(0);
    // The bot is placed at random afterwards, away from both.
    const bot = game.player(3)?.start as number;
    expect(grid.distance(bot, 220)).toBeGreaterThanOrEqual(spawnSettings(game).distance);
  });

  it("do not play when a human took their tile", () => {
    const { game, run } = spawnGame(220);
    run(1, [{ player: 1, order: { type: "spawn", tile: 221 } }]);
    run(balance.spawnPhaseTicks);
    const nation = game.player(2);
    expect(nation?.start).toBeUndefined();
    expect(nation?.alive).toBe(false);
    expect(game.territory.ownerOf(220)).toBe(1);
  });

  it("refuse a start off the map", () => {
    const grid = new WorldGrid(4, 4);
    const terrain = new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains));
    expect(
      () => new Game({ terrain, seed: 1, players: [{ id: 1, name: "N", start: 16 }], balance }),
    ).toThrow(RangeError);
  });

  it("play the same game on every run with bots around them (R-BOT-03)", () => {
    const play = () => {
      const grid = new WorldGrid(96, 48);
      const players = Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        name: `P${String(i)}`,
        ...(i < 4 ? { start: grid.index(12 + 24 * i, 12 + 8 * i) } : {}),
      }));
      const game = new Game({
        terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
        seed: 21,
        players,
        balance,
      });
      installSpawn(game);
      installAttacks(game);
      installBoats(game);
      installStructures(game);
      installEconomy(game);
      installBots(game, [5, 6, 7, 8], "hard");
      installNations(game, [1, 2, 3, 4], "hard");
      // Most land each nation held: one may since have been surrounded and taken (R-ATTACK-08).
      const peak = new Map<number, number>();
      for (let i = 0; i < 600; i++) {
        game.step({ tick: game.tick, orders: [] });
        for (const id of [1, 2, 3, 4]) {
          peak.set(id, Math.max(peak.get(id) ?? 0, game.territory.tileCount(id)));
        }
      }
      return { game, peak };
    };
    const { game: first, peak } = play();
    const { game: second } = play();
    expect(first.hash()).toBe(second.hash());
    for (const id of [1, 2, 3, 4]) {
      expect(peak.get(id)).toBeGreaterThan(100);
    }
    expect(first.territory.tileCount(NEUTRAL)).toBeLessThan(96 * 48);
  });
});
