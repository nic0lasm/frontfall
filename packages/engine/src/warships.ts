import { embargoed, embargoedByOrderSince, isAllied, logEvent } from "./diplomacy.ts";
import { Disable } from "@frontfall/contracts";
import type { Game, Player } from "./game.ts";
import { mulDiv } from "./integer-math.ts";
import { ANY_PHASE, defineOrder, refusalOf, tileError } from "./order-rules.ts";
import { DrawUsage, derivedRandom } from "./random.ts";
import { spawnSettings } from "./spawn.ts";
import { StructureKind, structureAt, structureState } from "./structures.ts";
import { TileKind } from "./terrain.ts";
import { sinkBoat } from "./boats.ts";
import { writable } from "./state/lists.ts";
import { takeTradeShip, tradeGold } from "./trade.ts";

/** A warship on patrol (R-UNIT-04). */
export interface Warship {
  readonly id: number;
  readonly player: number;
  /** Water tile the ship is on. */
  tile: number;
  health: number;
  /** Water tile it patrols around. */
  patrol: number;
  /** Water tiles to where it is heading, from the one after its tile; shared, never written. */
  path: Int32Array;
  /** How far along `path` the ship is. */
  step: number;
  /** First tick it may fire again. */
  reloadAt: number;
  /**
   * The tick of its last shot at a ship and the water tile it aimed at. Only
   * the screen reads them, to show the shot: not hashed, not saved.
   */
  firedAt?: number;
  aim?: number;
}

/**
 * Where a warship is in its life (R-UNIT-04), from what it already holds:
 * sunk once its health is gone or its owner has fallen, idle once it has
 * reached the end of its path (it draws its next point on its next move),
 * patrolling while it sails. Nothing of it is stored; sunk ships leave the
 * list at the end of the tick.
 */
export type WarshipState = "sunk" | "idle" | "patrolling";

export function warshipState(game: Game, ship: Warship): WarshipState {
  if (ship.health <= 0 || game.player(ship.player)?.alive !== true) return "sunk";
  return ship.step >= ship.path.length ? "idle" : "patrolling";
}

/** Two players at war until `until` (R-UNIT-04): `a` is always the lower id. */
export interface Fight {
  readonly a: number;
  readonly b: number;
  until: number;
}

/** Why a warship order is refused once its fields are known to be integers. */
export const WarshipError = {
  Early: "warships come after the spawn phase",
  Disabled: "warships are left out of this game",
  Port: "no ready port of yours on the tile",
  Shore: "the port has no water next to it",
  Max: "too many warships",
  Gold: "not enough gold",
  Ship: "no warship of yours with this id",
  Water: "a warship patrols on water",
  Reach: "the ship cannot reach the tile",
} as const;
export type WarshipError = (typeof WarshipError)[keyof typeof WarshipError];

/** Gold the next warship costs a player: B-COST-WARSHIP for the first, that much more for each one they own, never past B-COST-MAX. */
export function warshipCost(game: Game, player: number): number {
  const { warshipCost: base, costMax } = game.balance;
  let owned = 0;
  for (const ship of game.warships) if (ship.player === player) owned++;
  return Math.min(costMax, base * (owned + 1));
}

/** Radius of a patrol on this map: B-WARSHIP-PATROL on a map of 2^19 tiles, growing like the spawn radius. */
export function patrolRadius(game: Game): number {
  const { spawnRadius, warshipPatrol } = game.balance;
  return Math.max(warshipPatrol, mulDiv(warshipPatrol, spawnSettings(game).radius, spawnRadius));
}

/**
 * Whether two players are at war (R-UNIT-04): an attack or a transport ship
 * of either against the other under way or ended less than B-WAR-MEMORY
 * ago, or an embargo between them. Allies and teammates never are.
 */
export function atWar(game: Game, a: number, b: number): boolean {
  if (a === b || isAllied(game, a, b)) return false;
  if (embargoed(game, a, b, true)) return true;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return game.fights.some((f) => f.a === low && f.b === high && game.tick < f.until);
}

/** Why `player` cannot buy a warship at the port on `port`, or undefined. */
export function warshipError(game: Game, player: Player, port: number): string | undefined {
  return refusalOf(warshipPlan(game, player, port));
}

/** A warship to buy: the water tile next to the port it starts on. */
interface WarshipPlan {
  readonly start: number;
}

