import type { CameraView } from "./camera.ts";
import { MapView } from "./map-view.ts";

/** A unit to draw, in tiles, y counted from the north. */
export interface UnitMark {
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

/** A structure to draw on its tile, y counted from the north. */
export interface StructureMark {
  readonly x: number;
  readonly y: number;
  readonly type: "city" | "fort";
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
  /** Tiles whose owner changed in the shared array; they fade in. */
  markChanged(tiles: ArrayLike<number>): void;
  /** Every tile changed at once, after a full resynchronisation. */
  markAllChanged(): void;
  /** Ships at sea, replacing the previous ones. */
  setShips(ships: readonly UnitMark[]): void;
  /** Every structure on the map, replacing the previous ones. */
  setStructures(structures: readonly StructureMark[]): void;
  resize(width: number, height: number): void;
  render(view: CameraView): void;
  dispose(): void;
}

/** The renderer for a map; throws if WebGL 2 is missing or refused. */
export function createRenderer(options: RendererOptions): Renderer {
  return new MapView(options);
}
