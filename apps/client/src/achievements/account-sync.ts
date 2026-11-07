import { safeStorage } from "../storage.ts";

/**
 * Achievements of this device, as the account keeps them. Loaded with the
 * sign-in box only, so it reads the browser's storage itself rather than
 * through the store, whose code is part of the first visit: the key and
 * the shape are those of store.ts, which drops anything it does not know.
 */

const KEY = "frontfall.achievements";
const VERSION = 1;
const ID = /^[a-z][a-z0-9-]{0,39}$/;
const isLevel = (level: unknown): level is number =>
  typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 3;

/** Achievements as they are written down, in the browser or with an account. */
export interface SavedAchievements {
  earned: Record<string, { at: number; level: number }>;
  counts: Record<string, number>;
}

/** What this device has earned; nothing when its storage cannot be read. */
export function deviceAchievements(store = safeStorage()): SavedAchievements {
  const found: SavedAchievements = { earned: {}, counts: {} };
  let data: unknown;
  try {
    data = JSON.parse(store?.getItem(KEY) ?? "null");
  } catch {
    return found;
  }
  if (!isObject(data) || data.v !== VERSION) return found;
  // Only what the account takes: one odd entry would have it refuse them all.
  for (const [id, entry] of Object.entries(isObject(data.earned) ? data.earned : {})) {
    if (!ID.test(id) || !isObject(entry)) continue;
    const { at } = entry;
    const level = entry.level ?? 1;
    if (typeof at === "number" && Number.isFinite(at) && at >= 0 && isLevel(level))
      found.earned[id] = { at, level };
  }
  for (const [counter, count] of Object.entries(isObject(data.counts) ? data.counts : {})) {
    if (ID.test(counter) && typeof count === "number" && Number.isSafeInteger(count) && count >= 0)
      found.counts[counter] = count;
  }
  return found;
}

/**
 * Adds achievements kept with the account to those of this device: the
 * higher level and the earlier day of each, the larger of each count.
 */
export function absorbAchievements(kept: SavedAchievements, store = safeStorage()): void {
  const mine = deviceAchievements(store);
  for (const [id, entry] of Object.entries(kept.earned)) {
    if (!isObject(entry) || typeof entry.at !== "number" || !isLevel(entry.level)) continue;
    const before = Object.hasOwn(mine.earned, id) ? mine.earned[id] : undefined;
    mine.earned[id] = before
      ? { at: Math.min(before.at, entry.at), level: Math.max(before.level, entry.level) }
      : { at: entry.at, level: entry.level };
  }
  for (const [counter, count] of Object.entries(kept.counts)) {
    if (typeof count !== "number") continue;
    const before = Object.hasOwn(mine.counts, counter) ? mine.counts[counter] : undefined;
    mine.counts[counter] = Math.max(before ?? 0, count);
  }
  try {
    store?.setItem(KEY, JSON.stringify({ v: VERSION, ...mine }));
  } catch {
    // Shown from the account next time instead.
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
