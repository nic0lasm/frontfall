import { DEFAULT_BALANCE, type Balance } from "./balance.ts";
import { BOT_DIFFICULTIES, installBots, installNations, type BotDifficulty } from "./bots/index.ts";
import { createGame } from "./create-game.ts";
import {
  DISABLE_ALL,
  MAX_TEAMS,
  type Game,
  type GameRules,
  type Order,
  type PlayerSetup,
  type Turn,
} from "./game.ts";
import type { Terrain } from "./terrain.ts";

/** Version of the report format below; a reader refuses any other. */
export const DESYNC_REPORT_VERSION = 2;

/**
 * Everything needed to play a game again, tick for tick, and the state
 * hashes one client saw along the way. A client writes it when its hash
 * disagrees with the other players' (R-FAIR-01); `pnpm sim --replay` reads it
 * back. Plain JSON: hashes are unsigned 32-bit integers, tiles are indices.
 */
export interface DesyncReport {
  version: typeof DESYNC_REPORT_VERSION;
  /** Build that wrote the report: the release name and PROTOCOL_VERSION it spoke. */
  build: { release: string; protocol: number };
  /** A published map, pinned by the hash of its terrain file. */
  map: { id: string; format: number; version: number; sha256: string };
  seed: number;
  /** Every balance value the game ran with, not only those that differ from the defaults. */
  balance: Balance;
  /** Every player in the game, humans, bots and nations, with the ids the game used. */
  players: PlayerSetup[];
  bots: { ids: number[]; difficulty: BotDifficulty };
  /** Nations among the players, playing at the bots' difficulty; absent from reports of games without. */
  nations?: number[];
  /** Number of teams (R-MODE-02); absent from free-for-all games. */
  teams?: number;
  /** `Disable` bits of what the game left out (R-MODE-03); absent when it left nothing out. */
  disabled?: number;
  /** Special rules the game was played with (R-MODE-08); absent when it had none. */
  rules?: Partial<GameRules>;
  /** The player whose client wrote the report. */
  you: number;
  /** Ticks the client had run; turns and hashes come from ticks below this. */
  ticks: number;
  /** Turns with at least one order, by increasing tick; any other tick ran without orders. */
  turns: Turn[];
  /**
   * The client's hash after each checked tick, with the hash most other
   * players reported for it, or null when the server had none to compare.
   */
  hashes: { tick: number; local: number; expected: number | null }[];
}

/** A new game with the setup of a recorded one, its bots and nations in place, before its first tick. */
export function recreateGame(recorded: RecordedGame, terrain: Terrain): Game {
  const game = createGame({
    terrain,
    seed: recorded.seed,
    players: recorded.players,
    balance: recorded.balance,
    ...(recorded.teams === undefined ? {} : { teams: recorded.teams }),
    ...(recorded.disabled === undefined ? {} : { disabled: recorded.disabled }),
    ...(recorded.rules === undefined ? {} : { rules: recorded.rules }),
  });
  installBots(game, recorded.bots.ids, recorded.bots.difficulty);
  installNations(game, recorded.nations ?? [], recorded.bots.difficulty);
  return game;
}

export interface ReplayResult {
  /** Ticks run, at most `report.ticks`. */
  ticks: number;
  /** First checked tick where this replay disagrees with the client's own hash: the engine is not deterministic. */
  firstLocalMismatch: { tick: number; replay: number; local: number } | undefined;
  /** First checked tick where the client disagreed with the other players: where the desync began. */
  firstDesync: { tick: number; local: number; expected: number } | undefined;
}

/** Plays the reported game on `terrain`, which must be the map the report names. */
export function replayDesyncReport(report: DesyncReport, terrain: Terrain): ReplayResult {
  const game = recreateGame(report, terrain);
  const turns = new Map(report.turns.map((turn) => [turn.tick, turn.orders]));
  const hashes = new Map(report.hashes.map((entry) => [entry.tick, entry]));
  let firstLocalMismatch: ReplayResult["firstLocalMismatch"];
  let firstDesync: ReplayResult["firstDesync"];
  while (game.tick < report.ticks) {
    const tick = game.tick;
    game.step({ tick, orders: turns.get(tick) ?? [] });
    const seen = hashes.get(tick);
    if (!seen) continue;
    const replay = game.hash();
    if (!firstLocalMismatch && replay !== seen.local) {
      firstLocalMismatch = { tick, replay, local: seen.local };
    }
    if (!firstDesync && seen.expected !== null && seen.expected !== seen.local) {
      firstDesync = { tick, local: seen.local, expected: seen.expected };
    }
  }
  return { ticks: game.tick, firstLocalMismatch, firstDesync };
}

