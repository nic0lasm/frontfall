import {
  MAGNITUDE_IMPASSABLE,
  TILE_LAND,
  TILE_SHORE,
  WorldGrid,
  type Topology,
} from "@frontfall/engine";
import {
  fillShape,
  fillShapes,
  tileAt,
  type GridSpec,
  type Place,
  type Shape,
} from "./geometry.ts";

/** Natural Earth layers a map is built from, already parsed. */
export interface TerrainSources {
  land: Shape[];
  lakes: Shape[];
  glaciers: Shape[];
  /** Named physical regions: mountain ranges, plateaus, foothills and more. */
  regions: Shape[];
  /** Summits and spot heights with an `elevation` in metres. */
  peaks: Place[];
  /** Areas deeper than 200, 2,000 and 4,000 metres. */
  depths: [Shape[], Shape[], Shape[]];
  /** Waterways too narrow for the grid that must stay open to ships, as [lon, lat] paths. */
  straits: readonly (readonly (readonly [number, number])[])[];
}

export interface TerrainOptions {
  /** Land beyond these latitudes is ice (R-MAP-02). */
  ice: { north: number; south: number };
  /** Islands and lakes smaller than this many tiles are removed. */
  minIslandTiles: number;
  minLakeTiles: number;
}

/**
 * Elevation bands written for land. Plains stay at 0; the engine reads 10 to 19
 * as hills and 20 to 30 as mountains (docs/map-format.md).
 */
export const RELIEF = {
  plateau: 10,
  lowRange: 13,
  range: 20,
  highRange: 24,
  highestRange: 28,
} as const;

/** Depth band per bathymetry layer, from the shallowest. Shelf water stays at 0. */
export const DEPTH_BANDS = [8, 16, 24] as const;

/** Peak heights, in metres, from which a range counts as mountains, high, and highest. */
const RANGE_HEIGHTS = { range: 1500, highRange: 2500, highestRange: 4000 } as const;

export function topologyOf(grid: GridSpec, wrapsX: boolean): Topology {
  return new WorldGrid(grid.width, grid.height, { wrapsX });
}

/** One byte per tile in the map format, from Natural Earth layers. */
export function buildTerrain(
  grid: GridSpec,
  topology: Topology,
  sources: TerrainSources,
  options: TerrainOptions,
): Uint8Array {
  const land = fillShapes(grid, sources.land);
  const lakes = fillShapes(grid, sources.lakes);
  for (let i = 0; i < land.length; i++) if (lakes[i] === 1) land[i] = 0;

  // Straits first: a channel can cut a sliver of land small enough to remove.
  for (const path of sources.straits) carveStrait(grid, land, path);
  removeSmallComponents(topology, land, 1, options.minIslandTiles);
  removeSmallComponents(topology, land, 0, options.minLakeTiles);

  const tiles = new Uint8Array(land.length);
  const relief = reliefBands(grid, sources);
  const depth = new Uint8Array(land.length);
  sources.depths.forEach((layer, step) => {
    const mask = fillShapes(grid, layer);
    for (let i = 0; i < mask.length; i++) if (mask[i] === 1) depth[i] = DEPTH_BANDS[step] as number;
  });
  const glaciers = fillShapes(grid, sources.glaciers);
  const iceRows = iceRowRange(grid, options.ice);

  for (let i = 0; i < tiles.length; i++) {
    if (land[i] === 0) {
      tiles[i] = depth[i] as number;
      continue;
    }
    const row = Math.floor(i / grid.width);
    const frozen = glaciers[i] === 1 || row < iceRows.first || row > iceRows.last;
    tiles[i] = TILE_LAND | (frozen ? MAGNITUDE_IMPASSABLE : (relief[i] as number));
  }

  markShore(topology, land, tiles);
  return tiles;
}

/** Sets the shore bit on every land tile with a water neighbour, across the seam on a cylinder. */
export function markShore(topology: Topology, land: Uint8Array, tiles: Uint8Array): void {
  const neighbours = new Int32Array(4);
  for (let i = 0; i < tiles.length; i++) {
    if (land[i] === 0) continue;
    const count = topology.neighborsInto(i, neighbours);
    for (let k = 0; k < count; k++) {
      if (land[neighbours[k] as number] === 0) {
        tiles[i] = (tiles[i] as number) | TILE_SHORE;
        break;
      }
    }
  }
}

/**
 * Turns into water every tile along a path, in steps that never go diagonal,
 * so that the water stays connected through the four-neighbour topology.
 * Parts of the path outside the grid are skipped.
 */
