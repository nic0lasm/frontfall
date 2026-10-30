/** Terrain tones beyond the brand's land and ocean; mirrored in assets/brand/tokens.json. */
export const TERRAIN_COLORS = {
  landLight: "#8A8E68",
  seaShallow: "#1F5878",
  foam: "#BFE0F0",
} as const;

/**
 * Ground of each climate, kept dark and muted like the brand's land so the
 * player colours laid over it stay the brightest thing on the map.
 */
export const BIOME_COLORS = {
  /** Hot and dry: the Sahara, Arabia, the heart of Australia. */
  desert: "#A08A5C",
  /** Dry grass between desert and forest. */
  steppe: "#77774A",
  /** Temperate lowlands. */
  grassland: "#4F6A3C",
  /** Wet lowlands, from temperate woods to rainforest. */
  forest: "#2F5233",
  /** Cold forest of the north. */
  taiga: "#34493B",
  /** Cold plains beyond the trees. */
  tundra: "#6B7064",
  /** Ice caps and high peaks. */
  snow: "#C9D3DA",
} as const;

/**
 * Bare rock, a darkened slate: light enough to read as rock, dark enough
 * that the pale player colours (sand, snow, mint) keep a contrast of about
 * 2:1 against it at its most lit.
 */
const ROCK = "#6A7C8E";

/**
 * Signed distance to the coast, in tiles, that the alpha channel holds at its
 * ends: land above 0.5, water below. The square root keeps the precision
 * near the coast, where the shader draws it, and the reach far out at sea,
 * where the depth fades.
 */
export const COAST_REACH = 48;

/** Radius of the boxes that blur the coast, in tiles (blur). */
const COAST_BLUR = 1;
/** How far inside its own side the centre of every tile stays, in tiles. */
const COAST_KEEP = 0.2;
/** Radius of the boxes that blur the relief before it is lit, in tiles. */
const RELIEF_BLUR = 2;

/** Latitudes of a map's south and north edges, in degrees. */
export type Latitudes = readonly [south: number, north: number];

/** Where a map has no latitudes, such as a generated one: a temperate band. */
const TEMPERATE: Latitudes = [40, 55];

export interface TerrainColorOptions {
  readonly width: number;
  readonly height: number;
  /** TileKind of every tile: 0 water, 1 plains, 2 hills, 3 mountains, 4 impassable. */
  readonly kinds: Uint8Array;
  /** Elevation band on land, depth band on water, 0 to 31. */
  readonly relief: Uint8Array;
  readonly wrapsX: boolean;
  /** Latitudes of the south and north edges, which set the climate. Temperate when left out. */
  readonly latitudes?: Latitudes | undefined;
  /**
   * Filled with the height the ground is lit from, one byte a tile, for the
   * shader to light again (HEIGHT_SCALE bytes an elevation band, water at 0).
   */
  readonly heightOut?: Uint8Array | undefined;
}

/** Bytes of height per elevation band in TerrainColorOptions.heightOut. */
export const HEIGHT_SCALE = 8;

/** Signed distance to the coast, as the alpha channel holds it. */
export function encodeCoast(distance: number): number {
  const reach = Math.sqrt(Math.min(1, Math.abs(distance) / COAST_REACH));
  return Math.round(127.5 + Math.sign(distance) * reach * 127.5);
}

/**
 * The ground of every tile, computed once and drawn with linear filtering so
 * it reads as smooth country rather than squares.
 *
 * RGB is the land's colour in sRGB: its climate, from the latitude and the
 * distance to the sea, lowlands rising to rock and snow, lit from the
 * north-west by the slope. Water tiles carry the colour of the nearest land,
 * so the filter never blends sea into the shore.
 *
 * Alpha is the signed distance from the tile's centre to the coast
 * (encodeCoast): the shader draws a smooth coastline where it crosses 0.5 and
 * shades the sea from it, so the sea needs no colour of its own here.
 */
