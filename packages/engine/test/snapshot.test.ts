import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { installBots, installNations } from "../src/bots/index.ts";
import { createGame } from "../src/create-game.ts";
import type { Game, Order, Player, Turn } from "../src/game.ts";
import { MissileSize } from "../src/missiles.ts";
import { orderError } from "../src/orders.ts";
import {
  SNAPSHOT_MAX_BYTES,
  loadSnapshot,
  readSnapshotHeader,
  saveSnapshot,
} from "../src/snapshot.ts";
import { StructureKind } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = {
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
const grid = new WorldGrid(80, 40, { wrapsX: false });
const kinds = new Uint8Array(grid.size).fill(TileKind.Plains);
for (let tile = 0; tile < grid.size; tile++) {
  const x = grid.x(tile);
  if (x >= 30 && x < 50) kinds[tile] = TileKind.Water;
}
const terrain = new Terrain(grid, kinds);
const BUILD = "test";
const players = [
  { id: 1, name: "Ada" },
  { id: 2, name: "Bea" },
  { id: 3, name: "Cy" },
  { id: 4, name: "Bot" },
  { id: 5, name: "Nation", start: grid.index(75, 20) },
];

function newGame(seed = 3): Game {
  const game = createGame({
    terrain,
    seed,
    players,
    balance,
  });
  installBots(game, [4], "easy");
  installNations(game, [5], "easy");
  return game;
}

/** The first tile, in tile order, where `order` is valid for the player. */
function firstValid(game: Game, player: Player, order: (tile: number) => Order): Order | undefined {
  for (let tile = 0; tile < grid.size; tile++) {
    if (game.territory.ownerOf(tile) !== player.id) continue;
    const candidate = order(tile);
    if (orderError(game, player, candidate) === undefined) return candidate;
  }
  return undefined;
}

/**
 * The orders a few humans would send at this tick, drawn from the state so
 * that every rule with state of its own comes into play: land, ports and
 * trade, warships, silos and missiles with fallout, alliances, embargoes,
 * gifts and quick messages.
 */
function orders(game: Game): { player: number; order: Order }[] {
  const tick = game.tick;
  const out: { player: number; order: Order }[] = [];
  const add = (player: number, order: Order | undefined): void => {
    const who = game.player(player) as Player;
    if (order && who.alive && orderError(game, who, order) === undefined)
      out.push({ player, order });
  };
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

const TICKS = 1000;
const AFTER = 500;

/** One game played from its start, with its turns, its hash after every tick and snapshots on the way. */
function played() {
  const game = newGame();
  const turns: Turn[] = [];
  const hashes: number[] = [];
  const snapshots = new Map<number, Uint8Array>();
  const seen = {
    trade: 0,
    warships: 0,
    missiles: 0,
    fallout: 0,
    boats: 0,
    alliances: 0,
    requests: 0,
    embargoes: 0,
    quick: 0,
    fights: 0,
  };
  while (game.tick < TICKS) {
    if (game.tick % 50 === 0) snapshots.set(game.tick, saveSnapshot(game, BUILD));
    const turn = { tick: game.tick, orders: orders(game) };
    turns.push(turn);
    game.step(turn);
    hashes.push(game.hash());
    seen.trade += game.tradeShips.length;
    seen.warships += game.warships.length;
    seen.missiles += game.missiles.length;
    seen.fallout += game.fallout.length;
    seen.boats += game.boats.length;
    seen.alliances += game.alliances.length;
    seen.requests += game.allianceRequests.length;
    seen.embargoes += game.embargoes.length;
    seen.quick += game.quickCooldowns.length;
    seen.fights += game.fights.length;
  }
  return { game, turns, hashes, snapshots, seen };
}

describe("snapshots (#39)", () => {
  const reference = played();

  it("come from a game where every rule with state is at work", () => {
    for (const [what, count] of Object.entries(reference.seen)) {
      expect(count, `${what} never in play`).toBeGreaterThan(0);
    }
  });

  it("load at any tick into a game that plays on to the same hashes (R-FAIR-01)", () => {
    for (const [tick, bytes] of reference.snapshots) {
      const loaded = loadSnapshot(bytes, BUILD, () => newGame());
      if (!loaded.ok) throw new Error(`tick ${String(tick)}: ${loaded.reason}`);
      const game = loaded.game;
      expect(game.tick).toBe(tick);
      expect(saveSnapshot(game, BUILD)).toEqual(bytes);
      while (game.tick < Math.min(TICKS, tick + AFTER)) {
        game.step(reference.turns[game.tick] as Turn);
        expect(game.hash(), `loaded at ${String(tick)}, tick ${String(game.tick)}`).toBe(
          reference.hashes[game.tick - 1],
        );
      }
    }
    // Replays several stretches of the game: past the default 5 s on a loaded runner.
  }, 30_000);

  it("say what they hold in a header read before the state", () => {
    const bytes = reference.snapshots.get(500) as Uint8Array;
    expect(readSnapshotHeader(bytes)).toEqual({
      format: 4,
      build: BUILD,
      setup: newGame().setupDigest(),
      tick: 500,
      hash: reference.hashes[499],
      check: expect.any(Number) as number,
    });
    expect(readSnapshotHeader(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it("are refused, without throwing, by another build, setup or set of rules", () => {
    const bytes = reference.snapshots.get(300) as Uint8Array;
    const refused = (result: ReturnType<typeof loadSnapshot>) => (result.ok ? "" : result.reason);
    expect(refused(loadSnapshot(bytes, "other", () => newGame()))).toBe(
      "snapshot of build test, not other",
    );
    expect(refused(loadSnapshot(bytes, BUILD, () => newGame(4)))).toBe(
      "snapshot of another game setup",
    );
    const withoutBots = () => createGame({ terrain, seed: 3, players, balance });
    expect(refused(loadSnapshot(bytes, BUILD, withoutBots))).toBe("snapshot of other rules");
    const started = () => {
      const game = newGame();
      game.step({ tick: 0, orders: [] });
      return game;
    };
    expect(refused(loadSnapshot(bytes, BUILD, started))).toBe("the game has already started");
    expect(refused(loadSnapshot(new Uint8Array(SNAPSHOT_MAX_BYTES + 1), BUILD, newGame))).toBe(
      "snapshot too large",
    );
  });

  it("are refused, without throwing, when cut short or damaged", () => {
    const bytes = reference.snapshots.get(700) as Uint8Array;
    for (let length = 0; length < bytes.length; length += 97) {
      expect(loadSnapshot(bytes.subarray(0, length), BUILD, newGame).ok).toBe(false);
    }
    let seed = 1;
    for (let i = 0; i < 200; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const damaged = bytes.slice();
      const at = seed % damaged.length;
      damaged[at] = (damaged[at] as number) ^ (1 + ((seed >>> 24) % 255));
      expect(loadSnapshot(damaged, BUILD, newGame).ok).toBe(false);
    }
    const longer = new Uint8Array(bytes.length + 1);
    longer.set(bytes);
    expect(loadSnapshot(longer, BUILD, newGame)).toEqual({ ok: false, reason: "damaged snapshot" });
  });
});
