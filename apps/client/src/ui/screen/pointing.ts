import type { GameUpdate } from "../../game/game-runner.ts";
import type { MapLandmarkData } from "../../maps.ts";
import type { ViewCamera } from "../../render/camera.ts";
import type { ShipRef } from "../player-tip.ts";

/** How far from a ship, in screen pixels, the pointer still points at it. */
const SHIP_REACH = 16;
/** How far from a landmark's mark, in screen pixels, the pointer still points at it. */
const LANDMARK_REACH = 18;

type Camera = Pick<ViewCamera, "tileToScreen">;

/** The nearest ship within reach of `tile` on screen (a warship first, then a transport). */
export function shipNear(
  camera: Camera,
  update: GameUpdate | undefined,
  tile: number,
): { ref: ShipRef; tile: number } | undefined {
  if (!update) return undefined;
  const at = camera.tileToScreen(tile);
  let nearest: { ref: ShipRef; tile: number } | undefined;
  let best = SHIP_REACH * SHIP_REACH;
  const look = (kind: ShipRef["kind"], ships: readonly { id: number; tile: number }[]): void => {
    for (const ship of ships) {
      const mark = camera.tileToScreen(ship.tile);
      const d = (mark.x - at.x) ** 2 + (mark.y - at.y) ** 2;
      if (d <= best) {
        best = d;
        nearest = { ref: { kind, id: ship.id }, tile: ship.tile };
      }
    }
  };
  look("trade", update.tradeShips);
  look("transport", update.boats);
  look("warship", update.warships);
  return nearest;
}

/**
 * The landmark drawn under `tile` (R-LAND-01): within the size of its mark
 * on screen, so it is as easy to point at closed in as from afar.
 */
export function landmarkNear(
  camera: Camera,
  landmarks: readonly MapLandmarkData[],
  tile: number,
): MapLandmarkData | undefined {
  const at = camera.tileToScreen(tile);
  let nearest: MapLandmarkData | undefined;
  let best = LANDMARK_REACH * LANDMARK_REACH;
  for (const landmark of landmarks) {
    const mark = camera.tileToScreen(landmark.tile);
    const d = (mark.x - at.x) ** 2 + (mark.y - at.y) ** 2;
    if (d <= best) {
      best = d;
      nearest = landmark;
    }
  }
  return nearest;
}

/** The centre of the zone of fallout that covers `tile`, the newest when several do. */
export function falloutAt(
  update: GameUpdate | undefined,
  tile: number,
  within: (a: number, b: number, radius: number) => boolean,
): number | undefined {
  let found: number | undefined;
  for (const zone of update?.fallout ?? []) {
    if (zone.ticksLeft > 0 && within(tile, zone.tile, zone.radius)) found = zone.tile;
  }
  return found;
}
