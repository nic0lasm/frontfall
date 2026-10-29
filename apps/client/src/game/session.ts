import type { Order } from "@frontfall/engine";
import type { MapData } from "./maps.ts";
import type { ClickOutcome, GameRules } from "./messages.ts";
import type { ClickNote } from "./solo-game.ts";
import type { ClickMode, ClickPreview, GameUpdate } from "./solo-game.ts";

/** What the page needs to draw a game, once its map is loaded. */
export interface StartInfo {
  map: MapData;
  rules: GameRules;
  /** The player at this screen. */
  you: number;
  /** Highest player id, humans and bots: every id up to it needs a colour. */
  maxPlayer: number;
}

export interface SessionEvents {
  /** The map is loaded and the first tick is coming. */
  onStart(info: StartInfo): void;
  /** Once per tick, in order. The game is over when `update.winner` is set. */
  onUpdate(update: GameUpdate): void;
  /** What a click sent through `click` turned into. */
  /** `note`: something to know about an order that was sent all the same. */
  onClick(tile: number, outcome: ClickOutcome, note?: ClickNote): void;
  /** What a click asked about with `peek` would do; a later `peek` makes it stale. */
  onPeek(preview: ClickPreview): void;
  onError(message: string): void;
}

/**
 * A running game as the interface sees it. The solo game runs on this
 * machine; an online game will receive its turns from the server through
 * the same interface.
 */
export interface GameSession {
  /** Order of the local player, carried out on a coming tick. */
  sendOrder(order: Order): void;
  /**
   * A click on the map, with the attack ratio in percent and the HUD's mode;
   * the session picks the order. `reach`: tiles around the click that still
   * count as aiming at the coast or the sea, from the zoom (aimReach).
   * `seen`: who held the tile on the screen, which may be a tick behind.
   */
  click(tile: number, ratio: number, mode?: ClickMode, reach?: number, seen?: number): void;
  /** Asks what a click in a build mode would do, without doing it: answered by `onPeek`. */
  peek(tile: number, mode: ClickMode, reach?: number): void;
  /** Solo only: online games never pause. */
  setPaused(paused: boolean): void;
  dispose(): void;
}
