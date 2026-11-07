import { cheapestTile, pressureOf } from "../../attacks.ts";
import { isAllied } from "../../diplomacy.ts";
import { soldiers } from "../../economy.ts";
import type { Player } from "../../game.ts";
import { divFloor, percentOf } from "../../integer-math.ts";
import { MissileSize, missileCost, missileError } from "../../missiles.ts";
import {
  StructureKind,
  cityShare,
  disableBit,
  fortRadius,
  placementError,
  structureCost,
  structureCount,
} from "../../structures.ts";
import { NEUTRAL } from "../../territory/territory-map.ts";
import { inlandSite, scanBorder } from "../shared.ts";
import {
  FORT_SETBACK,
  NATION_MISSILE_LEADER_PERCENT,
  NATION_SILO_CITIES,
  NATION_WORK_PERCENT,
} from "./constants.ts";
import { mainAttacker, type NationContext } from "./context.ts";

/**
 * R-BOT-16: with collapsing fronts (R-ATTACK-10), whether putting
 * B-NATION-WORK of its troops to work would leave a front that half the
 * soldiers of the player across it could overwhelm.
 */
export function exposedAtWork(ctx: NationContext, nation: Player): boolean {
  const { game, territory, topology, balance, facing, around } = ctx;
  if (!game.rules.collapsingFronts) return false;
  const tiles = territory.tileCount(nation.id);
  const perTile = divFloor(nation.troops - percentOf(nation.troops, NATION_WORK_PERCENT), tiles);
  facing.clear();
  // Each of the nation's tiles counts once per neighbour, as R-ATTACK-10 counts the front.
  const borders = territory.borderCount(nation.id);
  for (let i = 0; i < borders; i++) {
    const count = topology.neighborsInto(territory.borderTile(nation.id, i), around);
    for (let j = 0; j < count; j++) {
      const owner = territory.ownerOf(around[j] as number);
      if (owner === nation.id || owner === NEUTRAL) continue;
      let seen = false;
      for (let k = 0; k < j && !seen; k++) seen = territory.ownerOf(around[k] as number) === owner;
      if (!seen) facing.set(owner, (facing.get(owner) ?? 0) + 1);
    }
  }
  for (const [owner, front] of facing) {
    const neighbour = game.player(owner);
    if (!neighbour?.alive || isAllied(game, nation.id, owner)) continue;
    const threat = percentOf(soldiers(game, neighbour), 50);
    if (threat * 10 >= balance.collapseOddsTenths * Math.max(1, perTile * front)) return true;
  }
  return false;
}

/**
 * R-BOT-16: with collapsing fronts (R-ATTACK-10), feeds its attack on a
 * player that is building pressure, so the front breaks before the odds
 * turn. Whether it sent anything.
 */
export function press(ctx: NationContext, nation: Player, armed: () => number): boolean {
  const { game, territory, balance } = ctx;
  const own = territory.tileCount(nation.id);
  const pushing = game.attacks.find(
    (attack) =>
      attack.player === nation.id &&
      attack.target !== NEUTRAL &&
      pressureOf(game, attack) > 0 &&
      territory.tileCount(attack.target) > own,
  );
  if (!pushing) return false;
  const target = pushing.target;
  const aim =
    territory.ownerOf(pushing.aim) === target
      ? pushing.aim
      : scanBorder(game, nation, (owner) => owner === target).enemy;
  if (aim < 0) return false;
  const troops = armed();
  if (troops < cheapestTile(balance)) return false;
  return game.apply(nation.id, { type: "attack", target: aim, troops });
}

/**
 * R-BOT-12: a silo near its start once it has B-NATION-SILO-CITIES cities
 * and the gold for a missile too; an air defense once a player not its
 * ally owns a silo; and, whenever a silo is loaded and its gold allows, a
 * missile at the city closest to it of its main attacker, or else of the
 * leading player once they hold B-NATION-MISSILE-LEADER of the land.
 */
