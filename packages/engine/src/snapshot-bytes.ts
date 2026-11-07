import type { StateWriter } from "./state/writer.ts";

/**
 * The byte encoding of snapshots (docs/engine.md): safe integers as
 * variable-length quantities, seven bits a byte, low bits first, with the
 * sign folded into the lowest bit, and text as its UTF-16 code units behind their count.
 * Small numbers, the most common in a game, take one byte.
 */
export class SnapshotWriter implements StateWriter {
  private bytes = new Uint8Array(1 << 16);
  private length = 0;

  /** A safe integer, negative or not. */
  int(value: number): void {
    if (!Number.isSafeInteger(value))
      throw new RangeError(`${String(value)} is not a safe integer`);
    // Zigzag in arithmetic rather than bits: values go past 32 bits.
    this.uint(value >= 0 ? value * 2 : -value * 2 - 1);
  }

  /** A non-negative safe integer. */
  uint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${String(value)} is not a non-negative safe integer`);
    }
    this.reserve(8);
    let rest = value;
    while (rest >= 0x80) {
      this.bytes[this.length++] = (rest % 0x80) | 0x80;
      rest = Math.floor(rest / 0x80);
    }
    this.bytes[this.length++] = rest;
  }

  /** A 32-bit word, as four bytes: hashes and random state do not shrink as varints. */
  word(value: number): void {
    this.reserve(4);
    for (let shift = 0; shift < 32; shift += 8)
      this.bytes[this.length++] = (value >>> shift) & 0xff;
  }

  text(value: string): void {
    this.uint(value.length);
    for (let i = 0; i < value.length; i++) this.uint(value.charCodeAt(i));
  }

  /** Bytes behind their length. */
  blob(value: Uint8Array): void {
    this.uint(value.length);
    this.reserve(value.length);
    this.bytes.set(value, this.length);
    this.length += value.length;
  }

  /** Bytes as they are, with nothing to say how many: the last thing written. */
  raw(value: Uint8Array): void {
    this.reserve(value.length);
    this.bytes.set(value, this.length);
    this.length += value.length;
  }

  /** Tiles of a path: each one as its step from the one before, a few bytes at most. */
  path(tiles: ArrayLike<number>): void {
    this.uint(tiles.length);
    let previous = 0;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i] as number;
      this.int(tile - previous);
      previous = tile;
    }
  }

  /** A value for every tile, as runs of equal values: land and sea come in long stretches. */
  tiles(values: Uint16Array | Uint32Array): void {
    const runs: number[] = [];
    let start = 0;
    for (let i = 1; i <= values.length; i++) {
      if (i < values.length && values[i] === values[start]) continue;
      runs.push(values[start] as number, i - start);
      start = i;
    }
    this.uint(runs.length / 2);
    for (const value of runs) this.uint(value);
  }

  /** As `tiles`: a loaded game reads them back as they were. */
  derivedTiles(values: Uint32Array): void {
    this.tiles(values);
  }

  /** What `write` writes, as a blob: a reader checks the section ends where its length says. */
  section(write: (out: StateWriter) => void): void {
    const inner = new SnapshotWriter();
    write(inner);
    this.blob(inner.finish());
  }

  /** The bytes written so far. */
  finish(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }

  private reserve(count: number): void {
    if (this.length + count <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + count) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
  }
}

/** Raised by a read past the end or of a value out of range; snapshot readers turn it into a refusal. */
export class SnapshotError extends Error {
  override name = "SnapshotError";
}

/** Reads what a SnapshotWriter wrote, in the same order, and checks every value as it goes. */
export class SnapshotReader {
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  int(): number {
    const value = this.uint();
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  }

  uint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = this.byte();
      value += (byte & 0x7f) * scale;
      if (!Number.isSafeInteger(value)) throw new SnapshotError("number out of range");
      if (byte < 0x80) return value;
      scale *= 0x80;
    }
  }

  /** A non-negative integer below `limit`, or an error naming `what`. */
  below(limit: number, what: string): number {
    const value = this.uint();
    if (value >= limit) throw new SnapshotError(`${what} out of range`);
    return value;
  }

  word(): number {
    let value = 0;
    for (let shift = 0; shift < 32; shift += 8) value |= this.byte() << shift;
    return value >>> 0;
  }

  text(): string {
    const length = this.count();
    let value = "";
    for (let i = 0; i < length; i++) value += String.fromCharCode(this.below(0x10000, "character"));
    return value;
  }

  blob(): Uint8Array {
    const length = this.uint();
    if (length > this.bytes.length - this.offset) throw new SnapshotError("truncated");
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  /** A section `SnapshotWriter.section` wrote, as a reader of its own bytes. */
  section(): SnapshotReader {
    return new SnapshotReader(this.blob());
  }

  /** A path of tiles below `size`, at most `limit` long. */
  path(size: number, limit = size): Int32Array {
    const length = this.below(limit + 1, "path length");
    // Every step takes a byte at least: a length past what is left is damage, not a long path.
    if (length > this.bytes.length - this.offset) throw new SnapshotError("truncated");
    const tiles = new Int32Array(length);
    let tile = 0;
    for (let i = 0; i < length; i++) {
      tile += this.int();
      if (tile < 0 || tile >= size) throw new SnapshotError("path tile out of range");
      tiles[i] = tile;
    }
    return tiles;
  }

  /** A count of entries that take at least a byte each: more than the bytes left is damage. */
  count(): number {
    const count = this.uint();
    if (count > this.bytes.length - this.offset) throw new SnapshotError("truncated");
    return count;
  }

  /** Every byte not read yet. */
  rest(): Uint8Array {
    const value = this.bytes.subarray(this.offset);
    this.offset = this.bytes.length;
    return value;
  }

  get done(): boolean {
    return this.offset === this.bytes.length;
  }

  private byte(): number {
    if (this.offset >= this.bytes.length) throw new SnapshotError("truncated");
    return this.bytes[this.offset++] as number;
  }
}

/** 32-bit FNV-1a of some bytes: a change to any single byte always changes it. */
export function checksum(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ (bytes[i] as number), 0x01000193);
  return hash >>> 0;
}
