import { captureCost, defenderLoss } from "./attacks.ts";
import { isAllied } from "./diplomacy.ts";
import type { Game } from "./game.ts";
import { TileKind } from "./terrain.ts";
import { NEUTRAL } from "./territory/territory-map.ts";

/** A transport ship carrying troops to a coast (R-UNIT-02). */
export interface Boat {
  readonly id: number;
  readonly player: number;
  /** Coastal tile the ship lands on. */
  readonly target: number;
  readonly troops: number;
  /** Water tiles from the departure coast to the target, in order; neither coast is included. */
  readonly path: Int32Array;
  /** How far along `path` the ship is; it lands once this reaches `path.length`. */
  step: number;
}

export interface SeaRoute {
  /** Coastal tile of the player the ship leaves from. */
  readonly from: number;
  readonly path: Int32Array;
}

/**
 * The shortest sea route from any coast of `player` to the coastal tile
 * `target`, or undefined when no coast of theirs is within B-BOAT-RANGE.
 * Ties go to the route found first in tile neighbour order, so every client
 * picks the same one.
 */
export function seaRoute(game: Game, player: number, target: number): SeaRoute | undefined {
  return searchFor(game).route(player, target);
}

/**
 * Coastal tiles not owned by `player` that a ship of theirs can reach, the
 * closest by sea first, at most `limit` of them, skipping those `accept`
 * turns down; it is given each coast and its distance by sea, in water
 * tiles. Meant for computer players looking beyond their own land mass; one
 * call walks up to B-BOAT-RANGE of sea.
 */
export function reachableCoasts(
  game: Game,
  player: number,
  limit: number,
  accept: (tile: number, distance: number) => boolean = () => true,
): number[] {
  return searchFor(game).coasts(player, limit, accept);
}

/**
 * Transport ships (R-UNIT-02, R-ATTACK-09). An embark order sends troops from
 * the player's coast closest to the target; the ship sails B-BOAT-SPEED water
 * tiles per tick and, on arrival, takes the landing tile and attacks from it.
 * Ships at sea live in `game.boats`.
 */
export function installBoats(game: Game): void {
  const { territory, terrain, balance } = game;
  const boats = game.boats;
  const around = new Int32Array(4);

  game.onOrder((_, player, order) => {
    if (order.type !== "embark") return false;
    const route = seaRoute(game, player.id, order.target);
    if (!route) return false;
    player.troops -= order.troops;
    boats.push({
      id: game.nextBoatId++,
      player: player.id,
      target: order.target,
      troops: order.troops,
      path: route.path,
      step: 0,
    });
    return true;
  });

  game.onTick(() => {
    let kept = 0;
    for (const boat of boats) {
      // A fallen player's ships sink with their troops (R-ECO-05).
      if (!game.player(boat.player)?.alive) continue;
      boat.step = Math.min(boat.step + balance.boatSpeed, boat.path.length);
      if (boat.step === boat.path.length) land(boat);
      else boats[kept++] = boat;
    }
    boats.length = kept;
  });

  /**
   * Takes the landing tile at its usual price, then sends what is left
   * against its former owner, as an attack by land from the beach.
   */
  function land(boat: Boat): void {
    const player = game.player(boat.player);
    if (!player) return;
    const owner = territory.ownerOf(boat.target);
    // An ally's coast, since the ship sailed (R-DIPLO-02): the troops come home.
    // Or a beach under fallout since (R-UNIT-06): they cannot land either.
    if (owner === player.id || isAllied(game, player.id, owner) || !game.usable(boat.target)) {
      player.troops += boat.troops;
      return;
    }
    const defender = owner === NEUTRAL ? undefined : game.player(owner);
    const cost = captureCost(game, boat.target, defender);
    // Too few troops to take the beach: they are lost.
    if (boat.troops < cost) return;
    if (defender) defender.troops -= defenderLoss(game, boat.target, defender);
    territory.setOwner(boat.target, player.id);
    const troops = boat.troops - cost;
    player.troops += troops;
    const count = terrain.topology.neighborsInto(boat.target, around);
    for (let i = 0; i < count; i++) {
      const next = around[i] as number;
      if (territory.ownerOf(next) !== owner || !game.usable(next)) continue;
      // The attack takes the troops back from the player; if it cannot start, they stay ashore.
      if (troops > 0) game.apply(player.id, { type: "attack", target: next, troops });
      return;
    }
  }
}

const searches = new WeakMap<Game, SeaSearch>();

function searchFor(game: Game): SeaSearch {
  let search = searches.get(game);
  if (!search) {
    search = new SeaSearch(game);
    searches.set(game, search);
  }
  return search;
}

/**
 * Breadth-first search over water tiles, in integers and in a fixed order.
 * One 32-bit mark per tile holds the search it belongs to (high 16 bits) and
 * the distance from the start (low 16 bits), so starting a search costs
 * nothing and paths are read back by stepping down the distances.
 *
 * Computer players run one of these every time they think of a ship, over
 * thousands of water tiles, so the walks read the typed arrays directly and
 * look up each water tile's neighbours once, for its shore and for the
 * water beyond it alike.
 */
class SeaSearch {
  private readonly game: Game;
  private readonly marks: Uint32Array;
  private generation = 0;
  private queue = new Int32Array(1024);
  private readonly around = new Int32Array(4);

