import { isAllied, logEvent } from "./diplomacy.ts";
import type { Game, Player } from "./game.ts";
import { isqrt, mulDiv } from "./integer-math.ts";
import { DrawUsage, derivedRandom } from "./random.ts";
import { shieldedBy } from "./landmarks.ts";
import { spawnSettings } from "./spawn.ts";
import { StructureKind, isReady, type Structure } from "./structures.ts";
import { NEUTRAL } from "./territory/territory-map.ts";

/** How strong a missile is: its code in missile orders, never renumbered. */
export const MissileSize = {
  /** Destroys what is under its blast. */
  Light: 0,
  /** A wider blast, and fallout on the land under it (R-UNIT-06). */
  Heavy: 1,
} as const;
export type MissileSize = (typeof MissileSize)[keyof typeof MissileSize];

/** A missile in flight (R-UNIT-05), from the centre of a silo's tile to its target. */
export interface Missile {
  readonly id: number;
  readonly player: number;
  readonly size: MissileSize;
  readonly from: number;
  readonly to: number;
  readonly launchedAt: number;
  /** Tick it strikes, at the end of the tick before. */
  readonly arrivesAt: number;
  /** Air defenses that already tried to stop it, by structure id, in the order they did. */
  readonly tried: number[];
}

/** Land made unusable by a heavy missile until `until` (R-UNIT-06). */
export interface Fallout {
  readonly tile: number;
  readonly radius: number;
  readonly until: number;
}

/** Why a missile order is refused once its fields are known to be integers. */
export const MissileError = {
  Early: "missiles come after the spawn phase",
  Size: "unknown missile size",
  Silo: "no loaded silo of yours",
  Ally: "an ally's land cannot be targeted",
  Near: "an ally's land is within the blast",
  Gold: "not enough gold",
} as const;
export type MissileError = (typeof MissileError)[keyof typeof MissileError];

/** Gold a missile of this size costs: B-COST-MISSILE or B-COST-HEAVY-MISSILE, the same every time. */
export function missileCost(game: Game, size: MissileSize): number {
  return size === MissileSize.Heavy ? game.balance.heavyMissileCost : game.balance.missileCost;
}

export function isMissileSize(size: number): size is MissileSize {
  return size === MissileSize.Light || size === MissileSize.Heavy;
}

/** A length on a map of 2^19 tiles, grown with the side of larger maps like the spawn radius. */
function scaled(game: Game, length: number): number {
  return Math.max(length, mulDiv(length, spawnSettings(game).radius, game.balance.spawnRadius));
}

/** Blast radius of a missile of this size on this map, in tiles. */
export function blastRadius(game: Game, size: MissileSize): number {
  const { missileRadius, heavyMissileRadius } = game.balance;
  return scaled(game, size === MissileSize.Heavy ? heavyMissileRadius : missileRadius);
}

/** Radius of an air defense on this map, in tiles. */
export function airDefenseRadius(game: Game): number {
  return scaled(game, game.balance.airDefenseRadius);
}

/** Whether a structure is a ready silo of `player` with a missile loaded. */
function loaded(game: Game, structure: Structure, player: number): boolean {
  return (
    structure.kind === StructureKind.Silo &&
    structure.player === player &&
    isReady(game, structure) &&
    game.tick >= structure.reloadAt
  );
}

/** The player's loaded silo closest to `target`, the oldest on a tie; undefined if none. */
export function launchSilo(game: Game, player: number, target: number): Structure | undefined {
  const topology = game.terrain.topology;
  let best: Structure | undefined;
  let bestDistance = 0;
  for (const structure of game.structures) {
    if (!loaded(game, structure, player)) continue;
    const distance = topology.squaredDistance(structure.tile, target);
    if (!best || distance < bestDistance) {
      best = structure;
      bestDistance = distance;
    }
  }
  return best;
}

