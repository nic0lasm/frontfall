import { describe, expect, it } from "vitest";
import {
  BUILDING_KINDS,
  levelFor,
  outline,
  parts,
  partsAt,
  type BuildingKind,
  type Level,
  type Point,
} from "../src/render/pieces-geo.ts";

const SIZES = [16, 20, 24] as const;
const SAMPLES = 4;
/** The local box every piece fits in, drawn square. */
const BOX = { x: -56, y: -104, side: 112 };

function inside(polygon: readonly Point[], x: number, y: number): boolean {
  let odd = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i] as Point;
    const [xj, yj] = polygon[j] as Point;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}

/** How much of each pixel of a `size`-px square the piece covers, 0 to 1. */
function coverage(kind: BuildingKind, size: number, level: Level = 0): Float32Array {
  const outlines = partsAt(kind, level).map(outline);
  const grid = new Float32Array(size * size);
  const step = BOX.side / (size * SAMPLES);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = BOX.x + (px * SAMPLES + sx + 0.5) * step;
          const y = BOX.y + (py * SAMPLES + sy + 0.5) * step;
          if (outlines.some((o) => inside(o, x, y))) hits++;
        }
      }
      grid[py * size + px] = hits / (SAMPLES * SAMPLES);
    }
  }
  return grid;
}

/** Intersection over union of two coverages: 1 for the same shape, near 0 for unrelated ones. */
function overlap(a: Float32Array, b: Float32Array): number {
  let both = 0;
  let either = 0;
  a.forEach((v, i) => {
    const w = b[i] ?? 0;
    both += Math.min(v, w);
    either += Math.max(v, w);
  });
  return both / either;
}

/** How far the skyline is from being its own mirror image, 0 (even) to 1: heights of the columns against their mirror columns. */
function lopsidedness(kind: BuildingKind, size: number): number {
  const grid = coverage(kind, size);
  const heights = Array.from({ length: size }, (_, x) => {
    let rows = 0;
    for (let y = 0; y < size; y++) if ((grid[y * size + x] ?? 0) > 0.5) rows++;
    return rows;
  });
  const first = heights.findIndex((h) => h > 0);
  const last = heights.findLastIndex((h) => h > 0);
  let apart = 0;
  let total = 0;
  for (let x = first; x <= last; x++) {
    const here = heights[x] ?? 0;
    const there = heights[first + last - x] ?? 0;
    apart += Math.abs(here - there);
    total += Math.max(here, there);
  }
  return apart / total;
}

describe("pieces geometry", () => {
  it("describes the eight buildings, each with parts kept at every level", () => {
    expect(BUILDING_KINDS).toHaveLength(8);
    for (const kind of BUILDING_KINDS) {
      expect(partsAt(kind, 0).length, kind).toBeGreaterThan(0);
      expect(partsAt(kind, 1).length, kind).toBeGreaterThan(partsAt(kind, 0).length - 1);
      expect(partsAt(kind, 2)).toHaveLength(parts(kind).length);
    }
  });

  it("chooses the level of detail from the size on screen", () => {
    expect([16, 29, 30, 69, 70, 200].map(levelFor)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("keeps the same silhouette when the details are added", () => {
    for (const kind of BUILDING_KINDS) {
      const coarse = coverage(kind, 24, 0);
      const fine = coverage(kind, 24, 2);
      expect(overlap(coarse, fine), kind).toBeGreaterThan(0.93);
    }
  });

  it("draws nothing finer than the first level can show in its silhouette", () => {
    for (const kind of BUILDING_KINDS) {
      for (const op of partsAt(kind, 0)) {
        // Fronts only: the sides and tops of a block are thin by construction.
        if (op.kind !== "polygon" || !op.role.endsWith("F")) continue;
        const xs = op.points.map(([x]) => x);
        const ys = op.points.map(([, y]) => y);
        const width = Math.max(...xs) - Math.min(...xs);
        const height = Math.max(...ys) - Math.min(...ys);
        expect(Math.min(width, height), `${kind} ${op.role}`).toBeGreaterThanOrEqual(2.5);
      }
    }
  });

  it.each(SIZES)("tells the eight silhouettes apart at %i px", (size) => {
    const grids = BUILDING_KINDS.map((kind) => coverage(kind, size));
    for (let i = 0; i < grids.length; i++) {
      for (let j = i + 1; j < grids.length; j++) {
        const value = overlap(grids[i] as Float32Array, grids[j] as Float32Array);
        expect(
          value,
          `${BUILDING_KINDS[i] as string} / ${BUILDING_KINDS[j] as string}`,
        ).toBeLessThan(0.8);
      }
    }
  });

  it.each(SIZES)("keeps the city, the fort and the palace clearly apart at %i px", (size) => {
    const [city, fort, palace] = (["city", "fort", "palace"] as const).map((kind) =>
      coverage(kind, size),
    );
    expect(overlap(city as Float32Array, fort as Float32Array)).toBeLessThan(0.66);
    expect(overlap(city as Float32Array, palace as Float32Array)).toBeLessThan(0.7);
    expect(overlap(fort as Float32Array, palace as Float32Array)).toBeLessThan(0.7);
  });

  it("makes the city lopsided, the palace and the fort even", () => {
    expect(lopsidedness("city", 48)).toBeGreaterThan(0.25);
    expect(lopsidedness("palace", 48)).toBeLessThan(0.15);
    expect(lopsidedness("fort", 48)).toBeLessThan(0.15);
  });

  it("makes the fort low and wide and the city tall and narrow", () => {
    const rows = (kind: BuildingKind): number => {
      const grid = coverage(kind, 24);
      let top = 24;
      grid.forEach((v, i) => {
        if (v > 0.5) top = Math.min(top, Math.floor(i / 24));
      });
      return 24 - top;
    };
    expect(rows("fort")).toBeLessThan(rows("city") - 3);
    expect(rows("palace")).toBeGreaterThan(rows("fort"));
  });
});
