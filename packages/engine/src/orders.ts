import type { Order, OrderType } from "@frontfall/contracts";
import { ATTACK_ORDER, RETREAT_ORDER } from "./attacks.ts";
import { EMBARK_ORDER } from "./boats.ts";
import { ALLY_ORDER, BETRAY_ORDER, EMBARGO_ORDER, TRIBUTE_ORDER } from "./diplomacy.ts";
import { DOCTRINE_ORDER } from "./doctrines.ts";
import { WORK_ORDER } from "./economy.ts";
import type { Game, Player } from "./game.ts";
import { GIFT_ORDER } from "./gifts.ts";
import { MISSILE_ORDER } from "./missiles.ts";
import { eraseRule, planOrder, refusalOf, type OrderRule } from "./order-rules.ts";
import { QUICK_ORDER } from "./quick-messages.ts";
import { SPAWN_ORDER } from "./spawn.ts";
import { BUILD_ORDER, DEMOLISH_ORDER } from "./structures.ts";
import { PATROL_ORDER, WARSHIP_ORDER } from "./warships.ts";

/**
 * The rule of every kind of order of the engine, by type: the same rules
 * `createGame` installs, so that `orderError` answers for any game, rules
 * installed or not. A kind missing here fails type checking.
 */
export const ORDER_RULES = {
  spawn: SPAWN_ORDER,
  attack: ATTACK_ORDER,
  retreat: RETREAT_ORDER,
  embark: EMBARK_ORDER,
  build: BUILD_ORDER,
  demolish: DEMOLISH_ORDER,
  ally: ALLY_ORDER,
  betray: BETRAY_ORDER,
  embargo: EMBARGO_ORDER,
  warship: WARSHIP_ORDER,
  patrol: PATROL_ORDER,
  missile: MISSILE_ORDER,
  gift: GIFT_ORDER,
  quick: QUICK_ORDER,
  work: WORK_ORDER,
  tribute: TRIBUTE_ORDER,
  doctrine: DOCTRINE_ORDER,
} as const satisfies { readonly [T in OrderType]: OrderRule<T> };

const RULES_BY_TYPE = new Map<string, OrderRule>(
  Object.values(ORDER_RULES).map((rule) => [rule.type, eraseRule(rule)]),
);

/**
 * Why an order cannot be carried out in the current state, or undefined when
 * it can. Orders come from the network, so nothing about them is trusted:
 * every field is checked here before any rule carries the order out.
 */
export function orderError(game: Game, player: Player, order: Order): string | undefined {
  // The protocol lets no unknown kind through; the engine would ignore one.
  const rule = RULES_BY_TYPE.get(order.type);
  return rule && refusalOf(planOrder(game, player, order, rule));
}
