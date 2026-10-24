import type { Camera } from "../render/camera.ts";
import {
  type MapCallbacks,
  PointerGestures,
  type PointerSample,
  wheelZoomFactor,
} from "./gestures.ts";
import { KeyboardCamera, isTextEntry } from "./keyboard.ts";

export type { MapCallbacks } from "./gestures.ts";

/**
 * Wires the map element and the keyboard to a camera: drag or one finger to
 * pan, wheel or pinch to zoom, a press without a drag to pick a tile, a long
 * press or a right click for the tile's menu, arrows,
 * WASD and +/- for the keyboard. Call update() once per frame for held keys.
 */
export class InputController {
  private readonly gestures: PointerGestures;
  private readonly keys: KeyboardCamera;
  private readonly removers: (() => void)[] = [];

  /**
   * @param element receives pointer and wheel events, positions are relative to it.
   * @param keyboardTarget receives key events, the window unless a test passes its own.
   */
  constructor(
    private readonly element: HTMLElement,
    private readonly camera: Camera,
    callbacks: MapCallbacks = {},
    keyboardTarget: EventTarget = window,
  ) {
    this.gestures = new PointerGestures(camera, callbacks);
    this.keys = new KeyboardCamera(camera);

    this.listen(element, "pointerdown", (event) => {
      const pointer = event as PointerEvent;
      if (pointer.pointerType === "mouse" && pointer.button !== 0) return;
      // Keeps a drag going when the pointer leaves the canvas.
      try {
        element.setPointerCapture(pointer.pointerId);
      } catch {
        // Synthetic pointers have nothing to capture.
      }
      this.gestures.down(this.sample(pointer));
    });
    this.listen(element, "pointermove", (event) => {
      this.gestures.move(this.sample(event as PointerEvent));
    });
    this.listen(element, "pointerup", (event) => {
      this.gestures.up(this.sample(event as PointerEvent));
    });
    // The browser's own menu is kept off the map only, never off the panels.
    this.listen(element, "contextmenu", (event) => {
      event.preventDefault();
      const { x, y } = this.position(event as MouseEvent);
      this.gestures.menu(x, y);
    });
    this.listen(element, "pointercancel", (event) => {
      this.gestures.cancel((event as PointerEvent).pointerId);
    });
    this.listen(element, "pointerleave", () => {
      this.gestures.leave();
    });
    this.listen(
      element,
      "wheel",
      (event) => {
        const wheel = event as WheelEvent;
        // Also catches trackpad pinches, which browsers report as wheel events with Ctrl.
        wheel.preventDefault();
        const { x, y } = this.position(wheel);
        this.camera.zoomAt(
          wheelZoomFactor(wheel.deltaY, wheel.deltaMode, this.camera.viewportHeight),
          x,
          y,
        );
      },
      { passive: false },
    );

    this.listen(keyboardTarget, "keydown", (event) => {
      const key = event as KeyboardEvent;
      if (key.ctrlKey || key.metaKey || key.altKey || isTextEntry(key.target)) return;
      if (this.keys.keyDown(key.key, key.code)) key.preventDefault();
    });
    this.listen(keyboardTarget, "keyup", (event) => {
      this.keys.keyUp((event as KeyboardEvent).code);
    });
    this.listen(keyboardTarget, "blur", () => {
      this.keys.releaseAll();
      this.gestures.reset();
    });
  }

  /** Applies held keys for a frame that lasted dtMs milliseconds. */
  update(dtMs: number): void {
    this.keys.update(dtMs);
  }

  dispose(): void {
    for (const remove of this.removers.splice(0)) remove();
    this.keys.releaseAll();
    this.gestures.reset();
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.removers.push(() => {
      target.removeEventListener(type, handler, options);
    });
  }

  private position(event: MouseEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** A mouse opens menus with its right button: only fingers and pens time their presses. */
  private sample(event: PointerEvent): PointerSample {
    const time = event.pointerType === "mouse" ? undefined : event.timeStamp;
    return {
      id: event.pointerId,
      ...this.position(event),
      ...(time === undefined ? {} : { time }),
    };
  }
}
