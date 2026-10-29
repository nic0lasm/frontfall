import { describe, expect, it } from "vitest";
import { captureCost } from "../src/attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { installBots, installNations } from "../src/bots/index.ts";
import { capitalAim, capitalRadius, capitalThreat, guardedByCapital } from "../src/capitals.ts";
import { createGame } from "../src/create-game.ts";
import type { Game, Order, Player } from "../src/game.ts";
import { loadSnapshot, saveSnapshot } from "../src/snapshot.ts";
import { StructureKind } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";

const grid = new WorldGrid(40, 20, { wrapsX: false });
const terrain = new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains));
const balance: Balance = {
  ...DEFAULT_BALANCE,
  spawnPhaseTicks: 2,
  spawnDistance: 5,
  spawnRadius: 2,
  capitalRadius: 3,
  capitalAlert: 6,
  capitalGraceTicks: 0,
  fortRadius: 3,
  buildTicks: 0,
  fortCost: 0,
};
const ADA = grid.index(5, 10);
const BEA = grid.index(30, 10);

function newGame(capitals = true, overrides: Partial<Balance> = {}): Game {
  return createGame({
    terrain,
    seed: 7,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...balance, ...overrides },
    rules: { capitals },
  });
}

const spawn = (tile: number): Order => ({ type: "spawn", tile });

const run = (game: Game, orders: { player: number; order: Order }[] = []) =>
  game.step({ tick: game.tick, orders });
const player = (game: Game, id: number) => game.player(id) as Player;

/** Both players start, and play begins. */
function started(capitals = true): Game {
  const game = newGame(capitals);
  run(game, [
    { player: 1, order: spawn(ADA) },
    { player: 2, order: spawn(BEA) },
  ]);
  while (game.phase === "spawn") run(game);
  run(game);
  return game;
}

