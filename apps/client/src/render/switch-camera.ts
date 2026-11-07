import type { CameraView, ScreenPoint, ViewCamera } from "./camera.ts";

/**
 * The camera the input and the interface hold for a whole game: it passes
 * every call to the camera of the view shown, the flat map's or the globe's,
 * so that a switch of view (M7-07) swaps the camera under it and the input
 * stays bound, with a drag or a held key going on.
 */
export class SwitchCamera implements ViewCamera {
  constructor(private target: ViewCamera) {}

  /** The camera of the view shown. */
  get current(): ViewCamera {
    return this.target;
  }

  /**
   * Shows `next` instead: sized like the camera before, and centred on the
   * tile at the middle of the screen, at the same zoom.
   */
  swap(next: ViewCamera, mapWidth: number, mapHeight: number): void {
    const before = this.target;
    const { centerX, centerY } = before.view();
    const centre = Math.min(mapHeight - 1, Math.floor(centerY)) * mapWidth + Math.floor(centerX);
    next.resize(before.viewportWidth, before.viewportHeight);
    next.focus(centre, before.zoom);
    this.target = next;
  }

  screenToTile(x: number, y: number): number | undefined {
    return this.target.screenToTile(x, y);
  }

  tileToScreen(tile: number): ScreenPoint {
    return this.target.tileToScreen(tile);
  }

  panBy(dx: number, dy: number): void {
    this.target.panBy(dx, dy);
  }

  zoomAt(factor: number, x: number, y: number): void {
    this.target.zoomAt(factor, x, y);
  }

  focus(tile: number, zoom?: number): void {
    this.target.focus(tile, zoom);
  }

  resize(width: number, height: number): void {
    this.target.resize(width, height);
  }

  view(): CameraView {
    return this.target.view();
  }

  get viewportWidth(): number {
    return this.target.viewportWidth;
  }

  get viewportHeight(): number {
    return this.target.viewportHeight;
  }

  get zoom(): number {
    return this.target.zoom;
  }

  get scale(): number {
    return this.target.scale;
  }
}
