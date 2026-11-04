import { describe, expect, it } from "vitest";
import { bakePremiumGround, snowLine } from "../src/premium/bake.ts";
import { bilinear, gaussianBlur, nearestInside, valueNoise } from "../src/premium/raster.ts";
import { mercatorPixel, terrariumMetres } from "../src/premium/terrarium.ts";

describe("premium ground", () => {
  it("reads Terrarium metres and places points on the Mercator plane", () => {
    expect(terrariumMetres(128, 0, 0)).toBe(0);
    expect(terrariumMetres(128, 100, 128)).toBe(100.5);
    expect(terrariumMetres(127, 0, 0)).toBe(-256);
    const origin = mercatorPixel(0, 0, 0);
    expect(origin.x).toBeCloseTo(128);
    expect(origin.y).toBeCloseTo(128);
    // Past the end of Web Mercator a latitude reads the edge of the world.
    expect(mercatorPixel(-180, 90, 1).y).toBeCloseTo(0, 3);
  });

  it("blurs without moving the mean, and wraps east to west on a cylinder", () => {
    const grid = { width: 16, height: 8, wrapsX: true };
    const data = new Float32Array(128);
    data[3 * 16] = 128;
    gaussianBlur(data, grid, 1.5);
    const sum = data.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(128, 3);
    // The spike sat on column 0: its blur reaches the last column.
    expect(data[3 * 16 + 15]).toBeGreaterThan(1);
    expect(data[3 * 16 + 15]).toBeCloseTo(data[3 * 16 + 1] as number, 5);
  });

  it("finds the nearest texel inside, and samples between texel centres", () => {
    const grid = { width: 5, height: 1, wrapsX: false };
    const nearest = nearestInside(Uint8Array.from([0, 1, 0, 0, 1]), grid);
    expect([...nearest]).toEqual([1, 1, 1, 4, 4]);
    expect(bilinear([0, 10, 20, 30, 40], grid, 1.5, 0.5)).toBeCloseTo(10);
    expect(bilinear([0, 10, 20, 30, 40], grid, 2, 0.5)).toBeCloseTo(15);
  });

  it("makes noise that repeats across a map that wraps", () => {
    for (const y of [0, 7.5, 33]) {
      expect(valueNoise(0, y, 16, 1, 256)).toBeCloseTo(valueNoise(256, y, 16, 1, 256), 6);
    }
    expect(Math.abs(valueNoise(5, 5, 16, 1, 256))).toBeLessThanOrEqual(1);
  });

  it("lowers the snow line toward the poles", () => {
    expect(snowLine(0)).toBe(5000);
    expect(snowLine(46)).toBeGreaterThan(2500);
    expect(snowLine(46)).toBeLessThan(3200);
    expect(snowLine(-70)).toBeLessThan(snowLine(-46));
  });

  it("lights a mountain's north-west side and fills each texture past the coast", () => {
    // An island of 6 × 6 tiles in a sea of 12 × 12, a peak in its middle.
    const width = 12;
    const height = 12;
    const kinds = new Uint8Array(width * height);
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) kinds[y * width + x] = 1;
    const ground = bakePremiumGround(
      {
        width,
        height,
        wrapsX: false,
        kinds,
        ice: new Uint8Array(width * height),
        west: 0,
        east: 1.2,
        south: 44,
        north: 45.2,
      },
      2,
      (lon, lat) => {
        const d = Math.hypot(lon - 0.6, lat - 44.6);
        return d < 0.3 ? 2000 * (1 - d / 0.3) : -200;
      },
    );
    expect(ground.width).toBe(24);
    const at = (bytes: Uint8Array, x: number, y: number, c: number): number =>
      bytes[(y * 24 + x) * 4 + c] as number;
    // North-west of the peak is lit more than south-east of it.
    expect(at(ground.land, 10, 10, 3)).toBeGreaterThan(at(ground.land, 13, 13, 3));
    // The land texture holds land colours out at sea, and the sea texture sea colours on land.
    expect(at(ground.land, 0, 0, 3)).toBeGreaterThan(0);
    expect(at(ground.sea, 12, 12, 3)).toBe(255);
    expect(at(ground.sea, 12, 12, 2)).toBeGreaterThan(at(ground.sea, 12, 12, 0));
  });
});