describe("capital mode", () => {
  it("makes each player's start tile their capital when play starts (R-CAP-01)", () => {
    const game = newGame();
    run(game, [{ player: 1, order: spawn(ADA) }]);
    expect(player(game, 1).capital).toBeUndefined();
    const played = started();
    expect(player(played, 1).capital).toBe(ADA);
    expect(player(played, 2).capital).toBe(BEA);
  });

  it("gives no capital to anyone in a game without the rule", () => {
    const game = started(false);
    expect(game.rules.capitals).toBe(false);
    expect(player(game, 1).capital).toBeUndefined();
    expect(capitalThreat(game, 1)).toBe(NEUTRAL);
    expect(capitalAim(game, BEA)).toBe(BEA);
  });

  it("makes land near a capital dearer to take, the stronger of a fort and a capital only (R-CAP-02)", () => {
    const game = started();
    const near = grid.index(30, 12);
    const far = grid.index(30, 16);
    game.territory.setOwner(far, 2);
    expect(guardedByCapital(game, near, 2)).toBe(true);
    expect(guardedByCapital(game, far, 2)).toBe(false);
    expect(capitalRadius(game)).toBe(3);
    const bea = player(game, 2);
    bea.troops = 0;
    expect(captureCost(game, far, bea) * 3).toBe(captureCost(game, near, bea));
    run(game, [{ player: 2, order: { type: "build", structure: StructureKind.Fort, tile: near } }]);
    run(game);
    bea.troops = 0;
    // A fort at 200 % under a capital at 300 %: 300 %, not 600 %.
    expect(captureCost(game, near, bea)).toBe(captureCost(game, far, bea) * 3);
  });

  it("hands all of a player's land and gold and half of their troops to whoever takes their capital (R-CAP-03, R-ECO-08)", () => {
    const game = started();
    const ada = player(game, 1);
    const bea = player(game, 2);
    const total = game.territory.tileCount(1) + game.territory.tileCount(2);
    ada.troops = 1000;
    ada.gold = 500;
    bea.troops = 400;
    bea.gold = 0;
    game.territory.setOwner(ADA, 2);
    run(game);
    expect(ada.alive).toBe(false);
    expect(game.territory.tileCount(1)).toBe(0);
    expect(game.territory.tileCount(2)).toBe(total);
    expect(bea.gold).toBeGreaterThanOrEqual(500);
    expect(bea.troops).toBeGreaterThanOrEqual(900);
    expect(game.capitalFalls).toEqual([{ tick: game.tick - 1, player: 1, by: 2, tile: ADA }]);
    expect(game.diplomacyEvents.slice(-2)).toMatchObject([
      { type: "capital", a: 2, b: 1 },
      { type: "eliminated", a: 2, b: 1, gold: 500 },
    ]);
    expect(game.winner).toBe(2);
  });

  it("moves a razed capital to the closest land left, at the price of half the troops (R-CAP-04)", () => {
    const game = started();
    const ada = player(game, 1);
    ada.troops = 1000;
    game.territory.setOwner(ADA, NEUTRAL);
    run(game);
    expect(ada.alive).toBe(true);
    expect(ada.troops).toBeLessThan(600);
    const moved = ada.capital as number;
    expect(game.territory.ownerOf(moved)).toBe(1);
    expect(grid.squaredDistance(moved, ADA)).toBe(1);
    expect(game.capitalFalls.at(-1)).toMatchObject({ player: 1, by: NEUTRAL, tile: ADA });
  });

  it("only moves a capital taken before the grace is over (R-CAP-06)", () => {
    const game = newGame(true, { capitalGraceTicks: 100 });
    run(game, [
      { player: 1, order: spawn(ADA) },
      { player: 2, order: spawn(BEA) },
    ]);
    while (game.phase === "spawn") run(game);
    run(game);
    game.territory.setOwner(ADA, 2);
    run(game);
    expect(player(game, 1).alive).toBe(true);
    expect(game.capitalFalls).toEqual([]);
    expect(grid.squaredDistance(player(game, 1).capital as number, ADA)).toBe(1);
    expect(capitalThreat(game, 1)).toBe(NEUTRAL);
  });

  it("warns of an attack whose land comes within reach of the capital (R-CAP-05)", () => {
    const game = started();
    // Bea's land reaches out to within 6 tiles of Ada's capital, and Bea attacks her.
    for (let x = 8; x < 28; x++) game.territory.setOwner(grid.index(x, 10), 2);
    expect(capitalThreat(game, 1)).toBe(NEUTRAL);
    player(game, 2).troops = 5000;
    run(game, [{ player: 2, order: { type: "attack", target: grid.index(7, 10), troops: 2000 } }]);
    expect(game.attacks.some((a) => a.player === 2 && a.target === 1)).toBe(true);
    expect(capitalThreat(game, 1)).toBe(2);
    expect(capitalThreat(game, 2)).toBe(NEUTRAL);
    expect(capitalAim(game, grid.index(5, 11))).toBe(ADA);
  });

  it("keeps capitals and falls in snapshots, and hashes them", () => {
    const game = started();
    game.territory.setOwner(ADA, NEUTRAL);
    run(game);
    const bytes = saveSnapshot(game, "test");
    const loaded = loadSnapshot(bytes, "test", () => newGame());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.game.hash()).toBe(game.hash());
    expect(player(loaded.game, 1).capital).toBe(player(game, 1).capital);
    expect(loaded.game.capitalFalls).toEqual(game.capitalFalls);
    // The rule is part of the setup: a game without it does not take the snapshot.
    expect(loadSnapshot(bytes, "test", () => newGame(false)).ok).toBe(false);
    const other = started();
    player(other, 1).capital = BEA;
    expect(other.hash()).not.toBe(started().hash());
  });

  it("hashes a game without capitals as one set up before the rule existed", () => {
    const players = [{ id: 1, name: "Ada" }];
    const without = createGame({ terrain, seed: 7, players, balance });
    const off = createGame({ terrain, seed: 7, players, balance, rules: { capitals: false } });
    expect(off.hash()).toBe(without.hash());
    expect(off.setupDigest()).toBe(without.setupDigest());
  });
});

describe("computer players in capital mode (R-BOT-17)", () => {
  /** A bot and a much stronger nation side by side. */
  function duel(): Game {
    const game = createGame({
      terrain,
      seed: 11,
      players: [
        { id: 1, name: "Bot" },
        { id: 2, name: "Nation", start: BEA },
      ],
      balance: { ...balance, capitalAlert: 40, winSharePercent: 100 },
      rules: { capitals: true },
    });
    installBots(game, [1], "normal");
    installNations(game, [2], "hard", 0);
    run(game, [{ player: 1, order: spawn(ADA) }]);
    return game;
  }

  it("aims a nation's attacks on a player at that player's capital, and takes it", () => {
    const game = duel();
    let aimed = false;
    for (let t = 0; t < 3000 && game.winner === undefined; t++) {
      run(game);
      if (game.phase === "play" && t > 50) {
        const nation = player(game, 2);
        nation.troops = Math.max(nation.troops, 50_000);
      }
      aimed ||= game.attacks.some((a) => a.player === 2 && a.target === 1 && a.aim === ADA);
    }
    expect(aimed).toBe(true);
    expect(game.winner).toBe(2);
    expect(game.capitalFalls).toContainEqual(expect.objectContaining({ player: 1, by: 2 }));
  });
});
