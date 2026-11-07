import type { Balance } from "../../balance.ts";
import { isAllied, isTraitor } from "../../diplomacy.ts";
import { populationCap, workShareOf } from "../../economy.ts";
import type { Game, Player } from "../../game.ts";
import { percentOf } from "../../integer-math.ts";
import type { TerritoryMap } from "../../territory/territory-map.ts";
import { NEUTRAL } from "../../territory/territory-map.ts";
import type { Topology } from "../../topology.ts";
import { NATION_DIFFICULTIES, type BotDifficulty, type NationParameters } from "../difficulty.ts";
import { nationMemory, type NationMemory } from "../relations.ts";
import { RETRY_DECISIONS, persistCooldowns, scanBorder, type Cooldowns } from "../shared.ts";
import {
  NATION_COURT_SECONDS,
  NATION_GIFT_PAUSE_SECONDS,
  NATION_THREAT_PERCENT,
  NEIGHBOUR_SAMPLES,
} from "./constants.ts";

/**
 * What every phase of a nation's decision shares (ADR 0009): the game, the
 * parameters of its difficulty, the nations it plays, their memory and their
 * cooldowns, and the scratch space of its border scans. One per
 * `installNations` call, for all the nations of that call.
 */
export interface NationContext {
  readonly game: Game;
  readonly territory: TerritoryMap;
  readonly balance: Balance;
  readonly topology: Topology;
  readonly difficulty: BotDifficulty;
  readonly params: Readonly<NationParameters>;
  /** B-NATION-INTERVAL, in ticks. */
  readonly interval: number;
  readonly retryTicks: number;
  /** B-NATION-GRACE, in ticks. */
  readonly graceTicks: number;
  /** The nations, by ascending id. */
  readonly nations: readonly number[];
  readonly nationSet: ReadonlySet<number>;
  readonly memory: NationMemory;
  readonly seaCooldowns: Cooldowns;
  readonly cityCooldowns: Cooldowns;
  readonly portCooldowns: Cooldowns;
  readonly armCooldowns: Cooldowns;
  readonly missileCooldowns: Cooldowns;
  readonly missilePauseTicks: number;
  readonly courtTicks: number;
  readonly giftPauseTicks: number;
  /** R-BOT-16: soldiers' reach along each neighbour's front, reused every decision. */
  readonly facing: Map<number, number>;
  /** Scratch space of the border scans, which never run inside one another. */
  readonly around: Int32Array;
}

/**
 * The context of the nations `ids` at `difficulty`: checks the players,
 * sets their population factors (R-BOT-26), and registers their memory
 * and their cooldowns for snapshots, in that order.
 */
export function createNationContext(
  game: Game,
  ids: readonly number[],
  difficulty: BotDifficulty,
  graceSeconds: number,
): NationContext {
  const { territory, balance } = game;
  const params = NATION_DIFFICULTIES[difficulty];
  const interval = Math.max(1, params.intervalSeconds * balance.ticksPerSecond);
  const nations = [...new Set(ids)].sort((a, b) => a - b);
  const nationSet = new Set(nations);
  for (const id of nations) {
    if (!game.player(id)) throw new RangeError(`unknown player ${String(id)}`);
  }
  for (const id of nations) {
    game.popFactors.set(id, {
      cap: params.capPercent,
      growth: params.growthPercent,
      start: params.startPercent,
    });
  }
  const cooldowns = {
    seaCooldowns: new Map<number, number>(),
    cityCooldowns: new Map<number, number>(),
    portCooldowns: new Map<number, number>(),
    armCooldowns: new Map<number, number>(),
    missileCooldowns: new Map<number, number>(),
  };
  const memory = nationMemory(game, nationSet, `nation memory ${nations.join(",")}`);
  persistCooldowns(game, `nations ${difficulty} ${String(graceSeconds)} ${nations.join(",")}`, [
    cooldowns.seaCooldowns,
    cooldowns.cityCooldowns,
    cooldowns.portCooldowns,
    cooldowns.armCooldowns,
    cooldowns.missileCooldowns,
  ]);
  return {
    game,
    territory,
    balance,
    topology: game.terrain.topology,
    difficulty,
    params,
    interval,
    retryTicks: RETRY_DECISIONS * interval,
    graceTicks: graceSeconds * balance.ticksPerSecond,
    nations,
    nationSet,
    memory,
    ...cooldowns,
    missilePauseTicks: params.missilePauseSeconds * balance.ticksPerSecond,
    courtTicks: NATION_COURT_SECONDS * balance.ticksPerSecond,
    giftPauseTicks: NATION_GIFT_PAUSE_SECONDS * balance.ticksPerSecond,
    facing: new Map(),
    around: new Int32Array(4),
  };
}

