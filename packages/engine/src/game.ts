import {
  DISABLE_ALL,
  Disable,
  MAX_TEAMS,
  NO_RULES,
  OPERATOR_BONUS_ALL,
  OperatorBonus,
  type GameRules,
  type Order,
  type OrderType,
  type Turn,
} from "@frontfall/contracts";
import type { Attack } from "./attacks.ts";
import { DEFAULT_BALANCE, checkBalance, digestBalance, type Balance } from "./balance.ts";
import type { Boat } from "./boats.ts";
import type {
  Alliance,
  AllianceRequest,
  DiplomacyEvent,
  Embargo,
  RequestCooldown,
} from "./diplomacy.ts";
import type { Fallout, Missile, MissileEvent } from "./missiles.ts";
import type { QuickCooldown } from "./quick-messages.ts";
import { eraseRule, planOrder, type OrderRule } from "./order-rules.ts";
import { NO_OPERATOR, OPERATOR_FACTOR, leftOut, ruleBits, type OperatorBonuses } from "./modes.ts";
import { Random } from "./random.ts";
import { FNV_OFFSET, mix, mixUnit } from "./state/fnv.ts";
import { writeState } from "./state/layout.ts";
import { newLists } from "./state/lists.ts";
import type { PartKey, PersistedPart } from "./state/parts.ts";
import { StateHasher } from "./state/writer.ts";
import type { Structure } from "./structures.ts";
import type { Terrain } from "./terrain.ts";
import type { TradeShip } from "./trade.ts";
import type { Fight, Warship } from "./warships.ts";
import { MAX_PLAYER_ID, TerritoryMap } from "./territory/territory-map.ts";

// Shared with the protocol through the contracts, or kept in ./modes.ts; exported here as before.
export {
  DISABLE_ALL,
  Disable,
  MAX_TEAMS,
  NO_OPERATOR,
  NO_RULES,
  OPERATOR_BONUS_ALL,
  OPERATOR_FACTOR,
  OperatorBonus,
  leftOut,
  ruleBits,
  type GameRules,
  type OperatorBonuses,
  type Order,
  type PersistedPart,
  type Turn,
};

export interface PlayerSetup {
  /** 1 to MAX_PLAYER_ID; 0 is the neutral owner. */
  id: number;
  name: string;
  /** Start tile set by the map, for a nation (R-BOT-07); others pick or are placed. */
  start?: number;
}

export interface GameSetup {
  terrain: Terrain;
  seed: number;
  players: readonly PlayerSetup[];
  balance?: Balance;
  /**
   * Teams of the game (R-MODE-02): 2, 3 or 4, dealt in turn to the players
   * in id order; 0 or left out for a free-for-all.
   */
  teams?: number;
  /** What this game leaves out (R-MODE-03), as `Disable` bits; 0 or left out for nothing. */
  disabled?: number;
  /** Special rules this game plays with (R-MODE-08); each one left out is off. */
  rules?: Partial<GameRules>;
  /**
   * The operator's test bonuses (R-MODE-09): the player who has them and the
   * `OperatorBonus` bits they turned on. Left out, as in every game but a
   * private one of the operator, nobody has any.
   */
  operator?: OperatorBonuses;
}

/** Marks the operator's bonuses in the setup digest (R-MODE-09). */
const OPERATOR_TAG = 0x6f706572;

/**
 * A player's ledger. Unlike the entity lists, which only their owner module
 * writes (ADR 0010), it is shared: growth, income, attacks, ships, missiles,
 * gifts, tribute, trade and capitals all add to or take from `troops` and
 * `gold`, each under its own rule. The other fields belong to one rule each
 * and are written by it only, and by the snapshot loader: `alive` and
 * `goldRemainder` by the economy, `start` by the spawn phase and
 * `traitorUntil` by diplomacy. What a single rule keeps about a player, such
 * as their work share, doctrine or capital, is in that rule's part, read
 * with its accessor (`workShareOf`, `doctrineOf`, `capitalOf`).
 */
