import type { Game } from "../game.ts";
import { unpackRoute, packRoute } from "../sea-routes.ts";
import { SnapshotError, type SnapshotReader } from "../snapshot-bytes.ts";
import type { StateWriter } from "./writer.ts";

/**
 * How one field of an entity goes into a snapshot and the state hash
 * (docs/engine.md): the values it writes, and how it reads them back with
 * the range checks of its kind. A record codec has one field for every key
 * of its entity, so that a field added to the entity cannot be forgotten
 * (ADR 0008).
 */
export type Field<V> = SavedField<V> | UnsavedField;

/** A field written in the snapshot and mixed into the hash, in the order of its record's keys. */
export interface SavedField<V> {
  readonly saved: true;
  readonly write: (out: StateWriter, value: V, game: Game) => void;
  readonly read: (from: SnapshotReader, game: Game) => V;
}

/**
 * A field the snapshot does not carry, and why: setup that the game is
 * created with again, or what only the screen reads. A record read back
 * leaves it out.
 */
export interface UnsavedField {
  readonly saved: false;
  readonly reason: "setup" | "screen";
}

/** One field for every key of `T`, in the order the snapshot writes them. */
export type Codec<T> = { readonly [K in keyof T]-?: Field<T[K]> };

function field<V>(write: SavedField<V>["write"], read: SavedField<V>["read"]): SavedField<V> {
  return { saved: true, write, read };
}

/** A non-negative integer, unchecked: ids, counts, ticks. */
export const uint: SavedField<number> = field(
  (out, value) => {
    out.uint(value);
  },
  (from) => from.uint(),
);

/** A safe integer, negative or not. */
export const int: SavedField<number> = field(
  (out, value) => {
    out.int(value);
  },
  (from) => from.int(),
);

/** A non-negative integer below `limit`, which the game gives; read past it, the snapshot is refused as `what` out of range. */
export function below<V extends number>(
  limit: (game: Game) => number,
  what: string,
): SavedField<V> {
  return field(
    (out, value) => {
      out.uint(value);
    },
    (from, game) => from.below(limit(game), what) as V,
  );
}

/** A tile of the map. */
export const tile: SavedField<number> = below((game) => game.terrain.topology.size, "tile");

/** A player id, or NEUTRAL. */
export const player: SavedField<number> = below((game) => game.territory.maxPlayers + 1, "player");

/** A boolean, as 0 or 1. */
export function flag(what: string): SavedField<boolean> {
  return field(
    (out, value) => {
      out.uint(value ? 1 : 0);
    },
    (from) => from.below(2, what) === 1,
  );
}

/** A number or undefined, written as -1; read below -1, the snapshot is refused. */
export const optional: SavedField<number | undefined> = field(
  (out, value) => {
    out.int(value ?? -1);
  },
  (from) => {
    const value = from.int();
    if (value < -1) throw new SnapshotError("value out of range");
    return value === -1 ? undefined : value;
  },
);

/** A tile or undefined, refused as `what` out of range off the map. */
export function optionalTile(what: string): SavedField<number | undefined> {
  return field(optional.write, (from, game) => {
    const value = optional.read(from, game);
    if (value !== undefined && value >= game.terrain.topology.size) {
      throw new SnapshotError(`${what} out of range`);
    }
    return value;
  });
}

/** A tile or -1 for none, as a part that holds numbers keeps it: written as an optional tile. */
export function tileOrNone(what: string): SavedField<number> {
  const checked = optionalTile(what);
  return field(
    (out, value) => {
      out.int(value);
    },
    (from, game) => checked.read(from, game) ?? -1,
  );
}

/** Tiles of a path, each as its step from the one before. */
export const path: SavedField<Int32Array> = field(
  (out, value) => {
    out.path(value);
  },
  (from, game) => from.path(game.terrain.topology.size),
);

/**
 * A trade ship's route: it can cross the whole sea, thousands of tiles, so
 * it is packed at two bits a tile after its first.
 */
export const route: SavedField<Int32Array> = field(
  (out, value, game) => {
    const packed = packRoute(game.terrain.topology, value);
    out.uint(packed.length);
    if (packed.length > 0) {
      out.uint(packed.first);
      out.blob(packed.moves);
    }
  },
  (from, game) => {
    const size = game.terrain.topology.size;
    const length = from.below(size + 1, "path length");
    if (length === 0) return new Int32Array(0);
    const first = tile.read(from, game);
    const moves = from.blob();
    if (moves.length !== Math.ceil((length - 1) / 4)) {
      throw new SnapshotError("trade route of another length");
    }
    try {
      return unpackRoute(game.terrain.topology, { first, length, moves });
    } catch {
      throw new SnapshotError("trade route off the map");
    }
  },
);

/** Non-negative integers behind their count. */
export const uints: SavedField<number[]> = field(
  (out, value) => {
    out.uint(value.length);
    for (const item of value) out.uint(item);
  },
  (from) => {
    const items: number[] = [];
    for (let n = from.count(); n > 0; n--) items.push(from.uint());
    return items;
  },
);

/** Fields of the game's setup, which the game is created with again. */
export const setup: UnsavedField = { saved: false, reason: "setup" };
/** Fields only the screen reads. */
export const screen: UnsavedField = { saved: false, reason: "screen" };

type Fields<T> = readonly (readonly [keyof T & string, Field<unknown>])[];

const fieldLists = new WeakMap<object, Fields<never>>();

/** The fields of a codec in its key order, kept so that records do not list them each time. */
function fieldsOf<T>(codec: Codec<T>): Fields<T> {
  let fields = fieldLists.get(codec) as Fields<T> | undefined;
  if (!fields) {
    fields = Object.entries(codec) as unknown as Fields<T>;
    fieldLists.set(codec, fields);
  }
  return fields;
}

/** Writes the saved fields of `record`, in the codec's order. */
export function writeRecord<T>(out: StateWriter, codec: Codec<T>, record: T, game: Game): void {
  for (const [key, entry] of fieldsOf(codec)) {
    if (entry.saved) entry.write(out, record[key], game);
  }
}

/** Reads a record that `writeRecord` wrote: its saved fields. */
export function readRecord<T>(from: SnapshotReader, codec: Codec<T>, game: Game): T {
  const record: Record<string, unknown> = {};
  for (const [key, entry] of fieldsOf(codec)) {
    if (entry.saved) record[key] = entry.read(from, game);
  }
  return record as T;
}

/** Reads the saved fields into an existing record, such as a player the game was created with. */
export function readInto<T>(from: SnapshotReader, codec: Codec<T>, record: T, game: Game): void {
  for (const [key, entry] of fieldsOf(codec)) {
    if (entry.saved) record[key] = entry.read(from, game) as T[typeof key];
  }
}

/** Writes a list as its length and its records. */
export function writeList<T>(
  out: StateWriter,
  codec: Codec<T>,
  list: readonly T[],
  game: Game,
): void {
  out.uint(list.length);
  for (const record of list) writeRecord(out, codec, record, game);
}

/** Reads a list that `writeList` wrote, onto the end of `into`. */
export function readList<T>(from: SnapshotReader, codec: Codec<T>, into: T[], game: Game): void {
  for (let n = from.count(); n > 0; n--) into.push(readRecord(from, codec, game));
}
