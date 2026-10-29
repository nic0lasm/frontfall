import type { Camera } from "../render/camera.ts";

/** One pointer (mouse, pen or finger) in CSS pixels relative to the map element. */
export interface PointerSample {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** When the sample was taken, in milliseconds; tells a long press from a click. */
  readonly time?: number;
  /** A finger on a touch screen, which cannot hover: its press shows the land under it. */
  readonly finger?: boolean;
}

export interface MapCallbacks {
  /** A press released without moving: the player picked this tile. */
  readonly onTileClick?: (tile: number, finger: boolean) => void;
  /** A press held still for LONG_PRESS_MS, or a right click: the player wants the menu of this tile. */
  readonly onTileHold?: (tile: number) => void;
  /**
   * The tile under a hovering mouse changed, or under a finger resting on the
   * map; undefined off the map, when the mouse left or the finger lifted or moved on.
   */
  readonly onHover?: (tile: number | undefined) => void;
}

/** Farther than this from where it started, a press becomes a drag and never a click. */
export const DRAG_THRESHOLD_PX = 6;

/** A finger rests on the glass wider than a pointer and wobbles: past this, its press becomes a drag. */
export const FINGER_DRAG_THRESHOLD_PX = 12;

/** Held still at least this long, a press opens the tile's menu instead of clicking it. */
export const LONG_PRESS_MS = 500;

type Mode = "idle" | "press" | "pan" | "pinch";

interface Pinch {
  readonly distance: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Turns pointer samples into camera moves and clicks. One pointer pans once it
 * has travelled past the threshold, two pointers pinch: the zoom follows the
 * distance between them and the map follows their midpoint. A pinch never ends
 * in a click, even when one finger stays down.
 *
 * Fed with plain samples rather than DOM events so the rules can be tested
 * without a browser.
 */
export class PointerGestures {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private mode: Mode = "idle";
  private pressX = 0;
  private pressY = 0;
  private pressTime: number | undefined;
  /** How far the press travels before it is a drag, by what pressed it. */
  private threshold = DRAG_THRESHOLD_PX;
  private pinch: Pinch | undefined;
  private hovered: number | undefined;
  /** The hover comes from a finger: it ends with the press. */
  private touchHover = false;
  /** Where a mouse or a pen last hovered, to find its tile again when the map moves under it. */
  private hoverAt: { x: number; y: number } | undefined;

  constructor(
    private readonly camera: Camera,
    private readonly callbacks: MapCallbacks = {},
  ) {}

  /** Pointers currently pressed. */
  get active(): number {
    return this.pointers.size;
  }

  down(sample: PointerSample): void {
    this.pointers.set(sample.id, { x: sample.x, y: sample.y });
    if (this.pointers.size === 1) {
      this.mode = "press";
      this.pressX = sample.x;
      this.pressY = sample.y;
      this.pressTime = sample.time;
      this.threshold = sample.finger ? FINGER_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
      // Fingers cannot hover: the one resting on the map shows whose land it is on.
      if (sample.finger) {
        this.touchHover = true;
        this.hover(sample.x, sample.y);
      }
    } else {
      this.mode = "pinch";
      this.pinch = this.measurePinch();
      this.endTouchHover();
    }
  }

  move(sample: PointerSample): void {
    const last = this.pointers.get(sample.id);
    if (!last) {
      this.hoverAt = { x: sample.x, y: sample.y };
      this.hover(sample.x, sample.y);
      return;
    }
    const { x, y } = sample;
    this.pointers.set(sample.id, { x, y });
    if (this.mode === "press") {
      if (Math.hypot(x - this.pressX, y - this.pressY) > this.threshold) {
        this.mode = "pan";
        this.endTouchHover();
        this.camera.panBy(x - this.pressX, y - this.pressY);
      }
    } else if (this.mode === "pan") {
      this.camera.panBy(x - last.x, y - last.y);
    } else if (this.pinch) {
      const next = this.measurePinch();
      if (!next) return;
      this.camera.panBy(next.x - this.pinch.x, next.y - this.pinch.y);
      if (this.pinch.distance > 0 && next.distance > 0) {
        this.camera.zoomAt(next.distance / this.pinch.distance, next.x, next.y);
      }
      this.pinch = next;
    }
  }

