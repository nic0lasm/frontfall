/**
 * Bakes the premium ground of the Earth maps (docs/premium-graphics.md):
 * `pnpm premium -- --maps europe,world --texels 4`. The files land in
 * apps/client/public/maps/premium/, left out of git: the premium build makes them.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { bakePremiumGround } from "./bake.ts";
import { TERRARIUM_URL, TerrariumSource } from "./terrarium.ts";

const root = join(import.meta.dirname, "../../..");
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    maps: { type: "string", default: "europe,world,americas,africa,asia" },
    texels: { type: "string", default: "4" },
    out: { type: "string", default: join(root, "apps/client/public/maps/premium") },
    cache: {
      type: "string",
      default: process.env.FRONTFALL_MAP_CACHE ?? join(root, "node_modules/.cache/mapgen"),
    },
    quality: { type: "string", default: "84" },
  },
});

const log = (line: string): void => {
  console.log(line);
};
const texels = Number(values.texels);
const quality = Number(values.quality);
const mapsDir = join(root, "apps/client/public/maps");
await mkdir(values.out, { recursive: true });

interface Manifest {
  readonly projection: { west: number; east: number; south: number; north: number };
  readonly terrain: { file: string; sha256: string };
  readonly topology: string;
  readonly width: number;
  readonly height: number;
}

const index: Record<string, unknown> = {};
for (const id of values.maps.split(",")) {
  const manifest = JSON.parse(await readFile(join(mapsDir, `${id}.json`), "utf8")) as Manifest;
  const bytes = new Uint8Array(await readFile(join(mapsDir, manifest.terrain.file)));
  const sum = createHash("sha256").update(bytes).digest("hex");
  if (sum !== manifest.terrain.sha256)
    throw new Error(`${id}: terrain does not match its manifest`);
  const { width, height } = manifest;
  const tilesBytes = bytes.subarray(16);
  const kinds = new Uint8Array(width * height);
  const ice = new Uint8Array(width * height);
  for (let i = 0; i < kinds.length; i++) {
    const byte = tilesBytes[i] as number;
    kinds[i] = byte >> 7;
    ice[i] = byte >> 7 === 1 && (byte & 31) === 31 ? 1 : 0;
  }
  const { west, east, south, north } = manifest.projection;
  // The zoom whose pixels are at least as fine as the texels, at the equator.
  const degrees = Math.min((east - west) / (width * texels), (north - south) / (height * texels));
  const zoom = Math.max(0, Math.ceil(Math.log2(360 / (256 * degrees))));
  const source = new TerrariumSource(zoom, values.cache, log);
  await source.load(west, east, south, north);
  log(`${id}: baking ${String(width * texels)} × ${String(height * texels)}`);
  const ground = bakePremiumGround(
    {
      width,
      height,
      wrapsX: manifest.topology === "cylinder",
      kinds,
      ice,
      west,
      east,
      south,
      north,
    },
    texels,
    (lon, lat) => source.sample(lon, lat),
    log,
  );
  const raw = { width: ground.width, height: ground.height, channels: 4 as const };
  const land = `${id}-land.webp`;
  const sea = `${id}-sea.webp`;
  await sharp(ground.land, { raw })
    .webp({ quality, alphaQuality: 100, effort: 5 })
    .toFile(join(values.out, land));
  // The sea is smooth: half the texels hold it.
  await sharp(ground.sea, { raw })
    .removeAlpha()
    .resize(Math.round(ground.width / 2), Math.round(ground.height / 2), { kernel: "lanczos3" })
    .webp({ quality, effort: 5 })
    .toFile(join(values.out, sea));
  index[id] = { texelsPerTile: texels, terrainSha256: sum, land, sea, elevationZoom: zoom };
  log(`${id}: done`);
}

const indexFile = join(values.out, "index.json");
let previous: { maps?: Record<string, unknown> } = {};
try {
  previous = JSON.parse(await readFile(indexFile, "utf8")) as typeof previous;
} catch {
  // A first bake.
}
await writeFile(
  indexFile,
  `${JSON.stringify(
    {
      format: 1,
      elevation: { url: TERRARIUM_URL, docs: "docs/premium-graphics.md" },
      maps: { ...previous.maps, ...index },
    },
    null,
    2,
  )}\n`,
);
