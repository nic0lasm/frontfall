/**
 * Rivers of the premium ground, from the elevation alone: every texel of land
 * drains to the sea along the path a priority flood gives it (Barnes, Lehman
 * and Mulla, 2014), and the land a texel drains, weighted by how wet its
 * climate is, sets how wide a river runs there. Decoration only: the rules
 * know no rivers.
 */
import type { Grid } from "./raster.ts";

/** A binary heap of texel indices by elevation, lowest first. */
class Heap {
  private keys: Float32Array;
  private items: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float32Array(capacity);
    this.items = new Int32Array(capacity);
  }

  push(item: number, key: number): void {
    let i = this.size++;
    const { keys, items } = this;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((keys[parent] as number) <= key) break;
      keys[i] = keys[parent] as number;
      items[i] = items[parent] as number;
      i = parent;
    }
    keys[i] = key;
    items[i] = item;
  }

  /** The lowest item; its key is left in `lastKey`. */
  pop(): number {
    const { keys, items } = this;
    const top = items[0] as number;
    this.lastKey = keys[0] as number;
    const n = --this.size;
    const key = keys[n] as number;
    const item = items[n] as number;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= n) break;
      if (child + 1 < n && (keys[child + 1] as number) < (keys[child] as number)) child++;
      if ((keys[child] as number) >= key) break;
      keys[i] = keys[child] as number;
      items[i] = items[child] as number;
      i = child;
    }
    keys[i] = key;
    items[i] = item;
    return top;
  }

  lastKey = 0;
}

/**
 * Land drained through each texel, in texels weighted by `wetness` (0 to 1
 * each); 0 at sea. `land` marks the texels of land, `heights` their elevation.
 */
export function drainage(
  heights: Float32Array,
  land: Uint8Array,
  wetness: Float32Array,
  grid: Grid,
): Float32Array {
  const { width, height, wrapsX } = grid;
  const size = width * height;
  const downstream = new Int32Array(size).fill(-1);
  const seen = new Uint8Array(size);
  const order = new Int32Array(size);
  let popped = 0;
  const heap = new Heap(size);
  // Outlets: the sea, and land on the edges of a map that does not wrap.
  for (let i = 0; i < size; i++) {
    const x = i % width;
    const y = (i - x) / width;
    const edge = y === 0 || y === height - 1 || (!wrapsX && (x === 0 || x === width - 1));
    if (land[i] === 0 || edge) {
      seen[i] = 1;
      if (land[i] === 0) continue;
      heap.push(i, heights[i] as number);
    }
  }
  // Land beside the sea flows into it.
  for (let i = 0; i < size; i++) {
    if (land[i] === 0 || seen[i] === 1) continue;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const n = neighbour(x + dx, y + dy, grid);
      if (n >= 0 && land[n] === 0) {
        seen[i] = 1;
        downstream[i] = n;
        heap.push(i, heights[i] as number);
        break;
      }
    }
  }
  while (heap.size > 0) {
    const i = heap.pop();
    const level = heap.lastKey;
    order[popped++] = i;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const n = neighbour(x + dx, y + dy, grid);
      if (n < 0 || seen[n] === 1) continue;
      seen[n] = 1;
      downstream[n] = i;
      // A pit is filled to just above its outlet, so its water finds the way out.
      heap.push(n, Math.max(heights[n] as number, level + 1e-3));
    }
  }
  const drained = new Float32Array(size);
  for (let k = popped - 1; k >= 0; k--) {
    const i = order[k] as number;
    drained[i] = (drained[i] as number) + (wetness[i] as number);
    const down = downstream[i] as number;
    if (down >= 0 && land[down] === 1) drained[down] = (drained[down] as number) + drained[i];
  }
  return drained;
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const;

function neighbour(x: number, y: number, grid: Grid): number {
  if (y < 0 || y >= grid.height) return -1;
  if (x < 0 || x >= grid.width) {
    if (!grid.wrapsX) return -1;
    x = (x + grid.width) % grid.width;
  }
  return y * grid.width + x;
}
