import type { GameUpdate } from "../../game/solo-game.ts";
import type { UnitMark } from "../../render/renderer.ts";

/** Offset of warship ids among the ships the screen moves, past any transport's. */
const WARSHIP_IDS = 2 ** 40;
/** Offset of missile ids, past any warship's. */
const MISSILE_IDS = 2 ** 41;
/** Missiles in flight: the brand's bright ember. */
export const MISSILE_COLOR = "#FF7A47";

type Moving = Pick<GameUpdate, "boats" | "tradeShips" | "warships" | "missiles">;

/** Where each ship of an update is, by an id unique across transports, trade ships, warships and missiles. */
export function shipTiles(update: Moving | undefined): Map<number, number> {
  return new Map([
    ...(update?.boats ?? []).map((ship) => [ship.id, ship.tile] as const),
    ...(update?.tradeShips ?? []).map((ship) => [-ship.id, ship.tile] as const),
    ...(update?.warships ?? []).map((ship) => [WARSHIP_IDS + ship.id, ship.tile] as const),
    ...(update?.missiles ?? []).map((m) => [MISSILE_IDS + m.id, m.tile] as const),
  ]);
}

/** Whether anything moves at sea or in the air, which keeps frames coming. */
export function sailing(update: Moving | undefined): boolean {
  return (
    (update?.boats.length ?? 0) +
      (update?.tradeShips.length ?? 0) +
      (update?.warships.length ?? 0) +
      (update?.missiles.length ?? 0) >
    0
  );
}

/**
 * Ships glide from where they were on the previous tick to where they are
 * now, over one tick, instead of jumping B-BOAT-SPEED tiles at a time.
 * `progress` runs from 0 on the previous tick to 1 on the latest.
 */
export function shipMarks(
  latest: Moving,
  previous: ReadonlyMap<number, number>,
  progress: number,
  map: { readonly width: number; readonly wrapsX: boolean },
  colorOf: (player: number) => string,
): UnitMark[] {
  // Trade ships by negative id, apart from transports.
  const ships = [
    ...latest.boats,
    ...latest.tradeShips.map((ship) => ({ ...ship, id: -ship.id, kind: "trade" as const })),
    // Warships by ids past every transport's and trade ship's.
    ...latest.warships.map((ship) => ({
      ...ship,
      id: WARSHIP_IDS + ship.id,
      kind: "warship" as const,
    })),
    // Missiles after them.
    ...latest.missiles.map((missile) => ({
      ...missile,
      id: MISSILE_IDS + missile.id,
      kind: missile.heavy ? ("heavyMissile" as const) : ("missile" as const),
    })),
  ];
  const { width } = map;
  return ships.map((ship) => {
    const to = ship.tile;
    const from = previous.get(ship.id) ?? to;
    const fromX = from % width;
    const toX = to % width;
    // The short way across the seam of a wrapping map.
    let dx = toX - fromX;
    if (map.wrapsX && Math.abs(dx) > width / 2) dx -= Math.sign(dx) * width;
    const fromY = Math.floor(from / width);
    const toY = Math.floor(to / width);
    return {
      id: ship.id,
      x: fromX + dx * progress,
      y: fromY + (toY - fromY) * progress,
      // Missiles in one bright colour, readable over any land.
      color:
        "kind" in ship && (ship.kind === "missile" || ship.kind === "heavyMissile")
          ? MISSILE_COLOR
          : colorOf(ship.player),
      ...("kind" in ship ? { kind: ship.kind } : {}),
    };
  });
}
