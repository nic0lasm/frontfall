/** English is the reference catalogue: every other language has exactly its keys. */
export type MessageKey = keyof typeof import("./en.json");

/** Keys that take a count, written in the catalogues as `key.one`, `key.other`, … */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.other` ? Base : never;
}[MessageKey];

export type Params = Readonly<Record<string, string | number>>;

// A catalogue still being translated may lack keys, but cannot have extra ones.
type Catalogue = Readonly<Partial<Record<MessageKey, string>>>;

/**
 * Each catalogue is its own chunk: a page downloads the language it shows,
 * and another one only when the player picks it (bench/client/budget.json).
 */
const CATALOGUES = {
  en: { complete: true, load: () => import("./en.json").then((module) => module.default) },
  fr: { complete: true, load: () => import("./fr.json").then((module) => module.default) },
} satisfies Record<string, { complete: boolean; load: () => Promise<Catalogue> }>;

export type Language = keyof typeof CATALOGUES;

const loaded: Partial<Record<Language, Catalogue>> = {};

/** Downloads the catalogue of `lang`, the current language by default, if not yet there. */
export async function loadLanguage(lang: Language = current): Promise<void> {
  loaded[lang] ??= await CATALOGUES[lang].load();
}

/** The complete languages, each named in itself so a lost player can find their own. */
export function pickableLanguages<Id extends string>(
  catalogues: Record<Id, { complete: boolean }>,
): { id: Id; label: string }[] {
  return (Object.entries(catalogues) as [Id, { complete: boolean }][])
    .filter(([, { complete }]) => complete)
    .map(([id]) => {
      const name = new Intl.DisplayNames([id], { type: "language" }).of(id) ?? id;
      return { id, label: name.charAt(0).toLocaleUpperCase(id) + name.slice(1) };
    });
}

export const LANGUAGES = pickableLanguages(CATALOGUES);

const STORAGE_KEY = "frontfall.language";

/** Picks the first supported language among BCP 47 tags such as `fr-CA`, English otherwise. */
export function detectLanguage(tags: readonly string[]): Language {
  for (const tag of tags) {
    const primary = tag.toLowerCase().split("-")[0];
    if (isLanguage(primary)) return primary;
  }
  return "en";
}

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((lang) => lang.id === value);
}

// Storage can be missing or throw on access (private mode, blocked cookies):
// the choice is then simply not remembered.
function readStored(): string | null {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(lang: Language): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not remembered, see readStored.
  }
}

function initialLanguage(): Language {
  const stored = readStored();
  if (isLanguage(stored)) return stored;
  const nav = globalThis.navigator as Navigator | undefined;
  return detectLanguage(nav?.languages ?? (nav?.language ? [nav.language] : []));
}

let current = initialLanguage();
const listeners = new Set<(lang: Language) => void>();

export function getLanguage(): Language {
  return current;
}

/**
 * Switches language in place, remembers the choice and notifies listeners:
 * at once when its catalogue is already there, otherwise once it arrives.
 * A catalogue that fails to download leaves the language as it was.
 */
export function setLanguage(lang: Language): void {
  if (!isLanguage(lang) || lang === current) return;
  const apply = (): void => {
    current = lang;
    store(lang);
    for (const listener of listeners) listener(lang);
  };
  if (loaded[lang]) apply();
  else loadLanguage(lang).then(apply, () => undefined);
}

/** Calls `listener` after each language change; the returned function unsubscribes. */
export function onLanguageChange(listener: (lang: Language) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function format(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

function lookup(key: string): string | undefined {
  const catalogue: Readonly<Record<string, string>> | undefined = loaded[current];
  return catalogue?.[key];
}

/** Translates `key` into the current language, replacing `{name}` placeholders. */
export function t(key: MessageKey, params: Params = {}): string {
  return format(lookup(key) ?? key, params);
}

/** Like `t`, choosing the plural form of `key` that matches `count`, also available as `{count}`. */
export function plural(key: PluralKey, count: number, params: Params = {}): string {
  const category = new Intl.PluralRules(current).select(count);
  const template = lookup(`${key}.${category}`) ?? lookup(`${key}.other`) ?? key;
  return format(template, { ...params, count });
}

/** Reads `data-i18n-params`, a JSON object; anything else gives no parameters. */
function parseParams(json: string | undefined): Params {
  if (!json) return {};
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Params)
      : {};
  } catch {
    return {};
  }
}

/**
 * Fills elements under `root` marked with `data-i18n="key"` (text, with
 * placeholder values from the JSON in `data-i18n-params`) and
 * `data-i18n-attr="aria-label:key;title:key"` (attributes, using the same
 * parameters). The markers stay in place, so calling it again on the same
 * subtree, after a language change for instance, gives the same result.
 */
export function applyTranslations(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (key) element.textContent = t(key as MessageKey, parseParams(element.dataset.i18nParams));
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-attr]")) {
    for (const pair of (element.dataset.i18nAttr ?? "").split(";")) {
      const [attribute, key] = pair.split(":").map((part) => part.trim());
      if (attribute && key) {
        element.setAttribute(
          attribute,
          t(key as MessageKey, parseParams(element.dataset.i18nParams)),
        );
      }
    }
  }
  const doc = "documentElement" in root ? (root as Document) : root.ownerDocument;
  if (doc) doc.documentElement.lang = current;
}
