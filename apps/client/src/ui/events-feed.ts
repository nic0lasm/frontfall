import { t } from "../i18n/index.ts";
import { h } from "../dom.ts";
import type { FeedEntry } from "./feed-events.ts";

/** An entry stays this long, longer while the pointer or focus is on the feed. */
const LIFE_MS = 8000;
/** On a phone held upright the latest event takes the banner's place, for this long. */
const LIFE_PHONE_MS = 4000;
const LEAVE_MS = 200;
const SHOWN = 3;
/** A short window shows fewer, on one line each. */
const SHOWN_SHORT = 2;

/** Where a click on an entry takes the map. */
export interface FeedTarget {
  tile?: number | undefined;
  player?: number | undefined;
}

interface Item {
  entry: FeedEntry;
  count: number;
  at: number;
  element: HTMLLIElement;
  label: HTMLElement;
}

/**
 * What happens in the game, bottom right: a few lines that fade by
 * themselves, the same event counted rather than repeated, each one a button
 * that centres the map on it. A polite live region, so a screen reader reads
 * the new lines after what it is reading; the fade of its lines is the page's
 * own motion setting at work (styles.css).
 */
export class EventsFeed {
  readonly element = h("ul", { class: "events-feed", "aria-live": "polite" });
  private items: Item[] = [];
  private lastNow = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly go: (target: FeedTarget) => void,
    private readonly phone: Pick<MediaQueryList, "matches">,
    private readonly short: Pick<MediaQueryList, "matches">,
  ) {
    this.element.setAttribute("aria-label", t("feed.label"));
  }

  /** Adds the entry, or counts it again when the same one is still showing. */
  push(entry: FeedEntry, now: number): void {
    const same = this.items.find((item) => item.entry.key === entry.key);
    if (same) {
      same.count++;
      same.at = now;
      same.entry = entry;
      this.draw(same);
      // The newest line comes last, nearest the buttons.
      this.element.append(same.element);
      this.items.splice(this.items.indexOf(same), 1);
      this.items.push(same);
      return;
    }
    const label = h("span", { class: "feed-text" });
    const hint = entry.tile !== undefined || entry.player !== undefined;
    const body = hint
      ? h("button", { type: "button", class: "feed-entry", title: t("feed.centre") }, label)
      : h("span", { class: "feed-entry" }, label);
    const element = h("li", { class: `panel feed-item tone-${entry.tone}` }, body);
    if (!entry.mine) element.classList.add("feed-quiet");
    if (hint) {
      body.addEventListener("click", () => {
        this.go({ tile: item.entry.tile, player: item.entry.player });
      });
    }
    const item: Item = { entry, count: 1, at: now, element, label };
    this.draw(item);
    this.element.append(element);
    this.items.push(item);
    this.trim();
  }

  /** Lets old entries go even when no update comes, during a pause or after the game. */
  expire(now: number): void {
    const elapsed = now - this.lastNow;
    this.lastNow = now;
    // Read at leisure: nothing fades while the pointer or the focus is on the feed.
    if (this.items.length > 0 && this.held()) {
      for (const item of this.items) item.at += elapsed;
      return;
    }
    const life = this.phone.matches ? LIFE_PHONE_MS : LIFE_MS;
    for (const item of [...this.items]) {
      if (now - item.at > life) this.remove(item);
    }
  }

  /**
   * Puts the feed under `above`, the first-steps guide while it shows at the
   * top left; none puts it back where the style sheet has it.
   */
  /** Puts the feed under `above`, or back in its place. */
  below(above: { bottom: number } | undefined): void {
    const top = above ? `${String(Math.round(above.bottom + 8))}px` : "";
    // Called on every frame after an update: writing the same again would lay the page out for nothing.
    if (this.element.style.top !== top) this.element.style.top = top;
  }

  /** The label and hints again, in the current language. */
  refresh(): void {
    this.element.setAttribute("aria-label", t("feed.label"));
    for (const item of this.items) {
      item.element.querySelector("button")?.setAttribute("title", t("feed.centre"));
    }
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private held(): boolean {
    return this.element.matches(":hover, :focus-within");
  }

  private draw(item: Item): void {
    item.label.textContent =
      item.count > 1 ? `${item.entry.text} ×${String(item.count)}` : item.entry.text;
  }

  /** Keeps what fits: the player's own news first, then the latest of the rest. */
  private trim(): void {
    const limit = this.phone.matches ? 1 : this.short.matches ? SHOWN_SHORT : SHOWN;
    while (this.items.length > limit) {
      // One slot: the latest event wins. Otherwise the player's own news outlasts the rest.
      const victim =
        limit === 1
          ? this.items[0]
          : (this.items.find((item) => !item.entry.mine) ?? this.items[0]);
      if (!victim) return;
      this.remove(victim);
    }
  }

  private remove(item: Item): void {
    const index = this.items.indexOf(item);
    if (index < 0) return;
    this.items.splice(index, 1);
    item.element.classList.add("leaving");
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      item.element.remove();
    }, LEAVE_MS);
    this.timers.add(timer);
  }
}
