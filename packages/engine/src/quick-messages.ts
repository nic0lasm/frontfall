import { QUICK_MESSAGES } from "@frontfall/contracts";
import { DiplomacyError, logEvent } from "./diplomacy.ts";
import type { Game, Player } from "./game.ts";

export { QUICK_MESSAGES };

/** Ticks a player waits between two quick messages, to anyone: 2 seconds. */
export const QUICK_MESSAGE_TICKS = 20;

/** First tick `player` may send a quick message again; at or below the current tick when they may. */
export function quickAllowedAt(game: Game, player: number): number {
  return game.quickCooldowns.find((c) => c.player === player)?.until ?? 0;
}

/** Why a quick message is refused once its target is known to be an integer. */
export const QuickError = {
  Early: "messages start after the spawn phase",
  Self: "a player cannot send themselves a message",
  Phrase: "no such quick message",
  Cooldown: "too soon after the last message",
} as const;
export type QuickError = (typeof QuickError)[keyof typeof QuickError];

/** Why `player` cannot send `target` quick message `phrase` now, or undefined. */
export function quickError(
  game: Game,
  player: Player,
  target: number,
  phrase: number,
): string | undefined {
  if (game.phase !== "play") return QuickError.Early;
  if (target === player.id) return QuickError.Self;
  if (!game.player(target)?.alive) return DiplomacyError.Player;
  if (!Number.isSafeInteger(phrase) || phrase < 0 || phrase >= QUICK_MESSAGES) {
    return QuickError.Phrase;
  }
  if (game.tick < quickAllowedAt(game, player.id)) return QuickError.Cooldown;
  return undefined;
}

/**
 * Quick messages (R-DIPLO-07). A `quick` order changes nothing in the game
 * but the sender's wait of QUICK_MESSAGE_TICKS before the next one: it goes
 * into the event log for the two players' interfaces to show.
 */
export function installQuickMessages(game: Game): void {
  game.onOrder((_, player, order) => {
    if (order.type !== "quick") return false;
    const cooldowns = game.quickCooldowns;
    const until = game.tick + QUICK_MESSAGE_TICKS;
    const kept = cooldowns.filter((c) => c.player !== player.id && game.tick < c.until);
    kept.push({ player: player.id, until });
    kept.sort((x, y) => x.player - y.player);
    cooldowns.splice(0, cooldowns.length, ...kept);
    logEvent(game, {
      tick: game.tick,
      type: "quick",
      a: player.id,
      b: order.target,
      phrase: order.phrase,
    });
    return true;
  });
}
