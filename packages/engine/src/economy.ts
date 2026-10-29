import type { Balance } from "./balance.ts";
import type { Game, Player } from "./game.ts";
import { logEvent } from "./diplomacy.ts";
import { mulDiv, percentOf } from "./integer-math.ts";
import { spawnSettings } from "./spawn.ts";
import { workingCities } from "./structures.ts";

/**
 * R-ECO-01: the most troops a player's territory and cities can hold. A base
 * equal to the starting troops of the map comes on top, so a player who has
 * just spawned, or is down to a few tiles, still grows. Land beyond a share of
 * the map counts for less (R-ECO-06), so the largest empires stop refilling
 * as fast as they can be taken apart. Each working city adds a share of what
 * the land holds (R-BUILD-01), so a city is worth as much to a large empire
 * as to a small one.
 */
export function populationCap(game: Game, player: Player): number {
  const { popPerTile, popPerCityPercent, popFalloffSharePercent, popFalloffPercent } = game.balance;
  const base = spawnSettings(game).troops;
  const tiles = game.territory.tileCount(player.id);
  // Past B-POP-FALLOFF-SHARE of the land, each tile holds only B-POP-FALLOFF of the usual troops.
  const full = Math.min(tiles, mulDiv(game.terrain.ownableCount, popFalloffSharePercent, 100));
  const land = full * popPerTile + mulDiv((tiles - full) * popPerTile, popFalloffPercent, 100);
  const cities = workingCities(game, player);
  return base + land + mulDiv(land, cities * popPerCityPercent, 100);
}

/** R-ECO-07: troops at home who work, earning gold, and neither attack nor defend. */
export function workers(player: Player): number {
  return percentOf(player.troops, player.workShare);
}

/** R-ECO-07: troops at home who fight: the most an attack or a ship can take, and what holds the land. */
export function soldiers(player: Player): number {
  return player.troops - workers(player);
}

/** Why a work share cannot be set, or undefined when it can (R-ECO-07). */
export function workError(game: Game, share: number): string | undefined {
  if (!Number.isSafeInteger(share) || share < 0 || share > game.balance.workMaxPercent) {
    return "invalid work share";
  }
  return undefined;
}

/**
 * Growth of troops and gold every tick of play (R-ECO-01 to R-ECO-05), and
 * elimination of players left without land.
 */
export function installEconomy(game: Game): void {
  // Gold earned per tick is often fractional: players carry the remainder, in
  // units of 1 / goldDivisor, so small players are not rounded down to nothing.
  const goldDivisor = 1000 * game.balance.ticksPerSecond;

  // R-ECO-07: a player sets the share of their troops at home who work.
  game.onOrder((_, player, order) => {
    if (order.type !== "work") return false;
    player.workShare = order.share;
    return true;
  });

  game.onTick(() => {
    if (game.phase !== "play") return;
    for (const player of game.players()) {
      if (!player.alive) continue;
      if (game.territory.tileCount(player.id) === 0) {
        eliminate(game, player);
        continue;
      }
      growTroops(game, player);

      // R-ECO-07: a worker earns B-WORK-GOLD times what a soldier does.
      const earning = player.troops + workers(player) * (game.balance.workGoldFactor - 1);
      const earned = earning * game.balance.goldPerThousandTroops + player.goldRemainder;
      player.gold += Math.floor(earned / goldDivisor);
      player.goldRemainder = earned % goldDivisor;
    }
  });
}

/**
 * R-ECO-02: troops an army of `troops` gains in one tick under `cap`. Zero at
 * the cap; an empty army grows at B-GROWTH-FLOOR of the rate and a larger one
 * faster, so growth peaks below the cap. Troops above the cap do not grow.
 */
export function troopGrowth(balance: Balance, cap: number, troops: number): number {
  const gap = cap - troops;
  if (gap <= 0) return 0;
  const { growthBasisPoints, growthFloorPercent, ticksPerSecond } = balance;
  // Weight of the army in percent of the cap: B-GROWTH-FLOOR when empty, 100 when full.
  const weight = growthFloorPercent * cap + (100 - growthFloorPercent) * troops;
  const gain = mulDiv(gap * growthBasisPoints, weight, 10_000 * ticksPerSecond * 100 * cap);
  // At least one troop, or a player close to the cap would never reach it.
  return Math.max(1, gain);
}

function growTroops(game: Game, player: Player): void {
  const cap = populationCap(game, player);
  const excess = player.troops - cap;
  if (excess > 0) {
    // B-DESERTION: troops above the cap, back from an attack or left by lost land, drift away.
    const { desertionBasisPoints, ticksPerSecond } = game.balance;
    if (desertionBasisPoints > 0) {
      player.troops -= Math.max(1, mulDiv(excess, desertionBasisPoints, 10_000 * ticksPerSecond));
    }
    return;
  }
  player.troops += troopGrowth(game.balance, cap, player.troops);
}

/**
 * R-ECO-05: an eliminated player keeps nothing. R-ECO-08: the player who took
 * their last tile takes all their gold.
 */
function eliminate(game: Game, player: Player): void {
  const taker = game.player(game.territory.lastTakerOf(player.id));
  if (taker?.alive === true) {
    taker.gold += player.gold;
    logEvent(game, {
      tick: game.tick,
      type: "eliminated",
      a: taker.id,
      b: player.id,
      gold: player.gold,
    });
  }
  player.alive = false;
  player.troops = 0;
  player.gold = 0;
  player.goldRemainder = 0;
}
