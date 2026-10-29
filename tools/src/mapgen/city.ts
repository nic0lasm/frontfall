import { TILE_LAND, type Topology } from "@frontfall/engine";
import { z } from "zod";
import type { GridSpec } from "./geometry.ts";
import { RELIEF, markShore, removeSmallComponents } from "./terrain.ts";

const LonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/**
 * A city map, built from satellite rasters instead of Natural Earth: water
 * and woods from a land cover grid, hills from an elevation grid. Natural
 * Earth draws a whole river such as the Seine as one line, too coarse for a
 * map a few kilometres across.
 */
export const CityDefinition = z.object({
  /** Land cover raster, by its key in the `rasters` of tools/mapgen/sources.json. */
  landCover: z.string(),
  /** Elevation raster, by its key in the same list. */
  elevation: z.string(),
  /** Share of a tile's land cover pixels that must be open water for the tile to be water. */
  waterShare: z.number().gt(0).max(1),
  /**
   * Water is grown by this many tiles, then shrunk by as many: bridges, which
   * the land cover counts as built-up land, then no longer cut a river.
   */
  bridgeTiles: z.number().int().nonnegative(),
  /** Water is then grown by this many more tiles, so that ships can follow a narrow river. */
  widenTiles: z.number().int().nonnegative().default(0),
  /** Share of tree cover from which a tile counts as woods. */
  woodsShare: z.number().gt(0).max(1),
  /** Woods smaller than this many tiles are left out, and gaps as small inside woods filled. */
  minWoodsTiles: z.number().int().nonnegative(),
  /** Elevations are smoothed with the median of the tiles this many tiles around. */
  smoothTiles: z.number().int().nonnegative(),
  /** Elevations, in metres, from which land is hills and mountains. */
  hills: z.number(),
  mountains: z.number(),
  /** Starts, in the order written, each on the nearest land a player can own. */
  nations: z.array(z.object({ name: z.string(), capital: z.string(), at: LonLat })).min(1),
  /** Landmarks (R-LAND-01), each on the nearest land a player can own. */
  landmarks: z
    .array(
      z.object({
        id: z.string(),
        name: z.object({ en: z.string(), fr: z.string() }),
        effect: z.enum(["gold", "growth", "fortress", "trade", "shield", "assault"]),
        at: LonLat,
      }),
    )
    .default([]),
});
export type CityDefinition = z.infer<typeof CityDefinition>;

/**
 * Part of a raster in geographic coordinates: row 0 is the northern edge,
 * pixels are `dx` degrees wide and `dy` degrees tall.
 */
export interface Raster {
  values: ArrayLike<number>;
  width: number;
  height: number;
  west: number;
  north: number;
  dx: number;
  dy: number;
}

/** ESA WorldCover classes. */
const TREE_COVER = 10;
const OPEN_WATER = 80;

/** One byte per tile in the map format, from a land cover and an elevation raster. */
export function buildCityTerrain(
  grid: GridSpec,
  topology: Topology,
  city: CityDefinition,
  landCover: Raster,
  elevation: Raster,
  options: { minIslandTiles: number; minLakeTiles: number },
): Uint8Array {
  const { water, trees } = coverShares(grid, landCover);
  const size = grid.width * grid.height;
  const wet = new Uint8Array(size);
  for (let i = 0; i < size; i++) if ((water[i] as number) >= city.waterShare) wet[i] = 1;
  for (let step = 0; step < city.bridgeTiles; step++) grow(topology, wet, 1);
  for (let step = 0; step < city.bridgeTiles; step++) grow(topology, wet, 0);
  for (let step = 0; step < city.widenTiles; step++) grow(topology, wet, 1);

  const land = new Uint8Array(size);
  for (let i = 0; i < size; i++) land[i] = 1 - (wet[i] as number);
  removeSmallComponents(topology, land, 1, options.minIslandTiles);
  removeSmallComponents(topology, land, 0, options.minLakeTiles);

  const woods = new Uint8Array(size);
  for (let i = 0; i < size; i++) if ((trees[i] as number) >= city.woodsShare) woods[i] = 1;
  removeSmallComponents(topology, woods, 1, city.minWoodsTiles);
  removeSmallComponents(topology, woods, 0, city.minWoodsTiles);

  const height = smoothedElevation(grid, elevation, city.smoothTiles);
  const tiles = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (land[i] === 0) continue;
    const metres = height[i] as number;
    let band = 0;
    if (metres >= city.mountains) band = RELIEF.range;
    else if (metres >= city.hills) band = RELIEF.lowRange;
    else if (woods[i] === 1) band = RELIEF.plateau;
    tiles[i] = TILE_LAND | band;
  }
  markShore(topology, land, tiles);
  return tiles;
}

