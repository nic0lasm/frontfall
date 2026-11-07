import {
  ORDER_SPEC,
  type FieldKind,
  type Order as SpecOrder,
  type OrderSpecEntry,
} from "@frontfall/contracts";
import { z } from "zod";

export type { OrderType } from "@frontfall/contracts";

/** Largest tile index a message may carry: maps stay well below 2^31 tiles. */
export const MAX_TILE = 2 ** 31 - 1;

/** Player number inside one game, from 1. Zero is the neutral owner of the engine. */
export const PlayerNumber = z.number().int().min(1).max(0xffff);

/**
 * The bounds of each kind of field (`FieldKind` in the order spec). Codes
 * (a StructureKind, a MissileSize, a quick message, a Doctrine) and the work
 * share pass here within their byte or their percent: the engine refuses the
 * values it does not know, and checks the share against B-WORK-MAX.
 */
const FIELDS: Readonly<Record<FieldKind, z.ZodNumber>> = {
  tile: z.number().int().min(0).max(MAX_TILE),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  player: PlayerNumber,
  code: z.number().int().min(0).max(255),
  switch: z.number().int().min(0).max(1),
  percent: z.number().int().min(0).max(100),
};

/**
 * Every kind of order, in wire order, from the order spec: the position of a
 * kind in this list is its code in binary frames, and the field list gives
 * the order in which its values are written.
 */
export const ORDER_KINDS: readonly {
  readonly type: Order["type"];
  readonly fields: readonly string[];
}[] = ORDER_SPEC.map(({ type, fields }) => ({ type, fields: fields.map(([name]) => name) }));

function orderSchema({ type, fields }: OrderSpecEntry): z.ZodObject {
  const shape: Record<string, z.ZodType> = { type: z.literal(type) };
  for (const [name, kind] of fields) shape[name] = FIELDS[kind];
  return z.object(shape).strict();
}

/** An order from a player. The server relays orders; every client executes them. */
export const Order = z.discriminatedUnion(
  "type",
  ORDER_SPEC.map(orderSchema) as [z.ZodObject, ...z.ZodObject[]],
) as unknown as z.ZodType<SpecOrder>;
/** The contracts' `Order`, which the schema above checks. */
export type Order = SpecOrder;

/** Every order accepted during one tick, in the order the server accepted them. */
export interface Turn {
  tick: number;
  orders: { player: number; order: Order }[];
}
