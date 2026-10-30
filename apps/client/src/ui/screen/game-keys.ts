import type { ClickMode } from "../../game/solo-game.ts";
import { commandCode, isTextEntry } from "../../input/keyboard.ts";
import { BUILD_MODES, offers } from "../build-modes.ts";

/** The build buttons' shortcut keys, by the key's place on a QWERTY keyboard. */
const BUILD_KEYS: Partial<Record<string, ClickMode>> = {
  KeyC: "city",
  KeyB: "palace",
  KeyF: "fort",
  KeyO: "port",
  KeyL: "silo",
  KeyK: "airDefense",
  KeyJ: "mosque",
  KeyV: "warship",
  KeyM: "missile",
  KeyN: "heavyMissile",
  KeyX: "demolish",
};

/** The build buttons' numbers, as the digit keys that pick them. */
const BUILD_DIGITS: Readonly<Record<number, ClickMode>> = Object.fromEntries(
  BUILD_MODES.flatMap((entry) => ("number" in entry ? [[entry.number, entry.mode]] : [])),
);

/** Form fields that take no typing: a key pressed on a slider or a button is still a shortcut. */
const NO_TEXT = new Set([
  "range",
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "color",
  "file",
]);

/** Whether a key goes to a field the player types into, which keeps its keys from being shortcuts. */
export function typingIn(target: EventTarget | null): boolean {
  if (!isTextEntry(target)) return false;
  const { tagName, type } = target as { tagName?: string; type?: string };
  return !(tagName === "INPUT" && type !== undefined && NO_TEXT.has(type));
}

/** What a key does in a game, in the order Esc tries them. */
export type GameKey =
  | { readonly type: "closeOverlay" }
  | { readonly type: "closeMenu" }
  | { readonly type: "mode"; readonly mode: ClickMode }
  | { readonly type: "ratio"; readonly percent: number }
  | { readonly type: "pause" }
  | { readonly type: "speed" }
  | { readonly type: "switchView" }
  | { readonly type: "help" };

/** What the screen shows when the key goes down. */
export interface KeyState {
  readonly overlay: boolean;
  /** The player menu is open. */
  readonly menu: boolean;
  readonly mode: ClickMode;
  /** A recorded game: no build modes. */
  readonly watching: boolean;
  /** What the game leaves out (R-MODE-03): its build keys do nothing. */
  readonly disabled: number;
  readonly globeAllowed: boolean;
}

/**
 * The game's shortcut for a key, or none. Esc closes a dialog, then the
 * player menu, then a build mode, before it pauses the game.
 */
export function gameKey(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  state: KeyState,
): GameKey | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  if (event.code === "Escape" && state.overlay) return { type: "closeOverlay" };
  if (event.code === "Escape" && state.menu) return { type: "closeMenu" };
  if (event.code === "Escape" && state.mode !== "attack") return { type: "mode", mode: "attack" };
  const command = commandCode(event.key, event.code);
  const mode = state.watching ? undefined : BUILD_KEYS[command];
  if (mode && offers(mode, state.disabled)) return { type: "mode", mode };
  if (event.code.startsWith("Digit")) {
    const digit = Number(event.code.slice(5));
    // Digits pick the building of that number; with Shift, the share of troops an attack takes.
    if (event.shiftKey) return { type: "ratio", percent: digit === 0 ? 100 : digit * 10 };
    const built = state.watching ? undefined : BUILD_DIGITS[digit];
    return built && offers(built, state.disabled) ? { type: "mode", mode: built } : undefined;
  }
  if (command === "KeyP" || event.code === "Escape") return { type: "pause" };
  if (command === "KeyT" && !state.watching) return { type: "speed" };
  if (command === "KeyG" && state.globeAllowed) return { type: "switchView" };
  if (command === "KeyH" || command === "?") return { type: "help" };
  return undefined;
}
