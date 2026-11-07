import { DEFAULT_BALANCE, type Balance } from "../../src/balance.ts";
import { installBots, installNations } from "../../src/bots/index.ts";
import { createGame } from "../../src/create-game.ts";
import { Doctrine } from "../../src/doctrines.ts";
import {
  Disable,
  OperatorBonus,
  type Game,
  type GameSetup,
  type Order,
  type Player,
} from "../../src/game.ts";
import type { Landmark } from "../../src/landmarks.ts";
import { MissileSize } from "../../src/missiles.ts";
import { orderError } from "../../src/orders.ts";
import { StructureKind } from "../../src/structures.ts";
import { Terrain, TileKind } from "../../src/terrain.ts";
import { WorldGrid } from "../../src/world-grid.ts";

/**
 * Two busy games on one small map, for the tests that load snapshots and pin
 * the state: every rule with state of its own comes into play. The first has
 * no special rule; the second has every one, so every gate of the state hash
 * and of the snapshot is crossed.
 */

/** The build the snapshots of these games are saved with. */
export const BUILD = "test";

export const balance: Balance = {
  ...DEFAULT_BALANCE,
  spawnPhaseTicks: 5,
  buildTicks: 5,
  longBuildTicks: 5,
  cityCost: 0,
  portCost: 0,
  siloCost: 0,
  airDefenseCost: 0,
  warshipCost: 0,
  missileCost: 0,
  heavyMissileCost: 0,
  siloReloadTicks: 30,
  tradeIntervalTicks: 10,
  falloutTicks: 60,
  allianceTicks: 200,
};

/**
 * An 80 × 40 map: land west of x = 30 and east of x = 50, the sea between.
 * Ada and the bot start west, Bea, Cy and the nation east.
 */
export const grid = new WorldGrid(80, 40, { wrapsX: false });
const kinds = new Uint8Array(grid.size).fill(TileKind.Plains);
for (let tile = 0; tile < grid.size; tile++) {
  const x = grid.x(tile);
  if (x >= 30 && x < 50) kinds[tile] = TileKind.Water;
}
export const terrain = new Terrain(grid, kinds);
export const players = [
  { id: 1, name: "Ada" },
  { id: 2, name: "Bea" },
  { id: 3, name: "Cy" },
  { id: 4, name: "Bot" },
  { id: 5, name: "Nation", start: grid.index(75, 20) },
];

/** The first tile, in tile order, where `order` is valid for the player. */
function firstValid(game: Game, player: Player, order: (tile: number) => Order): Order | undefined {
  for (let tile = 0; tile < grid.size; tile++) {
    if (game.territory.ownerOf(tile) !== player.id) continue;
    const candidate = order(tile);
    if (orderError(game, player, candidate) === undefined) return candidate;
  }
  return undefined;
}

/** Collects the orders of one tick, keeping only those valid when they are drawn. */
function collector(game: Game) {
  const out: { player: number; order: Order }[] = [];
  const add = (player: number, order: Order | undefined): void => {
    const who = game.player(player) as Player;
    if (order && who.alive && orderError(game, who, order) === undefined)
      out.push({ player, order });
  };
  return { out, add };
}

/**
 * The orders a few humans would send at this tick, drawn from the state so
 * that every rule with state of its own comes into play: land, ports and
 * trade, warships, silos and missiles with fallout, alliances, embargoes,
 * gifts and quick messages.
 */
