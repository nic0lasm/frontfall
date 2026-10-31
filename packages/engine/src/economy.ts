import type { Balance } from "./balance.ts";
import { withDoctrine } from "./doctrines.ts";
import { OPERATOR_FACTOR, OperatorBonus, type Game, type Player } from "./game.ts";
import { logEvent } from "./diplomacy.ts";
import { detPow, mulDiv, percentOf } from "./integer-math.ts";
import { LandmarkEffect, withLandmarks } from "./landmarks.ts";
import { workingCities } from "./structures.ts";

/**
 * Troops of an army in the units of the growth curve (R-ECO-02), which counts
 * ten times what the game shows for its troops, as the curve it follows does.
 */
const GROWTH_SCALE = 10;

/** tiles^0.6 for land counts met again and again, kept apart from the tick. */
const landPower = new Map<number, number>();

function landRoot(tiles: number): number {
  let root = landPower.get(tiles);
  if (root === undefined) {
    if (landPower.size > 50_000) landPower.clear();
    root = detPow(tiles, 0.6);
    landPower.set(tiles, root);
  }
  return root;
}

/**
 * R-ECO-01: the most troops a player's territory and cities can hold: a base
 * for everyone, the land's 0.6 power (so a large empire holds far fewer troops
 * a tile than a small one), and a fixed amount for each working city.
 */
export function populationCap(game: Game, player: Player): number {
  const { popBase, popLand, popPerCity } = game.balance;
  const tiles = game.territory.tileCount(player.id);
  const full =
    popBase + Math.floor(landRoot(tiles) * popLand) + workingCities(game, player) * popPerCity;
  // R-BOT-26, R-BOT-29: a nation or a city-state holds a share of a player's cap.
  const share = game.popFactors.get(player.id)?.cap;
  const shared = share === undefined ? full : mulDiv(full, share, 100);
  // R-DOCTRINE: a doctrine raises or lowers the cap.
  const cap = withDoctrine(game, player.id, "cap", shared);
  // R-MODE-09: the operator's troop bonus doubles the cap.
  return game.hasBonus(player.id, OperatorBonus.Troops) ? cap * OPERATOR_FACTOR : cap;
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

      // R-ECO-03: the fixed income, more for the share of the cap at work (R-ECO-07).
      const income = goldIncome(game, player);
      // R-MODE-09: the operator's test bonus doubles one player's income.
      const bonus = game.hasBonus(player.id, OperatorBonus.Gold) ? OPERATOR_FACTOR : 1;
      const earned = income * bonus + player.goldRemainder;
      player.gold += Math.floor(earned / goldDivisor);
      player.goldRemainder = earned % goldDivisor;
    }
  });
}

/**
 * A player's gold income, in thousandths of gold per second (R-ECO-03): the
 * fixed income of every player (B-GOLD-BASE), more by B-WORK-GOLD for the
 * share of their cap that works (R-ECO-07), and a little for each idle troop
 * when a game sets B-GOLD-RATE. Each gold landmark they hold adds to it
 * (R-LAND-02). Size alone adds nothing: land and cities raise the cap, so a
 * given army works for less gold the larger the cap it fills.
 */
export function goldIncome(game: Game, player: Player): number {
  const { goldBase, goldPerThousandTroops, workGoldPercent } = game.balance;
  const cap = populationCap(game, player);
  // R-BOT-29: a city-state earns a share of it.
  const share = game.popFactors.get(player.id)?.gold;
  const shared = share === undefined ? goldBase * 1000 : mulDiv(goldBase * 1000, share, 100);
  // R-DOCTRINE: and the fixed income.
  const fixed = withDoctrine(game, player.id, "gold", shared);
  const working =
    cap > 0 ? mulDiv(fixed * workGoldPercent, Math.min(workers(player), cap), 100 * cap) : 0;
  const idle = soldiers(player) * goldPerThousandTroops;
  return withLandmarks(
    game,
    player.id,
    LandmarkEffect.Gold,
    game.balance.landmarkGoldPercent,
    fixed + working + idle,
  );
}

/**
 * R-ECO-02: troops an army of `troops` gains in one tick under `cap`. Zero at
 * the cap; an empty army gains B-GROWTH-BASE a tick and a larger one more,
 * with the army's 0.73 power over B-GROWTH-DIVISOR, so growth peaks below
 * the cap. Troops above the cap do not grow.
 */
export function troopGrowth(balance: Balance, cap: number, troops: number): number {
  const gap = cap - troops;
  if (gap <= 0) return 0;
  const { growthBase, growthDivisor } = balance;
  // (base + army^0.73 / divisor) of a tick, in proportion to the room left under the cap.
  const pace = growthBase + detPow(troops * GROWTH_SCALE, 0.73) / growthDivisor;
  // At least one troop, or a player close to the cap would never reach it.
  return Math.max(pace >= 1 ? 1 : 0, Math.floor((pace * gap) / cap));
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
  player.troops += playerGrowth(game, player, cap);
}

/** R-ECO-02: troops a player gains this tick, faster for each growth landmark they hold (R-LAND-02), never past the cap. */
export function playerGrowth(game: Game, player: Player, cap: number): number {
  const gain = troopGrowth(game.balance, cap, player.troops);
  if (gain === 0) return 0;
  const { landmarkGrowthPercent } = game.balance;
  const boosted = withLandmarks(
    game,
    player.id,
    LandmarkEffect.Growth,
    landmarkGrowthPercent,
    gain,
  );
  // R-MODE-09: and the growth.
  const paced = game.popFactors.get(player.id);
  const scaled = paced === undefined ? boosted : Math.max(1, mulDiv(boosted, paced.growth, 100));
  const grown = game.hasBonus(player.id, OperatorBonus.Troops) ? scaled * OPERATOR_FACTOR : scaled;
  return Math.min(grown, cap - player.troops);
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
