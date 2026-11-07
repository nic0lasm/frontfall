import type { OrderOf, OrderType } from "@frontfall/contracts";
import type { Game, Phase, Player } from "./game.ts";

/** Why an order is refused, in the words `orderError` gives. */
export type Refusal = string;

/**
 * How one kind of order runs (ADR 0007). `validate` makes every check of the
 * order against the state and returns either the reason it is refused, or a
 * plan: the order, or what the checks found on the way (a route, a silo, a
 * shore tile, the receiver of a gift), so that `execute` searches nothing
 * twice. `execute` carries the plan out and cannot refuse it: an order that
 * passes `validate` is carried out, and `orderError` gives the reason of
 * every one that is not.
 */
export interface OrderRule<T extends OrderType = OrderType, P extends object = object> {
  readonly type: T;
  /** The phases the order is allowed in; outside them it is refused with `wrongPhase`. */
  readonly phases: readonly Phase[];
  readonly wrongPhase?: Refusal;
  validate(game: Game, player: Player, order: OrderOf<T>): Refusal | P;
  execute(game: Game, player: Player, plan: P): void;
}

/**
 * Every phase. Orders whose phase is checked by their `xError` function,
 * after a check of their fields, keep it there so that the reason given for
 * a refusal stays the same.
 */
export const ANY_PHASE: readonly Phase[] = Object.freeze(["spawn", "play"]);
/** The phase after the spawn phase (R-SPAWN-05). */
export const PLAY_PHASE: readonly Phase[] = Object.freeze(["play"]);

/** The rule of the orders of `type`, for `game.onOrder`, with its order and its plan typed. */
export function defineOrder<T extends OrderType, P extends object>(
  type: T,
  rule: Omit<OrderRule<T, P>, "type">,
): OrderRule<T, P> {
  return Object.freeze({ ...rule, type });
}

/**
 * A rule as a table of rules of every type keeps it. The table is keyed by
 * type, so the rule is only ever handed orders of its own type, and plans of
 * its own making.
 */
export function eraseRule(rule: Pick<OrderRule, "type" | "phases">): OrderRule {
  return rule as OrderRule;
}

/** What a rule makes of an order in the current state: the reason it is refused, or its plan. */
export function planOrder<T extends OrderType, P extends object>(
  game: Game,
  player: Player,
  order: OrderOf<T>,
  rule: OrderRule<T, P>,
): Refusal | P {
  if (!rule.phases.includes(game.phase)) return rule.wrongPhase ?? "not allowed in this phase";
  return rule.validate(game, player, order);
}

/** The refusal of a plan or a refusal, or undefined for a plan. */
export function refusalOf(planned: Refusal | object): Refusal | undefined {
  return typeof planned === "string" ? planned : undefined;
}

/** Why a tile taken from an order is not ownable land on the map, or undefined. */
export function tileError(game: Game, tile: number): Refusal | undefined {
  if (!Number.isInteger(tile) || tile < 0 || tile >= game.terrain.topology.size) {
    return "the tile is outside the map";
  }
  if (!game.terrain.isOwnable(tile)) return "the tile cannot be owned";
  return undefined;
}