export function carveStrait(
  grid: GridSpec,
  land: Uint8Array,
  path: readonly (readonly [number, number])[],
): void {
  const column = (lon: number): number =>
    Math.floor(((lon - grid.west) / (grid.east - grid.west)) * grid.width);
  const row = (lat: number): number =>
    Math.floor(((grid.north - lat) / (grid.north - grid.south)) * grid.height);
  const clear = (x: number, y: number): void => {
    if (x >= 0 && x < grid.width && y >= 0 && y < grid.height) land[y * grid.width + x] = 0;
  };
  for (let i = 0; i + 1 < path.length; i++) {
    const [fromLon, fromLat] = path[i] as readonly [number, number];
    const [toLon, toLat] = path[i + 1] as readonly [number, number];
    let x = column(fromLon);
    let y = row(fromLat);
    const endX = column(toLon);
    const endY = row(toLat);
    clear(x, y);
    // Walk the larger gap first, one tile at a time, until both match.
    while (x !== endX || y !== endY) {
      if (Math.abs(endX - x) >= Math.abs(endY - y)) x += Math.sign(endX - x);
      else y += Math.sign(endY - y);
      clear(x, y);
    }
  }
}

/** Rows whose centre lies between the two ice latitudes. */
function iceRowRange(grid: GridSpec, ice: TerrainOptions["ice"]): { first: number; last: number } {
  const rowHeight = (grid.north - grid.south) / grid.height;
  let first = 0;
  while (first < grid.height && grid.north - (first + 0.5) * rowHeight > ice.north) first++;
  let last = grid.height - 1;
  while (last >= 0 && grid.north - (last + 0.5) * rowHeight < ice.south) last--;
  return { first, last };
}

/**
 * Elevation band of every tile. Natural Earth has no elevation grid, so the
 * relief comes from its named regions: mountain ranges are graded by the
 * highest summit inside them (or by their map rank when none is listed),
 * plateaus and foothills become hills. A higher band always wins an overlap.
 */
export function reliefBands(grid: GridSpec, sources: TerrainSources): Uint8Array {
  const bands = new Uint8Array(grid.width * grid.height);
  const summits = new Map<number, number>();
  for (const peak of sources.peaks) {
    const elevation = peak.properties.elevation;
    if (typeof elevation !== "number") continue;
    const tile = tileAt(grid, peak.lon, peak.lat);
    if (tile === undefined) continue;
    summits.set(tile, Math.max(summits.get(tile) ?? 0, elevation));
  }

  const scratch = new Uint8Array(bands.length);
  const crossings: number[][] = [];
  for (const region of sources.regions) {
    const kind = region.properties.FEATURECLA;
    if (kind !== "Range/mtn" && kind !== "Plateau" && kind !== "Foothills") continue;
    const tiles = fillShape(grid, region, scratch, 1, crossings);
    let band: number = RELIEF.plateau;
    if (kind === "Range/mtn") {
      let highest = 0;
      for (const tile of tiles) highest = Math.max(highest, summits.get(tile) ?? 0);
      band = rangeBand(highest, Number(region.properties.SCALERANK));
    }
    for (const tile of tiles) {
      if (band > (bands[tile] as number)) bands[tile] = band;
      scratch[tile] = 0;
    }
  }
  return bands;
}

function rangeBand(highestSummit: number, scaleRank: number): number {
  if (highestSummit >= RANGE_HEIGHTS.highestRange) return RELIEF.highestRange;
  if (highestSummit >= RANGE_HEIGHTS.highRange) return RELIEF.highRange;
  if (highestSummit >= RANGE_HEIGHTS.range) return RELIEF.range;
  if (highestSummit > 0) return RELIEF.lowRange;
  // No listed summit: the most prominent ranges on the map are still mountains.
  return scaleRank <= 3 ? RELIEF.range : RELIEF.lowRange;
}

/**
 * Flips connected groups of `value` tiles smaller than `minTiles` to the other
 * value: islands into sea, ponds into land. Groups that touch the edge of a
 * flat map are kept, since they continue beyond it.
 */
export function removeSmallComponents(
  topology: Topology,
  mask: Uint8Array,
  value: 0 | 1,
  minTiles: number,
): number {
  const seen = new Uint8Array(mask.length);
  const neighbours = new Int32Array(4);
  const stack: number[] = [];
  const group: number[] = [];
  let removed = 0;
  for (let start = 0; start < mask.length; start++) {
    if (seen[start] === 1 || mask[start] !== value) continue;
    seen[start] = 1;
    stack.push(start);
    group.length = 0;
    let touchesEdge = false;
    while (stack.length > 0) {
      const tile = stack.pop() as number;
      group.push(tile);
      if (!topology.wrapsX && !touchesEdge) {
        const x = topology.x(tile);
        const y = topology.y(tile);
        touchesEdge = x === 0 || y === 0 || x === topology.width - 1 || y === topology.height - 1;
      }
      const count = topology.neighborsInto(tile, neighbours);
      for (let k = 0; k < count; k++) {
        const next = neighbours[k] as number;
        if (seen[next] === 0 && mask[next] === value) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (group.length < minTiles && !touchesEdge) {
      for (const tile of group) mask[tile] = value === 1 ? 0 : 1;
      removed++;
    }
  }
  return removed;
}
