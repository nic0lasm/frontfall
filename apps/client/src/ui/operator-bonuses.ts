import { OperatorBonus } from "@frontfall/engine";
import { t, type MessageKey } from "../i18n/index.ts";

/** The operator's test bonuses (R-MODE-09), in the order the lobby offers them. */
export const OPERATOR_BONUSES: readonly { bit: number; key: MessageKey }[] = [
  { bit: OperatorBonus.Gold, key: "operator.gold" },
  { bit: OperatorBonus.Troops, key: "operator.troops" },
  { bit: OperatorBonus.Building, key: "operator.building" },
  { bit: OperatorBonus.Defense, key: "operator.defense" },
];

/** The names of the bonuses among `bits`, in the language. */
export function operatorBonusNames(bits: number): string[] {
  return OPERATOR_BONUSES.filter(({ bit }) => (bits & bit) !== 0).map(({ key }) => t(key));
}

/** What every player of the game is told (R-MODE-09); empty for a game without bonuses. */
export function operatorBonusLine(
  key: "online.operatorOn" | "end.operator",
  bonuses: { player: number; bonuses: number } | null | undefined,
  players: readonly { id: number; name: string }[],
): string {
  if (!bonuses || bonuses.bonuses === 0) return "";
  const name = players.find((player) => player.id === bonuses.player)?.name ?? "";
  return t(key, { name, bonuses: operatorBonusNames(bonuses.bonuses).join(", ") });
}