/**
 * R-BOT-27: whether the nation turns on `owner` when it chooses to: always
 * a nation, a city-state or a traitor; a player never during B-NATION-GRACE
 * nor while spared (B-NATION-SPARE), then only B-NATION-HUMAN of the time.
 */
export function goes(ctx: NationContext, owner: number): boolean {
  const { game, balance, nationSet, graceTicks, params } = ctx;
  const player = game.player(owner);
  if (nationSet.has(owner) || game.bots.has(owner) || (player && isTraitor(game, player))) {
    return true;
  }
  // B-NATION-GRACE: no player is chosen early on.
  if (game.tick < balance.spawnPhaseTicks + graceTicks) return false;
  if (player && spared(ctx, player)) return false;
  return game.random.nextInt(0, 100) < params.humanPercent;
}

/** B-NATION-SPARE: a player whose army is down to a small share of their cap is left to rebuild. */
export function spared(ctx: NationContext, player: Player): boolean {
  return player.troops * 100 < populationCap(ctx.game, player) * ctx.params.sparePercent;
}

/** Troops in attacks on `id`'s land. */
export function incomingOn(ctx: NationContext, id: number): number {
  let total = 0;
  for (const attack of ctx.game.attacks) if (attack.target === id) total += attack.troops;
  return total;
}

/** Whether a sample of the nation's border touches `owner`'s land, ally or not. */
export function touches(ctx: NationContext, nation: Player, owner: number): boolean {
  const { territory, topology, around } = ctx;
  const borders = territory.borderCount(nation.id);
  const stride = Math.max(1, Math.ceil(borders / NEIGHBOUR_SAMPLES));
  for (let i = 0; i < borders; i += stride) {
    const count = topology.neighborsInto(territory.borderTile(nation.id, i), around);
    for (let j = 0; j < count; j++) {
      if (territory.ownerOf(around[j] as number) === owner) return true;
    }
  }
  return false;
}

/** The living players across a sample of the nation's border, not its allies, in ascending order. */
export function neighboursOf(ctx: NationContext, nation: Player): number[] {
  const { game, territory, topology, around } = ctx;
  const found = new Set<number>();
  const borders = territory.borderCount(nation.id);
  const stride = Math.max(1, Math.ceil(borders / NEIGHBOUR_SAMPLES));
  for (let i = 0; i < borders; i += stride) {
    const count = topology.neighborsInto(territory.borderTile(nation.id, i), around);
    for (let j = 0; j < count; j++) {
      const owner = territory.ownerOf(around[j] as number);
      if (owner !== nation.id && owner !== NEUTRAL) found.add(owner);
    }
  }
  return [...found]
    .filter((owner) => game.player(owner)?.alive === true && !isAllied(game, nation.id, owner))
    .sort((a, b) => a - b);
}

/**
 * A tile of `owner` next to the nation's land: from a sample of the border
 * first, then from the whole of it, which only an attack makes worth the cost.
 * -1 when they share no border.
 */
