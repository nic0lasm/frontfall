import type { GameSetup } from "../ui/setup.ts";

/**
 * Where the page is (ADR 0013). The page starts in `boot` while it loads
 * its language and the maps, then shows one screen at a time:
 *
 * - `menu`: the main menu, with the profile, the achievements and the
 *   settings as panels of its own;
 * - `join`: the name asked by an invitation link;
 * - `lobby`: an online game gathering its players, its id once the server said it;
 * - `playing`: a game on screen, solo, the tutorial or online;
 * - `ended`: the same game once decided, its end screen over the map;
 * - `watching`: a replay.
 */
export type AppState =
  | { readonly screen: "boot" }
  | { readonly screen: "menu"; readonly setup: GameSetup }
  | { readonly screen: "join"; readonly game: string }
  | { readonly screen: "lobby"; readonly game?: string }
  | GameState<"playing">
  | GameState<"ended">
  | { readonly screen: "watching" };

/** A game of the player's: solo with the setup it started from, the tutorial, or online by its id. */
export type GameState<S extends "playing" | "ended"> =
  | { readonly screen: S; readonly mode: "solo"; readonly setup: GameSetup }
  | { readonly screen: S; readonly mode: "tutorial" }
  | { readonly screen: S; readonly mode: "online"; readonly game: string };

export type Screen = AppState["screen"];

/** What moves the page from one state to the next. */
export type AppEvent =
  /** Back to the menu, by choice or after a failure, with the setup it shows. */
  | { readonly type: "menu"; readonly setup: GameSetup }
  /** An invitation link that asks for a name first. */
  | { readonly type: "invited"; readonly game: string }
  /** Into a lobby: "Play now", a game of one's own, a rematch, a link or a seat taken back. */
  | { readonly type: "online" }
  /** The server named the lobby's game. */
  | { readonly type: "lobby"; readonly game: string }
  /** The online game began. */
  | { readonly type: "started"; readonly game: string }
  /** A solo game, new or taken back. */
  | { readonly type: "solo"; readonly setup: GameSetup }
  | { readonly type: "tutorial" }
  /** A replay file to watch. */
  | { readonly type: "watch" }
  /** The game on screen is decided, or the server ended it. */
  | { readonly type: "decided" };

export type AppEventType = AppEvent["type"];

/**
 * The events each state answers; any other leaves the state as it is. The
 * menu is reachable from everywhere: leaving, and every failure, go there.
 */
export const TRANSITIONS: { readonly [S in Screen]: readonly AppEventType[] } = {
  boot: ["menu", "invited", "online"],
  menu: ["menu", "online", "solo", "tutorial", "watch"],
  join: ["menu", "online"],
  lobby: ["menu", "lobby", "started"],
  playing: ["menu", "online", "solo", "tutorial", "decided"],
  ended: ["menu", "online", "solo", "tutorial"],
  watching: ["menu"],
};

/** The state `event` leads to from `state`, or `undefined` when the state does not answer it. */
export function next(state: AppState, event: AppEvent): AppState | undefined {
  if (!TRANSITIONS[state.screen].includes(event.type)) return undefined;
  switch (event.type) {
    case "menu":
      return { screen: "menu", setup: event.setup };
    case "invited":
      return { screen: "join", game: event.game };
    case "online":
      return { screen: "lobby" };
    case "lobby":
      return { screen: "lobby", game: event.game };
    case "started":
      return { screen: "playing", mode: "online", game: event.game };
    case "solo":
      return { screen: "playing", mode: "solo", setup: event.setup };
    case "tutorial":
      return { screen: "playing", mode: "tutorial" };
    case "watch":
      return { screen: "watching" };
    case "decided":
      return state.screen === "playing" ? { ...state, screen: "ended" } : undefined;
  }
}

/** Whether the state shows a game: the map, its worker and its HUD. */
export function showsGame(state: AppState): boolean {
  return state.screen === "playing" || state.screen === "ended" || state.screen === "watching";
}

/** The page's place in the error reports (`usage().screen`). */
export function usageScreen(state: AppState): "menu" | "lobby" | "solo" | "online" | "replay" {
  switch (state.screen) {
    case "lobby":
      return "lobby";
    case "playing":
    case "ended":
      return state.mode === "online" ? "online" : "solo";
    case "watching":
      return "replay";
    case "boot":
    case "menu":
    case "join":
      return "menu";
  }
}
