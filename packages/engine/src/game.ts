import type { Attack } from "./attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "./balance.ts";
import type { Boat } from "./boats.ts";
import type {
  Alliance,
  AllianceRequest,
  DiplomacyEvent,
  Embargo,
  RequestCooldown,
} from "./diplomacy.ts";
import type { Fallout, Missile } from "./missiles.ts";
import { orderError } from "./orders.ts";
import { Random } from "./random.ts";
import type { SnapshotReader, SnapshotWriter } from "./snapshot-bytes.ts";
import type { Structure } from "./structures.ts";
import type { Terrain } from "./terrain.ts";
import type { TradeShip } from "./trade.ts";
import type { Fight, Warship } from "./warships.ts";
import { MAX_PLAYER_ID, TerritoryMap } from "./territory/territory-map.ts";

/** An order from a player, as relayed by the server in a turn. */
export type Order =
  | { type: "spawn"; tile: number }
  | { type: "attack"; target: number; troops: number }
  | { type: "retreat"; attack: number }
  | { type: "embark"; target: number; troops: number }
  /** `structure` is a StructureKind code. */
  | { type: "build"; structure: number; tile: number }
  | { type: "demolish"; tile: number }
  /** `target` is a player id. */
  | { type: "ally"; target: number }
  | { type: "betray"; target: number }
  /** `on`: 1 starts an embargo on player `target`, 0 lifts it. */
  | { type: "embargo"; target: number; on: number }
  /** Buys a warship at the player's port on tile `port`. */
  | { type: "warship"; port: number }
  /** Sends warship `ship` to patrol around water tile `tile`. */
  | { type: "patrol"; ship: number; tile: number }
  /** Launches a missile of `size` (a MissileSize code) at tile `target`. */
  | { type: "missile"; target: number; size: number }
  /** Sends player `target` troops and gold (R-DIPLO-06); either may be 0. */
  | { type: "gift"; target: number; troops: number; gold: number }
  /** Sends player `target` the preset quick message `phrase` (R-DIPLO-07). */
  | { type: "quick"; target: number; phrase: number }
  /** Puts `share` % of the troops at home to work (R-ECO-07). */
  | { type: "work"; share: number };

/** Every order accepted during one tick, in the order the server accepted them (R-FAIR-03). */
export interface Turn {
  tick: number;
  orders: readonly { player: number; order: Order }[];
}

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
}

/** Special rules a game can be played with (R-MODE-08), all off unless the setup turns them on. */
export interface GameRules {
  /** Capital mode (R-CAP): taking a player's capital conquers them. */
  readonly capitals: boolean;
  /** R-ATTACK-10: outnumbered fronts give way by stretches. */
  readonly collapsingFronts: boolean;
}

/** A game with no special rule. */
export const NO_RULES: GameRules = { capitals: false, collapsingFronts: false };

/** Marks the special rules in the state hash. */
const RULES_TAG = 0x72756c65;

/** One bit per special rule that is on, for the state hash and the setup digest; 0 with none. */
export function ruleBits(rules: GameRules): number {
  return (rules.capitals ? 1 : 0) | (rules.collapsingFronts ? 2 : 0);
}

/**
 * What a private game can leave out (R-MODE-03), one bit each: a structure
 * by its StructureKind code (bit `1 << kind`), and warships. A palace has no
 * bit of its own and goes with the cities: ask `disableBit` for a kind's bit.
 */
export const Disable = {
  City: 1 << 0,
  Fort: 1 << 1,
  Port: 1 << 2,
  Silo: 1 << 3,
  AirDefense: 1 << 4,
  Warships: 1 << 5,
} as const;
/** Every `Disable` bit. */
export const DISABLE_ALL = 0x3f;

/** What a game leaves out once its implications are added: warships are launched from ports (R-MODE-03). */
export function leftOut(disabled: number): number {
  return disabled & Disable.Port ? disabled | Disable.Warships : disabled;
}

