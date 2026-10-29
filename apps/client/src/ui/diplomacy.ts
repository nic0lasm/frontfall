import { Disable, QUICK_MESSAGES } from "@frontfall/engine";
import type { ReportReason } from "@frontfall/protocol";
import type { GameRules } from "../game/messages.ts";
import type { GameUpdate } from "../game/solo-game.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { colorOf } from "../palette.ts";
import { h, swatch } from "./dom.ts";
import { formatPercent } from "./format.ts";
import { icon } from "./icons.ts";

type FactsLine = (
  update: GameUpdate,
  id: number,
  rules: Pick<GameRules, "ticksPerSecond" | "firstNation" | "teams" | "ownableTiles">,
) => string;

export interface DiplomacyActions {
  /**
   * Asks for an alliance, accepts one, or asks to renew one: the same order
   * (R-DIPLO-01, -03). False when it was not sent, during a pause or after the game.
   */
  onAlly(player: number): boolean;
  onBetray(player: number): void;
  /** Starts (`on` true) or lifts an embargo on the player's trade (R-DIPLO-05). */
  onEmbargo(player: number, on: boolean): void;
  /** Sends the player the attack ratio's share of the troops or of the gold (R-DIPLO-06). */
  onGift(player: number, what: "troops" | "gold"): void;
  /** The attack ratio, in percent: the share a gift sends. */
  share(): number;
  /** Sends the player a preset quick message, by number (R-DIPLO-07). */
  onQuick(player: number, phrase: number): void;
  /** Whether the player is hidden on this screen, or undefined when they cannot be (R-DIPLO-08). */
  hidden(player: number): boolean | undefined;
  /** Hides the player on this screen, or shows them again. */
  onHide(player: number, hide: boolean): void;
  /** Whether the player was reported from here, or undefined when they cannot be (R-MODE-06). */
  reported(player: number): boolean | undefined;
  /** Reports the player to the operator of the server. */
  onReport(player: number, reason: ReportReason): void;
}

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
  private picked: number | undefined;
  /** The player menu asks once more before a betrayal. */
  private confirming = false;
  /** The player menu shows its quick messages. */
  private messaging = false;
  /** The player menu shows the reasons of a report. */
  private reporting = false;
  /** The server turned down the last report from this menu. */
  private refused = false;
  /** The reasons of a report, loaded when first asked for. */
  private reasonsPanel: typeof import("./report-panel.ts") | undefined;
  private last: GameUpdate | undefined;
  /** Requests answered or set aside here: the stack hides them until they run out. */
  private readonly ignored = new Set<number>();
  private rules: Pick<
    GameRules,
    | "ticksPerSecond"
    | "allianceRequestTicks"
    | "firstNation"
    | "teams"
    | "disabled"
    | "ownableTiles"
  > = {
    ticksPerSecond: 10,
    allianceRequestTicks: 200,
    firstNation: Infinity,
    teams: [],
    disabled: 0,
    ownableTiles: 1,
  };
  /** Troops, gold and land of a player in a line, once its code is fetched (screen/feed-host.ts). */
  private facts: FactsLine | undefined;
  /** Drawn content of the menu and the stack, to rebuild them only when it changes. */
  private menuKey = "";
  /** What had focus before the menu opened. */
  private opener: HTMLElement | undefined;
  private requestsKey = "";

  constructor(private readonly actions: DiplomacyActions) {}

  get open(): boolean {
    return this.picked !== undefined;
  }

  setFacts(facts: FactsLine): void {
    this.facts = facts;
    this.menuKey = "";
  }

  setRules(rules: GameRules): void {
    this.rules = rules;
  }

  /** Opens the menu of a player other than the one at this screen; focus goes to its first button. */
  pick(player: number): void {
    const update = this.last;
    if (!update || player === update.you || player === 0) return;
    if (!update.players.some((p) => p.id === player && p.alive)) return;
    // A long press can also raise the browser's menu event: the same pick twice keeps its state.
    if (this.picked === player) return;
    if (this.picked === undefined && document.activeElement instanceof HTMLElement) {
      this.opener = document.activeElement;
    }
    this.picked = player;
    this.confirming = false;
    this.messaging = false;
    this.reporting = false;
    this.refused = false;
    this.menuKey = "";
    this.render(update);
    const first = this.menu.querySelector<HTMLButtonElement>(".menu-action:not([disabled])");
    (first ?? this.menu.querySelector<HTMLButtonElement>("button"))?.focus();
  }

  /** Focus goes back to where the menu was opened from, if it had moved into the menu. */
  close(): void {
    const inside = this.menu.contains(document.activeElement);
    this.picked = undefined;
    this.confirming = false;
    this.messaging = false;
    this.reporting = false;
    this.refused = false;
    this.menu.hidden = true;
    this.menu.replaceChildren();
    this.menuKey = "";
    if (inside || document.activeElement === document.body) this.opener?.focus();
    this.opener = undefined;
  }

  update(update: GameUpdate): void {
    this.last = update;
    this.render(update);
  }

  /** Redraws with the names of `update`, adding none of its events again. */
  rename(update: GameUpdate): void {
    this.last = update;
    this.render(update);
  }

  /** Redraws everything in the current language. */
  refresh(): void {
    this.menuKey = "";
    this.requestsKey = "";
    if (this.last) this.render(this.last);
  }

  private render(update: GameUpdate): void {
    this.renderMenu(update);
    this.renderRequests(update);
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
    // Teammates stay allies for the whole game (R-MODE-02): nothing to ask or betray.
    const teammate = diplomacy.teammates.includes(id);
    const asked = diplomacy.incoming.some((r) => r.from === id);
    const pending = diplomacy.outgoing.includes(id);
    const waiting = diplomacy.waiting.includes(id);
    const traitor = diplomacy.traitors.find((x) => x.id === id);
    const playing = update.phase === "play" && update.winner === undefined;
    // Nations answer on their own terms (R-BOT-19): say them before the player asks.
    const nation = id >= this.rules.firstNation;

    let status: string;
    if (teammate) status = t("diplo.teammate");
    else if (ally) status = t("diplo.allyFor", { seconds: this.seconds(ally.ticksLeft) });
    else if (asked) status = t("diplo.asksYou");
    else if (pending) status = t("diplo.asked");
    else if (nation) status = t("diplo.nation");
    else status = t("diplo.notAllied");
    const traitorText = traitor
      ? t("diplo.traitorFor", { seconds: this.seconds(traitor.ticksLeft) })
      : "";
    const embargoing = diplomacy.embargoes.includes(id);
    const embargoText = [
      ...(embargoing ? [t("diplo.embargoing")] : []),
      ...(diplomacy.embargoedBy.includes(id) ? [t("diplo.embargoedBy")] : []),
    ].join(" · ");

    const buttons: {
      key: MessageKey;
      params?: Record<string, string>;
      action: () => void;
      enabled: boolean;
      className: string;
    }[] = [];
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
    } else if (!teammate) {
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

    // An embargo cuts trade, which a game without ports has none of (R-MODE-03).
    if (!teammate && (this.rules.disabled & Disable.Port) === 0) {
      buttons.push({
        key: embargoing ? "diplo.liftEmbargo" : "diplo.embargo",
        action: () => {
          this.actions.onEmbargo(id, !embargoing);
        },
        enabled: playing,
        className: "embargo",
      });
    }

    // Gifts go to anyone not at war with the player (R-DIPLO-06).
    const war = diplomacy.atWar.includes(id);
    const you = update.players.find((p) => p.id === update.you);
    const share = this.actions.share();
    const percent = { percent: formatPercent(share / 100) };
    // Troops go only where the receiver's cap has room for them.
    const room = player.cap > player.troops;
    for (const what of ["troops", "gold"] as const) {
      buttons.push({
        key: what === "troops" ? "diplo.sendTroops" : "diplo.sendGold",
        params: percent,
        action: () => {
          this.actions.onGift(id, what);
        },
        enabled:
          playing &&
          !war &&
          Math.floor(((you?.[what] ?? 0) * share) / 100) >= 1 &&
          (what === "gold" || room),
        className: `gift-${what}`,
      });
    }
    const warText = war ? t("diplo.atWar") : "";
    buttons.push({
      key: this.messaging ? "diplo.messagesHide" : "diplo.messages",
      action: () => {
        this.messaging = !this.messaging;
        this.menuKey = "";
        this.renderMenu(update);
        this.menu.querySelector<HTMLButtonElement>(".messages")?.focus();
      },
      // A message every QUICK_MESSAGE_TICKS at most: the button waits in between.
      enabled: playing && (this.messaging || diplomacy.quickIn === 0),
      className: "messages",
    });

    const hidden = this.actions.hidden(id);
    if (hidden !== undefined) {
      buttons.push({
        key: hidden ? "diplo.unhide" : "diplo.hide",
        action: () => {
          this.actions.onHide(id, !hidden);
          this.menu.querySelector<HTMLButtonElement>(".hide")?.focus();
        },
        enabled: true,
        className: "hide",
      });
    }
    const hiddenText = hidden ? t("diplo.hiddenNote") : "";

    const reported = this.actions.reported(id);
    if (reported !== undefined) {
      buttons.push({
        key: reported ? "diplo.reported" : "diplo.report",
        action: () => {
          void (this.reasonsPanel ? Promise.resolve() : import("./report-panel.ts")).then(
            (loaded) => {
              if (loaded) this.reasonsPanel = loaded;
              // The menu may have closed or moved to another player meanwhile.
              if (this.picked !== id) return;
              this.reporting = !this.reporting;
              this.menuKey = "";
              this.renderMenu(this.last ?? update);
              this.menu.querySelector<HTMLButtonElement>(".report")?.focus();
            },
          );
        },
        enabled: !reported,
        className: "report",
      });
    }

    const key = [
      id,
      player.name,
      hiddenText,
      status,
      traitorText,
      embargoText,
      warText,
      this.confirming,
      this.messaging,
      this.reporting,
      this.refused,
      ...buttons.map((b) => `${b.key}:${JSON.stringify(b.params ?? {})}:${String(b.enabled)}`),
    ].join("|");
    // Troops and gold move with every update: the line is rewritten in place, the menu is not.
    const factsText = this.facts?.(update, id, this.rules) ?? "";
    const live = this.menu.querySelector(".player-menu-facts");
    if (live) live.textContent = factsText;
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
    close.append(icon("close"));
    close.addEventListener("click", () => {
      this.close();
    });
    this.menu.replaceChildren(
      h(
        "header",
        { class: "player-menu-head" },
        swatch(colorOf(id, this.rules.firstNation, this.rules.teams)),
        h("h2", { id: "player-menu-name" }, player.name),
        close,
      ),
      h("p", { class: "player-menu-status" }, status),
      h("p", { class: "player-menu-facts" }, factsText),
      ...(traitorText ? [h("p", { class: "player-menu-traitor" }, traitorText)] : []),
      ...(embargoText ? [h("p", { class: "player-menu-embargo" }, embargoText)] : []),
      ...(warText ? [h("p", { class: "player-menu-war" }, warText)] : []),
      ...(hiddenText ? [h("p", { class: "player-menu-hidden" }, hiddenText)] : []),
      ...buttons.map(({ key: label, params, action, enabled, className }) => {
        const button = h(
          "button",
          { type: "button", class: `menu-action ${className}`, "data-kind": className },
          t(label, params),
        );
        button.disabled = !enabled;
        if (className === "messages") button.setAttribute("aria-expanded", String(this.messaging));
        if (className === "report") button.setAttribute("aria-expanded", String(this.reporting));
        button.addEventListener("click", action);
        return button;
      }),
      ...(this.messaging && playing ? [this.phrases(id, update)] : []),
      ...(this.reporting && reported === false ? this.reasons(id, update) : []),
      ...(this.refused && this.reasonsPanel ? [this.reasonsPanel.reportRefused()] : []),
    );
    this.menu.hidden = false;
    if (focused) refocus(this.menu, focused);
  }

  /** The quick messages, one button each: a click sends one and folds them away. */
  private phrases(id: number, update: GameUpdate): HTMLElement {
    return h(
      "div",
      { class: "quick-messages", role: "group", "aria-label": t("diplo.messages") },
      ...Array.from({ length: QUICK_MESSAGES }, (_, phrase) => {
        const button = h(
          "button",
          {
            type: "button",
            class: "quick-phrase",
            "data-kind": `quick-${String(phrase)}`,
            "data-phrase": phrase,
          },
          t(`quick.${String(phrase)}` as MessageKey),
        );
        button.addEventListener("click", () => {
          this.actions.onQuick(id, phrase);
          this.messaging = false;
          this.menuKey = "";
          this.renderMenu(update);
          this.menu.querySelector<HTMLButtonElement>(".messages")?.focus();
        });
        return button;
      }),
    );
  }

  /** Why the player is reported, one button each: a click sends the report and folds them away. */
  private reasons(id: number, update: GameUpdate): HTMLElement[] {
    if (!this.reasonsPanel) return [];
    return [
      this.reasonsPanel.reportReasons(t("diplo.report"), (reason) => {
        this.actions.onReport(id, reason);
        this.reporting = false;
        this.refused = false;
        this.menuKey = "";
        this.renderMenu(update);
        this.menu.querySelector<HTMLButtonElement>(".report")?.focus();
      }),
    ];
  }

  /** The server turned down the report just sent: the menu says so until the next one. */
  reportRefused(): void {
    this.refused = true;
    this.menuKey = "";
    if (this.last) this.render(this.last);
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
          // A request accepted during a pause stays in the stack, still waiting.
          if (!this.actions.onAlly(from)) return;
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
          swatch(colorOf(from, this.rules.firstNation, this.rules.teams)),
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
    if (focused && !refocus(this.requests, focused)) this.menuFocus();
  }

  /** Where focus goes when the request it was on is gone: the player menu, or the map. */
  private menuFocus(): void {
    this.menu.querySelector<HTMLButtonElement>("button")?.focus();
  }
}

/**
 * Focus back on the button of the same kind after a redraw, or the first one
 * usable when that one is now disabled or gone. Returns whether it found one.
 */
function refocus(root: HTMLElement, kind: string): boolean {
  const same = root.querySelector<HTMLButtonElement>(`[data-kind="${kind}"]:not([disabled])`);
  const target = same ?? root.querySelector<HTMLButtonElement>("button:not([disabled])");
  target?.focus();
  return target !== null;
}
