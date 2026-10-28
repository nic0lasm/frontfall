import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { ErrorCode } from "@frontfall/protocol";
import indexHtml from "../index.html?raw";
import en from "../src/i18n/en.json" with { type: "json" };
import fr from "../src/i18n/fr.json" with { type: "json" };

type I18n = typeof import("../src/i18n/index.ts");

/** Imports a fresh copy so the initial language is read again from storage and navigator. */
async function load(): Promise<I18n> {
  vi.resetModules();
  const i18n = await import("../src/i18n/index.ts");
  await Promise.all([i18n.loadLanguage("en"), i18n.loadLanguage("fr")]);
  return i18n;
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

const throwing = (): never => {
  throw new DOMException("denied", "SecurityError");
};

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

const catalogues: Record<string, Record<string, string>> = { en, fr };

describe("catalogues", () => {
  it.each(Object.keys(catalogues))("%s has exactly the English keys", (lang) => {
    expect(Object.keys(catalogues[lang] ?? {}).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(Object.keys(catalogues))("%s uses the English placeholders in each message", (lang) => {
    for (const [key, text] of Object.entries(en)) {
      expect(placeholders(catalogues[lang]?.[key] ?? ""), key).toEqual(placeholders(text));
    }
  });

  it("covers every key used by the page and the screens it builds", () => {
    const source = new URL("../src/", import.meta.url);
    const screens = readdirSync(source, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(new URL(file, source), "utf8"));
    const keys = [indexHtml, ...screens].flatMap((text) => [
      ...[...text.matchAll(/data-i18n"?[=:] ?"([^"]+)"/g)].map((match) => match[1]),
      ...[...text.matchAll(/data-i18n-attr"?[=:] ?"([^"]+)"/g)].flatMap((match) =>
        (match[1] ?? "").split(";").map((pair) => pair.split(":")[1]?.trim()),
      ),
    ]);
    expect(keys.length).toBeGreaterThan(30);
    // Every message key has a section: "menu.play", not a word from a comment.
    for (const key of keys.filter((candidate) => candidate?.includes(".")))
      expect(Object.keys(en)).toContain(key);
  });
});

describe("online errors", () => {
  it("has a message for every error the server can send the lobby", () => {
    // A refused report comes during a game, and the report panel says so itself.
    const handled = ["token_invalid", "token_in_use", "too_many_reports"];
    for (const code of ErrorCode.options.filter((code) => !handled.includes(code))) {
      expect(Object.keys(en)).toContain(`online.error.${code}`);
    }
  });
});

describe("language", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("navigator", { languages: ["en-US", "en"] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows the browser preferences, English when nothing matches", async () => {
    const { detectLanguage } = await load();
    expect(detectLanguage(["fr-CA", "en"])).toBe("fr");
    expect(detectLanguage(["de-DE", "FR"])).toBe("fr");
    expect(detectLanguage(["de-DE", "pt"])).toBe("en");
    expect(detectLanguage([])).toBe("en");

    vi.stubGlobal("navigator", { languages: ["fr-FR"] });
    expect((await load()).getLanguage()).toBe("fr");
    vi.stubGlobal("navigator", { language: "fr" });
    expect((await load()).getLanguage()).toBe("fr");
    vi.stubGlobal("navigator", undefined);
    expect((await load()).getLanguage()).toBe("en");
  });

  it("prefers a stored choice and ignores an unknown one", async () => {
    vi.stubGlobal("localStorage", memoryStorage({ "frontfall.language": "fr" }));
    expect((await load()).getLanguage()).toBe("fr");
    vi.stubGlobal("localStorage", memoryStorage({ "frontfall.language": "xx" }));
    expect((await load()).getLanguage()).toBe("en");
  });

  it("switches without reloading, remembers the choice and notifies listeners", async () => {
    const { getLanguage, onLanguageChange, setLanguage, t } = await load();
    const seen: string[] = [];
    const stop = onLanguageChange((lang) => seen.push(lang));

    setLanguage("fr");
    setLanguage("fr");
    expect(getLanguage()).toBe("fr");
    expect(t("status.connecting")).toBe("Connexion…");
    expect(localStorage.getItem("frontfall.language")).toBe("fr");

    stop();
    setLanguage("en");
    expect(seen).toEqual(["fr"]);
    expect((await load()).getLanguage()).toBe("en");
  });

  it("keeps working when storage throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: throwing,
      setItem: throwing,
    });
    const { getLanguage, setLanguage, t } = await load();
    expect(getLanguage()).toBe("en");
    setLanguage("fr");
    expect(t("online.join")).toBe("Rejoindre");

    vi.stubGlobal("localStorage", undefined);
    expect((await load()).getLanguage()).toBe("en");
  });
});

describe("t", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("navigator", { languages: ["en-US"] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("produces the texts the end-to-end tests expect", async () => {
    const { t } = await load();
    expect(t("status.connecting")).toBe("Connecting…");
    expect(t("status.waiting", { players: 1, capacity: 16 })).toBe("Waiting for players 1/16");
    expect(t("status.disconnected", { seconds: 2 })).toBe("Disconnected, retrying in 2 s");
  });

  it("leaves a placeholder without a value untouched", async () => {
    const { t } = await load();
    expect(t("status.waiting", { players: 1 })).toBe("Waiting for players 1/{capacity}");
  });

  it("picks plural forms by language", async () => {
    const { plural, setLanguage } = await load();
    expect(plural("lobby.players", 1)).toBe("1 player");
    expect(plural("lobby.players", 0)).toBe("0 players");
    setLanguage("fr");
    expect(plural("lobby.players", 0)).toBe("0 joueur");
    expect(plural("lobby.players", 2)).toBe("2 joueurs");
    // French has a "many" form for round millions; the catalogue falls back to "other".
    expect(plural("lobby.players", 1_000_000)).toBe("1000000 joueurs");
  });
});

describe("applyTranslations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  class FakeElement {
    textContent = "";
    readonly attributes = new Map<string, string>();
    constructor(readonly dataset: Record<string, string>) {}
    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }
  }

  it("fills text and attributes, again after a language change", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("navigator", { languages: ["en"] });
    const { applyTranslations, setLanguage } = await load();
    const text = new FakeElement({ i18n: "online.leave" });
    const attrs = new FakeElement({
      i18nAttr: "aria-label:status.connecting; title :online.leave;",
    });
    const documentElement = { lang: "" };
    const root = {
      documentElement,
      querySelectorAll: (selector: string) =>
        selector === "[data-i18n]" ? [text] : selector === "[data-i18n-attr]" ? [attrs] : [],
    } as unknown as ParentNode;

    applyTranslations(root);
    expect(text.textContent).toBe("Leave");
    expect(attrs.attributes.get("aria-label")).toBe("Connecting…");
    expect(attrs.attributes.get("title")).toBe("Leave");
    expect(documentElement.lang).toBe("en");

    setLanguage("fr");
    applyTranslations(root);
    expect(text.textContent).toBe("Quitter");
    expect(attrs.attributes.get("aria-label")).toBe("Connexion…");
    expect(documentElement.lang).toBe("fr");
  });

  it("takes placeholder values from data-i18n-params and ignores bad JSON", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("navigator", { languages: ["en"] });
    const { applyTranslations } = await load();
    const turn = new FakeElement({ i18n: "hud.cap", i18nParams: '{"cap":40}' });
    const label = new FakeElement({
      i18nAttr: "aria-label:end.winner",
      i18nParams: '{"name":"p2"}',
    });
    const broken = new FakeElement({ i18n: "hud.cap", i18nParams: "{cap:" });
    const list = new FakeElement({ i18n: "hud.cap", i18nParams: "[1]" });
    const root = {
      ownerDocument: null,
      querySelectorAll: (selector: string) =>
        selector === "[data-i18n]" ? [turn, broken, list] : [label],
    } as unknown as ParentNode;

    applyTranslations(root);
    applyTranslations(root);
    expect(turn.textContent).toBe("/ 40");
    expect(label.attributes.get("aria-label")).toBe("p2 wins the game.");
    expect(broken.textContent).toBe("/ {cap}");
    expect(list.textContent).toBe("/ {cap}");
  });

  it("lists every catalogue under its own name", async () => {
    const { LANGUAGES } = await load();
    expect(LANGUAGES.map((lang) => lang.id).sort()).toEqual(Object.keys(catalogues).sort());
    expect(LANGUAGES.find((lang) => lang.id === "fr")?.label).toBe("Français");
  });
});

describe("hard-coded text", () => {
  // The catalogues themselves are not interface text. The statistics page is in
  // English only, like the side pages in public/ (#144), and loads no catalogue.
  const sources = import.meta.glob<string>(
    ["../src/**/*.ts", "!../src/i18n/**", "!../src/stats/**"],
    {
      query: "?raw",
      import: "default",
      eager: true,
    },
  );

  // A string or template literal written straight into the page. Translated text
  // goes through t(), so these patterns only match text that skipped the catalogues.
  const patterns = [
    /\.(textContent|innerText|innerHTML|title|placeholder|alt)\s*=\s*["'`]/,
    /setAttribute\(\s*["'](aria-label|title|placeholder|alt)["']\s*,\s*["'`]/,
    // A literal passed to append() itself, not a tag name handed to h() inside it.
    /\.(append|prepend)\((?:[^)]*,\s*)?["'`][^"'`]*[A-Za-z]{2}/,
  ];

  it("finds the client sources", () => {
    expect(Object.keys(sources)).toContain("../src/main.ts");
  });

  it.each(Object.entries(sources))("%s writes no literal text into the page", (_, source) => {
    const offending = source.split("\n").filter((line) => patterns.some((p) => p.test(line)));
    expect(offending).toEqual([]);
  });
});
