import { describe, expect, it } from "vitest";
import { setLanguage } from "../src/i18n/index.ts";
import { GENERATED_MAPS as maps } from "../src/game/maps.ts";
import { activeRuleNames, defaultRules, SPECIAL_RULES } from "../src/ui/rules-fieldset.ts";
import { defaultSetup } from "../src/ui/setup.ts";
import {
  OPERATOR_BONUSES,
  operatorBonusLine,
  operatorBonusNames,
} from "../src/ui/operator-bonuses.ts";

describe("special rules (R-MODE-08)", () => {
  it("lists every rule the engine knows, each with a label and a hint", () => {
    expect(SPECIAL_RULES.map(({ name }) => name).sort()).toEqual(
      Object.keys(defaultRules()).sort(),
    );
  });

  it("names the rules a game was played with, in the language, and nothing for none", () => {
    expect(activeRuleNames({ collapsingFronts: true })).toEqual(["Collapsing fronts"]);
    expect(activeRuleNames({ collapsingFronts: false })).toEqual([]);
    expect(activeRuleNames(undefined)).toEqual([]);
    setLanguage("fr");
    expect(activeRuleNames({ collapsingFronts: true })).toEqual(["Fronts qui s’effondrent"]);
    setLanguage("en");
  });

  it("hands a solo game the default rules, which the solo options carry on", () => {
    const options = { ...defaultSetup(maps), seed: 1 };
    expect(options.rules).toEqual(defaultRules());
  });
});

describe("operator's bonuses (R-MODE-09)", () => {
  it("names the bonuses in the line every player of the game reads", () => {
    const players = [
      { id: 1, name: "Nico" },
      { id: 2, name: "Léa" },
    ];
    expect(operatorBonusLine("online.operatorOn", { player: 1, bonuses: 0b0101 }, players)).toBe(
      "Operator's test for Nico: double gold, structures at half price. This game counts for no stats or achievements.",
    );
    expect(operatorBonusLine("online.operatorOn", null, players)).toBe("");
    expect(operatorBonusNames(0b1111)).toHaveLength(OPERATOR_BONUSES.length);
  });
});
