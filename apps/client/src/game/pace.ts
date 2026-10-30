/**
 * How much of a beat's worth of ticks a game at speed 1 runs: a normal game
 * plays a quarter slower than the simulation's nominal rate. Only the cadence
 * changes, never what a tick does (R-MODE-07). The server has the same value
 * in `apps/server/src/room.ts`.
 */
export const BASE_PACE = 0.75;