function warshipPlan(game: Game, player: Player, port: number): WarshipError | WarshipPlan {
  if (game.phase !== "play") return WarshipError.Early;
  if (!game.allows(Disable.Warships)) return WarshipError.Disabled;
  const structure = structureAt(game, port);
  if (
    structure?.kind !== StructureKind.Port ||
    structure.player !== player.id ||
    structureState(game, structure) === "building"
  ) {
    return WarshipError.Port;
  }
  const start = shoreOf(game, port);
  if (start < 0) return WarshipError.Shore;
  let owned = 0;
  for (const ship of game.warships) if (ship.player === player.id) owned++;
  if (owned >= game.balance.warshipMax) return WarshipError.Max;
  if (player.gold < warshipCost(game, player.id)) return WarshipError.Gold;
  return { start };
}

/** Why `player` cannot send warship `ship` to patrol around `tile`, or undefined. */
export function patrolError(
  game: Game,
  player: Player,
  ship: number,
  tile: number,
): string | undefined {
  return refusalOf(patrolPlan(game, player, ship, tile));
}

/** A patrol to start: the ship, its new patrol tile and the way there. */
interface PatrolPlan {
  readonly warship: Warship;
  readonly tile: number;
  readonly path: Int32Array;
}

function patrolPlan(game: Game, player: Player, ship: number, tile: number): string | PatrolPlan {
  if (game.phase !== "play") return WarshipError.Early;
  const warship = writable(game, "warships").find((w) => w.id === ship);
  if (warship?.player !== player.id) return WarshipError.Ship;
  if (!Number.isInteger(tile) || tile < 0 || tile >= game.terrain.topology.size) {
    return "the tile is outside the map";
  }
  if (game.terrain.kinds[tile] !== TileKind.Water) return WarshipError.Water;
  const path = searchFor(game).path(warship.tile, tile, game.balance.boatRange);
  return path ? { warship, tile, path } : WarshipError.Reach;
}

/** R-UNIT-04: `warship` buys a warship at a ready port of the player's; it starts on the port's water. */
export const WARSHIP_ORDER = defineOrder("warship", {
  phases: ANY_PHASE,
  validate: (game, player, order) =>
    tileError(game, order.port) ?? warshipPlan(game, player, order.port),
  execute(game, player, { start }) {
    player.gold -= warshipCost(game, player.id);
    writable(game, "warships").push({
      id: game.nextWarshipId++,
      player: player.id,
      tile: start,
      health: game.balance.warshipHealth,
      patrol: start,
      path: EMPTY,
      step: 0,
      reloadAt: game.tick,
    });
  },
});

/** R-UNIT-04: `patrol` sends a warship of the player's to patrol around a water tile it can reach. */
export const PATROL_ORDER = defineOrder("patrol", {
  phases: ANY_PHASE,
  validate: (game, player, order) =>
    Number.isSafeInteger(order.ship)
      ? patrolPlan(game, player, order.ship, order.tile)
      : "invalid ship id",
  execute(_game, _player, { warship, tile, path }) {
    warship.patrol = tile;
    warship.path = path;
    warship.step = 0;
  },
});

/**
 * Warships (R-UNIT-04). A `warship` order buys one at a ready port of the
 * player's; it starts on the port's water. A `patrol` order sends it to
 * patrol around another water tile it can reach. A ship sails B-BOAT-SPEED
 * tiles per tick to points drawn within the patrol radius of its patrol
 * tile. Every B-WARSHIP-RELOAD it fires at the closest ship within
 * B-WARSHIP-RANGE of a player at war with its owner, warships first: a
 * warship loses B-WARSHIP-DAMAGE health and sinks at none, a transport sinks
 * with its troops at the first hit. It takes any trade ship in range of a
 * player under an embargo held for B-EMBARGO-NOTICE, with all the gold that
 * ship would have earned. A fallen player's warships sink. Runs before
 * transport ships move.
 */
