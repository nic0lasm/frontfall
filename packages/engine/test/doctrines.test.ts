import { describe, expect, it } from "vitest";
import { captureCost, defenderLoss, installAttacks } from "../src/attacks.ts";
import { installNations } from "../src/bots/nations.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import {
  DOCTRINE_COUNT,
  DOCTRINE_EFFECTS,
  Doctrine,
  doctrinePercent,
  installDoctrines,
} from "../src/doctrines.ts";
import { goldIncome, installEconomy, populationCap } from "../src/economy.ts";
import { Game, type Order, type Player } from "../src/game.ts";
import { orderError } from "../src/orders.ts";
import { loadSnapshot, saveSnapshot } from "../src/snapshot.ts";
import { installSpawn } from "../src/spawn.ts";
import { StructureKind, structureCost } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";
import { WHOLE_PRICES } from "./whole-prices.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  ...WHOLE_PRICES,
  tileWeightTenths: [100, 100, 100],
};

/** Ada holds the left half of a 10 x 2 strip, Bea the right half. */
function newGame(doctrines = true) {
  const grid = new WorldGrid(10, 2, { wrapsX: false });
  const setup = {
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 1,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance,
    rules: { doctrines },
  };
  const create = () => {
    const game = new Game(setup);
    installSpawn(game);
    installDoctrines(game);
    installEconomy(game);
    installAttacks(game);
    return game;
  };
  const game = create();
  for (let tile = 0; tile < grid.size; tile++) {
    game.territory.setOwner(tile, grid.x(tile) < 5 ? 1 : 2);
  }
  const ada = game.player(1) as Player;
  const bea = game.player(2) as Player;
  const pick = (player: number, code: number) => {
    game.step({ tick: game.tick, orders: [{ player, order: { type: "doctrine", pick: code } }] });
  };
  return { grid, game, ada, bea, pick, create };
}

const pickOrder = (pick: number): Order => ({ type: "doctrine", pick });

describe("doctrines (R-DOCTRINE)", () => {
  it("are picked in the spawn phase, and again until it ends", () => {
    const { game, ada, pick } = newGame();
    expect(game.phase).toBe("spawn");
    expect(ada.doctrine).toBe(Doctrine.Balanced);
    pick(1, Doctrine.Conqueror);
    expect(ada.doctrine).toBe(Doctrine.Conqueror);
    pick(1, Doctrine.Bastion);
    expect(ada.doctrine).toBe(Doctrine.Bastion);
  });

  it("are refused in a game without doctrines, after the spawn phase, or when unknown", () => {
    const { game, ada } = newGame();
    expect(orderError(game, ada, pickOrder(Doctrine.Merchant))).toBeUndefined();
    expect(orderError(game, ada, pickOrder(DOCTRINE_COUNT))).toBe("unknown doctrine");
    expect(orderError(game, ada, pickOrder(-1))).toBe("unknown doctrine");
    expect(orderError(newGame(false).game, ada, pickOrder(1))).toBe("this game has no doctrines");
    for (let i = 0; i < balance.spawnPhaseTicks + 1; i++) {
      game.step({ tick: game.tick, orders: [] });
    }
    expect(game.phase).toBe("play");
    expect(orderError(game, ada, pickOrder(1))).toBe("doctrines are picked during the spawn phase");
  });

  it("change nothing for the balanced doctrine, nor without the rule", () => {
    const { game, ada } = newGame();
    expect(DOCTRINE_EFFECTS[Doctrine.Balanced]).toEqual({
      pace: 100,
      attackerLoss: 100,
      defenderLoss: 100,
      gold: 100,
      cap: 100,
      trade: 100,
      fortCost: 100,
    });
    const before = [goldIncome(game, ada), populationCap(game, ada)];
    const off = newGame(false);
    off.ada.doctrine = Doctrine.Conqueror;
    expect(doctrinePercent(off.game, 1, "gold")).toBe(100);
    expect([goldIncome(off.game, off.ada), populationCap(off.game, off.ada)]).toEqual(before);
  });

  it("raise and lower income, cap and the price of a fort", () => {
    const { game, ada } = newGame();
    const base = { gold: goldIncome(game, ada), cap: populationCap(game, ada) };
    const fort = structureCost(game, 1, StructureKind.Fort);
    ada.doctrine = Doctrine.Merchant;
    expect(goldIncome(game, ada)).toBeGreaterThan(base.gold);
    ada.doctrine = Doctrine.Conqueror;
    expect(goldIncome(game, ada)).toBeLessThan(base.gold);
    expect(populationCap(game, ada)).toBeLessThan(base.cap);
    ada.doctrine = Doctrine.Bastion;
    expect(populationCap(game, ada)).toBeGreaterThan(base.cap);
    expect(structureCost(game, 1, StructureKind.Fort)).toBeLessThan(fort);
  });

  it("make land cheaper or dearer for the attacker, and spare a bastion's troops", () => {
    const { game, ada, bea, grid } = newGame();
    ada.troops = bea.troops = 100_000;
    const tile = grid.size - 1;
    const base = captureCost(game, tile, bea, 1, 50_000);
    const loss = defenderLoss(game, tile, bea);
    ada.doctrine = Doctrine.Conqueror;
    expect(captureCost(game, tile, bea, 1, 50_000)).toBeLessThan(base);
    ada.doctrine = Doctrine.Merchant;
    expect(captureCost(game, tile, bea, 1, 50_000)).toBeGreaterThan(base);
    bea.doctrine = Doctrine.Bastion;
    expect(defenderLoss(game, tile, bea)).toBeLessThan(loss);
  });

  it("keep every effect within twenty percent", () => {
    for (const effects of DOCTRINE_EFFECTS) {
      for (const percent of Object.values(effects)) {
        expect(Math.abs(percent - 100)).toBeLessThanOrEqual(20);
      }
    }
  });

  it("survive a snapshot and show in the state hash", () => {
    const { game, ada, bea, create, pick } = newGame();
    pick(1, Doctrine.Merchant);
    pick(2, Doctrine.Bastion);
    const hash = game.hash();
    const loaded = loadSnapshot(saveSnapshot(game, "test"), "test", create);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.game.player(1)?.doctrine).toBe(ada.doctrine);
    expect(loaded.game.player(2)?.doctrine).toBe(bea.doctrine);
    expect(loaded.game.hash()).toBe(hash);
    pick(2, Doctrine.Conqueror);
    expect(game.hash()).not.toBe(hash);
  });

  it("are picked by nations on the first tick, the same on every run", () => {
    const picks = (seed: number, doctrines = true) => {
      const grid = new WorldGrid(10, 2, { wrapsX: false });
      const game = new Game({
        terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
        seed,
        players: [
          { id: 1, name: "Ada" },
          { id: 2, name: "Bea" },
        ],
        balance,
        rules: { doctrines },
      });
      installSpawn(game);
      installDoctrines(game);
      installNations(game, [1, 2], "normal", 0);
      game.step({ tick: 0, orders: [] });
      return [game.player(1)?.doctrine, game.player(2)?.doctrine];
    };
    const first = picks(1);
    expect(first.every((code) => code !== undefined && code >= 1 && code <= 3)).toBe(true);
    expect(picks(1)).toEqual(first);
    const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8].flatMap((seed) => picks(seed)));
    expect(seen.size).toBeGreaterThan(1);
    expect(picks(1, false)).toEqual([0, 0]);
  });
});
