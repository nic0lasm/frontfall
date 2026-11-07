import type { ClickPreview } from "../game/game-runner.ts";
import { applyTranslations, t, type MessageKey } from "../i18n/index.ts";
import type { Camera } from "../render/camera.ts";
import { REFUSALS } from "./click-marks.ts";
import { h } from "../dom.ts";
import { formatCount } from "./format.ts";

/** Room kept between the card and the edge of the screen, in CSS pixels. */
const EDGE = 8;
/** Smallest the circle of a reach is drawn, so that it stays visible zoomed out. */
const MIN_REACH_PIXELS = 12;

/** What the card says about a click that has not been made. */
export interface PreviewText {
  /** The click would go through. */
  readonly ok: boolean;
  /** Why not, or what to do next. */
  readonly status: MessageKey;
  /** Something to know about it when it goes through. */
  readonly note?: MessageKey;
  /** Tiles a structure guards around it, shown for a click that would go through. */
  readonly radius?: number;
}

/** The words for a preview, or none for a click that has no answer to show. */
export function previewText(preview: ClickPreview, touch: boolean): PreviewText | undefined {
  if (preview.refused !== undefined) {
    const status = REFUSALS[preview.refused];
    return status === undefined ? undefined : { ok: false, status };
  }
  return {
    ok: true,
    status: touch ? "preview.okTouch" : "preview.ok",
    ...(preview.note === "lake" ? { note: "click.lake" as const } : {}),
    ...(preview.radius === undefined ? {} : { radius: preview.radius }),
  };
}

/** What `show` takes. */
export interface PreviewView {
  readonly tile: number;
  readonly text: PreviewText;
  /** Name of the building. */
  readonly name: string;
  /** Gold it costs, when it costs any. */
  readonly cost?: number;
  /** A finger confirms with a button on the card. */
  readonly touch: boolean;
}

/**
 * Where a build click would land, before it is made: a ring on the tile,
 * green when it would go through and red when it would not, a card with
 * the building's price and the reason, and the circle of its reach.
 * The structure itself is drawn by the map, faded in the player's colour.
 */
export class BuildPreview {
  readonly element: HTMLElement;
  private readonly reach = h("span", { class: "bp-reach", hidden: true });
  private readonly name = h("strong", { class: "bp-name" });
  private readonly cost = h("span", { class: "bp-cost" });
  private readonly status = h("span", { class: "bp-status" });
  private readonly detail = h("span", { class: "bp-detail" });
  private readonly confirm = h("button", {
    type: "button",
    class: "bp-confirm primary",
    "data-i18n": "preview.confirm",
    hidden: true,
  });
  private readonly card: HTMLElement;
  /** A point on the tile, which the ring, the reach and the card are placed around. */
  private readonly anchor: HTMLElement;
  private tile: number | undefined;
  private radius: number | undefined;

  constructor(onConfirm: () => void) {
    this.card = h(
      "div",
      { class: "bp-card" },
      h("span", { class: "bp-title" }, this.name, this.cost),
      this.status,
      this.detail,
      this.confirm,
    );
    this.anchor = h(
      "span",
      { class: "bp-anchor" },
      this.reach,
      h("span", { class: "bp-ring", "aria-hidden": "true" }),
      this.card,
    );
    this.element = h("div", { class: "build-preview", hidden: true }, this.anchor);
    applyTranslations(this.card);
    this.confirm.addEventListener("click", onConfirm);
  }

  /** Shows the preview on a tile, or moves it there. */
  show(view: PreviewView): void {
    const { text } = view;
    this.tile = view.tile;
    this.radius = text.radius;
    this.anchor.dataset.ok = String(text.ok);
    this.name.textContent = view.name;
    this.cost.textContent =
      view.cost === undefined ? "" : t("preview.cost", { cost: formatCount(view.cost) });
    this.status.textContent = t(text.status);
    this.detail.textContent = text.note
      ? t(text.note)
      : text.radius === undefined
        ? ""
        : t("preview.reach", { radius: text.radius });
    this.detail.hidden = this.detail.textContent === "";
    this.confirm.hidden = !(view.touch && text.ok);
    this.reach.hidden = text.radius === undefined;
    this.element.hidden = false;
  }

  hide(): void {
    this.tile = undefined;
    this.element.hidden = true;
  }

  get shown(): boolean {
    return this.tile !== undefined;
  }

  /** Keeps the ring on its tile as the camera moves; call every frame. */
  place(camera: Camera & { readonly scale?: number }): void {
    if (this.tile === undefined) return;
    const { x, y } = camera.tileToScreen(this.tile);
    const off =
      x < -EDGE || y < -EDGE || x > camera.viewportWidth + EDGE || y > camera.viewportHeight + EDGE;
    this.anchor.hidden = off;
    if (off) return;
    this.anchor.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    if (this.radius !== undefined && camera.scale !== undefined) {
      const side = Math.max(MIN_REACH_PIXELS, this.radius * 2 * camera.scale);
      this.reach.style.width = `${side.toFixed(0)}px`;
      this.reach.style.height = `${side.toFixed(0)}px`;
    }
    // The card keeps inside the screen, and goes under the ring near the top.
    const half = this.card.offsetWidth / 2;
    const low = EDGE + half;
    const high = camera.viewportWidth - EDGE - half;
    const shift = low > high ? camera.viewportWidth / 2 - x : Math.min(Math.max(x, low), high) - x;
    this.card.style.translate = `calc(-50% + ${shift.toFixed(0)}px) 0`;
    this.card.classList.toggle("below", y < this.card.offsetHeight + 40);
  }
}
