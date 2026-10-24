import type { GameRules } from "../game/messages.ts";
import type { DiplomacyEvent, GameUpdate } from "../game/solo-game.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { playerColor } from "../palette.ts";
import { h, swatch } from "./dom.ts";

/** An event stays in the feed this long. */
const EVENT_MS = 8000;
const EVENTS_SHOWN = 4;

export interface DiplomacyActions {
  /** Asks for an alliance, accepts one, or asks to renew one: the same order (R-DIPLO-01, -03). */
  onAlly(player: number): void;
  onBetray(player: number): void;
}

const EVENT_TEXT: Readonly<Record<DiplomacyEvent["type"], MessageKey>> = {
  allied: "diplo.eventAllied",
  ended: "diplo.eventEnded",
  betrayed: "diplo.eventBetrayed",
};

/**
 * Diplomacy on screen: the menu of one player, opened from the leaderboard
 * or from their land, the requests waiting for an answer, and a feed of
 * what happened between players.
 */
export class DiplomacyPanel {
  /** The player menu, shown while a player is picked. */
  readonly menu = h("section", {
    class: "panel player-menu",
    id: "player-menu",
    role: "dialog",
    "aria-labelledby": "player-menu-name",
    hidden: true,
  });
  readonly requests = h("ul", {
    class: "panel requests",
    "data-i18n-attr": "aria-label:diplo.requests",
    hidden: true,
  });
  /** Polite, so a screen reader hears it after what it is reading. */
  readonly feed = h("ul", { class: "event-feed", "aria-live": "polite" });
  private picked: number | undefined;
  /** The player menu asks once more before a betrayal. */
  private confirming = false;
  private last: GameUpdate | undefined;
  private readonly events: { at: number; element: HTMLElement }[] = [];
  /** Requests answered or set aside here: the stack hides them until they run out. */
  private readonly ignored = new Set<number>();
  private rules: Pick<GameRules, "ticksPerSecond" | "allianceRequestTicks"> = {
    ticksPerSecond: 10,
    allianceRequestTicks: 200,
  };
  /** Drawn content of the menu and the stack, to rebuild them only when it changes. */
  private menuKey = "";
  private requestsKey = "";

  constructor(private readonly actions: DiplomacyActions) {}

  get open(): boolean {
    return this.picked !== undefined;
  }

  setRules(rules: GameRules): void {
    this.rules = rules;
  }

  /** Opens the menu of a player other than the one at this screen; focus goes to its first button. */
  pick(player: number): void {
    const update = this.last;
    if (!update || player === update.you || player === 0) return;
    if (!update.players.some((p) => p.id === player && p.alive)) return;
    this.picked = player;
    this.confirming = false;
    this.menuKey = "";
    this.render(update, performance.now());
    const first = this.menu.querySelector<HTMLButtonElement>(".menu-action:not([disabled])");
    (first ?? this.menu.querySelector<HTMLButtonElement>("button"))?.focus();
  }

  close(): void {
    this.picked = undefined;
    this.confirming = false;
    this.menu.hidden = true;
    this.menu.replaceChildren();
    this.menuKey = "";
  }

  update(update: GameUpdate, now: number): void {
    this.last = update;
    for (const event of update.events) this.addEvent(event, update, now);
    this.render(update, now);
  }

  /** Redraws everything in the current language. */
  refresh(): void {
    this.menuKey = "";
    this.requestsKey = "";
    if (this.last) this.render(this.last, performance.now());
  }

