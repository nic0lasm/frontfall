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
    const cost = captureCost(game, boat.target, defender, player.id);
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
 */
class SeaSearch {
  private readonly game: Game;
  private readonly marks: Uint32Array;
  private generation = 0;
  private queue = new Int32Array(1024);
  private readonly around = new Int32Array(4);
  private readonly aroundShore = new Int32Array(4);

  constructor(game: Game) {
    this.game = game;
    this.marks = new Uint32Array(game.terrain.topology.size);
  }

  route(player: number, target: number): SeaRoute | undefined {
    const { topology } = this.game.terrain;
    const { territory } = this.game;
    this.start();
    let tail = 0;
    const count = topology.neighborsInto(target, this.around);
    for (let i = 0; i < count; i++) {
      const water = this.around[i] as number;
      if (!this.isWater(water) || this.seen(water)) continue;
      this.mark(water, 0);
      tail = this.enqueue(tail, water);
    }
    const found = this.walk(tail, (water) => {
      const shores = topology.neighborsInto(water, this.aroundShore);
      for (let i = 0; i < shores; i++) {
        const tile = this.aroundShore[i] as number;
        if (territory.ownerOf(tile) === player && this.game.terrain.isOwnable(tile)) return tile;
      }
      return undefined;
    });
    if (!found) return undefined;
    // Back from the departure side to the target, one step closer each time.
    const path = new Int32Array(this.distance(found.water) + 1);
    let water = found.water;
    for (let i = 0; i < path.length; i++) {
      path[i] = water;
      water = this.closer(water);
    }
    return { from: found.shore, path };
  }

  coasts(
    player: number,
    limit: number,
    accept: (tile: number, distance: number) => boolean,
  ): number[] {
    const { terrain } = this.game;
    const { topology } = terrain;
    const { territory } = this.game;
    const coasts: number[] = [];
    if (limit < 1) return coasts;
    this.start();
    let tail = 0;
    const borders = territory.borderCount(player);
    for (let b = 0; b < borders; b++) {
      const count = topology.neighborsInto(territory.borderTile(player, b), this.around);
      for (let i = 0; i < count; i++) {
        const water = this.around[i] as number;
        if (!this.isWater(water) || this.seen(water)) continue;
        this.mark(water, 0);
        tail = this.enqueue(tail, water);
      }
    }
    this.walk(tail, (water) => {
      const shores = topology.neighborsInto(water, this.aroundShore);
      for (let i = 0; i < shores; i++) {
        const tile = this.aroundShore[i] as number;
        if (this.seen(tile) || territory.ownerOf(tile) === player) continue;
        if (!terrain.isCoast(tile)) continue;
        this.mark(tile, 0);
        if (!accept(tile, this.distance(water) + 1)) continue;
        coasts.push(tile);
        if (coasts.length === limit) return tile;
      }
      return undefined;
    });
    return coasts;
  }

  /**
   * Visits the queued water tiles and those beyond them, nearest first, until
   * `visit` returns a tile. Returns that tile and the water tile it was found from.
   */
  private walk(
    queued: number,
    visit: (water: number) => number | undefined,
  ): { water: number; shore: number } | undefined {
    const { topology } = this.game.terrain;
    const range = this.game.balance.boatRange;
    let head = 0;
    let tail = queued;
    while (head < tail) {
      const water = this.queue[head++] as number;
      const shore = visit(water);
      if (shore !== undefined) return { water, shore };
      const distance = this.distance(water) + 1;
      if (distance >= range) continue;
      const count = topology.neighborsInto(water, this.around);
      for (let i = 0; i < count; i++) {
        const next = this.around[i] as number;
        if (!this.isWater(next) || this.seen(next)) continue;
        this.mark(next, distance);
        tail = this.enqueue(tail, next);
      }
    }
    return undefined;
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

  private start(): void {
    if (this.generation === 0xffff) {
      this.marks.fill(0);
      this.generation = 0;
    }
    this.generation++;
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
