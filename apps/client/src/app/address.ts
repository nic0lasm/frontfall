import type { ViewKind } from "../render/renderer.ts";
import { setupQuery } from "../ui/setup.ts";
import type { AppState } from "./state.ts";

/**
 * The address bar, kept in step with the app's state (ADR 0013). Every
 * address the page writes is relative, a query string alone, so that it
 * works under any prefix (ADR 0004).
 */

/**
 * How the map is shown while the globe is on (ADR 0005, a prototype): the
 * globe, or the flat map that G switches back from. `undefined` is the flat
 * map with no globe at all, as for every link that does not ask for it.
 */
export interface ViewChoice {
  readonly kind: ViewKind;
}

/**
 * `?view=globe` turns the globe on and starts on it, as it always did;
 * `?view=map` turns it on and starts on the flat map, which the page writes
 * once G switched back. Anything else leaves the globe off.
 */
export function parseView(search: string): ViewChoice | undefined {
  const view = new URLSearchParams(search).get("view");
  if (view === "globe") return { kind: "globe" };
  if (view === "map") return { kind: "flat" };
  return undefined;
}

/** `search` with the view of `view` in it, or without any view when the globe is off. */
export function withView(search: string, view: ViewChoice | undefined): string {
  const params = new URLSearchParams(search);
  if (view) params.set("view", view.kind === "globe" ? "globe" : "map");
  else params.delete("view");
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * The address of a state, or `undefined` where the page leaves the address
 * as it is: while it boots (the sign-in reads its own link), on the name an
 * invitation asks for (the link is the invitation), in a lobby before the
 * server named its game, in the tutorial (a game of its own that no setup
 * shares), and in a replay (its file is not in the address).
 */
export function addressOf(state: AppState, view: ViewChoice | undefined): string | undefined {
  switch (state.screen) {
    case "menu":
      return withView(setupQuery(state.setup), view);
    case "lobby":
      return state.game === undefined ? undefined : withView(gameQuery(state.game), view);
    case "playing":
    case "ended":
      if (state.mode === "solo") return withView(setupQuery(state.setup), view);
      if (state.mode === "online") return withView(gameQuery(state.game), view);
      return undefined;
    case "boot":
    case "join":
    case "watching":
      return undefined;
  }
}

/** Any online game is joined again from `?game=<id>`, after a reload too. */
function gameQuery(game: string): string {
  return `?${new URLSearchParams({ game }).toString()}`;
}

/** What the address asks for as the page opens. */
export type BootIntent =
  /** The menu; a game this browser left behind may be offered over it. */
  | { readonly kind: "menu" }
  /** `?online`: the next public game. */
  | { readonly kind: "online" }
  /** `?game=<id>`: an invitation, or a seat to take back; `name=` in it skips the question. */
  | { readonly kind: "invite"; readonly game: string; readonly named: boolean };

export function bootIntent(search: string): BootIntent {
  const query = new URLSearchParams(search);
  const game = query.get("game");
  if (game) return { kind: "invite", game, named: query.has("name") };
  if (query.has("online")) return { kind: "online" };
  return { kind: "menu" };
}

/**
 * `?speed=` and `?minutes=` let end-to-end tests play a whole game in
 * seconds, `?gold=` (B-GOLD-RATE) pay for a structure without a long
 * wait, and `?cityland=` (B-CITY-LAND) put back the land limit on cities,
 * small enough for a palace on a small map; nothing in the interface sets them.
 */
export interface TestingOptions {
  readonly speed?: number | undefined;
  readonly maxMinutes?: number | undefined;
  readonly goldRate?: number | undefined;
  readonly cityLand?: number | undefined;
}

/** The testing options of an address, each left out unless in range. */
export function testingOptions(search: string): TestingOptions {
  const params = new URLSearchParams(search);
  const number = (name: string, max: number): number | undefined => {
    const value = Number(params.get(name));
    return params.has(name) && value > 0 && value <= max ? value : undefined;
  };
  return {
    speed: number("speed", 100),
    maxMinutes: number("minutes", 60),
    goldRate: number("gold", 10_000),
    cityLand: number("cityland", 10_000),
  };
}
