import { youOf } from "../game/selectors.ts";
import "./guide.css";
import { getLanguage, type Language } from "../i18n/index.ts";
import type { GameUpdate } from "../game/game-runner.ts";
import { h, setText } from "../dom.ts";

/**
 * Short explanations that show once, the first time something happens that a
 * new player may not understand. They sit in the guide's spot and wait while
 * the guide's card is up, never block the game, and give way to a click on
 * Got it or after a while. Like the tutorial's texts, they load only when a
 * game first needs them, so they weigh nothing on the first visit. No figure
 * of the balance is written in them.
 */
const EN = {
  title: "Good to know",
  ok: "Got it",
  off: "Stop these tips",
  attacked:
    "You are being attacked. The troops you keep at home defend you: send a smaller share, build a fort on that front, or ask the attacker for an alliance.",
  embargo:
    "An embargo cuts trade between you and that player: your trade ships no longer reach their ports, so you earn less gold.",
  request:
    "A player asks you for an alliance. An ally cannot attack you and may send you troops and gold. Answer in the requests list; betraying an ally is paid for.",
  gold: "Your gold is idle. Spend it: a city raises your troop cap, a fort holds a front under attack, a port brings trade.",
  fallout:
    "Fallout stays on land a missile hit. Taking a tile there costs more than usual, and it fades with time.",
} as const;

export type HintId = Exclude<keyof typeof EN, "title" | "ok" | "off">;

const FR: Readonly<Record<keyof typeof EN, string>> = {
  title: "Bon à savoir",
  ok: "Compris",
  off: "Plus de conseils",
  attacked:
    "On vous attaque. Les troupes gardées à la maison vous défendent : envoyez une part plus petite, bâtissez un fort sur ce front, ou proposez une alliance à l’attaquant.",
  embargo:
    "Un embargo coupe le commerce entre vous et ce joueur : vos navires de commerce n’atteignent plus ses ports, vous gagnez moins d’or.",
  request:
    "Un joueur vous propose une alliance. Un allié ne peut pas vous attaquer et peut vous envoyer troupes et or. Répondez dans la liste des demandes ; trahir un allié se paie.",
  gold: "Votre or dort. Dépensez-le : une ville relève votre plafond de troupes, un fort tient un front attaqué, un port apporte du commerce.",
  fallout:
    "Les retombées restent sur la terre touchée par un missile. Y prendre une case coûte plus cher que d’habitude, et elles s’estompent avec le temps.",
};

export const hintsTexts: Readonly<Record<Language, Readonly<Record<keyof typeof EN, string>>>> = {
  en: EN,
  fr: FR,
};

/** Gold worth several cities, kept unspent. */
const IDLE_CITIES = 3;
/** How long a hint stays on screen if the player does not close it, in ticks of the game at ten a second. */
const SHOWN_TICKS = 200;

/** The first hint whose moment has come, that was not shown yet. */
export function due(update: GameUpdate, seen: readonly string[]): HintId | undefined {
  if (update.phase !== "play") return undefined;
  const you = youOf(update);
  if (!you?.alive) return undefined;
  const moments: [HintId, boolean][] = [
    ["attacked", (update.incoming?.length ?? 0) > 0],
    ["embargo", update.diplomacy.embargoedBy.length > 0],
    ["request", update.diplomacy.incoming.length > 0],
    ["fallout", update.fallout.length > 0],
    ["gold", update.build.cityCost > 0 && you.gold >= update.build.cityCost * IDLE_CITIES],
  ];
  return moments.find(([id, now]) => now && !seen.includes(id))?.[0];
}

/** The tips' card, in the guide's spot. */
export class Hints {
  readonly element: HTMLElement;
  private current: HintId | undefined;
  private shownAt = 0;
  private readonly title = h("h2", { class: "guide-title", id: "hint-title" });
  private readonly text = h("p", { class: "guide-text" });
  private readonly ok = h("button", { type: "button", class: "secondary" });
  private readonly off = h("button", { type: "button", class: "guide-hide" });

  constructor(
    private readonly onSeen: (id: HintId) => void,
    private readonly onOff: () => void,
  ) {
    this.ok.addEventListener("click", () => {
      this.close();
    });
    this.off.addEventListener("click", () => {
      this.close();
      this.onOff();
    });
    this.element = h(
      "section",
      { class: "panel guide hint", hidden: true, "aria-labelledby": "hint-title" },
      this.title,
      h("div", { "aria-live": "polite" }, this.text),
      h("div", { class: "guide-actions" }, this.off, this.ok),
    );
  }

  /** Whether a tip is on screen. */
  get open(): boolean {
    return this.current !== undefined;
  }

  show(id: HintId, tick: number): void {
    this.current = id;
    this.shownAt = tick;
    this.onSeen(id);
    this.fill();
    this.element.hidden = false;
  }

  /** Puts the tip away once it was up for a while. */
  tick(tick: number): void {
    if (this.current !== undefined && tick - this.shownAt > SHOWN_TICKS) this.close();
  }

  refresh(): void {
    if (this.current !== undefined) this.fill();
  }

  close(): void {
    this.current = undefined;
    this.element.hidden = true;
  }

  private fill(): void {
    const texts = hintsTexts[getLanguage()];
    setText(this.title, texts.title);
    setText(this.ok, texts.ok);
    setText(this.off, texts.off);
    if (this.current !== undefined) setText(this.text, texts[this.current]);
  }
}
