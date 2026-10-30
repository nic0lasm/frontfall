import { Disable } from "@frontfall/engine";
import type { BuildView, ClickMode } from "../game/solo-game.ts";

/**
 * The build buttons, with their shortcut keys and numbers (screen/game-keys.ts), in the order the HUD
 * and the help list them. A number stays with its building when a game leaves others out.
 */
export const BUILD_MODES = [
  { mode: "city", key: "C", number: 1 },
  { mode: "palace", key: "B", number: 2 },
  { mode: "fort", key: "F", number: 3 },
  { mode: "port", key: "O", number: 4 },
  { mode: "silo", key: "L", number: 5 },
  { mode: "airDefense", key: "K", number: 6 },
  { mode: "mosque", key: "J" },
  { mode: "warship", key: "V", number: 7 },
  { mode: "missile", key: "M", number: 8 },
  { mode: "heavyMissile", key: "N", number: 9 },
  { mode: "demolish", key: "X" },
] as const satisfies readonly { mode: ClickMode; key: string; number?: number }[];

/** The `Disable` bit that leaves a build mode out of a game (R-MODE-03); missiles go with silos. */
const MODE_BITS: Partial<Record<ClickMode, number>> = {
  city: Disable.City,
  palace: Disable.City,
  fort: Disable.Fort,
  port: Disable.Port,
  silo: Disable.Silo,
  airDefense: Disable.AirDefense,
  mosque: Disable.AirDefense,
  warship: Disable.Warships,
  missile: Disable.Silo,
  heavyMissile: Disable.Silo,
};

/** Gold the next one costs the player; none for demolish. */
export function costOf(mode: ClickMode, build: BuildView): number | undefined {
  const costs: Partial<Record<ClickMode, number>> = {
    city: build.cityCost,
    palace: build.palaceCost,
    fort: build.fortCost,
    port: build.portCost,
    silo: build.siloCost,
    airDefense: build.airDefenseCost,
    mosque: build.mosqueCost,
    warship: build.warshipCost,
    missile: build.missileCost,
    heavyMissile: build.heavyMissileCost,
  };
  return costs[mode];
}

/** Whether a game that leaves out `disabled` has this build mode. */
export function offers(mode: ClickMode, disabled: number): boolean {
  return (disabled & (MODE_BITS[mode] ?? 0)) === 0;
}

/** The number that picks a build mode, if it has one. */
export function numberOf(mode: ClickMode): number | undefined {
  const entry: { mode: ClickMode; number?: number } | undefined = BUILD_MODES.find(
    (candidate) => candidate.mode === mode,
  );
  return entry?.number;
}
