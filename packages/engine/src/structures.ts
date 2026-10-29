import { Disable, type Game, type Player } from "./game.ts";
import { divFloor, mulDiv } from "./integer-math.ts";
import { spawnSettings } from "./spawn.ts";
import { NEUTRAL } from "./territory/territory-map.ts";

/** What a structure is (R-BUILD). The number is its code in build orders: never renumber. */
export const StructureKind = {
  City: 0,
  Fort: 1,
  Port: 2,
  Silo: 3,
  AirDefense: 4,
  /** Counts as two cities in every way (R-BUILD-08). */
  Palace: 5,
} as const;
export type StructureKind = (typeof StructureKind)[keyof typeof StructureKind];

const HIGHEST_KIND: number = StructureKind.Palace;

/** A structure on one land tile. It works from `readyAt` on, and changes hands with its tile. */
export interface Structure {
  readonly id: number;
  player: number;
  readonly kind: StructureKind;
  readonly tile: number;
  /** First tick the structure works (B-BUILD-TIME after the order). */
  readonly readyAt: number;
  /** A silo or an air defense: first tick it can launch or stop a missile again; 0 for the others. */
  reloadAt: number;
}

/** Why a build order is refused once its tile is known to be on the map and ownable. */
export const BuildError = {
  Early: "building starts after the spawn phase",
  Foreign: "the tile is not yours",
  Crowded: "too close to another structure",
  Land: "not enough land for another city",
  Coast: "a port needs a coast",
  Disabled: "left out of this game",
  Gold: "not enough gold",
} as const;
export type BuildError = (typeof BuildError)[keyof typeof BuildError];

export function isStructureKind(kind: number): kind is StructureKind {
  return Number.isInteger(kind) && kind >= 0 && kind <= HIGHEST_KIND;
}

export function isReady(game: Game, structure: Structure): boolean {
  return game.tick >= structure.readyAt;
}

export function structureAt(game: Game, tile: number): Structure | undefined {
  return game.structures.find((structure) => structure.tile === tile);
}

/** Structures of one kind a player owns, those still being built included. */
export function structureCount(game: Game, player: number, kind: StructureKind): number {
  let count = 0;
  for (const structure of game.structures) {
    if (structure.player === player && structure.kind === kind) count++;
  }
  return count;
}

/**
 * The `Disable` bit that leaves a kind out of a private game (R-MODE-03): its
 * own code's bit, but a palace goes with the cities (R-BUILD-08).
 */
export function disableBit(kind: StructureKind): number {
  return kind === StructureKind.Palace ? Disable.City : 1 << kind;
}

/** Cities a player owns, those still being built included, a palace counting as two (R-BUILD-08). */
export function cityShare(game: Game, player: number): number {
  return (
    structureCount(game, player, StructureKind.City) +
    2 * structureCount(game, player, StructureKind.Palace)
  );
}

/**
 * Gold the next structure of a kind costs a player: its base cost, times
 * B-COST-GROWTH for each one of that kind they already own (R-BUILD). Cities
 * and palaces grow together, a palace counting as two cities and costing
 * what the next two would (R-BUILD-08).
 */
export function structureCost(game: Game, player: number, kind: StructureKind): number {
  if (kind === StructureKind.City || kind === StructureKind.Palace) {
    const owned = cityShare(game, player);
    const next = grownCost(game, game.balance.cityCost, owned);
    if (kind === StructureKind.City) return next;
    return Math.min(Number.MAX_SAFE_INTEGER, next + grownCost(game, next, 1));
  }
  return grownCost(game, baseCost(game, kind), structureCount(game, player, kind));
}

function grownCost(game: Game, base: number, owned: number): number {
  const { costGrowthPercent } = game.balance;
  let cost = base;
  for (let i = 0; i < owned && cost < Number.MAX_SAFE_INTEGER; i++) {
    cost = Math.min(Number.MAX_SAFE_INTEGER, mulDiv(cost, costGrowthPercent, 100));
  }
  return cost;
}

function baseCost(
  game: Game,
  kind: Exclude<StructureKind, typeof StructureKind.City | typeof StructureKind.Palace>,
): number {
  const balance = game.balance;
  switch (kind) {
    case StructureKind.Fort:
      return balance.fortCost;
    case StructureKind.Port:
      return balance.portCost;
    case StructureKind.Silo:
      return balance.siloCost;
    case StructureKind.AirDefense:
      return balance.airDefenseCost;
  }
}

/** B-BUILD-TIME, or B-BUILD-TIME-LONG for a silo or an air defense. */
export function buildTime(game: Game, kind: StructureKind): number {
  return kind === StructureKind.Silo || kind === StructureKind.AirDefense
    ? game.balance.longBuildTicks
    : game.balance.buildTicks;
}

/** R-BUILD-07: most cities a player's land supports, one for every B-CITY-LAND tiles, the first one free. */
export function cityLimit(game: Game, player: number): number {
  return 1 + divFloor(game.territory.tileCount(player), cityLand(game));
}

/**
 * Cities that raise a player's population cap: ready ones, a palace counting
 * as two, up to what their land supports (R-BUILD-01, R-BUILD-08).
 */
export function workingCities(game: Game, player: Player): number {
  let ready = 0;
  for (const structure of game.structures) {
    if (structure.player !== player.id || !isReady(game, structure)) continue;
    if (structure.kind === StructureKind.City) ready++;
    else if (structure.kind === StructureKind.Palace) ready += 2;
  }
  return Math.min(ready, cityLimit(game, player.id));
}

/**
 * Why a structure of this kind cannot go on this tile for this player, or
 * undefined when it can. The tile is already known to be on the map and ownable.
 */
