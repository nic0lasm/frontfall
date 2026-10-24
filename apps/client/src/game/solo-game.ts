import {
  DEFAULT_BALANCE,
  DESYNC_REPORT_VERSION,
  Terrain,
  WorldGrid,
  createGame,
  BuildError,
  StructureKind,
  allianceOf,
  alliesOf,
  canRenew,
  cityLimit,
  isAllied,
  installBots,
  isReady,
  orderError,
  populationCap,
  seaRoute,
  structureCost,
  structureCount,
  type DesyncReport,
  type Game,
  type Order,
  type PlayerSetup,
  type Phase,
  type Turn,
} from "@frontfall/engine";
import { HASH_INTERVAL, PROTOCOL_VERSION } from "@frontfall/protocol";
import { RELEASE } from "../release.ts";
import { labelAnchors, type LabelAnchor } from "./label-anchors.ts";
import type { MapData } from "./maps.ts";

export const HUMAN_ID = 1;

export type Difficulty = "easy" | "normal" | "hard";

/** What a click on the map does: attack by default, or build or demolish once picked in the HUD. */
export type ClickMode = "attack" | "city" | "fort" | "demolish";

/** Tiles around a click within which a demolition finds the player's structure: one is a few pixels wide. */
const DEMOLISH_REACH = 3;

export interface SoloOptions {
  map: string;
  seed: number;
  bots: number;
  difficulty: Difficulty;
  playerName: string;
  /**
   * For tests that play a game to its end: ticks run per beat of the clock
   * (1 by default), and a time limit in minutes instead of B-MAX-DURATION.
   */
  speed?: number | undefined;
  maxMinutes?: number | undefined;
  /** For tests that build: B-GOLD-RATE instead of its value in the balance. */
  goldRate?: number | undefined;
  /**
   * Online: the human players in their final numbering, and which one plays
   * at this screen. Bots then take the numbers after the last human, and
   * `playerName` is not used.
   */
  players?: readonly { id: number; name: string }[] | undefined;
  you?: number | undefined;
}

export interface PlayerView {
  id: number;
  name: string;
  troops: number;
  /** Troops the player's land can hold (R-ECO-01). */
  cap: number;
  gold: number;
  tiles: number;
  alive: boolean;
}

/** One of the human's attacks under way; its id is what a retreat order names. */
export interface AttackView {
  id: number;
  /** Owner of the land under attack, 0 for unclaimed land. */
  target: number;
  troops: number;
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
  /** Every ship at sea. */
  boats: BoatView[];
  /** Every structure on the map. */
  structures: StructureView[];
  /** What the player at this screen can build next. */
  build: BuildView;
  /** Alliances, requests and traitors, as the player at this screen sees them. */
  diplomacy: DiplomacyView;
  /** What changed between players since the last update, for every player to read (R-DIPLO-04). */
  events: DiplomacyEvent[];
  /** Set instead of the change lists when too much changed to list. */
  owners?: Uint16Array;
  winner?: number;
  /** Online: state hashes after the ticks the server checks (`HASH_INTERVAL`). */
  hashes?: { tick: number; hash: number }[];
}

/** Why a click on the map leads to no order. */
export type ClickRefusal =
  /** Water, ice or off the map. */
  | "terrain"
  | "own"
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
  /** Another structure stands closer than B-BUILD-SPACING. */
  | "crowded"
  /** The player's land supports no more cities (R-BUILD-07). */
  | "land"
  | "gold"
  /** No structure of the player's near the click to demolish. */
  | "nothing"
  /** The land belongs to an ally: betray them first (R-DIPLO-02). */
  | "ally";

export type ClickResult = { order: Order } | { refused: ClickRefusal };

export type StructureType = "city" | "fort";

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
  fortCost: number;
  cities: number;
  /** Most cities the player's land supports now. */
  cityLimit: number;
}

const STRUCTURE_KINDS: Readonly<Record<StructureType, StructureKind>> = {
  city: StructureKind.City,
  fort: StructureKind.Fort,
};

