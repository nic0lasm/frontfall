import { applyTranslations } from "../i18n/index.ts";
import { h } from "../dom.ts";
import { cleanName, MAX_NAME_LENGTH } from "./setup.ts";

export interface JoinActions {
  /** The player picked a name: join the game under it. */
  onJoin(name: string): void;
  onMenu(): void;
}

/**
 * The first screen of an invitation link: the name the other players will
 * see, filled with the last one used, before the page joins the game.
 */
export class JoinScreen {
  readonly element: HTMLElement;

  constructor(name: string, actions: JoinActions) {
    const input = h("input", {
      id: "join-name",
      type: "text",
      maxlength: MAX_NAME_LENGTH,
      autocomplete: "nickname",
      spellcheck: false,
      "data-i18n-attr": "placeholder:menu.namePlaceholder",
    });
    input.value = name;
    const menu = h("button", {
      type: "button",
      class: "secondary",
      id: "join-menu",
      "data-i18n": "hud.menu",
    });
    menu.addEventListener("click", () => {
      actions.onMenu();
    });
    const form = h(
      "form",
      { class: "lobby-panel", "aria-labelledby": "join-title" },
      h("h1", { class: "lobby-title", id: "join-title", "data-i18n": "online.joinTitle" }),
      h("p", { class: "lobby-status", "data-i18n": "online.joinHint" }),
      h(
        "div",
        { class: "field" },
        h("label", { for: "join-name", "data-i18n": "menu.name" }),
        input,
      ),
      h(
        "div",
        { class: "lobby-actions" },
        h("button", {
          type: "submit",
          class: "primary",
          id: "join-submit",
          "data-i18n": "online.join",
        }),
        menu,
      ),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      actions.onJoin(cleanName(input.value));
    });
    this.element = h(
      "main",
      { class: "menu lobby", id: "join" },
      h(
        "header",
        { class: "menu-header" },
        h("img", { class: "logo", src: "./logo-horizontal-on-dark.svg", alt: "Frontfall" }),
      ),
      form,
    );
    applyTranslations(this.element);
  }

  /** Puts the cursor in the name, once the screen is on the page. */
  focus(): void {
    this.element.querySelector("input")?.focus();
  }

  dispose(): void {
    this.element.remove();
  }
}
