import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadMap } from "@frontfall/engine";
import { fromArrayBuffer } from "geotiff";
import {
  MapDefinition,
  PublishedMaps,
  buildMap,
  catalog,
  recordPublished,
  type CitySources,
  type MapSources,
} from "./build.ts";
import type { Raster } from "./city.ts";
import { places, shapes } from "./geometry.ts";
import { samePngImage } from "./png.ts";
import { SourceList, StraitList, fetchSource } from "./sources.ts";

const root = resolve(import.meta.dirname, "../../..");
const mapgenDir = join(root, "tools/mapgen");

const { values } = parseArgs({
  options: {
    out: { type: "string", default: join(root, "apps/client/public/maps") },
    cache: {
      type: "string",
      default: process.env.FRONTFALL_MAP_CACHE ?? join(root, "node_modules/.cache/mapgen"),
    },
    // CI: fail instead of recording a map version that was never published.
    check: { type: "boolean", default: false },
  },
});

const log = (line: string): void => {
  console.log(line);
};

const json = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8")) as unknown;
const text = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const list = SourceList.parse(await json(join(mapgenDir, "sources.json")));
const layer = async (name: string): Promise<unknown> => {
  const source = list.files[name];
  if (!source) throw new Error(`tools/mapgen/sources.json has no "${name}" entry`);
  const bytes = await fetchSource(name, source, values.cache, log);
  return JSON.parse(bytes.toString("utf8")) as unknown;
};

const sources: MapSources = {
  land: shapes(await layer("land")),
  lakes: shapes(await layer("lakes")),
  glaciers: shapes(await layer("glaciers")),
  regions: shapes(await layer("regions")),
  peaks: places(await layer("peaks")),
  places: places(await layer("places")),
  countries: shapes(await layer("countries")),
  straits: StraitList.parse(await json(join(mapgenDir, "straits.json"))).straits.map(
    (strait) => strait.path,
  ),
  depths: [
    shapes(await layer("depth200")),
    shapes(await layer("depth2000")),
    shapes(await layer("depth4000")),
  ],
};

/** The part of a pinned GeoTIFF that covers a box, with one pixel to spare on each side. */
const raster = async (
  name: string,
  bounds: MapDefinition["bounds"],
): Promise<{ raster: Raster; credit: SourceList["dataset"] }> => {
  const source = list.rasters[name];
  if (!source) throw new Error(`tools/mapgen/sources.json has no raster "${name}"`);
  const bytes = await fetchSource(name, source, values.cache, log, "tif");
  const image = await (await fromArrayBuffer(new Uint8Array(bytes).buffer)).getImage();
  const [originX, originY] = image.getOrigin() as [number, number];
  const [dx, negativeDy] = image.getResolution() as [number, number];
  const dy = -negativeDy;
  const left = Math.max(0, Math.floor((bounds.west - originX) / dx) - 1);
  const right = Math.min(image.getWidth(), Math.ceil((bounds.east - originX) / dx) + 1);
  const top = Math.max(0, Math.floor((originY - bounds.north) / dy) - 1);
  const bottom = Math.min(image.getHeight(), Math.ceil((originY - bounds.south) / dy) + 1);
  const [band] = await image.readRasters({ window: [left, top, right, bottom], samples: [0] });
  if (!band || typeof band === "number") throw new Error(`${name}: no raster band`);
  return {
    raster: {
      values: band,
      width: right - left,
      height: bottom - top,
      west: originX + left * dx,
      north: originY - top * dy,
      dx,
      dy,
    },
    credit: source.credit,
  };
};

const citySources = async (definition: MapDefinition): Promise<CitySources | undefined> => {
  if (!definition.city) return undefined;
  const landCover = await raster(definition.city.landCover, definition.bounds);
  const elevation = await raster(definition.city.elevation, definition.bounds);
  return {
    landCover: landCover.raster,
    elevation: elevation.raster,
    credits: [landCover.credit, elevation.credit],
  };
};

const definitionFiles = (await readdir(join(mapgenDir, "definitions")))
  .filter((file) => file.endsWith(".json"))
  .sort();
const publishedPath = join(mapgenDir, "published.json");
let published = existsSync(publishedPath) ? PublishedMaps.parse(await json(publishedPath)) : {};

await mkdir(values.out, { recursive: true });
const manifests = [];
const listed = [];
for (const file of definitionFiles) {
  const definition = MapDefinition.parse(await json(join(mapgenDir, "definitions", file)));
  const started = process.hrtime.bigint();
  const map = buildMap(definition, sources, list.dataset, await citySources(definition));
  published = recordPublished(published, map.manifest, !values.check);
  await writeFile(join(values.out, map.manifest.terrain.file), map.terrain);
  const thumbnailPath = join(values.out, map.manifest.thumbnail);
  const keepThumbnail =
    existsSync(thumbnailPath) && samePngImage(await readFile(thumbnailPath), map.thumbnail);
  if (!keepThumbnail) await writeFile(thumbnailPath, map.thumbnail);
  await writeFile(join(values.out, `${definition.id}.json`), text(map.manifest));
  manifests.push(map.manifest);
  listed.push({ manifest: map.manifest, group: definition.group });
  const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
  log(
    `${definition.id} v${String(definition.version)}: ${String(definition.width)}x${String(definition.height)}, ${String(map.manifest.nations.length)} nations, ${map.manifest.terrain.sha256.slice(0, 12)}, ${String(ms)} ms`,
  );
}
await writeFile(join(values.out, "index.json"), text(catalog(listed)));
if (!values.check) await writeFile(publishedPath, text(published));

// Budget of the map loader (M2-02): best of a few runs, the first also compiles it.
const LOAD_BUDGET_MS = 100;
let slow = false;
for (const manifest of manifests) {
  const bytes = new Uint8Array(await readFile(join(values.out, manifest.terrain.file)));
  let fastest = Infinity;
  for (let run = 0; run < 5; run++) {
    const started = performance.now();
    loadMap(bytes, manifest);
    fastest = Math.min(fastest, performance.now() - started);
  }
  log(`${manifest.id}: loads in ${fastest.toFixed(1)} ms`);
  if (fastest > LOAD_BUDGET_MS) slow = true;
}
if (slow && values.check) {
  console.error(`a map takes more than ${String(LOAD_BUDGET_MS)} ms to load`);
  process.exitCode = 1;
}
