/**
 * The seat of this tab in a running online game, so a reload takes it back
 * instead of leaving the game: session storage lives as long as the tab.
 * A copy in local storage outlives the tab, so that the menu of a page
 * opened again offers to go back to the game while the server keeps the seat.
 */
const KEY = "frontfall.seat";

/** How long the server keeps the seat of a player gone (docs/server.md). */
export const SEAT_KEPT_MS = 5 * 60_000;
/**
 * A seat heard from more recently than this is still played in another tab:
 * the game page touches it every few seconds.
 */
export const SEAT_HELD_MS = 15_000;

interface Seat {
  game: string;
  token: string;
}

/** A seat left behind by a tab that closed, with when that tab last heard from the game. */
export interface AwaySeat extends Seat {
  seenAt: number;
}

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function lasting(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function saveSeat(game: string, token: string, now = Date.now()): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ game, token } satisfies Seat));
    lasting()?.setItem(KEY, JSON.stringify({ game, token, seenAt: now } satisfies AwaySeat));
  } catch {
    // Storage full or blocked: a reload will join from the link instead.
  }
}

/** The game is still heard from: the seat is not one left behind. */
export function touchSeat(game: string, now = Date.now()): void {
  try {
    const seat = readAway();
    if (seat?.game === game) lasting()?.setItem(KEY, JSON.stringify({ ...seat, seenAt: now }));
  } catch {
    // Nothing to touch.
  }
}

/** The token of this tab's seat in `game`, if it holds one. */
export function seatIn(game: string): string | undefined {
  try {
    const seat = JSON.parse(storage()?.getItem(KEY) ?? "null") as Partial<Seat> | null;
    return seat?.game === game && typeof seat.token === "string" ? seat.token : undefined;
  } catch {
    return undefined;
  }
}

function readAway(): AwaySeat | undefined {
  try {
    const seat = JSON.parse(lasting()?.getItem(KEY) ?? "null") as Partial<AwaySeat> | null;
    return typeof seat?.game === "string" &&
      typeof seat.token === "string" &&
      typeof seat.seenAt === "number"
      ? { game: seat.game, token: seat.token, seenAt: seat.seenAt }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The seat a closed tab left in a game the server may still keep, unless
 * another tab plays it now. A seat too old to be kept is forgotten.
 */
export function awaySeat(now = Date.now()): AwaySeat | undefined {
  const seat = readAway();
  if (!seat) return undefined;
  if (now - seat.seenAt >= SEAT_KEPT_MS || seat.seenAt > now) {
    forgetSeat();
    return undefined;
  }
  return now - seat.seenAt < SEAT_HELD_MS ? undefined : seat;
}

/**
 * How long until a seat left by a closed tab stops looking held by another
 * tab, when it does now: the menu offers the game again then.
 */
export function seatHeldFor(now = Date.now()): number | undefined {
  const seat = readAway();
  if (!seat || now - seat.seenAt >= SEAT_KEPT_MS || seat.seenAt > now) return undefined;
  const left = SEAT_HELD_MS - (now - seat.seenAt);
  return left > 0 ? left : undefined;
}

export function forgetSeat(): void {
  try {
    storage()?.removeItem(KEY);
    lasting()?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
