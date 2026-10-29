import {
  HILLS_FROM,
  MAGNITUDE_IMPASSABLE,
  MOUNTAINS_FROM,
  TILE_LAND,
  TILE_MAGNITUDE,
  loadMap,
} from "@frontfall/engine";
import { MapCatalog, MapManifest } from "@frontfall/protocol";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DRAWN_CREDIT, MapDefinition, PublishedMaps } from "../src/mapgen/build.ts";
import { tileAt, type GridSpec } from "../src/mapgen/geometry.ts";

const root = resolve(import.meta.dirname, "../..");
const mapsDir = join(root, "apps/client/public/maps");
const definitionsDir = join(root, "tools/mapgen/definitions");
const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8")) as unknown;

const definitions = readdirSync(definitionsDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => MapDefinition.parse(json(join(definitionsDir, file))));

const maps = definitions.map((definition) => {
  const manifest = MapManifest.parse(json(join(mapsDir, `${definition.id}.json`)));
  const bytes = new Uint8Array(readFileSync(join(mapsDir, manifest.terrain.file)));
  const tiles = bytes.subarray(16);
  const grid: GridSpec = { width: manifest.width, height: manifest.height, ...definition.bounds };
  return { definition, manifest, bytes, tiles, grid };
});

const isLand = (tile: number): boolean => (tile & TILE_LAND) !== 0;
const magnitude = (tile: number): number => tile & TILE_MAGNITUDE;

