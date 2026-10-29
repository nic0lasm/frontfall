import { describe, expect, it, vi } from "vitest";
import { installAttacks } from "../src/attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { installBoats } from "../src/boats.ts";
import { BOT_DIFFICULTIES, installBots, type BotDifficulty } from "../src/bots/index.ts";
import { installEconomy } from "../src/economy.ts";
import { Game, type Order, type Player } from "../src/game.ts";
import { installSpawn } from "../src/spawn.ts";
import { StructureKind, installStructures } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = { ...DEFAULT_BALANCE, spawnPhaseTicks: 10, spawnDistance: 12 };

/** A full game of bots only on a plains cylinder, with a lake in the middle. */
function botGame(seed: number, count: number, difficulty: BotDifficulty, width = 96, height = 48) {
  const grid = new WorldGrid(width, height);
  const kinds = new Uint8Array(grid.size).fill(TileKind.Plains);
  for (const tile of grid.tilesWithin(grid.index(width / 2, height / 2), 5)) {
    kinds[tile] = TileKind.Water;
  }
  const players = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Bot ${String(i)}`,
  }));
  const game = new Game({ terrain: new Terrain(grid, kinds), seed, players, balance });
  installSpawn(game);
  installEconomy(game);
  installAttacks(game);
  installBots(
    game,
    players.map((p) => p.id),
    difficulty,
  );
  const apply = vi.spyOn(game, "apply");
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) game.step({ tick: game.tick, orders: [] });
  };
  return { grid, game, apply, run };
}

/** Two players on a 10 x 3 cylinder, each holding whole columns, with no spawn phase. */
function duel(columns: Record<number, number[]>, difficulty: BotDifficulty = "hard") {
  const grid = new WorldGrid(10, 3);
  const game = new Game({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 5,
    players: [
      { id: 1, name: "Bot" },
      { id: 2, name: "Ada" },
    ],
    balance: { ...balance, spawnPhaseTicks: 0 },
  });
  installAttacks(game);
  installBots(game, [1], difficulty);
  for (const [player, xs] of Object.entries(columns)) {
    for (const x of xs) {
      for (let y = 0; y < 3; y++) game.territory.setOwner(grid.index(x, y), Number(player));
    }
  }
  const apply = vi.spyOn(game, "apply");
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) game.step({ tick: game.tick, orders: [] });
  };
  return { game, apply, run, bot: game.player(1) as Player, ada: game.player(2) as Player };
}

describe("bots", () => {
  it("make the same decisions on every run with the same seed (R-BOT-03)", () => {
    const first = botGame(11, 8, "hard");
    const second = botGame(11, 8, "hard");
    first.run(400);
    second.run(400);
    expect(first.apply).toHaveBeenCalled();
    expect(second.game.territory.owners).toEqual(first.game.territory.owners);
    expect(second.game.players()).toEqual(first.game.players());
    expect(second.game.random.state()).toEqual(first.game.random.state());
  });

  it("expand into unowned land (R-BOT-01)", () => {
    const { game, run } = botGame(3, 6, "normal");
    run(balance.spawnPhaseTicks);
    const start = game.players().map((p) => game.territory.tileCount(p.id));
    const neutral = game.territory.tileCount(NEUTRAL);
    run(800);
    for (const [i, player] of game.players().entries()) {
      expect(game.territory.tileCount(player.id)).toBeGreaterThan((start[i] as number) * 4);
    }
    expect(game.territory.tileCount(NEUTRAL)).toBeLessThan(neutral / 2);
  });

  it("only send orders that the game carries out, and never all their troops (R-BOT-03)", () => {
    const { game, apply, run } = botGame(8, 16, "hard");
    const sent: { troops: number; home: number }[] = [];
    apply.mockImplementation(function (this: Game, id: number, order: Order) {
      if (order.type === "attack") {
        sent.push({ troops: order.troops, home: (game.player(id) as Player).troops });
      }
      return Game.prototype.apply.call(this, id, order);
    });
    run(1500);
    expect(apply.mock.results.length).toBeGreaterThan(100);
    expect(apply.mock.results.every((result) => result.value === true)).toBe(true);
    expect(sent.every(({ troops, home }) => troops < home)).toBe(true);
  }, 30_000);

  it("act less often on easy than on hard (R-BOT-04)", () => {
    const easy = botGame(4, 8, "easy");
    const hard = botGame(4, 8, "hard");
    easy.run(400);
    hard.run(400);
    expect(easy.apply.mock.calls.length * 2).toBeLessThan(hard.apply.mock.calls.length);
  });

  it("decide at most once per interval each, spread over the interval", () => {
    const { game, apply, run } = botGame(2, 16, "hard");
    run(balance.spawnPhaseTicks);
    const interval = BOT_DIFFICULTIES.hard.intervalSeconds * balance.ticksPerSecond;
    const ticks: number[] = [];
    apply.mockImplementation((id: number, order: Order) => {
      ticks.push(game.tick);
      expect((game.tick + id) % interval).toBe(0);
      return Game.prototype.apply.call(game, id, order);
    });
    run(interval);
    expect(new Set(ticks).size).toBeGreaterThan(1);
  });

  it("do nothing during the spawn phase and are placed at its end (R-SPAWN-03)", () => {
    const { game, apply, run } = botGame(6, 4, "hard");
    run(balance.spawnPhaseTicks);
    expect(apply).not.toHaveBeenCalled();
    for (const player of game.players())
      expect(game.territory.tileCount(player.id)).toBeGreaterThan(0);
  });

  it("attack a much weaker neighbour once no free land is left (R-BOT-01)", () => {
    const { game, run, bot, ada } = duel({ 1: [0, 1, 2, 3, 4], 2: [5, 6, 7, 8, 9] });
    bot.troops = 1000;
    ada.troops = 15;
    run(BOT_DIFFICULTIES.hard.intervalSeconds * balance.ticksPerSecond + 1);
    expect(game.territory.tileCount(1)).toBeGreaterThan(15);
  });

  it("leave a stronger neighbour alone", () => {
    const { apply, run, bot, ada } = duel({ 1: [0, 1, 2, 3, 4], 2: [5, 6, 7, 8, 9] });
    bot.troops = 1000;
    ada.troops = 5000;
    run(50);
    expect(apply).not.toHaveBeenCalled();
  });

  it("prefer free land to a neighbour that is only somewhat weaker", () => {
    const { game, apply, run, bot, ada } = duel({ 1: [0, 1, 2], 2: [3, 4, 5] });
    // Enough above the reserve, which counts the base population too.
    bot.troops = 2000;
    ada.troops = 1700;
    run(BOT_DIFFICULTIES.hard.intervalSeconds * balance.ticksPerSecond);
    expect(apply).toHaveBeenCalledOnce();
    const order = apply.mock.calls[0]?.[1] as Order;
    expect(order.type === "attack" && game.territory.ownerOf(order.target)).not.toBe(2);
  });

  it("keep their reserve at home (B-BOT-RESERVE)", () => {
    const { apply, run, bot } = duel({ 1: [0, 1, 2, 3, 4] }, "easy");
    // Cap 15 * 40 = 600, reserve 50 % = 300: 307 troops leave 7 to send, less than one tile.
    bot.troops = 307;
    run(80);
    expect(apply).not.toHaveBeenCalled();
  });

  /** A bot alone on the west island of a strip; free islands start at the given columns. */
  function islandGame(width: number, islands: number[], overrides: Partial<Balance> = {}) {
    const grid = new WorldGrid(width, 4);
    const kinds = new Uint8Array(grid.size).fill(TileKind.Water);
    for (let x = 0; x < width; x++) {
      kinds[grid.index(x, 0)] = TileKind.Impassable;
      kinds[grid.index(x, 3)] = TileKind.Impassable;
    }
    for (const start of [0, ...islands]) {
      for (let x = start; x < start + 3; x++) {
        for (const y of [1, 2]) kinds[grid.index(x, y)] = TileKind.Plains;
      }
    }
    const game = new Game({
      terrain: new Terrain(grid, kinds),
      seed: 5,
      players: [
        { id: 1, name: "Bot" },
        { id: 2, name: "Ada" },
      ],
      balance: { ...balance, spawnPhaseTicks: 0, attackSpeedDivisor: 1000, ...overrides },
    });
    installAttacks(game);
    installBoats(game);
    installBots(game, [1], "hard");
    for (let x = 0; x < 3; x++) {
      for (const y of [1, 2]) game.territory.setOwner(grid.index(x, y), 1);
    }
    const apply = vi.spyOn(game, "apply");
    const bot = game.player(1) as Player;
    bot.troops = 2000;
    const run = (ticks: number) => {
      for (let i = 0; i < ticks; i++) game.step({ tick: game.tick, orders: [] });
    };
    return { grid, game, apply, bot, ada: game.player(2) as Player, run };
  }

  const hardInterval = BOT_DIFFICULTIES.hard.intervalSeconds * balance.ticksPerSecond;

  it("sail to a coast away from their shore once their land is full (R-BOT-05)", () => {
    // The rock at x = 8 is free but along the bot's shore; the island at x = 22 opens another front.
    const { grid, game, apply, run } = islandGame(44, [8, 22]);
    run(hardInterval);
    expect(apply).toHaveBeenCalledOnce();
    const order = apply.mock.calls[0]?.[1] as Order;
    expect(order.type).toBe("embark");
    expect(order.type === "embark" && game.terrain.landmassOf(order.target)).toBe(
      game.terrain.landmassOf(grid.index(22, 1)),
    );
    expect(game.boats).toHaveLength(1);
  });

  it("keep up to B-BOAT-MAX ships at sea", () => {
    // Slow ships to a far island: three decisions go by before the first one lands.
    const { game, apply, run } = islandGame(100, [50], { boatMax: 2, boatSpeed: 1 });
    run(3 * hardInterval);
    expect(game.boats).toHaveLength(2);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("wait a few decisions before searching the sea again when it offers nothing", () => {
    // The only island across the sea is Ada's, too strong to attack until she is suddenly weak.
    const { grid, game, apply, ada, run } = islandGame(44, [22]);
    for (let x = 22; x < 25; x++) {
      for (const y of [1, 2]) game.territory.setOwner(grid.index(x, y), 2);
    }
    ada.troops = 1_000_000;
    run(hardInterval);
    ada.troops = 0;
    // Decisions at the next three intervals skip the sea; the fifth searches it again.
    run(3 * hardInterval);
    expect(apply).not.toHaveBeenCalled();
    run(hardInterval);
    expect(apply).toHaveBeenCalledOnce();
    expect((apply.mock.calls[0]?.[1] as Order).type).toBe("embark");
  });

  it("look at more of a long border (R-BOT-05)", () => {
    // A bot on most of a 64 x 64 plain, with free land in one column only.
    const grid = new WorldGrid(64, 64);
    const game = new Game({
      terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
      seed: 5,
      players: [{ id: 1, name: "Bot" }],
      balance: { ...balance, spawnPhaseTicks: 0 },
    });
    installAttacks(game);
    installBots(game, [1], "hard");
    for (let tile = 0; tile < grid.size; tile++) {
      if (grid.x(tile) % 2 === 0 || grid.y(tile) % 2 === 0) game.territory.setOwner(tile, 1);
    }
    (game.player(1) as Player).troops = 100_000;
    const draws = vi.spyOn(game.random, "nextInt");
    for (let i = 0; i < hardInterval; i++) game.step({ tick: game.tick, orders: [] });
    const borders = game.territory.borderCount(1);
    expect(borders).toBeGreaterThan(256);
    expect(draws.mock.calls.length).toBe(Math.floor(Math.sqrt(borders)));
  });

  it("stop once eliminated", () => {
    const { apply, run, bot } = duel({ 1: [0, 1, 2, 3, 4] });
    bot.troops = 1000;
    bot.alive = false;
    run(50);
    expect(apply).not.toHaveBeenCalled();
  });

  it("refuse unknown players", () => {
    const { game } = duel({});
    expect(() => {
      installBots(game, [3], "easy");
    }).toThrow(RangeError);
  });

  it("build a city close to their start once their gold pays for it (R-BOT-06)", () => {
    const grid = new WorldGrid(60, 30, { wrapsX: false });
    const game = new Game({
      terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
      seed: 3,
      players: [
        { id: 1, name: "Bot" },
        { id: 2, name: "Ada" },
      ],
      balance: { ...balance, spawnPhaseTicks: 0, cityCost: 500, cityLand: 400 },
    });
    installStructures(game);
    installBots(game, [1], "normal");
    // The bot holds the west half; its start is near the middle of it, the front at x = 30.
    for (let tile = 0; tile < grid.size; tile++) {
      game.territory.setOwner(tile, grid.x(tile) < 30 ? 1 : 2);
    }
    const bot = game.player(1) as Player;
    bot.start = grid.index(15, 15);
    bot.gold = 499;
    const run = (ticks: number) => {
      for (let i = 0; i < ticks; i++) game.step({ tick: game.tick, orders: [] });
    };
    run(30);
    expect(game.structures).toHaveLength(0);
    bot.gold = 500 + 750;
    run(30);
    expect(game.structures.map((s) => [s.kind, s.player, s.tile])).toEqual([
      [StructureKind.City, 1, grid.index(15, 15)],
    ]);
    // 900 tiles support three cities; the next ones go further out, off the front.
    bot.gold = 10_000;
    run(100);
    expect(game.structures).toHaveLength(3);
    for (const city of game.structures) {
      expect(game.territory.isBorder(city.tile)).toBe(false);
      expect(grid.distance(city.tile, bot.start)).toBeLessThanOrEqual(2 * balance.buildSpacing);
    }
    expect(bot.gold).toBe(10_000 - 1000 - 2000);
  });
  it("build their port on the ocean, not on a lake closer to their start (R-BOT-06)", () => {
    const grid = new WorldGrid(60, 30, { wrapsX: false });
    const kinds = new Uint8Array(grid.size).fill(TileKind.Plains);
    for (let tile = 0; tile < grid.size; tile++) {
      const x = grid.x(tile);
      const y = grid.y(tile);
      // The ocean along the west edge, 11 tiles from the start; a lake of nine tiles 10 tiles north.
      if (x < 4 || (x >= 14 && x <= 16 && y >= 2 && y <= 4)) kinds[tile] = TileKind.Water;
    }
    const game = new Game({
      terrain: new Terrain(grid, kinds),
      seed: 3,
      players: [
        { id: 1, name: "Bot" },
        { id: 2, name: "Ada" },
      ],
      balance: { ...balance, spawnPhaseTicks: 0, cityCost: 500, portCost: 500 },
    });
    installStructures(game);
    installBots(game, [1], "normal");
    for (let tile = 0; tile < grid.size; tile++) {
      if (game.terrain.isOwnable(tile)) game.territory.setOwner(tile, grid.x(tile) < 30 ? 1 : 2);
    }
    const bot = game.player(1) as Player;
    bot.start = grid.index(15, 15);
    bot.gold = 10_000;
    for (let i = 0; i < 120; i++) game.step({ tick: game.tick, orders: [] });
    const ports = game.structures.filter((s) => s.kind === StructureKind.Port);
    expect(ports).toHaveLength(1);
    const port = (ports[0] as { tile: number }).tile;
    expect(grid.x(port)).toBe(4);
    expect(game.terrain.isOceanCoast(port)).toBe(true);
  });
});