  up(sample: PointerSample): void {
    if (!this.pointers.has(sample.id)) return;
    const click =
      this.mode === "press" &&
      this.pointers.size === 1 &&
      Math.hypot(sample.x - this.pressX, sample.y - this.pressY) <= this.threshold;
    const held =
      sample.time !== undefined &&
      this.pressTime !== undefined &&
      sample.time - this.pressTime >= LONG_PRESS_MS;
    this.release(sample.id);
    // A mouse or a pen let go after a drag hovers where it stopped.
    if (!sample.finger && this.pointers.size === 0) {
      this.hoverAt = { x: sample.x, y: sample.y };
      this.hover(sample.x, sample.y);
    }
    if (!click) return;
    const tile = this.camera.screenToTile(sample.x, sample.y);
    if (tile === undefined) return;
    if (held) this.callbacks.onTileHold?.(tile);
    else this.callbacks.onTileClick?.(tile, sample.finger === true);
  }

  /** Enter or Space: picks the tile at (x, y) as a click would, for play without a pointer. */
  pick(x: number, y: number): void {
    const tile = this.camera.screenToTile(x, y);
    if (tile !== undefined) this.callbacks.onTileClick?.(tile, false);
  }

  /** Lights the tile at (x, y) as a hovering mouse would, so the keyboard aim shows what it would pick. */
  aim(x: number, y: number): void {
    this.hoverAt = { x, y };
    this.hover(x, y);
  }

  /** A right click: the menu of the tile under the pointer, never a click. */
  menu(x: number, y: number): void {
    const tile = this.camera.screenToTile(x, y);
    if (tile !== undefined) this.callbacks.onTileHold?.(tile);
  }

  /** The pointer was taken away by the browser: forget it without a click. */
  cancel(id: number): void {
    if (this.pointers.has(id)) this.release(id);
  }

  /** Forgets every pointer, for instance when the window loses focus. */
  reset(): void {
    this.pointers.clear();
    this.mode = "idle";
    this.pinch = undefined;
    this.endTouchHover();
  }

  /**
   * Finds the tile under a still mouse again, after the map moved under it
   * from the wheel or the keyboard. Cheap enough to call every frame.
   */
  refreshHover(): void {
    if (this.hoverAt && this.pointers.size === 0) this.hover(this.hoverAt.x, this.hoverAt.y);
  }

  /** The mouse left the map. */
  leave(): void {
    this.touchHover = false;
    this.hoverAt = undefined;
    if (this.hovered === undefined) return;
    this.hovered = undefined;
    this.callbacks.onHover?.(undefined);
  }

  private endTouchHover(): void {
    if (this.touchHover) this.leave();
  }

  private hover(x: number, y: number): void {
    const tile = this.camera.screenToTile(x, y);
    if (tile === this.hovered) return;
    this.hovered = tile;
    this.callbacks.onHover?.(tile);
  }

  private release(id: number): void {
    this.pointers.delete(id);
    if (this.pointers.size === 0) {
      this.endTouchHover();
      this.mode = "idle";
      this.pinch = undefined;
    } else if (this.pointers.size === 1) {
      // The finger left on the glass carries on panning, from where it is.
      this.mode = "pan";
      this.pinch = undefined;
    } else {
      this.pinch = this.measurePinch();
    }
  }

  /** Distance and midpoint of the two oldest pointers. */
  private measurePinch(): Pinch | undefined {
    const [a, b] = this.pointers.values();
    if (!a || !b) return undefined;
    return { distance: Math.hypot(b.x - a.x, b.y - a.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}

/** Wheel distance per zoom doubling is about 460 px, a few notches of a mouse wheel. */
const WHEEL_ZOOM_RATE = 0.0015;
const LINE_HEIGHT_PX = 40;
/** One event never zooms by more than this many pixels' worth, whatever the device reports. */
const MAX_WHEEL_PX = 400;

/**
 * Zoom factor for a wheel event. Firefox reports lines and some devices pages,
 * so the delta is brought back to pixels first. Scrolling down zooms out.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pageHeight: number): number {
  const scale = deltaMode === 1 ? LINE_HEIGHT_PX : deltaMode === 2 ? pageHeight : 1;
  const pixels = Math.min(MAX_WHEEL_PX, Math.max(-MAX_WHEEL_PX, deltaY * scale));
  return Math.exp(-pixels * WHEEL_ZOOM_RATE);
}
