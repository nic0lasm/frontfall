import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import { installNations } from "../src/bots/index.ts";
import { createGame } from "../src/create-game.ts";
import { populationCap } from "../src/economy.ts";
import { Disable, type Order, type Player } from "../src/game.ts";
import { DiplomacyError } from "../src/diplomacy.ts";
import { GiftError } from "../src/gifts.ts";
import { orderError } from "../src/orders.ts";
import { BuildError, StructureKind } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WarshipError } from "../src/warships.ts";
import { WorldGrid } from "../src/world-grid.ts";

/** A 40 × 20 plain: Ada holds the west half, Bea the east half, Cy one column of each. */
function newGame(disabled = 0) {
  const grid = new WorldGrid(40, 20, { wrapsX: false });
  const kinds = new Uint8Array(grid.size).fill(TileKind.Plains);
  // A strip of sea along the south edge, for ports.
  for (let x = 0; x < 40; x++) kinds[grid.index(x, 19)] = TileKind.Water;
  const game = createGame({
    terrain: new Terrain(grid, kinds),
    seed: 3,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
      { id: 3, name: "Cy" },
    ],
    balance: {
      ...DEFAULT_BALANCE,
      // Gold counts below leave out the income every player earns (B-GOLD-BASE).
      goldBase: 0,
      spawnPhaseTicks: 0,
      buildTicks: 1,
      goldPerThousandTroops: 0,
      // Nothing grows and nobody deserts: troops stay where the tests put them.
      growthBase: 0,
      growthDivisor: Number.MAX_SAFE_INTEGER,
      desertionBasisPoints: 0,
    },
    disabled,
  });
  for (let tile = 0; tile < grid.size; tile++) {
    if (!game.terrain.isOwnable(tile)) continue;
    const x = grid.x(tile);
    game.territory.setOwner(tile, x === 0 || x === 39 ? 3 : x < 20 ? 1 : 2);
  }
  for (const player of game.players()) {
    player.gold = 1_000_000;
    player.troops = 10_000;
  }
  const step = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  return {
    game,
    grid,
    step,
    ada: game.player(1) as Player,
    bea: game.player(2) as Player,
  };
}

/** An alliance that outlasts the test, put in place as an order would have. */
function ally(game: ReturnType<typeof newGame>["game"], a: number, b: number): void {
  game.alliances.push({ a, b, until: game.tick + 1_000_000, renewA: false, renewB: false });
}

const gift = (target: number, troops: number, gold: number): Order => ({
  type: "gift",
  target,
  troops,
  gold,
});

