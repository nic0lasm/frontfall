import type { Attack } from "../attacks.ts";
import type { Boat } from "../boats.ts";
import type {
  Alliance,
  AllianceRequest,
  DiplomacyEvent,
  Embargo,
  RequestCooldown,
} from "../diplomacy.ts";
import type { Game } from "../game.ts";
import type { Fallout, Missile, MissileEvent } from "../missiles.ts";
import type { QuickCooldown } from "../quick-messages.ts";
import type { Structure } from "../structures.ts";
import type { TradeShip } from "../trade.ts";
import type { Fight, Warship } from "../warships.ts";

/**
 * The entity lists of a game as their owners write them (ADR 0010). `Game`
 * shows each one as `readonly Readonly<T>[]`; the module that owns a list,
 * and the snapshot loader, take the writable list with `writable`. Every
 * other rule changes a list through the functions its owner exports. The
 * comment on each field names its owner modules, which
 * `tools/test/boundaries.test.ts` reads to check who calls `writable` for
 * which list, and who may name an entity type without `Readonly`.
 */
export interface GameLists {
  /** attacks.ts, attack-recall.ts */
  attacks: Attack[];
  /** boats.ts */
  boats: Boat[];
  /** structures.ts */
  structures: Structure[];
  /** trade.ts */
  tradeShips: TradeShip[];
  /** warships.ts */
  warships: Warship[];
  /** missiles.ts */
  missiles: Missile[];
  /** missiles.ts */
  fallout: Fallout[];
  /** warships.ts */
  fights: Fight[];
  /** diplomacy.ts */
  alliances: Alliance[];
  /** diplomacy.ts */
  allianceRequests: AllianceRequest[];
  /** diplomacy.ts */
  requestCooldowns: RequestCooldown[];
  /** diplomacy.ts */
  embargoes: Embargo[];
  /** quick-messages.ts */
  quickCooldowns: QuickCooldown[];
  /** diplomacy.ts */
  diplomacyEvents: DiplomacyEvent[];
  /** missiles.ts */
  missileEvents: MissileEvent[];
}

const lists = new WeakMap<Game, GameLists>();

/** Empty lists for a new game, kept for `writable`; the game's constructor calls it once. */
export function newLists(game: Game): GameLists {
  const created: GameLists = {
    attacks: [],
    boats: [],
    structures: [],
    tradeShips: [],
    warships: [],
    missiles: [],
    fallout: [],
    fights: [],
    alliances: [],
    allianceRequests: [],
    requestCooldowns: [],
    embargoes: [],
    quickCooldowns: [],
    diplomacyEvents: [],
    missileEvents: [],
  };
  lists.set(game, created);
  return created;
}

/**
 * The list `name` of `game`, writable: only for the module that owns it,
 * named on its field of `GameLists`, and for the snapshot loader.
 */
export function writable<K extends keyof GameLists>(game: Game, name: K): GameLists[K] {
  const found = lists.get(game);
  if (!found) throw new RangeError("not a game");
  return found[name];
}
