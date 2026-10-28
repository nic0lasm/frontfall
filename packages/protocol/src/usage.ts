import { z } from "zod";
import { Difficulty, Disabled, GameRules, Teams } from "./messages.ts";

/**
 * Reports a page sends to its own server so that the game can be measured
 * (docs/privacy.md). Every field is a closed set or a number the server puts
 * into a range: nothing in them names or follows a player.
 */

/** Largest report body the server reads, in bytes. */
export const MAX_USAGE_BYTES = 1024;

/** Release of the page, such as 0.5.0. */
const release = z.string().regex(/^[0-9a-z.+-]{1,32}$/);

/**
 * Random id drawn by the page for one game, never stored by the page: it lets
 * the server count a game once when the report comes twice, and take one vote
 * per game.
 */
const gameKey = z.string().regex(/^[0-9a-f]{16}$/);

export const UsageMode = z.enum(["solo", "public", "private"]);
export type UsageMode = z.infer<typeof UsageMode>;

/**
 * How the game ended for this player: `defeat` covers being wiped out before
 * the end; `left` is a return to the menu while still in the game; `closed`
 * the tab closed during it; `disconnected` an online game lost to the
 * connection or stopped by the server.
 */
export const Outcome = z.enum(["victory", "defeat", "left", "closed", "disconnected"]);
export type Outcome = z.infer<typeof Outcome>;

export const Device = z.enum(["phone", "tablet", "desktop"]);
export type Device = z.infer<typeof Device>;

export const GameReport = z
  .object({
    kind: z.literal("game"),
    release,
    game: gameKey,
    mode: UsageMode,
    /** A published map's id, or `generated`. */
    map: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .max(64),
    teams: Teams,
    nations: z.boolean(),
    bots: z.number().int().min(0).max(1000),
    /** Humans in the game, this player included. */
    humans: z.number().int().min(1).max(1000),
    difficulty: Difficulty,
    disabled: Disabled,
    /** Special rules of the game (R-MODE-08); absent from reports of pages before them. */
    rules: GameRules.optional(),
    /** Time this player spent in the game. */
    minutes: z
      .number()
      .min(0)
      .max(24 * 60),
    outcome: Outcome,
    /** Seconds from the start of the game to this player's first order once play began; absent if none. */
    firstOrder: z
      .number()
      .min(0)
      .max(24 * 60 * 60)
      .optional(),
    device: Device,
    touch: z.boolean(),
    lang: z.enum(["en", "fr"]),
    view: z.enum(["flat", "globe"]),
  })
  .strict();
export type GameReport = z.infer<typeof GameReport>;

export const ClientErrorType = z.enum([
  "exception",
  "rejection",
  "worker",
  "webgl",
  "context_lost",
  "desync",
]);
export type ClientErrorType = z.infer<typeof ClientErrorType>;

export const ErrorReport = z
  .object({
    kind: z.literal("error"),
    release,
    type: ClientErrorType,
    /** Only for an error in the game's own code, already shortened by the page. */
    message: z.string().max(120).optional(),
  })
  .strict();
export type ErrorReport = z.infer<typeof ErrorReport>;

/** What a player who gives a thumbs down can add, and nothing else. */
export const FeedbackReason = z.enum(["too_hard", "too_long", "unclear", "slow_or_buggy"]);
export type FeedbackReason = z.infer<typeof FeedbackReason>;

export const FeedbackReport = z
  .object({
    kind: z.literal("feedback"),
    release,
    game: gameKey,
    mode: UsageMode,
    outcome: Outcome,
    vote: z.enum(["up", "down"]),
    reason: FeedbackReason.optional(),
  })
  .strict()
  .refine((report) => report.reason === undefined || report.vote === "down", {
    message: "a reason goes with a thumbs down only",
  });
export type FeedbackReport = z.infer<typeof FeedbackReport>;

export const UsageReport = z.union([GameReport, ErrorReport, FeedbackReport]);
export type UsageReport = z.infer<typeof UsageReport>;

export type ParsedUsage = { ok: true; value: UsageReport } | { ok: false; error: string };

/** Reads a report sent as JSON text. */
export function parseUsageReport(text: string): ParsedUsage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "not JSON" };
  }
  const parsed = UsageReport.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: parsed.error.issues[0]?.message ?? "invalid report" };
}
