import type { DesyncReport, GameRecord, Order, Turn } from "@frontfall/engine";
import type { ReportReason } from "@frontfall/protocol";
import type { MapData } from "../maps.ts";
import type { ClickOutcome, GameRules } from "./messages.ts";
import type { ClickMode, ClickNote, ClickPreview, GameUpdate } from "./game-runner.ts";

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
  /** Online: this many of the player's own orders came back in the turns played now. */
  onArrived?(orders: number): void;
}

/** The three ways a game is on screen. */
export type SessionKind = "solo" | "online" | "replay";

/**
 * What a mode lets the screen do. The screen asks these, never which mode it
 * is in, except to name the mode in a report.
 */
export interface SessionCapabilities {
  readonly kind: SessionKind;
  /** The clock can stop: solo and replays. An online game runs for everyone. */
  readonly canPause: boolean;
  /** The player gives orders: solo and online, not while watching a record. */
  readonly canOrder: boolean;
  /** The pace can change from the screen: solo (R-MODE-07) and replays. */
  readonly canSetSpeed: boolean;
  /** A record of the game can be asked for, to watch again; a replay gives none. */
  readonly recordable: boolean;
  /** An order travels to the server and plays when its turn comes back. */
  readonly relayed: boolean;
  /** Other people play, and the screen may hide them (R-DIPLO-08). */
  readonly canHide: boolean;
  /** Other people can be reported to the server's operator (R-MODE-06). */
  readonly canReport: boolean;
  /** The first steps and the tutorial may guide the player: solo only. */
  readonly guided: boolean;
}

/**
 * A running game as the screen sees it, whatever its mode: everything the
 * screen calls. What a mode cannot do its session ignores, and its
 * capabilities say so beforehand.
 */
export interface GameSession {
  readonly capabilities: SessionCapabilities;
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
  setPaused(paused: boolean): void;
  /** Ticks played per beat of the clock. */
  setSpeed(speed: number): void;
  /** The game so far, to watch again; none on a generated map or in a replay. */
  record(): Promise<GameRecord | undefined>;
  /** Solo, when the game is kept: a snapshot now, as the page goes to the background. */
  requestSnapshot(): void;
  /** Online: turns relayed by the server, in order. */
  pushTurns(turns: Turn[]): void;
  /** Online: the server flagged this client's state hash after `tick`. */
  desync(tick: number, expected: number | null): void;
  /** Online: everything needed to replay the game so far; none on a generated map. */
  desyncReport(): Promise<DesyncReport | undefined>;
  /** Online: reports another player of the game to the server's operator. */
  reportPlayer(player: number, reason: ReportReason): void;
  dispose(): void;
}
