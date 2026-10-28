import { MAP_COLORS } from "../palette.ts";
import { COAST_REACH, TERRAIN_COLORS } from "./terrain-colors.ts";
import { FRONT_SECONDS } from "./fronts.ts";

/** Widest the minimap's image gets, in pixels: a phone shows it small, a laptop a little larger. */
const MAX_PIXELS = 400;

/** Ground samples taken across each pixel of the image, on each axis, at most. */
const GROUND_SAMPLES = 3;

/** Who a pixel belongs to is asked at this many points across it, on each axis. */
const OWNER_SAMPLES = 2;

/** Weight of an owner's colour over the ground, so that the relief still shows through. */
const OWNED = 0.8;

/** Land edge darkness, and how bright the player's own outline is. */
const EDGE_DARK = 0.6;
const OUTLINE = 0.85;

/** Ember, the colour of attack fronts on the map (territory-layer.ts), and the paper of the player's outline. */
const EMBER: Rgb = [0xf2, 0x5c, 0x2a];
const PAPER: Rgb = [0xf5, 0xf2, 0xec];

/** A front stays lit this long on the minimap, which is drawn less often than the map. */
export const FRONT_MS = FRONT_SECONDS * 1000 * 2.5;

type Rgb = readonly [number, number, number];

/** Size of the image for a map: its width up to MAX_PIXELS, in the map's proportions. */
export function minimapSize(
  width: number,
  height: number,
  maxPixels = MAX_PIXELS,
): { readonly width: number; readonly height: number } {
  const across = Math.min(width, maxPixels);
  return { width: across, height: Math.max(1, Math.round((across * height) / width)) };
}