/** Engine refusals of a build order, as the interface explains them: one for each BuildError. */
const BUILD_REFUSALS: Readonly<Record<BuildError, ClickRefusal>> = {
  [BuildError.Early]: "early",
  [BuildError.Foreign]: "foreign",
  [BuildError.Crowded]: "crowded",
  [BuildError.Land]: "land",
  [BuildError.Gold]: "gold",
};

function isBuildError(error: string): error is BuildError {
  return Object.hasOwn(BUILD_REFUSALS, error);
}

/** Alliances and requests of the player at this screen, and every traitor, with their time left in ticks. */
export interface DiplomacyView {
  allies: AllyView[];
  /** Requests to the player, oldest first. */
  incoming: { from: number; ticksLeft: number }[];
  /** Players the player has asked and who have not answered yet. */
  outgoing: number[];
  /** Players who may not be asked yet: a request ran out, or the player betrayed them. */
  waiting: number[];
  traitors: { id: number; ticksLeft: number }[];
}

export interface AllyView {
  id: number;
  ticksLeft: number;
  /** In the last part of the alliance, when both may renew it (R-DIPLO-03). */
  renewable: boolean;
  /** The player at this screen has asked to renew; the ally has not yet. */
  renewing: boolean;
}

/** An alliance formed, run out, or broken by `a`. `a` and `b` are player ids. */
export interface DiplomacyEvent {
  type: "allied" | "ended" | "betrayed";
  a: number;
  b: number;
}

/** A transport ship at sea, where it is this tick. */
export interface BoatView {
  id: number;
  player: number;
  tile: number;
  troops: number;
}

/** Names for computer players. Invented, so they never collide with real countries. */
const BOT_NAMES = [
  "Aldmere",
  "Brask",
  "Corvan",
  "Dunmoor",
  "Elsk",
  "Fenwold",
  "Gorran",
  "Halvik",
  "Istra",
  "Jorvel",
  "Kesh",
  "Lorne",
  "Mirava",
  "Norrin",
  "Ostmark",
  "Pellan",
  "Quill",
  "Ravenna",
  "Sorrel",
  "Tarsk",
  "Ulvar",
  "Vesk",
  "Wyndham",
  "Yarrow",
  "Zennor",
];

export const MAX_BOTS = BOT_NAMES.length;

/** Names follow the land twice a second at the default tick rate: a scan of the map each time. */
const LABEL_TICKS = 5;

/**
 * One game as this client runs it: the engine with every rule installed and
 * the bots. Online, it plays the turns the server relays (`playTurns`); solo,
 * `step` relays the player's orders into the same kind of turn, so both go
 * down one path. Runs in a worker in the browser and directly in tests.
 */
export class SoloGame {
  readonly game: Game;
  readonly ownableTiles: number;
  /** The player at this screen. */
  readonly you: number;
  /** Online games report state hashes; a solo game has no one to compare with. */
  private readonly online: boolean;
  private readonly depth: Uint16Array;
  private readonly players: PlayerSetup[];
  private readonly botIds: number[];
  /** Online, for a desync report: every turn with orders, and the hashes sent. */
  private readonly history: Turn[] = [];
  private readonly hashes: { tick: number; local: number }[] = [];
  /** Hashes the server says most players had, where this client's differed. */
  private readonly expected = new Map<number, number | null>();
  /** Alliances at the last update, as "a:b" with their end, and every player's traitor mark then. */
  private alliancesSeen = new Map<string, number>();
  private traitorMarks = new Map<number, number>();

