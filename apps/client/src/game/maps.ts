import { TileKind, WorldGrid, loadMap, type LandmarkEffect } from "@frontfall/engine";
import { MapCatalog, MapManifest } from "@frontfall/protocol";
import { generateLand } from "../terrain.ts";

/** Everything the simulation and the renderer need to know about a map. */
export interface MapData {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly wrapsX: boolean;
  /** TileKind of every tile, row 0 at the north edge. */
  readonly kinds: Uint8Array;
  /** Elevation band on land, depth band on water, 0 to 31 (docs/map-format.md). Drawing only. */
  readonly relief: Uint8Array;
  /** Latitudes of the south and north edges of a published map, in degrees. Drawing only. */
  readonly latitudes?: readonly [south: number, north: number];
  /** Nations of a published map, in the manifest's order; none on a generated map. */
  readonly nations: readonly { readonly name: string; readonly tile: number }[];
  /** Landmarks of a published map (R-LAND-01), in the manifest's order; none on most maps. */
  readonly landmarks: readonly MapLandmarkData[];
  /** Published maps only: what pins the terrain, for a desync report. */
  readonly source?: { readonly format: number; readonly version: number; readonly sha256: string };
}

/** A landmark as the game and the screen need it: what the engine reads, and its name. */
export interface MapLandmarkData {
  readonly id: string;
  readonly tile: number;
  readonly effect: LandmarkEffect;
  readonly name: { readonly en: string; readonly fr: string };
}

export type MapGroup = "world" | "quick";
export const MAP_GROUPS: readonly MapGroup[] = ["world", "quick"];

export interface MapInfo {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly wrapsX: boolean;
  /** Earth maps, or small quick ones; generated maps are quick. */
  readonly group: MapGroup;
  /** Bots suggested for a game that fills the map without crowding it. */
  readonly suggestedBots: number;
  /** Published maps only: their name, absolute URLs of the manifest and thumbnail. */
  readonly name?: { readonly en: string; readonly fr: string };
  readonly manifest?: string;
  readonly thumbnail?: string;
  /** Published maps only: most players, humans and bots, a game on it takes. */
  readonly maxPlayers?: number;
}

interface GeneratedMap extends MapInfo {
  readonly seed: number;
  readonly seeds: number;
  readonly landShare: number;
}

/**
 * Generated test maps. They stand in for the maps built from open data and
 * are generated identically on every client from their seed.
 */
const GENERATED: readonly GeneratedMap[] = [
  {
    id: "continents",
    width: 512,
    height: 256,
    wrapsX: true,
    suggestedBots: 12,
    group: "quick",
    seed: 2026,
    seeds: 12,
    landShare: 0.35,
  },
  {
    id: "pangaea",
    width: 384,
    height: 192,
    wrapsX: true,
    suggestedBots: 8,
    group: "quick",
    seed: 7,
    seeds: 3,
    landShare: 0.45,
  },
  {
    id: "skirmish",
    width: 192,
    height: 96,
    wrapsX: false,
    suggestedBots: 3,
    group: "quick",
    seed: 5,
    seeds: 2,
    landShare: 0.5,
  },
];

export const GENERATED_MAPS: readonly MapInfo[] = GENERATED;

/**
 * Bots to suggest for a map: none when its nations play, since they fill a
 * published map already, and the map's own suggestion otherwise. Generated
 * maps have no nations.
 */
export function suggestedBots(info: MapInfo, nations: boolean): number {
  return nations && info.manifest !== undefined ? 0 : info.suggestedBots;
}

/** The first published map, the World when it is there, is the default. */
export const PREFERRED_MAP = "world";

/** Bots are capped by the names available; a map's recommendation counts the human too. */
const MAX_SUGGESTED_BOTS = 24;

/**
 * Maps listed in `maps/index.json` under `base`, then the generated test
 * maps. A missing or invalid catalogue leaves only the generated ones: the
 * game stays playable while a deployment is half done.
 */
export async function fetchMaps(base: string, fetcher: typeof fetch = fetch): Promise<MapInfo[]> {
  const published: MapInfo[] = [];
  try {
    const url = new URL("maps/index.json", base);
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    const catalog = MapCatalog.parse(await response.json());
    for (const map of catalog.maps) {
      published.push({
        id: map.id,
        width: map.width,
        height: map.height,
        wrapsX: map.topology === "cylinder",
        suggestedBots: Math.min(MAX_SUGGESTED_BOTS, Math.max(1, map.players.recommended - 1)),
        name: map.name,
        manifest: new URL(map.manifest, url).href,
        thumbnail: new URL(map.thumbnail, url).href,
        maxPlayers: map.players.max,
        group: map.group,
      });
    }
  } catch (error) {
    console.warn("map catalogue unavailable, offering generated maps only", error);
  }
  published.sort((a, b) => Number(b.id === PREFERRED_MAP) - Number(a.id === PREFERRED_MAP));
  return [...published, ...GENERATED];
}

