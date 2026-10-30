import { z } from "zod";

/** Largest tile index a message may carry: maps stay well below 2^31 tiles. */
export const MAX_TILE = 2 ** 31 - 1;

const tile = z.number().int().min(0).max(MAX_TILE);
const amount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const share = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** Code of a structure kind (the engine's StructureKind); the engine refuses codes it does not know. */
const structure = z.number().int().min(0).max(255);

/**
 * Every kind of order, in wire order: the position of a kind in this list is
 * its code in binary frames, and the field list gives the order in which its
 * values are written. Append new kinds at the end and never reorder.
 */
export const ORDER_KINDS = [
  { type: "spawn", fields: ["tile"] },
  { type: "attack", fields: ["target", "troops"] },
  { type: "retreat", fields: ["attack"] },
  { type: "embark", fields: ["target", "troops"] },
  { type: "build", fields: ["structure", "tile"] },
  { type: "demolish", fields: ["tile"] },
  { type: "ally", fields: ["target"] },
  { type: "betray", fields: ["target"] },
  { type: "embargo", fields: ["target", "on"] },
  { type: "warship", fields: ["port"] },
  { type: "patrol", fields: ["ship", "tile"] },
  { type: "missile", fields: ["target", "size"] },
  { type: "gift", fields: ["target", "troops", "gold"] },
  { type: "quick", fields: ["target", "phrase"] },
  { type: "work", fields: ["share"] },
  { type: "tribute", fields: ["target"] },
] as const;

/** Player number inside one game, from 1. Zero is the neutral owner of the engine. */
export const PlayerNumber = z.number().int().min(1).max(0xffff);

/** An order from a player. The server relays orders; every client executes them. */
export const Order = z.discriminatedUnion("type", [
  z.object({ type: z.literal("spawn"), tile }).strict(),
  z.object({ type: z.literal("attack"), target: tile, troops: amount }).strict(),
  z.object({ type: z.literal("retreat"), attack: amount }).strict(),
  z.object({ type: z.literal("embark"), target: tile, troops: amount }).strict(),
  z.object({ type: z.literal("build"), structure, tile }).strict(),
  z.object({ type: z.literal("demolish"), tile }).strict(),
  z.object({ type: z.literal("ally"), target: PlayerNumber }).strict(),
  z.object({ type: z.literal("betray"), target: PlayerNumber }).strict(),
  /** `on`: 1 starts an embargo, 0 lifts it. */
  z
    .object({
      type: z.literal("embargo"),
      target: PlayerNumber,
      on: z.number().int().min(0).max(1),
    })
    .strict(),
  z.object({ type: z.literal("warship"), port: tile }).strict(),
  z.object({ type: z.literal("patrol"), ship: amount, tile }).strict(),
  /** `size`: the engine's MissileSize code, which it checks. */
  z
    .object({ type: z.literal("missile"), target: tile, size: z.number().int().min(0).max(255) })
    .strict(),
  /** Troops and gold sent to another player; the engine refuses a gift of neither. */
  z.object({ type: z.literal("gift"), target: PlayerNumber, troops: share, gold: share }).strict(),
  /** `phrase`: the engine's preset quick message, which it checks. */
  z
    .object({
      type: z.literal("quick"),
      target: PlayerNumber,
      phrase: z.number().int().min(0).max(255),
    })
    .strict(),
  /** `share`: % of the troops at home put to work, which the engine checks against B-WORK-MAX. */
  z.object({ type: z.literal("work"), share: z.number().int().min(0).max(100) }).strict(),
  /** Pays the price of a tribute to `target`, which the engine works out, for a truce. */
  z.object({ type: z.literal("tribute"), target: PlayerNumber }).strict(),
]);
export type Order = z.infer<typeof Order>;

export type OrderType = Order["type"];

/** Every order accepted during one tick, in the order the server accepted them. */
export interface Turn {
  tick: number;
  orders: { player: number; order: Order }[];
}