export interface Player {
  readonly id: number;
  readonly name: string;
  troops: number;
  gold: number;
  /** Fraction of a gold coin earned but not yet paid, in units of the economy's divisor. */
  goldRemainder: number;
  alive: boolean;
  /** Start tile, once picked or placed during the spawn phase. */
  start: number | undefined;
  /** First tick the player is no longer marked a traitor (R-DIPLO-04); 0 if never. */
  traitorUntil: number;
  /** Start tile the map sets for a nation (R-BOT-07); undefined for players who pick. */
  readonly home: number | undefined;
  /** Team from 1, or 0 in a free-for-all (R-MODE-02). */
  readonly team: number;
}

export type Phase = "spawn" | "play";

/** Runs once per tick, after the orders of that tick, in registration order. */
export type TickSystem = (game: Game) => void;

/** Told of an order once its rule has carried it out. */
export type OrderObserver = (game: Game, player: Player, order: Order) => void;

/**
 * The whole state of one game and the loop that advances it. Given the same
 * setup and the same turns, every runtime reaches the same state (ADR 0001).
 */
export class Game {
  readonly terrain: Terrain;
  readonly territory: TerritoryMap;
  readonly random: Random;
  /** Seed of the game, for draws derived from it (`derivedRandom`). */
  readonly seed: number;
  readonly balance: Balance;
  /** Attacks under way, oldest first. Owned by the attack rules; read only elsewhere. */
  readonly attacks: readonly Readonly<Attack>[];
  nextAttackId = 1;
  /** Transport ships at sea, oldest first. Owned by the boat rules; read only elsewhere. */
  readonly boats: readonly Readonly<Boat>[];
  nextBoatId = 1;
  /** Structures on the map, oldest first. Owned by the structure rules; read only elsewhere. */
  readonly structures: readonly Readonly<Structure>[];
  nextStructureId = 1;
  /** Trade ships at sea, oldest first. Owned by the trade rules; read only elsewhere. */
  readonly tradeShips: readonly Readonly<TradeShip>[];
  /**
   * What a computer player's difficulty does to its population, in percent:
   * its starting troops, its cap, its growth and its gold (R-BOT-04, R-BOT-29). Set again by whoever installs the
   * player at the start of every game, so it is not part of the state.
   */
  readonly popFactors = new Map<
    number,
    {
      readonly cap: number;
      readonly growth: number;
      readonly start?: number;
      readonly gold?: number;
    }
  >();
  /** Players run as bots (R-BOT-01), whose land prices differ (R-ATTACK-04); set with the bots, not part of the state. */
  readonly bots = new Set<number>();
  /** City-states among the bots (R-BOT-29), which take no allies; set with them, not part of the state. */
  readonly cityStates = new Set<number>();
  nextTradeShipId = 1;
  /** Warships, oldest first. Owned by the warship rules; read only elsewhere. */
  readonly warships: readonly Readonly<Warship>[];
  nextWarshipId = 1;
  /** Missiles in flight, oldest first. Owned by the missile rules; read only elsewhere. */
  readonly missiles: readonly Readonly<Missile>[];
  nextMissileId = 1;
  /** Fallout of heavy missiles still on the land, oldest first (R-UNIT-06). */
  readonly fallout: readonly Readonly<Fallout>[];
  /**
   * First tick each tile is free of fallout again; 0 if it never had any.
   * Above the tick, it follows from `fallout` and the terrain, which the
   * state hash covers: snapshots keep it, the hash leaves it out.
   */
  readonly falloutUntil: Uint32Array;
  /** Fights between players, remembered for B-WAR-MEMORY, by ascending pair of ids. */
  readonly fights: readonly Readonly<Fight>[];
  /** Alliances by ascending pair of ids. Owned by the diplomacy rules; read only elsewhere. */
  readonly alliances: readonly Readonly<Alliance>[];
  /** Alliance requests waiting for an answer, oldest first. */
  readonly allianceRequests: readonly Readonly<AllianceRequest>[];
  /** Players who may not ask a given player again yet, oldest first. */
  readonly requestCooldowns: readonly Readonly<RequestCooldown>[];
  /** Embargoes, oldest first (R-DIPLO-05). */
  readonly embargoes: readonly Readonly<Embargo>[];
  /** Players waiting to send another quick message (R-DIPLO-07), by player id. */
  readonly quickCooldowns: readonly Readonly<QuickCooldown>[];
  /**
   * What happened between players, oldest first, for interfaces to read and
   * empty. No rule reads it back, so it is not part of the state hash.
   */
  readonly diplomacyEvents: readonly Readonly<DiplomacyEvent>[];
  /**
   * How each missile ended, oldest first, for interfaces to read and empty.
   * No rule reads it back, so it is not part of the state hash.
   */
  readonly missileEvents: readonly Readonly<MissileEvent>[];
  /** Number of teams, 0 in a free-for-all (R-MODE-02). */
  readonly teams: number;
  /** `Disable` bits of what this game leaves out (R-MODE-03). */
  readonly disabled: number;
  /** Special rules of this game (R-MODE-08). */
  readonly rules: GameRules;
  /** The operator's test bonuses (R-MODE-09); `NO_OPERATOR` in nearly every game. */
  readonly operator: OperatorBonuses;
  /**
   * Winner once the game is decided (R-WIN), and the tick it happened. In a
   * team game, the member of the winning team with the most land.
   */
  winner: number | undefined;
  /** In a team game, the team that won. */
  winningTeam: number | undefined;
  decidedAt: number | undefined;
  private readonly playersById = new Map<number, Player>();
  private readonly sortedPlayers: readonly Player[];
  private readonly orderRules = new Map<OrderType, OrderRule>();
  private readonly systems: TickSystem[] = [];
  private readonly observers: OrderObserver[] = [];
  private readonly persisted: { readonly name: string; readonly part: PersistedPart }[] = [];
  /** The parts registered with `addPart`, by the slot of their key. */
  private readonly parts: (PersistedPart | undefined)[] = [];
  private currentTick = 0;
  private setup: number | undefined;
  /** The balance values, folded once into the state hash: clients that disagree on them part at once. */
  private readonly balanceDigest: number;