/** Red, green and blue of `#rrggbb`. */
export function rgbOf(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const SEA_SHALLOW = rgbOf(TERRAIN_COLORS.seaShallow);
const SEA_OPEN = rgbOf(MAP_COLORS.ocean);
const SEA_DEEP = rgbOf(MAP_COLORS.oceanDeep);

/**
 * Colour of the sea for the alpha of the ground texture, which holds the
 * signed distance to the coast (encodeCoast): shallow near the shore, then
 * open, then deep, as the map's shader shades it.
 */
export function seaColor(alpha: number, out: number[]): void {
  const reach = Math.min(1, (127.5 - alpha) / 127.5);
  const depth = reach * reach * COAST_REACH;
  const openness = smoothstep(0, 4, depth);
  const deepness = smoothstep(6, 36, depth);
  for (let c = 0; c < 3; c++) {
    const open = (SEA_SHALLOW[c] as number) * (1 - openness) + (SEA_OPEN[c] as number) * openness;
    out[c] = open * (1 - deepness) + (SEA_DEEP[c] as number) * deepness;
  }
}

/** What the image is made from. */
export interface MinimapSource {
  readonly width: number;
  readonly height: number;
  /** Ground colours of every tile, with the signed distance to the coast in alpha (terrain-colors.ts); sea and land by tile kind when left out. */
  readonly ground?: Uint8Array | undefined;
  /** TileKind of every tile, 0 for water. */
  readonly kinds: Uint8Array;
  readonly wrapsX: boolean;
}

/**
 * The map as a small picture: the ground, taken from the map's own baked
 * ground rather than computed again, and over it each owner's land, the
 * edges between owners, the player's outline and the fronts that moved lately.
 * It holds no canvas and no DOM, so the cost of a frame is one pass over its
 * pixels.
 */
export class MinimapImage {
  readonly width: number;
  readonly height: number;
  /** Ground only, made once. */
  private readonly base: Uint8ClampedArray<ArrayBuffer>;
  /** The pixels last drawn. */
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  /** Owner of each pixel, from the tiles it covers. */
  private readonly cells: Uint16Array;
  /** Where each pixel samples the tiles: the column and the row start of each of its sample points. */
  private readonly columns: Int32Array;
  private readonly rows: Int32Array;
  /** When each pixel's tiles last changed hands, in the caller's milliseconds, and whether it was the player's land at stake. */
  private readonly frontAt: Float64Array;
  private readonly frontYours: Uint8Array;
  /** When a front was last marked. */
  private lastFront = -Infinity;

  constructor(private readonly source: MinimapSource) {
    const { width, height } = minimapSize(source.width, source.height);
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.cells = new Uint16Array(width * height);
    this.frontAt = new Float64Array(width * height).fill(-Infinity);
    this.frontYours = new Uint8Array(width * height);
    const samples = (pixels: number, tiles: number, stride: number): Int32Array => {
      const out = new Int32Array(pixels * OWNER_SAMPLES);
      for (let p = 0; p < pixels; p++) {
        for (let s = 0; s < OWNER_SAMPLES; s++) {
          const at = Math.floor(((p + (s + 0.5) / OWNER_SAMPLES) * tiles) / pixels);
          out[p * OWNER_SAMPLES + s] = Math.min(tiles - 1, at) * stride;
        }
      }
      return out;
    };
    this.columns = samples(width, source.width, 1);
    this.rows = samples(height, source.height, source.width);
    this.base = this.bake();
  }

  /** The pixel a tile falls in. */
  private cellOf(tile: number): number {
    const { width: mapWidth, height: mapHeight } = this.source;
    const column = tile % mapWidth;
    const row = (tile - column) / mapWidth;
    const x = Math.min(this.width - 1, Math.floor((column * this.width) / mapWidth));
    const y = Math.min(this.height - 1, Math.floor((row * this.height) / mapHeight));
    return y * this.width + x;
  }

  /** A tile changed hands: its pixel lights as a front until FRONT_MS has passed. `yours`: the player gained or lost it. */
  markFront(tile: number, yours: boolean, now: number): void {
    const cell = this.cellOf(tile);
    const fresh = now - (this.frontAt[cell] as number) >= FRONT_MS;
    if (fresh || yours) this.frontYours[cell] = yours ? 1 : 0;
    this.frontAt[cell] = now;
    this.lastFront = now;
  }

  /** Whether any front may still be lit at `now`: the picture changes even if no tile does. */
  burning(now: number): boolean {
    return now - this.lastFront < FRONT_MS;
  }

  /** The ground of every pixel: the average of a few tiles under it, land and sea blended at the coast. */
  private bake(): Uint8ClampedArray<ArrayBuffer> {
    const { width: mapWidth, height: mapHeight, ground, kinds } = this.source;
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    const sea: number[] = [0, 0, 0];
    const landColor = rgbOf(MAP_COLORS.land);
    for (let py = 0; py < this.height; py++) {
      const y0 = Math.floor((py * mapHeight) / this.height);
      const y1 = Math.max(y0 + 1, Math.floor(((py + 1) * mapHeight) / this.height));
      const ny = Math.min(GROUND_SAMPLES, y1 - y0);
      for (let px = 0; px < this.width; px++) {
        const x0 = Math.floor((px * mapWidth) / this.width);
        const x1 = Math.max(x0 + 1, Math.floor(((px + 1) * mapWidth) / this.width));
        const nx = Math.min(GROUND_SAMPLES, x1 - x0);
        let landCount = 0;
        const land = [0, 0, 0];
        const water = [0, 0, 0];
        for (let sy = 0; sy < ny; sy++) {
          const row = Math.min(mapHeight - 1, y0 + Math.floor(((sy + 0.5) * (y1 - y0)) / ny));
          for (let sx = 0; sx < nx; sx++) {
            const column = Math.min(mapWidth - 1, x0 + Math.floor(((sx + 0.5) * (x1 - x0)) / nx));
            const tile = row * mapWidth + column;
            const alpha = ground ? (ground[tile * 4 + 3] as number) : kinds[tile] ? 255 : 0;
            if (alpha > 127) {
              landCount++;
              for (let c = 0; c < 3; c++) {
                land[c] =
                  (land[c] as number) +
                  (ground ? (ground[tile * 4 + c] as number) : (landColor[c] as number));
              }
            } else {
              seaColor(ground ? alpha : 0, sea);
              for (let c = 0; c < 3; c++) water[c] = (water[c] as number) + (sea[c] as number);
            }
          }
        }
        const count = nx * ny;
        const share = landCount / count;
        const at = (py * this.width + px) * 4;
        for (let c = 0; c < 3; c++) {
          const landAverage = landCount > 0 ? (land[c] as number) / landCount : 0;
          const seaAverage = count > landCount ? (water[c] as number) / (count - landCount) : 0;
          out[at + c] = landAverage * share + seaAverage * (1 - share);
        }
        out[at + 3] = 255;
      }
    }
    return out;
  }

  /**
   * Draws the picture for the owners as they are now. `palette` holds three
   * bytes per owner id; `you` is the player at this screen, outlined.
   */
  draw(owners: Uint16Array, palette: Uint8Array, you: number, now: number): void {
    const { width, height, cells, pixels, base } = this;
    const { columns, rows } = this;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        let owner = 0;
        for (let sy = 0; sy < OWNER_SAMPLES && owner === 0; sy++) {
          const row = rows[py * OWNER_SAMPLES + sy] as number;
          for (let sx = 0; sx < OWNER_SAMPLES; sx++) {
            owner = owners[row + (columns[px * OWNER_SAMPLES + sx] as number)] as number;
            if (owner !== 0) break;
          }
        }
        cells[py * width + px] = owner;
      }
    }
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const cell = py * width + px;
        const at = cell * 4;
        const owner = cells[cell] as number;
        let r = base[at] as number;
        let g = base[at + 1] as number;
        let b = base[at + 2] as number;
        if (owner !== 0) {
          const k = owner * 3;
          r += ((palette[k] as number) - r) * OWNED;
          g += ((palette[k + 1] as number) - g) * OWNED;
          b += ((palette[k + 2] as number) - b) * OWNED;
          const right = px + 1 < width ? (cells[cell + 1] as number) : owner;
          const below = py + 1 < height ? (cells[cell + width] as number) : owner;
          const left = px > 0 ? (cells[cell - 1] as number) : owner;
          const above = py > 0 ? (cells[cell - width] as number) : owner;
          if (owner === you) {
            if (right !== owner || below !== owner || left !== owner || above !== owner) {
              r += (PAPER[0] - r) * OUTLINE;
              g += (PAPER[1] - g) * OUTLINE;
              b += (PAPER[2] - b) * OUTLINE;
            }
          } else if (right !== owner || below !== owner) {
            r *= EDGE_DARK;
            g *= EDGE_DARK;
            b *= EDGE_DARK;
          }
        }
        pixels[at] = r;
        pixels[at + 1] = g;
        pixels[at + 2] = b;
        pixels[at + 3] = 255;
      }
    }
    if (this.burning(now)) this.lightFronts(now);
  }

  /** Fronts in ember over the picture: a plus shape for the player's, a dot for the others', fading as they age. */
  private lightFronts(now: number): void {
    const { width, height } = this;
    for (let cell = 0; cell < this.frontAt.length; cell++) {
      const age = now - (this.frontAt[cell] as number);
      if (!(age < FRONT_MS)) continue;
      const fade = 1 - age / FRONT_MS;
      const yours = this.frontYours[cell] === 1;
      const x = cell % width;
      const y = (cell - x) / width;
      this.tint(cell, (yours ? 0.95 : 0.75) * Math.sqrt(fade));
      if (!yours) continue;
      const weak = 0.55 * Math.sqrt(fade);
      if (x > 0) this.tint(cell - 1, weak);
      if (x + 1 < width) this.tint(cell + 1, weak);
      if (y > 0) this.tint(cell - width, weak);
      if (y + 1 < height) this.tint(cell + width, weak);
    }
  }

  private tint(cell: number, amount: number): void {
    const at = cell * 4;
    const { pixels } = this;
    for (let c = 0; c < 3; c++) {
      const value = pixels[at + c] as number;
      pixels[at + c] = value + ((EMBER[c] as number) - value) * amount;
    }
  }
}

/** A rectangle of the minimap, as shares of its width and height, 0 to 1. */
export interface ViewPiece {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The part of the map the camera shows, as one rectangle, or two where it
 * crosses the seam of a map that wraps east-west. A view wider or taller
 * than the map fills it.
 */
export function viewPieces(
  view: {
    readonly centerX: number;
    readonly centerY: number;
    readonly halfWidth: number;
    readonly halfHeight: number;
  },
  mapWidth: number,
  mapHeight: number,
): ViewPiece[] {
  const top = Math.max(0, view.centerY - view.halfHeight) / mapHeight;
  const bottom = Math.min(mapHeight, view.centerY + view.halfHeight) / mapHeight;
  const piece = (from: number, to: number): ViewPiece => ({
    left: from / mapWidth,
    top,
    width: (to - from) / mapWidth,
    height: bottom - top,
  });
  if (view.halfWidth * 2 >= mapWidth) return [piece(0, mapWidth)];
  const left = view.centerX - view.halfWidth;
  const right = view.centerX + view.halfWidth;
  if (left < 0) return [piece(0, right), piece(left + mapWidth, mapWidth)];
  if (right > mapWidth) return [piece(left, mapWidth), piece(0, right - mapWidth)];
  return [piece(left, right)];
}
