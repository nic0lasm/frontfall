/** Ticks per second of the simulation at speed 1. The server closes one turn per tick. */
export const TICK_RATE = 10;

/** How hard the computer players play, from the easiest. Every client runs them at the level the game was set to. */
export const DIFFICULTIES = ["easy", "normal", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Number of doctrines (R-DOCTRINE), the balanced one included: codes 0 to 3. */
export const DOCTRINE_COUNT = 4;

/**
 * Preset quick messages and emoji a player can send (R-DIPLO-07), by number
 * from 0. Their words belong to the interfaces; the engine only relays the
 * number, so no free text ever enters a game.
 */
export const QUICK_MESSAGES = 12;
