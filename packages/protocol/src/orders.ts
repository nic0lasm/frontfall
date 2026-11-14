import {
  ORDER_SPEC,
  type FieldKind,
  type Order as SpecOrder,
  type OrderSpecEntry,
} from "@frontfall/contracts";
import * as z from "zod/mini";

export type { OrderType } from "@frontfall/contracts";

/** Largest tile index a message may carry: maps stay well below 2^31 tiles. */
export const MAX_TILE = 2 ** 31 - 1;

/** Player number inside one game, from 1. Zero is the neutral owner of the engine. */
export const PlayerNumber = z.int().check(z.minimum(1), z.maximum(0xffff));

/**
 * The bounds of each kind of field (`FieldKind` in the order spec). Codes
 * (a StructureKind, a MissileSize, a quick message, a Doctrine) and the work
 * share pass here within their byte or their percent: the engine refuses the
 * values it does not know, and checks the share against B-WORK-MAX.
 */
const FIELDS: Readonly<Record<FieldKind, z.ZodMiniType<number>>> = {
  tile: z.int().check(z.minimum(0), z.maximum(MAX_TILE)),
  amount: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  count: z.int().check(z.minimum(0), z.maximum(Number.MAX_SAFE_INTEGER)),
  player: PlayerNumber,
  code: z.int().check(z.minimum(0), z.maximum(255)),
  switch: z.int().check(z.minimum(0), z.maximum(1)),
  percent: z.int().check(z.minimum(0), z.maximum(100)),
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

function orderSchema({ type, fields }: OrderSpecEntry): z.ZodMiniObject {
  const shape: Record<string, z.ZodMiniType> = { type: z.literal(type) };
  for (const [name, kind] of fields) shape[name] = FIELDS[kind];
  return z.strictObject(shape);
}

/** An order from a player. The server relays orders; every client executes them. */
export const Order = z.discriminatedUnion(
  "type",
  ORDER_SPEC.map(orderSchema) as [z.ZodMiniObject, ...z.ZodMiniObject[]],
) as unknown as z.ZodMiniType<SpecOrder>;
/** The contracts' `Order`, which the schema above checks. */
export type Order = SpecOrder;

/** Every order accepted during one tick, in the order the server accepted them. */
export interface Turn {
  tick: number;
  orders: { player: number; order: Order }[];
}
