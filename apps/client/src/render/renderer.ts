import { FlatCamera, type CameraView, type ViewCamera } from "./camera.ts";
import { GlContext } from "./gl-context.ts";
import type * as Lazy from "./lazy.ts";
import { MapView } from "./map-view.ts";
import type { BakedGround } from "./prebaked-ground.ts";

export type { BakedGround } from "./prebaked-ground.ts";

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
  /**
   * The way the unit points, in radians: 0 faces east and a quarter turn is
   * south (y counts from the north), smoothed over the last ticks.
   */
  readonly heading?: number;
  /** Tiles per second along its heading; 0 once it stops. */
  readonly speed?: number;
  /**
   * Set on a ship that left the sea a moment ago, for the time it lingers:
   * docking at a port, landing troops, or going under. Left out while it sails.
   */
  readonly state?: "docking" | "landing" | "sinking";
  /** How far along that state the ship is, from 0 to 1. */
  readonly progress?: number;
  /** A missile in flight: where it was launched from and where it is aimed, in tiles. */
  readonly from?: { readonly x: number; readonly y: number };
  readonly to?: { readonly x: number; readonly y: number };
  /** How far along its flight a missile is, 0 at launch and 1 on arrival. */
  readonly flown?: number;
  /** A missile's blast radius in tiles, and the colour of whoever launched it. */
  readonly radius?: number;
  readonly owner?: string;
  /**
   * A warship that has just fired: where its shot lands, in tiles, which shot
   * it is (to start its effect once) and how old it is, 0 to 1 over its short life.
   */
  readonly shot?: {
    readonly x: number;
    readonly y: number;
    readonly id: number;
    readonly age: number;
  };
}

/** How a missile ended, on the map: where, with what, and for whom. Tiles, y counted from the north. */
export interface MissileEnd {
  readonly x: number;
  readonly y: number;
  readonly heavy: boolean;
  /** The colour of the player who launched it. */
  readonly color: string;
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  /** The air defense that stopped it, when one did. */
  readonly site?: { readonly x: number; readonly y: number };
}

/** A disc of land under fallout (R-UNIT-06), in tiles, with how long it lasts. */
export interface FalloutZone {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly heavy: boolean;
  /** Seconds left as of the update, and the whole duration. */
  readonly secondsLeft: number;
  readonly seconds: number;
}

/** A structure to draw on its tile, y counted from the north. */
export interface StructureMark {
  readonly x: number;
  readonly y: number;
  /** A building, a player's capital (R-CAP-01), or a landmark of the map (R-LAND-01). */
  readonly type:
    "city" | "palace" | "mosque" | "fort" | "port" | "silo" | "airDefense" | "capital" | "landmark";
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
  /** Which published map this is and its terrain's checksum, to find its ground baked ahead. */
  readonly groundSource?: { readonly id: string; readonly sha256: string } | undefined;
  /** The flat map: square tiles, without smooth coasts and borders, for older devices. */
  readonly flat?: boolean | undefined;
  /** A phone, which asks for larger ships. */
  readonly phone?: boolean | undefined;
  /** The ground another view of the same game baked already (Renderer.bakedGround), to bake it once. */
  readonly ground?: BakedGround | undefined;
  /** Owner of every tile, kept up to date by the caller and read in place. */
  readonly owners: Uint16Array;
  readonly maxOwner: number;
}

/**
 * The combat effects a renderer draws over the map: what follows a missile,
 * a front that gives way, a capital that falls, a player wiped out.
 */
export interface RendererEffects {
  /** A missile was stopped in the air. */
  missileIntercepted(end: MissileEnd): void;
  /** A missile came down on its target. */
  missileStruck(end: MissileEnd): void;
  /** A front gave way around `tile` (R-ATTACK-10). */
  collapsed(tile: number): void;
  /** A capital fell or was razed on `tile` (R-CAP-03, R-CAP-04). */
  capitalFell(tile: number): void;
  /** A player in `color` lost their last tile, around `tile`. */
  eliminated(tile: number, color: string): void;
  /** The capital of the player at this screen is under threat (R-CAP-05), or `undefined` once safe. */
  capitalThreat(tile: number | undefined): void;
  /** Whether effects are still playing, which keeps frames coming. */
  animating(): boolean;
}

/**
 * What a renderer can do beyond the contract every renderer keeps. The page
 * asks here rather than calling hooks a renderer may leave out: the flat map
 * draws the combat effects, the globe (a prototype, ADR 0005) does not yet.
 */
export interface RendererCapabilities {
  readonly kind: ViewKind;
  /** The combat effects, or `undefined` for a renderer that draws none. */
  readonly effects: RendererEffects | undefined;
}

/**
 * Draws the game (ADR 0003): the flat map, or the globe. The page owns the
 * game state and tells the renderer what changed; the renderer draws a
 * frame for the view its camera gives, on the canvas of the game's one
 * context (`RenderContext`), which outlives it. No module outside
 * `src/render` sees Three.js or WebGL.
 */
export interface Renderer {
  readonly capabilities: RendererCapabilities;
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
  /** Every tile changed at once, after a full resynchronisation or when the view is shown again. */
  markAllChanged(): void;
  /** Transport and trade ships at sea, replacing the previous ones. */
  setShips(ships: readonly UnitMark[]): void;
  /** Discs of land under fallout (R-UNIT-06), replacing the previous ones; whether the ground changed. */
  setFallout(zones: readonly FalloutZone[]): boolean;
  /** Every structure on the map, replacing the previous ones. */
  setStructures(structures: readonly StructureMark[]): void;
  /** The baked colours of the ground, with the distance to the coast in alpha, for the minimap to reuse. */
  ground(): Uint8Array;
  /** A copy of the ground as baked, without fallout, for another view of the same game. */
  bakedGround(): BakedGround;
  resize(width: number, height: number): void;
  /** Device pixels per CSS pixel the map is drawn at (render-scale.ts). */
  setPixelRatio(ratio: number): void;
  render(view: CameraView): void;
  /**
   * Gets the next frame ready while another view is shown: the shaders built
   * in parallel and the textures sent, so that showing this one does not
   * wait. Settles once the shaders are built, or failed to.
   */
  warm(): Promise<void>;
  /** Why the frames come out blank (a shader that did not build, a lost context), once known. */
  fault(): string | undefined;
  /** Frees what the renderer made; the context it drew with stays. */
  dispose(): void;
}

/**
 * The one WebGL context of a game and its canvas, which every renderer of
 * the game draws on in turn: a switch between the flat map and the globe
 * keeps it (M7-07).
 */
export interface RenderContext {
  readonly canvas: HTMLCanvasElement;
  /** Waits for the graphics card to finish what was sent (`?perf` timings only). */
  sync(): void;
  /** Frees the context; every renderer made with it must be disposed first. */
  dispose(): void;
}

/** The context of a game's renderers; throws if WebGL 2 is missing or refused. */
export function createContext(): RenderContext {
  return new GlContext();
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

/** The renderer for a map, on the game's context; throws before loadGlobe has completed. */
export function createRenderer(
  context: RenderContext,
  options: RendererOptions,
  kind: ViewKind = "flat",
): Renderer {
  if (!lazy) throw new Error("the map's drawing code is not loaded (loadGlobe)");
  if (!(context instanceof GlContext)) throw new TypeError("a context of createContext is needed");
  return kind === "globe"
    ? new lazy.GlobeView(context, options)
    : new MapView(context, options, lazy, lazy, lazy);
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