/**
 * The checked manifest of a published map; undefined for a generated one.
 * The page checks it, so that the simulation worker, which only reads it,
 * leaves the schema library out of its download.
 */
export async function fetchManifest(
  info: MapInfo,
  fetcher: typeof fetch = fetch,
): Promise<MapManifest | undefined> {
  if (!info.manifest) return undefined;
  const response = await fetcher(new URL(info.manifest));
  if (!response.ok) throw new Error(`map ${info.id}: HTTP ${String(response.status)}`);
  return MapManifest.parse(await response.json());
}

/**
 * Terrain of a map: downloaded and checked against its manifest (`fetchManifest`)
 * for a published one, generated otherwise.
 */
export async function fetchMapData(
  info: MapInfo,
  manifest: MapManifest | undefined,
  fetcher: typeof fetch = fetch,
): Promise<MapData> {
  if (!info.manifest) return generateMap(info.id);
  if (!manifest) throw new Error(`map ${info.id}: no manifest`);
  const terrainResponse = await fetcher(new URL(manifest.terrain.file, new URL(info.manifest)));
  if (!terrainResponse.ok)
    throw new Error(`map ${info.id}: HTTP ${String(terrainResponse.status)}`);
  const bytes = new Uint8Array(await terrainResponse.arrayBuffer());
  const { topology, terrain, magnitude } = loadMap(bytes, manifest);
  const names = new Map((manifest.landmarks ?? []).map(({ id, name }) => [id, name]));
  return {
    id: info.id,
    width: topology.width,
    height: topology.height,
    wrapsX: topology.wrapsX,
    kinds: terrain.kinds,
    relief: magnitude,
    latitudes: [manifest.projection.south, manifest.projection.north],
    nations: manifest.nations.map(({ name, tile }) => ({ name, tile })),
    landmarks: terrain.landmarks.map(({ id, tile, effect }) => ({
      id,
      tile,
      effect,
      name: names.get(id) ?? { en: id, fr: id },
    })),
    source: {
      format: manifest.format,
      version: manifest.version,
      sha256: manifest.terrain.sha256,
    },
  };
}

export function generateMap(id: string): MapData {
  const map = GENERATED.find((candidate) => candidate.id === id);
  if (!map) throw new RangeError(`unknown map ${id}`);
  const grid = new WorldGrid(map.width, map.height, { wrapsX: map.wrapsX });
  const land = keepLargestLandmass(
    grid,
    generateLand(grid, map.seed, { seeds: map.seeds, landShare: map.landShare }),
  );
  const kinds = land.map((value) => (value === 1 ? TileKind.Plains : TileKind.Water));
  const relief = coastDistance(grid, land).map((distance) => Math.min(distance - 1, 12));
  return {
    id: map.id,
    width: map.width,
    height: map.height,
    wrapsX: map.wrapsX,
    kinds,
    relief,
    nations: [],
    landmarks: [],
  };
}

/**
 * Steps from every tile to the nearest tile across the coast, 1 for tiles on
 * either side of it. Generated maps have no relief: this gives their seas a
 * shelf and their land a gentle rise inland.
 */
function coastDistance(grid: WorldGrid, land: Uint8Array): Uint8Array {
  const distance = new Uint8Array(grid.size);
  let frontier: number[] = [];
  for (let tile = 0; tile < grid.size; tile++) {
    for (const next of grid.neighbors(tile)) {
      if (land[next] !== land[tile]) {
        distance[tile] = 1;
        frontier.push(tile);
        break;
      }
    }
  }
  for (let step = 2; frontier.length > 0 && step < 255; step++) {
    const following: number[] = [];
    for (const tile of frontier) {
      for (const next of grid.neighbors(tile)) {
        if (distance[next] === 0 && land[next] === land[tile]) {
          distance[next] = step;
          following.push(next);
        }
      }
    }
    frontier = following;
  }
  return distance;
}

/**
 * Drops every landmass but the largest. Until ships exist (R-ATTACK-09),
 * players on separate continents could never reach each other.
 */
function keepLargestLandmass(grid: WorldGrid, land: Uint8Array): Uint8Array {
  const component = new Int32Array(grid.size).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < grid.size; start++) {
    if (land[start] !== 1 || component[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    component[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const tile = stack.pop() as number;
      size++;
      for (const next of grid.neighbors(tile)) {
        if (land[next] === 1 && component[next] === -1) {
          component[next] = id;
          stack.push(next);
        }
      }
    }
    sizes.push(size);
  }
  const largest = sizes.indexOf(Math.max(...sizes));
  return land.map((value, tile) => (value === 1 && component[tile] === largest ? 1 : 0));
}
