import { PLAYER_COLORS } from "../palette.ts";
import { getLanguage, onLanguageChange, t, type Language } from "../i18n/index.ts";
import { text } from "./profile-text.ts";
import { h, swatch } from "../dom.ts";
import { COLOR_CHOICES, type Profile } from "./profile.ts";

/** Names of the colours, read aloud by screen readers; here, not in the catalogues, to stay out of the first download. */
const COLOR_NAMES: Record<Language, readonly string[]> = {
  en: ["Sky", "Amber", "Jade", "Lemon", "Azure", "Vermilion", "Orchid", "Snow"],
  fr: ["Ciel", "Ambre", "Jade", "Citron", "Azur", "Vermillon", "Orchidée", "Neige"],
};

/** An outcome in words; the end screen already names two of them. */
function outcomeText(outcome: string): string {
  if (outcome === "victory") return t("end.victory");
  if (outcome === "defeat") return t("end.defeat");
  return text(`outcome.${outcome}`);
}

/** What the profile panel reads and changes; the page keeps the profile on the device. */
export interface ProfileControl {
  read(): Profile;
  setColor(index: number): void;
  /** Erases the name, the colour and the games from the device. */
  forget(): void;
}

/**
 * The inside of the menu's profile: the colour for solo games, the last
 * games, and a way to erase them. Loaded when the panel is first opened, to
 * keep it out of the first download.
 */
export function profileBody(
  control: ProfileControl,
  mapLabel: (id: string) => string,
  /** Called after the profile is erased, so the menu can empty its name field. */
  onForgotten: () => void,
  cleanups: (() => void)[],
): HTMLElement {
  const colors = h("div", {
    class: "color-choices",
    role: "radiogroup",
    "aria-labelledby": "profile-color-label",
  });
  const inputs: HTMLInputElement[] = [];
  const labels: HTMLElement[] = [];
  for (let index = 0; index < COLOR_CHOICES; index++) {
    const input = h("input", { type: "radio", name: "profile-color", value: index });
    input.addEventListener("change", () => {
      control.setColor(index);
    });
    inputs.push(input);
    const label = h(
      "label",
      { class: "color-choice" },
      input,
      swatch((PLAYER_COLORS[index] ?? PLAYER_COLORS[0] ?? { hex: "#56B4E9" }).hex),
    );
    labels.push(label);
    colors.append(label);
  }

  const list = h("ol", { class: "recent-games", id: "recent-games" });
  const empty = h("p", { class: "hint", "data-text": "noGames" });
  const forget = h("button", {
    type: "button",
    class: "secondary",
    id: "profile-forget",
    "data-text": "forget",
  });

  const root = h("div", { class: "profile-body" });
  const refresh = (): void => {
    for (const element of root.querySelectorAll<HTMLElement>("[data-text]")) {
      element.textContent = text(element.dataset.text ?? "");
    }
    const profile = control.read();
    labels.forEach((label, index) => {
      const name = COLOR_NAMES[getLanguage()][index] ?? "";
      label.title = name;
      label.setAttribute("aria-label", name);
    });
    inputs.forEach((input, index) => {
      input.checked = index === profile.color;
    });
    const date = new Intl.DateTimeFormat(getLanguage(), { day: "numeric", month: "short" });
    empty.hidden = profile.games.length > 0;
    list.replaceChildren(
      ...profile.games.map((game) =>
        h(
          "li",
          { class: `recent-game ${game.outcome}` },
          text("game", {
            map: game.map === "generated" ? text("generatedMap") : mapLabel(game.map),
            mode: text(`mode.${game.mode}`),
            outcome: outcomeText(game.outcome),
            minutes: game.minutes,
            date: date.format(game.at),
          }),
        ),
      ),
    );
  };
  forget.addEventListener("click", () => {
    control.forget();
    refresh();
    onForgotten();
  });
  cleanups.push(onLanguageChange(refresh));

  root.append(
    h(
      "div",
      { class: "field" },
      h("span", { id: "profile-color-label", class: "field-label", "data-text": "color" }),
      colors,
      h("p", { class: "hint", "data-text": "colorHint" }),
    ),
    h(
      "div",
      { class: "field" },
      h("span", { class: "field-label", "data-text": "games" }),
      list,
      empty,
    ),
    h("p", { class: "hint", "data-text": "storedHere" }),
    forget,
  );
  refresh();
  return root;
}
