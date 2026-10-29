import {
  HILLS_FROM,
  MAGNITUDE_IMPASSABLE,
  MOUNTAINS_FROM,
  TILE_LAND,
  TILE_MAGNITUDE,
  encodeMapFile,
  sha256Hex,
  type Topology,
} from "@frontfall/engine";
import { MapManifest, MapName, MapPlayers, type MapCatalog } from "@frontfall/protocol";
import { z } from "zod";
import { CityDefinition, buildCityTerrain, type Raster } from "./city.ts";
import { nearestOwnable, pickNations, type Country, type Nation } from "./nations.ts";
import { encodeIndexedPng } from "./png.ts";
import type { SourceList } from "./sources.ts";
import { buildTerrain, topologyOf, type TerrainSources } from "./terrain.ts";
import { fillShape, tileAt, type GridSpec, type Place, type Shape } from "./geometry.ts";

const LonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** Credit line of the maps drawn for Frontfall rather than built from a dataset. */
export const DRAWN_CREDIT = {
  title: "Drawn for Frontfall",
  url: "https://github.com/nic0lasm/frontfall",
  license: "MIT",
};

/** A map to generate, as written in tools/mapgen/definitions/<id>.json. */
export const MapDefinition = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: MapName,
  version: z.number().int().positive(),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(4096),
  topology: z.enum(["flat", "cylinder"]),
  bounds: z.object({
    west: z.number().min(-180).max(180),
    east: z.number().min(-180).max(180),
    south: z.number().min(-90).max(90),
    north: z.number().min(-90).max(90),
  }),
  ice: z.object({ north: z.number(), south: z.number() }),
  minIslandTiles: z.number().int().nonnegative(),
  minLakeTiles: z.number().int().nonnegative(),
  players: MapPlayers,
  /** Section of the menu the map is listed in (MapCatalog). */
  group: z.enum(["world", "quick"]).default("world"),
  nations: z.object({
    count: z.number().int().nonnegative(),
    minDistance: z.number().int(),
    /** Natural Earth continents whose countries may hold a nation; all when left out. */
    continents: z.array(z.string()).optional(),
    /** Countries outside those continents that still count, by ADM0_A3 code. */
    alsoCountries: z.array(z.string()).default([]),
    /** No nation starts closer than this many tiles to an edge of the map. */
    edgeMargin: z.number().int().nonnegative().default(0),
    /** Starts the map always has, placed before the countries are picked (Seat). */
    seats: z
      .array(
        z.object({ place: z.string(), country: z.string(), region: z.boolean().default(false) }),
      )
      .default([]),
  }),
  /**
   * A test map drawn by hand instead of taken from Natural Earth: land and
   * mountain polygons as [lon, lat] rings, and nations at given points.
   */
  drawn: z
    .object({
      land: z.array(z.array(z.array(LonLat).min(4))),
      mountains: z.array(z.array(z.array(LonLat).min(4))).default([]),
      nations: z.array(z.object({ name: z.string(), capital: z.string(), at: LonLat })),
    })
    .optional(),
  /** A city built from land cover and elevation rasters (CityDefinition). */
  city: CityDefinition.optional(),
});
export type MapDefinition = z.infer<typeof MapDefinition>;

export interface MapSources extends TerrainSources {
  places: Place[];
  /** Country outlines, with POP_EST and ADM0_A3 properties. */
  countries: Shape[];
}

/** The rasters a city map is read from, cut to its bounds, and the credits they need. */
export interface CitySources {
  landCover: Raster;
  elevation: Raster;
  credits: SourceList["dataset"][];
}

export interface BuiltMap {
  manifest: MapManifest;
  terrain: Uint8Array;
  thumbnail: Buffer;
}

export const THUMBNAIL_WIDTH = 256;

/** Thumbnail colours, from the map colours of the brand guide (docs/brand.md). */
const THUMBNAIL_PALETTE = [
  [0x0e, 0x22, 0x33], // shelf water
  [0x0a, 0x1a, 0x28], // deep water
  [0x3d, 0x4a, 0x3b], // plains
  [0x4c, 0x5a, 0x47], // hills
  [0x66, 0x70, 0x5c], // mountains
  [0xc8, 0xd2, 0xda], // ice
] as const;

export function buildMap(
  definition: MapDefinition,
  sources: MapSources,
  dataset: SourceList["dataset"],
  citySources?: CitySources,
): BuiltMap {
  const grid: GridSpec = {
    width: definition.width,
    height: definition.height,
    ...definition.bounds,
  };
  const topology = topologyOf(grid, definition.topology === "cylinder");
  const drawn = definition.drawn;
  const city = definition.city;
  if (city && !citySources) throw new Error(`${definition.id}: city map built without its rasters`);
  const tiles =
    city && citySources
      ? buildCityTerrain(
          grid,
          topology,
          city,
          citySources.landCover,
          citySources.elevation,
          definition,
        )
      : buildTerrain(grid, topology, drawn ? drawnSources(drawn) : sources, definition);
  const terrain = encodeMapFile({
    width: grid.width,
    height: grid.height,
    wrapsX: topology.wrapsX,
    tiles,
  });
  const listed = drawn?.nations ?? city?.nations;
  const nations = listed
    ? placeNations(grid, topology, tiles, listed)
    : pickNations(
        grid,
        topology,
        tiles,
        sources.places,
        eligibleCountries(countryScores(grid, tiles, sources.countries), definition.nations),
        definition.nations,
      );
  if (!listed && nations.length < definition.nations.count) {
    throw new Error(
      `${definition.id}: ${String(nations.length)} of ${String(definition.nations.count)} nations placed; lower nations.count or nations.minDistance`,
    );
  }

  const manifest = MapManifest.parse({
    format: 1,
    id: definition.id,
    name: definition.name,
    version: definition.version,
    width: grid.width,
    height: grid.height,
    topology: definition.topology,
    projection: { type: "equirectangular", ...definition.bounds },
    terrain: { file: `${definition.id}.bin`, bytes: terrain.length, sha256: sha256Hex(terrain) },
    thumbnail: `${definition.id}.png`,
    players: definition.players,
    nations,
    credits: drawn ? [DRAWN_CREDIT] : (citySources?.credits ?? [dataset]),
  });
  return { manifest, terrain, thumbnail: thumbnail(grid, tiles) };
}