export function borderWith(ctx: NationContext, nation: Player, owner: number): number {
  const { game, territory } = ctx;
  const { enemy } = scanBorder(game, nation, (other) => other === owner);
  if (enemy >= 0) return enemy;
  const around = new Int32Array(4);
  const topology = game.terrain.topology;
  for (let i = 0; i < territory.borderCount(nation.id); i++) {
    const count = topology.neighborsInto(territory.borderTile(nation.id, i), around);
    for (let j = 0; j < count; j++) {
      const tile = around[j] as number;
      if (territory.ownerOf(tile) === owner) return tile;
    }
  }
  return -1;
}

/**
 * The player with the most troops in attacks on the nation's land, or
 * NEUTRAL when nobody's attacks there reach B-NATION-THREAT of its troops:
 * a trickle of small attacks must not keep it from playing.
 */
export function mainAttacker(ctx: NationContext, id: number): number {
  const { game } = ctx;
  const nation = game.player(id) as Player;
  let attacker = NEUTRAL;
  let most = Math.max(0, percentOf(nation.troops, NATION_THREAT_PERCENT) - 1);
  const byPlayer = new Map<number, number>();
  for (const attack of game.attacks) {
    if (attack.target !== id) continue;
    const total = (byPlayer.get(attack.player) ?? 0) + attack.troops;
    byPlayer.set(attack.player, total);
    // Oldest attack first breaks ties, the same on every client.
    if (total > most) {
      attacker = attack.player;
      most = total;
    }
  }
  return attacker;
}

/** The player with the most troops in attacks on `id`'s land who is not the nation's ally; NEUTRAL if none. */
export function mainFoe(ctx: NationContext, id: number): number {
  let foe = NEUTRAL;
  let most = 0;
  const byPlayer = new Map<number, number>();
  for (const attack of ctx.game.attacks) {
    if (attack.target !== id || attack.troops <= 0) continue;
    const total = (byPlayer.get(attack.player) ?? 0) + attack.troops;
    byPlayer.set(attack.player, total);
    if (total > most) {
      foe = attack.player;
      most = total;
    }
  }
  return foe;
}

/** R-BOT-27: the player, city-states aside, with B-NATION-RUNAWAY times the land of the next; NEUTRAL if none. */
export function runaway(ctx: NationContext): number {
  const { game, territory, params } = ctx;
  if (params.runawayPercent === 0 || game.teams > 0) return NEUTRAL;
  let first = NEUTRAL;
  let most = 0;
  let second = 0;
  for (const player of game.players()) {
    if (!player.alive || game.bots.has(player.id)) continue;
    const land = territory.tileCount(player.id);
    if (land > most) {
      second = most;
      most = land;
      first = player.id;
    } else if (land > second) second = land;
  }
  if (first === NEUTRAL || second === 0) return NEUTRAL;
  return most * 100 >= second * params.runawayPercent ? first : NEUTRAL;
}

/**
 * R-BOT-15: puts B-NATION-WORK of the troops at home to work while its
 * army is full and it is at peace, and calls them all back to arms as soon
 * as someone threatens it or it turns on a player.
 */
export function work(ctx: NationContext, nation: Player, share: number): void {
  if (workShareOf(ctx.game, nation.id) !== share)
    ctx.game.apply(nation.id, { type: "work", share });
}

/**
 * R-BOT-26: the shares of its population cap a nation acts on, each drawn
 * from its number: it attacks a player from `trigger` of the cap and sends
 * what lies above `reserve`; into free land it keeps only `expand`.
 */
export function nationRatios(id: number): { trigger: number; reserve: number; expand: number } {
  return {
    trigger: 50 + ((id * 7919) % 11),
    reserve: 30 + ((id * 104_729) % 11),
    expand: 10 + ((id * 1_299_709) % 11),
  };
}

/** Spreads a nation's looks at its neighbours over B-NATION-COURT. */
export function id7(id: number): number {
  return id * 7;
}

/** A draw in [0, 2^32) from the numbers given, the same on every client. */
export function hashRoll(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h = Math.imul(h ^ (v >>> 0), 0x01000193) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  }
  return h;
}
