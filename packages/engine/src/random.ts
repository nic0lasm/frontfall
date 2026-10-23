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

export type RandomState = readonly [number, number, number, number];

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}