  constructor(
    readonly options: SoloOptions,
    private readonly map: MapData,
  ) {
    const grid = new WorldGrid(map.width, map.height, { wrapsX: map.wrapsX });
    const terrain = new Terrain(grid, map.kinds);
    const bots = Math.max(0, Math.min(MAX_BOTS, Math.floor(options.bots)));
    const humans = options.players ?? [{ id: HUMAN_ID, name: options.playerName }];
    this.you = options.you ?? HUMAN_ID;
    const firstBot = Math.max(...humans.map((human) => human.id)) + 1;
    const players = [...humans];
    const botIds: number[] = [];
    for (let i = 0; i < bots; i++) {
      botIds.push(firstBot + i);
      players.push({ id: firstBot + i, name: BOT_NAMES[i] as string });
    }
    const balance = { ...DEFAULT_BALANCE };
    if (options.maxMinutes !== undefined) {
      balance.maxDurationTicks = Math.round(
        options.maxMinutes * 60 * DEFAULT_BALANCE.ticksPerSecond,
      );
    }
    if (options.goldRate !== undefined)
      balance.goldPerThousandTroops = Math.floor(options.goldRate);
    this.game = createGame({ terrain, seed: options.seed, players, balance });
    installBots(this.game, botIds, options.difficulty);
    this.players = players;
    this.botIds = botIds;
    this.online = options.players !== undefined;
    this.depth = new Uint16Array(grid.size);
    let ownable = 0;
    for (let tile = 0; tile < grid.size; tile++) if (terrain.isOwnable(tile)) ownable++;
    this.ownableTiles = ownable;
  }

  get winner(): number | undefined {
    return this.game.winner;
  }

  /**
   * What a click on `tile` means for the human now: pick a start during the
   * spawn phase, then expand or attack with `ratio` percent of their troops,
   * by land when the target touches their land, by sea when it is a coast
   * on another land mass. Otherwise, why nothing happens.
   */
  orderForClick(tile: number, ratio: number, mode: ClickMode = "attack"): ClickResult {
    const { game } = this;
    const { terrain, territory } = game;
    const human = game.player(this.you);
    if (!human?.alive || game.winner !== undefined) return { refused: "over" };
    if (!Number.isInteger(tile) || tile < 0 || tile >= terrain.topology.size) {
      return { refused: "terrain" };
    }
    if (mode === "demolish") return this.demolishNear(tile);
    if (!terrain.isOwnable(tile)) return { refused: "terrain" };
    if (
      game.phase === "play" &&
      isAllied(game, this.you, territory.ownerOf(tile)) &&
      mode === "attack"
    ) {
      return { refused: "ally" };
    }
    if (mode === "city" || mode === "fort") {
      const order: Order = { type: "build", structure: STRUCTURE_KINDS[mode], tile };
      const error = orderError(game, human, order);
      if (error === undefined) return { order };
      // The tile was checked above: anything else is a placement rule.
      return { refused: isBuildError(error) ? BUILD_REFUSALS[error] : "terrain" };
    }
    if (game.phase === "spawn") return { order: { type: "spawn", tile } };
    if (territory.ownerOf(tile) === this.you) return { refused: "own" };
    const troops = Math.floor((human.troops * Math.min(100, Math.max(0, ratio))) / 100);
    if (troops < 1) return { refused: "troops" };

    // By land when the player borders the target's owner on the target's own
    // land mass: an attack starts from that border, so it must reach the click.
    const owner = territory.ownerOf(tile);
    const mass = terrain.landmassOf(tile);
    const around = new Int32Array(4);
    let touches = false;
    for (let i = 0; i < territory.borderCount(this.you) && !touches; i++) {
      const border = territory.borderTile(this.you, i);
      if (terrain.landmassOf(border) !== mass) continue;
      const count = terrain.topology.neighborsInto(border, around);
      for (let j = 0; j < count; j++) {
        const next = around[j] as number;
        if (territory.ownerOf(next) === owner && terrain.isOwnable(next)) touches = true;
      }
    }
    if (touches) {
      return { order: { type: "attack", target: tile, troops } };
    }
    if (terrain.isCoast(tile) && seaRoute(game, this.you, tile)) {
      const atSea = game.boats.filter((boat) => boat.player === this.you).length;
      if (atSea >= game.balance.boatMax) return { refused: "ships" };
      return { order: { type: "embark", target: tile, troops } };
    }
    return { refused: "unreachable" };
  }