export function installWarships(game: Game): void {
  const { balance, terrain } = game;
  const topology = terrain.topology;
  const search = searchFor(game);
  const ships = writable(game, "warships");
  const fights = writable(game, "fights");

  game.onOrder(WARSHIP_ORDER);
  game.onOrder(PATROL_ORDER);

  game.onTick(() => {
    const tick = game.tick;
    recordFights();
    let kept = 0;
    for (const ship of ships) {
      if (warshipState(game, ship) !== "sunk") ships[kept++] = ship;
    }
    ships.length = kept;
    // In age order: a warship sunk earlier in the tick does nothing more.
    for (const ship of ships) {
      if (warshipState(game, ship) === "sunk") continue;
      sail(ship);
      // A capture takes the turn of a shot.
      if (tick >= ship.reloadAt && (capture(ship) || fire(ship))) {
        ship.reloadAt = tick + balance.warshipReloadTicks;
      }
    }
    kept = 0;
    for (const ship of ships) if (warshipState(game, ship) !== "sunk") ships[kept++] = ship;
    ships.length = kept;
  });

  /** Fights under way, so that they are remembered for B-WAR-MEMORY. */
  function recordFights(): void {
    const until = game.tick + balance.warMemoryTicks;
    const mark = (x: number, y: number) => {
      if (x === y || x === 0 || y === 0) return;
      const a = Math.min(x, y);
      const b = Math.max(x, y);
      const fight = fights.find((f) => f.a === a && f.b === b);
      if (fight) fight.until = until;
      else fights.push({ a, b, until });
    };
    for (const attack of game.attacks) if (attack.troops > 0) mark(attack.player, attack.target);
    for (const boat of game.boats) mark(boat.player, game.territory.ownerOf(boat.target));
    for (const missile of game.missiles) mark(missile.player, game.territory.ownerOf(missile.to));
    let kept = 0;
    for (const fight of fights) if (game.tick < fight.until) fights[kept++] = fight;
    fights.length = kept;
    fights.sort((x, y) => x.a - y.a || x.b - y.b);
  }

  function sail(ship: Warship): void {
    if (warshipState(game, ship) === "idle") {
      const area = search.area(ship.patrol, patrolRadius(game));
      const draw = derivedRandom(game.seed, game.tick, ship.id, DrawUsage.WarshipPatrol);
      const target = area[draw % area.length] as number;
      ship.path = search.path(ship.tile, target, balance.boatRange) ?? EMPTY;
      ship.step = 0;
      if (ship.path.length === 0) return;
    }
    ship.step = Math.min(ship.step + balance.boatSpeed, ship.path.length);
    ship.tile = ship.path[ship.step - 1] as number;
  }

  /**
   * The oldest trade ship in range of a player under an embargo held long
   * enough changes hands with its gold. Whether one did.
   */
  function capture(ship: Warship): boolean {
    const owner = game.player(ship.player);
    if (!owner) return false;
    const trade = game.tradeShips;
    const index = trade.findIndex((prize) => {
      const at = prize.path[Math.max(0, prize.step - 1)] ?? -1;
      return (
        at >= 0 &&
        prize.player !== ship.player &&
        topology.distance(at, ship.tile) <= balance.warshipRange &&
        !isAllied(game, ship.player, prize.player) &&
        embargoedByOrderSince(game, ship.player, prize.player) <=
          game.tick - balance.embargoNoticeTicks
      );
    });
    if (index < 0) return false;
    const prize = takeTradeShip(game, index);
    owner.gold += tradeGold(prize.path.length);
    logEvent(game, { tick: game.tick, type: "captured", a: ship.player, b: prize.player });
    return true;
  }

  /** Fires at the closest enemy warship in range, else the closest enemy transport. Whether it fired. */
  function fire(ship: Warship): boolean {
    let best: Warship | undefined;
    let bestDistance = 0;
    for (const other of ships) {
      if (other.player === ship.player || warshipState(game, other) === "sunk") continue;
      const distance = topology.distance(ship.tile, other.tile);
      if (distance > balance.warshipRange || !atWar(game, ship.player, other.player)) continue;
      if (!best || distance < bestDistance) {
        best = other;
        bestDistance = distance;
      }
    }
    if (best) {
      best.health -= balance.warshipDamage;
      ship.firedAt = game.tick;
      ship.aim = best.tile;
      return true;
    }
    let boat = -1;
    for (let i = 0; i < game.boats.length; i++) {
      const transport = game.boats[i];
      if (!transport || transport.player === ship.player) continue;
      const at = transport.path[Math.max(0, transport.step - 1)];
      if (at === undefined) continue;
      const distance = topology.distance(ship.tile, at);
      if (distance > balance.warshipRange || !atWar(game, ship.player, transport.player)) continue;
      if (boat < 0 || distance < bestDistance) {
        boat = i;
        bestDistance = distance;
      }
    }
    if (boat < 0) return false;
    const hit = game.boats[boat];
    const at = hit?.path[Math.max(0, hit.step - 1)];
    if (at !== undefined) {
      ship.firedAt = game.tick;
      ship.aim = at;
    }
    sinkBoat(game, boat);
    return true;
  }
}

