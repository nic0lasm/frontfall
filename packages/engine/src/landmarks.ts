import { isAllied, logEvent } from "./diplomacy.ts";
import type { Game } from "./game.ts";
import { mulDiv } from "./integer-math.ts";
import { DrawUsage, derivedRandom } from "./random.ts";
import { spawnSettings } from "./spawn.ts";
import { NEUTRAL } from "./territory/territory-map.ts";

/** What holding a landmark gives (R-LAND-02), by its name in map manifests. */
export const LandmarkEffect = {
  /** More gold from troops (B-LANDMARK-GOLD). */
  Gold: "gold",
  /** Troops grow faster (B-LANDMARK-GROWTH). */
  Growth: "growth",
  /** The holder's land around it costs more to take (B-LANDMARK-FORTRESS). */
  Fortress: "fortress",
  /** More gold from each trade ship (B-LANDMARK-TRADE). */
  Trade: "trade",
  /** May stop a missile flying near it (B-LANDMARK-SHIELD). */
  Shield: "shield",
  /** The holder's attacks pay less for each tile (B-LANDMARK-ASSAULT). */
  Assault: "assault",
} as const;
export type LandmarkEffect = (typeof LandmarkEffect)[keyof typeof LandmarkEffect];

export const LANDMARK_EFFECTS: readonly LandmarkEffect[] = Object.values(LandmarkEffect);

/** A place of a map that gives its effect to whoever holds its tile (R-LAND-01). */
export interface Landmark {
  readonly id: string;
  readonly tile: number;
  readonly effect: LandmarkEffect;
}

/** The player holding a landmark's tile, NEUTRAL when nobody does. */
export function landmarkHolder(game: Game, landmark: Landmark): number {
  return game.territory.ownerOf(landmark.tile);
}

/** How many landmarks with `effect` the player holds (R-LAND-02); each one counts. */
export function heldLandmarks(game: Game, player: number, effect: LandmarkEffect): number {
  if (player === NEUTRAL) return 0;
  let held = 0;
  for (const landmark of game.terrain.landmarks) {
    if (landmark.effect === effect && landmarkHolder(game, landmark) === player) held++;
  }
  return held;
}

/** `value` raised by `percent` once for each landmark with `effect` the player holds. */
export function withLandmarks(
  game: Game,
  player: number,
  effect: LandmarkEffect,
  percent: number,
  value: number,
): number {
  const held = heldLandmarks(game, player, effect);
  return held === 0 ? value : mulDiv(value, 100 + held * percent, 100);
}

/** A landmark radius in tiles, given for a map of 2^19 tiles and growing with the side of larger maps. */
function scaledRadius(game: Game, radius: number): number {
  return Math.max(radius, mulDiv(radius, spawnSettings(game).radius, game.balance.spawnRadius));
}

export function landmarkFortressRadius(game: Game): number {
  return scaledRadius(game, game.balance.landmarkFortressRadius);
}

export function landmarkShieldRadius(game: Game): number {
  return scaledRadius(game, game.balance.landmarkShieldRadius);
}

/** R-LAND-02: whether the owner's tile lies within reach of a fortress landmark they hold. */
export function guardedByLandmark(game: Game, tile: number, owner: number): boolean {
  if (owner === NEUTRAL) return false;
  const topology = game.terrain.topology;
  for (const landmark of game.terrain.landmarks) {
    if (
      landmark.effect === LandmarkEffect.Fortress &&
      landmarkHolder(game, landmark) === owner &&
      topology.distance(landmark.tile, tile) <= landmarkFortressRadius(game)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * R-LAND-02: on the tick a missile first flies within reach of a shield
 * landmark held by a player who is neither its launcher nor an ally of
 * theirs, the landmark stops it at B-LANDMARK-SHIELD-CHANCE. `previous` is
 * where the missile was a tick before, undefined on its first tick of
 * flight. Returns the holder that stopped it, or NEUTRAL.
 */
export function shieldedBy(
  game: Game,
  missile: { readonly id: number; readonly player: number },
  at: number,
  previous: number | undefined,
): number {
  const topology = game.terrain.topology;
  const radius = landmarkShieldRadius(game);
  for (const landmark of game.terrain.landmarks) {
    if (landmark.effect !== LandmarkEffect.Shield) continue;
    const holder = landmarkHolder(game, landmark);
    if (holder === NEUTRAL || holder === missile.player || isAllied(game, holder, missile.player)) {
      continue;
    }
    if (topology.distance(landmark.tile, at) > radius) continue;
    if (previous !== undefined && topology.distance(landmark.tile, previous) <= radius) continue;
    const draw = derivedRandom(game.seed, game.tick, missile.id, DrawUsage.LandmarkShield);
    if (draw % 100 < game.balance.landmarkShieldChancePercent) return holder;
  }
  return NEUTRAL;
}

/**
 * R-LAND-03: every player is told when a landmark changes hands. Who held
 * each landmark is read from the territory, so nothing is saved: a game
 * resumed from a snapshot starts from the holders it finds.
 */
export function installLandmarks(game: Game): void {
  const landmarks = game.terrain.landmarks;
  if (landmarks.length === 0) return;
  let holders: number[] | undefined;
  game.onTick(() => {
    if (game.phase !== "play") return;
    const now = landmarks.map((landmark) => landmarkHolder(game, landmark));
    if (holders) {
      now.forEach((holder, index) => {
        const before = holders?.[index] ?? NEUTRAL;
        if (holder !== before && holder !== NEUTRAL) {
          logEvent(game, {
            tick: game.tick,
            type: "landmark",
            a: holder,
            b: before,
            landmark: index,
          });
        }
      });
    }
    holders = now;
  });
}