/** Checks the shape of a parsed report, so a damaged file fails here rather than mid-replay. */
export function readDesyncReport(value: unknown): DesyncReport {
  const report = readObject(value, "report");
  if (report.version !== DESYNC_REPORT_VERSION) {
    throw new DesyncReportError(
      `unsupported report version ${String(report.version)}, expected ${String(DESYNC_REPORT_VERSION)}`,
    );
  }
  const build = readObject(report.build, "build");
  return {
    version: DESYNC_REPORT_VERSION,
    build: {
      release: readText(build.release, "build.release"),
      protocol: readInteger(build.protocol, "build.protocol"),
    },
    ...readGame(report),
    hashes: readList(report.hashes, "hashes").map((entry) => {
      const hash = readObject(entry, "hash");
      return {
        tick: readInteger(hash.tick, "hash tick"),
        local: readInteger(hash.local, "local hash"),
        expected: hash.expected === null ? null : readInteger(hash.expected, "expected hash"),
      };
    }),
  };
}

/** What a desync report and a game record share: the game's setup and its turns. */
export type RecordedGame = Omit<DesyncReport, "version" | "build" | "hashes">;

/** Checks the setup and turns of a parsed report or record. */
export function readGame(report: Record<string, unknown>): RecordedGame {
  const map = readObject(report.map, "map");
  const balance = readObject(report.balance, "balance");
  for (const key of Object.keys(DEFAULT_BALANCE) as (keyof Balance)[]) {
    const expected = DEFAULT_BALANCE[key];
    const actual = balance[key];
    const ok = Array.isArray(expected)
      ? Array.isArray(actual) &&
        actual.length === expected.length &&
        actual.every((entry) => Number.isSafeInteger(entry))
      : Number.isSafeInteger(actual);
    if (!ok) throw new DesyncReportError(`invalid balance ${key}`);
  }
  const bots = readObject(report.bots, "bots");
  const difficulty = bots.difficulty;
  if (typeof difficulty !== "string" || !Object.hasOwn(BOT_DIFFICULTIES, difficulty)) {
    throw new DesyncReportError(`unknown bot difficulty ${String(difficulty)}`);
  }
  const game: RecordedGame = {
    map: {
      id: readText(map.id, "map.id"),
      format: readInteger(map.format, "map.format"),
      version: readInteger(map.version, "map.version"),
      sha256: readText(map.sha256, "map.sha256"),
    },
    seed: readInteger(report.seed, "seed"),
    balance: balance as unknown as Balance,
    players: readList(report.players, "players").map((entry, i) => {
      const player = readObject(entry, `players[${String(i)}]`);
      const setup: PlayerSetup = {
        id: readInteger(player.id, "player id"),
        name: readText(player.name, "player name"),
      };
      if (player.start !== undefined) setup.start = readInteger(player.start, "player start");
      return setup;
    }),
    bots: {
      ids: readList(bots.ids, "bots.ids").map((id) => readInteger(id, "bot id")),
      difficulty: difficulty as BotDifficulty,
    },
    ...(report.nations === undefined
      ? {}
      : { nations: readList(report.nations, "nations").map((id) => readInteger(id, "nation id")) }),
    ...(report.teams === undefined ? {} : { teams: readTeams(report.teams) }),
    ...(report.disabled === undefined ? {} : { disabled: readDisabled(report.disabled) }),
    ...(report.rules === undefined ? {} : { rules: readRules(report.rules) }),
    you: readInteger(report.you, "you"),
    ticks: readInteger(report.ticks, "ticks"),
    turns: readList(report.turns, "turns").map((entry, i) => {
      const turn = readObject(entry, `turns[${String(i)}]`);
      return {
        tick: readInteger(turn.tick, "turn tick"),
        orders: readList(turn.orders, "turn orders").map((item) => {
          const sent = readObject(item, "order");
          return { player: readInteger(sent.player, "order player"), order: order(sent.order) };
        }),
      };
    }),
  };
  // A turn out of order, or past the end, would be dropped or replaced without a word.
  if (game.ticks < 0 || game.ticks > MAX_RECORDED_TICKS) {
    throw new DesyncReportError("ticks out of range");
  }
  let previous = -1;
  for (const turn of game.turns) {
    if (turn.tick <= previous || turn.tick >= game.ticks) {
      throw new DesyncReportError(`turn ${String(turn.tick)} out of order or past the end`);
    }
    previous = turn.tick;
  }
  if (!game.players.some((player) => player.id === game.you)) {
    throw new DesyncReportError("you is not one of the players");
  }
  return game;
}

