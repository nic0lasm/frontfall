import { describe, expect, it } from "vitest";
import { WorldGrid } from "../src/world-grid.ts";

describe("WorldGrid", () => {
  const grid = new WorldGrid(10, 5);

  it("wraps columns in both directions", () => {
    expect(grid.wrapX(10)).toBe(0);
    expect(grid.wrapX(-1)).toBe(9);
    expect(grid.wrapX(-21)).toBe(9);
  });

  it("round-trips coordinates through an index", () => {
    const index = grid.index(7, 3);
    expect([grid.x(index), grid.y(index)]).toEqual([7, 3]);
  });

  it("rejects rows beyond the poles", () => {
    expect(() => grid.index(0, -1)).toThrow(RangeError);
    expect(() => grid.index(0, 5)).toThrow(RangeError);
  });

  it("crosses the east-west seam", () => {
    expect(grid.neighbors(grid.index(9, 2))).toContain(grid.index(0, 2));
    expect(grid.neighbors(grid.index(0, 2))).toContain(grid.index(9, 2));
  });

  it("has no neighbours past the poles", () => {
    expect(grid.neighbors(grid.index(4, 0))).toHaveLength(3);
    expect(grid.neighbors(grid.index(4, 4))).toHaveLength(3);
    expect(grid.neighbors(grid.index(4, 2))).toHaveLength(4);
  });

  it("does not list the same tile twice on very narrow worlds", () => {
    expect(new WorldGrid(1, 3).neighbors(1)).toEqual([0, 2]);
    expect(new WorldGrid(2, 1).neighbors(0)).toEqual([1]);
  });

  it("measures distance the short way around", () => {
    expect(grid.distance(grid.index(0, 0), grid.index(9, 0))).toBe(1);
    expect(grid.distance(grid.index(1, 1), grid.index(6, 4))).toBe(8);
  });

  it("rejects invalid sizes", () => {
    expect(() => new WorldGrid(0, 5)).toThrow(RangeError);
    expect(() => new WorldGrid(3.5, 5)).toThrow(RangeError);
  });
});