describe("gifts (R-DIPLO-06)", () => {
  it("move troops and gold to another player at once, and every player is told", () => {
    const { game, ada, bea, step } = newGame();
    ally(game, 1, 2);
    expect(step([{ player: 1, order: gift(2, 4000, 250_000) }])).toBe(1);
    expect(ada.troops).toBe(6000);
    expect(bea.troops).toBe(14_000);
    expect(ada.gold).toBe(750_000);
    expect(bea.gold).toBe(1_250_000);
    expect(game.diplomacyEvents).toContainEqual({ tick: 0, type: "gift", a: 1, b: 2 });
  });

  it("send no more troops than the receiver's population cap has room for", () => {
    const { game, ada, bea, step } = newGame();
    ally(game, 1, 2);
    const room = populationCap(game, bea) - bea.troops;
    ada.troops = room + 5000;
    step([{ player: 1, order: gift(2, room + 5000, 0) }]);
    expect(bea.troops).toBe(populationCap(game, bea));
    expect(ada.troops).toBe(5000);
    expect(orderError(game, ada, gift(2, 100, 0))).toBe(GiftError.Full);
    // Gold still goes through.
    expect(orderError(game, ada, gift(2, 100, 1))).toBeUndefined();
  });

  it("are refused between players at war, to players out of the game, and when there is nothing or too much to send", () => {
    const { game, grid, ada, step } = newGame();
    (game.player(3) as Player).troops = 0;
    expect(orderError(game, ada, gift(2, 0, 0))).toBe(GiftError.Empty);
    expect(orderError(game, ada, gift(9, 10, 0))).toBe(DiplomacyError.Player);
    expect(orderError(game, ada, gift(1, 10, 0))).toBe(GiftError.Self);
    expect(orderError(game, ada, gift(2, 10_001, 0))).toBe(GiftError.Troops);
    expect(orderError(game, ada, gift(2, 0, 1_000_001))).toBe(GiftError.Gold);
    expect(orderError(game, ada, gift(2, -1, 5))).toBe(GiftError.Amount);
    step([{ player: 1, order: { type: "attack", target: grid.index(20, 5), troops: 1000 } }]);
    expect(orderError(game, ada, gift(2, 10, 0))).toBe(GiftError.War);
    // Cy, out of the fight, takes gifts only once allied.
    expect(orderError(game, ada, gift(3, 10, 0))).toBe(GiftError.Ally);
    ally(game, 1, 3);
    expect(orderError(game, ada, gift(3, 10, 0))).toBeUndefined();
    step([{ player: 2, order: { type: "embargo", target: 3, on: 1 } }]);
    expect(orderError(game, game.player(3) as Player, gift(2, 0, 10))).toBe(GiftError.War);
    // Nobody gives to a player who is out of the game.
    (game.player(3) as Player).alive = false;
    expect(orderError(game, ada, gift(3, 10, 0))).toBe(DiplomacyError.Player);
  });
});

describe("gifts in the spawn phase", () => {
  it("wait for the play phase", () => {
    const grid = new WorldGrid(8, 8, { wrapsX: false });
    const game = createGame({
      terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
      seed: 1,
      players: [
        { id: 1, name: "Ada" },
        { id: 2, name: "Bea" },
      ],
    });
    expect(orderError(game, game.player(1) as Player, gift(2, 0, 1))).toBe(GiftError.Early);
  });
});

describe("games that leave things out (R-MODE-03)", () => {
  it("refuse to build what they leave out, and warships too", () => {
    const { game, grid, ada, step } = newGame(Disable.Silo | Disable.Warships);
    const build = (structure: number, tile: number): Order => ({ type: "build", structure, tile });
    expect(orderError(game, ada, build(StructureKind.Silo, grid.index(5, 5)))).toBe(
      BuildError.Disabled,
    );
    expect(orderError(game, ada, build(StructureKind.City, grid.index(5, 5)))).toBeUndefined();
    const port = grid.index(10, 18);
    step([{ player: 1, order: build(StructureKind.Port, port) }]);
    step();
    expect(game.structures.some((s) => s.tile === port)).toBe(true);
    expect(orderError(game, ada, { type: "warship", port })).toBe(WarshipError.Disabled);
  });

  it("leave warships out with ports, and refuse embargoes, with no trade to cut", () => {
    const { game, ada } = newGame(Disable.Port);
    expect(game.disabled).toBe(Disable.Port | Disable.Warships);
    expect(game.allows(Disable.Warships)).toBe(false);
    expect(orderError(game, ada, { type: "embargo", target: 2, on: 1 })).toBe(
      DiplomacyError.NoTrade,
    );
    expect(newGame().game.disabled).toBe(0);
  });

  it("count in the state hash only when they leave something out", () => {
    const all = newGame().game.hash();
    expect(newGame(0).game.hash()).toBe(all);
    expect(newGame(Disable.City).game.hash()).not.toBe(all);
    expect(() => newGame(64)).toThrow(RangeError);
  });

  it("keep nations from building what is left out", () => {
    const { game, step } = newGame(Disable.City | Disable.Fort | Disable.Port);
    installNations(game, [2], "hard");
    for (let i = 0; i < 600; i++) step();
    expect(game.structures).toHaveLength(0);
  });
});
