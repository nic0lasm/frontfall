import { describe, expect, it } from "vitest";
import {
  FRONT_MS,
  MinimapImage,
  minimapSize,
  rgbOf,
  viewPieces,
} from "../src/render/minimap-image.ts";

const view = (centerX: number, centerY: number, halfWidth: number, halfHeight: number) => ({
  centerX,
  centerY,
  halfWidth,
  halfHeight,
});

function image(width = 8, height = 4): { image: MinimapImage; owners: Uint16Array } {
  const kinds = new Uint8Array(width * height).fill(1);
  const minimap = new MinimapImage({ width, height, kinds, wrapsX: true });
  return { image: minimap, owners: new Uint16Array(width * height) };
}

const palette = new Uint8Array([0, 0, 0, 200, 0, 0, 0, 200, 0]);

function pixel(m: MinimapImage, x: number, y: number): number[] {
  const at = (y * m.width + x) * 4;
  return [...m.pixels.slice(at, at + 3)];
}

describe("minimap size", () => {
  it("keeps the map's proportions and a small map's own size", () => {
    expect(minimapSize(2048, 1024)).toEqual({ width: 400, height: 200 });
    expect(minimapSize(192, 96)).toEqual({ width: 192, height: 96 });
    expect(minimapSize(1000, 1)).toEqual({ width: 400, height: 1 });
  });

  it("reads colours", () => {
    expect(rgbOf("#f25c2a")).toEqual([0xf2, 0x5c, 0x2a]);
  });
});

describe("minimap picture", () => {
  it("shows the sea where the ground has none and land where it does", () => {
    const land = new MinimapImage({
      width: 2,
      height: 2,
      kinds: new Uint8Array([1, 0, 1, 0]),
      wrapsX: false,
    });
    land.draw(new Uint16Array(4), palette, 1, 0);
    expect(pixel(land, 0, 0)).not.toEqual(pixel(land, 1, 0));
  });

  it("colours an owner's land and darkens the edge between owners", () => {
    const { image: m, owners } = image();
    owners.fill(1, 0, 4);
    owners.fill(1, 8, 12);
    owners.fill(1, 16, 20);
    owners.fill(1, 24, 28);
    owners.fill(2, 4, 8);
    m.draw(owners, palette, 9, 0);
    const bare = pixel(image().image, 0, 0);
    const inside = pixel(m, 1, 1);
    expect(inside[0]).toBeGreaterThan(bare[0] as number);
    // The pixel at the border of player 1 and 2 is darker than one inside.
    expect(pixel(m, 3, 1)[0]).toBeLessThan(inside[0] as number);
  });

  it("outlines the player's land in paper", () => {
    const { image: m, owners } = image();
    owners.fill(1);
    owners.fill(0, 0, 8);
    m.draw(owners, palette, 1, 0);
    expect(pixel(m, 3, 1)[1]).toBeGreaterThan(200);
    expect(pixel(m, 3, 2)[1]).toBeLessThan(200);
  });

  it("lights a front in ember, then lets it go out", () => {
    const { image: m, owners } = image();
    owners.fill(1);
    m.draw(owners, palette, 1, 0);
    const before = pixel(m, 2, 1);
    m.markFront(1 * 8 + 2, true, 1000);
    expect(m.burning(1000)).toBe(true);
    m.draw(owners, palette, 1, 1000);
    expect(pixel(m, 2, 1)[0]).toBeGreaterThan(before[0] as number);
    expect(pixel(m, 2, 1)[1]).not.toEqual(before[1]);
    expect(m.burning(1000 + FRONT_MS)).toBe(false);
    m.draw(owners, palette, 1, 1000 + FRONT_MS);
    expect(pixel(m, 2, 1)).toEqual(before);
  });
});

describe("view pieces", () => {
  it("is one rectangle inside the map", () => {
    const [piece, ...rest] = viewPieces(view(50, 50, 10, 5), 100, 100);
    expect(rest).toEqual([]);
    expect(piece?.left).toBeCloseTo(0.4);
    expect(piece?.top).toBeCloseTo(0.45);
    expect(piece?.width).toBeCloseTo(0.2);
    expect(piece?.height).toBeCloseTo(0.1);
  });

  it("splits across the seam of a wrapping map", () => {
    const pieces = viewPieces(view(5, 50, 10, 10), 100, 100);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ left: 0, width: 0.15 });
    expect(pieces[1]).toMatchObject({ left: 0.95 });
    expect(viewPieces(view(95, 50, 10, 10), 100, 100)).toHaveLength(2);
  });

  it("fills the map when the view is wider or taller than it", () => {
    expect(viewPieces(view(50, 50, 80, 80), 100, 100)).toEqual([
      { left: 0, top: 0, width: 1, height: 1 },
    ]);
  });
});
