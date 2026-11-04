/**
 * The premium ground of a map (docs/premium-graphics.md): land and sea lit
 * ahead from real elevation at several texels a tile, for the territory
 * layer's PREMIUM path. The game's own climates give the lowland colours, so
 * the look stays the game's; the elevation gives relief, rock, snow and the
 * depth of the sea. Everything here is decoration: the rules keep the map's tiles.
 */
import { bakeTerrainColors } from "../../../apps/client/src/render/terrain-colors.ts";
import { bilinear, gaussianBlur, nearestInside, valueNoise, type Grid } from "./raster.ts";

export interface PremiumMap {
  readonly width: number;
  readonly height: number;
  readonly wrapsX: boolean;
  /** TileKind of every tile, 0 for water. */
  readonly kinds: Uint8Array;
  /** Tiles whose land is ice (magnitude 31). */
  readonly ice: Uint8Array;
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
}

export interface PremiumGround {
  readonly width: number;
  readonly height: number;
  /** Lit land in sRGB, the light it got in alpha (half the shade, 0 to 0.75). */
  readonly land: Uint8Array;
  /** Lit sea in sRGB, alpha 255. */
  readonly sea: Uint8Array;
}

/** How much the relief is raised to be lit: real slopes are too gentle to read from above. */
const EXAGGERATION = 3.4;
/** The sun from the north-west, with two softer lights to fill the shade (azimuth, altitude, weight). */
const LIGHTS = [
  [315, 40, 0.6],
  [270, 45, 0.2],
  [355, 50, 0.2],
] as const;

type Rgb = readonly [number, number, number];
const rgb = (r: number, g: number, b: number): Rgb => [r / 255, g / 255, b / 255];
const ROCK_HIGH = rgb(128, 112, 94);
const ROCK = rgb(118, 110, 104);
const UPLAND = rgb(132, 120, 84);
const SNOW = rgb(236, 240, 246);
const ICE = rgb(226, 234, 242);
const SHELF = rgb(30, 92, 110);
const SLOPE = rgb(18, 62, 90);
const OPEN = rgb(11, 38, 66);
const ABYSS = rgb(6, 20, 38);
const COOL = [0.75, 0.825, 1.0] as const;
const WARM = [1.0, 0.957, 0.871] as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Height of the snow line in metres at a latitude: high in the tropics, low toward the poles. */
export function snowLine(lat: number): number {
  const a = Math.abs(lat);
  return a < 20 ? 5000 : Math.max(400, 5000 - (a - 20) * 85);
}

