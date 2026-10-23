import { z } from "zod";

/** Ticks per second of the simulation. The server closes one turn per tick. */
export const TICK_RATE = 10;

const playerId = z.string().min(1).max(64);
const tile = z.number().int().nonnegative();

/** An order from a player. The server relays intents; every client executes them. */
export const Intent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("spawn"), tile }),
  z.object({
    type: z.literal("attack"),
    target: tile,
    troops: z.number().int().positive(),
  }),
]);
export type Intent = z.infer<typeof Intent>;

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    lobby: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(24),
  }),
  z.object({ type: z.literal("intent"), intent: Intent }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Every intent received during one tick, in the order the server accepted them. */
export const Turn = z.object({
  tick: z.number().int().nonnegative(),
  intents: z.array(z.object({ player: playerId, intent: Intent })),
});
export type Turn = z.infer<typeof Turn>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("joined"), player: playerId, seed: z.number().int() }),
  z.object({ type: z.literal("turn"), turn: Turn }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parse<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "malformed JSON" };
  }
  const result = schema.safeParse(json);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: z.prettifyError(result.error) };
}

export const parseClientMessage = (raw: string): ParseResult<ClientMessage> =>
  parse(ClientMessage, raw);

export const parseServerMessage = (raw: string): ParseResult<ServerMessage> =>
  parse(ServerMessage, raw);