export interface Player {
  readonly id: number;
  readonly name: string;
  troops: number;
  gold: number;
  /** Fraction of a gold coin earned but not yet paid, in units of the economy's divisor. */
  goldRemainder: number;
  /** Share of the troops at home, in %, who work rather than fight (R-ECO-07). */
  workShare: number;
  alive: boolean;
  /** Start tile, once picked or placed during the spawn phase. */
  start: number | undefined;
  /** First tick the player is no longer marked a traitor (R-DIPLO-04); 0 if never. */
  traitorUntil: number;
  /** Start tile the map sets for a nation (R-BOT-07); undefined for players who pick. */
  readonly home: number | undefined;
  /** Team from 1, or 0 in a free-for-all (R-MODE-02). */
  readonly team: number;
  /** Tile of the player's capital in capital mode (R-CAP-01); undefined before play or without one. */
  capital: number | undefined;
}

export type Phase = "spawn" | "play";

/** A capital that fell (R-CAP-03) or was razed (R-CAP-04). */
export interface CapitalFall {
  readonly tick: number;
  /** Player whose capital it was. */
  readonly player: number;
  /** Player who took it; 0 when it was razed and moved. */
  readonly by: number;
  /** Tile the capital stood on. */
  readonly tile: number;
}

/** Most teams a game can have (R-MODE-02). */
export const MAX_TEAMS = 4;

/**
 * Carries out one order that passed validation. Returns false when the order
 * is not for this handler, or cannot be carried out after all.
 */
export type OrderHandler = (game: Game, player: Player, order: Order) => boolean;

/** Runs once per tick, after the orders of that tick, in registration order. */
export type TickSystem = (game: Game) => void;

/**
 * State a rule keeps outside the game's own fields, which a snapshot must
 * carry too (docs/engine.md). `load` reads what `save` wrote, into a game
 * just created with the same setup and rules.
 */
