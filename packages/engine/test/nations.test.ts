import { describe, expect, it, vi } from "vitest";
import { installAttacks } from "../src/attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { installBoats } from "../src/boats.ts";
import type { BotDifficulty } from "../src/bots/difficulty.ts";
import {
  installBots,
  installNations,
  NATION_FULL_PERCENT,
  NATION_DIFFICULTIES,
  NATION_WORK_PERCENT,
} from "../src/bots/index.ts";
import { installEconomy, populationCap } from "../src/economy.ts";
import { Game, type GameRules, type Order, type Player } from "../src/game.ts";
import { installSpawn, spawnSettings } from "../src/spawn.ts";
import { StructureKind, installStructures } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = { ...DEFAULT_BALANCE, spawnPhaseTicks: 10, spawnDistance: 12 };
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
  it("hold under attack while their troops are at most B-NATION-HOLD of their cap (R-BOT-08)", () => {
    const { game, nation, ada, bea, ordersOf, run, adaAttacks } = strip();
    nation.troops = 1000;
    ada.troops = 5000;
    // Bea is easy prey: a bot would turn on her.
    bea.troops = 10;
    adaAttacks();
    expect(nation.troops * 100).toBeLessThanOrEqual(
      populationCap(game, nation) * NATION_DIFFICULTIES.hard.holdPercent,
    );
    run(1);
    expect(game.attacks.some((attack) => attack.player === 2 && attack.target === 1)).toBe(true);
    expect(ordersOf(1)).toEqual([]);
  });

  it("keep playing through attacks too small to threaten them (B-NATION-THREAT)", () => {
    // Easy nations do not hunt the leader (R-BOT-14), which Ada becomes.
    const { game, grid, nation, ada, bea, ordersOf, run, adaAttacks } = strip({}, "easy");
    nation.troops = 4000;
    ada.troops = 5000;
    bea.troops = 10;
    // Under a tenth of the nation's troops: it plays on, and turns on Bea rather than answer Ada.
    adaAttacks(300);
    run(1);
    expect(game.attacks.some((attack) => attack.player === 2 && attack.target === 1)).toBe(true);
    const targets = ordersOf(1).map((order) =>
      order.type === "attack" ? grid.x(order.target) : -1,
    );
    expect(targets).toEqual([40]);
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
    adaAttacks();
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

  it("leave alone a neighbour that is weaker but not by B-NATION-ODDS (R-BOT-09)", () => {
    const { ordersOf, run, nation, ada, bea } = strip();
    nation.troops = 4000;
    // Denser than the nation by a tenth on both sides: a hard bot would attack.
    const denser = (4000 * (NATION_DIFFICULTIES.hard.oddsPercent + 10)) / 100;
    ada.troops = denser;
    bea.troops = denser;
    run(3 * interval);
    expect(ordersOf(1)).toEqual([]);
  });

  it("put troops to work while full and left alone, and call them back when attacked (R-BOT-15)", () => {
    const { game, nation, ada, bea, workOf, run, adaAttacks } = strip();
    installEconomy(game);
    const cap = populationCap(game, nation);
    // Too dense to attack, so the nation keeps its troops at home.
    ada.troops = 10 * cap;
    bea.troops = 10 * cap;
    nation.troops = Math.floor(cap / 2);
    run(interval);
    expect(workOf(1)).toEqual([]);
    nation.troops = cap;
    run(interval);
    expect(workOf(1)).toEqual([NATION_WORK_PERCENT]);
    expect(nation.workShare).toBe(NATION_WORK_PERCENT);
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

  it("take a bot's odds once their army is full (B-NATION-FULL)", () => {
    const { game, ordersOf, run, nation, ada, bea } = strip();
    const cap = populationCap(game, nation);
    // Just under full with neighbours a little denser, then full with neighbours as dense.
    nation.troops = Math.floor((cap * NATION_FULL_PERCENT) / 100) - 1;
    ada.troops = nation.troops + 120;
    bea.troops = nation.troops + 120;
    run(interval);
    expect(ordersOf(1)).toEqual([]);
    nation.troops = cap;
    ada.troops = cap;
    bea.troops = cap;
    run(interval);
    expect(ordersOf(1).map((order) => order.type)).toEqual(["attack"]);
  });

  it("turn on the leader first from B-NATION-HUNT, odds allowing, but not on easy (R-BOT-14)", () => {
    for (const difficulty of ["hard", "easy"] as const) {
      const { game, grid, ordersOf, run, nation, ada, bea } = strip({}, difficulty);
      // Ada leads with 25 columns out of 60, thinner than the nation; Bea is much weaker still.
      for (let y = 0; y < 3; y++) {
        for (let x = 20; x < 25; x++) game.territory.setOwner(grid.index(x, y), 2);
      }
      nation.troops = 4000;
      ada.troops = 4000;
      bea.troops = 10;
      run(intervalOf(difficulty));
      const targets = ordersOf(1).map((order) =>
        order.type === "attack" ? game.territory.ownerOf(order.target) : -1,
      );
      expect(targets).toEqual([difficulty === "hard" ? 2 : 3]);
    }
    expect(NATION_DIFFICULTIES.easy.huntPercent).toBe(0);
  });

  it("fight one player at a time (R-BOT-09)", () => {
    const { game, grid, ordersOf, run, nation, ada, bea } = strip();
    nation.troops = 9000;
    ada.troops = 1000;
    run(1, [{ player: 1, order: { type: "attack", target: grid.index(15, 1), troops: 3000 } }]);
    // Bea is now much weaker than Ada.
    bea.troops = 10;
    run(2 * interval);
    expect(game.attacks.some((attack) => attack.player === 1 && attack.target === 2)).toBe(true);
    const targets = ordersOf(1)
      .slice(1)
      .map((order) => (order.type === "attack" ? grid.x(order.target) : -1));
    expect(targets.length).toBeGreaterThan(0);
    for (const x of targets) expect(x).toBeLessThan(20);
    expect(game.attacks.some((attack) => attack.player === 1 && attack.target === 3)).toBe(false);
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
      // Ada is too dense for the nation's odds, yet the attack overwhelms her 3-tile front.
      nation.troops = 3000;
      ada.troops = 4000;
      bea.troops = 4000;
      run(1, [{ player: 1, order: { type: "attack", target: grid.index(15, 1), troops: 2000 } }]);
      run(2 * interval);
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
    // Once it is over, she is fair game without attacking first.
    run(100);
    expect(apply.mock.calls.some(([id, order]) => id === 1 && order.type === "attack")).toBe(true);
  });

  it("do not pile a third nation on a player who does not lead, early on (B-NATION-PILE)", () => {
    // Ada (4) holds the middle row of the left half, nations 2 and 3 the rows
    // above and below, and nation 1 the right half: it leads, Ada does not.
    const play = (first: number[]) => {
      const grid = new WorldGrid(60, 3, { wrapsX: false });
      const game = new Game({
        terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
        seed: 5,
        players: [
          { id: 1, name: "Norland" },
          { id: 2, name: "Sudland" },
          { id: 3, name: "Westland" },
          { id: 4, name: "Ada" },
        ],
        balance: { ...balance, spawnPhaseTicks: 0, attackSpeedDivisor: 1000, encircleMaxTiles: 1 },
      });
      installAttacks(game);
      installNations(game, [1, 2, 3], "hard", 0);
      for (let tile = 0; tile < grid.size; tile++) {
        const x = grid.x(tile);
        const y = Math.floor(tile / 60);
        game.territory.setOwner(tile, x >= 30 ? 1 : y === 0 ? 2 : y === 2 ? 3 : 4);
      }
      // Nation 1, the leader, is too dense for the others to attack.
      for (const id of [1, 2, 3]) (game.player(id) as Player).troops = id === 1 ? 90_000 : 9000;
      (game.player(4) as Player).troops = 10;
      const orders: { player: number; order: Order }[] = first.map((player) => ({
        player,
        order: { type: "attack", target: grid.index(29, 1), troops: 4000 },
      }));
      game.step({ tick: game.tick, orders });
      // Every nation decides once; the attacks on Ada are still under way.
      for (let i = 0; i < interval; i++) game.step({ tick: game.tick, orders: [] });
      return game.attacks.filter((attack) => attack.player === 3 && attack.target === 4);
    };
    // Nation 1 alone: nation 3 joins in. With nations 1 and 2 already on Ada, it does not.
    expect(play([1]).length).toBeGreaterThan(0);
    expect(play([1, 2])).toEqual([]);
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
      for (let i = 0; i < 600; i++) game.step({ tick: game.tick, orders: [] });
      return game;
    };
    const first = play();
    const second = play();
    expect(first.hash()).toBe(second.hash());
    for (const id of [1, 2, 3, 4]) {
      expect(first.territory.tileCount(id)).toBeGreaterThan(0);
    }
    expect(first.territory.tileCount(NEUTRAL)).toBeLessThan(96 * 48);
  });
});
