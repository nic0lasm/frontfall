import type { GameUpdate } from "../../game/game-runner.ts";
import type { SessionCapabilities } from "../../game/session.ts";

/** What the screen knows when the player tries to act. */
export interface ActState {
  readonly can: Pick<SessionCapabilities, "canOrder">;
  /** A dialog stopped the game: the pause banner, the help, the end screen. */
  readonly paused: boolean;
  readonly latest: GameUpdate | undefined;
}

/**
 * Whether the player can act now: never while watching a record, while a
 * dialog holds the game, or before its first update, and with `phase` only
 * in that phase. A decided game is not refused here: a solo game waits
 * behind its end screen, which pauses it, and every game plays on once the
 * player chooses to keep watching (R-WIN-03).
 */
export function canAct(
  state: ActState,
  phase?: GameUpdate["phase"],
): state is ActState & { readonly latest: GameUpdate } {
  const { latest } = state;
  if (latest === undefined || !state.can.canOrder || state.paused) return false;
  return phase === undefined || latest.phase === phase;
}
