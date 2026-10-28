import { Disable, leftOut } from "@frontfall/engine";
import { DEFAULT_RULES } from "@frontfall/protocol";
import { suggestedBots, type MapInfo } from "../game/maps.ts";
import { MAX_BOTS, type Difficulty, type SoloOptions } from "../game/solo-game.ts";

/** What the player chooses in the menu; the seed is drawn when the game starts. */
export type GameSetup = Omit<SoloOptions, "seed">;

const STORAGE_KEY = "frontfall.setup";
const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];
export const MAX_NAME_LENGTH = 20;
/** Free-for-all, then 2, 3 or 4 teams (R-MODE-02). */
export const TEAM_CHOICES = [0, 2, 3, 4] as const;
/** What a game can leave out (R-MODE-03), by its name in links and in the interface. */
export const LEFT_OUT = [
  { name: "city", bit: Disable.City },
  { name: "fort", bit: Disable.Fort },
  { name: "port", bit: Disable.Port },
  { name: "silo", bit: Disable.Silo },
  { name: "airDefense", bit: Disable.AirDefense },
  { name: "warship", bit: Disable.Warships },
] as const;

/** The first map of the list with its nations, and the bots suggested with them. */
export function defaultSetup(maps: readonly MapInfo[]): GameSetup {
  const map = maps[0];
  if (!map) throw new Error("no map available");
  return {
    map: map.id,
    bots: suggestedBots(map, true),
    difficulty: "normal",
    nations: true,
    rules: { ...DEFAULT_RULES },
    playerName: "",
  };
}

/** Keeps only values that make sense; anything else falls back to `base`. */
export function sanitizeSetup(
  input: Record<string, unknown>,
  base: GameSetup,
  maps: readonly MapInfo[],
): GameSetup {
  const setup = { ...base };
  if (typeof input.map === "string" && maps.some((map) => map.id === input.map)) {
    setup.map = input.map;
  }
  const bots = Number(input.bots);
  if (input.bots !== undefined && input.bots !== "" && Number.isInteger(bots)) {
    setup.bots = Math.max(0, Math.min(MAX_BOTS, bots));
  }
  if (DIFFICULTIES.includes(input.difficulty as Difficulty)) {
    setup.difficulty = input.difficulty as Difficulty;
  }
  // Stored as a boolean, shared in a link as 1 or 0.
  if (input.nations === true || input.nations === "1") setup.nations = true;
  if (input.nations === false || input.nations === "0") setup.nations = false;
  const teams = Number(input.teams);
  if (input.teams !== undefined && (TEAM_CHOICES as readonly number[]).includes(teams)) {
    setup.teams = teams;
  }
  // Shared in a link as names, off=silo,warship, and never remembered.
  if (typeof input.off === "string") {
    const names = input.off.split(",");
    setup.disabled = leftOut(
      LEFT_OUT.reduce((bits, { name, bit }) => bits | (names.includes(name) ? bit : 0), 0),
    );
  }
  // Special rules (R-MODE-08): stored as an object, each one on or off; never in a link.
  const stored = input.rules;
  if (typeof stored === "object" && stored !== null) {
    const rules = { ...DEFAULT_RULES, ...setup.rules };
    for (const name of Object.keys(DEFAULT_RULES) as (keyof typeof DEFAULT_RULES)[]) {
      const value = (stored as Record<string, unknown>)[name];
      if (typeof value === "boolean") rules[name] = value;
    }
    setup.rules = rules;
  }
  if (typeof input.name === "string") setup.playerName = cleanName(input.name);
  if (typeof input.playerName === "string") setup.playerName = cleanName(input.playerName);
  return setup;
}

export function cleanName(name: string): string {
  return name
    .replace(/[\p{C}]/gu, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

/** Last setup from storage, then the query string on top, so shared links win. */
export function initialSetup(
  search: string,
  storage: Storage | undefined,
  maps: readonly MapInfo[],
): GameSetup {
  let setup = defaultSetup(maps);
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (saved) setup = sanitizeSetup(JSON.parse(saved) as Record<string, unknown>, setup, maps);
  } catch {
    // Storage disabled or corrupted: the defaults will do.
  }
  const params = Object.fromEntries(new URLSearchParams(search));
  return sanitizeSetup(params, setup, maps);
}

export function saveSetup(setup: GameSetup, storage: Storage | undefined): void {
  try {
    // What a link left out does not carry over to the next game from the menu.
    storage?.setItem(STORAGE_KEY, JSON.stringify({ ...setup, disabled: undefined }));
  } catch {
    // Not remembering the setup is fine.
  }
}

/** Removes the remembered setup, name included, from the device. */
export function forgetSetup(storage: Storage | undefined): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to forget where nothing could be kept.
  }
}

/** Query string that reproduces a setup, relative to the page so it works under any prefix. */
export function setupQuery(setup: GameSetup): string {
  const params = new URLSearchParams({
    map: setup.map,
    bots: String(setup.bots),
    difficulty: setup.difficulty,
    nations: setup.nations ? "1" : "0",
  });
  // Left out of free-for-all links, which read as they did before teams.
  if (setup.teams) params.set("teams", String(setup.teams));
  const off = LEFT_OUT.filter(({ bit }) => ((setup.disabled ?? 0) & bit) !== 0);
  if (off.length > 0) params.set("off", off.map(({ name }) => name).join(","));
  return `?${params.toString()}`;
}

/** localStorage, or undefined where merely touching it throws. */
export function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