  constructor(setup: GameSetup) {
    const lists = newLists(this);
    this.attacks = lists.attacks;
    this.boats = lists.boats;
    this.structures = lists.structures;
    this.tradeShips = lists.tradeShips;
    this.warships = lists.warships;
    this.missiles = lists.missiles;
    this.fallout = lists.fallout;
    this.fights = lists.fights;
    this.alliances = lists.alliances;
    this.allianceRequests = lists.allianceRequests;
    this.requestCooldowns = lists.requestCooldowns;
    this.embargoes = lists.embargoes;
    this.quickCooldowns = lists.quickCooldowns;
    this.diplomacyEvents = lists.diplomacyEvents;
    this.missileEvents = lists.missileEvents;
    this.terrain = setup.terrain;
    this.random = new Random(setup.seed);
    this.seed = setup.seed >>> 0;
    this.balance = setup.balance ?? DEFAULT_BALANCE;
    checkBalance(this.balance);
    let highest = 1;
    for (const { id, name, start: home } of setup.players) {
      if (!Number.isInteger(id) || id < 1 || id > MAX_PLAYER_ID) {
        throw new RangeError(`invalid player id ${String(id)}`);
      }
      if (this.playersById.has(id)) throw new RangeError(`duplicate player id ${String(id)}`);
      if (
        home !== undefined &&
        !(Number.isInteger(home) && home >= 0 && home < setup.terrain.topology.size)
      ) {
        throw new RangeError(`start of player ${String(id)} is off the map`);
      }
      this.playersById.set(id, {
        id,
        name,
        troops: 0,
        gold: 0,
        goldRemainder: 0,
        alive: true,
        start: undefined,
        traitorUntil: 0,
        home,
        team: 0,
      });
      highest = Math.max(highest, id);
    }
    const teams = setup.teams ?? 0;
    if (teams !== 0 && !(Number.isInteger(teams) && teams >= 2 && teams <= MAX_TEAMS)) {
      throw new RangeError(`invalid number of teams ${String(teams)}`);
    }
    this.teams = teams;
    const disabled = setup.disabled ?? 0;
    if (!(Number.isInteger(disabled) && disabled >= 0 && disabled <= DISABLE_ALL)) {
      throw new RangeError(`invalid disabled set ${String(disabled)}`);
    }
    this.disabled = leftOut(disabled);
    this.rules = {
      capitals: setup.rules?.capitals === true,
      collapsingFronts: setup.rules?.collapsingFronts === true,
      doctrines: setup.rules?.doctrines === true,
    };
    this.balanceDigest = digestBalance(
      this.balance,
      this.rules,
      setup.terrain.landmarks.length > 0,
    );
    const { player: bonusPlayer, bonuses } = setup.operator ?? NO_OPERATOR;
    if (!(Number.isInteger(bonuses) && bonuses >= 0 && bonuses <= OPERATOR_BONUS_ALL)) {
      throw new RangeError(`invalid operator bonuses ${String(bonuses)}`);
    }
    if (bonuses !== 0 && !this.playersById.has(bonusPlayer)) {
      throw new RangeError(`operator bonuses for unknown player ${String(bonusPlayer)}`);
    }
    this.operator = bonuses === 0 ? NO_OPERATOR : { player: bonusPlayer, bonuses };
    // R-MODE-02: dealt in turn, so team sizes differ by one at most.
    this.sortedPlayers = [...this.playersById.values()]
      .sort((a, b) => a.id - b.id)
      .map((player, i) => (teams === 0 ? player : { ...player, team: (i % teams) + 1 }));
    for (const player of this.sortedPlayers) this.playersById.set(player.id, player);
    this.territory = new TerritoryMap(setup.terrain.topology, highest);
    this.falloutUntil = new Uint32Array(setup.terrain.topology.size);
  }