describe.each(maps)("map $definition.id", ({ definition, manifest, bytes, tiles, grid }) => {
  it("matches its definition and its published checksum", () => {
    expect(manifest).toMatchObject({
      id: definition.id,
      version: definition.version,
      width: definition.width,
      height: definition.height,
      topology: definition.topology,
    });
    const published = PublishedMaps.parse(json(join(root, "tools/mapgen/published.json")));
    expect(published[manifest.id]?.[String(manifest.version)]).toBe(manifest.terrain.sha256);
  });

  it("loads in the engine with the topology of its manifest", () => {
    // Load time is measured by `pnpm maps --check`, outside coverage instrumentation.
    expect(loadMap(bytes, manifest).topology.wrapsX).toBe(manifest.topology === "cylinder");
  });

  it("keeps every nation on land a player can own", () => {
    expect(manifest.nations.length).toBeGreaterThanOrEqual(Math.min(8, definition.nations.count));
    for (const nation of manifest.nations) {
      const tile = tiles[nation.tile] as number;
      expect(isLand(tile) && magnitude(tile) !== MAGNITUDE_IMPASSABLE, nation.name).toBe(true);
    }
  });

  it("has no playable land beyond the ice latitudes (R-MAP-02)", () => {
    const rowHeight = (grid.north - grid.south) / grid.height;
    for (let y = 0; y < grid.height; y++) {
      const lat = grid.north - (y + 0.5) * rowHeight;
      if (lat <= definition.ice.north && lat >= definition.ice.south) continue;
      for (let x = 0; x < grid.width; x++) {
        const tile = tiles[y * grid.width + x] as number;
        if (isLand(tile)) expect(magnitude(tile)).toBe(MAGNITUDE_IMPASSABLE);
      }
    }
  });

  it("keeps no island or lake under the size threshold of its definition", () => {
    const topology = loadMap(bytes, manifest).topology;
    const neighbours = new Int32Array(4);
    const seen = new Uint8Array(topology.size);
    const small: string[] = [];
    for (let start = 0; start < topology.size; start++) {
      if (seen[start] === 1) continue;
      const land = isLand(tiles[start] as number);
      const stack = [start];
      seen[start] = 1;
      let size = 0;
      let touchesEdge = false;
      while (stack.length > 0) {
        const tile = stack.pop() as number;
        size++;
        const x = topology.x(tile);
        const y = topology.y(tile);
        if (
          !topology.wrapsX &&
          (x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1)
        ) {
          touchesEdge = true;
        }
        const count = topology.neighborsInto(tile, neighbours);
        for (let k = 0; k < count; k++) {
          const next = neighbours[k] as number;
          if (seen[next] === 0 && isLand(tiles[next] as number) === land) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
      const threshold = land ? definition.minIslandTiles : definition.minLakeTiles;
      if (size < threshold && !touchesEdge)
        small.push(`${land ? "island" : "lake"} at ${String(start)}`);
    }
    expect(small).toEqual([]);
  });

  it("ships a thumbnail under 40 KB", () => {
    expect(statSync(join(mapsDir, manifest.thumbnail)).size).toBeLessThan(40 * 1024);
  });

  it.runIf(manifest.topology === "cylinder")(
    "joins its first and last columns without a break",
    () => {
      // The seam may differ no more than the most different pair of neighbouring columns.
      const mismatches = (a: number, b: number): number => {
        let count = 0;
        for (let y = 0; y < grid.height; y++) {
          if (
            isLand(tiles[y * grid.width + a] as number) !==
            isLand(tiles[y * grid.width + b] as number)
          )
            count++;
        }
        return count;
      };
      let worst = 0;
      for (let x = 0; x + 1 < grid.width; x++) worst = Math.max(worst, mismatches(x, x + 1));
      expect(mismatches(grid.width - 1, 0)).toBeLessThanOrEqual(worst);
    },
  );
});

describe("relief", () => {
  const at = (id: string, lon: number, lat: number): number => {
    const map = maps.find((m) => m.definition.id === id);
    if (!map) throw new Error(`no map ${id}`);
    return magnitude(map.tiles[tileAt(map.grid, lon, lat) as number] as number);
  };

  it.each([
    ["the Himalayas", 86.9, 28.0],
    ["the Andes", -70.0, -32.7],
    ["the Alps", 7.5, 46.2],
  ])("puts %s among the mountains of the World map", (_, lon, lat) => {
    expect(at("world", lon, lat)).toBeGreaterThanOrEqual(MOUNTAINS_FROM);
  });

  it("puts the Alps and the Pyrenees among the mountains of Europe", () => {
    expect(at("europe", 7.5, 46.2)).toBeGreaterThanOrEqual(MOUNTAINS_FROM);
    expect(at("europe", 0.6, 42.7)).toBeGreaterThanOrEqual(MOUNTAINS_FROM);
  });

  it("keeps the Paris basin as plains", () => {
    expect(at("europe", 2.35, 48.85)).toBeLessThan(10);
  });
});

describe("city maps", () => {
  const cities = maps.filter((m) => m.definition.city);
  const at = (id: string, lon: number, lat: number): number => {
    const map = cities.find((m) => m.definition.id === id);
    if (!map) throw new Error(`no city map ${id}`);
    return map.tiles[tileAt(map.grid, lon, lat) as number] as number;
  };

  it("exist and credit their land cover and elevation", () => {
    expect(cities.map((m) => m.definition.id)).toEqual(["lyon", "paris"]);
    for (const map of cities) {
      expect(map.manifest.credits.map((c) => c.title)).toEqual([
        "ESA WorldCover 10 m 2021 v200",
        "Copernicus DEM GLO-30",
      ]);
    }
  });

  it("keep their nations in the order they are written", () => {
    for (const map of cities) {
      expect(map.manifest.nations.map((n) => n.name)).toEqual(
        map.definition.city?.nations.map((n) => n.name),
      );
    }
  });

  it.each([
    ["paris", "Montmartre", 2.3431, 48.8867],
    ["paris", "Belleville", 2.394, 48.872],
    ["lyon", "Fourvière", 4.8226, 45.7623],
    ["lyon", "the Croix-Rousse", 4.832, 45.776],
  ])("raises %s's %s among the hills or higher", (id, _, lon, lat) => {
    expect(magnitude(at(id, lon, lat))).toBeGreaterThanOrEqual(HILLS_FROM);
  });

  it.each([
    ["paris", "the Bois de Boulogne", 2.253, 48.862],
    ["paris", "the Bois de Vincennes", 2.437, 48.833],
    ["lyon", "the Parc de la Tête d'Or", 4.854, 45.779],
  ])("turns %s's %s into woods", (id, _, lon, lat) => {
    const tile = at(id, lon, lat);
    expect(isLand(tile)).toBe(true);
    expect(magnitude(tile)).toBeGreaterThanOrEqual(HILLS_FROM);
    expect(magnitude(tile)).toBeLessThan(MOUNTAINS_FROM);
  });

  it.each([
    ["paris", ["louvre", "parc-des-princes", "sacre-coeur", "eiffel-tower", "arc-de-triomphe"]],
    ["lyon", ["crayon", "ol-stadium", "fourviere", "edouard-herriot"]],
  ])("places %s's landmarks on land a player can own (R-LAND-01)", (id, ids) => {
    const map = cities.find((m) => m.definition.id === id);
    const landmarks = map?.manifest.landmarks ?? [];
    expect(landmarks.map((l) => l.id)).toEqual(ids);
    for (const landmark of landmarks) {
      const tile = map?.tiles[landmark.tile] as number;
      expect(isLand(tile), landmark.id).toBe(true);
      expect(magnitude(tile), landmark.id).toBeLessThan(MAGNITUDE_IMPASSABLE);
    }
  });

  it("keeps the Île de la Cité and the Presqu'île as plains", () => {
    expect(at("paris", 2.3499, 48.853)).toBe(TILE_LAND);
    expect(at("lyon", 4.832, 45.7578)).toBe(TILE_LAND);
  });
});

describe("drawn test maps", () => {
  const drawn = maps.filter((m) => m.definition.drawn);
  const land = (id: string, x: number, y: number): boolean => {
    const map = drawn.find((m) => m.definition.id === id);
    if (!map) throw new Error(`no drawn map ${id}`);
    return isLand(map.tiles[y * map.grid.width + x] as number);
  };

  it("exist and credit the project instead of a dataset", () => {
    expect(drawn.map((m) => m.definition.id)).toEqual(["island", "ring", "strait"]);
    for (const map of drawn) expect(map.manifest.credits).toEqual([DRAWN_CREDIT]);
  });

  it("keep their nations in the order they are written", () => {
    for (const map of drawn) {
      expect(map.manifest.nations.map((n) => n.name)).toEqual(
        map.definition.drawn?.nations.map((n) => n.name),
      );
    }
  });

  it("cross the seam of the ring with land on both sides", () => {
    const map = drawn.find((m) => m.definition.id === "ring");
    const middle = (map?.grid.height ?? 0) / 2;
    expect(land("ring", 0, middle)).toBe(true);
    expect(land("ring", (map?.grid.width ?? 0) - 1, middle)).toBe(true);
  });

  it("separate the two continents of the strait by a channel of a few tiles", () => {
    const map = drawn.find((m) => m.definition.id === "strait");
    const width = map?.grid.width ?? 0;
    const row = Array.from({ length: width }, (_, x) =>
      land("strait", x, (map?.grid.height ?? 0) / 2),
    );
    const water = row.slice(width / 2 - 8, width / 2 + 8).filter((tile) => !tile).length;
    expect(water).toBeGreaterThan(0);
    expect(water).toBeLessThanOrEqual(6);
  });
});

describe("nations", () => {
  const names = (id: string): string[] =>
    maps.find((m) => m.definition.id === id)?.manifest.nations.map((nation) => nation.name) ?? [];

  it("seats the large countries of every continent on the World map", () => {
    expect(names("world")).toEqual(
      expect.arrayContaining(["Canada", "Australia", "India", "Pakistan", "Nigeria", "Brazil"]),
    );
  });

  it("keeps the nations of a continent map on that continent", () => {
    for (const outside of ["Egypt", "Ethiopia", "Ukraine", "Papua New Guinea"]) {
      expect(names("asia")).not.toContain(outside);
    }
    expect(names("asia")).toContain("Russia");
    for (const outside of ["Iran", "Saudi Arabia", "Yemen", "Syria"]) {
      expect(names("africa")).not.toContain(outside);
    }
  });

  it.each(maps.filter((m) => m.definition.nations.edgeMargin > 0))(
    "keeps the nations of $definition.id away from its edges",
    ({ definition, manifest }) => {
      const margin = definition.nations.edgeMargin;
      for (const nation of manifest.nations) {
        const x = nation.tile % manifest.width;
        const y = Math.floor(nation.tile / manifest.width);
        const fromEdge = Math.min(x, y, manifest.width - 1 - x, manifest.height - 1 - y);
        expect(fromEdge, nation.name).toBeGreaterThanOrEqual(margin);
      }
    },
  );

  it("places every nation a map asks for", () => {
    for (const { definition, manifest } of maps) {
      const wanted = definition.drawn ? definition.drawn.nations.length : definition.nations.count;
      expect(manifest.nations, definition.id).toHaveLength(wanted);
    }
  });

  it("shares the far north of America between several nations", () => {
    const north = ["Greenland", "Nunavut", "Northwest Territories", "Yukon", "Alaska"];
    expect(names("world")).toEqual(expect.arrayContaining([...north, "Iceland"]));
    expect(names("americas")).toEqual(expect.arrayContaining([...north, "Chubut"]));
  });

  it("reaches the north of Europe", () => {
    expect(names("europe")).toEqual(expect.arrayContaining(["Norway", "Sweden", "Finland"]));
  });
});

describe("seas", () => {
  /** Water tiles connected to the largest body of water of the map (R-MAP-05). */
  const ocean = (id: string): { inOcean: (lon: number, lat: number) => boolean } => {
    const map = maps.find((m) => m.definition.id === id);
    if (!map) throw new Error(`no map ${id}`);
    const topology = loadMap(map.bytes, map.manifest).topology;
    const component = new Int32Array(topology.size).fill(-1);
    const sizes: number[] = [];
    const neighbours = new Int32Array(4);
    for (let start = 0; start < topology.size; start++) {
      if (isLand(map.tiles[start] as number) || component[start] !== -1) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [start];
      component[start] = id;
      while (stack.length > 0) {
        const tile = stack.pop() as number;
        size++;
        const count = topology.neighborsInto(tile, neighbours);
        for (let k = 0; k < count; k++) {
          const next = neighbours[k] as number;
          if (!isLand(map.tiles[next] as number) && component[next] === -1) {
            component[next] = id;
            stack.push(next);
          }
        }
      }
      sizes.push(size);
    }
    const largest = sizes.indexOf(Math.max(...sizes));
    return {
      inOcean: (lon, lat) => component[tileAt(map.grid, lon, lat) as number] === largest,
    };
  };

  it.each(["world", "europe"])("lets ships reach the enclosed seas of %s", (id) => {
    const { inOcean } = ocean(id);
    expect(inOcean(34, 43)).toBe(true); // Black Sea, through the Bosporus
    expect(inOcean(36.8, 46)).toBe(true); // Sea of Azov, through the Kerch Strait
    expect(inOcean(19, 57)).toBe(true); // Baltic Sea
    expect(inOcean(18, 35)).toBe(true); // Mediterranean Sea
  });

  it("keeps the Caspian Sea a lake", () => {
    const { inOcean } = ocean("world");
    expect(inOcean(51, 42)).toBe(false);
  });

  /** Fewest water tiles between two points, or -1 when no water path joins them. */
  const sail = (id: string, from: [number, number], to: [number, number]): number => {
    const map = maps.find((m) => m.definition.id === id);
    if (!map) throw new Error(`no map ${id}`);
    const topology = loadMap(map.bytes, map.manifest).topology;
    const start = tileAt(map.grid, ...from) as number;
    const goal = tileAt(map.grid, ...to) as number;
    // Both ends must be sea, or a land tile could pass for an open route.
    expect(isLand(map.tiles[start] as number)).toBe(false);
    expect(isLand(map.tiles[goal] as number)).toBe(false);
    const distance = new Int32Array(topology.size).fill(-1);
    const neighbours = new Int32Array(4);
    const queue = [start];
    distance[start] = 0;
    for (let head = 0; head < queue.length && distance[goal] === -1; head++) {
      const tile = queue[head] as number;
      const count = topology.neighborsInto(tile, neighbours);
      for (let k = 0; k < count; k++) {
        const next = neighbours[k] as number;
        if (!isLand(map.tiles[next] as number) && distance[next] === -1) {
          distance[next] = (distance[tile] as number) + 1;
          queue.push(next);
        }
      }
    }
    return distance[goal] as number;
  };

  it("lets ships sail up the Seine across Paris", () => {
    const steps = sail("paris", [2.3665, 48.8437], [2.2798, 48.8513]); // Austerlitz to Grenelle
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThan(500);
  });

  it("joins the Saône and the Rhône below the Presqu'île of Lyon", () => {
    const steps = sail("lyon", [4.8274, 45.7589], [4.8389, 45.756]); // Pont Bonaparte to La Guillotière
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThan(400);
  });

  it.each(["world", "americas"])("opens the Panama Canal on %s", (id) => {
    const steps = sail(id, [-79.93, 9.6], [-79.5, 8.6]);
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThan(20);
  });

  it.each(["world", "africa", "asia"])("opens the Suez Canal on %s", (id) => {
    // Port Said to the middle of the Red Sea, about 18 degrees of latitude.
    const steps = sail(id, [32.3, 31.6], [38.5, 20]);
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThan(260);
  });
});

describe("catalog", () => {
  it("lists every generated map for the menu", () => {
    const catalog = MapCatalog.parse(json(join(mapsDir, "index.json")));
    expect(catalog.maps.map((m) => m.id)).toEqual(definitions.map((d) => d.id));
    const group = (name: string) => catalog.maps.filter((m) => m.group === name).map((m) => m.id);
    expect(group("world")).toEqual([
      "africa",
      "americas",
      "asia",
      "europe",
      "lyon",
      "paris",
      "world",
    ]);
    expect(group("quick")).toEqual(["island", "ring", "strait"]);
  });

  it("keeps the whole set under 6 MB once compressed", () => {
    const compressed = readdirSync(mapsDir).reduce(
      (sum, file) => sum + gzipSync(readFileSync(join(mapsDir, file))).length,
      0,
    );
    expect(compressed).toBeLessThan(6 * 1024 * 1024);
  });
});
