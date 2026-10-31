import { t } from "../i18n/index.ts";
import type { Camera } from "../render/camera.ts";
import { h } from "./dom.ts";
import { formatCount } from "./format.ts";

/** How long a figure stays on the map, in milliseconds; the CSS animation matches it. */
const FLOAT_MS = 1600;
/** Figures at once; past this, the oldest goes, so a busy coast never fills the DOM. */
const MAX_FLOATS = 6;
/** A figure this far outside the view, in CSS pixels, is hidden rather than moved. */
const OFF_SCREEN = 64;

const amount = (gold: number): string => t("hud.goldGain", { gold: formatCount(gold) });

interface Float {
  readonly tile: number;
  readonly element: HTMLElement;
  readonly text: HTMLElement;
  gold: number;
  until: number;
}

/**
 * The gold a trade ship brings, as a "+N" that rises over the port it docked
 * at. A few plain DOM nodes, moved with the camera like the click marks: no
 * extra draw in the map's own frame.
 */
export class GoldFloats {
  readonly element = h("div", { class: "gold-floats", "aria-hidden": "true" });
  private floats: Float[] = [];

  /** `gold` came in on the dock at `tile`; two ships docking together there add up in one figure. */
  add(tile: number, gold: number, now: number): void {
    if (gold <= 0) return;
    const same = this.floats.find(
      (float) => float.tile === tile && float.until - now > FLOAT_MS / 2,
    );
    if (same) {
      same.gold += gold;
      same.text.textContent = amount(same.gold);
      return;
    }
    if (this.floats.length >= MAX_FLOATS) this.floats.shift()?.element.remove();
    const text = h("span", { class: "gold-float-text" }, amount(gold));
    const element = h("span", { class: "gold-float" }, text);
    this.element.append(element);
    this.floats.push({ tile, element, text, gold, until: now + FLOAT_MS });
  }

  /** Keeps the figures on their ports as the camera moves; call every frame. */
  place(camera: Camera, now: number): void {
    if (this.floats.length === 0) return;
    this.floats = this.floats.filter((float) => {
      if (now < float.until) return true;
      float.element.remove();
      return false;
    });
    for (const float of this.floats) {
      const { x, y } = camera.tileToScreen(float.tile);
      float.element.hidden =
        x < -OFF_SCREEN ||
        y < -OFF_SCREEN ||
        x > camera.viewportWidth + OFF_SCREEN ||
        y > camera.viewportHeight + OFF_SCREEN;
      float.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }
}
