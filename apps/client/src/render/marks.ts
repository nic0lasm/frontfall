import { STRUCTURE_COLORS } from "../palette.ts";
import type { StructureMark, UnitMark } from "./renderer.ts";

/*
 * How the marks a game hands the renderer (ships, missiles, structures) are
 * sorted and written into marker layers. The flat map and the globe share it,
 * so a new kind of mark or a new limit is changed once.
 */

/** Ships at sea at once: B-BOAT-MAX for each of up to 26 players, with room to spare. */
export const SHIP_CAPACITY = 128;
/** Trade ships at sea at once: B-TRADE-MAX for each port of a crowded map. */
export const TRADE_CAPACITY = 512;
/** Warships at once: B-WARSHIP-MAX for each of up to 64 players. */
export const WARSHIP_CAPACITY = 256;
/** Missiles in flight at once: one per silo, with room to spare. */
export const MISSILE_CAPACITY = 256;
/** Structures drawn at once; each player's land rarely holds more than a few. */
export const STRUCTURE_CAPACITY = 1024;

/** Every kind of structure, in the order the layers are laid out. */
export const STRUCTURE_TYPES = [
  "city",
  "palace",
  "mosque",
  "fort",
  "port",
  "silo",
  "airDefense",
  "capital",
  "landmark",
] as const satisfies readonly StructureMark["type"][];

/** What a layer of marks lets a view write: instance `index` at tile (x, y) in a colour, and how many are drawn. */
export interface MarkSink {
  count: number;
  set(index: number, x: number, y: number, color: string): void;
}

/** The units at sea, sorted by what draws them. A kind keeps the order the units came in. */
export interface ShipMarks {
  readonly transports: UnitMark[];
  readonly trade: UnitMark[];
  readonly warships: UnitMark[];
  readonly missiles: UnitMark[];
  readonly heavyMissiles: UnitMark[];
}

/**
 * Sorts units by kind. A ship that is leaving the sea (`state` set) is left
 * out: the layer that draws hulls draws it. `leaveMissiles` drops the
 * missiles too, for a view whose effects draw them.
 */
export function sortShips(units: readonly UnitMark[], leaveMissiles = false): ShipMarks {
  const sorted: ShipMarks = {
    transports: [],
    trade: [],
    warships: [],
    missiles: [],
    heavyMissiles: [],
  };
  for (const unit of units) {
    if (unit.state) continue;
    switch (unit.kind) {
      case "missile":
        if (!leaveMissiles) sorted.missiles.push(unit);
        break;
      case "heavyMissile":
        if (!leaveMissiles) sorted.heavyMissiles.push(unit);
        break;
      case "trade":
        sorted.trade.push(unit);
        break;
      case "warship":
        sorted.warships.push(unit);
        break;
      case undefined:
        sorted.transports.push(unit);
    }
  }
  return sorted;
}

/**
 * Writes the first `capacity` marks into a layer, in the units' own colours
 * or in `color`, and sets how many are drawn. Does nothing for a layer the
 * view does not have. Returns the number drawn.
 */
export function placeMarks(
  sink: MarkSink | undefined,
  marks: readonly UnitMark[],
  capacity: number,
  color?: string,
): number {
  if (!sink) return 0;
  const count = Math.min(marks.length, capacity);
  for (let i = 0; i < count; i++) {
    const mark = marks[i];
    if (mark) sink.set(i, mark.x, mark.y, color ?? mark.color);
  }
  sink.count = count;
  return count;
}

/** The structures of one type, in the order they came in. */
export function structuresOfType(
  structures: readonly StructureMark[],
  type: StructureMark["type"],
): StructureMark[] {
  return structures.filter((structure) => structure.type === type);
}

/** One structure as a dark outline with a lighter fill, faded while it is being built. */
export function placeOutlined(
  outline: MarkSink,
  fill: MarkSink,
  index: number,
  structure: StructureMark,
): void {
  outline.set(index, structure.x, structure.y, STRUCTURE_COLORS.outline);
  fill.set(
    index,
    structure.x,
    structure.y,
    structure.ready ? STRUCTURE_COLORS.fill : STRUCTURE_COLORS.building,
  );
}

/** Writes structures of one type as outlined shapes, up to the capacity, and sets how many are drawn. */
export function placeOutlinedAll(
  outline: MarkSink,
  fill: MarkSink,
  structures: readonly StructureMark[],
): void {
  const count = Math.min(structures.length, STRUCTURE_CAPACITY);
  for (let i = 0; i < count; i++) {
    const structure = structures[i];
    if (structure) placeOutlined(outline, fill, i, structure);
  }
  outline.count = count;
  fill.count = count;
}
