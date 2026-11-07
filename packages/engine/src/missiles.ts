import { isAllied, logEvent } from "./diplomacy.ts";
import type { Game, Player } from "./game.ts";
import { isqrt, mulDiv } from "./integer-math.ts";
import { ANY_PHASE, defineOrder, refusalOf, tileError } from "./order-rules.ts";
import { DrawUsage, derivedRandom } from "./random.ts";
import { shieldedBy } from "./landmarks.ts";
import { spawnSettings } from "./spawn.ts";
import type { Topology } from "./topology.ts";
import { writable } from "./state/lists.ts";
import {
  MOSQUE_TRIES,
  StructureKind,
  startReload,
  structureState,
  type Structure,
} from "./structures.ts";
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

/** Land made dearer to take by a missile until `until` (R-UNIT-06). */
export interface Fallout {
  readonly tile: number;
  readonly radius: number;
  readonly until: number;
}

/**
 * What became of a missile, for interfaces to draw: stopped in the air
 * ("intercepted"), come down ("struck"), or called off because the blast
 * would have reached an ally's land ("spared"). `tile` is where it stopped
 * or landed; `site` the air defense that stopped it, undefined for a shield
 * landmark; `by` who stopped it, NEUTRAL otherwise.
 */
export interface MissileEvent {
  readonly tick: number;
  readonly type: "intercepted" | "struck" | "spared";
  readonly id: number;
  readonly player: number;
  readonly size: MissileSize;
  readonly from: number;
  readonly to: number;
  readonly tile: number;
  readonly by: number;
  readonly site?: number;
}

/**
 * The missile events logged since the last call, oldest first, taken out of
 * the log: an interface reads each one once.
 */
export function takeMissileEvents(game: Game): MissileEvent[] {
  return writable(game, "missileEvents").splice(0);
}

/** Events kept when nobody reads them, in a server, a bench or a replay. */
export const MISSILE_LOG_SIZE = 64;

