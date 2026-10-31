import { DOCTRINE_EFFECTS, Doctrine, type DoctrineEffects } from "@frontfall/engine";
import type { GameUpdate } from "../game/solo-game.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { h, setText } from "./dom.ts";

/** The doctrines offered, in the order of their cards (R-DOCTRINE). */
const OFFERED = [Doctrine.Conqueror, Doctrine.Merchant, Doctrine.Bastion] as const;
const KEYS = ["conqueror", "merchant", "bastion"] as const;

/** Effects whose figure is better lower: what a tile costs, what a fort costs. */
const LOWER_IS_BETTER: ReadonlySet<keyof DoctrineEffects> = new Set([
  "attackerLoss",
  "defenderLoss",
  "fortCost",
]);

/** The lines of a doctrine's card: every effect that is not 100 %, as +10 % or −8 %, and whether it helps the player. */
export function effectLines(code: number): { text: string; good: boolean }[] {
  const effects = DOCTRINE_EFFECTS[code];
  if (!effects) return [];
  return (Object.keys(effects) as (keyof DoctrineEffects)[]).flatMap((name) => {
    const change = effects[name] - 100;
    if (change === 0) return [];
    const good = LOWER_IS_BETTER.has(name) ? change < 0 : change > 0;
    const sign = change > 0 ? "+" : "−";
    return [
      {
        text: t(`doctrine.effect.${name}` as MessageKey, {
          value: `${sign}${String(Math.abs(change))} %`,
        }),
        good,
      },
    ];
  });
}

/**
 * The choice of a doctrine (R-DOCTRINE-01): three cards over the map for the
 * spawn phase of a game with doctrines, each a button with its effects. The
 * choice can be changed until the phase ends; a player who picks nothing
 * plays the balanced doctrine, which changes nothing.
 */
export class DoctrinePicker {
  readonly element = h("section", {
    class: "doctrine-picker",
    "aria-labelledby": "doctrine-title",
    hidden: true,
  });
  private readonly title = h("h2", { id: "doctrine-title", class: "doctrine-title" });
  private readonly timer = h("p", { class: "doctrine-timer" });
  private readonly cards: HTMLButtonElement[] = [];
  /** The pick sent, shown at once rather than when the update carrying it arrives. */
  private pending: number | undefined;

  constructor(private readonly onPick: (pick: number) => void) {
    const cards = h("div", { class: "doctrine-cards" });
    for (const code of OFFERED) {
      const card = h("button", {
        type: "button",
        class: "doctrine-card",
        "aria-pressed": "false",
      });
      card.addEventListener("click", () => {
        this.pending = code;
        this.onPick(code);
        this.mark(code);
      });
      this.cards.push(card);
      cards.append(card);
    }
    this.element.append(this.title, this.timer, cards);
    this.translate();
  }

  /** Writes the cards in the current language. */
  translate(): void {
    this.title.textContent = t("doctrine.title");
    for (const [i, card] of this.cards.entries()) {
      const key = KEYS[i] as (typeof KEYS)[number];
      card.replaceChildren(
        h("strong", { class: "doctrine-name" }, t(`doctrine.${key}` as MessageKey)),
        h("span", { class: "doctrine-idea" }, t(`doctrine.${key}Idea` as MessageKey)),
        h(
          "ul",
          { class: "doctrine-effects" },
          ...effectLines(OFFERED[i] as number).map(({ text, good }) =>
            h("li", { class: good ? "doctrine-good" : "doctrine-bad" }, text),
          ),
        ),
      );
    }
  }

  /** Shows the cards while the spawn phase of a game with doctrines lasts, and the pick the engine has. */
  update(update: GameUpdate, ticksPerSecond: number): void {
    const open = update.doctrines === true && update.phase === "spawn";
    if (this.element.hidden === open) {
      this.element.hidden = !open;
      // Lets the stylesheet clear the first-steps card on a phone while the cards are up.
      document.body.classList.toggle("doctrines-open", open);
      if (!open) this.pending = undefined;
    }
    if (!open) return;
    const you = update.players.find((player) => player.id === update.you);
    const seconds = Math.ceil(update.spawnTicksLeft / ticksPerSecond);
    setText(this.timer, t("doctrine.timer", { seconds }));
    this.mark(this.pending ?? you?.doctrine);
  }

  private mark(pick: number | undefined): void {
    for (const [i, card] of this.cards.entries()) {
      card.setAttribute("aria-pressed", String(OFFERED[i] === pick));
    }
  }
}