/** Why `player` cannot launch a missile of `size` at `target`, or undefined. The tile is on the map. */
export function missileError(
  game: Game,
  player: Player,
  target: number,
  size: number,
): string | undefined {
  if (game.phase !== "play") return MissileError.Early;
  if (!isMissileSize(size)) return MissileError.Size;
  const owner = game.territory.ownerOf(target);
  if (owner !== player.id && isAllied(game, player.id, owner)) return MissileError.Ally;
  if (blastHitsAlly(game, player.id, target, blastRadius(game, size))) return MissileError.Near;
  if (!launchSilo(game, player.id, target)) return MissileError.Silo;
  if (player.gold < missileCost(game, size)) return MissileError.Gold;
  return undefined;
}

/**
 * Whether the disc of `radius` around `center` holds land of an ally or a
 * teammate of `player`, which a missile of theirs must spare.
 */
function blastHitsAlly(game: Game, player: number, center: number, radius: number): boolean {
  const { terrain, territory } = game;
  const topology = terrain.topology;
  const reach = radius * radius;
  const checked = new Map<number, boolean>();
  for (const tile of topology.tilesWithin(center, radius)) {
    const owner = territory.ownerOf(tile);
    if (owner === NEUTRAL || owner === player) continue;
    let allied = checked.get(owner);
    if (allied === undefined) {
      allied = isAllied(game, player, owner);
      checked.set(owner, allied);
    }
    if (allied && topology.squaredDistance(tile, center) <= reach) return true;
  }
  return false;
}

/**
 * Where a missile is at `tick`: the tile on the straight line from its silo
 * to its target, the short way around a wrapping map, in proportion to the
 * time it has flown. Integer arithmetic only, as it decides interceptions.
 */
export function missileTile(game: Game, missile: Missile, tick: number): number {
  const topology = game.terrain.topology;
  const span = missile.arrivesAt - missile.launchedAt;
  const flown = Math.min(span, Math.max(0, tick - missile.launchedAt));
  const x0 = topology.x(missile.from);
  const y0 = topology.y(missile.from);
  let dx = topology.x(missile.to) - x0;
  const dy = topology.y(missile.to) - y0;
  if (topology.wrapsX) {
    const width = topology.width;
    if (dx > width / 2) dx -= width;
    else if (dx < -width / 2) dx += width;
  }
  const x = x0 + Math.trunc((dx * flown) / span);
  const y = y0 + Math.trunc((dy * flown) / span);
  return topology.index(
    topology.wrapsX ? ((x % topology.width) + topology.width) % topology.width : x,
    y,
  );
}

/**
 * Missiles (R-BUILD-04, R-BUILD-05, R-UNIT-05, R-UNIT-06). A `missile` order
 * pays for one and launches it from the player's loaded silo closest to the
 * target, which reloads for B-SILO-RELOAD. It flies B-MISSILE-SPEED tiles a
 * tick in a straight line. Each tick, every ready air defense of a player
 * who is not the launcher's ally, loaded and within its radius of the
 * missile, tries once to stop it: B-AIR-DEFENSE-CHANCE, drawn from the seed.
 * One that stops it reloads for B-AIR-DEFENSE-RELOAD. A missile that gets
 * through strikes: every tile of land within its blast radius goes back to
 * nobody with what stands on it, and each player hit loses the share of
 * their troops that the tiles lost were of their land. A heavy missile also
 * leaves fallout on that land for B-FALLOUT-TIME: no one can take it. Runs
 * after the warships and before the transport ships.
 */
