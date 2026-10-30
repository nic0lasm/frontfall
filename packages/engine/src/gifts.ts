import { DiplomacyError, isAllied, logEvent } from "./diplomacy.ts";
import { populationCap, soldiers } from "./economy.ts";
import type { Game, Player } from "./game.ts";
import { atWar } from "./warships.ts";

/** Why a gift is refused once its target is known to be an integer. */
export const GiftError = {
  Early: "gifts start after the spawn phase",
  Self: "a player cannot send themselves a gift",
  Amount: "invalid amount",
  Empty: "nothing to send",
  Troops: "not enough troops",
  Gold: "not enough gold",
  Full: "their troops are at their cap",
  War: "gifts are refused between players at war",
  Ally: "gifts go to allies and teammates only",
} as const;
export type GiftError = (typeof GiftError)[keyof typeof GiftError];

/** Troops of a gift that `to` takes in: as many as fit under their population cap. */
export function giftedTroops(game: Game, to: Player, troops: number): number {
  return Math.min(troops, Math.max(0, populationCap(game, to) - to.troops));
}

/** Why `player` cannot send `target` these troops and this gold now, or undefined. */
export function giftError(
  game: Game,
  player: Player,
  target: number,
  troops: number,
  gold: number,
): string | undefined {
  if (game.phase !== "play") return GiftError.Early;
  if (target === player.id) return GiftError.Self;
  const to = game.player(target);
  if (!to?.alive) return DiplomacyError.Player;
  if (!Number.isSafeInteger(troops) || troops < 0) return GiftError.Amount;
  if (!Number.isSafeInteger(gold) || gold < 0) return GiftError.Amount;
  if (troops === 0 && gold === 0) return GiftError.Empty;
  // R-ECO-07: workers stay at home.
  if (troops > soldiers(player)) return GiftError.Troops;
  if (gold > player.gold) return GiftError.Gold;
  if (gold === 0 && giftedTroops(game, to, troops) === 0) return GiftError.Full;
  if (atWar(game, player.id, target)) return GiftError.War;
  if (!isAllied(game, player.id, target)) return GiftError.Ally;
  return undefined;
}

/**
 * Gifts (R-DIPLO-06). A `gift` order moves troops and gold from one player
 * to another at once. The troops the receiver's population cap has no room
 * for stay with the sender. Every player is told.
 */
export function installGifts(game: Game): void {
  game.onOrder((_, player, order) => {
    if (order.type !== "gift") return false;
    const to = game.player(order.target);
    if (!to) return false;
    const troops = giftedTroops(game, to, order.troops);
    player.troops -= troops;
    to.troops += troops;
    player.gold -= order.gold;
    to.gold += order.gold;
    logEvent(game, { tick: game.tick, type: "gift", a: player.id, b: to.id });
    return true;
  });
}
