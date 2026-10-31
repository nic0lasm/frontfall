import type { BotDifficulty } from "./bots/difficulty.ts";
import type { Game, Player } from "./game.ts";
import { mulDiv } from "./integer-math.ts";

/**
 * The doctrines a player may pick during the spawn phase (R-DOCTRINE): code 0
 * is the balanced one, which changes nothing and is what a player who did
 * not pick gets.
 */
export const Doctrine = {
  Balanced: 0,
  Conqueror: 1,
  Merchant: 2,
  Bastion: 3,
} as const;
export type DoctrineCode = (typeof Doctrine)[keyof typeof Doctrine];

/** Number of doctrines, the balanced one included. */
export const DOCTRINE_COUNT = 4;

/** What a doctrine does to one rule, in percent: 100 changes nothing. */
export interface DoctrineEffects {
  /** B-DOCTRINE-PACE: tiles an attack takes each tick (R-ATTACK-03). */
  readonly pace: number;
  /** B-DOCTRINE-ATTACKER: troops the player's attacks lose on a player's tile (R-ATTACK-03). */
  readonly attackerLoss: number;
  /** B-DOCTRINE-DEFENDER: troops the player loses with each tile taken from them. */
  readonly defenderLoss: number;
  /** B-DOCTRINE-GOLD: the fixed income (B-GOLD-BASE). */
  readonly gold: number;
  /** B-DOCTRINE-CAP: the population cap (R-ECO-01). */
  readonly cap: number;
  /** B-DOCTRINE-TRADE: gold a trade ship brings its owner (R-TRADE). */
  readonly trade: number;
  /** B-DOCTRINE-FORT: the price of a fort (R-BUILD). */
  readonly fortCost: number;
}

const NONE: DoctrineEffects = {
  pace: 100,
  attackerLoss: 100,
  defenderLoss: 100,
  gold: 100,
  cap: 100,
  trade: 100,
  fortCost: 100,
};

/** B-DOCTRINE-*: indexed by `Doctrine` code. Kept apart from the balance table, which every game digests. */
export const DOCTRINE_EFFECTS: readonly DoctrineEffects[] = [
  NONE,
  // Conqueror: strikes fast, earns and holds a little less.
  { ...NONE, pace: 110, attackerLoss: 92, gold: 95, cap: 98 },
  // Merchant: lives off the sea and the fixed income, pays more to take land.
  { ...NONE, attackerLoss: 108, gold: 110, trade: 120 },
  // Bastion: holds more troops and holds them better, attacks slower.
  { ...NONE, pace: 90, defenderLoss: 88, cap: 108, fortCost: 80 },
];

/** Whether a code is one of the doctrines. */
export function isDoctrine(code: number): code is DoctrineCode {
  return Number.isInteger(code) && code >= 0 && code < DOCTRINE_COUNT;
}

/** What `player`'s doctrine does to one rule, in percent; 100 when the game has no doctrines or the player is not one of its players. */
export function doctrinePercent(game: Game, player: number, effect: keyof DoctrineEffects): number {
  if (!game.rules.doctrines) return 100;
  const code = game.player(player)?.doctrine ?? Doctrine.Balanced;
  return (DOCTRINE_EFFECTS[code] ?? NONE)[effect];
}

/** `value` changed by the percent of `player`'s doctrine for `effect`. */
export function withDoctrine(
  game: Game,
  player: number,
  effect: keyof DoctrineEffects,
  value: number,
): number {
  const percent = doctrinePercent(game, player, effect);
  return percent === 100 ? value : mulDiv(value, percent, 100);
}

/**
 * R-DOCTRINE-01: a player picks a doctrine during the spawn phase, and may
 * pick again until it ends.
 */
export function installDoctrines(game: Game): void {
  game.onOrder((_, player, order) => {
    if (order.type !== "doctrine") return false;
    player.doctrine = order.pick;
    return true;
  });
}

/** Why a doctrine cannot be picked, or undefined when it can (R-DOCTRINE-01). */
export function doctrineError(game: Game, pick: number): string | undefined {
  if (!game.rules.doctrines) return "this game has no doctrines";
  if (game.phase !== "spawn") return "doctrines are picked during the spawn phase";
  if (!isDoctrine(pick)) return "unknown doctrine";
  return undefined;
}

/** Share of the draw, in %, each doctrine starts from when a nation picks (R-DOCTRINE-04): conqueror, merchant, bastion. */
const NATION_WEIGHTS = [34, 33, 33] as const;
/** What a nation's situation adds to a doctrine's share. */
const NATION_LEAN = 16;

/**
 * R-DOCTRINE-04: the doctrine a nation picks at the start of the spawn
 * phase, from the game's Random. An easy nation draws among the three
 * evenly; the others lean toward what suits their start: the merchant on a
 * coast, the conqueror with open land around, the bastion when another
 * nation lies close. No doctrine ever falls below a fifth or above a half of
 * the draw.
 */
export function nationDoctrine(
  game: Game,
  nation: Player,
  difficulty: BotDifficulty,
): DoctrineCode {
  const picks = [Doctrine.Conqueror, Doctrine.Merchant, Doctrine.Bastion] as const;
  const weights: number[] = [...NATION_WEIGHTS];
  if (difficulty !== "easy" && nation.home !== undefined) {
    const { topology } = game.terrain;
    const { balance } = game;
    const reach = balance.spawnRadius;
    let coastal = false;
    for (const tile of topology.tilesWithin(nation.home, reach)) {
      if (game.terrain.isCoast(tile)) {
        coastal = true;
        break;
      }
    }
    const crowded = game
      .players()
      .some(
        (other) =>
          other !== nation &&
          other.home !== undefined &&
          topology.distance(other.home, nation.home as number) < balance.spawnDistance * 3,
      );
    if (coastal) weights[1] = (weights[1] as number) + NATION_LEAN;
    if (crowded) weights[2] = (weights[2] as number) + NATION_LEAN;
    else weights[0] = (weights[0] as number) + NATION_LEAN;
  }
  const total = weights.reduce((sum, w) => sum + w, 0);
  let draw = game.random.nextInt(0, total);
  for (const [i, weight] of weights.entries()) {
    if (draw < weight) return picks[i] as DoctrineCode;
    draw -= weight;
  }
  return Doctrine.Balanced;
}
