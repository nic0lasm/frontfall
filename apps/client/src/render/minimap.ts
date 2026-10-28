import { getLanguage, onLanguageChange, type Language } from "../i18n/index.ts";
import { h } from "../ui/dom.ts";
import type { ViewCamera } from "./camera.ts";
import { MinimapImage, rgbOf, viewPieces, type MinimapSource } from "./minimap-image.ts";

/** The picture is drawn at most this often: the map moves faster than anyone can read a corner of it. */
const DRAW_MS = 300;

/** Whether the minimap is open, kept between games. */
const STORAGE_KEY = "frontfall.minimap";

/** These texts travel with the minimap's code, so the first visit does not carry them. */
const TEXTS: Record<Language, { title: string; hide: string; show: string; hint: string }> = {
  en: {
    title: "Map",
    hide: "Hide the minimap",
    show: "Show the minimap",
    hint: "Minimap: click or drag to move the view",
  },
  fr: {
    title: "Carte",
    hide: "Masquer la mini-carte",
    show: "Afficher la mini-carte",
    hint: "Mini-carte : cliquez ou faites glisser pour déplacer la vue",
  },
};

/** Phones and short windows (docs/hud-layout.md): the minimap opens as a sheet. */
export const NARROW = "(width < 720px), (height < 560px)";

const SVG = "http://www.w3.org/2000/svg";
/** A cross to close the open minimap, and a folded map to unfold it. */
const FOLD = "M6 6l12 12M18 6L6 18";
const MAP = "M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v13.5M15 6.5V20";

export interface MinimapOptions {
  readonly source: MinimapSource;
  /** Owner of every tile, read in place. */
  readonly owners: Uint16Array;
  readonly maxOwner: number;
  /** The player at this screen, outlined. */
  readonly you: number;
  /** The camera of the current view, which changes when the globe switches with the flat map. */
  readonly camera: () => ViewCamera;
  /** The player picked a place on the minimap: the camera goes to this tile. */
  readonly onMove: (tile: number) => void;
  readonly storage?: Storage | undefined;
}

/**
 * A small map in a corner (docs/art-direction.md: the same palette as the
 * map): who owns what, the part of the map the camera shows, and the fronts
 * that moved lately. A click or a drag on it moves the view. It is a 2D
 * canvas drawn a few times a second, and not at all while it is folded, so
 * it costs the GPU nothing.
 */
export class Minimap {
  readonly element: HTMLElement;
  private readonly image: MinimapImage;
  private readonly canvas = h("canvas", { class: "minimap-canvas", "aria-hidden": "true" });
  private readonly context: CanvasRenderingContext2D | null;
  private readonly frame = h("div", { class: "minimap-view", "aria-hidden": "true" });
  private readonly frameSeam = h("div", {
    class: "minimap-view",
    "aria-hidden": "true",
    hidden: true,
  });
  private readonly map: HTMLElement;
  private readonly title = h("h2", { class: "minimap-title" });
  private readonly toggle = h("button", { type: "button", class: "minimap-toggle" });
  private readonly glyph = document.createElementNS(SVG, "path");
  /** The picture as the canvas takes it, sharing the image's pixels. */
  private readonly data: ImageData;
  private readonly palette: Uint8Array;
  private readonly stopLanguage: () => void;
  private open: boolean;
  private dirty = true;
  private lastDraw = -Infinity;
  private wasBurning = false;
  private shown = "";
  private dragging: number | undefined;
  private jumped = false;

  constructor(private readonly options: MinimapOptions) {
    const { source } = options;
    this.image = new MinimapImage(source);
    this.canvas.width = this.image.width;
    this.canvas.height = this.image.height;
    this.context = this.canvas.getContext("2d");
    this.data = new ImageData(this.image.pixels, this.image.width, this.image.height);
    this.palette = new Uint8Array((options.maxOwner + 1) * 3);
    this.open = this.restore();

    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "minimap-icon");
    svg.setAttribute("aria-hidden", "true");
    this.glyph.setAttribute("fill", "none");
    this.glyph.setAttribute("stroke", "currentColor");
    this.glyph.setAttribute("stroke-width", "2");
    this.glyph.setAttribute("stroke-linecap", "round");
    this.glyph.setAttribute("stroke-linejoin", "round");
    svg.append(this.glyph);
    this.toggle.append(svg);
    this.toggle.addEventListener("click", () => {
      this.setOpen(!this.open);
    });

