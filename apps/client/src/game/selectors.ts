import type { GameUpdate, PlayerView } from "./game-view.ts";

/** The player this screen plays, or undefined while the update does not list them (a replay, an eliminated seat). */
export function youOf(update: Pick<GameUpdate, "players" | "you">): PlayerView | undefined {
  return update.players.find((player) => player.id === update.you);
}
