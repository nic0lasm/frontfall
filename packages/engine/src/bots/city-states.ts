import { cheapestTile } from "../attacks.ts";
import { capitalAim } from "../capitals.ts";
import { isTraitor } from "../diplomacy.ts";
import { populationCap, soldiers } from "../economy.ts";
import type { Game, Player } from "../game.ts";
import { percentOf } from "../integer-math.ts";
import { NEUTRAL } from "../territory/territory-map.ts";
import { scanBorder } from "./shared.ts";

/** Seconds between two decisions of a city-state, drawn per city-state from this range (R-BOT-29). */
export const CITY_STATE_INTERVAL_SECONDS = [4, 8] as const; // B-CITYSTATE-INTERVAL

/** A city-state's population cap, in % of a player's (R-BOT-29). */
export const CITY_STATE_CAP_PERCENT = 33; // B-CITYSTATE-CAP

/** A city-state's troop growth, in % of a player's. */
export const CITY_STATE_GROWTH_PERCENT = 50; // B-CITYSTATE-GROWTH

/** A city-state's starting troops, in % of a player's. */
export const CITY_STATE_START_PERCENT = 40; // B-CITYSTATE-START

/** A city-state's base gold, in % of a player's: its gold goes to whoever takes its last tile (R-ECO-08). */
export const CITY_STATE_GOLD_PERCENT = 50; // B-CITYSTATE-GOLD

/** City-states that come with each of a map's nations (R-BOT-29): 420 on World, as many as the genre puts there. */
export const CITY_STATES_PER_NATION = 6; // B-CITYSTATE-PER-NATION

/** A city-state turns on a traitor beside it one decision in this many. */
const TRAITOR_ODDS = 3;

/**
 * City-states (R-BOT-29), the genre's tribes: small computer players
 * scattered at random when the spawn phase ends, which nations and players
 * eat early on for their land and their gold. They hold a third of a
 * player's cap, grow at half the pace, start with fewer troops and earn half
 * the base gold, and their land is cheaper to take (R-ATTACK-04).
 *
 * Every few seconds a city-state may turn on a traitor beside it; takes free land with what lies above a small
 * reserve; and once past its trigger, answers whoever attacks it, or else
 * attacks a neighbour drawn at random, letting a player or a nation be half
 * the time. It takes no allies and nobody can ally with it; it builds
 * nothing and has no moods or messages.
 */
export function installCityStates(game: Game, ids: readonly number[]): void {
  const { territory, balance } = game;
  const states = [...new Set(ids)].sort((a, b) => a - b);
  const [low, high] = CITY_STATE_INTERVAL_SECONDS;
  const intervals = new Map<number, number>();
  for (const id of states) {
    if (!game.player(id)) throw new RangeError(`unknown player ${String(id)}`);
    game.bots.add(id);
    game.cityStates.add(id);
    game.popFactors.set(id, {
      cap: CITY_STATE_CAP_PERCENT,
      growth: CITY_STATE_GROWTH_PERCENT,
      start: CITY_STATE_START_PERCENT,
      gold: CITY_STATE_GOLD_PERCENT,
    });
    // Drawn from its number, like a nation's thresholds, so snapshots need not keep it.
    const seconds = low + ((id * 7919) % (high - low + 1));
    intervals.set(id, Math.max(1, seconds * balance.ticksPerSecond));
  }

  game.onTick(() => {
    if (game.phase !== "play") return;
    for (const id of states) {
      const interval = intervals.get(id) as number;
      if ((game.tick + id) % interval !== 0) continue;
      const state = game.player(id) as Player;
      if (state.alive) decide(state);
    }
  });

  function decide(state: Player): void {
    if (territory.tileCount(state.id) === 0 || territory.borderCount(state.id) === 0) return;
    const cap = populationCap(game, state);
    const ratios = cityRatios(state.id);
    const cheapest = cheapestTile(balance);
    const above = (percent: number): number =>
      Math.max(0, Math.min(state.troops - percentOf(cap, percent), soldiers(state)));
    const attack = (tile: number): boolean => {
      const troops = above(ratios.reserve);
      if (troops < cheapest) return false;
      return game.apply(state.id, { type: "attack", target: capitalAim(game, tile), troops });
    };

    // A traitor beside it, now and then.
    const traitors = neighbours(state).filter((owner) =>
      isTraitor(game, game.player(owner) as Player),
    );
    if (traitors.length > 0 && game.random.nextInt(0, TRAITOR_ODDS) === 0) {
      const traitor = traitors[game.random.nextInt(0, traitors.length)] as number;
      const tile = borderTile(state, traitor);
      if (tile >= 0 && attack(tile)) return;
    }
    const { neutral } = scanBorder(game, state);
    if (neutral >= 0) {
      const troops = above(ratios.expand);
      if (troops >= cheapest) {
        game.apply(state.id, { type: "attack", target: neutral, troops });
        return;
      }
    }
    if (state.troops * 100 < cap * ratios.trigger) return;
    // Whoever attacks it the most.
    let attacker = NEUTRAL;
    let most = 0;
    for (const a of game.attacks) {
      if (a.target === state.id && a.troops > most) {
        attacker = a.player;
        most = a.troops;
      }
    }
    if (attacker !== NEUTRAL) {
      const tile = borderTile(state, attacker);
      if (tile >= 0 && attack(tile)) return;
    }
    // A neighbour drawn at random; a player or a nation half the time.
    const around = neighbours(state);
    for (let n = around.length; n > 0; n--) {
      const owner = around.splice(game.random.nextInt(0, n), 1)[0] as number;
      if (!game.bots.has(owner) && game.random.nextInt(0, 2) === 0) continue;
      const tile = borderTile(state, owner);
      if (tile >= 0 && attack(tile)) return;
    }
  }

  /** The living players along its border, in ascending order. */
  function neighbours(state: Player): number[] {
    const found = new Set<number>();
    const around = new Int32Array(4);
    const topology = game.terrain.topology;
    for (let i = 0; i < territory.borderCount(state.id); i++) {
      const count = topology.neighborsInto(territory.borderTile(state.id, i), around);
      for (let j = 0; j < count; j++) {
        const owner = territory.ownerOf(around[j] as number);
        if (owner !== state.id && owner !== NEUTRAL && game.player(owner)?.alive) found.add(owner);
      }
    }
    return [...found].sort((a, b) => a - b);
  }

  /** A tile of `owner` next to its land, or -1. */
  function borderTile(state: Player, owner: number): number {
    const around = new Int32Array(4);
    const topology = game.terrain.topology;
    for (let i = 0; i < territory.borderCount(state.id); i++) {
      const count = topology.neighborsInto(territory.borderTile(state.id, i), around);
      for (let j = 0; j < count; j++) {
        if (territory.ownerOf(around[j] as number) === owner) return around[j] as number;
      }
    }
    return -1;
  }
}

/** A city-state's shares of its cap, drawn from its number like a nation's (R-BOT-26). */
function cityRatios(id: number): { trigger: number; reserve: number; expand: number } {
  return {
    trigger: 50 + ((id * 7919) % 11),
    reserve: 30 + ((id * 104_729) % 11),
    expand: 10 + ((id * 1_299_709) % 11),
  };
}
