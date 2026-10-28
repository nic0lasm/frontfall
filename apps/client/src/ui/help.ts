import "./help.css";
import { DEFAULT_BALANCE } from "@frontfall/engine";
import type { BuildView } from "../game/solo-game.ts";
import { applyTranslations, getLanguage, type MessageKey } from "../i18n/index.ts";
import { h } from "./dom.ts";
import { formatCount } from "./format.ts";
import { icon } from "./icons.ts";
import { BUILD_MODES, costOf, numberOf, offers } from "./build-modes.ts";

export interface HelpOptions {
  /** The player's current costs, when the game has started. */
  build?: BuildView | undefined;
  /** What the game leaves out (R-MODE-03): those rows are not listed. */
  disabled: number;
  /** A finger rather than a mouse: gestures replace the keys. */
  touch: boolean;
  /** Capital mode (R-CAP): one more line on defence. */
  capitals?: boolean;
  /** An online game runs for everyone: no pause to offer. */
  online?: boolean;
  onClose: () => void;
  /** Shows the first steps again; left out where there is no guide (online, replays). */
  onGuide?: (() => void) | undefined;
}

/** Lines for a mouse and a keyboard, or for a finger. */
const LINES: Readonly<Record<"mouse" | "touch", Record<string, readonly MessageKey[]>>> = {
  mouse: {
    expand: ["help.click", "help.ships", "help.ratio"],
    defend: ["help.defendTroops", "help.defendFort", "help.defendRetreat"],
    diplomacy: ["help.diplomacy"],
    map: ["help.drag", "help.zoom", "help.keys", "help.keyboardPick", "help.pause"],
  },
  touch: {
    expand: ["help.tap", "help.shipsTouch", "help.ratioTouch"],
    defend: ["help.defendTroops", "help.defendFort", "help.defendRetreat"],
    diplomacy: ["help.diplomacyTouch"],
    map: ["help.dragTouch", "help.holdTouch"],
  },
};

/**
 * How to play, in a dialog the player opens with "?" or H: how to expand,
 * every building with its key, its current cost and where it goes, how to
 * reach other players, and how to move the map. On a touch screen the
 * gestures replace the keys.
 */
export function helpPanel(options: HelpOptions): HTMLElement {
  const lines = LINES[options.touch ? "touch" : "mouse"];
  const list = (keys: readonly MessageKey[] = []): HTMLElement =>
    h(
      "ul",
      { class: "help-lines" },
      ...[
        ...keys,
        ...(options.capitals && keys === lines.defend ? (["help.defendCapital"] as const) : []),
      ].map((key) =>
        h("li", { "data-i18n": key === "help.pause" && options.online ? "help.online" : key }),
      ),
    );
  const section = (title: MessageKey, ...content: HTMLElement[]): HTMLElement =>
    h("section", { class: "help-section" }, h("h3", { "data-i18n": title }), ...content);

  const params = JSON.stringify({ spacing: DEFAULT_BALANCE.buildSpacing });
  const rows = BUILD_MODES.filter(({ mode }) => offers(mode, options.disabled)).map(
    ({ mode, key }) => {
      const cost = options.build ? costOf(mode, options.build) : undefined;
      return h(
        "li",
        { class: `help-build build-${mode}` },
        h("span", { class: "build-icon", "aria-hidden": "true" }, icon(mode)),
        h(
          "span",
          { class: "help-build-text" },
          h("strong", { "data-i18n": `hud.${mode}` }),
          h("span", { "data-i18n": `help.place.${mode}`, "data-i18n-params": params }),
        ),
        ...(options.touch
          ? []
          : [
              h(
                "span",
                { class: "help-keys" },
                h("kbd", {}, key),
                ...(numberOf(mode) === undefined ? [] : [h("kbd", {}, String(numberOf(mode)))]),
              ),
            ]),
        h("span", { class: "help-cost" }, cost === undefined ? "" : formatCount(cost)),
      );
    },
  );

  const close = h("button", { type: "button", class: "primary", "data-i18n": "help.close" });
  close.addEventListener("click", options.onClose);
  const buttons: HTMLElement[] = [close];
  if (options.onGuide) {
    const guide = h("button", { type: "button", class: "secondary", "data-i18n": "help.guide" });
    guide.addEventListener("click", options.onGuide);
    buttons.unshift(guide);
  }

  const dialog = h(
    "section",
    {
      class: "help",
      id: "help-panel",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "help-title",
    },
    h("h2", { id: "help-title", "data-i18n": "help.title" }),
    section("help.expandTitle", list(lines.expand)),
    section(
      "help.buildTitle",
      h("p", { "data-i18n": options.touch ? "help.buildHowTouch" : "help.buildHow" }),
      h("ul", { class: "help-builds" }, ...rows),
    ),
    section("help.defendTitle", list(lines.defend)),
    section("help.diplomacyTitle", list(lines.diplomacy)),
    section("help.mapTitle", list(lines.map)),
    h(
      "p",
      { class: "help-about" },
      h("a", {
        href: getLanguage() === "fr" ? "about.fr.html" : "about.html",
        target: "_blank",
        rel: "noopener",
        "data-i18n": "help.about",
      }),
    ),
    h("div", { class: "help-actions" }, ...buttons),
  );
  trapFocus(dialog);
  applyTranslations(dialog);
  return h("div", { class: "overlay" }, dialog);
}

/** Tab and Shift+Tab stay among the buttons of a modal dialog. */
export function trapFocus(dialog: HTMLElement): void {
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled])")];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  });
}