  /** The player's structure closest to the click, within a few tiles. */
  private demolishNear(tile: number): ClickResult {
    const topology = this.game.terrain.topology;
    let best: { tile: number; distance: number } | undefined;
    for (const structure of this.game.structures) {
      if (structure.player !== this.you) continue;
      const distance = topology.distance(structure.tile, tile);
      if (distance <= DEMOLISH_REACH && (!best || distance < best.distance)) {
        best = { tile: structure.tile, distance };
      }
    }
    return best ? { order: { type: "demolish", tile: best.tile } } : { refused: "nothing" };
  }

  /**
   * Solo: runs one tick with the player's orders and returns what changed.
   * Once the game is decided the bots play on for spectators (R-WIN-03), and
   * the player's orders are dropped.
   */
  step(orders: readonly Order[]): GameUpdate {
    // The local relay: the turn the server would send, with this player's orders only.
    const turn: Turn = {
      tick: this.game.tick,
      orders:
        this.game.winner === undefined ? orders.map((order) => ({ player: this.you, order })) : [],
    };
    return this.playTurns([turn]);
  }

  /**
   * Online: runs turns relayed by the server, every player's orders in
   * them, and returns what changed over all of them. Hashes of the state
   * after every HASH_INTERVAL-th tick come with the update, for the server
   * to compare between players.
   */
  playTurns(turns: readonly Turn[]): GameUpdate {
    const hashes: { tick: number; hash: number }[] = [];
    for (const turn of turns) {
      this.game.step(turn);
      if (!this.online) continue;
      if (turn.orders.length > 0) this.history.push(turn);
      if (turn.tick % HASH_INTERVAL === 0) {
        const hash = this.game.hash();
        hashes.push({ tick: turn.tick, hash });
        this.hashes.push({ tick: turn.tick, local: hash });
      }
    }
    const update = this.update();
    if (hashes.length > 0) update.hashes = hashes;
    return update;
  }

  /** The server found this client's hash after `tick` differs from most players'. */
  desync(tick: number, expected: number | null): void {
    this.expected.set(tick, expected);
  }

  /**
   * Everything needed to replay this online game elsewhere and find where it
   * went apart (docs/engine.md, "Desync reports"). Published maps only: a
   * generated map has no terrain file to pin.
   */
  report(): DesyncReport | undefined {
    const { source } = this.map;
    if (!this.online || !source) return undefined;
    const first = Math.min(...this.expected.keys());
    return {
      version: DESYNC_REPORT_VERSION,
      build: { release: RELEASE, protocol: PROTOCOL_VERSION },
      map: { id: this.map.id, ...source },
      seed: this.options.seed,
      balance: this.game.balance,
      players: this.players,
      bots: { ids: this.botIds, difficulty: this.options.difficulty },
      you: this.you,
      ticks: this.game.tick,
      turns: this.history,
      // Before the first desync the server had nothing to say: the hashes
      // matched. After it, a tick it did not flag is unknown.
      hashes: this.hashes.map(({ tick, local }) => ({
        tick,
        local,
        expected: this.expected.has(tick)
          ? (this.expected.get(tick) ?? null)
          : tick < first
            ? local
            : null,
      })),
    };
  }

  private diplomacy(): DiplomacyView {
    const { game, you } = this;
    const tick = game.tick;
    return {
      allies: alliesOf(game, you).map((id) => {
        const alliance = allianceOf(game, you, id);
        const until = alliance?.until ?? tick;
        return {
          id,
          ticksLeft: until - tick,
          renewable: alliance !== undefined && canRenew(game, alliance),
          renewing:
            alliance !== undefined && (you === alliance.a ? alliance.renewA : alliance.renewB),
        };
      }),
      incoming: game.allianceRequests
        .filter((request) => request.to === you && tick < request.expiresAt)
        .map((request) => ({ from: request.from, ticksLeft: request.expiresAt - tick })),
      outgoing: game.allianceRequests
        .filter((request) => request.from === you && tick < request.expiresAt)
        .map((request) => request.to),
      waiting: game.requestCooldowns
        .filter((cooldown) => cooldown.from === you && tick < cooldown.until)
        .map((cooldown) => cooldown.to),
      traitors: game
        .players()
        .filter((player) => player.alive && tick < player.traitorUntil)
        .map((player) => ({ id: player.id, ticksLeft: player.traitorUntil - tick })),
    };
  }