  constructor(game: Game) {
    this.game = game;
    this.marks = new Uint32Array(game.terrain.topology.size);
  }

  route(player: number, target: number): SeaRoute | undefined {
    const { terrain, territory, balance } = this.game;
    const { topology, kinds } = terrain;
    const owners = territory.owners;
    const { marks, around } = this;
    const generation = this.start();
    let tail = this.seed(target, 0);
    const range = balance.boatRange;
    let head = 0;
    while (head < tail) {
      const water = this.queue[head++] as number;
      const count = topology.neighborsInto(water, around);
      // The player's shore is looked for first: it ends the search before anything beyond is queued.
      for (let i = 0; i < count; i++) {
        const tile = around[i] as number;
        if (owners[tile] === player && ownable(kinds[tile] as number)) {
          return { from: tile, path: this.pathFrom(water) };
        }
      }
      const distance = ((marks[water] as number) & 0xffff) + 1;
      if (distance >= range) continue;
      for (let i = 0; i < count; i++) {
        const next = around[i] as number;
        if (kinds[next] !== TileKind.Water || (marks[next] as number) >>> 16 === generation) {
          continue;
        }
        marks[next] = ((generation << 16) | distance) >>> 0;
        tail = this.enqueue(tail, next);
      }
    }
    return undefined;
  }

  coasts(
    player: number,
    limit: number,
    accept: (tile: number, distance: number) => boolean,
  ): number[] {
    const { terrain, territory, balance } = this.game;
    const { topology, kinds } = terrain;
    const owners = territory.owners;
    const { marks, around } = this;
    const coasts: number[] = [];
    if (limit < 1) return coasts;
    const generation = this.start();
    let tail = 0;
    const borders = territory.borderCount(player);
    for (let b = 0; b < borders; b++) tail = this.seed(territory.borderTile(player, b), tail);
    const range = balance.boatRange;
    let head = 0;
    while (head < tail) {
      const water = this.queue[head++] as number;
      const count = topology.neighborsInto(water, around);
      const distance = ((marks[water] as number) & 0xffff) + 1;
      for (let i = 0; i < count; i++) {
        const tile = around[i] as number;
        // Ownable land next to this water tile is a coast: neighbours go both ways.
        if (!ownable(kinds[tile] as number)) continue;
        if ((marks[tile] as number) >>> 16 === generation || owners[tile] === player) continue;
        marks[tile] = (generation << 16) >>> 0;
        if (!accept(tile, distance)) continue;
        coasts.push(tile);
        if (coasts.length === limit) return coasts;
      }
      if (distance >= range) continue;
      for (let i = 0; i < count; i++) {
        const next = around[i] as number;
        if (kinds[next] !== TileKind.Water || (marks[next] as number) >>> 16 === generation) {
          continue;
        }
        marks[next] = ((generation << 16) | distance) >>> 0;
        tail = this.enqueue(tail, next);
      }
    }
    return coasts;
  }

  /** Queues the unseen water next to `tile` at distance 0, after the `tail` tiles already queued; returns the new tail. */
  private seed(tile: number, tail: number): number {
    const { kinds, topology } = this.game.terrain;
    const { marks, around } = this;
    const mark = (this.generation << 16) >>> 0;
    const count = topology.neighborsInto(tile, around);
    for (let i = 0; i < count; i++) {
      const water = around[i] as number;
      if (kinds[water] !== TileKind.Water || (marks[water] as number) >>> 16 === this.generation) {
        continue;
      }
      marks[water] = mark;
      tail = this.enqueue(tail, water);
    }
    return tail;
  }

  /** Back from the departure side to the target, taking the first neighbour one step closer each time. */
  private pathFrom(water: number): Int32Array {
    const path = new Int32Array(this.distance(water) + 1);
    for (let i = 0; i < path.length; i++) {
      path[i] = water;
      water = this.closer(water);
    }
    return path;
  }

  /** The first neighbour, in tile neighbour order, one step closer to the start. */
  private closer(water: number): number {
    const want = this.distance(water) - 1;
    const count = this.game.terrain.topology.neighborsInto(water, this.around);
    for (let i = 0; i < count; i++) {
      const next = this.around[i] as number;
      if (this.isWater(next) && this.seen(next) && this.distance(next) === want) return next;
    }
    return water;
  }

  private isWater(tile: number): boolean {
    return this.game.terrain.kinds[tile] === TileKind.Water;
  }

  /** Starts a new search; gives its generation. */
  private start(): number {
    if (this.generation === 0xffff) {
      this.marks.fill(0);
      this.generation = 0;
    }
    return ++this.generation;
  }

  private seen(tile: number): boolean {
    return (this.marks[tile] as number) >>> 16 === this.generation;
  }

  private distance(tile: number): number {
    return (this.marks[tile] as number) & 0xffff;
  }

  private enqueue(tail: number, tile: number): number {
    if (tail === this.queue.length) {
      const grown = new Int32Array(this.queue.length * 2);
      grown.set(this.queue);
      this.queue = grown;
    }
    this.queue[tail] = tile;
    return tail + 1;
  }
}

/** Land a player can own, the same test as `Terrain.isOwnable` on a tile's kind. */
function ownable(kind: number): boolean {
  return kind !== TileKind.Water && kind !== TileKind.Impassable;
}