    this.map = h(
      "div",
      { class: "minimap-map", role: "img" },
      this.canvas,
      this.frame,
      this.frameSeam,
    );
    // The size follows the map's proportions: a wide map is a wide strip.
    this.map.style.setProperty("--minimap-aspect", String(source.width / source.height));
    this.map.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      this.dragging = event.pointerId;
      this.jumped = false;
      this.map.setPointerCapture(event.pointerId);
      this.moveTo(event);
      event.preventDefault();
    });
    this.map.addEventListener("pointermove", (event) => {
      if (this.dragging === event.pointerId) this.moveTo(event);
    });
    const stop = (event: PointerEvent): void => {
      if (this.dragging !== event.pointerId) return;
      this.dragging = undefined;
      // A sheet over the map closes after a jump, to show where it landed.
      if (this.jumped && this.sheet()) this.setOpen(false);
    };
    this.map.addEventListener("pointerup", stop);
    this.map.addEventListener("pointercancel", stop);

    this.element = h(
      "section",
      { class: "panel minimap", id: "minimap" },
      this.title,
      this.toggle,
      this.map,
    );
    this.words();
    this.stopLanguage = onLanguageChange(() => {
      this.words();
    });
    this.sync();
  }

  /** Whether the minimap is open on a first visit: not on a phone, where it would cover the map. */
  private restore(): boolean {
    if (this.sheet()) return false;
    try {
      const kept = this.options.storage?.getItem(STORAGE_KEY);
      if (kept === "1" || kept === "0") return kept === "1";
    } catch {
      // Storage is blocked: the default holds.
    }
    return true;
  }

  private words(): void {
    const texts = TEXTS[getLanguage()];
    this.title.textContent = texts.title;
    this.map.setAttribute("aria-label", texts.hint);
    const label = this.open ? texts.hide : texts.show;
    this.toggle.setAttribute("aria-label", label);
    this.toggle.title = label;
  }

  /** Whether the open minimap is a sheet over the map: on a phone, or a window as short as one. */
  private sheet(): boolean {
    return window.matchMedia(NARROW).matches;
  }

  private setOpen(open: boolean): void {
    this.open = open;
    // The sheet of a phone is always folded at first: only a wide screen keeps the choice.
    if (!this.sheet()) {
      try {
        this.options.storage?.setItem(STORAGE_KEY, open ? "1" : "0");
      } catch {
        // Not kept: it only means the next game starts as it would have.
      }
    }
    this.sync();
    this.words();
    this.dirty = true;
    this.shown = "";
  }

  /** The element as the state asks: a panel with the map, or a single button. */
  private sync(): void {
    this.element.toggleAttribute("data-open", this.open);
    this.map.hidden = !this.open;
    this.title.hidden = !this.open;
    this.toggle.setAttribute("aria-expanded", String(this.open));
    this.glyph.setAttribute("d", this.open ? FOLD : MAP);
  }

  /** The tile under a pointer on the map, or none. */
  private moveTo(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const { width, height } = this.options.source;
    const x = Math.min(
      width - 1,
      Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * width)),
    );
    const y = Math.min(
      height - 1,
      Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * height)),
    );
    this.jumped = true;
    this.options.onMove(y * width + x);
  }

  /** The colour of a player's land. */
  setColor(owner: number, color: string): void {
    if (owner < 1 || owner > this.options.maxOwner) return;
    this.palette.set(rgbOf(color), owner * 3);
    this.dirty = true;
  }

  /** A tile changed hands. */
  noteChange(tile: number, before: number, after: number, now: number): void {
    const { you } = this.options;
    this.image.markFront(tile, before === you || after === you, now);
    this.dirty = true;
  }

  /** Everything changed at once, after a full resynchronisation. */
  noteAll(): void {
    this.dirty = true;
  }

  /**
   * Called every frame, and does something only when it should: the frame of
   * the view follows the camera at once, the picture is drawn a few times a
   * second and only while it has changed or a front is lit.
   */
  tick(now: number): void {
    if (!this.open) return;
    this.placeFrame();
    const burning = this.image.burning(now);
    if ((this.dirty || burning || this.wasBurning) && now - this.lastDraw >= DRAW_MS) {
      this.draw(now);
      this.dirty = false;
      this.wasBurning = burning;
      this.lastDraw = now;
    }
  }

  private draw(now: number): void {
    const { context, image } = this;
    if (!context) return;
    image.draw(this.options.owners, this.palette, this.options.you, now);
    context.putImageData(this.data, 0, 0);
  }

  /** The rectangle of the map the camera shows, where it is on the picture. */
  private placeFrame(): void {
    const { width, height } = this.options.source;
    const view = this.options.camera().view();
    const key = `${String(view.centerX)}:${String(view.centerY)}:${String(view.halfWidth)}:${String(view.halfHeight)}`;
    if (key === this.shown) return;
    this.shown = key;
    const pieces = viewPieces(view, width, height);
    const place = (element: HTMLElement, piece: (typeof pieces)[number] | undefined): void => {
      element.hidden = piece === undefined;
      if (!piece) return;
      const seamLeft = pieces.length > 1 && piece.left === 0;
      const seamRight = pieces.length > 1 && piece.left + piece.width >= 1;
      element.toggleAttribute("data-seam-left", seamLeft);
      element.toggleAttribute("data-seam-right", seamRight);
      element.style.left = `${String(piece.left * 100)}%`;
      element.style.top = `${String(piece.top * 100)}%`;
      element.style.width = `${String(piece.width * 100)}%`;
      element.style.height = `${String(piece.height * 100)}%`;
    };
    place(this.frame, pieces[0]);
    place(this.frameSeam, pieces[1]);
  }

  dispose(): void {
    this.stopLanguage();
    this.element.remove();
  }
}