  /** Alliances formed and gone since the last update; one gone with a new traitor mark was betrayed. */
  private diplomacyEvents(): DiplomacyEvent[] {
    const { game } = this;
    const events: DiplomacyEvent[] = [];
    const now = new Map<string, number>();
    for (const { a, b, until } of game.alliances) {
      if (game.tick < until) now.set(`${String(a)}:${String(b)}`, until);
    }
    for (const key of now.keys()) {
      if (this.alliancesSeen.has(key)) continue;
      const [a, b] = key.split(":").map(Number) as [number, number];
      events.push({ type: "allied", a, b });
    }
    const marked = (id: number): boolean =>
      (game.player(id)?.traitorUntil ?? 0) !== (this.traitorMarks.get(id) ?? 0);
    for (const [key, until] of this.alliancesSeen) {
      if (now.has(key)) continue;
      const [a, b] = key.split(":").map(Number) as [number, number];
      // An alliance with a player who fell ends with them, unremarked.
      if (!game.player(a)?.alive || !game.player(b)?.alive) continue;
      if (game.tick >= until) events.push({ type: "ended", a, b });
      else if (marked(a)) events.push({ type: "betrayed", a, b });
      else if (marked(b)) events.push({ type: "betrayed", a: b, b: a });
      else events.push({ type: "ended", a, b });
    }
    this.alliancesSeen = now;
    this.traitorMarks = new Map(game.players().map((player) => [player.id, player.traitorUntil]));
    return events;
  }

  private update(): GameUpdate {
    const { game } = this;
    const territory = game.territory;
    const players = game.players().map((player) => ({
      id: player.id,
      name: player.name,
      troops: player.troops,
      cap: populationCap(game, player),
      gold: player.gold,
      tiles: territory.tileCount(player.id),
      alive: player.alive,
    }));
    const update: GameUpdate = {
      you: this.you,
      tick: game.tick,
      phase: game.phase,
      spawnTicksLeft: Math.max(0, game.balance.spawnPhaseTicks - game.tick),
      players,
      attacks: game.attacks
        .filter((attack) => attack.player === this.you)
        .map((attack) => ({ id: attack.id, target: attack.target, troops: attack.troops })),
      changedTiles: new Int32Array(0),
      changedOwners: new Uint16Array(0),
      boats: game.boats.map((boat) => ({
        id: boat.id,
        player: boat.player,
        // The water tile the ship has reached, its first one before it sails.
        tile: boat.path[Math.max(0, Math.min(boat.step, boat.path.length) - 1)] ?? boat.target,
        troops: boat.troops,
      })),
      structures: game.structures.map((structure) => ({
        id: structure.id,
        player: structure.player,
        type: structure.kind === StructureKind.City ? "city" : "fort",
        tile: structure.tile,
        ready: isReady(game, structure),
      })),
      build: {
        cityCost: structureCost(game, this.you, StructureKind.City),
        fortCost: structureCost(game, this.you, StructureKind.Fort),
        cities: structureCount(game, this.you, StructureKind.City),
        cityLimit: cityLimit(game, this.you),
      },
      diplomacy: this.diplomacy(),
      events: this.diplomacyEvents(),
    };
    if (territory.changesOverflowed) {
      update.owners = territory.owners.slice();
    } else {
      const changes = territory.changes();
      update.changedTiles = changes.slice();
      update.changedOwners = new Uint16Array(changes.length);
      for (let i = 0; i < changes.length; i++) {
        update.changedOwners[i] = territory.owners[changes[i] as number] as number;
      }
    }
    territory.clearChanges();
    if (game.tick % LABEL_TICKS === 0) {
      const width = game.terrain.topology.width;
      update.labels = labelAnchors(territory.owners, width, players.length, this.depth);
    }
    if (game.winner !== undefined) update.winner = game.winner;
    return update;
  }
}
