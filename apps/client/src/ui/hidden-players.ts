import type { GameUpdate } from "../game/game-runner.ts";
import { t } from "../i18n/index.ts";

/**
 * The update as a player who hid others sees it (R-DIPLO-08): a hidden
 * player goes by their number everywhere, and their quick messages are
 * dropped. Nothing else changes, and the game itself never knows.
 */
export function withHidden(update: GameUpdate, hidden: ReadonlySet<number>): GameUpdate {
  if (hidden.size === 0) return update;
  return {
    ...update,
    players: update.players.map((player) =>
      hidden.has(player.id)
        ? { ...player, name: t("diplo.hiddenName", { number: player.id }) }
        : player,
    ),
    events: update.events.filter((event) => event.type !== "quick" || !hidden.has(event.a)),
  };
}
