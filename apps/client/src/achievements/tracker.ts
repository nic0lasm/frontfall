import { Disable } from "@frontfall/engine";
import type { Difficulty, GameUpdate } from "../game/game-view.ts";
import type { AchievementId } from "./catalog.ts";
import type { Delta } from "./store.ts";

/** What a game is, known before its first update. */
export interface AchievementGame {
  ticksPerSecond: number;
  ownableTiles: number;
  /** `Disable` bits of what the game leaves out. */
  disabled: number;
  /** Left out online, where there are no bots to pick a difficulty for. */
  difficulty?: Difficulty | undefined;
  /** Whether players are dealt into teams. */
  teamGame: boolean;
}

/** A victory in under this many seconds is a quick one. */
export const QUICK_SECONDS = 20 * 60;
/** The least players a game needs for its victory to count: the player and two rivals. */
const MIN_PLAYERS = 3;
const HALF = 0.5;
/** Land share the comeback starts from, and the share it falls below. */
const COMEBACK_PEAK = 0.1;
const COMEBACK_LOW = 0.03;
const METROPOLIS_CITIES = 5;
/** Players in a game for a victory to be in a crowded world. */
const CROWDED = 10;

/** What a game has already credited, to keep when the page is reloaded or the connection resumes. */
export interface Credited {
  /** Ids of the cities counted. */
  cities: number[];
  /** Whether the finished game was counted. */
  counted: boolean;
}

/**
 * Watches one game as its player sees it and says which achievements it
 * earned. Nothing here changes the game: it only reads the updates the
 * screen already gets, so no rule, replay or message depends on it.
 */
export class AchievementTracker {
  private readonly earned = new Set<AchievementId>();
  private peakShare = 0;
  private fell = false;
  private launched = false;
  private counted: boolean;
  /** Cities already counted, by id. */
  private readonly cities: Set<number>;

  constructor(
    private readonly game: AchievementGame,
    credited?: Credited,
  ) {
    this.cities = new Set(credited?.cities);
    this.counted = credited?.counted ?? false;
  }

  /** What this game has credited so far, for a tracker that takes over after a reload. */
  credited(): Credited {
    return { cities: [...this.cities], counted: this.counted };
  }

  /** Reads one update; returns what it adds, no achievement twice and no city or game counted twice. */
  observe(update: GameUpdate): Delta {
    const fresh: AchievementId[] = [];
    const counts: Delta["counts"] = {};
    const earn = (id: AchievementId): void => {
      if (this.earned.has(id)) return;
      this.earned.add(id);
      fresh.push(id);
    };
    const you = update.players.find((p) => p.id === update.you);
    const decided = update.winner !== undefined && update.players.length >= MIN_PLAYERS;
    const won =
      decided &&
      (update.winningTeam === undefined
        ? update.winner === update.you
        : update.winner === update.you || update.diplomacy.teammates.includes(update.winner ?? -1));
    if (decided && !this.counted) {
      // The game counts for the player out of it too.
      this.counted = true;
      counts.games = 1;
      if (you?.alive && won) counts.wins = 1;
    }
    if (!you?.alive) return { fresh, counts };

    const share = you.tiles / Math.max(1, this.game.ownableTiles);
    this.peakShare = Math.max(this.peakShare, share);
    if (this.peakShare >= COMEBACK_PEAK && share < COMEBACK_LOW) this.fell = true;
    if (share >= HALF) earn("halfWorld");

    let cities = 0;
    for (const structure of update.structures) {
      if (structure.player !== update.you || !structure.ready) continue;
      if (structure.type === "city") {
        cities++;
        if (!this.cities.has(structure.id)) {
          this.cities.add(structure.id);
          counts.cities = (counts.cities ?? 0) + 1;
        }
      } else if (structure.type === "palace") earn("palace");
      else if (structure.type === "fort") earn("fortress");
      else if (structure.type === "port") earn("harbor");
    }
    if (cities >= METROPOLIS_CITIES) earn("metropolis");

    if (update.tradeShips.some((ship) => ship.player === update.you)) earn("merchant");
    if (update.events.some((event) => event.type === "gift" && event.a === update.you)) {
      earn("generous");
    }
    if (update.boats.some((boat) => boat.player === update.you)) earn("setSail");
    if (update.warships.some((ship) => ship.player === update.you)) earn("admiral");
    if (update.missiles.some((missile) => missile.player === update.you)) {
      this.launched = true;
      earn("missile");
    }
    if (!this.game.teamGame && update.diplomacy.allies.length > 0) earn("ally");

    if (won) {
      if (update.players.length >= CROWDED) earn("crowded");
      if (this.game.difficulty === "hard") earn("hardVictory");
      if (this.game.teamGame) earn("teamVictory");
      if (update.tick / this.game.ticksPerSecond <= QUICK_SECONDS) earn("quickVictory");
      if (this.fell) earn("comeback");
      // A game that has no silos has no missiles to leave unused.
      if (!this.launched && (this.game.disabled & Disable.Silo) === 0) earn("noMissiles");
    }
    return { fresh, counts };
  }
}