  private render(update: GameUpdate, now: number): void {
    this.renderMenu(update);
    this.renderRequests(update);
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event && now - event.at > EVENT_MS) {
        event.element.remove();
        this.events.splice(i, 1);
      }
    }
  }

  private addEvent(event: DiplomacyEvent, update: GameUpdate, now: number): void {
    const name = (id: number) => update.players.find((p) => p.id === id)?.name ?? "";
    const text = t(EVENT_TEXT[event.type], { a: name(event.a), b: name(event.b) });
    const element = h("li", { class: `event event-${event.type}` }, text);
    this.feed.append(element);
    this.events.push({ at: now, element });
    while (this.events.length > EVENTS_SHOWN) this.events.shift()?.element.remove();
  }

  private seconds(ticks: number): number {
    return Math.ceil(ticks / this.rules.ticksPerSecond);
  }

  private renderMenu(update: GameUpdate): void {
    const id = this.picked;
    const player = update.players.find((p) => p.id === id);
    if (id === undefined || !player?.alive) {
      if (id !== undefined) this.close();
      return;
    }
    const { diplomacy } = update;
    const ally = diplomacy.allies.find((a) => a.id === id);
    const asked = diplomacy.incoming.some((r) => r.from === id);
    const pending = diplomacy.outgoing.includes(id);
    const waiting = diplomacy.waiting.includes(id);
    const traitor = diplomacy.traitors.find((x) => x.id === id);
    const playing = update.phase === "play" && update.winner === undefined;

    let status: string;
    if (ally) status = t("diplo.allyFor", { seconds: this.seconds(ally.ticksLeft) });
    else if (asked) status = t("diplo.asksYou");
    else if (pending) status = t("diplo.asked");
    else status = t("diplo.notAllied");
    const traitorText = traitor
      ? t("diplo.traitorFor", { seconds: this.seconds(traitor.ticksLeft) })
      : "";

    const buttons: { key: MessageKey; action: () => void; enabled: boolean; className: string }[] =
      [];
    if (ally) {
      if (ally.renewable) {
        buttons.push({
          key: ally.renewing ? "diplo.renewSent" : "diplo.renew",
          action: () => {
            this.actions.onAlly(id);
          },
          enabled: playing && !ally.renewing,
          className: "renew",
        });
      }
      buttons.push(
        this.confirming
          ? {
              key: "diplo.betrayConfirm",
              action: () => {
                this.actions.onBetray(id);
                this.close();
              },
              enabled: playing,
              className: "betray danger",
            }
          : {
              key: "diplo.betray",
              action: () => {
                this.confirming = true;
                this.menuKey = "";
                this.renderMenu(update);
                this.menu.querySelector<HTMLButtonElement>(".betray")?.focus();
              },
              enabled: playing,
              className: "betray",
            },
      );
    } else {
      buttons.push({
        key: asked
          ? "diplo.accept"
          : pending
            ? "diplo.askSent"
            : waiting
              ? "diplo.wait"
              : "diplo.ask",
        action: () => {
          this.actions.onAlly(id);
        },
        enabled: playing && (asked || (!pending && !waiting)),
        className: "ask",
      });
    }

    const key = [
      id,
      player.name,
      status,
      traitorText,
      this.confirming,
      ...buttons.map((b) => `${b.key}:${String(b.enabled)}`),
    ].join("|");
    if (key === this.menuKey) return;
    // Focus stays on the button of the same kind when the menu is redrawn.
    const focused = this.menu.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.kind
      : undefined;
    this.menuKey = key;
    const close = h("button", {
      type: "button",
      class: "icon-button icon-close",
      "data-kind": "close",
      "aria-label": t("diplo.close"),
      title: t("diplo.close"),
    });
    close.addEventListener("click", () => {
      this.close();
    });
    this.menu.replaceChildren(
      h(
        "header",
        { class: "player-menu-head" },
        swatch(playerColor(id - 1).hex),
        h("h2", { id: "player-menu-name" }, player.name),
        close,
      ),
      h("p", { class: "player-menu-status" }, status),
      ...(traitorText ? [h("p", { class: "player-menu-traitor" }, traitorText)] : []),
      ...buttons.map(({ key: label, action, enabled, className }) => {
        const button = h(
          "button",
          { type: "button", class: `menu-action ${className}`, "data-kind": className },
          t(label),
        );
        button.disabled = !enabled;
        button.addEventListener("click", action);
        return button;
      }),
    );
    this.menu.hidden = false;
    if (focused) this.menu.querySelector<HTMLElement>(`[data-kind="${focused}"]`)?.focus();
  }

  private renderRequests(update: GameUpdate): void {
    const incoming = update.diplomacy.incoming;
    for (const from of this.ignored) {
      if (!incoming.some((r) => r.from === from)) this.ignored.delete(from);
    }
    const shown = incoming.filter((r) => !this.ignored.has(r.from));
    const total = this.rules.allianceRequestTicks;
    const key = shown
      .map((r) => `${String(r.from)}:${String(this.seconds(r.ticksLeft))}`)
      .join(",");
    if (key === this.requestsKey) return;
    this.requestsKey = key;
    this.requests.hidden = shown.length === 0;
    const focused = this.requests.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.kind
      : undefined;
    this.requests.replaceChildren(
      ...shown.map(({ from, ticksLeft }) => {
        const name = update.players.find((p) => p.id === from)?.name ?? "";
        const accept = h(
          "button",
          { type: "button", class: "request-accept", "data-kind": `accept-${String(from)}` },
          t("diplo.accept"),
        );
        accept.addEventListener("click", () => {
          this.actions.onAlly(from);
          this.ignored.add(from);
          this.requestsKey = "";
        });
        const ignore = h(
          "button",
          { type: "button", class: "request-ignore", "data-kind": `ignore-${String(from)}` },
          t("diplo.ignore"),
        );
        ignore.addEventListener("click", () => {
          this.ignored.add(from);
          this.requestsKey = "";
          if (this.last) this.renderRequests(this.last);
        });
        const left = h("span", { class: "request-time-left" });
        left.style.width = `${String(Math.min(100, (ticksLeft / Math.max(1, total)) * 100))}%`;
        return h(
          "li",
          { class: "request" },
          swatch(playerColor(from - 1).hex),
          h(
            "span",
            { class: "request-text" },
            t("diplo.request", { name, seconds: this.seconds(ticksLeft) }),
          ),
          h("span", { class: "request-time", "aria-hidden": "true" }, left),
          accept,
          ignore,
        );
      }),
    );
    if (focused) this.requests.querySelector<HTMLElement>(`[data-kind="${focused}"]`)?.focus();
  }
}
