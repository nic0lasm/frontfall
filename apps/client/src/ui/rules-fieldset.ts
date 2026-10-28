import { DEFAULT_RULES, type GameRules } from "@frontfall/protocol";
import type { MessageKey } from "../i18n/index.ts";
import { t } from "../i18n/index.ts";
import { h } from "./dom.ts";

/**
 * The special rules a game can be played with (R-MODE-08), in the order the
 * fieldset lists them. A rule joins the list here and in the strings; the
 * fieldset, the summaries and the end screen follow.
 */
export const SPECIAL_RULES: readonly {
  name: keyof GameRules;
  label: MessageKey;
  hint: MessageKey;
}[] = [
  {
    name: "collapsingFronts",
    label: "setup.rules.collapsingFronts",
    hint: "setup.rules.collapsingFrontsHint",
  },
];

/** The rules at their defaults, as a copy to change. */
export function defaultRules(): GameRules {
  return { ...DEFAULT_RULES };
}

/** The names of the rules switched on, in the current language, for a summary line. */
export function activeRuleNames(rules: Partial<GameRules> | undefined): string[] {
  return SPECIAL_RULES.filter(({ name }) => rules?.[name] === true).map(({ label }) => t(label));
}

export interface RulesFieldset {
  readonly element: HTMLFieldSetElement;
  /** The rules as the switches show them. */
  read(): GameRules;
  /** Shows `rules`; `editable` false leaves the switches to be read only. */
  show(rules: GameRules, editable: boolean): void;
}

/**
 * The "Special rules" fieldset, apart from the other options: one switch and a
 * hint line per rule. `idPrefix` keeps the ids of the menu's and the lobby's
 * copies apart; `onChange` is told when the player flips a switch.
 */
export function rulesFieldset(
  idPrefix: string,
  initial: GameRules,
  onChange: (rules: GameRules) => void,
): RulesFieldset {
  const rows = SPECIAL_RULES.map(({ name, label, hint }) => {
    const input = h("input", { id: `${idPrefix}-${name}`, type: "checkbox" });
    input.checked = initial[name];
    input.setAttribute("aria-describedby", `${idPrefix}-${name}-hint`);
    return {
      name,
      input,
      row: h(
        "div",
        { class: "rule" },
        h("label", { class: "toggle", for: input.id }, input, h("span", { "data-i18n": label })),
        h("p", { class: "hint", id: `${input.id}-hint`, "data-i18n": hint }),
      ),
    };
  });
  const element = h(
    "fieldset",
    { class: "rules-set", id: `${idPrefix}-rules` },
    h("legend", { "data-i18n": "setup.rules.title" }),
    ...rows.map(({ row }) => row),
  );
  const read = (): GameRules => {
    const rules = defaultRules();
    for (const { name, input } of rows) rules[name] = input.checked;
    return rules;
  };
  for (const { input } of rows) {
    input.addEventListener("change", () => {
      onChange(read());
    });
  }
  return {
    element,
    read,
    show(rules, editable) {
      for (const { name, input } of rows) {
        input.checked = rules[name];
        input.disabled = !editable;
      }
    },
  };
}
