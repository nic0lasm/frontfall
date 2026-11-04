/** Raster helpers of the premium ground: float grids of `width` × `height`, row 0 to the north. */

export interface Grid {
  readonly width: number;
  readonly height: number;
  /** Whether column 0 follows the last one, as on a map of the whole planet. */
  readonly wrapsX: boolean;
}

/** Gaussian blur of `sigma` texels, in place, as three passes of box blur each way. */
export function gaussianBlur(data: Float32Array, grid: Grid, sigma: number): void {
  if (sigma <= 0) return;
  // Widths of three boxes whose sum approximates the Gaussian (Kovesi).
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const m = Math.round(
    (12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4),
  );
  const scratch = new Float32Array(data.length);
  for (let pass = 0; pass < 3; pass++) {
    const radius = ((pass < m ? lower : lower + 2) - 1) / 2;
    boxRows(data, scratch, grid, radius);
    boxColumns(scratch, data, grid, radius);
  }
}

function boxRows(src: Float32Array, dst: Float32Array, grid: Grid, radius: number): void {
  const { width, height, wrapsX } = grid;
  const span = 2 * radius + 1;
  const at = (x: number): number =>
    wrapsX ? ((x % width) + width) % width : Math.min(width - 1, Math.max(0, x));
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[row + at(x)] as number;
    for (let x = 0; x < width; x++) {
      dst[row + x] = sum / span;
      sum += (src[row + at(x + radius + 1)] as number) - (src[row + at(x - radius)] as number);
    }
  }
}

function boxColumns(src: Float32Array, dst: Float32Array, grid: Grid, radius: number): void {
  const { width, height } = grid;
  const span = 2 * radius + 1;
  const at = (y: number): number => Math.min(height - 1, Math.max(0, y));
  const sums = new Float64Array(width);
  for (let y = -radius; y <= radius; y++) {
    const row = at(y) * width;
    for (let x = 0; x < width; x++) sums[x] = (sums[x] as number) + (src[row + x] as number);
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const add = at(y + radius + 1) * width;
    const drop = at(y - radius) * width;
    for (let x = 0; x < width; x++) {
      const sum = sums[x] as number;
      dst[row + x] = sum / span;
      sums[x] = sum + (src[add + x] as number) - (src[drop + x] as number);
    }
  }
}

/**
 * For every texel, the index of the nearest texel where `inside` is set
 * (itself when set), found by a breadth-first walk over the eight neighbours:
 * close enough to the true nearest for filling colour past a coast.
 */
export function nearestInside(inside: Uint8Array, grid: Grid): Int32Array {
  const { width, height, wrapsX } = grid;
  const nearest = new Int32Array(inside.length).fill(-1);
  const queue = new Int32Array(inside.length);
  let tail = 0;
  for (let i = 0; i < inside.length; i++) {
    if (inside[i] === 1) {
      nearest[i] = i;
      queue[tail++] = i;
    }
  }
  for (let head = 0; head < tail; head++) {
    const index = queue[head] as number;
    const x = index % width;
    const y = (index - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        let nx = x + dx;
        if (nx < 0 || nx >= width) {
          if (!wrapsX) continue;
          nx = (nx + width) % width;
        }
        const n = ny * width + nx;
        if (nearest[n] !== -1) continue;
        nearest[n] = nearest[index] as number;
        queue[tail++] = n;
      }
    }
  }
  return nearest;
}

/** A hash of two integers and a seed, in [-1, 1]. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483647.5 - 1;
}

/** Smooth value noise of cells `cell` texels wide, about -1 to 1; periodic over `period` texels across. */
export function valueNoise(
  x: number,
  y: number,
  cell: number,
  seed: number,
  period: number,
): number {
  const cells = Math.max(1, Math.round(period / cell));
  const fx = x / cell;
  const fy = y / cell;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const u = fx - x0;
  const v = fy - y0;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const wrap = (c: number): number => ((c % cells) + cells) % cells;
  const a = hash(wrap(x0), y0, seed);
  const b = hash(wrap(x0 + 1), y0, seed);
  const c = hash(wrap(x0), y0 + 1, seed);
  const d = hash(wrap(x0 + 1), y0 + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** Bilinear sample of a grid at (x, y) in texels, texel centres at half-integers. */
export function bilinear(data: ArrayLike<number>, grid: Grid, x: number, y: number): number {
  const { width, height, wrapsX } = grid;
  const fx = x - 0.5;
  const fy = Math.min(height - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const u = fx - x0;
  const v = fy - y0;
  const col = (c: number): number =>
    wrapsX ? ((c % width) + width) % width : Math.min(width - 1, Math.max(0, c));
  const y1 = Math.min(height - 1, y0 + 1);
  const a = data[y0 * width + col(x0)] as number;
  const b = data[y0 * width + col(x0 + 1)] as number;
  const c = data[y1 * width + col(x0)] as number;
  const d = data[y1 * width + col(x0 + 1)] as number;
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