export function bakePremiumGround(
  map: PremiumMap,
  texelsPerTile: number,
  elevation: (lon: number, lat: number) => number,
  log: (line: string) => void = () => {},
): PremiumGround {
  const k = texelsPerTile;
  const W = map.width * k;
  const H = map.height * k;
  const size = W * H;
  const grid: Grid = { width: W, height: H, wrapsX: map.wrapsX };
  const tiles: Grid = { width: map.width, height: map.height, wrapsX: map.wrapsX };
  const degX = (map.east - map.west) / W;
  const degY = (map.north - map.south) / H;

  // The game's climates without its relief: lowland colour, and the coast it draws.
  const flatKinds = map.kinds.map((kind) => (kind === 0 ? 0 : 1));
  const ground = bakeTerrainColors({
    width: map.width,
    height: map.height,
    kinds: flatKinds,
    relief: new Uint8Array(map.width * map.height),
    wrapsX: map.wrapsX,
    latitudes: [map.south, map.north],
  });
  const channel = (c: number): Float32Array =>
    Float32Array.from({ length: map.width * map.height }, (_, i) => ground[i * 4 + c] as number);
  const [red, green, blue, coast] = [0, 1, 2, 3].map(channel) as [
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
  ];
  const iceTiles = Float32Array.from(map.ice);

  log("sampling elevation");
  const h = new Float32Array(size);
  const land = new Uint8Array(size);
  const ice = new Float32Array(size);
  const lats = new Float32Array(H);
  for (let y = 0; y < H; y++) lats[y] = map.north - (y + 0.5) * degY;
  for (let y = 0; y < H; y++) {
    const lat = lats[y] as number;
    const ty = (y + 0.5) / k;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const tx = (x + 0.5) / k;
      const isLand = bilinear(coast, tiles, tx, ty) >= 127.5;
      land[i] = isLand ? 1 : 0;
      const metres = elevation(map.west + (x + 0.5) * degX, lat);
      // Below sea level on land (polders, depressions) and above it at sea (lakes) read as the coast.
      h[i] = isLand ? Math.max(metres, 1) : Math.min(metres, -30);
      ice[i] = bilinear(iceTiles, tiles, tx, ty);
    }
  }
  gaussianBlur(ice, grid, k * 0.6);

  log("lighting");
  const smooth = Float32Array.from(h);
  gaussianBlur(smooth, grid, 0.7);
  const around = Float32Array.from(h);
  gaussianBlur(around, grid, k * 3);
  const lights = LIGHTS.map(([az, alt, weight]) => {
    const a = (az * Math.PI) / 180;
    const e = (alt * Math.PI) / 180;
    return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e), weight] as const;
  });
  const flatLight = lights.reduce((sum, [, , lz, weight]) => sum + lz * weight, 0);

  const landBytes = new Uint8Array(size * 4);
  const seaBytes = new Uint8Array(size * 4);
  const encode = (v: number): number => Math.round(clamp01(v) ** (1 / 2.2) * 255);
  for (let y = 0; y < H; y++) {
    const lat = lats[y] as number;
    const metresX = degX * 111_320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const metresY = degY * 110_540;
    const up = Math.max(0, y - 1) * W;
    const down = Math.min(H - 1, y + 1) * W;
    const ty = (y + 0.5) / k;
    const snowline = snowLine(lat);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const left = map.wrapsX ? (x - 1 + W) % W : Math.max(0, x - 1);
      const right = map.wrapsX ? (x + 1) % W : Math.min(W - 1, x + 1);
      const row = y * W;
      // Rows run south: a slope rising north has a negative gradient along them.
      const gx =
        (((smooth[row + right] as number) - (smooth[row + left] as number)) / (2 * metresX)) *
        EXAGGERATION;
      const gy =
        (((smooth[up + x] as number) - (smooth[down + x] as number)) / (2 * metresY)) *
        EXAGGERATION;
      const nz = 1 / Math.sqrt(1 + gx * gx + gy * gy);
      const nx = -gx * nz;
      const ny = gy * nz;
      let lit = 0;
      for (const [lx, ly, lz, weight] of lights)
        lit += Math.max(0, nx * lx + ny * ly + nz * lz) * weight;
      const hs = lit / flatLight;
      const hi = h[i] as number;
      const noise =
        0.25 * valueNoise(x, y, 64, 1, W) +
        0.35 * valueNoise(x, y, 16, 2, W) +
        0.2 * valueNoise(x, y, 4, 3, W);
      if (land[i] === 1) {
        const e = hi;
        const ao = Math.max(-1, Math.min(1, (hi - (around[i] as number)) / 400));
        const tx = (x + 0.5) / k;
        const base: Rgb = [
          (bilinear(red, tiles, tx, ty) / 255) * 1.1,
          (bilinear(green, tiles, tx, ty) / 255) * 1.1,
          (bilinear(blue, tiles, tx, ty) / 255) * 1.1,
        ];
        const steep = clamp01((1 - nz) * 3.2);
        const snow =
          clamp01((e - snowline) / 350 + noise * 0.6) * clamp01(0.55 + (nz - 0.75) * 2.5);
        const s = Math.max(0.25, Math.min(1.5, hs ** 1.35 * (1 + 0.35 * ao)));
        const warm = clamp01((s - 0.6) / 0.8);
        const iceMix = clamp01(((ice[i] as number) - 0.5) * 2 + 0.5);
        for (let c = 0; c < 3; c++) {
          let col =
            (base[c] as number) +
            ((base[c] as number) * 0.4 + (UPLAND[c] as number) * 0.6 - (base[c] as number)) *
              clamp01((e - 250) / 700);
          col += ((ROCK_HIGH[c] as number) - col) * clamp01((e - 900) / 700);
          col +=
            ((ROCK[c] as number) - col) *
            clamp01(Math.max(0, (e - 1500) / 600) * 0.8 + steep * 0.35);
          col += ((SNOW[c] as number) - col) * snow;
          col += ((ICE[c] as number) - col) * (iceMix > 0.5 ? 1 : 0);
          col *= 1 + 0.1 * noise;
          const tint = (COOL[c] as number) + ((WARM[c] as number) - (COOL[c] as number)) * warm;
          landBytes[i * 4 + c] = encode(col * s * (0.75 + 0.25 * tint) * 0.82);
        }
        landBytes[i * 4 + 3] = Math.round(clamp01(s / 2) * 255);
      } else {
        const d = Math.max(0, -hi);
        const light = Math.max(0.85, Math.min(1.15, 1 + (hs - 1) * 0.18));
        for (let c = 0; c < 3; c++) {
          let col =
            (SHELF[c] as number) + ((SLOPE[c] as number) - (SHELF[c] as number)) * clamp01(d / 150);
          col += ((OPEN[c] as number) - col) * clamp01((d - 150) / 1000);
          col += ((ABYSS[c] as number) - col) * clamp01((d - 1200) / 2500);
          seaBytes[i * 4 + c] = encode(col * light);
        }
        seaBytes[i * 4 + 3] = 255;
      }
    }
  }

  // Each texture is filled past the coast with its nearest colour, so that the
  // game's own coast curve, drawn over both, cuts clean whatever the filter.
  log("filling past the coast");
  const fill = (bytes: Uint8Array, inside: Uint8Array): void => {
    const nearest = nearestInside(inside, grid);
    for (let i = 0; i < size; i++) {
      const from = nearest[i] as number;
      if (from === i || from < 0) continue;
      bytes.copyWithin(i * 4, from * 4, from * 4 + 4);
    }
  };
  fill(landBytes, land);
  fill(
    seaBytes,
    land.map((v) => 1 - v),
  );
  return { width: W, height: H, land: landBytes, sea: seaBytes };
}
