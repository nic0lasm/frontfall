import type { Game } from "./game.ts";
import { percentOf } from "./integer-math.ts";
import { writable } from "./state/lists.ts";

/**
 * R-DIPLO-02: the attacks between two players end, and their troops go home
 * as from a retreat (B-RETREAT-PENALTY): for new allies, or the two sides of
 * a truce. The attack list belongs to the attack rules (ADR 0010); this owner
 * function sits apart from attacks.ts because diplomacy calls it, and
 * attacks.ts imports diplomacy.
 */
export function recallAttacks(game: Game, first: number, second: number): void {
  const { retreatPenaltyPercent } = game.balance;
  for (const attack of writable(game, "attacks")) {
    const against =
      (attack.player === first && attack.target === second) ||
      (attack.player === second && attack.target === first);
    if (!against || attack.troops <= 0) continue;
    const owner = game.player(attack.player);
    if (owner) owner.troops += attack.troops - percentOf(attack.troops, retreatPenaltyPercent);
    attack.troops = 0;
  }
}