/**
 * Share of open water and of tree cover among the land cover pixels whose
 * centre lies in each tile.
 */
export function coverShares(
  grid: GridSpec,
  raster: Raster,
): { water: Float64Array; trees: Float64Array } {
  const size = grid.width * grid.height;
  const water = new Float64Array(size);
  const trees = new Float64Array(size);
  const columns = pixelSpans(grid.width, grid.west, grid.east, raster.west, raster.dx);
  const rows = pixelSpans(grid.height, -grid.north, -grid.south, -raster.north, raster.dy);
  for (let y = 0; y < grid.height; y++) {
    const [top, bottom] = rows[y] as [number, number];
    for (let x = 0; x < grid.width; x++) {
      const [left, right] = columns[x] as [number, number];
      let total = 0;
      let wet = 0;
      let wooded = 0;
      for (let py = Math.max(0, top); py < Math.min(raster.height, bottom); py++) {
        for (let px = Math.max(0, left); px < Math.min(raster.width, right); px++) {
          const value = raster.values[py * raster.width + px];
          total++;
          if (value === OPEN_WATER) wet++;
          else if (value === TREE_COVER) wooded++;
        }
      }
      if (total === 0) throw new Error(`no land cover pixel in tile ${String(x)}, ${String(y)}`);
      water[y * grid.width + x] = wet / total;
      trees[y * grid.width + x] = wooded / total;
    }
  }
  return { water, trees };
}

/**
 * For each of `count` cells evenly spread from `from` to `to`, the first and
 * one past the last pixel whose centre lies in it. Pixels start at `origin`
 * and are `step` wide; coordinates grow along the raster.
 */
function pixelSpans(
  count: number,
  from: number,
  to: number,
  origin: number,
  step: number,
): [number, number][] {
  const first = (edge: number): number => Math.ceil((edge - origin) / step - 0.5);
  const spans: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    spans.push([
      first(from + ((to - from) * i) / count),
      first(from + ((to - from) * (i + 1)) / count),
    ]);
  }
  return spans;
}

/**
 * Elevation at each tile's centre, read bilinearly, then replaced by the
 * median of the tiles around it. The elevation grid is a surface model, so it
 * includes buildings; the median keeps a hill and drops a tower.
 */
export function smoothedElevation(grid: GridSpec, raster: Raster, radius: number): Float64Array {
  const size = grid.width * grid.height;
  const sampled = new Float64Array(size);
  for (let y = 0; y < grid.height; y++) {
    const lat = grid.north - ((y + 0.5) * (grid.north - grid.south)) / grid.height;
    const fy = (raster.north - lat) / raster.dy - 0.5;
    for (let x = 0; x < grid.width; x++) {
      const lon = grid.west + ((x + 0.5) * (grid.east - grid.west)) / grid.width;
      sampled[y * grid.width + x] = bilinear(raster, (lon - raster.west) / raster.dx - 0.5, fy);
    }
  }
  if (radius === 0) return sampled;

  const smoothed = new Float64Array(size);
  const window = new Float64Array((2 * radius + 1) ** 2);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      let count = 0;
      for (let wy = Math.max(0, y - radius); wy <= Math.min(grid.height - 1, y + radius); wy++) {
        for (let wx = Math.max(0, x - radius); wx <= Math.min(grid.width - 1, x + radius); wx++) {
          window[count++] = sampled[wy * grid.width + wx] as number;
        }
      }
      const values = window.subarray(0, count).sort();
      smoothed[y * grid.width + x] = values[count >> 1] as number;
    }
  }
  return smoothed;
}

function bilinear(raster: Raster, fx: number, fy: number): number {
  const clampX = (value: number): number => Math.min(raster.width - 1, Math.max(0, value));
  const clampY = (value: number): number => Math.min(raster.height - 1, Math.max(0, value));
  const x0 = clampX(Math.floor(fx));
  const y0 = clampY(Math.floor(fy));
  const x1 = clampX(x0 + 1);
  const y1 = clampY(y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - x0));
  const ty = Math.min(1, Math.max(0, fy - y0));
  const at = (px: number, py: number): number => raster.values[py * raster.width + px] as number;
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Turns into `value` every tile next to a tile that already holds it. */
function grow(topology: Topology, mask: Uint8Array, value: 0 | 1): void {
  const before = mask.slice();
  const neighbours = new Int32Array(4);
  for (let i = 0; i < mask.length; i++) {
    if (before[i] === value) continue;
    const count = topology.neighborsInto(i, neighbours);
    for (let k = 0; k < count; k++) {
      if (before[neighbours[k] as number] === value) {
        mask[i] = value;
        break;
      }
    }
  }
}
