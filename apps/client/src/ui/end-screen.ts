import type { GameUpdate } from "../game/solo-game.ts";
import { applyTranslations, t, type MessageKey } from "../i18n/index.ts";
import { h } from "./dom.ts";
import { formatDuration, formatPercent } from "./format.ts";

export interface EndScreenActions {
  onNewGame(): void;
  onMenu(): void;
  onWatch(): void;
}

export interface GameSummary {
  update: GameUpdate;
  ticksPerSecond: number;
  ownableTiles: number;
  /** Most land the human held at any time, in tiles. */
  peakTiles: number;
}

/** Who won, how long it took, how far the player got, and a way to play again. */
export function endScreen(summary: GameSummary, actions: EndScreenActions): HTMLElement {
  const { update } = summary;
  const winner = update.players.find((player) => player.id === update.winner);
  const won = update.winner === update.you;
  const seconds = update.tick / summary.ticksPerSecond;

  const button = (key: MessageKey, onClick: () => void, primary = false): HTMLButtonElement => {
    const element = h("button", {
      type: "button",
      class: primary ? "primary" : "secondary",
      "data-i18n": key,
    });
    element.addEventListener("click", onClick);
    return element;
  };

  const row = (key: MessageKey, value: string): HTMLElement[] => [
    h("dt", { "data-i18n": key }),
    h("dd", {}, value),
  ];

  const dialog = h(
    "section",
    {
      class: `end-screen ${won ? "won" : "lost"}`,
      id: "end-screen",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "end-title",
    },
    h("h1", { id: "end-title", "data-i18n": won ? "end.victory" : "end.defeat" }),
    h("p", { class: "end-winner" }, t("end.winner", { name: winner?.name ?? "" })),
    h(
      "dl",
      { class: "end-stats" },
      ...row("end.duration", formatDuration(seconds)),
      ...row("end.peak", formatPercent(summary.peakTiles / Math.max(1, summary.ownableTiles))),
    ),
    h(
      "div",
      { class: "end-actions" },
      button(
        "end.newGame",
        () => {
          actions.onNewGame();
        },
        true,
      ),
      button("end.watch", () => {
        actions.onWatch();
      }),
      button("end.menu", () => {
        actions.onMenu();
      }),
    ),
  );
  applyTranslations(dialog);
  return h("div", { class: "overlay" }, dialog);
}

const HELP_KEYS = [
  "help.click",
  "help.ships",
  "help.build",
  "help.diplomacy",
  "help.drag",
  "help.zoom",
  "help.keys",
  "help.ratio",
  "help.pause",
] as const;

/** The controls, in a dialog the player opens with "?" or H. */
export function helpPanel(onClose: () => void): HTMLElement {
  const close = h("button", { type: "button", class: "primary", "data-i18n": "help.close" });
  close.addEventListener("click", onClose);
  const dialog = h(
    "section",
    { class: "help", role: "dialog", "aria-modal": "true", "aria-labelledby": "help-title" },
    h("h2", { id: "help-title", "data-i18n": "help.title" }),
    h("ul", {}, ...HELP_KEYS.map((key) => h("li", { "data-i18n": key }))),
    close,
  );
  applyTranslations(dialog);
  return h("div", { class: "overlay" }, dialog);
}
