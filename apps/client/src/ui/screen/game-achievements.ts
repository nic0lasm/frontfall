import { safeStorage, safeSession } from "../../storage.ts";
import type { GameRules } from "../../game/messages.ts";
import type { Difficulty, GameUpdate } from "../../game/game-view.ts";
import { AchievementStore, type Gain } from "../../achievements/store.ts";
import { AchievementTracker, type Credited } from "../../achievements/tracker.ts";

/**
 * The achievements of one game: what it earns is kept at once, so a closed
 * tab loses nothing, and what it already counted is kept for the tab, so a
 * screen made again after a reload or a reconnection counts nothing twice.
 */
export class GameAchievements {
  private readonly store = new AchievementStore(safeStorage());
  /** Watches the game; none until it starts, and none for a replay. */
  private tracker: AchievementTracker | undefined;
  /** What this game earned the player for the first time. */
  readonly earned: Gain[] = [];

  constructor(
    /** The same game, for a screen made again after a reload or a reconnection. */
    private readonly key: string,
  ) {}

  /** Starts watching the game; `difficulty` is set for a solo game only. */
  start(rules: GameRules, difficulty: Difficulty | undefined): void {
    this.tracker = new AchievementTracker(
      {
        ticksPerSecond: rules.ticksPerSecond,
        ownableTiles: rules.ownableTiles,
        disabled: rules.disabled,
        difficulty,
        teamGame: rules.teams.length > 0,
      },
      this.load(),
    );
  }

  observe(update: GameUpdate): void {
    const delta = this.tracker?.observe(update);
    if (!delta || (delta.fresh.length === 0 && Object.keys(delta.counts).length === 0)) return;
    this.earned.push(...this.store.record(delta, Date.now()));
    this.save();
  }

  private load(): Credited | undefined {
    try {
      const raw = safeSession()?.getItem(this.key);
      return raw ? (JSON.parse(raw) as Credited) : undefined;
    } catch {
      return undefined;
    }
  }

  private save(): void {
    try {
      if (this.tracker) {
        safeSession()?.setItem(this.key, JSON.stringify(this.tracker.credited()));
      }
    } catch {
      // Without it a reload may count a city twice.
    }
  }
}
