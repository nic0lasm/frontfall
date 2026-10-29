import { z } from "zod";
import {
  DecodeError,
  decodeFrame,
  encodeOrderFrame,
  encodeTurnBody,
  encodeTurnsFrame,
} from "./binary.ts";
import { Order, PlayerNumber, type Turn } from "./orders.ts";

/**
 * Version of the messages below. A client and a server only talk when their
 * versions are equal; the `hello` message keeps its shape in every version so
 * that a mismatch can always be reported. Adding an order kind changes the
 * turn frames, so it bumps this version too; a test pins the order kinds of
 * the current version.
 */
export const PROTOCOL_VERSION = 23;

/** Ticks per second of the simulation at speed 1. The server closes one turn per tick. */
export const TICK_RATE = 10;

/**
 * Paces a game can run at (R-MODE-07): ticks per beat of the clock, a beat
 * lasting 1 / TICK_RATE seconds. Only the cadence changes, never the rules.
 */
export const GAME_SPEEDS = [1, 2, 4] as const;
export const GameSpeed = z.union([z.literal(1), z.literal(2), z.literal(4)]);
export type GameSpeed = z.infer<typeof GameSpeed>;

/** Clients send a hash of their state after every tick that is a multiple of this. */
export const HASH_INTERVAL = 50;

/** Codes a server closes a WebSocket with, besides the standard 1000 to 1015. */
export const CloseCode = {
  /** The client speaks another protocol version: reload the page. */
  versionMismatch: 4000,
  /** A frame could not be decoded or broke the message rules. */
  invalidMessage: 4001,
  /** The client sent too many messages or orders. */
  rateLimited: 4002,
  /** The client stayed connected without playing for too long. */
  idle: 4003,
  /** Another connection took over this player. */
  replaced: 4004,
  /** The operator of the server banned this address (R-MODE-06): do not reconnect. */
  banned: 4005,
  /** The server holds as many players as it serves well: try again in a while. */
  full: 4006,
} as const;