  /** Number of the next tick to run; also the number of ticks run so far. */
  get tick(): number {
    return this.currentTick;
  }

  get phase(): Phase {
    return this.currentTick < this.balance.spawnPhaseTicks ? "spawn" : "play";
  }

  /** Whether fallout still lies on a tile, which makes it dearer to take (R-UNIT-06). */
  irradiated(tile: number): boolean {
    return (this.falloutUntil[tile] as number) > this.currentTick;
  }

  /** Whether this game has what a `Disable` bit stands for (R-MODE-03). */
  allows(feature: number): boolean {
    return (this.disabled & feature) === 0;
  }

  player(id: number): Player | undefined {
    return this.playersById.get(id);
  }

  /** Players in ascending id order, so iteration is the same everywhere. */
  players(): readonly Player[] {
    return this.sortedPlayers;
  }

  /**
   * 32-bit FNV-1a hash of the whole game state. Two clients that ran the same
   * turns must report the same hash for the same tick (R-FAIR-01).
   *
   * It is regular (ADR 0008): the tick, then the setup every client shares
   * (the balance digest, teams, what the game leaves out, its special rules,
   * the operator's bonuses, and each player's id, start set by the map and
   * team), then the state in the order of a snapshot, through the same
   * writer: every list behind its length, every path in full, and each rule
   * part behind its name. A rule the game does not play with registers no
   * part, so its state is not in the hash at all.
   */
  hash(): number {
    const out = new StateHasher();
    out.uint(this.currentTick);
    out.word(this.balanceDigest);
    out.uint(this.teams);
    out.uint(this.disabled);
    out.uint(ruleBits(this.rules));
    out.uint(this.operator.player);
    out.uint(this.operator.bonuses);
    for (const p of this.sortedPlayers) {
      out.uint(p.id);
      // The map's nations come from its manifest, which the terrain's hash does not cover.
      out.int(p.home ?? -1);
      out.uint(p.team);
    }
    writeState(this, out);
    return out.value;
  }

  /**
   * Registers state a rule keeps outside the game, for snapshots. The name
   * says which rule, and with what: a snapshot loads only into a game whose
   * parts have the same names in the same order.
   */
  persist(name: string, part: PersistedPart): void {
    if (this.persisted.some((entry) => entry.name === name)) {
      throw new RangeError(`part ${name} is already registered`);
    }
    this.persisted.push({ name, part });
  }

  /**
   * Registers the part a rule owns under its key (`partKey`), for `part` to
   * find it: once per game, by the rule's install function, and only in a
   * game that plays with the rule. Saved and hashed like any part.
   */
  addPart<P extends PersistedPart>(key: PartKey<P>, part: P): P {
    this.persist(key.name, part);
    this.parts[key.slot] = part;
    return part;
  }

  /** The part registered under `key`, or undefined when the game does not play with its rule. */
  part<P extends PersistedPart>(key: PartKey<P>): P | undefined {
    return this.parts[key.slot] as P | undefined;
  }