export function bakeTerrainColors(options: TerrainColorOptions): Uint8Array {
  const { width, height, kinds, wrapsX } = options;
  const size = width * height;
  const out = new Uint8Array(size * 4);
  const [south, north] = options.latitudes ?? TEMPERATE;
  const tilesPerDegree = height / Math.max(1, north - south);
  const biome = {
    desert: linear(BIOME_COLORS.desert),
    steppe: linear(BIOME_COLORS.steppe),
    grassland: linear(BIOME_COLORS.grassland),
    forest: linear(BIOME_COLORS.forest),
    taiga: linear(BIOME_COLORS.taiga),
    tundra: linear(BIOME_COLORS.tundra),
    snow: linear(BIOME_COLORS.snow),
  };
  const rock = linear(ROCK);
  const highland = linear(TERRAIN_COLORS.landLight);
  const isWater = new Uint8Array(size);
  for (let tile = 0; tile < size; tile++) isWater[tile] = kinds[tile] === 0 ? 1 : 0;
  // From each tile's centre to the centre of the nearest tile of the other kind.
  const toWater = distanceTo(isWater, 1, width, height, wrapsX);
  const toLand = distanceTo(isWater, 0, width, height, wrapsX);
  // The coast lies halfway between the centres of a water tile and the land beside it.
  const coast = new Float32Array(size);
  for (let tile = 0; tile < size; tile++) {
    coast[tile] =
      isWater[tile] === 1
        ? 0.5 - Math.sqrt(toLand[tile] as number)
        : Math.sqrt(toWater[tile] as number) - 0.5;
  }
  // Blurred, the distance traces the coast in curves rather than steps of
  // tiles; the centre of every tile stays on its own side, so a lone island
  // or a one-tile strait keeps a dot or a thread of its own.
  blur(coast, width, height, wrapsX, COAST_BLUR);
  for (let tile = 0; tile < size; tile++) {
    const d = coast[tile] as number;
    coast[tile] = isWater[tile] === 1 ? Math.min(d, -COAST_KEEP) : Math.max(d, COAST_KEEP);
  }
  const column = (x: number): number =>
    wrapsX ? (x + width) % width : Math.min(width - 1, Math.max(0, x));
  const row = (y: number): number => Math.min(height - 1, Math.max(0, y));
  const at = (x: number, y: number): number => row(y) * width + column(x);
  // The elevation bands of the map file are steps: smoothed, they read as hills, not plateaus.
  const smooth = new Float32Array(size);
  for (let tile = 0; tile < size; tile++)
    smooth[tile] = isWater[tile] === 1 ? 0 : (options.relief[tile] as number);
  // A lightly blurred copy keeps the crests of ranges sharp in the shading.
  const fine = smooth.slice();
  blur(fine, width, height, wrapsX, 1);
  blur(smooth, width, height, wrapsX, RELIEF_BLUR);
  const heightOut = options.heightOut;
  if (heightOut)
    for (let tile = 0; tile < size; tile++)
      heightOut[tile] = Math.min(255, Math.round((smooth[tile] as number) * HEIGHT_SCALE));
  const level = (x: number, y: number): number => smooth[at(x, y)] as number;
  const crest = (x: number, y: number): number => fine[at(x, y)] as number;

  const color: [number, number, number] = [0, 0, 0];
  const mixed: [number, number, number] = [0, 0, 0];
  for (let y = 0, tile = 0; y < height; y++) {
    const latitude = north - (y + 0.5) / tilesPerDegree;
    const polar = Math.abs(latitude);
    for (let x = 0; x < width; x++, tile++) {
      out[tile * 4 + 3] = encodeCoast(coast[tile] as number);
      if (isWater[tile] === 1) continue;
      const kind = kinds[tile] as number;
      const h = smooth[tile] as number;
      climate(polar, Math.sqrt(toWater[tile] as number) / tilesPerDegree, h, biome, color);
      if (kind === 4) {
        // Impassable ground: rock, under ice toward the poles.
        mix(rock, biome.snow, smoothstep(55, 70, polar), color);
      } else {
        // Uplands pale toward the highland tone, then bare rock, then snow on the highest peaks.
        mix(color, highland, smoothstep(10, 26, h) * 0.45, mixed);
        mix(mixed, rock, smoothstep(22, 30, h) * 0.8, color);
        mix(color, biome.snow, smoothstep(28.5, 31, h) * 0.7, color);
      }
      // Light from the north-west: slopes that face it lighten, the others darken.
      // The broad slope of the hills, and the fine one of their crests.
      const slope =
        level(x - 2, y) -
        level(x + 2, y) +
        level(x, y - 2) -
        level(x, y + 2) +
        1.5 * (crest(x - 1, y) - crest(x + 1, y) + crest(x, y - 1) - crest(x, y + 1));
      // A little grain per tile keeps close-ups from looking flat.
      const grain = (Math.imul(tile, 0x9e3779b1) >>> 24) / 255 - 0.5;
      const shade = Math.min(1.4, Math.max(0.55, 1 + slope * 0.06 + grain * 0.05));
      out[tile * 4] = toSrgbByte(color[0] * shade);
      out[tile * 4 + 1] = toSrgbByte(color[1] * shade);
      out[tile * 4 + 2] = toSrgbByte(color[2] * shade);
    }
  }
  extendLandColors(out, isWater, toLand, width, height, wrapsX);
  return out;
}

