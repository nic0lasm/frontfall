import { captureCost, cheapestTile } from "../../attacks.ts";
import { capitalAlertDistance, capitalOf, capitalsStand } from "../../capitals.ts";
import { alliesOf, isAllied, isTraitor } from "../../diplomacy.ts";
import { populationCap, soldiers } from "../../economy.ts";
import { giftError } from "../../gifts.ts";
import type { Player } from "../../game.ts";
import { divFloor, percentOf } from "../../integer-math.ts";
import { StructureKind } from "../../structures.ts";
import { NEUTRAL } from "../../territory/territory-map.ts";
import type { NationStrategy } from "../difficulty.ts";
import { MOOD_BETRAYED, MOOD_FRIENDLY, MOOD_HOSTILE, Phrase } from "../relations.ts";
import { sail } from "../shared.ts";
import {
  CAPITAL_SAMPLES,
  NATION_CALL_SECONDS,
  NATION_GIFT_PERCENT,
  NATION_NEED_PERCENT,
} from "./constants.ts";
import { goes, incomingOn, mainFoe, runaway, type NationContext } from "./context.ts";
import { retaliate, strike } from "./strike.ts";

/** What a nation's decision found before it tries its strategies (R-BOT-26, R-BOT-27). */
export interface NationTurn {
  readonly nation: Player;
  /** Its neighbours that are not allies, the fewest troops first. */
  readonly neighbours: readonly number[];
  /** The besieger of its capital, or else its main attacker; NEUTRAL if none. */
  readonly attacker: number;
  /** Troops it keeps home. */
  readonly reserve: number;
  /** Its troops when it started on its strategies. */
  readonly troops: number;
  /** What it can send now, its workers back under arms. */
  readonly armed: () => number;
  /** What it can send now, workers kept at work. */
  readonly sendable: () => number;
}

/** One way of choosing a target: whether the nation attacked, which ends its decision. */
export type Strategy = (ctx: NationContext, turn: NationTurn) => boolean;

/**
 * Every strategy of `NationStrategy`, which each difficulty tries in the
 * order of its `strategies` (R-BOT-27).
 */
export const NATION_STRATEGIES: Readonly<Record<NationStrategy, Strategy>> = {
  cityStates: (ctx, { nation, neighbours, sendable }) =>
    eatCityStates(ctx, nation, neighbours, sendable),
  answer: (ctx, { nation, attacker, armed }) => retaliate(ctx, nation, attacker, armed),
  assist: (ctx, { nation, reserve, armed }) => helpAllies(ctx, nation, reserve, armed),
  hated: (ctx, { nation, armed }) => hated(ctx, nation, armed),
  traitor: (ctx, turn) =>
    pick(ctx, turn, (other) => isTraitor(ctx.game, other) && other.troops * 10 < turn.troops * 12),
  crown: (ctx, { nation, neighbours, armed }) => crown(ctx, nation, neighbours, armed),
  capital: (ctx, { nation, armed }) => strikeCapital(ctx, nation, armed),
  veryWeak: (ctx, turn) =>
    pick(
      ctx,
      turn,
      (other) =>
        other.troops * 100 < populationCap(ctx.game, other) * 15 &&
        other.troops * 10 < turn.troops * 12,
    ),
  juicy: (ctx, { nation, neighbours, armed }) => juicy(ctx, nation, neighbours, armed),
  victim: (ctx, turn) =>
    pick(
      ctx,
      turn,
      (other) =>
        other.troops * 10 <= turn.troops * 12 && incomingOn(ctx, other.id) * 2 > other.troops,
    ),
  weakest: (ctx, turn) => pick(ctx, turn, (other) => other.troops < turn.troops),
  island: (ctx, { nation, neighbours }) =>
    neighbours.length === 0 &&
    sail(
      ctx.game,
      nation,
      divFloor(soldiers(ctx.game, nation), 5),
      100,
      ctx.seaCooldowns,
      ctx.retryTicks,
      (owner) => goes(ctx, owner),
    ),
};

/** R-BOT-27: the first of its neighbours, the fewest troops first, that `find` picks. */
function pick(ctx: NationContext, turn: NationTurn, find: (owner: Player) => boolean): boolean {
  for (const id of turn.neighbours) {
    const other = ctx.game.player(id) as Player;
    if (find(other) && goes(ctx, id) && strike(ctx, turn.nation, id, turn.armed())) return true;
  }
  return false;
}

/**
 * R-BOT-27: attacks on the city-states beside the nation, the least dense
 * first, B-NATION-CITYSTATE-ATTACKS of them at once, each sized by
 * B-NATION-CITYSTATE-SEND out of what lies above its reserve: all of it;
 * four times the city-state's troops, or what is left if that is at least
 * twice them; or, topping up an attack already under way, 1.3 times what
 * keeps the attack at its cheapest until the city-state is down to 100
 * tiles, sent only once it can all go. Whether it attacked.
 */