type Drawn = NonNullable<MapDefinition["drawn"]>;

function drawnSources(drawn: Drawn): TerrainSources {
  return {
    land: drawn.land.map((rings) => ({ rings, properties: {} })),
    lakes: [],
    glaciers: [],
    regions: drawn.mountains.map((rings) => ({
      rings,
      properties: { FEATURECLA: "Range/mtn", SCALERANK: 1 },
    })),
    peaks: [],
    depths: [[], [], []],
    straits: [],
  };
}

/** Nations of a drawn or city map, in the order written, each on the nearest ownable tile. */
function placeNations(
  grid: GridSpec,
  topology: Topology,
  tiles: Uint8Array,
  nations: Drawn["nations"],
): Nation[] {
  return nations.map(({ name, capital, at }) => {
    const tile = tileAt(grid, at[0], at[1]);
    const start = tile === undefined ? undefined : nearestOwnable(topology, tiles, tile);
    if (start === undefined) throw new Error(`nation ${name} has no land near ${at.join(", ")}`);
    return { name, capital, tile: start };
  });
}

/** The countries a definition lets hold a nation: its continents, plus any it names. */
function eligibleCountries(
  countries: Map<string, Country & { continent: string }>,
  options: MapDefinition["nations"],
): Map<string, Country> {
  const { continents, alsoCountries } = options;
  if (!continents) return countries;
  return new Map(
    [...countries].filter(
      ([code, country]) => continents.includes(country.continent) || alsoCountries.includes(code),
    ),
  );
}

/** Population and ownable land on this map of every country, by ADM0_A3 code. */
function countryScores(
  grid: GridSpec,
  tiles: Uint8Array,
  countries: readonly Shape[],
): Map<string, Country & { continent: string }> {
  const scores = new Map<string, Country & { continent: string }>();
  const scratch = new Uint8Array(tiles.length);
  const crossings: number[][] = [];
  for (const country of countries) {
    let land = 0;
    for (const tile of fillShape(grid, country, scratch, 1, crossings)) {
      const byte = tiles[tile] as number;
      if ((byte & TILE_LAND) !== 0 && (byte & TILE_MAGNITUDE) !== MAGNITUDE_IMPASSABLE) land++;
      scratch[tile] = 0;
    }
    const code = String(country.properties.ADM0_A3);
    const previous = scores.get(code);
    scores.set(code, {
      population: Number(country.properties.POP_EST),
      continent: String(country.properties.CONTINENT),
      land: land + (previous?.land ?? 0),
    });
  }
  return scores;
}

function thumbnail(grid: GridSpec, tiles: Uint8Array): Buffer {
  const width = THUMBNAIL_WIDTH;
  const height = Math.max(1, Math.round((width * grid.height) / grid.width));
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(((y + 0.5) * grid.height) / height);
    for (let x = 0; x < width; x++) {
      const column = Math.floor(((x + 0.5) * grid.width) / width);
      pixels[y * width + x] = colorIndex(tiles[row * grid.width + column] as number);
    }
  }
  return encodeIndexedPng(width, height, THUMBNAIL_PALETTE, pixels);
}

function colorIndex(tile: number): number {
  const magnitude = tile & TILE_MAGNITUDE;
  if ((tile & TILE_LAND) === 0) return magnitude === 0 ? 0 : 1;
  if (magnitude === MAGNITUDE_IMPASSABLE) return 5;
  if (magnitude >= MOUNTAINS_FROM) return 4;
  if (magnitude >= HILLS_FROM) return 3;
  return 2;
}

export function catalog(
  maps: readonly { manifest: MapManifest; group: MapCatalog["maps"][number]["group"] }[],
): MapCatalog {
  return {
    format: 1,
    maps: maps.map(({ manifest: m, group }) => ({
      id: m.id,
      name: m.name,
      width: m.width,
      height: m.height,
      topology: m.topology,
      players: m.players,
      group,
      manifest: `${m.id}.json`,
      thumbnail: m.thumbnail,
    })),
  };
}

/** SHA-256 of every published map version: `{ id: { version: sha256 } }`. */
export const PublishedMaps = z.record(z.string(), z.record(z.string(), z.string()));
export type PublishedMaps = z.infer<typeof PublishedMaps>;

/**
 * Checks a built map against the versions already published. The same id and
 * version must always mean the same terrain bytes; changing them needs a new
 * version in the definition. Returns the updated record.
 */
export function recordPublished(
  published: PublishedMaps,
  manifest: MapManifest,
  allowNew: boolean,
): PublishedMaps {
  const version = String(manifest.version);
  const known = published[manifest.id]?.[version];
  if (known === manifest.terrain.sha256) return published;
  if (known !== undefined) {
    throw new Error(
      `${manifest.id} version ${version} was published with SHA-256 ${known} and now builds to ${manifest.terrain.sha256}: bump "version" in its definition`,
    );
  }
  if (!allowNew) {
    throw new Error(`${manifest.id} version ${version} is not in tools/mapgen/published.json`);
  }
  return {
    ...published,
    [manifest.id]: { ...published[manifest.id], [version]: manifest.terrain.sha256 },
  };
}
