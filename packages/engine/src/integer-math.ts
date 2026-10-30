/**
 * Exact integer helpers for game state (R-ECO-04). Products of doubles lose
 * precision past 2^53 and square roots can round up to the next integer;
 * these give the same result on every runtime.
 */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * floor(a / b) for safe integers, with b > 0. The double quotient is exact
 * enough: when a / b is not an integer it is at least 1 / b away from one,
 * a relative gap above 2^-53 for |a| < 2^53, so rounding never reaches it.
 */
export function divFloor(a: number, b: number): number {
  if (b <= 0) throw new RangeError(`divisor must be positive, got ${String(b)}`);
  return Math.floor(a / b);
}

/** floor(a * b / c) for safe integers, with c > 0, even when a * b exceeds 2^53. */
export function mulDiv(a: number, b: number, c: number): number {
  const product = a * b;
  if (Number.isSafeInteger(product)) return divFloor(product, c);
  if (c <= 0) throw new RangeError(`divisor must be positive, got ${String(c)}`);
  const exact = BigInt(a) * BigInt(b);
  const divisor = BigInt(c);
  // BigInt division truncates towards zero; step down for negative remainders.
  const quotient = exact / divisor - (exact % divisor < 0n ? 1n : 0n);
  return Number(quotient);
}

/** floor(value * percent / 100): `percent` of a whole quantity, rounded down. */
export function percentOf(value: number, percent: number): number {
  return mulDiv(value, percent, 100);
}

/** floor(sqrt(n)) for a safe integer n >= 0. */
export function isqrt(n: number): number {
  if (n < 0) throw new RangeError(`square root of negative ${String(n)}`);
  // Math.sqrt is correctly rounded, so the guess is within one of the answer.
  let root = Math.floor(Math.sqrt(n));
  if (root * root > n) root--;
  else if ((root + 1) * (root + 1) <= n) root++;
  return root;
}

const LN2 = 0.6931471805599453;

/**
 * Natural logarithm of a positive double, from additions, products and
 * quotients only: those are exact to the last bit on every runtime, while
 * Math.log and Math.pow may differ in the last bit between engines and would
 * split the clients of a game (R-ECO-04).
 */
export function detLn(x: number): number {
  if (!(x > 0)) throw new RangeError(`logarithm of ${String(x)}`);
  let mantissa = x;
  let exponent = 0;
  while (mantissa >= 2) {
    mantissa /= 2;
    exponent++;
  }
  while (mantissa < 1) {
    mantissa *= 2;
    exponent--;
  }
  // ln m = 2 atanh((m - 1) / (m + 1)), with z at most 1/3 for m in [1, 2).
  const z = (mantissa - 1) / (mantissa + 1);
  const z2 = z * z;
  let term = z;
  let sum = 0;
  for (let k = 1; k <= 31; k += 2) {
    sum += term / k;
    term *= z2;
  }
  return exponent * LN2 + 2 * sum;
}

/** e^y for a double, from basic operations only; see `detLn`. */
export function detExp(y: number): number {
  if (y > 700) return Number.MAX_VALUE;
  if (y < -700) return 0;
  // y = k ln 2 + r with |r| <= ln 2 / 2.
  const k = Math.round(y / LN2);
  const r = y - k * LN2;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 18; n++) {
    term = (term * r) / n;
    sum += term;
  }
  let scale = 1;
  for (let i = 0; i < Math.abs(k); i++) scale = k > 0 ? scale * 2 : scale / 2;
  return sum * scale;
}

/** x^power for x > 0, the same on every runtime; 0 for x = 0. */
export function detPow(x: number, power: number): number {
  return x === 0 ? 0 : detExp(power * detLn(x));
}
