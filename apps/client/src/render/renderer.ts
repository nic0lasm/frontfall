import { FlatCamera, type CameraView, type ViewCamera } from "./camera.ts";
import type * as Lazy from "./lazy.ts";
import { MapView } from "./map-view.ts";

export { FRONT_SECONDS } from "./fronts.ts";

/** How the map is shown: flat, or on a globe for a map of the whole planet (a prototype, ADR 0005). */
export type ViewKind = "flat" | "globe";

/** A unit to draw, in tiles, y counted from the north. */
export interface UnitMark {
  /** Tells a unit from one frame to the next, for the effects that follow it; unique among all units. */
  readonly id?: number;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  /**
   * A trade ship, drawn smaller than a transport (R-UNIT-03), a warship,
   * drawn larger (R-UNIT-04), or a missile in flight (R-UNIT-05).
   */
  readonly kind?: "trade" | "warship" | "missile" | "heavyMissile";
}

/** A structure to draw on its tile, y counted from the north. */
export interface StructureMark {
  readonly x: number;
  readonly y: number;
  readonly type: "city" | "palace" | "fort" | "port" | "silo" | "airDefense";
  /** Colour of the player who owns it, for the plate; white when left out. */
  readonly color?: string;
  /** Drawn faded while it is being built. */
  readonly ready: boolean;
}

/** What a renderer is made from: the map, and the owners array it reads in place. */
export interface RendererOptions {
  readonly width: number;
  readonly height: number;
  /** TileKind of every tile; 0 is water. */
  readonly kinds: Uint8Array;
  /** Whether the map wraps east-west. */
  readonly wrapsX: boolean;
  /** Elevation on land, depth at sea, 0 to 31. */
  readonly relief?: Uint8Array;
  /** Latitudes of the south and north edges, in degrees, which set the climates drawn. */
  readonly latitudes?: readonly [south: number, north: number] | undefined;
  /** The flat map: square tiles, without smooth coasts and borders, for older devices. */
  readonly flat?: boolean | undefined;
  /** Owner of every tile, kept up to date by the caller and read in place. */
  readonly owners: Uint16Array;
  readonly maxOwner: number;
}

/**
 * Draws the game (ADR 0003): the flat map today, the globe later. The page
 * owns the game state and tells the renderer what changed; the renderer
 * owns its canvas, and draws a frame for the view its camera gives. No
 * module outside `src/render` sees Three.js or WebGL.
 */
export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  setPlayerColor(id: number, color: string): void;
  /** The player whose land is marked out, usually the one at this screen. */
  setHighlight(id: number): void;
  /** Allies of that player, whose land is marked out too, with dashes. */
  setAllies(ids: readonly number[]): void;
  /** The player whose land is under the pointer, lit whole; 0 for none. */
  setHovered(id: number): void;
  /** Whether attack fronts glint as they move; off when the player asks for less motion. */
  setMotion(moving: boolean): void;
  /** Tiles whose owner changed in the shared array; they fade in and light their front for FRONT_SECONDS. */
  markChanged(tiles: ArrayLike<number>): void;
  /** Every tile changed at once, after a full resynchronisation. */
  markAllChanged(): void;
  /** Transport and trade ships at sea, replacing the previous ones. */
  setShips(ships: readonly UnitMark[]): void;
  /** Discs of land under fallout (R-UNIT-06), in tiles, replacing the previous ones; whether they changed. */
  setFallout(zones: readonly { x: number; y: number; radius: number }[]): boolean;
  /** A front gave way around `tile` (R-ATTACK-10); a renderer without effects leaves it out. */
  collapsed?(tile: number): void;
  /** Every structure on the map, replacing the previous ones. */
  setStructures(structures: readonly StructureMark[]): void;
  /** Whether effects are still playing, which keeps frames coming; a renderer without effects leaves it out. */
  animating?(): boolean;
  /** The baked colours of the ground, with the distance to the coast in alpha, for the minimap to reuse. */
  ground?(): Uint8Array | undefined;
  resize(width: number, height: number): void;
  render(view: CameraView): void;
  dispose(): void;
}

/** The territories', the globe's and the pieces' code, once loadGlobe or loadPieces has fetched it. */
let lazy: typeof Lazy | undefined;

/**
 * Fetches the code the first visit leaves out: the territory layer and its
 * shaders, the globe, used only by `?view=globe`, and the pieces of the flat
 * map. The game screen waits for it (main.ts, loadGame), so no game starts
 * without it.
 */
export async function loadGlobe(): Promise<void> {
  lazy ??= await import("./lazy.ts");
}

/** The same chunk as loadGlobe's, asked for by the flat map. */
export const loadPieces = loadGlobe;

/** Whether loadGlobe has completed, so that a globe can be made. */
export function globeLoaded(): boolean {
  return lazy !== undefined;
}

/** The renderer for a map; throws if WebGL 2 is missing or refused, or before loadGlobe has completed. */
export function createRenderer(options: RendererOptions, kind: ViewKind = "flat"): Renderer {
  if (!lazy) throw new Error("the map's drawing code is not loaded (loadGlobe)");
  return kind === "globe" ? new lazy.GlobeView(options) : new MapView(options, lazy, lazy);
}

/** The minimap of a game, once the chunk is there; none before, and the game goes on without it. */
export function createMinimap(options: Lazy.MinimapOptions): Lazy.Minimap | undefined {
  return lazy ? new lazy.Minimap(options) : undefined;
}

/** The camera that goes with a renderer of the same kind. */
export function createCamera(
  map: { readonly width: number; readonly height: number; readonly wrapsX: boolean },
  kind: ViewKind = "flat",
): ViewCamera {
  return kind === "globe" && lazy
    ? new lazy.GlobeCamera({ width: map.width, height: map.height })
    : new FlatCamera({ width: map.width, height: map.height, wrapsX: map.wrapsX });
}

/**
 * Whether a map can be shown on a globe: it must span every longitude and
 * latitude, which a map that wraps east-west with twice as many columns as
 * rows does (map-format.md: a cylinder spans -180 to 180).
 */
export function fitsGlobe(map: {
  readonly width: number;
  readonly height: number;
  readonly wrapsX: boolean;
}): boolean {
  return map.wrapsX && map.width === 2 * map.height;
}
