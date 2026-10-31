import { describe, expect, it } from "vitest";
import { STEPS } from "../src/ui/guide.ts";
import { TUTORIAL_TEXTS } from "../src/ui/tutorial-text.ts";

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();

describe("tutorial texts", () => {
  it("have the same keys and placeholders in both languages", () => {
    expect(Object.keys(TUTORIAL_TEXTS.fr).sort()).toEqual(Object.keys(TUTORIAL_TEXTS.en).sort());
    for (const [key, text] of Object.entries(TUTORIAL_TEXTS.en)) {
      const french = (TUTORIAL_TEXTS.fr as Record<string, string>)[key] ?? "";
      expect(placeholders(french), key).toEqual(placeholders(text));
    }
  });

  it("tell every step, by name and by text", () => {
    for (const lang of ["en", "fr"] as const) {
      const texts = TUTORIAL_TEXTS[lang] as Record<string, string>;
      for (const step of STEPS) {
        expect(texts[`name.${step}`], `${lang} name.${step}`).toBeTruthy();
        expect(texts[step], `${lang} ${step}`).toBeTruthy();
      }
    }
  });

  it("write no figure of the balance", () => {
    for (const texts of Object.values(TUTORIAL_TEXTS)) {
      for (const [key, text] of Object.entries(texts)) {
        // Costs and shares come in as parameters; the keys of the attack share are not a figure of the balance.
        const plain = text.replace(/\{\w+\}/g, "").replace(/(Shift|Maj) \+ 1 (to|à) 0/, "");
        expect(plain, key).not.toMatch(/\d/);
      }
    }
  });
});
