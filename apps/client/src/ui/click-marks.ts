import type { ClickOutcome } from "../game/messages.ts";
import type { MessageKey } from "../i18n/index.ts";
import { t } from "../i18n/index.ts";
import type { Camera } from "../render/camera.ts";
import { h } from "./dom.ts";

/** How long a mark stays on the map, in milliseconds; the CSS animation matches it. */
const MARK_MS = 700;
/** An online order whose turn never came back (refused by the server) stops waiting after this. */
const PENDING_MS = 3000;
/** How long the reason for a refused click stays up. */
const NOTE_MS = 2500;

/** A ring this far outside the view, in CSS pixels, is hidden rather than moved. */
const OFF_SCREEN = 64;

const REFUSALS: Partial<Record<ClickOutcome, MessageKey>> = {
  terrain: "click.terrain",
  own: "click.own",
  troops: "click.troops",
  unreachable: "click.unreachable",
  ships: "click.ships",
  early: "click.early",
  foreign: "click.foreign",
  crowded: "click.crowded",
  land: "click.land",
  gold: "click.gold",
  nothing: "click.nothing",
};

interface Mark {
  readonly tile: number;
  readonly element: HTMLElement;
  until: number;
}

/**
 * The answer to a click, where it happened: a ring that opens out on the
 * target of an order, a red one and a short reason when nothing was sent.
 * Online, the ring of an order holds, pulsing, until the turn that carries
 * it comes back from the server.
 */
export class ClickMarks {
  readonly element = h("div", { class: "click-marks", "aria-hidden": "true" });
  /** Reasons are read out by screen readers, unlike the rings. */
  readonly note = h("p", { class: "click-note", role: "status", hidden: true });
  private marks: Mark[] = [];
  /** Online orders sent and not yet back, oldest first. */
  private pending: Mark[] = [];
  private noteUntil = 0;

  /** `waiting`: an online order, shown until `arrived` says its turn is back. */
  show(tile: number, outcome: ClickOutcome, now: number, waiting = false): void {
    const refusal = REFUSALS[outcome];
    if (outcome === "over") return;
    const held = waiting && !refusal;
    const element = h("span", {
      class: refusal ? "click-mark refused" : `click-mark ${outcome}${held ? " pending" : ""}`,
    });
    this.element.append(element);
    const mark = { tile, element, until: now + (held ? PENDING_MS : MARK_MS) };
    this.marks.push(mark);
    if (held) this.pending.push(mark);
    if (refusal) {
      this.note.textContent = t(refusal);
      this.note.hidden = false;
      this.noteUntil = now + NOTE_MS;
    }
  }

  /** `count` of this player's orders came back in a turn: their rings open out. */
  arrived(count: number, now: number): void {
    for (const mark of this.pending.splice(0, count)) {
      mark.element.classList.remove("pending");
      mark.until = now + MARK_MS;
    }
  }

  /** Keeps the rings on their tiles as the camera moves; call every frame. */
  place(camera: Camera, now: number): void {
    this.marks = this.marks.filter((mark) => {
      if (now < mark.until) return true;
      mark.element.remove();
      return false;
    });
    this.pending = this.pending.filter((mark) => now < mark.until);
    for (const mark of this.marks) {
      const { x, y } = camera.tileToScreen(mark.tile);
      // Behind a globe, a tile is placed far off screen.
      mark.element.hidden =
        x < -OFF_SCREEN ||
        y < -OFF_SCREEN ||
        x > camera.viewportWidth + OFF_SCREEN ||
        y > camera.viewportHeight + OFF_SCREEN;
      mark.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    if (!this.note.hidden && now > this.noteUntil) this.note.hidden = true;
  }
}
