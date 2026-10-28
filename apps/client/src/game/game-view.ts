import type { GameRecord, GameRules, Order, Phase, Turn } from "@frontfall/engine";
import type { LabelAnchor } from "./label-anchors.ts";

/*
 * What a game shows the interface: the options it starts from, the state the
 * worker sends after each tick, and the answers to a click on the map. Types
 * only, shared by the worker, the session and the interface.
 */
export type Difficulty = "easy" | "normal" | "hard";

/** What a click on the map does: attack by default, or build or demolish once picked in the HUD. */
export type ClickMode =
  | "attack"
  | "city"
  | "palace"
  | "fort"
  | "port"
  | "silo"
  | "airDefense"
  | "warship"
  | "missile"
  | "heavyMissile"
  | "demolish";

export interface SoloOptions {
  map: string;
  seed: number;
  bots: number;
  difficulty: Difficulty;
  /** Whether the map's nations play, after the bots (R-BOT-07); off when left out. */
  nations?: boolean | undefined;
  /** Teams the players are dealt into (R-MODE-02): 2 to 4, or 0 or left out for a free-for-all. */
  teams?: number | undefined;
  /** What the game leaves out (R-MODE-03), as the engine's `Disable` bits; nothing when left out. */
  disabled?: number | undefined;
  /** Special rules the game plays with (R-MODE-08); each one left out is off. */
  rules?: Partial<GameRules> | undefined;
  playerName: string;
  /**
   * For tests that play a game to its end: ticks run per beat of the clock
   * (1 by default), and a time limit in minutes instead of B-MAX-DURATION.
   */
  speed?: number | undefined;
  maxMinutes?: number | undefined;
  /** For tests that build: B-GOLD-RATE instead of its value in the balance. */
  goldRate?: number | undefined;
  /** For tests that build a palace on a small map: B-CITY-LAND instead of its value. */
  cityLand?: number | undefined;
  /**
   * Online: the human players in their final numbering, and which one plays
   * at this screen. Bots then take the numbers after the last human, and
   * `playerName` is not used.
   */
  players?: readonly { id: number; name: string }[] | undefined;
  you?: number | undefined;
  /**
   * A finished game to watch again: its setup replaces every option above
   * but `map` and `speed`, and its turns are the only orders (#50).
   */
  record?: GameRecord | undefined;
  /**
   * Online: where this browser left the game before a reload (#39). The
   * game starts from it, and only the turns after it are played.
   */
  snapshot?: GameSnapshot | undefined;
}

/** A game between two ticks, and every turn with orders before. */
export interface GameSnapshot {
  tick: number;
  bytes: Uint8Array;
  history: Turn[];
}

/** How far a replay has got; `hash` once it reached its last tick, to compare with `expected`. */
export interface ReplayView {
  ticks: number;
  expected: number;
  hash?: number;
}

export interface PlayerView {
  id: number;
  name: string;
  troops: number;
  /** Troops the player's land can hold (R-ECO-01). */
  cap: number;
  gold: number;
  /** Share of the troops at home who work, in percent (R-ECO-07). */
  workShare: number;
  tiles: number;
  alive: boolean;
  /** Tile of the player's capital, in capital mode (R-CAP-01). */
  capital?: number;
}

/** A capital that fell or was razed (R-CAP-03, R-CAP-04). */
export interface CapitalFallView {
  tick: number;
  player: number;
  /** Who took it; 0 when it was razed. */
  by: number;
}

/** One of the human's attacks under way; its id is what a retreat order names. */
export interface AttackView {
  id: number;
  /** Owner of the land under attack, 0 for unclaimed land. */
  target: number;
  troops: number;
}

/** Per second, at the current troops: zero outside play and once eliminated. */
export interface EconomyView {
  /** Troops gained (R-ECO-02). */
  growth: number;
}