export function arm(ctx: NationContext, nation: Player): void {
  const { game, territory, armCooldowns, missileCooldowns, missilePauseTicks, retryTicks } = ctx;
  const start = nation.start;
  if (start === undefined) return;
  // Built around a start it still holds, with a pause after a search that found no room.
  const build = (kind: StructureKind): void => {
    if (!game.allows(disableBit(kind)) || territory.ownerOf(start) !== nation.id) return;
    if (game.tick < (armCooldowns.get(nation.id) ?? 0)) return;
    const tile = inlandSite(game, nation, start);
    if (tile >= 0) game.apply(nation.id, { type: "build", structure: kind, tile });
    else armCooldowns.set(nation.id, game.tick + retryTicks);
  };
  const light = missileCost(game, MissileSize.Light);
  if (
    structureCount(game, nation.id, StructureKind.Silo) === 0 &&
    cityShare(game, nation.id) >= NATION_SILO_CITIES &&
    nation.gold >= structureCost(game, nation.id, StructureKind.Silo) + light
  ) {
    build(StructureKind.Silo);
  }
  const threat = game.structures.some(
    (s) =>
      s.kind === StructureKind.Silo &&
      s.player !== nation.id &&
      !isAllied(game, nation.id, s.player),
  );
  if (
    threat &&
    structureCount(game, nation.id, StructureKind.AirDefense) === 0 &&
    nation.gold >= structureCost(game, nation.id, StructureKind.AirDefense)
  ) {
    build(StructureKind.AirDefense);
  }
  // B-NATION-MISSILE-PAUSE: an easy nation fires seldom, a hard one as often as its silo reloads.
  if (nation.gold < light || game.tick < (missileCooldowns.get(nation.id) ?? 0)) return;
  const target = missileTarget(ctx, nation);
  if (target === NEUTRAL) return;
  const topology = game.terrain.topology;
  let city = -1;
  let closest = 0;
  for (const s of game.structures) {
    if (s.player !== target) continue;
    if (s.kind !== StructureKind.City && s.kind !== StructureKind.Palace) continue;
    const distance = topology.squaredDistance(s.tile, start);
    if (city < 0 || distance < closest) {
      city = s.tile;
      closest = distance;
    }
  }
  if (city < 0) return;
  const order = { type: "missile", target: city, size: MissileSize.Light } as const;
  if (missileError(game, nation, city, order.size) !== undefined) return;
  game.apply(nation.id, order);
  missileCooldowns.set(nation.id, game.tick + missilePauseTicks);
}

/** The main attacker of the nation, or else the leading player if they hold enough land; NEUTRAL if neither. */
function missileTarget(ctx: NationContext, nation: Player): number {
  const { game, territory } = ctx;
  const attacker = mainAttacker(ctx, nation.id);
  if (attacker !== NEUTRAL) return attacker;
  let leader = NEUTRAL;
  let most = 0;
  for (const player of game.players()) {
    if (player.id === nation.id || !player.alive || isAllied(game, nation.id, player.id)) continue;
    const tiles = territory.tileCount(player.id);
    if (tiles > most) {
      leader = player.id;
      most = tiles;
    }
  }
  const share = most * 100;
  return share >= game.terrain.ownableCount * NATION_MISSILE_LEADER_PERCENT ? leader : NEUTRAL;
}

/**
 * R-BOT-08: a fort behind the front with the attacker, on the free inland
 * tile of the nation farthest from the attacker's land within a few tiles,
 * so the first tiles lost do not take it; its radius still covers the front.
 * None while one of its forts, built or being built, already covers it.
 */
export function buildFort(ctx: NationContext, nation: Player, front: number): void {
  const { game, territory } = ctx;
  const kind = StructureKind.Fort;
  if (!game.allows(disableBit(kind)) || nation.gold < structureCost(game, nation.id, kind)) return;
  const topology = game.terrain.topology;
  const radius = fortRadius(game);
  for (const s of game.structures) {
    if (s.kind === kind && s.player === nation.id && topology.distance(s.tile, front) <= radius) {
      return;
    }
  }
  let best = -1;
  let bestDistance = 0;
  for (const tile of topology.tilesWithin(front, Math.min(FORT_SETBACK, radius))) {
    if (territory.ownerOf(tile) !== nation.id || territory.isBorder(tile)) continue;
    const distance = topology.distance(tile, front);
    // Row order breaks ties, the same on every client.
    if (best >= 0 && distance <= bestDistance) continue;
    if (placementError(game, nation, kind, tile) !== undefined) continue;
    best = tile;
    bestDistance = distance;
  }
  if (best >= 0) game.apply(nation.id, { type: "build", structure: kind, tile: best });
}