/** Scratch colour of the cold climates. */
const COLD: [number, number, number] = [0, 0, 0];

type Biomes = Record<keyof typeof BIOME_COLORS, readonly number[]>;

/**
 * The ground of a climate, in linear RGB. Moisture falls in the dry belts
 * around 25 degrees and far from the sea, and rises at the equator; warmth
 * falls toward the poles and with height.
 */
function climate(
  polar: number,
  inland: number,
  height: number,
  biome: Biomes,
  out: [number, number, number],
): void {
  const belt = 1 - 0.8 * Math.exp(-(((polar - 24) / 9) ** 2));
  const coastal = Math.exp(-inland / 6);
  const moisture = Math.min(
    1,
    belt * (0.4 + 0.6 * coastal) + 0.55 * Math.exp(-((polar / 11) ** 2)),
  );
  const warmth = 1 - polar / 72 - height * 0.012;
  // Wet to dry, at the latitude's warmth.
  if (moisture > 0.62) mix(biome.grassland, biome.forest, smoothstep(0.62, 0.9, moisture), out);
  else if (moisture > 0.32)
    mix(biome.steppe, biome.grassland, smoothstep(0.32, 0.62, moisture), out);
  else mix(biome.desert, biome.steppe, smoothstep(0.14, 0.32, moisture), out);
  // The cold north: taiga where it is wet enough, tundra beyond, ice at the end.
  if (warmth >= 0.4) return;
  const cold = COLD;
  mix(
    biome.tundra,
    biome.taiga,
    smoothstep(0.12, 0.3, warmth) * smoothstep(0.3, 0.5, moisture),
    cold,
  );
  mix(cold, biome.snow, 1 - smoothstep(0.02, 0.12, warmth), cold);
  mix(cold, out, smoothstep(0.24, 0.4, warmth), out);
}

/**
 * Squared Euclidean distance from every tile's centre to the nearest tile
 * whose flag equals `target`, in tiles squared (0 on those tiles). Exact, in
 * two passes of the lower envelope of parabolas (Felzenszwalb and
 * Huttenlocher), columns first, then rows; a row of a map that wraps is
 * unrolled three times so distances carry across its seam.
 */
function distanceTo(
  flags: Uint8Array,
  target: number,
  width: number,
  height: number,
  wrapsX: boolean,
): Float32Array {
  const far = 1e12;
  const grid = new Float32Array(width * height);
  const longest = Math.max(width * (wrapsX ? 3 : 1), height);
  const f = new Float64Array(longest);
  const d = new Float64Array(longest);
  const v = new Int32Array(longest);
  const z = new Float64Array(longest + 1);
  const envelope = (n: number): void => {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      const fq = (f[q] as number) + q * q;
      let p = v[k] as number;
      let s = (fq - ((f[p] as number) + p * p)) / (2 * q - 2 * p);
      while (s <= (z[k] as number)) {
        k--;
        p = v[k] as number;
        s = (fq - ((f[p] as number) + p * p)) / (2 * q - 2 * p);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while ((z[k + 1] as number) < q) k++;
      const p = v[k] as number;
      d[q] = (q - p) * (q - p) + (f[p] as number);
    }
  };
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = flags[y * width + x] === target ? 0 : far;
    envelope(height);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y] as number;
  }
  const copies = wrapsX ? 3 : 1;
  const offset = wrapsX ? width : 0;
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < width * copies; i++) f[i] = grid[y * width + (i % width)] as number;
    envelope(width * copies);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x + offset] as number;
  }
  return grid;
}

