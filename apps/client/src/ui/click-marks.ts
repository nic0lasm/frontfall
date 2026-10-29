import type { ClickOutcome } from "../game/messages.ts";
import type { ClickNote } from "../game/solo-game.ts";
import type { MessageKey } from "../i18n/index.ts";
import { t } from "../i18n/index.ts";
import type { Camera } from "../render/camera.ts";
import { h } from "./dom.ts";

/** How long a mark stays on the map, in milliseconds; the CSS animation matches it. */
const MARK_MS = 700;
/** An online order whose turn never came back (refused by the server) stops waiting after this. */
const PENDING_MS = 3000;
/** How long the reason for a refused click stays up: long enough to read twice. */
const NOTE_MS = 4000;

/** A ring this far outside the view, in CSS pixels, is hidden rather than moved. */
const OFF_SCREEN = 64;

/** The reason shown for each refused click. */
export const REFUSALS: Partial<Record<ClickOutcome, MessageKey>> = {
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
  ally: "click.ally",
  teammate: "click.teammate",
  coast: "click.coast",
  port: "click.port",
  warships: "click.warships",
  noWarship: "click.noWarship",
  silo: "click.silo",
  shore: "click.shore",
  allyNear: "click.allyNear",
  disabled: "click.disabled",
};

const NOTES: Record<ClickNote, MessageKey> = {
  lake: "click.lake",
};

interface Mark {
  tile: number;
  readonly element: HTMLElement;
  until: number;
}

/**
 * The answer to a click, where it happened: a ring that opens out on the
 * target of an order, a red one and a short reason when nothing was sent.
 * Online, the ring of an order holds, pulsing, until the turn that carries
 * it comes back from the server. The ring is there from the moment the
 * pointer goes down, before the game has read the click.
 */
export class ClickMarks {
  readonly element = h("div", { class: "click-marks", "aria-hidden": "true" });
  /** Reasons are read out by screen readers, unlike the rings. */
  readonly note = h("p", { class: "click-note", id: "click-note", role: "status", hidden: true });
  private marks: Mark[] = [];
  /** Online orders sent and not yet back, oldest first. */
  private pending: Mark[] = [];
  /** Under a press that may become a click. */
  private press: Mark | undefined;
  /** Clicks the game has not answered yet, oldest first: `show` turns each into its answer. */
  private sent: Mark[] = [];
  private noteUntil = 0;

  /**
   * `waiting`: an online order, shown until `arrived` says its turn is back.
   * `action`: the name of the build refused, said before the reason.
   * `note`: shown under the map like a reason, for an order sent all the same.
   */
  show(
    tile: number,
    outcome: ClickOutcome,
    now: number,
    waiting = false,
    action?: string,
    note?: ClickNote,
  ): void {
    const refusal = REFUSALS[outcome];
    const asked = this.sent.shift();
    if (outcome === "over") {
      if (asked) asked.until = now;
      return;
    }
    const held = waiting && !refusal;
    const className = refusal
      ? "click-mark refused"
      : `click-mark ${outcome}${held ? " pending" : ""}`;
    const until = now + (held ? PENDING_MS : MARK_MS);
    let mark: Mark;
    if (asked) {
      // The ring shown since the press becomes the answer, where the game read the click.
      mark = asked;
      mark.tile = tile;
      mark.element.className = className;
      mark.until = until;
    } else {
      mark = { tile, element: h("span", { class: className }), until };
      this.element.append(mark.element);
      this.marks.push(mark);
    }
    if (held) this.pending.push(mark);
    if (refusal || note) {
      this.note.textContent = refusal
        ? action === undefined
          ? t(refusal)
          : t("hud.named", { action, reason: t(refusal) })
        : t(NOTES[note as ClickNote]);
      this.note.hidden = false;
      this.noteUntil = now + NOTE_MS;
    }
  }

  /** A press began on `tile`: a ring under it at once, until it becomes a click or not. */
  pressed(tile: number, now: number): void {
    this.unpress(now);
    const element = h("span", { class: "click-mark pressed" });
    this.element.append(element);
    this.press = { tile, element, until: now + PENDING_MS };
    this.marks.push(this.press);
  }

  /** The press ended without a click: its ring goes. */
  unpress(now: number): void {
    if (this.press) this.press.until = now;
    this.press = undefined;
  }

  /** A click on `tile` went to the game: its ring waits there for the answer. */
  clicked(tile: number, now: number): void {
    let mark = this.press;
    this.press = undefined;
    if (mark) {
      mark.tile = tile;
      mark.until = now + PENDING_MS;
    } else {
      mark = { tile, element: h("span", { class: "click-mark pressed" }), until: now + PENDING_MS };
      this.element.append(mark.element);
      this.marks.push(mark);
    }
    this.sent.push(mark);
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
    this.sent = this.sent.filter((mark) => now < mark.until);
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
