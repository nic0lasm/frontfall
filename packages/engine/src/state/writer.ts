import { FNV_OFFSET, FNV_PRIME, mix, mixUnit, mixWord } from "./fnv.ts";

/**
 * Where the state of a game is written, value by value in snapshot order
 * (ADR 0008): the bytes of a snapshot (`SnapshotWriter`), or the state hash
 * (`StateHasher`). Every record codec, every rule part and the snapshot's
 * own layout write through it, so the hash follows the snapshot field for
 * field and a value the snapshot carries cannot be left out of the hash,
 * unless it is written with `derivedTiles`.
 */
export interface StateWriter {
  /** A safe integer, negative or not. */
  int(value: number): void;
  /** A non-negative safe integer. */
  uint(value: number): void;
  /** A 32-bit word. */
  word(value: number): void;
  text(value: string): void;
  /** Bytes behind their length. */
  blob(value: Uint8Array): void;
  /** Tiles of a path, behind their count. */
  path(tiles: ArrayLike<number>): void;
  /** A value for every tile of the map, such as its owner. */
  tiles(values: Uint16Array | Uint32Array): void;
  /**
   * A value for every tile of the map that follows from values written
   * elsewhere, as far as play reads it: the end of fallout on each tile,
   * from the fallout zones and the terrain. Snapshots carry it as `tiles`
   * does, so a loaded game holds it as it was; the hash leaves it out.
   */
  derivedTiles(values: Uint32Array): void;
  /** What `write` writes, as one section the reader can skip or check to its end: a rule part. */
  section(write: (out: StateWriter) => void): void;
}

/**
 * The state hash: 32-bit FNV-1a over the values written to it, each number
 * as two 32-bit halves, low then high, so values past 2^32 are not
 * truncated. A list is its length and then its entries, a path its length
 * and then every tile, text its length and then its code units. The values
 * of the map's tiles go in one round each, which a map of a million tiles
 * needs to stay quick.
 */
export class StateHasher implements StateWriter {
  private hash = FNV_OFFSET;

  /** The hash of everything written so far, unsigned. */
  get value(): number {
    return this.hash >>> 0;
  }

  int(value: number): void {
    this.hash = mix(this.hash, value);
  }

  uint(value: number): void {
    this.hash = mix(this.hash, value);
  }

  word(value: number): void {
    this.hash = mixWord(this.hash, value);
  }

  text(value: string): void {
    let hash = mix(this.hash, value.length);
    for (let i = 0; i < value.length; i++) hash = mix(hash, value.charCodeAt(i));
    this.hash = hash;
  }

  blob(value: Uint8Array): void {
    let hash = mix(this.hash, value.length);
    for (let i = 0; i < value.length; i++) hash = mixUnit(hash, value[i] as number);
    this.hash = hash;
  }

  path(tiles: ArrayLike<number>): void {
    let hash = mix(this.hash, tiles.length);
    for (let i = 0; i < tiles.length; i++) hash = mix(hash, tiles[i] as number);
    this.hash = hash;
  }

  tiles(values: Uint16Array | Uint32Array): void {
    // A local rather than the field: the loop over every tile reads and writes it far faster.
    let hash = this.hash;
    for (let tile = 0; tile < values.length; tile++) {
      hash = Math.imul(hash ^ (values[tile] as number), FNV_PRIME);
    }
    this.hash = hash;
  }

  /**
   * Nothing: what play reads of these values is hashed where they come from,
   * and a pass over every tile of World costs as much as the owners' pass.
   */
  derivedTiles(): void {
    // Left out on purpose.
  }

  section(write: (out: StateWriter) => void): void {
    write(this);
  }
}