export function installMissiles(game: Game): void {
  const { balance, terrain, territory } = game;
  const topology = terrain.topology;
  const missiles = game.missiles;

  game.onOrder((_, player, order) => {
    if (order.type !== "missile" || !isMissileSize(order.size)) return false;
    const silo = launchSilo(game, player.id, order.target);
    if (!silo) return false;
    player.gold -= missileCost(game, order.size);
    silo.reloadAt = game.tick + balance.siloReloadTicks;
    const distance = isqrt(topology.squaredDistance(silo.tile, order.target));
    missiles.push({
      id: game.nextMissileId++,
      player: player.id,
      size: order.size,
      from: silo.tile,
      to: order.target,
      launchedAt: game.tick,
      arrivesAt: game.tick + Math.max(1, Math.ceil(distance / balance.missileSpeed)),
      tried: [],
    });
    const target = territory.ownerOf(order.target);
    if (target !== NEUTRAL && target !== player.id) {
      logEvent(game, { tick: game.tick, type: "missile", a: player.id, b: target });
    }
    return true;
  });

  game.onTick(() => {
    const tick = game.tick;
    const fallout = game.fallout;
    let kept = 0;
    for (const zone of fallout) if (tick < zone.until) fallout[kept++] = zone;
    fallout.length = kept;

    kept = 0;
    for (const missile of missiles) {
      if (intercepted(missile)) continue;
      if (tick + 1 >= missile.arrivesAt) {
        // Land under the blast that became an ally's or a teammate's while it flew is spared, and the missile paid back.
        const launcher = game.player(missile.player);
        const radius = blastRadius(game, missile.size);
        if (blastHitsAlly(game, missile.player, missile.to, radius)) {
          if (launcher) launcher.gold += missileCost(game, missile.size);
        } else {
          strike(missile);
        }
        continue;
      }
      missiles[kept++] = missile;
    }
    missiles.length = kept;
  });

  /** Gives every air defense in range its one try, then shield landmarks (R-LAND-02); whether one stopped the missile. */
  function intercepted(missile: Missile): boolean {
    const at = missileTile(game, missile, game.tick + 1);
    if (byAirDefense(missile, at)) return true;
    if (game.terrain.landmarks.length === 0) return false;
    const previous =
      game.tick > missile.launchedAt ? missileTile(game, missile, game.tick) : undefined;
    const holder = shieldedBy(game, missile, at, previous);
    if (holder === NEUTRAL) return false;
    logEvent(game, { tick: game.tick, type: "stopped", a: holder, b: missile.player });
    return true;
  }

  function byAirDefense(missile: Missile, at: number): boolean {
    const radius = airDefenseRadius(game);
    const reach = radius * radius;
    for (const defense of game.structures) {
      if (
        defense.kind !== StructureKind.AirDefense ||
        // Burnt or taken earlier in this tick, before structures change hands.
        territory.ownerOf(defense.tile) !== defense.player ||
        !isReady(game, defense) ||
        game.tick < defense.reloadAt ||
        defense.player === missile.player ||
        isAllied(game, defense.player, missile.player) ||
        missile.tried.includes(defense.id) ||
        topology.squaredDistance(defense.tile, at) > reach
      ) {
        continue;
      }
      missile.tried.push(defense.id);
      const draw = derivedRandom(
        derivedRandom(game.seed, game.tick, missile.id, DrawUsage.Interception),
        game.tick,
        defense.id,
        DrawUsage.Interception,
      );
      if (draw % 100 < balance.airDefenseChancePercent) {
        defense.reloadAt = game.tick + balance.airDefenseReloadTicks;
        logEvent(game, { tick: game.tick, type: "stopped", a: defense.player, b: missile.player });
        return true;
      }
    }
    return false;
  }

  function strike(missile: Missile): void {
    const radius = blastRadius(game, missile.size);
    const reach = radius * radius;
    const heavy = missile.size === MissileSize.Heavy;
    const until = game.tick + 1 + balance.falloutTicks;
    const lost = new Map<number, number>();
    for (const tile of topology.tilesWithin(missile.to, radius)) {
      if (!terrain.isOwnable(tile) || topology.squaredDistance(tile, missile.to) > reach) continue;
      if (heavy) game.falloutUntil[tile] = Math.max(game.falloutUntil[tile] as number, until);
      const owner = territory.ownerOf(tile);
      if (owner === NEUTRAL) continue;
      lost.set(owner, (lost.get(owner) ?? 0) + 1);
    }
    // Troops first, against the land each player held before the strike.
    for (const [owner, tiles] of [...lost].sort((a, b) => a[0] - b[0])) {
      const player = game.player(owner);
      if (!player) continue;
      player.troops -= mulDiv(player.troops, tiles, territory.tileCount(owner));
    }
    for (const tile of topology.tilesWithin(missile.to, radius)) {
      if (!terrain.isOwnable(tile) || topology.squaredDistance(tile, missile.to) > reach) continue;
      if (territory.ownerOf(tile) !== NEUTRAL) territory.setOwner(tile, NEUTRAL);
    }
    if (heavy) game.fallout.push({ tile: missile.to, radius, until });
  }
}