function eatCityStates(
  ctx: NationContext,
  nation: Player,
  neighbours: readonly number[],
  sendable: () => number,
): boolean {
  const { game, territory, balance, params } = ctx;
  const states = neighbours.filter((id) => game.cityStates.has(id) && goes(ctx, id));
  if (states.length === 0) return false;
  const density = (id: number): number => {
    const state = game.player(id) as Player;
    return state.troops / Math.max(1, territory.tileCount(id));
  };
  states.sort((a, b) => density(a) - density(b) || a - b);
  const [fewest, most] = params.cityStateAttacks;
  const count = most > fewest ? game.random.nextInt(fewest, most + 1) : fewest;
  let left = sendable();
  let attacked = false;
  for (const id of states.slice(0, count)) {
    const state = game.player(id) as Player;
    let troops: number;
    if (params.cityStateSend === "all") troops = left;
    else if (params.cityStateSend === "fourfold") {
      troops = 4 * state.troops;
      if (troops > left) troops = left < 2 * state.troops ? 0 : left;
    } else {
      let under = 0;
      for (const attack of game.attacks) {
        if (attack.player === nation.id && attack.target === id) under += attack.troops;
      }
      const needed = Math.ceil((cityStateStack(ctx, nation, state) * 13) / 10) - under;
      troops = needed <= left ? needed : 0;
      if (under > 0 && needed <= 0) attacked = true;
    }
    if (troops < cheapestTile(balance)) continue;
    if (strike(ctx, nation, id, troops)) {
      left -= troops;
      attacked = true;
    }
  }
  return attacked;
}

/**
 * Troops that keep an attack on a city-state at its cheapest price per
 * tile (R-ATTACK-03: odds at B-ODDS-MIN) until it is down to 100 tiles.
 */
function cityStateStack(ctx: NationContext, nation: Player, state: Player): number {
  const { game, territory, balance } = ctx;
  const stack = Math.max(1, Math.ceil((state.troops * 100) / balance.oddsMinPercent));
  const tiles = Math.max(0, territory.tileCount(state.id) - 100);
  if (tiles === 0 || territory.borderCount(state.id) === 0) return stack;
  const tile = territory.borderTile(state.id, 0);
  return Math.max(stack, tiles * captureCost(game, tile, state, nation.id, stack));
}

/**
 * R-BOT-27: the runaway leader, a player with B-NATION-RUNAWAY times the
 * land of the runner-up, when it borders the nation; a normal nation only
 * joins attacks already on them. Whether it attacked.
 */
function crown(
  ctx: NationContext,
  nation: Player,
  neighbours: readonly number[],
  armed: () => number,
): boolean {
  const { game, balance, params, memory } = ctx;
  const top = runaway(ctx);
  if (top === NEUTRAL || !neighbours.includes(top) || !goes(ctx, top)) return false;
  const leaderTroops = (game.player(top) as Player).troops;
  if (params.answer !== "at once" && incomingOn(ctx, top) * 10 < leaderTroops) return false;
  if (!strike(ctx, nation, top, armed(), true)) return false;
  // R-BOT-21: and calls on its allies to join in, now and then.
  if (game.tick >= (memory.lastCall.get(nation.id) ?? 0)) {
    memory.lastCall.set(nation.id, game.tick + NATION_CALL_SECONDS * balance.ticksPerSecond);
    for (const ally of alliesOf(game, nation.id)) {
      if (ally !== top) memory.say(nation.id, ally, Phrase.Leader);
    }
  }
  return true;
}

/**
 * R-BOT-27: among the neighbours with at most three quarters of its troops,
 * the one richest in buildings, emptiest of troops and largest, each
 * measured against the others. Whether it attacked.
 */