export interface GameUpdate {
  /** The player at this screen. */
  you: number;
  tick: number;
  phase: Phase;
  /** Ticks left before attacks open; 0 once the game is under way. */
  spawnTicksLeft: number;
  players: PlayerView[];
  /** Troops of the human's attacks under way, one entry per attack. */
  attacks: AttackView[];
  /** Tiles that changed owner this tick, and their new owners, pair by pair. */
  changedTiles: Int32Array;
  changedOwners: Uint16Array;
  /** Where players' names go, every LABEL_TICKS ticks; the last ones hold in between. */
  labels?: LabelAnchor[];
  /** Every transport ship at sea. */
  boats: BoatView[];
  /** Every trade ship at sea (R-UNIT-03). */
  tradeShips: TradeShipView[];
  /** Every warship (R-UNIT-04). */
  warships: WarshipView[];
  /** Every missile in flight (R-UNIT-05). */
  missiles: MissileView[];
  /** Land under fallout (R-UNIT-06), as discs. */
  fallout: FalloutView[];
  /** Every structure on the map. */
  structures: StructureView[];
  /** What the player at this screen can build next. */
  build: BuildView;
  /** What the player at this screen gains each second. */
  economy: EconomyView;
  /** Alliances, requests and traitors, as the player at this screen sees them. */
  diplomacy: DiplomacyView;
  /** What changed between players since the last update, for every player to read (R-DIPLO-04). */
  events: DiplomacyEvent[];
  /**
   * Set in capital mode (R-CAP): the capitals that fell so far, and the
   * player whose front threatens yours (R-CAP-05), 0 while it is safe, and
   * the ticks before capitals can fall (R-CAP-06), 0 once they can.
   */
  capitals?: { falls: CapitalFallView[]; threat: number; standsIn: number };
  /** Set instead of the change lists when too much changed to list. */
  owners?: Uint16Array;
  winner?: number;
  /** In a team game, the team that won (R-MODE-02). */
  winningTeam?: number;
  /** Online: state hashes after the ticks the server checks (`HASH_INTERVAL`). */
  hashes?: { tick: number; hash: number }[];
  /** Set while watching a recorded game. */
  replay?: ReplayView;
}

/** Why a click on the map leads to no order. */
export type ClickRefusal =
  /** Water, ice or off the map. */
  | "terrain"
  | "own"
  /** Land of a teammate, who is never attacked (R-MODE-02). */
  | "teammate"
  /** The attack ratio leaves less than one troop. */
  | "troops"
  /** No shared border and no sea route to a coast. */
  | "unreachable"
  /** B-BOAT-MAX ships are already at sea. */
  | "ships"
  /** The game is decided, or the player is out. */
  | "over"
  /** Building opens with the attacks, after the spawn phase. */
  | "early"
  /** A structure goes on the player's own land only. */
  | "foreign"
  /** A port needs a tile by the water (R-BUILD-02). */
  | "coast"
  /** A warship is bought at a ready port of the player's (R-UNIT-04). */
  | "port"
  /** The port has no water next to it for a warship to start on. */
  | "shore"
  /** The player has B-WARSHIP-MAX warships already. */
  | "warships"
  /** No warship of the player's can sail to that water. */
  | "noWarship"
  /** No silo of the player's is built and loaded (R-BUILD-04). */
  | "silo"
  /** Another structure stands closer than B-BUILD-SPACING. */
  | "crowded"
  /** The player's land supports no more cities (R-BUILD-07). */
  | "land"
  | "gold"
  /** No structure of the player's near the click to demolish. */
  | "nothing"
  /** The land belongs to an ally: betray them first (R-DIPLO-02). */
  | "ally"
  /** A missile's blast would reach an ally's or a teammate's land (R-UNIT-05). */
  | "allyNear"
  /** Left out of this game by its host (R-MODE-03). */
  | "disabled";

/** Something to know about an order that was sent all the same. */
export type ClickNote =
  /** A port on a lake trades only with ports on the same lake (R-MAP-05). */
  "lake";

export type ClickResult = { order: Order; note?: ClickNote } | { refused: ClickRefusal };

