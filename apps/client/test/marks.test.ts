import { describe, expect, it } from "vitest";
import { STRUCTURE_COLORS } from "../src/palette.ts";
import {
  STRUCTURE_CAPACITY,
  STRUCTURE_TYPES,
  placeMarks,
  placeOutlinedAll,
  sortShips,
  structuresOfType,
  type MarkSink,
} from "../src/render/marks.ts";
import type { StructureMark, UnitMark } from "../src/render/renderer.ts";

function sink(): MarkSink & { writes: [number, number, number, string][] } {
  const writes: [number, number, number, string][] = [];
  return {
    count: -1,
    writes,
    set(index, x, y, color) {
      writes.push([index, x, y, color]);
    },
  };
}

const unit = (x: number, extra: Partial<UnitMark> = {}): UnitMark => ({
  x,
  y: 0,
  color: "#111111",
  ...extra,
});

describe("sortShips", () => {
  const units = [
    unit(1),
    unit(2, { kind: "trade" }),
    unit(3, { kind: "warship" }),
    unit(4, { kind: "missile" }),
    unit(5, { kind: "heavyMissile" }),
    unit(6),
    unit(7, { kind: "warship", state: "sinking" }),
  ];

  it("sorts by kind, keeps the order, and leaves out ships leaving the sea", () => {
    const sorted = sortShips(units);
    expect(sorted.transports.map((ship) => ship.x)).toEqual([1, 6]);
    expect(sorted.trade.map((ship) => ship.x)).toEqual([2]);
    expect(sorted.warships.map((ship) => ship.x)).toEqual([3]);
    expect(sorted.missiles.map((ship) => ship.x)).toEqual([4]);
    expect(sorted.heavyMissiles.map((ship) => ship.x)).toEqual([5]);
  });

  it("can leave the missiles to the effects", () => {
    const sorted = sortShips(units, true);
    expect(sorted.missiles).toEqual([]);
    expect(sorted.heavyMissiles).toEqual([]);
    expect(sorted.transports).toHaveLength(2);
  });
});

describe("placeMarks", () => {
  it("writes the marks, sets the count and returns it", () => {
    const layer = sink();
    expect(placeMarks(layer, [unit(1), unit(2)], 10)).toBe(2);
    expect(layer.count).toBe(2);
    expect(layer.writes).toEqual([
      [0, 1, 0, "#111111"],
      [1, 2, 0, "#111111"],
    ]);
  });

  it("stops at the capacity and can paint every mark one colour", () => {
    const layer = sink();
    placeMarks(layer, [unit(1), unit(2), unit(3)], 2, "#ffffff");
    expect(layer.count).toBe(2);
    expect(layer.writes.map((write) => write[3])).toEqual(["#ffffff", "#ffffff"]);
  });

  it("does nothing for a layer the view does not have", () => {
    expect(placeMarks(undefined, [unit(1)], 10)).toBe(0);
  });
});

describe("structures", () => {
  const structure = (type: StructureMark["type"], ready: boolean): StructureMark => ({
    x: 4,
    y: 5,
    type,
    ready,
  });

  it("lists every type once", () => {
    expect(new Set(STRUCTURE_TYPES).size).toBe(STRUCTURE_TYPES.length);
  });

  it("picks the structures of one type", () => {
    const all = [structure("city", true), structure("fort", true), structure("city", false)];
    expect(structuresOfType(all, "city")).toHaveLength(2);
  });

  it("writes an outline and a fill, faded while being built", () => {
    const outline = sink();
    const fill = sink();
    placeOutlinedAll(outline, fill, [structure("city", true), structure("city", false)]);
    expect(outline.count).toBe(2);
    expect(fill.count).toBe(2);
    expect(outline.writes.map((write) => write[3])).toEqual([
      STRUCTURE_COLORS.outline,
      STRUCTURE_COLORS.outline,
    ]);
    expect(fill.writes.map((write) => write[3])).toEqual([
      STRUCTURE_COLORS.fill,
      STRUCTURE_COLORS.building,
    ]);
  });

  it("stops at the capacity", () => {
    const many = Array.from({ length: STRUCTURE_CAPACITY + 5 }, () => structure("city", true));
    const outline = sink();
    placeOutlinedAll(outline, sink(), many);
    expect(outline.count).toBe(STRUCTURE_CAPACITY);
  });
});
