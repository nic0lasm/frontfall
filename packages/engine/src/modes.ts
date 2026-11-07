import { Disable, RuleBit, type GameRules } from "@frontfall/contracts";

/**
 * How much each operator's bonus does (R-MODE-09): twice the gold, troops and
 * defense, half the price. Not a balance value: it never applies to a game
 * anyone but the operator plays to win, and the balance digest stays as it was.
 */
export const OPERATOR_FACTOR = 2;

export interface OperatorBonuses {
  /** The player who has the bonuses. */
  readonly player: number;
  /** `OperatorBonus` bits; 0 for none. */
  readonly bonuses: number;
}

/** No operator's bonus at all. */
export const NO_OPERATOR: OperatorBonuses = { player: 0, bonuses: 0 };

/** One bit per special rule that is on, for the state hash and the setup digest; 0 with none. */
export function ruleBits(rules: GameRules): number {
  return (
    (rules.capitals ? RuleBit.Capitals : 0) |
    (rules.collapsingFronts ? RuleBit.CollapsingFronts : 0) |
    (rules.doctrines ? RuleBit.Doctrines : 0)
  );
}

/** What a game leaves out once its implications are added: warships are launched from ports (R-MODE-03). */
export function leftOut(disabled: number): number {
  return disabled & Disable.Port ? disabled | Disable.Warships : disabled;
}
