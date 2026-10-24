import type { CameraView, ScreenPoint, ViewCamera } from "./camera.ts";
import {
  globePose,
  latLonToTile,
  type GlobePose,
  pickLatLon,
  projectLatLon,
  tileToLatLon,
} from "./globe-projection.ts";

export interface GlobeCameraOptions {
  /** Size of the world in tiles; the map must span the whole planet. */
  readonly width: number;
  readonly height: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

/** The middle of the screen stays this far from the poles, in degrees of latitude. */
const POLE_MARGIN = 5;

/** The planet in full with some space around it. */
const START_ZOOM = 1.5;

/** Returned for a tile behind the planet: far enough off screen for labels and marks to skip it. */
const HIDDEN: ScreenPoint = { x: -1e6, y: -1e6 };

/**
 * Orbits the planet. Its state is the tile under the middle of the screen and
 * a zoom where 1 shows the whole globe; the view it gives the renderer uses
 * the same units as the flat camera's (globe-projection.ts turns it into a
 * perspective camera), so the interface code does not know which is active.
 */
export class GlobeCamera implements ViewCamera {
  readonly minZoom: number;
  readonly maxZoom: number;
  private centerX: number;
  private centerY: number;
  private zoomLevel: number;
  private viewWidth = 1;
  private viewHeight = 1;

  constructor(readonly options: GlobeCameraOptions) {
    // The whole planet fits the height of the screen up to a zoom of about 2.
    const { width, height, minZoom = 0.8, maxZoom = 32 } = options;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError(`invalid map size ${String(width)}x${String(height)}`);
    }
    if (!(minZoom > 0 && minZoom <= maxZoom)) {
      throw new RangeError(`invalid zoom range ${String(minZoom)}..${String(maxZoom)}`);
    }
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.centerX = width / 2;
    this.centerY = height / 2;
    this.zoomLevel = Math.min(maxZoom, Math.max(minZoom, START_ZOOM));
  }

  get zoom(): number {
    return this.zoomLevel;
  }

  get viewportWidth(): number {
    return this.viewWidth;
  }

  get viewportHeight(): number {
    return this.viewHeight;
  }

  /**
   * Screen pixels per tile at the middle of the screen, as on the flat map:
   * a zoom keeps its size on screen when the view switches between them.
   */
  get scale(): number {
    return (this.viewHeight / this.options.height) * this.zoomLevel;
  }

  view(): CameraView {
    const scale = this.scale;
    return {
      centerX: this.centerX,
      centerY: this.centerY,
      halfWidth: this.viewWidth / 2 / scale,
      halfHeight: this.viewHeight / 2 / scale,
    };
  }

  screenToTile(x: number, y: number): number | undefined {
    const { width, height } = this.options;
    const point = pickLatLon(this.pose(), x, y);
    if (!point) return undefined;
    const tile = latLonToTile(point, width, height);
    const column = Math.min(width - 1, Math.floor(tile.x));
    const row = Math.min(height - 1, Math.max(0, Math.floor(tile.y)));
    return row * width + column;
  }

  tileToScreen(tile: number): ScreenPoint {
    const { width, height } = this.options;
    const column = tile % width;
    const { lat, lon } = tileToLatLon(column + 0.5, (tile - column) / width + 0.5, width, height);
    return projectLatLon(this.pose(), lat, lon) ?? HIDDEN;
  }

  /** The camera for the current view, also what the renderer draws from. */
  pose(): GlobePose {
    const { width, height } = this.options;
    return globePose(this.view(), width, height, this.viewWidth, this.viewHeight);
  }

  /** Turns the planet under a drag: the ground at the middle of the screen follows the pointer. */
  panBy(dx: number, dy: number): void {
    const scale = this.scale;
    const { lat } = tileToLatLon(
      this.centerX,
      this.centerY,
      this.options.width,
      this.options.height,
    );
    // Columns narrow toward the poles; a drag there would spin the globe without a floor.
    const shrink = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const columnsPerRow = this.options.width / (2 * this.options.height);
    this.moveTo(this.centerX - (dx / scale / shrink) * columnsPerRow, this.centerY - dy / scale);
  }

  zoomAt(factor: number, x: number, y: number): void {
    if (!(factor > 0)) return;
    const { width, height } = this.options;
    // Off the planet, the zoom closes in on the middle of the screen.
    if (!pickLatLon(this.pose(), x, y)) {
      x = this.viewWidth / 2;
      y = this.viewHeight / 2;
    }
    const before = pickLatLon(this.pose(), x, y);
    this.zoomLevel = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoomLevel * factor));
    if (!before) return;
    const anchor = latLonToTile(before, width, height);
    // Two corrections bring the point back under the pointer within a fraction of a tile.
    for (let i = 0; i < 2; i++) {
      const after = pickLatLon(this.pose(), x, y);
      if (!after) return;
      const moved = latLonToTile(after, width, height);
      this.moveTo(
        this.centerX + shortest(anchor.x - moved.x, width),
        this.centerY + anchor.y - moved.y,
      );
    }
  }

  focus(tile: number, zoom?: number): void {
    const { width } = this.options;
    if (zoom !== undefined && zoom > 0) {
      this.zoomLevel = Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
    }
    const column = tile % width;
    this.moveTo(column + 0.5, (tile - column) / width + 0.5);
  }

  resize(width: number, height: number): void {
    this.viewWidth = Math.max(1, width);
    this.viewHeight = Math.max(1, height);
  }

  private moveTo(x: number, y: number): void {
    const { width, height } = this.options;
    const margin = (POLE_MARGIN / 180) * height;
    this.centerX = ((x % width) + width) % width;
    this.centerY = Math.min(height - margin, Math.max(margin, y));
  }
}

/** A difference of columns the short way around the world, in [-width / 2, width / 2). */
function shortest(dx: number, width: number): number {
  return ((((dx + width / 2) % width) + width) % width) - width / 2;
}
