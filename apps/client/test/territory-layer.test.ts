import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { seaDepths, TerritoryLayer } from "../src/render/territory-layer.ts";

function layer(width = 256, height = 4, maxOwner = 3): TerritoryLayer {
  return new TerritoryLayer({
    width,
    height,
    owners: new Uint16Array(width * height),
    terrain: new Uint8Array(width * height),
    maxOwner,
  });
}

/** Update ranges as [row, first column, texel count]. */
function ranges(territory: TerritoryLayer): [number, number, number][] {
  const { width } = territory.options;
  return territory.ownerTexture.updateRanges.map(({ start, count }) => {
    const texel = start / 4;
    return [Math.floor(texel / width), texel % width, count / 4];
  });
}

describe("TerritoryLayer", () => {
  it("aliases the owner array instead of copying it", () => {
    const owners = new Uint16Array(8);
    const territory = new TerritoryLayer({
      width: 4,
      height: 2,
      owners,
      terrain: new Uint8Array(8),
      maxOwner: 1,
    });
    expect(territory.ownerTexture.image.data).toBe(owners);
  });

  it("uploads only the chunks that changed", () => {
    // 256 columns in 32 chunks of 64... rounded up to the 64-column minimum: 4 chunks.
    const territory = layer();
    territory.markChanged([3, 70, 256 * 2 + 255]);
    expect(territory.flush()).toBe(64 * 3);
    expect(ranges(territory)).toEqual([
      [0, 0, 128],
      [2, 192, 64],
    ]);
  });

  it("merges neighbouring dirty chunks of a row into one range", () => {
    const territory = layer();
    territory.markChanged([0, 64, 128, 255]);
    territory.flush();
    expect(ranges(territory)).toEqual([[0, 0, 256]]);
  });

  it("clips the last chunk to the map width", () => {
    const territory = layer(100, 2);
    territory.markChanged([99]);
    expect(territory.flush()).toBe(36);
    expect(ranges(territory)).toEqual([[0, 64, 36]]);
  });

  it("forgets changes once flushed", () => {
    const territory = layer();
    territory.markChanged([5]);
    territory.flush();
    territory.ownerTexture.clearUpdateRanges();
    expect(territory.flush()).toBe(0);
    expect(ranges(territory)).toEqual([]);
  });

  it("falls back to a full upload", () => {
    const territory = layer();
    territory.markChanged([5]);
    territory.markAllChanged();
    expect(territory.flush()).toBe(256 * 4);
    expect(territory.ownerTexture.updateRanges).toHaveLength(0);
  });

  it("stores owner colours in sRGB", () => {
    const territory = layer();
    territory.setOwnerColor(2, 0xff8000);
    const data = territory.paletteTexture.image.data as Uint8Array;
    expect(Array.from(data.subarray(8, 12))).toEqual([255, 128, 0, 255]);
    expect(() => {
      territory.setOwnerColor(0, 0);
    }).toThrow(RangeError);
    expect(() => {
      territory.setOwnerColor(4, 0);
    }).toThrow(RangeError);
  });

  it("sizes the palette to the number of owners", () => {
    expect(layer(4, 2, 255).paletteTexture.image.height).toBe(1);
    expect(layer(4, 2, 256).paletteTexture.image.height).toBe(2);
  });

  it("accounts for its GPU memory, the ground's mipmaps included", () => {
    expect(layer(512, 256, 64).gpuBytes()).toBe(Math.round(512 * 256 * (2 + 16 / 3 + 4)) + 256 * 4);
  });

  it("draws the flat map from square tiles, without filtering or mipmaps", () => {
    const flat = new TerritoryLayer({
      width: 512,
      height: 256,
      owners: new Uint16Array(512 * 256),
      terrain: new Uint8Array(512 * 256),
      maxOwner: 64,
      flat: true,
    });
    expect(flat.mesh.material.defines).toEqual({ FLAT: 1 });
    expect(flat.groundTexture.magFilter).toBe(THREE.NearestFilter);
    expect(flat.groundTexture.generateMipmaps).toBe(false);
    expect(flat.gpuBytes()).toBe(512 * 256 * 10 + 256 * 4);
    expect(layer().groundTexture.magFilter).toBe(THREE.LinearFilter);
    flat.dispose();
  });

  it("draws the three copies of the world with one mesh", () => {
    const territory = layer(10, 4);
    territory.mesh.geometry.computeBoundingBox();
    const box = territory.mesh.geometry.boundingBox ?? new THREE.Box3();
    expect([box.min.x, box.max.x, box.min.y, box.max.y]).toEqual([-10, 20, 0, 4]);
    territory.dispose();
  });

  it("draws a flat map once", () => {
    const territory = new TerritoryLayer({
      width: 10,
      height: 4,
      owners: new Uint16Array(40),
      terrain: new Uint8Array(40),
      wrapsX: false,
      maxOwner: 1,
    });
    territory.mesh.geometry.computeBoundingBox();
    const box = territory.mesh.geometry.boundingBox ?? new THREE.Box3();
    expect([box.min.x, box.max.x]).toEqual([0, 10]);
    expect(territory.mesh.material.uniforms.wrapsX?.value).toBe(false);
    territory.dispose();
  });

  it("rejects arrays of the wrong size", () => {
    expect(
      () =>
        new TerritoryLayer({
          width: 4,
          height: 2,
          owners: new Uint16Array(7),
          terrain: new Uint8Array(8),
          maxOwner: 1,
        }),
    ).toThrow(RangeError);
  });

  it("flags allies in the palette's alpha, and keeps the flag across colour changes", () => {
    const territory = layer();
    const data = territory.paletteTexture.image.data as Uint8Array;
    territory.setAllies([2]);
    expect([data[7], data[11], data[15]]).toEqual([255, 128, 255]);
    territory.setOwnerColor(2, 0x00ff00);
    expect(data[11]).toBe(128);
    territory.setAllies([]);
    expect(data[11]).toBe(255);
  });

  it("scorches the land under fallout and restores it when the zone clears (R-UNIT-06)", () => {
    const width = 8;
    const terrain = new Uint8Array(width * 8).fill(1);
    terrain[3 * width + 3] = 0;
    const territory = new TerritoryLayer({
      width,
      height: 8,
      owners: new Uint16Array(width * 8),
      terrain,
      wrapsX: false,
      maxOwner: 1,
    });
    const data = territory.groundTexture.image.data as Uint8Array;
    const before = data.slice();
    const zone = [{ x: 3, y: 3, radius: 1 }];
    expect(territory.setFallout(zone)).toBe(true);
    expect(territory.setFallout(zone)).toBe(false);
    const changed = (tile: number): boolean =>
      [0, 1, 2].some((c) => data[tile * 4 + c] !== before[tile * 4 + c]);
    // The four neighbours burn; the water at the centre and the corners outside the disc do not.
    expect([2 * width + 3, 4 * width + 3, 3 * width + 2, 3 * width + 4].map(changed)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(changed(3 * width + 3)).toBe(false);
    expect(changed(2 * width + 2)).toBe(false);
    expect(territory.setFallout([])).toBe(true);
    expect(Array.from(data)).toEqual(Array.from(before));
  });

  it("sends only the rectangle that fallout changed once the ground is on the GPU", () => {
    const width = 8;
    const territory = new TerritoryLayer({
      width,
      height: 8,
      owners: new Uint16Array(width * 8),
      terrain: new Uint8Array(width * 8).fill(1),
      wrapsX: false,
      maxOwner: 1,
    });
    const texture = territory.groundTexture;
    const sub = vi.fn();
    const mipmap = vi.fn();
    const gl = {
      texSubImage2D: sub,
      generateMipmap: mipmap,
      TEXTURE_2D: 1,
      RGBA: 2,
      UNSIGNED_BYTE: 3,
    };
    const renderer = {
      getContext: () => gl,
      state: { pixelStorei: vi.fn(), bindTexture: vi.fn() },
      properties: { get: () => ({ __webglTexture: {}, __version: texture.version }) },
    } as unknown as THREE.WebGLRenderer;
    const version = texture.version;
    territory.setFallout([{ x: 3, y: 3, radius: 1 }]);
    territory.flush(renderer);
    // The disc of radius 1 covers columns 2 to 4 and rows 2 to 4; nothing else is sent.
    expect(sub).toHaveBeenCalledTimes(1);
    const args = sub.mock.calls[0] as unknown[];
    expect(args.slice(1, 6)).toEqual([0, 2, 2, 3, 3]);
    expect((args[8] as Uint8Array).length).toBe(3 * 3 * 4);
    expect(mipmap).toHaveBeenCalledTimes(1);
    expect(texture.version).toBe(version);
    // Without the renderer, or before the ground is on the GPU, three.js sends it all.
    territory.setFallout([]);
    territory.flush();
    expect(texture.version).toBe(version + 1);
  });

  it("bakes a map's ground once, and gives a later layer the ground clean of fallout", () => {
    const terrain = new Uint8Array(64).fill(1);
    const make = (): TerritoryLayer =>
      new TerritoryLayer({
        width: 8,
        height: 8,
        owners: new Uint16Array(64),
        terrain,
        wrapsX: false,
        maxOwner: 1,
      });
    const first = make();
    const clean = (first.groundTexture.image.data as Uint8Array).slice();
    const second = make();
    expect(second.groundTexture.image.data).toBe(first.groundTexture.image.data);
    expect(second.heightTexture.image.data).toBe(first.heightTexture.image.data);
    second.setFallout([{ x: 3, y: 3, radius: 2 }]);
    expect(Array.from(second.groundTexture.image.data as Uint8Array)).not.toEqual(
      Array.from(clean),
    );
    const third = make();
    expect(Array.from(third.groundTexture.image.data as Uint8Array)).toEqual(Array.from(clean));
  });

  it("wraps fallout across the edge of a cylinder, and clips it on a flat map", () => {
    const wrapping = new TerritoryLayer({
      width: 8,
      height: 4,
      owners: new Uint16Array(32),
      terrain: new Uint8Array(32).fill(1),
      maxOwner: 1,
    });
    const data = wrapping.groundTexture.image.data as Uint8Array;
    const before = data.slice();
    wrapping.setFallout([{ x: 0, y: 0, radius: 1 }]);
    expect(data[(0 * 8 + 7) * 4]).not.toBe(before[(0 * 8 + 7) * 4]);
    const flat = new TerritoryLayer({
      width: 8,
      height: 4,
      owners: new Uint16Array(32),
      terrain: new Uint8Array(32).fill(1),
      wrapsX: false,
      maxOwner: 1,
    });
    const flatData = flat.groundTexture.image.data as Uint8Array;
    const flatBefore = flatData.slice();
    flat.setFallout([{ x: 0, y: 0, radius: 1 }]);
    expect(flatData[7 * 4]).toBe(flatBefore[7 * 4]);
  });

  it("passes the highlight, hover, motion, time and globe pose to the shader", () => {
    const territory = layer();
    const { uniforms } = territory.mesh.material;
    territory.setHighlight(2);
    territory.setHovered(3);
    territory.setMotion(false);
    territory.setTime(12.5);
    expect([
      uniforms.highlight?.value,
      uniforms.hovered?.value,
      uniforms.frontMotion?.value,
      uniforms.now?.value,
    ]).toEqual([2, 3, 0, 12.5]);
    territory.setMotion(true);
    expect(uniforms.frontMotion?.value).toBe(1);
    territory.setGlobePose({
      position: [0, 0, 5],
      forward: [0, 0, -1],
      right: [1, 0, 0],
      up: [0, 1, 0],
    });
    territory.dispose();
  });
});

describe("seaDepths", () => {
  it("is zero everywhere on a map without bathymetry", () => {
    const terrain = new Uint8Array([0, 0, 1, 0]);
    expect([...seaDepths(terrain, undefined, 2, false)]).toEqual([0, 0, 0, 0]);
    expect([...seaDepths(terrain, new Uint8Array(4), 2, false)]).toEqual([0, 0, 0, 0]);
  });

  it("turns the depth bands of the water into a smooth slope, land counting as shelf", () => {
    // One row: land on the west, the shelf, then the abyss to the east.
    const width = 40;
    const terrain = new Uint8Array(width);
    const relief = new Uint8Array(width);
    terrain[0] = 1;
    relief[0] = 12;
    for (let x = 20; x < width; x++) relief[x] = 24;
    const depths = seaDepths(terrain, relief, width, false);
    expect(depths[0]).toBe(0);
    expect(depths[width - 1]).toBe(255);
    // No step between neighbours larger than the blur allows.
    for (let x = 1; x < width; x++) {
      expect(Math.abs((depths[x] as number) - (depths[x - 1] as number))).toBeLessThan(60);
      expect(depths[x] as number).toBeGreaterThanOrEqual(depths[x - 1] as number);
    }
  });

  it("wraps the blur across the seam of a map that wraps", () => {
    const width = 20;
    const terrain = new Uint8Array(width);
    const relief = new Uint8Array(width);
    relief[0] = 24;
    const depths = seaDepths(terrain, relief, width, true);
    expect(depths[width - 1]).toBe(depths[1]);
    expect(depths[width - 1] as number).toBeGreaterThan(0);
  });
});
