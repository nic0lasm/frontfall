import { DEFAULT_RULES, type GameRules } from "@frontfall/protocol";
import type { Difficulty } from "./game-view.ts";

/** The bot levels on offer, easiest first. The one list the menu, the lobby and saved setups read. */
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

/** The level a new game starts at. */
export const DEFAULT_DIFFICULTY: Difficulty = "easy";

/** The special rules at their defaults, as a copy to change. */
export function defaultRules(): GameRules {
  return { ...DEFAULT_RULES };
}