/** The first water tile next to a port, in neighbour order, or -1. */
function shoreOf(game: Game, port: number): number {
  for (const tile of game.terrain.topology.neighbors(port)) {
    if (game.terrain.kinds[tile] === TileKind.Water) return tile;
  }
  return -1;
}

const EMPTY = new Int32Array(0);

/** Patrol areas kept at once; more are searched again, with the same result. */
const MAX_AREAS = 256;

const searches = new WeakMap<Game, WaterSearch>();

function searchFor(game: Game): WaterSearch {
  let search = searches.get(game);
  if (!search) {
    search = new WaterSearch(game);
    searches.set(game, search);
  }
  return search;
}

/**
 * Breadth-first searches over water, in a fixed neighbour order, for
 * warships: the water within a radius of a patrol tile, and the shortest
 * way from one water tile to another. Both follow from the map alone, so
 * the areas are kept by patrol tile and are not part of the state.
 */
class WaterSearch {
  private readonly game: Game;
  private readonly marks: Uint32Array;
  private readonly parents: Int32Array;
  private generation = 0;
  private queue = new Int32Array(1024);
  private readonly around = new Int32Array(4);
  private readonly areas = new Map<number, Int32Array>();

  constructor(game: Game) {
    this.game = game;
    const size = game.terrain.topology.size;
    this.marks = new Uint32Array(size);
    this.parents = new Int32Array(size);
  }

  /** Water tiles within `radius` steps by sea of `center`, `center` first. */
  area(center: number, radius: number): Int32Array {
    let area = this.areas.get(center);
    if (!area) {
      // Patrol tiles are the players' to choose: the cache stays bounded.
      if (this.areas.size >= MAX_AREAS) this.areas.clear();
      const count = this.run(center, radius, -1);
      area = this.queue.slice(0, count);
      this.areas.set(center, area);
    }
    return area;
  }

  /** The water tiles from the one after `from` to `to`, by the shortest way within `range`, or undefined. */
  path(from: number, to: number, range: number): Int32Array | undefined {
    if (from === to) return EMPTY;
    this.run(from, range, to);
    if (!this.seen(to)) return undefined;
    const path = new Int32Array(this.distance(to));
    for (let tile = to, i = path.length - 1; i >= 0; i--) {
      path[i] = tile;
      tile = this.parents[tile] as number;
    }
    return path;
  }

  /** Marks the water within `range` of `start`, stopping at `stop`; returns how many tiles it queued. */
  private run(start: number, range: number, stop: number): number {
    const { terrain } = this.game;
    const topology = terrain.topology;
    if (this.generation === 0xffff) {
      this.marks.fill(0);
      this.generation = 0;
    }
    this.generation++;
    this.mark(start, 0);
    this.queue[0] = start;
    let tail = 1;
    let head = 0;
    while (head < tail) {
      const tile = this.queue[head++] as number;
      if (tile === stop) break;
      const distance = this.distance(tile) + 1;
      if (distance > range) continue;
      const count = topology.neighborsInto(tile, this.around);
      for (let i = 0; i < count; i++) {
        const next = this.around[i] as number;
        if (terrain.kinds[next] !== TileKind.Water || this.seen(next)) continue;
        this.mark(next, distance);
        this.parents[next] = tile;
        if (tail === this.queue.length) {
          const grown = new Int32Array(this.queue.length * 2);
          grown.set(this.queue);
          this.queue = grown;
        }
        this.queue[tail++] = next;
      }
    }
    return tail;
  }

  private seen(tile: number): boolean {
    return (this.marks[tile] as number) >>> 16 === this.generation;
  }

  private mark(tile: number, distance: number): void {
    this.marks[tile] = ((this.generation << 16) | distance) >>> 0;
  }

  private distance(tile: number): number {
    return (this.marks[tile] as number) & 0xffff;
  }
}