export function placementError(
  game: Game,
  player: Player,
  kind: StructureKind,
  tile: number,
): BuildError | undefined {
  if (!game.allows(disableBit(kind))) return BuildError.Disabled;
  if (game.territory.ownerOf(tile) !== player.id) return BuildError.Foreign;
  if (kind === StructureKind.Port && !game.terrain.isCoast(tile)) return BuildError.Coast;
  const spacing = game.balance.buildSpacing;
  const topology = game.terrain.topology;
  for (const structure of game.structures) {
    if (topology.distance(structure.tile, tile) < spacing) return BuildError.Crowded;
  }
  const cities = kind === StructureKind.City ? 1 : kind === StructureKind.Palace ? 2 : 0;
  if (cities > 0 && cityShare(game, player.id) + cities > cityLimit(game, player.id)) {
    return BuildError.Land;
  }
  if (player.gold < structureCost(game, player.id, kind)) return BuildError.Gold;
  return undefined;
}

/**
 * Radius of a fort on this map, in tiles: B-FORT-RADIUS on a map of 2^19
 * tiles, growing with the side of larger maps like the spawn radius.
 */
export function fortRadius(game: Game): number {
  const { spawnRadius, fortRadius: radius } = game.balance;
  return Math.max(radius, mulDiv(radius, spawnSettings(game).radius, spawnRadius));
}

/** Tiles of land per city a player may own beyond the first, scaled like the spawn area. */
function cityLand(game: Game): number {
  const { spawnRadius, cityLand: land } = game.balance;
  const radius = spawnSettings(game).radius;
  return Math.max(1, mulDiv(land, radius * radius, spawnRadius * spawnRadius));
}

/** R-BUILD-03: whether a ready fort of the tile's owner stands within its radius of the tile. */
export function fortified(game: Game, tile: number, owner: number): boolean {
  if (owner === NEUTRAL) return false;
  const cache = readyForts(game);
  const forts = cache.byPlayer[owner];
  if (forts === undefined) return false;
  const topology = game.terrain.topology;
  const territory = game.territory;
  const radius = cache.radius;
  for (const structure of forts) {
    if (
      structure.player === owner &&
      // Taken earlier in this tick, before the structures changed hands.
      territory.ownerOf(structure.tile) === owner &&
      topology.distance(structure.tile, tile) <= radius
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The ready forts of a game by player id, and the fort radius. Attacks ask
 * `fortified` twice for every tile they take, so the forts are picked out of
 * all the structures once rather than at every call.
 */
interface FortCache {
  readonly game: Game;
  readonly tick: number;
  readonly length: number;
  readonly last: Structure | undefined;
  readonly nextId: number;
  readonly handovers: number;
  readonly radius: number;
  readonly byPlayer: (Structure[] | undefined)[];
}

// One game at a time: a game only finds its own forts here, and others rebuild them.
let fortCache: FortCache | undefined;

/** Structures that changed hands so far, in every game: a fort that changes hands moves to another list. */
let handovers = 0;

/**
 * Ready forts by player. A fort's kind, tile and `readyAt` never change, so
 * the lists hold as long as the tick, the set of structures and their players
 * do. The set changes only by a push, which adds at the end (and, for a
 * build, takes the next id), or by removals, which shorten the array: the
 * length, the last structure and the next id tell. Players change only when
 * structures change hands, which counts them.
 */
function readyForts(game: Game): FortCache {
  const structures = game.structures;
  const length = structures.length;
  const last = structures[length - 1];
  const cache = fortCache;
  if (
    cache?.game === game &&
    cache.tick === game.tick &&
    cache.length === length &&
    cache.last === last &&
    cache.nextId === game.nextStructureId &&
    cache.handovers === handovers
  ) {
    return cache;
  }
  const byPlayer: (Structure[] | undefined)[] = [];
  for (const structure of structures) {
    if (structure.kind !== StructureKind.Fort || !isReady(game, structure)) continue;
    const forts = byPlayer[structure.player];
    if (forts === undefined) byPlayer[structure.player] = [structure];
    else forts.push(structure);
  }
  fortCache = {
    game,
    tick: game.tick,
    length,
    last,
    nextId: game.nextStructureId,
    handovers,
    radius: cache?.game === game ? cache.radius : fortRadius(game),
    byPlayer,
  };
  return fortCache;
}

/**
 * Structures (R-BUILD-01, R-BUILD-03, R-BUILD-06, R-BUILD-07). A build order
 * takes the gold at once and the structure works B-BUILD-TIME later; a
 * demolish order removes one of the player's structures with no refund.
 * After the attacks of each tick, every structure goes to the owner of its
 * tile. Structures live in `game.structures`, oldest first.
 */
export function installStructures(game: Game): void {
  const structures = game.structures;

  game.onOrder((_, player, order) => {
    if (order.type !== "build" || !isStructureKind(order.structure)) return false;
    player.gold -= structureCost(game, player.id, order.structure);
    structures.push({
      id: game.nextStructureId++,
      player: player.id,
      kind: order.structure,
      tile: order.tile,
      readyAt: game.tick + buildTime(game, order.structure),
      reloadAt: 0,
    });
    return true;
  });

  game.onOrder((_, player, order) => {
    if (order.type !== "demolish") return false;
    const index = structures.findIndex((s) => s.tile === order.tile && s.player === player.id);
    if (index < 0) return false;
    structures.splice(index, 1);
    return true;
  });

  game.onTick(() => {
    let kept = 0;
    for (const structure of structures) {
      const owner = game.territory.ownerOf(structure.tile);
      // Should land ever go back to nobody, what stood on it goes too.
      if (owner === NEUTRAL) continue;
      if (structure.player !== owner) {
        structure.player = owner;
        handovers++;
      }
      structures[kept++] = structure;
    }
    structures.length = kept;
  });
}