function logMissile(game: Game, event: MissileEvent): void {
  const log = writable(game, "missileEvents");
  log.push(event);
  if (log.length > MISSILE_LOG_SIZE) log.splice(0, log.length - MISSILE_LOG_SIZE);
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
function loaded(game: Game, structure: Readonly<Structure>, player: number): boolean {
  return (
    structure.kind === StructureKind.Silo &&
    structure.player === player &&
    structureState(game, structure) === "active"
  );
}

/** The player's loaded silo closest to `target`, the oldest on a tie; undefined if none. */
export function launchSilo(
  game: Game,
  player: number,
  target: number,
): Readonly<Structure> | undefined {
  const topology = game.terrain.topology;
  let best: Readonly<Structure> | undefined;
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
  return refusalOf(missilePlan(game, player, target, size));
}

/** A missile to launch: its size, its target, and the silo it leaves from (`launchSilo`). */
interface MissilePlan {
  readonly size: MissileSize;
  readonly target: number;
  readonly silo: Readonly<Structure>;
}

function missilePlan(
  game: Game,
  player: Player,
  target: number,
  size: number,
): MissileError | MissilePlan {
  if (game.phase !== "play") return MissileError.Early;
  if (!isMissileSize(size)) return MissileError.Size;
  const owner = game.territory.ownerOf(target);
  if (owner !== player.id && isAllied(game, player.id, owner)) return MissileError.Ally;
  if (blastHitsAlly(game, player.id, target, blastRadius(game, size))) return MissileError.Near;
  const silo = launchSilo(game, player.id, target);
  if (!silo) return MissileError.Silo;
  if (player.gold < missileCost(game, size)) return MissileError.Gold;
  return { size, target, silo };
}

/**
 * R-BUILD-05, R-UNIT-05: `missile` pays for a missile and launches it from
 * the player's loaded silo closest to the target, which reloads.
 */
export const MISSILE_ORDER = defineOrder("missile", {
  phases: ANY_PHASE,
  validate: (game, player, order) =>
    Number.isSafeInteger(order.size)
      ? (tileError(game, order.target) ?? missilePlan(game, player, order.target, order.size))
      : MissileError.Size,
  execute(game, player, { size, target, silo }) {
    const { balance } = game;
    player.gold -= missileCost(game, size);
    startReload(game, silo, balance.siloReloadTicks);
    const distance = isqrt(game.terrain.topology.squaredDistance(silo.tile, target));
    writable(game, "missiles").push({
      id: game.nextMissileId++,
      player: player.id,
      size,
      from: silo.tile,
      to: target,
      launchedAt: game.tick,
      arrivesAt: game.tick + Math.max(1, Math.ceil(distance / balance.missileSpeed)),
      tried: [],
    });
    const owner = game.territory.ownerOf(target);
    if (owner !== NEUTRAL && owner !== player.id) {
      logEvent(game, { tick: game.tick, type: "missile", a: player.id, b: owner });
    }
  },
});

/**
 * Every tile of the disc of `radius` around `center`, in row order. The
 * topology's `tilesWithin` counts distance along the grid, which is a
 * diamond: the disc is cut out of the wider diamond of twice the radius,
 * which holds all of it.
 */
function tilesInDisc(topology: Topology, center: number, radius: number): number[] {
  const reach = radius * radius;
  return topology
    .tilesWithin(center, 2 * radius)
    .filter((tile) => topology.squaredDistance(tile, center) <= reach);
}

/**
 * Whether the disc of `radius` around `center` holds land of an ally or a
 * teammate of `player`, which a missile of theirs must spare.
 */
function blastHitsAlly(game: Game, player: number, center: number, radius: number): boolean {
  const { terrain, territory } = game;
  const topology = terrain.topology;
  const checked = new Map<number, boolean>();
  for (const tile of tilesInDisc(topology, center, radius)) {
    const owner = territory.ownerOf(tile);
    if (owner === NEUTRAL || owner === player) continue;
    let allied = checked.get(owner);
    if (allied === undefined) {
      allied = isAllied(game, player, owner);
      checked.set(owner, allied);
    }
    if (allied) return true;
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
 * R-UNIT-05: the troops a strike kills, before its tiles go back to nobody.
 * Each player hit, by id, loses B-MISSILE-TROOPS (or B-HEAVY-MISSILE-TROOPS)
 * of the share of their land among `lost`, their tiles under the blast, so
 * the land they held before the strike. The ledger of a player is shared
 * (ADR 0010): this function is the one place missiles change it.
 */
export function killTroops(game: Game, lost: ReadonlyMap<number, number>, heavy: boolean): void {
  const { balance, territory } = game;
  for (const [owner, tiles] of [...lost].sort((a, b) => a[0] - b[0])) {
    const player = game.player(owner);
    if (!player) continue;
    const share = Math.min(
      territory.tileCount(owner),
      mulDiv(tiles, heavy ? balance.heavyMissileTroopsPercent : balance.missileTroopsPercent, 100),
    );
    player.troops -= mulDiv(player.troops, share, territory.tileCount(owner));
  }
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
 * leaves fallout on that land for B-FALLOUT-TIME: taking it costs B-FALLOUT-COST. Runs
 * after the warships and before the transport ships.
 */
export function installMissiles(game: Game): void {
  const { balance, terrain, territory } = game;
  const topology = terrain.topology;
  const missiles = writable(game, "missiles");
  const fallout = writable(game, "fallout");

  game.onOrder(MISSILE_ORDER);

  game.onTick(() => {
    const tick = game.tick;
    let kept = 0;
    for (const zone of fallout) if (tick < zone.until) fallout[kept++] = zone;
    fallout.length = kept;

    kept = 0;
    for (const missile of missiles) {
      if (intercepted(missile)) continue;
      if (tick + 1 >= missile.arrivesAt) {
        const event = { tick, id: missile.id, player: missile.player, size: missile.size };
        const ends = { from: missile.from, to: missile.to, tile: missile.to, by: NEUTRAL };
        // Land under the blast that became an ally's or a teammate's while it flew is spared, and the missile paid back.
        const launcher = game.player(missile.player);
        const radius = blastRadius(game, missile.size);
        if (blastHitsAlly(game, missile.player, missile.to, radius)) {
          if (launcher) launcher.gold += missileCost(game, missile.size);
          logMissile(game, { ...event, ...ends, type: "spared" });
        } else {
          strike(missile);
          logMissile(game, { ...event, ...ends, type: "struck" });
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
    const stopped = byAirDefense(missile, at);
    if (stopped) {
      logIntercepted(missile, at, stopped.player, stopped.tile);
      return true;
    }
    if (game.terrain.landmarks.length === 0) return false;
    const previous =
      game.tick > missile.launchedAt ? missileTile(game, missile, game.tick) : undefined;
    const holder = shieldedBy(game, missile, at, previous);
    if (holder === NEUTRAL) return false;
    logEvent(game, { tick: game.tick, type: "stopped", a: holder, b: missile.player });
    logIntercepted(missile, at, holder, undefined);
    return true;
  }

  function logIntercepted(
    missile: Missile,
    at: number,
    by: number,
    site: number | undefined,
  ): void {
    logMissile(game, {
      tick: game.tick,
      type: "intercepted",
      id: missile.id,
      player: missile.player,
      size: missile.size,
      from: missile.from,
      to: missile.to,
      tile: at,
      by,
      ...(site === undefined ? {} : { site }),
    });
  }

  function byAirDefense(missile: Missile, at: number): Readonly<Structure> | undefined {
    const radius = airDefenseRadius(game);
    const reach = radius * radius;
    for (const defense of game.structures) {
      if (
        (defense.kind !== StructureKind.AirDefense && defense.kind !== StructureKind.Mosque) ||
        // Burnt or taken earlier in this tick, before structures change hands.
        territory.ownerOf(defense.tile) !== defense.player ||
        structureState(game, defense) !== "active" ||
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
      // R-BUILD-09: a mosque gets MOSQUE_TRIES independent tries.
      const tries = defense.kind === StructureKind.Mosque ? MOSQUE_TRIES : 1;
      let stopped = false;
      for (let attempt = 0; attempt < tries && !stopped; attempt++) {
        const roll =
          attempt === 0
            ? draw
            : derivedRandom(draw, game.tick, defense.id, DrawUsage.Interception + attempt);
        stopped = roll % 100 < balance.airDefenseChancePercent;
      }
      if (stopped) {
        startReload(game, defense, balance.airDefenseReloadTicks);
        logEvent(game, { tick: game.tick, type: "stopped", a: defense.player, b: missile.player });
        return defense;
      }
    }
    return undefined;
  }

  function strike(missile: Missile): void {
    const radius = blastRadius(game, missile.size);
    const heavy = missile.size === MissileSize.Heavy;
    const lasting = heavy ? balance.falloutTicks : balance.lightFalloutTicks;
    const until = game.tick + 1 + lasting;
    const lost = new Map<number, number>();
    const disc = tilesInDisc(topology, missile.to, radius);
    for (const tile of disc) {
      if (!terrain.isOwnable(tile)) continue;
      if (lasting > 0) game.falloutUntil[tile] = Math.max(game.falloutUntil[tile] as number, until);
      const owner = territory.ownerOf(tile);
      if (owner === NEUTRAL) continue;
      lost.set(owner, (lost.get(owner) ?? 0) + 1);
    }
    killTroops(game, lost, heavy);
    for (const tile of disc) {
      if (!terrain.isOwnable(tile)) continue;
      if (territory.ownerOf(tile) !== NEUTRAL) territory.setOwner(tile, NEUTRAL);
    }
    if (lasting > 0) fallout.push({ tile: missile.to, radius, until });
  }
}
