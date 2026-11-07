/** An order from a player, as relayed by the server in a turn. */
export type Order =
  | { type: "spawn"; tile: number }
  | { type: "attack"; target: number; troops: number }
  | { type: "retreat"; attack: number }
  | { type: "embark"; target: number; troops: number }
  /** `structure` is a StructureKind code. */
  | { type: "build"; structure: number; tile: number }
  | { type: "demolish"; tile: number }
  /** `target` is a player id. */
  | { type: "ally"; target: number }
  | { type: "betray"; target: number }
  /** `on`: 1 starts an embargo on player `target`, 0 lifts it. */
  | { type: "embargo"; target: number; on: number }
  /** Buys a warship at the player's port on tile `port`. */
  | { type: "warship"; port: number }
  /** Sends warship `ship` to patrol around water tile `tile`. */
  | { type: "patrol"; ship: number; tile: number }
  /** Launches a missile of `size` (a MissileSize code) at tile `target`. */
  | { type: "missile"; target: number; size: number }
  /** Sends player `target` troops and gold (R-DIPLO-06); either may be 0. */
  | { type: "gift"; target: number; troops: number; gold: number }
  /** Sends player `target` the preset quick message `phrase` (R-DIPLO-07). */
  | { type: "quick"; target: number; phrase: number }
  /** Puts `share` % of the troops at home to work (R-ECO-07). */
  | { type: "work"; share: number }
  /** Pays the price of a tribute to `target` for a truce (R-DIPLO-10). */
  | { type: "tribute"; target: number }
  /** Picks the doctrine `pick` (a Doctrine code) during the spawn phase (R-DOCTRINE-01). */
  | { type: "doctrine"; pick: number };

export type OrderType = Order["type"];

/** The member of the `Order` union of one type. */
export type OrderOf<T extends OrderType> = Extract<Order, { type: T }>;

/** Every order accepted during one tick, in the order the server accepted them (R-FAIR-03). */
export interface Turn {
  tick: number;
  orders: readonly { player: number; order: Order }[];
}

/**
 * What values a field of an order may take on the wire. The protocol turns
 * each kind into its bounds; the engine checks the values again against the
 * state of the game.
 *
 * - `tile`: a tile index, from 0.
 * - `amount`: a count of troops or an id, from 1.
 * - `count`: a count that may be 0.
 * - `player`: a player number, from 1.
 * - `code`: a small code the engine knows, from 0 to 255.
 * - `switch`: 0 or 1.
 * - `percent`: from 0 to 100.
 */
export type FieldKind = "tile" | "amount" | "count" | "player" | "code" | "switch" | "percent";

type FieldName<T extends OrderType> = Exclude<keyof OrderOf<T>, "type">;

/** One kind of order in `ORDER_SPEC`: its type and its fields, each with its kind. */
export type OrderSpecEntry = {
  [T in OrderType]: {
    readonly type: T;
    readonly fields: readonly (readonly [FieldName<T>, FieldKind])[];
  };
}[OrderType];

/**
 * Every kind of order, in wire order: the position of a kind is its code in
 * binary frames, and its fields are written in the order listed. Append new
 * kinds at the end and never reorder (docs/protocol.md).
 */
export const ORDER_SPEC = [
  { type: "spawn", fields: [["tile", "tile"]] },
  {
    type: "attack",
    fields: [
      ["target", "tile"],
      ["troops", "amount"],
    ],
  },
  { type: "retreat", fields: [["attack", "amount"]] },
  {
    type: "embark",
    fields: [
      ["target", "tile"],
      ["troops", "amount"],
    ],
  },
  {
    type: "build",
    fields: [
      ["structure", "code"],
      ["tile", "tile"],
    ],
  },
  { type: "demolish", fields: [["tile", "tile"]] },
  { type: "ally", fields: [["target", "player"]] },
  { type: "betray", fields: [["target", "player"]] },
  {
    type: "embargo",
    fields: [
      ["target", "player"],
      ["on", "switch"],
    ],
  },
  { type: "warship", fields: [["port", "tile"]] },
  {
    type: "patrol",
    fields: [
      ["ship", "amount"],
      ["tile", "tile"],
    ],
  },
  {
    type: "missile",
    fields: [
      ["target", "tile"],
      ["size", "code"],
    ],
  },
  {
    type: "gift",
    fields: [
      ["target", "player"],
      ["troops", "count"],
      ["gold", "count"],
    ],
  },
  {
    type: "quick",
    fields: [
      ["target", "player"],
      ["phrase", "code"],
    ],
  },
  { type: "work", fields: [["share", "percent"]] },
  { type: "tribute", fields: [["target", "player"]] },
  { type: "doctrine", fields: [["pick", "code"]] },
] as const satisfies readonly OrderSpecEntry[];

/** The order an entry of a spec describes: its type and a number for each field. */
type SpecOrder<E> = E extends {
  readonly type: infer T;
  readonly fields: readonly (readonly [infer N extends string, FieldKind])[];
}
  ? { [K in "type" | N]: K extends "type" ? T : number }
  : never;

/** True when each of two types is assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Check<T extends true> = T;

/**
 * Fails to compile when `ORDER_SPEC` and `Order` disagree in either
 * direction: a kind or a field missing from one of them.
 */
export type OrderSpecMatchesOrder = Check<Same<SpecOrder<(typeof ORDER_SPEC)[number]>, Order>>;

/** The order types, in wire order. */
export const ORDER_TYPES: readonly OrderType[] = ORDER_SPEC.map((entry) => entry.type);