/**
 * Gives water tiles near the coast (`near` holds the squared distance to
 * land) the average colour of the land beside them, two tiles out, so linear filtering on the shore blends land with
 * land. The sea itself is drawn from the alpha channel.
 */
function extendLandColors(
  rgba: Uint8Array,
  isWater: Uint8Array,
  near: Float32Array,
  width: number,
  height: number,
  wrapsX: boolean,
): void {
  const filled = Uint8Array.from(isWater, (water) => (water === 1 ? 0 : 1));
  for (let round = 0; round < 2; round++) {
    const next = filled.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = y * width + x;
        if (filled[tile] === 1 || (near[tile] as number) > 8) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            let nx = x + dx;
            if (wrapsX) nx = (nx + width) % width;
            else if (nx < 0 || nx >= width) continue;
            const other = ny * width + nx;
            if (filled[other] !== 1) continue;
            r += rgba[other * 4] as number;
            g += rgba[other * 4 + 1] as number;
            b += rgba[other * 4 + 2] as number;
            n++;
          }
        }
        if (n === 0) continue;
        rgba[tile * 4] = Math.round(r / n);
        rgba[tile * 4 + 1] = Math.round(g / n);
        rgba[tile * 4 + 2] = Math.round(b / n);
        next[tile] = 1;
      }
    }
    filled.set(next);
  }
}

/**
 * Blurs a field in place, close to a Gaussian: three box blurs of `radius`
 * tiles, rows then columns, each with a running sum along the line. Rows
 * wrap on a map that wraps; columns clamp at the poles.
 */
function blur(
  field: Float32Array,
  width: number,
  height: number,
  wrapsX: boolean,
  radius: number,
): void {
  const scratch = new Float32Array(field.length);
  const longest = Math.max(width, height);
  const padded = new Float32Array(longest + 2 * radius);
  const span = 2 * radius + 1;
  // One line: copied with its ends wrapped or repeated, then a running sum.
  const line = (
    from: Float32Array,
    to: Float32Array,
    first: number,
    step: number,
    length: number,
    wraps: boolean,
  ): void => {
    for (let i = 0; i < length; i++) padded[i + radius] = from[first + i * step] as number;
    for (let k = 1; k <= radius; k++) {
      padded[radius - k] = from[first + (wraps ? length - k : 0) * step] as number;
      padded[radius + length - 1 + k] = from[first + (wraps ? k - 1 : length - 1) * step] as number;
    }
    let sum = 0;
    for (let k = 0; k < span; k++) sum += padded[k] as number;
    for (let i = 0, tile = first; i < length; i++, tile += step) {
      to[tile] = sum / span;
      sum += (padded[i + span] ?? 0) - (padded[i] as number);
    }
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) line(field, scratch, y * width, 1, width, wrapsX);
    for (let x = 0; x < width; x++) line(scratch, field, x, width, height, false);
  }
}

export function linear(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [toLinear((value >> 16) & 0xff), toLinear((value >> 8) & 0xff), toLinear(value & 0xff)];
}

function toLinear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toSrgbByte(value: number): number {
  const c = Math.min(1, Math.max(0, value));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(
  a: readonly number[],
  b: readonly number[],
  t: number,
  out: [number, number, number],
): [number, number, number] {
  out[0] = (a[0] as number) + ((b[0] as number) - (a[0] as number)) * t;
  out[1] = (a[1] as number) + ((b[1] as number) - (a[1] as number)) * t;
  out[2] = (a[2] as number) + ((b[2] as number) - (a[2] as number)) * t;
  return out;
}
