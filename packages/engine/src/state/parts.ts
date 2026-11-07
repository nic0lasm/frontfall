import type { Game } from "../game.ts";
import { SnapshotError, type SnapshotReader } from "../snapshot-bytes.ts";
import { readList, writeList, type Codec, type SavedField } from "./codec.ts";
import type { StateWriter } from "./writer.ts";

/**
 * State a rule keeps for itself rather than on `Game` or an entity (ADR
 * 0008). A part is registered only in a game that plays with its rule, so
 * a game without the rule neither saves nor hashes it. `save` writes the
 * part's values through a `StateWriter`, which the snapshot and the state
 * hash both run; `load` reads what `save` wrote into the snapshot, in a
 * game just created with the same setup and rules.
 */
export interface PersistedPart {
  save(out: StateWriter): void;
  load(from: SnapshotReader): void;
}

/** How a rule finds its part on a game: its name in snapshots, and its place among the game's parts. */
export interface PartKey<P extends PersistedPart> {
  readonly name: string;
  readonly slot: number;
  /** Never set: it only carries the type of the part. */
  readonly part?: P;
}

let slots = 0;

/**
 * The key of a rule's part, made once when its module loads. The slot is
 * where `game.part(key)` finds it, an array index rather than a lookup:
 * some parts are read on every tile an attack takes. It is not part of the
 * state, so the order modules load in does not matter.
 */
export function partKey<P extends PersistedPart>(name: string): PartKey<P> {
  return Object.freeze({ name, slot: slots++ });
}

/**
 * One integer for each player, indexed by player id: dense, as rules read it
 * for every attack and every tile. Players are written in id order.
 */
export class PlayerValues implements PersistedPart {
  private readonly values: Int32Array;
  private readonly game: Game;
  private readonly field: SavedField<number>;
  private readonly empty: number;

  /** `empty` is every player's value until a rule sets one, and the value of an id that is no player. */
  constructor(game: Game, field: SavedField<number>, empty = 0) {
    this.game = game;
    this.field = field;
    this.empty = empty;
    this.values = new Int32Array(game.territory.maxPlayers + 1).fill(empty);
  }

  get(player: number): number {
    return player >= 0 && player < this.values.length
      ? (this.values[player] as number)
      : this.empty;
  }

  set(player: number, value: number): void {
    this.values[player] = value;
  }

  save(out: StateWriter): void {
    for (const p of this.game.players()) this.field.write(out, this.get(p.id), this.game);
  }

  load(from: SnapshotReader): void {
    for (const p of this.game.players()) this.values[p.id] = this.field.read(from, this.game);
  }
}

/**
 * One integer for each entry of an entity list, at the entry's place in the
 * list: its slot. The module that owns the list keeps the two in step,
 * adding, inserting and removing a value wherever it adds, inserts and
 * removes an entry; saving a part out of step with its list throws.
 */
export class SlotValues implements PersistedPart {
  private values = new Int32Array(16);
  private count = 0;
  private readonly game: Game;
  private readonly list: () => readonly unknown[];
  private readonly field: SavedField<number>;

  constructor(game: Game, list: () => readonly unknown[], field: SavedField<number>) {
    this.game = game;
    this.list = list;
    this.field = field;
  }

  get length(): number {
    return this.count;
  }

  get(slot: number): number {
    if (!(slot >= 0 && slot < this.count)) throw new RangeError(`no slot ${String(slot)}`);
    return this.values[slot] as number;
  }

  set(slot: number, value: number): void {
    if (!(slot >= 0 && slot < this.count)) throw new RangeError(`no slot ${String(slot)}`);
    this.values[slot] = value;
  }

  /** For an entry pushed onto the end of the list. */
  push(value: number): void {
    this.insert(this.count, value);
  }

  /** For an entry inserted into the list at `slot`. */
  insert(slot: number, value: number): void {
    if (this.count === this.values.length) {
      const grown = new Int32Array(this.values.length * 2);
      grown.set(this.values);
      this.values = grown;
    }
    this.values.copyWithin(slot + 1, slot, this.count);
    this.values[slot] = value;
    this.count++;
  }

  /** For the entry spliced out of the list at `slot`. */
  remove(slot: number): void {
    this.values.copyWithin(slot, slot + 1, this.count);
    this.count--;
  }

  /** For the entries past the first `length` cut off the list. */
  truncate(length: number): void {
    this.count = Math.min(this.count, length);
  }

  save(out: StateWriter): void {
    if (this.count !== this.list().length) throw new RangeError("a part out of step with its list");
    out.uint(this.count);
    for (let slot = 0; slot < this.count; slot++) {
      this.field.write(out, this.values[slot] as number, this.game);
    }
  }

  load(from: SnapshotReader): void {
    const count = from.count();
    if (count !== this.list().length)
      throw new SnapshotError("a part of another length than its list");
    this.count = 0;
    for (let slot = 0; slot < count; slot++) this.push(this.field.read(from, this.game));
  }
}

/**
 * Removes the entries of `list` that `drop` names, given each entry and its
 * slot, keeping the order of the others, and their values in each part kept
 * by the list's slots: the list's owner calls it where it would filter the
 * list. `drop` may read the parts by the slot it is given.
 */
export function removeWhere<T>(
  list: T[],
  drop: (item: T, slot: number) => boolean,
  ...parts: readonly (SlotValues | undefined)[]
): void {
  let kept = 0;
  for (let slot = 0; slot < list.length; slot++) {
    const item = list[slot] as T;
    if (drop(item, slot)) continue;
    if (kept !== slot) {
      for (const part of parts) part?.set(kept, part.get(slot));
    }
    list[kept++] = item;
  }
  list.length = kept;
  for (const part of parts) part?.truncate(kept);
}

/** A list of records that belongs to one rule, written with its codec. */
export class RecordList<T> implements PersistedPart {
  readonly entries: T[] = [];
  private readonly game: Game;
  private readonly codec: Codec<T>;

  constructor(game: Game, codec: Codec<T>) {
    this.game = game;
    this.codec = codec;
  }

  save(out: StateWriter): void {
    writeList(out, this.codec, this.entries, this.game);
  }

  load(from: SnapshotReader): void {
    readList(from, this.codec, this.entries, this.game);
  }
}
