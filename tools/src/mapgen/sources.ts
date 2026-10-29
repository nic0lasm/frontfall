import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const Credit = z.object({ title: z.string(), url: z.url(), license: z.string() });
const Pin = z.object({ url: z.url(), sha256: z.string().regex(/^[0-9a-f]{64}$/) });

export const SourceList = z.object({
  dataset: Credit,
  files: z.record(z.string(), Pin),
  /** GeoTIFF rasters of the city maps, each with the credit it needs. */
  rasters: z.record(z.string(), Pin.extend({ credit: Credit })).default({}),
});
export type SourceList = z.infer<typeof SourceList>;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Bytes of a pinned source file, from the cache when present, downloaded
 * otherwise. Either way the content must match its SHA-256, so a changed
 * upstream file can never alter a map silently.
 */
export async function fetchSource(
  name: string,
  source: { url: string; sha256: string },
  cacheDir: string,
  log: (line: string) => void,
  extension = "geojson",
): Promise<Buffer> {
  const cached = join(cacheDir, `${source.sha256}.${extension}`);
  if (existsSync(cached)) {
    const bytes = await readFile(cached);
    if (sha256(bytes) === source.sha256) return bytes;
  }
  log(`downloading ${name} from ${source.url}`);
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`${name}: HTTP ${String(response.status)} from ${source.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== source.sha256) {
    throw new Error(`${name}: expected SHA-256 ${source.sha256}, downloaded ${actual}`);
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(`${cached}.part`, bytes);
  await rename(`${cached}.part`, cached);
  return bytes;
}

/** Narrow waterways kept open on every map: tools/mapgen/straits.json. */
export const StraitList = z.object({
  straits: z.array(
    z.object({
      name: z.string(),
      path: z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(2),
    }),
  ),
});
