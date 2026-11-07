import type { GameRules } from "../../game/messages.ts";
import { youOf } from "../../game/selectors.ts";
import type { SessionCapabilities } from "../../game/session.ts";
import type { Difficulty, GameUpdate } from "../../game/game-runner.ts";
import { colorOf } from "../../palette.ts";
import { usage, type GameTracker } from "../../usage.ts";
import type { GameSummary } from "../end-screen.ts";
import { GameAchievements } from "./game-achievements.ts";
import { StatsRecorder } from "./stats-history.ts";

export interface OutcomeOptions {
  readonly can: SessionCapabilities;
  /** The map and the seed: the same game, for a screen made again after a reload. */
  readonly map: string;
  readonly seed: number;
  /** Whether the map is a published one, which a record of the game can name. */
  readonly published: boolean;
  /** Reports the game once it ends for the player; none for a replay (docs/privacy.md). */
  readonly tracker: GameTracker | undefined;
  /** The game is decided for the player: a reload no longer comes back to it. */
  readonly onDecided?: (() => void) | undefined;
}

/**
 * How the game goes for the player at this screen: the most land they held,
 * their land and troops over time, the achievements and the usage report,
 * and the moments they are wiped out and the game is decided. It says what
 * the end screen shows.
 */
export class GameOutcome {
  private readonly achievements: GameAchievements;
  private stats = new StatsRecorder(10);
  private rules: GameRules | undefined;
  private latest: GameUpdate | undefined;
  private peakTiles = 0;
  /** The player's start appeared: from then on, no land means wiped out. */
  private appeared = false;
  /** The player was wiped out, and the page told so. */
  private outNoted = false;
  private decided = false;

  constructor(private readonly o: OutcomeOptions) {
    this.achievements = new GameAchievements(`frontfall.credited.${o.map}.${String(o.seed)}`);
  }

  /** The game started; `difficulty` counts for the achievements of a solo game only. */
  start(rules: GameRules, difficulty: Difficulty): void {
    this.rules = rules;
    this.stats = new StatsRecorder(rules.ticksPerSecond);
    const { can } = this.o;
    if (can.canOrder && rules.operator.bonuses === 0) {
      this.achievements.start(rules, can.kind === "solo" ? difficulty : undefined);
    }
  }

  /**
   * Takes in an update, as the engine sent it and as this screen shows it
   * (hidden players renamed). True once, for the update that decides the
   * game: the screen then shows its end.
   */
  observe(update: GameUpdate, shown: GameUpdate, frameMs: number): boolean {
    const { can, tracker, onDecided } = this.o;
    this.latest = update;
    const human = youOf(update);
    if (human) {
      this.peakTiles = Math.max(this.peakTiles, human.tiles);
      if (human.tiles > 0) this.appeared = true;
    }
    this.achievements.observe(update);
    if (can.canOrder) this.stats.observe(shown);
    tracker?.observe(shown, frameMs, performance.now());
    // Wiped out, the player may watch on, but a reload no longer brings the game back.
    if (!this.outNoted && this.out) {
      this.outNoted = true;
      onDecided?.();
    }
    if (shown.winner === undefined || this.decided || !can.canOrder) return false;
    this.decided = true;
    const team = shown.winningTeam;
    const teams = this.rules?.teams ?? [];
    const won = team === undefined ? shown.winner === shown.you : teams[shown.you] === team;
    tracker?.end(won ? "victory" : "defeat", Date.now());
    onDecided?.();
    return true;
  }

  /** The game was decided while the player watched it. */
  get ended(): boolean {
    return this.decided;
  }

  /** Whether the player has been wiped out of the game. */
  get out(): boolean {
    const human = this.latest ? youOf(this.latest) : undefined;
    return human !== undefined && (!human.alive || human.tiles === 0) && this.appeared;
  }

  /** Whether the player still has a game to lose. */
  get playing(): boolean {
    const human = this.latest ? youOf(this.latest) : undefined;
    return this.o.can.canOrder && !this.decided && human?.alive === true && human.tiles > 0;
  }

  /** The screen goes: for the menu or a new game, the tab closing, or the connection lost. */
  left(why: "left" | "closed" | "disconnected"): void {
    this.o.tracker?.end(why === "closed" ? why : this.out ? "defeat" : why, Date.now());
  }

  /** What the end screen says of the game decided by `update`. */
  summary(update: GameUpdate): GameSummary {
    const rules = this.rules;
    const firstNation = rules?.firstNation ?? Infinity;
    const teams = rules?.teams ?? [];
    return {
      update,
      ticksPerSecond: rules?.ticksPerSecond ?? 10,
      ownableTiles: rules?.ownableTiles ?? 1,
      peakTiles: this.peakTiles,
      stats: this.stats.finish(update),
      winShare: rules?.winSharePercent ?? 100,
      color: (player) => colorOf(player, firstNation, teams),
      achievements: this.achievements.earned,
      // Only a published map can be pinned in a record.
      canRecord: this.o.published && this.o.can.recordable,
      teams,
      special: { ...rules?.special },
      ...(rules ? { operator: rules.operator } : {}),
      details: `${this.o.map}, ${usage().device().device}`,
      kind: this.o.can.kind,
    };
  }
}
