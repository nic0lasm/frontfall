import { describe, expect, it } from "vitest";
import { Random } from "../src/random.ts";
import { NEUTRAL, TerritoryMap } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";

function bordersOf(map: TerritoryMap, player: number): number[] {
  const tiles: number[] = [];
  for (let i = 0; i < map.borderCount(player); i++) tiles.push(map.borderTile(player, i));
  return tiles.sort((a, b) => a - b);
}

/** Border tiles recomputed from scratch, to check the incremental lists against. */
function expectedBorders(map: TerritoryMap, player: number): number[] {
  const tiles: number[] = [];
  for (let tile = 0; tile < map.grid.size; tile++) {
    if (map.ownerOf(tile) !== player) continue;
    if (map.grid.neighbors(tile).some((n) => map.ownerOf(n) !== player)) tiles.push(tile);
  }
  return tiles;
}

describe("TerritoryMap", () => {
  it("starts fully neutral", () => {
    const map = new TerritoryMap(new WorldGrid(8, 4), 3);
    expect(map.tileCount(NEUTRAL)).toBe(32);
    expect(map.tileCount(1)).toBe(0);
    expect(map.borderCount(1)).toBe(0);
    expect(map.ownerOf(5)).toBe(NEUTRAL);
  });

  it("remembers who last took a tile from each player", () => {
    const map = new TerritoryMap(new WorldGrid(8, 4), 3);
    map.setOwner(0, 1);
    map.setOwner(1, 1);
    expect(map.lastTakerOf(1)).toBe(NEUTRAL);
    map.setOwner(0, 2);
    expect(map.lastTakerOf(1)).toBe(2);
    map.setOwner(1, NEUTRAL);
    expect([map.lastTakerOf(1), map.lastTakerOf(2)]).toEqual([NEUTRAL, NEUTRAL]);
  });

  it("counts tiles per owner", () => {
    const map = new TerritoryMap(new WorldGrid(8, 4), 3);
    map.setOwner(0, 1);
    map.setOwner(1, 1);
    map.setOwner(1, 2);
    map.setOwner(1, 2);
    expect([map.tileCount(NEUTRAL), map.tileCount(1), map.tileCount(2)]).toEqual([30, 1, 1]);
  });

  it("drops interior tiles from the border", () => {
    const grid = new WorldGrid(8, 5);
    const map = new TerritoryMap(grid, 1);
    for (let y = 1; y <= 3; y++) for (let x = 2; x <= 4; x++) map.setOwner(grid.index(x, y), 1);
    expect(map.isBorder(grid.index(3, 2))).toBe(false);
    expect(map.borderCount(1)).toBe(8);
    expect(bordersOf(map, 1)).toEqual(expectedBorders(map, 1));
  });

  it("treats the east-west seam like any other edge", () => {
    const grid = new WorldGrid(4, 3);
    const map = new TerritoryMap(grid, 1);
    // A full ring around the world: no east or west border, only north and south.
    for (let x = 0; x < 4; x++) map.setOwner(grid.index(x, 1), 1);
    expect(map.borderCount(1)).toBe(4);
    for (let x = 0; x < 4; x++) map.setOwner(grid.index(x, 0), 1);
    expect(map.borderCount(1)).toBe(4);
    expect(bordersOf(map, 1)).toEqual([4, 5, 6, 7]);
  });

  it("does not count the poles as a border", () => {
    const grid = new WorldGrid(3, 1);
    const map = new TerritoryMap(grid, 1);
    for (let x = 0; x < 3; x++) map.setOwner(x, 1);
    expect(map.borderCount(1)).toBe(0);
  });

  it("matches a full recount after random captures", () => {
    const grid = new WorldGrid(24, 12);
    const map = new TerritoryMap(grid, 4);
    const random = new Random(7);
    for (let step = 0; step < 3000; step++) {
      map.setOwner(random.nextInt(0, grid.size), random.nextInt(0, 5));
    }
    for (let player = 1; player <= 4; player++) {
      expect(bordersOf(map, player)).toEqual(expectedBorders(map, player));
    }
    expect(map.borderCount(NEUTRAL)).toBe(0);
  });

  it("orders border lists the same way for the same history", () => {
    const run = (): number[] => {
      const map = new TerritoryMap(new WorldGrid(16, 8), 2);
      const random = new Random(99);
      for (let step = 0; step < 500; step++)
        map.setOwner(random.nextInt(0, 128), random.nextInt(1, 3));
      return Array.from({ length: map.borderCount(1) }, (_, i) => map.borderTile(1, i));
    };
    expect(run()).toEqual(run());
  });

  it("logs changed tiles until cleared", () => {
    const map = new TerritoryMap(new WorldGrid(8, 4), 2);
    map.setOwner(3, 1);
    map.setOwner(3, 1);
    map.setOwner(9, 2);
    expect(Array.from(map.changes())).toEqual([3, 9]);
    map.clearChanges();
    expect(map.changes()).toHaveLength(0);
  });

  it("reports an overflowing change log", () => {
    const map = new TerritoryMap(new WorldGrid(8, 4), 1, 2);
    for (const tile of [0, 1, 2]) map.setOwner(tile, 1);
    expect(map.changes()).toHaveLength(2);
    expect(map.changesOverflowed).toBe(true);
    map.clearChanges();
    expect(map.changesOverflowed).toBe(false);
  });

  it("accounts for its memory", () => {
    const map = new TerritoryMap(new WorldGrid(64, 32), 2, 16);
    // Owners and border slots dominate: 2 + 4 bytes per tile.
    expect(map.memoryBytes()).toBe(64 * 32 * 6 + 3 * 4 + 3 * 4 + 16 * 4 + 3 * 16 * 4);
  });

  it("rejects bad arguments", () => {
    const map = new TerritoryMap(new WorldGrid(4, 2), 2);
    expect(() => {
      map.setOwner(8, 1);
    }).toThrow(RangeError);
    expect(() => {
      map.setOwner(-1, 1);
    }).toThrow(RangeError);
    expect(() => {
      map.setOwner(0, 3);
    }).toThrow(RangeError);
    expect(() => map.ownerOf(1.5)).toThrow(RangeError);
    expect(() => map.borderTile(1, 0)).toThrow(RangeError);
    expect(() => new TerritoryMap(new WorldGrid(4, 2), 0)).toThrow(RangeError);
    expect(() => new TerritoryMap(new WorldGrid(4, 2), 0x10000)).toThrow(RangeError);
    expect(() => new TerritoryMap(new WorldGrid(4, 2), 1, 0)).toThrow(RangeError);
  });
});
