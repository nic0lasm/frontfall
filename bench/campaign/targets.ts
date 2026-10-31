import type { BotDifficulty } from "@frontfall/engine";
import type { ProfileName } from "./profiles.ts";

/** Win rate, in %, a profile must reach at a difficulty: [min, max]. */
export const WIN_TARGETS: Record<ProfileName, Record<BotDifficulty, readonly [number, number]>> = {
  // A first-timer who ignores the guide: can win easy now and then, almost never above.
  beginner: { easy: [30, 65], normal: [0, 15], hard: [0, 5] },
  // Nico: fast and at ease with boats and alliances; the 80 / 50 / 30 of the brief, a little above.
  nico: { easy: [80, 100], normal: [50, 75], hard: [30, 55] },
  // A veteran: wins easy, usually wins normal, hard is a fair fight.
  veteran: { easy: [90, 100], normal: [65, 90], hard: [45, 70] },
};

/** A profile must beat the one below it by this many points at each difficulty, or skill does not pay. */
export const SKILL_GAP_POINTS = 8;

/** Survival at the end of a game, in % at least, per profile on easy. */
export const SURVIVAL_EASY_MIN: Record<ProfileName, number> = {
  beginner: 80,
  nico: 95,
  veteran: 98,
};

/** Fun: bounds on what the player lives. */
export const FUN = {
  /** Median share of minutes with no land change, % at most. */
  deadMinutesMaxPercent: 25,
  /** Median minute of the first fight at most, in normal. */
  firstFightMaxMinute: 8,
  /** Games that stall undecided for 10 min, % at most. */
  stalemateMaxPercent: 5,
  /** Orders refused for a profile that clicks right, % at most. */
  refusedMaxPercentVeteran: 10,
};

/** Perf: engine tick cost, ms. */
export const PERF = { tickP99MaxMs: 12, tickMaxMs: 120, startMaxMs: 250 };
