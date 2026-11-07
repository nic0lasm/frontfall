import { randomBytes, randomInt } from "node:crypto";

/**
 * Every random value the server draws: ids, tokens, seeds and secrets. Tests
 * hand the server their own to get the same values on every run; everything
 * else gets `systemIds`.
 */
export interface Ids {
  /** A game's id: 72 random bits in 12 URL-safe characters, short enough to share, too many to guess. */
  gameId(): string;
  /** A reconnect token: 128 random bits, a password for one seat. */
  token(): string;
  /** A game's seed, from 0 to 2^31 - 1. */
  seed(): number;
  /** Random bytes for keys, salts and the secrets of sign-in. */
  bytes(size: number): Buffer;
  /** A number from 0 to 1, 1 excluded, where an even spread is all that counts. */
  fraction(): number;
}

/** Drawn from the system's secure source, as `node:crypto` gives it. */
export const systemIds: Ids = {
  gameId: () => randomBytes(9).toString("base64url"),
  token: () => randomBytes(16).toString("base64url"),
  seed: () => randomInt(2 ** 31),
  bytes: (size) => randomBytes(size),
  fraction: () => Math.random(),
};