/** Error codes of the `error` message. */
export const ErrorCode = z.enum([
  "invalid_name",
  "not_found",
  "game_full",
  "game_started",
  "already_in_game",
  "not_in_game",
  "not_host",
  "too_many_games",
  "token_invalid",
  "token_in_use",
  "invalid_settings",
  "restarting",
  "invalid_game_name",
  "not_enough_players",
  "too_many_lobbies",
  "removed",
  "too_many_seats",
  "too_many_reports",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Game ids and reconnect tokens: URL-safe base64. */
const gameId = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const tick = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const stateHash = z.number().int().min(0).max(0xffffffff);

/** How hard the bots play. Every client runs them at the level the game was set to. */
export const Difficulty = z.enum(["easy", "normal", "hard"]);
export type Difficulty = z.infer<typeof Difficulty>;

/** Teams of a game (R-MODE-02): 0 for a free-for-all, or 2 to 4. */
export const Teams = z.union([z.literal(0), z.literal(2), z.literal(3), z.literal(4)]);
export type Teams = z.infer<typeof Teams>;

/** What a private game leaves out (R-MODE-03): the engine's `Disable` bits, 0 for nothing. */
export const Disabled = z.number().int().min(0).max(0x3f);

/**
 * Special rules of a game (R-MODE-08), the engine's `GameRules`: each one is
 * on or off for the whole game, chosen by the host before the start.
 */
export const GameRules = z
  .object({
    /** R-ATTACK-10: outnumbered fronts give way by stretches. */
    collapsingFronts: z.boolean(),
    /** R-CAP: taking a player's capital conquers them. */
    capitals: z.boolean(),
  })
  .strict();
export type GameRules = z.infer<typeof GameRules>;

/** The rules of public games and quick play, chosen by the balance pass (R-MODE-08). */
export const DEFAULT_RULES: Readonly<GameRules> = { collapsingFronts: true, capitals: false };

export function isDefaultRules(rules: GameRules): boolean {
  return (
    rules.collapsingFronts === DEFAULT_RULES.collapsingFronts &&
    rules.capitals === DEFAULT_RULES.capitals
  );
}

/** Why a player reports another (R-MODE-06): no free text, so a report carries nothing else. */
export const ReportReason = z.enum(["abuse", "name", "cheating", "other"]);
export type ReportReason = z.infer<typeof ReportReason>;

/** Seats a host may open for human players, before the map and bots narrow them. */
export const MIN_SEATS = 2;
export const MAX_SEATS = 16;

export const Visibility = z.enum(["public", "private"]);
export type Visibility = z.infer<typeof Visibility>;

/** Name of a public game as typed, before `normalizeGameName` checks it. */
const rawGameName = z.string().max(64);

/** What the host of a game chooses before the start. */
export const GameOptions = z
  .object({
    /** Id of a map in `maps/index.json`. */
    map: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .max(64),
    bots: z.number().int().min(0).max(255),
    difficulty: Difficulty,
    /** Whether the nations of the map's manifest play (R-BOT-07). */
    nations: z.boolean(),
    teams: Teams,
    disabled: Disabled,
    /** Seats for human players; the server gives fewer when the map and bots leave fewer. */
    capacity: z.number().int().min(MIN_SEATS).max(MAX_SEATS),
    /** Start as soon as every seat is taken. */
    autoStart: z.boolean(),
    /** Pace of a private game (R-MODE-07); left out, it stays as it was, 1 at first. */
    speed: GameSpeed.optional(),
    /** Special rules (R-MODE-08); left out, they stay as they were. */
    rules: GameRules.optional(),
  })
  .strict();
export type GameOptions = z.infer<typeof GameOptions>;

export const ClientMessage = z.discriminatedUnion("type", [
  /** First message of every connection. The name is checked by `normalizeName`. */
  z.object({
    type: z.literal("hello"),
    version: z.number().int(),
    name: z.string().max(64),
    /** Simulation build of the page; the server turns away other ones, except "dev". */
    build: z.string().max(64).optional(),
  }),
  /**
   * Join the fullest public game still waiting, or open a new one under
   * `name`, which starts on its own a while after the second player arrives.
   */
  z.object({ type: z.literal("play"), name: rawGameName.optional() }).strict(),
  /** Open a game; the creator is its host. A public one is listed under `name`. */
  z
    .object({
      type: z.literal("create"),
      visibility: Visibility.optional(),
      name: rawGameName.optional(),
    })
    .strict(),
  /** Join a game by id, from the public list or an invite link. */
  z.object({ type: z.literal("join"), game: gameId }).strict(),
  /**
   * Take back a seat after a dropped connection: in a running game, receiving
   * every turn from `from`; before the start, back in the lobby.
   */
  z.object({ type: z.literal("rejoin"), token, from: tick }).strict(),
  /** Host only: change the options, and the name of a public game, before the start. */
  z
    .object({
      type: z.literal("configure"),
      options: GameOptions,
      name: rawGameName.optional(),
      /** Counts the player's `configure` messages, echoed as `configured` in `lobby`. */
      seq: z.number().int().nonnegative().optional(),
    })
    .strict(),
  /** Host only: start now, with at least the game's minimum of players. */
  z.object({ type: z.literal("start") }).strict(),
  /** Host only, once per game: stop the countdown; the game then waits for the host. */
  z.object({ type: z.literal("hold") }).strict(),
  /** The player is at the screen: keeps the host's role while the lobby waits. */
  z.object({ type: z.literal("active") }).strict(),
  /** Host only, before the start: remove a player, who cannot join this game again. */
  z.object({ type: z.literal("kick"), player: PlayerNumber }).strict(),
  /** Tell the operator of the server that another player of this game misbehaves. */
  z.object({ type: z.literal("report"), player: PlayerNumber, reason: ReportReason }).strict(),
  /** Leave the current game for good. */
  z.object({ type: z.literal("leave") }).strict(),
  /** Hash of the client's game state after running `tick`. */
  z.object({ type: z.literal("hash"), tick, hash: stateHash }).strict(),
  /** Sent as a binary frame. */
  z.object({ type: z.literal("order"), order: Order }).strict(),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

const PlayerInfo = z.object({ id: PlayerNumber, name: z.string() });
export type PlayerInfo = z.infer<typeof PlayerInfo>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome"), version: z.number().int() }),
  /** State of the game being filled. Sent again after every change. */
  z.object({
    type: z.literal("lobby"),
    game: gameId,
    visibility: Visibility,
    /** Name of a public game, as listed; null for a private one. */
    name: z.string().nullable(),
    map: z.string(),
    bots: z.number().int().nonnegative(),
    difficulty: Difficulty,
    nations: z.boolean(),
    teams: Teams,
    disabled: Disabled,
    capacity: z.number().int().positive(),
    autoStart: z.boolean(),
    /** Ticks per beat (R-MODE-07): always 1 in a public game. */
    speed: GameSpeed,
    /** Special rules the game will play with (R-MODE-08). */
    rules: GameRules,
    /** Players the host needs before starting. */
    minPlayers: z.number().int().positive(),
    players: z.array(PlayerInfo),
    you: PlayerNumber,
    /** The player who sets the options and starts the game. */
    host: PlayerNumber,
    /** Milliseconds before the game starts, when a countdown runs. */
    startsIn: z.number().int().nonnegative().nullable(),
    /** Secret that takes this seat back after a dropped connection, before the start and after. */
    token,
    /** Whether the host can still stop the countdown. */
    holdable: z.boolean(),
    /** `seq` of the last `configure` from this player the server handled, 0 before any. */
    configured: z.number().int().nonnegative(),
  }),
  /** The game starts, or the player rejoined it. Player numbers are final from here. */
  z.object({
    type: z.literal("started"),
    game: gameId,
    map: z.string(),
    seed: z.number().int().min(0).max(0x7fffffff),
    /** Bots that every client adds to the game and runs itself. */
    bots: z.number().int().nonnegative(),
    difficulty: Difficulty,
    /** Whether every client adds the map's nations after the bots, in the manifest's order. */
    nations: z.boolean(),
    /** Teams every client deals the players into, in id order (R-MODE-02). */
    teams: Teams,
    /** What every client leaves out of the game (R-MODE-03). */
    disabled: Disabled,
    /** Beats per second; the server closes `speed` turns at each one. */
    tickRate: z.number().int().positive(),
    /** Ticks per beat (R-MODE-07): turns come `tickRate` × `speed` per second. */
    speed: GameSpeed,
    /** Special rules every client plays with (R-MODE-08). */
    rules: GameRules,
    players: z.array(PlayerInfo),
    you: PlayerNumber,
    /** Secret that lets this player rejoin after a dropped connection. */
    token,
  }),
  /** Sent as a binary frame. Turns are consecutive. */
  z.object({
    type: z.literal("turns"),
    turns: z.array(
      z.object({ tick, orders: z.array(z.object({ player: PlayerNumber, order: Order })) }),
    ),
  }),
  /** This player's state hash for `tick` differed from the majority's, if any. */
  z.object({ type: z.literal("desync"), tick, hash: stateHash, expected: stateHash.nullable() }),
  /** The game is over for this connection, which may join another one. */
  z.object({
    type: z.literal("ended"),
    reason: z.enum(["abandoned", "timeout", "expired", "left", "restart", "removed"]),
  }),
  z.object({ type: z.literal("error"), code: ErrorCode, message: z.string() }),
  /** The report of `player` was received; sent again for a player already reported. */
  z.object({ type: z.literal("reported"), player: PlayerNumber }),
  /**
   * The server restarts for an update in `inMs` milliseconds, stopping the
   * games still running then; `null` when the restart was called off.
   */
  z.object({ type: z.literal("maintenance"), inMs: z.number().int().nonnegative().nullable() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/**
 * One game of the public list, served as `{ games: [...] }` at `/api/games`.
 * Only what the menu shows: no seat, token or address.
 */
export const PublicGame = z.object({
  id: gameId,
  name: z.string(),
  /** Name of the host, who starts the game. */
  host: z.string(),
  map: z.string(),
  bots: z.number().int().nonnegative(),
  nations: z.boolean(),
  teams: Teams,
  disabled: Disabled,
  rules: GameRules,
  players: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
  /** Waiting for players, or already running and closed to newcomers. */
  state: z.enum(["waiting", "running"]),
});
export type PublicGame = z.infer<typeof PublicGame>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** A WebSocket payload: text for JSON messages, bytes for binary frames. */
export type Frame = string | Uint8Array;

function parseJson<T>(schema: z.ZodType<T>, raw: string, binaryType: string): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "malformed JSON" };
  }
  const result = schema.safeParse(json);
  if (!result.success) return { ok: false, error: z.prettifyError(result.error) };
  if ((result.data as { type: string }).type === binaryType) {
    return { ok: false, error: `${binaryType} must be sent as a binary frame` };
  }
  return { ok: true, value: result.data };
}

function decodeBinary<T>(bytes: Uint8Array, expected: "order" | "turns"): ParseResult<T> {
  try {
    const frame = decodeFrame(bytes);
    if (frame.kind !== expected) return { ok: false, error: `unexpected ${frame.kind} frame` };
    const value =
      frame.kind === "order"
        ? { type: "order", order: frame.order }
        : { type: "turns", turns: frame.turns };
    return { ok: true, value: value as T };
  } catch (error) {
    if (error instanceof DecodeError) return { ok: false, error: error.message };
    throw error;
  }
}

export function encodeClientMessage(message: ClientMessage): Frame {
  return message.type === "order" ? encodeOrderFrame(message.order) : JSON.stringify(message);
}

export function parseClientMessage(frame: Frame): ParseResult<ClientMessage> {
  return typeof frame === "string"
    ? parseJson(ClientMessage, frame, "order")
    : decodeBinary(frame, "order");
}

export function encodeServerMessage(message: ServerMessage): Frame {
  if (message.type !== "turns") return JSON.stringify(message);
  const from = message.turns[0]?.tick ?? 0;
  return encodeTurnsFrame(
    from,
    message.turns.map((turn: Turn, index) => {
      if (turn.tick !== from + index) throw new RangeError("turns must be consecutive");
      return encodeTurnBody(turn.orders);
    }),
  );
}

export function parseServerMessage(frame: Frame): ParseResult<ServerMessage> {
  return typeof frame === "string"
    ? parseJson(ServerMessage, frame, "turns")
    : decodeBinary(frame, "turns");
}
