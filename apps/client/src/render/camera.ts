/** A position on the screen in CSS pixels, from the top-left corner of the view. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * What a flat renderer needs to draw a frame, in tiles: x grows eastward and
 * y southward from the north pole, so tile (x, y) covers [x, x + 1) × [y, y + 1).
 */
export interface CameraView {
  /** Column at the centre of the screen, in [0, world width). */
  readonly centerX: number;
  readonly centerY: number;
  /** Half the visible width and height, in tiles. */
  readonly halfWidth: number;
  readonly halfHeight: number;
}

/**
 * Turns screen positions into tiles and back, pans and zooms (ADR 0003). The
 * interface and input code only talk to this contract, so a globe camera can
 * replace the flat one without them noticing.
 */
export interface Camera {
  /** Tile under a screen position, or undefined off the map. */
  screenToTile(x: number, y: number): number | undefined;
  /** Centre of a tile on screen, on the copy of the world nearest the view centre. */
  tileToScreen(tile: number): ScreenPoint;
  /** Moves the map content by a distance in pixels, as a drag would. */
  panBy(dx: number, dy: number): void;
  /** Multiplies the zoom, keeping the map point under (x, y) where it is. */
  zoomAt(factor: number, x: number, y: number): void;
  /** Centres the view on a tile, at another zoom if one is given. */
  focus(tile: number, zoom?: number): void;
  /** Size of the view in CSS pixels. */
  resize(width: number, height: number): void;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

/**
 * A camera the game screen draws from: besides the contract above, it gives
 * the renderer its view and tells how close it is.
 */
export interface ViewCamera extends Camera {
  view(): CameraView;
  /** 1 shows the whole map; larger values close in. */
  readonly zoom: number;
  /** Screen pixels per tile at the middle of the screen. */
  readonly scale: number;
}

export interface FlatCameraOptions {
  /** Size of the world in tiles. */
  readonly width: number;
  readonly height: number;
  /** Whether the map wraps east-west; a flat map stops at its edges. Default true. */
  readonly wrapsX?: boolean;
  /** Bounds of the zoom, where 1 fits the whole map height on screen. */
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

/**
 * Orthographic view of a map. On a map that wraps east-west the centre column
 * is kept in [0, width) whatever the pans; on a flat map it is clamped like
 * the centre row, so no edge leaves a gap on screen unless the whole map fits.
 */
export class FlatCamera implements ViewCamera {
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly wrapsX: boolean;
  private centerX: number;
  private centerY: number;
  private zoomLevel = 1;
  private viewWidth = 1;
  private viewHeight = 1;

  constructor(readonly options: FlatCameraOptions) {
    const { width, height, minZoom = 1, maxZoom = 32 } = options;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError(`invalid map size ${String(width)}x${String(height)}`);
    }
    if (!(minZoom > 0 && minZoom <= maxZoom)) {
      throw new RangeError(`invalid zoom range ${String(minZoom)}..${String(maxZoom)}`);
    }
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.wrapsX = options.wrapsX ?? true;
    this.centerX = width / 2;
    this.centerY = height / 2;
    this.zoomLevel = minZoom;
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

  /** Screen pixels per tile. */
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
    const scale = this.scale;
    const row = Math.floor(this.centerY + (y - this.viewHeight / 2) / scale);
    if (row < 0 || row >= height) return undefined;
    const column = Math.floor(this.centerX + (x - this.viewWidth / 2) / scale);
    if (this.wrapsX) return row * width + wrap(column, width);
    return column < 0 || column >= width ? undefined : row * width + column;
  }

  tileToScreen(tile: number): ScreenPoint {
    const { width } = this.options;
    const column = tile % width;
    const row = (tile - column) / width;
    // On a wrapping map, the shorter way around the world, in [-width / 2, width / 2).
    const dx = this.wrapsX
      ? wrap(column + 0.5 - this.centerX + width / 2, width) - width / 2
      : column + 0.5 - this.centerX;
    const scale = this.scale;
    return {
      x: this.viewWidth / 2 + dx * scale,
      y: this.viewHeight / 2 + (row + 0.5 - this.centerY) * scale,
    };
  }

  panBy(dx: number, dy: number): void {
    const scale = this.scale;
    this.moveTo(this.centerX - dx / scale, this.centerY - dy / scale);
  }

  zoomAt(factor: number, x: number, y: number): void {
    if (!(factor > 0)) return;
    const before = this.scale;
    const anchorX = this.centerX + (x - this.viewWidth / 2) / before;
    const anchorY = this.centerY + (y - this.viewHeight / 2) / before;
    this.zoomLevel = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoomLevel * factor));
    const after = this.scale;
    this.moveTo(
      anchorX - (x - this.viewWidth / 2) / after,
      anchorY - (y - this.viewHeight / 2) / after,
    );
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
    this.moveTo(this.centerX, this.centerY);
  }

  private moveTo(x: number, y: number): void {
    const { width, height } = this.options;
    const halfHeight = height / 2 / this.zoomLevel;
    const halfWidth = this.viewWidth / 2 / this.scale;
    this.centerX = this.wrapsX
      ? wrap(x, width)
      : halfWidth * 2 >= width
        ? width / 2
        : Math.min(width - halfWidth, Math.max(halfWidth, x));
    this.centerY = Math.min(height - halfHeight, Math.max(halfHeight, y));
  }
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}
