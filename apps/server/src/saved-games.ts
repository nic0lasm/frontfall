import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { GameOptions, GameRules, GameSpeed, MAX_NAME_LENGTH } from "@frontfall/protocol";
import { z } from "zod";
import type { RoomSettings, SavedRoom } from "./room.ts";

/**
 * Running games kept across a restart, one file each in
 * `<data>/games`: seed, settings, seats with their tokens, and the turn log.
 * No state of the game: the clients rebuild it from the turns, as on any
 * rejoin, so the server never keeps a state the players have not agreed on.
 * The files hold the names and tokens of the seats, and no address: they
 * are readable by the server's user only, and deleted as soon as read.
 */

const FORMAT = 1;

/** A turn log is capped at 64 MiB (`maxLogBytes`); base64 adds a third. */
const MAX_FILE_BYTES = 96 * 1024 * 1024;

/** What decides how a game plays, kept; the server's limits come from the new run. */
const SETTINGS_KEYS = [
  "visibility",
  "name",
  "capacity",
  "autoStart",
  "map",
  "bots",
  "difficulty",
  "nations",
  "teams",
  "disabled",
  "speed",
  "rules",
] as const satisfies readonly (keyof RoomSettings)[];

export type SavedSettings = Pick<RoomSettings, (typeof SETTINGS_KEYS)[number]>;

/** A saved game as read back, with the settings that make it the same game. */
export type LoadedGame = Omit<SavedRoom, "settings"> & { settings: SavedSettings };

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);

const SavedFile = z
  .object({
    format: z.literal(FORMAT),
    simulation: z.string().max(64),
    game: z
      .object({
        id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
        seed: z.number().int().min(0),
        settings: GameOptions.extend({
          visibility: z.enum(["public", "private"]),
          name: z.string().max(64).nullable(),
          // Saved before the speeds of R-MODE-07: such a game ran at 1.
          speed: GameSpeed.default(1),
          // Saved before the special rules of R-MODE-08: such a game had none.
          rules: z.preprocess(
            (saved) => ({ collapsingFronts: false, capitals: false, ...(saved ?? {}) }),
            GameRules,
          ),
        }),
        elapsedMs: z.number().min(0),
        seats: z
          .array(
            z
              .object({
                id: z.number().int().min(1),
                name: z.string().max(MAX_NAME_LENGTH * 2),
                token: z.string().min(1).max(64),
                gone: z.boolean(),
              })
              .strict(),
          )
          .min(1)
          .max(64),
        bodies: base64,
        ends: base64,
      })
      .strict(),
  })
  .strict();

export function gamesDirectory(dataDir: string): string {
  return join(dataDir, "games");
}

/** Writes one game, readable by the server's user only. */
export function saveGame(directory: string, simulation: string, game: SavedRoom): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const ends = Buffer.alloc(game.log.ends.length * 4);
  game.log.ends.forEach((end, index) => ends.writeUInt32LE(end, index * 4));
  const settings = Object.fromEntries(SETTINGS_KEYS.map((key) => [key, game.settings[key]]));
  const text = JSON.stringify({
    format: FORMAT,
    simulation,
    game: {
      id: game.id,
      seed: game.seed,
      settings,
      elapsedMs: game.elapsedMs,
      seats: game.seats,
      bodies: Buffer.from(game.log.bodies).toString("base64"),
      ends: ends.toString("base64"),
    },
  });
  const file = join(directory, `${game.id}.json`);
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

export interface LoadResult {
  games: LoadedGame[];
  /** Files that held no game this server can take back, and why. */
  refused: { file: string; reason: "unreadable" | "simulation" }[];
}

/**
 * Reads every saved game and deletes its file, whether it loads or not: a
 * game of another simulation build would desynchronise, and a file left
 * behind would only be refused again. Never throws.
 */
export function loadGames(directory: string, simulation: string): LoadResult {
  const result: LoadResult = { games: [], refused: [] };
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return result;
  }
  for (const name of names.sort()) {
    const file = join(directory, name);
    if (!name.endsWith(".json")) {
      // A save cut short by the end of the process.
      if (name.endsWith(".json.tmp")) rmSync(file, { force: true });
      continue;
    }
    let text: string | undefined;
    try {
      if (statSync(file).size <= MAX_FILE_BYTES) text = readFileSync(file, "utf8");
    } catch {
      // Unreadable: refused below.
    } finally {
      rmSync(file, { force: true });
    }
    const game = text === undefined ? undefined : parse(text);
    if (game === undefined) result.refused.push({ file: name, reason: "unreadable" });
    else if (game.simulation !== simulation)
      result.refused.push({ file: name, reason: "simulation" });
    else result.games.push(game.game);
  }
  return result;
}

function parse(text: string): { simulation: string; game: LoadedGame } | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = SavedFile.safeParse(json);
  if (!parsed.success) return undefined;
  const { bodies, ends: endBytes, ...game } = parsed.data.game;
  const raw = Buffer.from(endBytes, "base64");
  if (raw.length % 4 !== 0) return undefined;
  const ends = new Uint32Array(raw.length / 4);
  for (let index = 0; index < ends.length; index++) ends[index] = raw.readUInt32LE(index * 4);
  return {
    simulation: parsed.data.simulation,
    game: {
      ...game,
      owner: undefined,
      log: { bodies: new Uint8Array(Buffer.from(bodies, "base64")), ends },
    },
  };
}
