import { applyTranslations } from "../i18n/index.ts";
import { h } from "./dom.ts";
import { safeStorage } from "./setup.ts";

/** Interface sizes on offer, as a percentage of the normal one. */
export const SCALES = [100, 125, 150] as const;
export type Scale = (typeof SCALES)[number];

export interface AccessibilitySettings {
  scale: Scale;
  /** Calm the interface and the map even where the system does not ask for it. */
  reduceMotion: boolean;
  /** Lighter text and stronger edges on panels. */
  highContrast: boolean;
}

export const STORAGE_KEY = "frontfall.accessibility";

const DEFAULTS: AccessibilitySettings = { scale: 100, reduceMotion: false, highContrast: false };

/** What was stored, with anything unreadable or out of range put back to the default. */
export function parseSettings(raw: string | null | undefined): AccessibilitySettings {
  const settings = { ...DEFAULTS };
  if (!raw) return settings;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return settings;
    const stored = value as Record<string, unknown>;
    const scale = SCALES.find((s) => s === stored["scale"]);
    if (scale) settings.scale = scale;
    settings.reduceMotion = stored["reduceMotion"] === true;
    settings.highContrast = stored["highContrast"] === true;
  } catch {
    // Not JSON: the defaults stand.
  }
  return settings;
}

let current: AccessibilitySettings = { ...DEFAULTS };
const listeners = new Set<() => void>();

/** Reads the stored settings and applies them to the page; call once at start-up. */
export function loadAccessibility(): AccessibilitySettings {
  current = parseSettings(safeStorage()?.getItem(STORAGE_KEY));
  apply(current);
  return current;
}

export function accessibility(): Readonly<AccessibilitySettings> {
  return current;
}

export function updateAccessibility(change: Partial<AccessibilitySettings>): void {
  current = { ...current, ...change };
  try {
    safeStorage()?.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // The choice then lasts until the page is closed.
  }
  apply(current);
  for (const listener of listeners) listener();
}

/** Whether to hold back animation: the system asks for it, or the player did. */
export function motionReduced(): boolean {
  return current.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Calls back when motion preference changes, from either source; returns the way to stop. */
export function onMotionChange(callback: () => void): () => void {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  listeners.add(callback);
  return () => {
    query.removeEventListener("change", callback);
    listeners.delete(callback);
  };
}

function apply(settings: AccessibilitySettings): void {
  const root = document.documentElement;
  root.style.setProperty("--ff-ui-scale", String(settings.scale / 100));
  root.toggleAttribute("data-reduce-motion", settings.reduceMotion);
  root.toggleAttribute("data-high-contrast", settings.highContrast);
}

/** The "Accessibility" disclosure of the menu: interface size, motion, contrast and, from the audio code, sound. */
export function accessibilityPanel(): HTMLDetailsElement {
  const scale = h("select", { id: "ui-scale", "data-i18n-attr": "aria-label:a11y.scale" });
  for (const value of SCALES) {
    const option = h("option", { value: String(value) }, `${String(value)} %`);
    option.selected = value === current.scale;
    scale.append(option);
  }
  scale.addEventListener("change", () => {
    updateAccessibility({ scale: Number(scale.value) as Scale });
  });

  const toggle = (id: string, key: "reduceMotion" | "highContrast", label: string): HTMLElement => {
    const input = h("input", { type: "checkbox", id });
    input.checked = current[key];
    input.addEventListener("change", () => {
      updateAccessibility({ [key]: input.checked });
    });
    return h("label", { class: "toggle", for: id }, input, h("span", { "data-i18n": label }));
  };

  const soundControls = h("div", { class: "sound-controls" });
  const panel = h(
    "details",
    { class: "accessibility" },
    h("summary", { "data-i18n": "a11y.title" }),
    h(
      "div",
      { class: "accessibility-body" },
      h(
        "div",
        { class: "field" },
        h("label", { for: "ui-scale", "data-i18n": "a11y.scale" }),
        scale,
      ),
      toggle("reduce-motion", "reduceMotion", "a11y.motion"),
      toggle("high-contrast", "highContrast", "a11y.contrast"),
      soundControls,
      h("p", { class: "accessibility-note", "data-i18n": "a11y.note" }),
    ),
  );
  // The sound settings come with the audio code, apart from the first visit.
  void import("../audio/controls.ts").then(
    ({ soundPanel }) => {
      soundControls.append(...soundPanel());
    },
    () => undefined,
  );
  applyTranslations(panel);
  return panel;
}