/** A day of play at ten ticks per second: more than any recorded game, far less than a crafted one. */
const MAX_RECORDED_TICKS = 24 * 3600 * 10;

function readTeams(value: unknown): number {
  const teams = readInteger(value, "teams");
  if (teams !== 0 && (teams < 2 || teams > MAX_TEAMS)) throw new DesyncReportError("invalid teams");
  return teams;
}

function readDisabled(value: unknown): number {
  const disabled = readInteger(value, "disabled");
  if (disabled < 0 || disabled > DISABLE_ALL) throw new DesyncReportError("invalid disabled set");
  return disabled;
}

/** Special rules by name, each on or off (R-MODE-08); a name this build does not know is refused. */
function readRules(value: unknown): Partial<GameRules> {
  const rules = readObject(value, "rules");
  const known: { -readonly [Name in keyof GameRules]?: boolean } = {};
  for (const [name, on] of Object.entries(rules)) {
    if (name !== "collapsingFronts" || typeof on !== "boolean") {
      throw new DesyncReportError(`invalid rule ${name}`);
    }
    known[name] = on;
  }
  return known;
}

export class DesyncReportError extends Error {
  override name = "DesyncReportError";
}

function order(value: unknown): Order {
  const raw = readObject(value, "order");
  switch (raw.type) {
    case "spawn":
      return { type: "spawn", tile: readInteger(raw.tile, "spawn tile") };
    case "attack":
    case "embark":
      return {
        type: raw.type,
        target: readInteger(raw.target, "order target"),
        troops: readInteger(raw.troops, "order troops"),
      };
    case "retreat":
      return { type: "retreat", attack: readInteger(raw.attack, "retreat attack") };
    case "build":
      return {
        type: "build",
        structure: readInteger(raw.structure, "build structure"),
        tile: readInteger(raw.tile, "build tile"),
      };
    case "demolish":
      return { type: "demolish", tile: readInteger(raw.tile, "demolish tile") };
    case "ally":
    case "betray":
      return { type: raw.type, target: readInteger(raw.target, "order target") };
    case "warship":
      return { type: "warship", port: readInteger(raw.port, "warship port") };
    case "patrol":
      return {
        type: "patrol",
        ship: readInteger(raw.ship, "patrol ship"),
        tile: readInteger(raw.tile, "patrol tile"),
      };
    case "missile":
      return {
        type: "missile",
        target: readInteger(raw.target, "missile target"),
        size: readInteger(raw.size, "missile size"),
      };
    case "embargo":
      return {
        type: "embargo",
        target: readInteger(raw.target, "order target"),
        on: readInteger(raw.on, "embargo switch"),
      };
    case "gift":
      return {
        type: "gift",
        target: readInteger(raw.target, "order target"),
        troops: readInteger(raw.troops, "gift troops"),
        gold: readInteger(raw.gold, "gift gold"),
      };
    case "quick":
      return {
        type: "quick",
        target: readInteger(raw.target, "order target"),
        phrase: readInteger(raw.phrase, "quick message"),
      };
    case "work":
      return { type: "work", share: readInteger(raw.share, "work share") };
    default:
      throw new DesyncReportError(`unknown order type ${String(raw.type)}`);
  }
}

export function readObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DesyncReportError(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

function readList(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new DesyncReportError(`${what} is not a list`);
  return value;
}

export function readInteger(value: unknown, what: string): number {
  if (!Number.isSafeInteger(value)) throw new DesyncReportError(`${what} is not an integer`);
  return value as number;
}

export function readText(value: unknown, what: string): string {
  if (typeof value !== "string") throw new DesyncReportError(`${what} is not a string`);
  return value;
}