export interface PersistedPart {
  save(out: SnapshotWriter): void;
  load(from: SnapshotReader): void;
}

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
  readonly attacks: Attack[] = [];
  nextAttackId = 1;
  /** Transport ships at sea, oldest first. Owned by the boat rules; read only elsewhere. */
  readonly boats: Boat[] = [];
  nextBoatId = 1;
  /** Structures on the map, oldest first. Owned by the structure rules; read only elsewhere. */
  readonly structures: Structure[] = [];
  nextStructureId = 1;
  /** Trade ships at sea, oldest first. Owned by the trade rules; read only elsewhere. */
  readonly tradeShips: TradeShip[] = [];
  nextTradeShipId = 1;
  /** Warships, oldest first. Owned by the warship rules; read only elsewhere. */
  readonly warships: Warship[] = [];
  nextWarshipId = 1;
  /** Missiles in flight, oldest first. Owned by the missile rules; read only elsewhere. */
  readonly missiles: Missile[] = [];
  nextMissileId = 1;
  /** Fallout of heavy missiles still on the land, oldest first (R-UNIT-06). */
  readonly fallout: Fallout[] = [];
  /**
   * First tick each tile is free of fallout again; 0 if it never had any.
   * It follows from `fallout`, which the state hash covers.
   */
  readonly falloutUntil: Uint32Array;
  /** Fights between players, remembered for B-WAR-MEMORY, by ascending pair of ids. */
  readonly fights: Fight[] = [];
  /** Alliances by ascending pair of ids. Owned by the diplomacy rules; read only elsewhere. */
  readonly alliances: Alliance[] = [];
  /** Alliance requests waiting for an answer, oldest first. */
  readonly allianceRequests: AllianceRequest[] = [];
  /** Players who may not ask a given player again yet, oldest first. */
  readonly requestCooldowns: RequestCooldown[] = [];
  /** Embargoes, oldest first (R-DIPLO-05). */
  readonly embargoes: Embargo[] = [];
  /** Players waiting to send another quick message (R-DIPLO-07), by player id. */
  readonly quickCooldowns: { readonly player: number; readonly until: number }[] = [];
  /**
   * What happened between players, oldest first, for interfaces to read and
   * empty. No rule reads it back, so it is not part of the state hash.
   */
  readonly diplomacyEvents: DiplomacyEvent[] = [];
  /** Number of teams, 0 in a free-for-all (R-MODE-02). */
  readonly teams: number;
  /** `Disable` bits of what this game leaves out (R-MODE-03). */
  readonly disabled: number;
  /** Special rules of this game (R-MODE-08). */
  readonly rules: GameRules;
  /** Capitals taken or razed, oldest first (R-CAP-03, R-CAP-04). Owned by the capital rules. */
  readonly capitalFalls: CapitalFall[] = [];
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
  private readonly handlers: OrderHandler[] = [];
  private readonly systems: TickSystem[] = [];
  private readonly persisted: { readonly name: string; readonly part: PersistedPart }[] = [];
  private currentTick = 0;
  private setup: number | undefined;
  /** The balance values, folded once into the state hash: clients that disagree on them part at once. */
  private readonly balanceDigest: number;

  constructor(setup: GameSetup) {
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
        workShare: 0,
        alive: true,
        start: undefined,
        traitorUntil: 0,
        home,
        team: 0,
        capital: undefined,
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
    };
    this.balanceDigest = digestBalance(this.balance, this.rules);
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

  /** Whether a tile can be taken now: ownable land with no fallout on it (R-UNIT-06). */
  usable(tile: number): boolean {
    return this.terrain.isOwnable(tile) && (this.falloutUntil[tile] as number) <= this.currentTick;
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
   */
  hash(): number {
    // Every value goes through `mix` and `mixWord` below, in the order and
    // with the bytes it always had: the hash of a state must never change.
    // The running hash stays in a local rather than a variable captured by
    // closures, which the loop over every tile of the map reads and writes
    // far faster, and no array is built per entity.
    let hash = 0x811c9dc5;
    hash = mix(hash, this.currentTick);
    hash = mixWord(hash, this.balanceDigest);
    for (const word of this.random.state()) hash = mix(hash, word);
    const owners = this.territory.owners;
    for (let tile = 0; tile < owners.length; tile++) {
      hash = Math.imul(hash ^ (owners[tile] as number), 0x01000193);
    }
    for (const p of this.sortedPlayers) {
      hash = mix(hash, p.id);
      hash = mix(hash, p.troops);
      hash = mix(hash, p.gold);
      hash = mix(hash, p.goldRemainder);
      hash = mix(hash, p.workShare);
      hash = mix(hash, p.alive ? 1 : 0);
      hash = mix(hash, p.start ?? -1);
      hash = mix(hash, p.traitorUntil);
      // The map's nations come from its manifest, which the terrain's hash does not cover.
      hash = mix(hash, p.home ?? -1);
    }
    hash = mix(hash, this.nextAttackId);
    for (const a of this.attacks) {
      hash = mix(hash, a.id);
      hash = mix(hash, a.player);
      hash = mix(hash, a.target);
      hash = mix(hash, a.aim);
      hash = mix(hash, a.troops);
      // Games without collapsing fronts hash as they did before the rule existed.
      if (this.rules.collapsingFronts) hash = mix(hash, a.pressure);
    }
    hash = mix(hash, this.nextBoatId);
    for (const b of this.boats) {
      hash = mix(hash, b.id);
      hash = mix(hash, b.player);
      hash = mix(hash, b.target);
      hash = mix(hash, b.troops);
      hash = mix(hash, b.step);
      hash = mix(hash, b.path.length);
      for (const tile of b.path) hash = mix(hash, tile);
    }
    hash = mix(hash, this.nextStructureId);
    for (const s of this.structures) {
      hash = mix(hash, s.id);
      hash = mix(hash, s.player);
      hash = mix(hash, s.kind);
      hash = mix(hash, s.tile);
      hash = mix(hash, s.readyAt);
      hash = mix(hash, s.reloadAt);
    }
    hash = mix(hash, this.alliances.length);
    for (const a of this.alliances) {
      hash = mix(hash, a.a);
      hash = mix(hash, a.b);
      hash = mix(hash, a.until);
      hash = mix(hash, a.renewA ? 1 : 0);
      hash = mix(hash, a.renewB ? 1 : 0);
    }
    hash = mix(hash, this.allianceRequests.length);
    for (const r of this.allianceRequests) {
      hash = mix(hash, r.from);
      hash = mix(hash, r.to);
      hash = mix(hash, r.expiresAt);
    }
    hash = mix(hash, this.requestCooldowns.length);
    for (const c of this.requestCooldowns) {
      hash = mix(hash, c.from);
      hash = mix(hash, c.to);
      hash = mix(hash, c.until);
    }
    hash = mix(hash, this.nextTradeShipId);
    hash = mix(hash, this.tradeShips.length);
    for (const t of this.tradeShips) {
      hash = mix(hash, t.id);
      hash = mix(hash, t.player);
      hash = mix(hash, t.port);
      hash = mix(hash, t.from);
      hash = mix(hash, t.to);
      hash = mix(hash, t.step);
      hash = mix(hash, t.path.length);
      // The ends of its route, which the route cache outside the state chose.
      hash = mix(hash, t.path[0] ?? -1);
      hash = mix(hash, t.path[t.path.length - 1] ?? -1);
    }
    hash = mix(hash, this.nextWarshipId);
    for (const w of this.warships) {
      hash = mix(hash, w.id);
      hash = mix(hash, w.player);
      hash = mix(hash, w.tile);
      hash = mix(hash, w.health);
      hash = mix(hash, w.patrol);
      hash = mix(hash, w.step);
      hash = mix(hash, w.path.length);
      hash = mix(hash, w.reloadAt);
    }
    hash = mix(hash, this.nextMissileId);
    hash = mix(hash, this.missiles.length);
    for (const m of this.missiles) {
      hash = mix(hash, m.id);
      hash = mix(hash, m.player);
      hash = mix(hash, m.size);
      hash = mix(hash, m.from);
      hash = mix(hash, m.to);
      hash = mix(hash, m.launchedAt);
      hash = mix(hash, m.arrivesAt);
      hash = mix(hash, m.tried.length);
      for (const id of m.tried) hash = mix(hash, id);
    }
    hash = mix(hash, this.fallout.length);
    for (const f of this.fallout) {
      hash = mix(hash, f.tile);
      hash = mix(hash, f.radius);
      hash = mix(hash, f.until);
    }
    hash = mix(hash, this.fights.length);
    for (const f of this.fights) {
      hash = mix(hash, f.a);
      hash = mix(hash, f.b);
      hash = mix(hash, f.until);
    }
    hash = mix(hash, this.embargoes.length);
    for (const e of this.embargoes) {
      hash = mix(hash, e.from);
      hash = mix(hash, e.to);
      hash = mix(hash, e.since);
    }
    hash = mix(hash, this.winner ?? 0);
    // Free-for-all games hash as they did before teams existed.
    if (this.teams > 0) {
      hash = mix(hash, this.teams);
      for (const p of this.sortedPlayers) hash = mix(hash, p.team);
      hash = mix(hash, this.winningTeam ?? 0);
    }
    // So do games that leave nothing out, and games without quick messages.
    if (this.disabled !== 0) hash = mix(hash, this.disabled);
    // And games with no special rule.
    if (ruleBits(this.rules) !== 0) {
      // Tagged, so that no value of `disabled` before it reads the same.
      hash = mix(hash, RULES_TAG);
      hash = mix(hash, ruleBits(this.rules));
    }
    for (const c of this.quickCooldowns) {
      if (this.currentTick < c.until) {
        hash = mix(hash, c.player);
        hash = mix(hash, c.until);
      }
    }
    hash = mix(hash, this.decidedAt ?? -1);
    // Games without capitals hash as they did before the mode existed.
    if (this.rules.capitals) {
      for (const p of this.sortedPlayers) hash = mix(hash, p.capital ?? -1);
      hash = mix(hash, this.capitalFalls.length);
      for (const f of this.capitalFalls) {
        hash = mix(hash, f.tick);
        hash = mix(hash, f.player);
        hash = mix(hash, f.by);
        hash = mix(hash, f.tile);
      }
    }
    return hash >>> 0;
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

  /** Parts registered with `persist`, in registration order. */
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
    let hash = 0x811c9dc5;
    const mix = (value: number): void => {
      for (const word of [value >>> 0, Math.floor(value / 2 ** 32) >>> 0]) {
        for (let shift = 0; shift < 32; shift += 8) {
          hash = Math.imul(hash ^ ((word >>> shift) & 0xff), 0x01000193);
        }
      }
    };
    mix(this.seed);
    mix(this.balanceDigest);
    const { topology, kinds } = this.terrain;
    mix(topology.width);
    mix(topology.height);
    for (let tile = 0; tile < kinds.length; tile++) {
      hash = Math.imul(hash ^ (kinds[tile] as number), 0x01000193);
    }
    for (const p of this.sortedPlayers) {
      mix(p.id);
      mix(p.home ?? -1);
      mix(p.team);
      mix(p.name.length);
      for (let i = 0; i < p.name.length; i++) mix(p.name.charCodeAt(i));
    }
    mix(this.teams);
    mix(this.disabled);
    if (ruleBits(this.rules) !== 0) mix(ruleBits(this.rules));
    return hash >>> 0;
  }

  /** Valid orders are offered to handlers in turn until one carries them out. */
  onOrder(handler: OrderHandler): void {
    this.handlers.push(handler);
  }

  onTick(system: TickSystem): void {
    this.systems.push(system);
  }

  /**
   * Carries out one order now, if it is valid: the path of every order of a
   * turn, and of orders that computer players decide during a tick (R-BOT-03).
   * Orders of eliminated or unknown players are ignored. Returns whether the
   * order was carried out.
   */
  apply(playerId: number, order: Order): boolean {
    const player = this.playersById.get(playerId);
    if (!player?.alive || orderError(this, player, order) !== undefined) return false;
    return this.handlers.some((handle) => handle(this, player, order));
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

/** One FNV-1a round per byte of a 32-bit word, lowest byte first. */
function mixWord(hash: number, word: number): number {
  hash = Math.imul(hash ^ (word & 0xff), 0x01000193);
  hash = Math.imul(hash ^ ((word >>> 8) & 0xff), 0x01000193);
  hash = Math.imul(hash ^ ((word >>> 16) & 0xff), 0x01000193);
  return Math.imul(hash ^ (word >>> 24), 0x01000193);
}

/** Feeds a value as two 32-bit halves, low then high, so counts above 2^32 are not truncated. */
function mix(hash: number, value: number): number {
  return mixWord(mixWord(hash, value >>> 0), Math.floor(value / 2 ** 32) >>> 0);
}

/**
 * FNV-1a over the balance values, by key name, so the order fields were
 * written in does not matter. The values of a special rule count only in a
 * game played with it, so other games hash as they did before it existed.
 */
function digestBalance(balance: Balance, rules: GameRules): number {
  let digest = 0x811c9dc5;
  const record = balance as unknown as Record<string, number | readonly number[]>;
  for (const key of Object.keys(record).sort()) {
    if (!rules.capitals && key.startsWith("capital")) continue;
    for (let i = 0; i < key.length; i++) digest = Math.imul(digest ^ key.charCodeAt(i), 0x01000193);
    const value = record[key];
    for (const number of typeof value === "number" ? [value] : (value ?? [])) {
      // Halves, like the state hash: balance values are safe integers.
      for (const word of [number >>> 0, Math.floor(number / 2 ** 32) >>> 0]) {
        for (let shift = 0; shift < 32; shift += 8) {
          digest = Math.imul(digest ^ ((word >>> shift) & 0xff), 0x01000193);
        }
      }
    }
  }
  return digest >>> 0;
}

/** Refuses balance values the rules cannot run with, before the first tick rather than during one. */
function checkBalance(balance: Balance): void {
  const atLeastOne: (keyof Balance)[] = [
    "ticksPerSecond",
    "attackSpeedDivisor",
    "encircleMaxTiles",
    "collapseBuildupTicks",
    "collapseDepth",
    "boatSpeed",
    "boatMax",
    "boatRange",
    "cityLand",
    "tradeRange",
    "tradeIntervalTicks",
    "warshipPatrol",
    "warshipReloadTicks",
    "warshipDamage",
    "warshipHealth",
    "missileSpeed",
    "allianceRequestTicks",
    "allianceTicks",
    "maxDurationTicks",
  ];
  for (const key of atLeastOne) {
    const value = balance[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`balance ${key} must be a positive integer`);
    }
  }
  // Two structures on one tile would make demolition ambiguous; a cheaper next structure, or a negative cost, would print gold.
  if (!Number.isSafeInteger(balance.buildSpacing) || balance.buildSpacing < 1) {
    throw new RangeError("balance buildSpacing must be a positive integer");
  }
  for (const key of [
    "cityCost",
    "fortCost",
    "portCost",
    "buildTicks",
    "tradeMax",
    "warshipCost",
    "warshipMax",
    "warshipRange",
    "warMemoryTicks",
    "embargoNoticeTicks",
    "siloCost",
    "airDefenseCost",
    "longBuildTicks",
    "siloReloadTicks",
    "missileCost",
    "heavyMissileCost",
    "missileRadius",
    "heavyMissileRadius",
    "falloutTicks",
    "airDefenseRadius",
    "airDefenseReloadTicks",
    "tradeBase",
    "tradePerTile",
    "allianceRenewTicks",
    "allianceCooldownTicks",
    "traitorTicks",
    "traitorDefensePercent",
    "collapseOddsTenths",
    "collapseCostPercent",
    "capitalRadius",
    "capitalStrengthPercent",
    "capitalAlert",
    "capitalGraceTicks",
    "capitalGarrisonPercent",
  ] as const) {
    if (!Number.isSafeInteger(balance[key]) || balance[key] < 0) {
      throw new RangeError(`balance ${key} must be a non-negative integer`);
    }
  }
  if (
    !Number.isSafeInteger(balance.workMaxPercent) ||
    balance.workMaxPercent < 0 ||
    balance.workMaxPercent > 100
  ) {
    throw new RangeError("balance workMaxPercent must be from 0 to 100");
  }
  if (!Number.isSafeInteger(balance.workGoldFactor) || balance.workGoldFactor < 1) {
    throw new RangeError("balance workGoldFactor must be a positive integer");
  }
  for (const key of ["capitalSpoilsPercent", "capitalRazePercent"] as const) {
    if (!Number.isSafeInteger(balance[key]) || balance[key] < 0 || balance[key] > 100) {
      throw new RangeError(`balance ${key} must be from 0 to 100`);
    }
  }
  const chance = balance.airDefenseChancePercent;
  if (!Number.isSafeInteger(chance) || chance < 0 || chance > 100) {
    throw new RangeError("balance airDefenseChancePercent must be from 0 to 100");
  }
  if (!Number.isSafeInteger(balance.costGrowthPercent) || balance.costGrowthPercent < 100) {
    throw new RangeError("balance costGrowthPercent must be 100 or more");
  }
  // Ship routes keep their distances in 16 bits.
  if (balance.boatRange > 0xffff) throw new RangeError("balance boatRange is above 65535");
  if (balance.tradeRange > 0xffff) throw new RangeError("balance tradeRange is above 65535");
}