export function busyOrders(game: Game): { player: number; order: Order }[] {
  const tick = game.tick;
  const { out, add } = collector(game);
  if (tick === 0) {
    add(1, { type: "spawn", tile: grid.index(10, 20) });
    add(2, { type: "spawn", tile: grid.index(60, 5) });
    add(3, { type: "spawn", tile: grid.index(60, 35) });
    return out;
  }
  const [ada, bea, cy] = [1, 2, 3].map((id) => game.player(id) as Player) as [
    Player,
    Player,
    Player,
  ];
  if (tick % 15 === 0) {
    const aims = {
      1: grid.index(29, (tick / 15) % 40),
      2: grid.index(50, 2),
      3: grid.index(50, 38),
    };
    for (const p of [ada, bea, cy]) {
      add(p.id, {
        type: "attack",
        target: aims[p.id as 1 | 2 | 3],
        troops: Math.floor(p.troops / 2),
      });
    }
  }
  if (tick % 25 === 0) {
    for (const p of [ada, bea, cy]) {
      const build = (structure: number) => (tile: number) =>
        ({ type: "build", structure, tile }) as Order;
      const kind = [StructureKind.Port, StructureKind.City, StructureKind.Silo][(tick / 25) % 3];
      add(p.id, firstValid(game, p, build(kind as number)));
      if (p.id === 3) add(p.id, firstValid(game, p, build(StructureKind.AirDefense)));
    }
  }
  if (tick % 40 === 0) {
    for (const s of game.structures) {
      if (s.kind === StructureKind.Port && s.player !== 3)
        add(s.player, { type: "warship", port: s.tile });
    }
    for (const w of game.warships) {
      add(w.player, { type: "patrol", ship: w.id, tile: grid.index(40, (tick / 40) % 40) });
    }
  }
  if (tick >= 400 && tick % 35 === 0) {
    // At the first tile of another player that the missile may strike.
    for (const [p, size] of [
      [1, tick % 70 === 0 ? MissileSize.Heavy : MissileSize.Light],
      [2, MissileSize.Light],
      [3, tick === 420 ? MissileSize.Heavy : MissileSize.Light],
    ] as const) {
      const shooter = game.player(p) as Player;
      for (let tile = 0; tile < grid.size; tile++) {
        const owner = game.territory.ownerOf(tile);
        if (owner === 0 || owner === p) continue;
        const order: Order = { type: "missile", target: tile, size };
        if (orderError(game, shooter, order) === undefined) {
          add(p, order);
          break;
        }
      }
    }
  }
  if (tick === 60) add(2, { type: "ally", target: 3 });
  if (tick === 61) add(3, { type: "ally", target: 2 });
  if (tick === 70) add(1, { type: "ally", target: 2 });
  if (tick === 320) add(3, { type: "embargo", target: 2, on: 1 });
  if (tick === 600) add(3, { type: "embargo", target: 2, on: 0 });
  if (tick === 300) add(3, { type: "betray", target: 2 });
  if (tick % 45 === 0) {
    add(2, { type: "gift", target: 3, troops: 10, gold: 0 });
    add(1, { type: "quick", target: 2, phrase: 0 });
  }
  if (tick % 80 === 0) add(2, { type: "embark", target: grid.index(29, 20), troops: 100 });
  return out;
}

/** A busy game of the standard rules: no special rule, no teams, nothing left out. */
export function newBusyGame(seed = 3): Game {
  const game = createGame({ terrain, seed, players, balance });
  installBots(game, [4], "easy");
  installNations(game, [5], "easy");
  return game;
}

/** Two landmarks, one on each side of the sea (R-LAND). */
const landmarks: Landmark[] = [
  { id: "tower", tile: grid.index(20, 20), effect: "gold" },
  { id: "keep", tile: grid.index(60, 20), effect: "fortress" },
];

/**
 * The setup of the game with every special rule: capitals, collapsing
 * fronts and doctrines (R-MODE-08), two teams (R-MODE-02), forts left out
 * (R-MODE-03), the operator's gold bonus (R-MODE-09) and landmarks (R-LAND).
 * Tribute is free, and truces, timed embargoes, the capitals' grace and the
 * build-up of a collapse short, so that each of them comes and goes within
 * the game.
 */
export const allRulesSetup: GameSetup = {
  terrain: new Terrain(grid, kinds, landmarks),
  seed: 3,
  players,
  balance: {
    ...balance,
    tributeBase: 0,
    tributePerTile: 0,
    tributeTruceTicks: 120,
    embargoAutoTicks: 90,
    capitalGraceTicks: 100,
    collapseBuildupTicks: 5,
  },
  teams: 2,
  disabled: Disable.Fort,
  rules: { capitals: true, collapsingFronts: true, doctrines: true },
  operator: { player: 1, bonuses: OperatorBonus.Gold },
};

/** A busy game with every special rule on. */
export function newAllRulesGame(seed = 3): Game {
  const game = createGame({ ...allRulesSetup, seed });
  installBots(game, [4], "easy");
  installNations(game, [5], "easy");
  return game;
}

/**
 * The orders of `busyOrders`, then those only the special rules take: the
 * doctrines picked during the spawn phase, a work share that moves, and
 * tributes for truces between the teams.
 */
export function allRulesOrders(game: Game): { player: number; order: Order }[] {
  const tick = game.tick;
  const { out, add } = collector(game);
  out.push(...busyOrders(game));
  if (tick === 1) {
    add(1, { type: "doctrine", pick: Doctrine.Conqueror });
    add(2, { type: "doctrine", pick: Doctrine.Merchant });
    add(3, { type: "doctrine", pick: Doctrine.Bastion });
  }
  if (tick % 30 === 10) {
    for (const id of [1, 2, 3]) add(id, { type: "work", share: ((tick / 10 + id) % 5) * 10 });
  }
  if (tick % 50 === 20) {
    for (const from of [1, 2, 3, 4, 5]) {
      for (const target of [1, 2, 3, 4, 5]) add(from, { type: "tribute", target });
    }
  }
  return out;
}

/** A game of this file and the orders that play it. */
export interface Fixture {
  readonly name: string;
  readonly newGame: () => Game;
  readonly orders: (game: Game) => { player: number; order: Order }[];
}

export const BUSY: Fixture = { name: "busy", newGame: () => newBusyGame(), orders: busyOrders };
export const ALL_RULES: Fixture = {
  name: "all rules",
  newGame: () => newAllRulesGame(),
  orders: allRulesOrders,
};