function juicy(
  ctx: NationContext,
  nation: Player,
  neighbours: readonly number[],
  armed: () => number,
): boolean {
  const { game, territory } = ctx;
  const candidates = neighbours.filter(
    (id) => (game.player(id) as Player).troops * 4 <= nation.troops * 3,
  );
  if (candidates.length === 0) return false;
  const stats = candidates.map((id) => {
    const player = game.player(id) as Player;
    const cap = Math.max(1, populationCap(game, player));
    let buildings = 0;
    for (const s of game.structures) {
      if (s.player === id && s.kind !== StructureKind.Fort && s.kind !== StructureKind.Silo) {
        buildings++;
      }
    }
    // In thousandths, to stay in integers.
    return {
      id,
      buildings,
      gap: 1000 - divFloor(player.troops * 1000, cap),
      land: territory.tileCount(id),
    };
  });
  const span = (values: number[]) => [Math.min(...values), Math.max(...values)] as const;
  const [b0, b1] = span(stats.map((s) => s.buildings));
  const [g0, g1] = span(stats.map((s) => s.gap));
  const [l0, l1] = span(stats.map((s) => s.land));
  const scaled = (v: number, lo: number, hi: number) =>
    hi > lo ? divFloor((v - lo) * 1000, hi - lo) : 0;
  let best = stats[0] as (typeof stats)[number];
  let bestScore = -1;
  for (const s of stats) {
    const score = scaled(s.buildings, b0, b1) + scaled(s.gap, g0, g1) + scaled(s.land, l0, l1);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return goes(ctx, best.id) && strike(ctx, nation, best.id, armed());
}

/**
 * R-BOT-22: an attack on a player who betrayed the nation, or on the ally
 * it betrayed for a while, or, at a difficulty with B-NATION-GRUDGE, on a
 * neighbour it is hostile to, by land or else by sea, unless they have
 * three times its troops. Whether it attacked.
 */
function hated(ctx: NationContext, nation: Player, armed: () => number): boolean {
  const { game, params, memory } = ctx;
  const prey =
    game.tick < (memory.preyUntil.get(nation.id) ?? 0) ? memory.prey.get(nation.id) : undefined;
  for (const player of game.players()) {
    if (player.id === nation.id || !player.alive || isAllied(game, nation.id, player.id)) continue;
    const score = memory.score(nation.id, player.id);
    const hostile =
      score <= MOOD_BETRAYED || player.id === prey || (params.grudge && score <= MOOD_HOSTILE);
    if (!hostile || player.troops > nation.troops * 3 || !goes(ctx, player.id)) continue;
    if (strike(ctx, nation, player.id, armed())) return true;
  }
  return false;
}

/**
 * R-BOT-24: for each of its allies, the lowest number first, an attack on
 * the player attacking that ally the most, for an ally it likes or that
 * asked; or else, at most once every B-NATION-GIFT-PAUSE, B-NATION-GIFT of
 * its soldiers to an ally who asked for help or is under attack with troops
 * under B-NATION-NEED of its cap, from twice its reserve. Whether it attacked.
 */
function helpAllies(
  ctx: NationContext,
  nation: Player,
  reserve: number,
  armed: () => number,
): boolean {
  const { game, balance, memory, giftPauseTicks } = ctx;
  const allies = alliesOf(game, nation.id);
  if (allies.length === 0) return false;
  for (const ally of allies) {
    const friend = game.player(ally) as Player;
    const foe = mainFoe(ctx, ally);
    const asked = memory.askedForHelp(nation.id, ally);
    // Only for an ally it likes, at a foe that is not its own ally.
    const liked = memory.score(nation.id, ally) >= MOOD_FRIENDLY || asked;
    if (foe !== NEUTRAL && foe !== nation.id && liked && !isAllied(game, nation.id, foe)) {
      if (goes(ctx, foe) && strike(ctx, nation, foe, armed())) {
        if (asked) {
          memory.forgetHelp(nation.id, ally);
          memory.say(nation.id, ally, Phrase.Up);
        }
        return true;
      }
    }
    const needy =
      asked ||
      (foe !== NEUTRAL && friend.troops * 100 < populationCap(game, friend) * NATION_NEED_PERCENT);
    if (!needy || game.tick < (memory.lastGift.get(nation.id) ?? 0)) continue;
    // Only from a strong army: never at the cost of its own defense.
    if (nation.troops < reserve * 2) continue;
    const troops = Math.min(
      percentOf(soldiers(game, nation), NATION_GIFT_PERCENT),
      nation.troops - reserve,
    );
    if (troops < cheapestTile(balance)) continue;
    if (giftError(game, nation, ally, troops, 0) !== undefined) continue;
    game.apply(nation.id, { type: "gift", target: ally, troops, gold: 0 });
    memory.lastGift.set(nation.id, game.tick + giftPauseTicks);
    if (asked) {
      memory.forgetHelp(nation.id, ally);
      memory.say(nation.id, ally, Phrase.Up);
    }
  }
  return false;
}

/**
 * R-BOT-17: in capital mode, an attack on the capital of a neighbour not
 * its ally whose capital lies within B-CAPITAL-ALERT of the nation's
 * border, if that neighbour has fewer troops than the nation, the lowest
 * player number first. Whether it attacked.
 */
function strikeCapital(ctx: NationContext, nation: Player, armed: () => number): boolean {
  const { game, territory } = ctx;
  if (!capitalsStand(game)) return false;
  const topology = game.terrain.topology;
  const reach = capitalAlertDistance(game);
  const borders = territory.borderCount(nation.id);
  const stride = Math.max(1, Math.ceil(borders / CAPITAL_SAMPLES));
  for (const player of game.players()) {
    const capital = capitalOf(game, player.id);
    if (player.id === nation.id || !player.alive || capital === undefined) continue;
    if (isAllied(game, nation.id, player.id) || player.troops >= nation.troops) continue;
    let near = false;
    for (let i = 0; i < borders && !near; i += stride) {
      near = topology.distance(territory.borderTile(nation.id, i), capital) <= reach;
    }
    if (!near || !goes(ctx, player.id)) continue;
    if (strike(ctx, nation, player.id, armed())) return true;
  }
  return false;
}