/** What a click would do, shown before it is made: see `previewForClick`. */
export interface ClickPreview {
  /** Where the order would land. */
  tile: number;
  /** Why it would be refused; none when it would go through. */
  refused?: ClickRefusal;
  note?: ClickNote;
  /** Tiles a fort or an air defense guards around it. */
  radius?: number;
}

export type StructureType = "city" | "palace" | "fort" | "port" | "silo" | "airDefense";

export interface StructureView {
  id: number;
  player: number;
  type: StructureType;
  tile: number;
  /** False while it is being built (B-BUILD-TIME). */
  ready: boolean;
}

export interface BuildView {
  /** Gold the next city and the next fort cost the player. */
  cityCost: number;
  /** What the next two cities would cost together (R-BUILD-08). */
  palaceCost: number;
  fortCost: number;
  portCost: number;
  warshipCost: number;
  siloCost: number;
  airDefenseCost: number;
  missileCost: number;
  heavyMissileCost: number;
  /** Whether a silo of the player's has a missile ready. */
  loaded: boolean;
  /** Cities owned or being built, a palace counting as two. */
  cities: number;
  /** Most cities the player's land supports now. */
  cityLimit: number;
}

/** Alliances and requests of the player at this screen, and every traitor, with their time left in ticks. */
export interface DiplomacyView {
  allies: AllyView[];
  /** The player's teammates (R-MODE-02), allies for the whole game; empty in a free-for-all. */
  teammates: number[];
  /** Requests to the player, oldest first. */
  incoming: { from: number; ticksLeft: number }[];
  /** Players the player has asked and who have not answered yet. */
  outgoing: number[];
  /** Players who may not be asked yet: a request ran out, or the player betrayed them. */
  waiting: number[];
  traitors: { id: number; ticksLeft: number }[];
  /** Players under the embargo of the player at this screen (R-DIPLO-05). */
  embargoes: number[];
  /** Players whose embargo is on the player at this screen. */
  embargoedBy: number[];
  /** Players at war with the player at this screen, who take no gift (R-DIPLO-06). */
  atWar: number[];
  /** Ticks before the player at this screen may send another quick message (R-DIPLO-07). */
  quickIn: number;
}

export interface AllyView {
  id: number;
  ticksLeft: number;
  /** In the last part of the alliance, when both may renew it (R-DIPLO-03). */
  renewable: boolean;
  /** The player at this screen has asked to renew; the ally has not yet. */
  renewing: boolean;
}

/** An alliance formed, run out, or broken by `a`, or an embargo of `a` on `b` started or lifted. `a` and `b` are player ids. */
export interface DiplomacyEvent {
  type:
    | "allied"
    | "ended"
    | "betrayed"
    | "embargo"
    | "lifted"
    | "captured"
    | "missile"
    | "stopped"
    | "gift"
    | "quick"
    | "collapsed"
    | "capital"
    | "razed";
  a: number;
  b: number;
  /** Where a front collapsed, for "collapsed" (R-ATTACK-10). */
  tile?: number;
  /** A quick message, by number (R-DIPLO-07). */
  phrase?: number;
}

/** A warship, where it is this tick. */
export interface WarshipView {
  id: number;
  player: number;
  tile: number;
  health: number;
}

/** A missile in flight, where it is this tick (R-UNIT-05). */
export interface MissileView {
  id: number;
  player: number;
  heavy: boolean;
  tile: number;
  /** Its target, and the owner of the target when it was last seen. */
  to: number;
  target: number;
}

/** A disc of land under fallout (R-UNIT-06). */
export interface FalloutView {
  tile: number;
  radius: number;
}

/** A trade ship at sea, where it is this tick. */
export interface TradeShipView {
  id: number;
  player: number;
  tile: number;
}

/** A transport ship at sea, where it is this tick. */
export interface BoatView {
  id: number;
  player: number;
  tile: number;
  troops: number;
}