  /** Parts registered with `persist` and `addPart`, in registration order. */
  persistedParts(): readonly { readonly name: string; readonly part: PersistedPart }[] {
    return this.persisted;
  }

  /** Moves a new game to the tick of the snapshot it loads; snapshots only. */
  restoreTick(tick: number): void {
    if (this.currentTick !== 0) throw new RangeError("only a new game can be restored");
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("invalid tick");
    this.currentTick = tick;
  }

  /**
   * FNV-1a over what the game was created with and never changes: seed,
   * balance, map, players, teams and what it leaves out. A snapshot loads
   * only into a game of the same setup.
   */
  setupDigest(): number {
    this.setup ??= this.digestSetup();
    return this.setup;
  }

  private digestSetup(): number {
    let hash = FNV_OFFSET;
    hash = mix(hash, this.seed);
    hash = mix(hash, this.balanceDigest);
    const { topology, kinds } = this.terrain;
    hash = mix(hash, topology.width);
    hash = mix(hash, topology.height);
    for (let tile = 0; tile < kinds.length; tile++) hash = mixUnit(hash, kinds[tile] as number);
    for (const p of this.sortedPlayers) {
      hash = mix(hash, p.id);
      hash = mix(hash, p.home ?? -1);
      hash = mix(hash, p.team);
      hash = mix(hash, p.name.length);
      for (let i = 0; i < p.name.length; i++) hash = mix(hash, p.name.charCodeAt(i));
    }
    hash = mix(hash, this.teams);
    hash = mix(hash, this.disabled);
    if (ruleBits(this.rules) !== 0) hash = mix(hash, ruleBits(this.rules));
    if (this.operator.bonuses !== 0) {
      hash = mix(hash, OPERATOR_TAG);
      hash = mix(hash, this.operator.player);
      hash = mix(hash, this.operator.bonuses);
    }
    return hash >>> 0;
  }

  /** Whether `player` has the operator's bonus `bonus`, an `OperatorBonus` bit (R-MODE-09). */
  hasBonus(player: number, bonus: number): boolean {
    return player === this.operator.player && (this.operator.bonuses & bonus) !== 0;
  }

  /** Registers the rule of one kind of order (`defineOrder`): one rule per type. */
  onOrder<T extends OrderType, P extends object>(rule: OrderRule<T, P>): void {
    if (this.orderRules.has(rule.type)) {
      throw new RangeError(`orders of type ${rule.type} already have a rule`);
    }
    this.orderRules.set(rule.type, eraseRule(rule));
  }

  /** Whether a rule for orders of `type` is registered. */
  hasOrderRule(type: OrderType): boolean {
    return this.orderRules.has(type);
  }

  /**
   * Observers hear of every order carried out, after its rule: computer
   * players remember what was done to them (R-BOT-20). An observer must not
   * apply orders itself.
   */
  onApplied(observer: OrderObserver): void {
    this.observers.push(observer);
  }

  onTick(system: TickSystem): void {
    this.systems.push(system);
  }

  /**
   * Carries out one order now, if it is valid: the path of every order of a
   * turn, and of orders that computer players decide during a tick (R-BOT-03).
   * Orders of eliminated or unknown players, and orders of a type without a
   * rule, are ignored. Returns whether the order was carried out, which is
   * whether `orderError` found nothing against it.
   */
  apply(playerId: number, order: Order): boolean {
    const player = this.playersById.get(playerId);
    if (!player?.alive) return false;
    const rule = this.orderRules.get(order.type);
    if (!rule) return false;
    const plan = planOrder(this, player, order, rule);
    if (typeof plan === "string") return false;
    rule.execute(this, player, plan);
    for (const observe of this.observers) observe(this, player, order);
    return true;
  }

  /**
   * Runs one tick: the turn's orders, then every system. Turns must arrive in
   * sequence; a gap or a repeat means the client is out of step with the server.
   * Returns how many of the turn's orders were carried out.
   */
  step(turn: Turn): number {
    if (turn.tick !== this.currentTick) {
      throw new RangeError(`expected turn ${String(this.currentTick)}, got ${String(turn.tick)}`);
    }
    let applied = 0;
    for (const { player, order } of turn.orders) if (this.apply(player, order)) applied++;
    for (const system of this.systems) system(this);
    this.currentTick++;
    return applied;
  }
}
