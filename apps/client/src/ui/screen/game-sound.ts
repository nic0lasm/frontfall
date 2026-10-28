import type { GameUpdate } from "../../game/game-view.ts";
import type { Sound } from "../../audio/sound.ts";
import { accessibility } from "../accessibility.ts";

/**
 * Gives the game its sound effects. The audio code is a chunk of its own,
 * fetched when the first sound is due, so the first visit does not carry it.
 */
export class GameSound {
  private sound: Sound | undefined;
  /** Fetching, or fetched in vain: either way, no new try. */
  private loading = false;
  private disposed = false;

  observe(update: GameUpdate): void {
    this.sound?.observe(update);
    if (this.sound || this.loading || update.replay || accessibility().muted) return;
    this.loading = true;
    import("../../audio/sound.ts").then(
      ({ Sound }) => {
        this.loading = false;
        if (!this.disposed) this.sound = new Sound(accessibility);
      },
      () => {
        // Without the chunk the game goes on in silence.
      },
    );
  }

  dispose(): void {
    this.disposed = true;
    this.sound?.dispose();
    this.sound = undefined;
  }
}
