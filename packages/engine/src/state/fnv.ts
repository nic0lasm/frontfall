/**
 * 32-bit FNV-1a, the hash of the state, of the setup and of the balance
 * values. Every value is fed as bytes, lowest first.
 */
export const FNV_OFFSET = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;

/** One round: `unit` is a byte, or for the map's own arrays a whole entry. */
export function mixUnit(hash: number, unit: number): number {
  return Math.imul(hash ^ unit, FNV_PRIME);
}

/** One round per byte of a 32-bit word, lowest byte first. */
export function mixWord(hash: number, word: number): number {
  hash = Math.imul(hash ^ (word & 0xff), FNV_PRIME);
  hash = Math.imul(hash ^ ((word >>> 8) & 0xff), FNV_PRIME);
  hash = Math.imul(hash ^ ((word >>> 16) & 0xff), FNV_PRIME);
  return Math.imul(hash ^ (word >>> 24), FNV_PRIME);
}

/** A value as two 32-bit halves, low then high, so counts above 2^32 are not truncated. */
export function mix(hash: number, value: number): number {
  return mixWord(mixWord(hash, value >>> 0), Math.floor(value / 2 ** 32) >>> 0);
}
