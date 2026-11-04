/**
 * Elevation from the AWS Terrain Tiles (https://registry.opendata.aws/terrain-tiles/),
 * Web Mercator tiles of 256 × 256 pixels that hold metres above or below sea
 * level as red × 256 + green + blue / 256 − 32768. Land and sea floor together,
 * from public datasets (docs/premium-graphics.md lists them).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

export const TERRARIUM_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium";
const TILE = 256;
/** Web Mercator stops short of the poles; latitudes past it read the last row. */
const MAX_LATITUDE = 85.0511;

/** Metres from the three bytes of a Terrarium pixel. */
export function terrariumMetres(red: number, green: number, blue: number): number {
  return red * 256 + green + blue / 256 - 32768;
}

/** Position on the Mercator plane at `zoom`, in tile pixels from the north-west corner of the world. */
export function mercatorPixel(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const size = TILE * 2 ** zoom;
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const phi = (clamped * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size,
  };
}

/** Elevation tiles read once and kept, from a cache folder and the network. */
export class TerrariumSource {
  private readonly tiles = new Map<string, Float32Array>();

  constructor(
    readonly zoom: number,
    private readonly cacheDir: string,
    private readonly log: (line: string) => void = () => {},
  ) {}

  /** Downloads, or finds in the cache, every tile that covers a box of longitudes and latitudes. */
  async load(west: number, east: number, south: number, north: number): Promise<void> {
    const n = 2 ** this.zoom;
    const a = mercatorPixel(west, north, this.zoom);
    const b = mercatorPixel(east, south, this.zoom);
    const jobs: [number, number][] = [];
    for (let ty = Math.floor(a.y / TILE); ty <= Math.min(n - 1, Math.floor(b.y / TILE)); ty++) {
      for (let tx = Math.floor(a.x / TILE); tx <= Math.floor((b.x - 1e-9) / TILE); tx++) {
        jobs.push([((tx % n) + n) % n, ty]);
      }
    }
    this.log(`elevation: ${String(jobs.length)} tiles at zoom ${String(this.zoom)}`);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < jobs.length) {
        const [tx, ty] = jobs[next++] as [number, number];
        if (!this.tiles.has(`${String(tx)}/${String(ty)}`)) await this.fetchTile(tx, ty);
      }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
  }

  private async fetchTile(tx: number, ty: number): Promise<void> {
    const name = `${String(this.zoom)}/${String(tx)}/${String(ty)}.png`;
    const cached = join(this.cacheDir, "terrarium", name.replaceAll("/", "_"));
    let bytes: Buffer;
    if (existsSync(cached)) bytes = await readFile(cached);
    else {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        response = await fetch(`${TERRARIUM_URL}/${name}`).catch(() => undefined);
        if (response?.ok) break;
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
      if (!response?.ok) throw new Error(`elevation tile ${name}: no answer`);
      bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(join(this.cacheDir, "terrarium"), { recursive: true });
      await writeFile(`${cached}.part`, bytes);
      await rename(`${cached}.part`, cached);
    }
    const { data, info } = await sharp(bytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== TILE || info.height !== TILE)
      throw new Error(`elevation tile ${name}: bad size`);
    const metres = new Float32Array(TILE * TILE);
    for (let i = 0; i < metres.length; i++) {
      metres[i] = terrariumMetres(
        data[i * 3] as number,
        data[i * 3 + 1] as number,
        data[i * 3 + 2] as number,
      );
    }
    this.tiles.set(`${String(tx)}/${String(ty)}`, metres);
  }

  /** Elevation in metres at a longitude and latitude, bilinear between the tiles' pixels. */
  sample(lon: number, lat: number): number {
    const n = 2 ** this.zoom;
    const size = TILE * n;
    const p = mercatorPixel(lon, lat, this.zoom);
    const fx = p.x - 0.5;
    const fy = Math.min(size - 1, Math.max(0, p.y - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const u = fx - x0;
    const v = fy - y0;
    const y1 = Math.min(size - 1, y0 + 1);
    const at = (x: number, y: number): number => {
      const wx = ((x % size) + size) % size;
      const tile = this.tiles.get(
        `${String(Math.floor(wx / TILE))}/${String(Math.floor(y / TILE))}`,
      );
      if (!tile) throw new Error("elevation tile not loaded");
      return tile[(y % TILE) * TILE + (wx % TILE)] as number;
    };
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y1);
    const d = at(x0 + 1, y1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
}
