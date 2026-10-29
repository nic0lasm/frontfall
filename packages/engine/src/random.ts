/**
 * Seeded xoshiro128** generator. Every client runs the same simulation, so all
 * randomness in the engine must come from here and never from Math.random.
 */
export class Random {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    // Expand the 32-bit seed with splitmix32 so nearby seeds diverge immediately.
    let x = seed >>> 0;
    const next = (): number => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
  }

  static fromState(state: RandomState): Random {
    const random = new Random(0);
    [random.s0, random.s1, random.s2, random.s3] = state;
    return random;
  }

  /** Takes the state of another generator, for a game loaded from a snapshot. */
  restore(state: RandomState): void {
    [this.s0, this.s1, this.s2, this.s3] = state;
  }

  state(): RandomState {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform integer in [min, max). Rejection sampling keeps it unbiased. */
  nextInt(min: number, max: number): number {
    const range = max - min;
    if (!Number.isInteger(min) || !Number.isInteger(max) || range <= 0 || range > 2 ** 32) {
      throw new RangeError(`invalid range [${String(min)}, ${String(max)})`);
    }
    const limit = 2 ** 32 - (2 ** 32 % range);
    let value = this.nextUint32();
    while (value >= limit) value = this.nextUint32();
    return min + (value % range);
  }
}

/**
 * A draw that depends only on its inputs: the game's seed, the tick, the id
 * of what draws and what for. Rules that draw this way share no state with
 * `game.random`, so adding or removing one of them leaves every other draw
 * of the game as it was.
 */
export function derivedRandom(seed: number, tick: number, id: number, usage: number): number {
  let h = seed >>> 0;
  for (const word of [tick, id, usage]) {
    h = Math.imul(h ^ (word >>> 0), 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** What derived draws are for: two rules drawing on the same tick for the same id still differ. */
export const DrawUsage = {
  TradeDestination: 1,
  WarshipPatrol: 2,
  Interception: 3,
  LandmarkShield: 4,
} as const;

export type RandomState = readonly [number, number, number, number];

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}
