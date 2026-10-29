import { capitalAim } from "../capitals.ts";
import { populationCap } from "../economy.ts";
import type { Game, Player } from "../game.ts";
import { divFloor, percentOf } from "../integer-math.ts";
import { BOT_DIFFICULTIES, type BotDifficulty } from "./difficulty.ts";
import {
  RETRY_DECISIONS,
  answerAlliances,
  buildCity,
  buildPort,
  sail,
  scanBorder,
  persistCooldowns,
  type Cooldowns,
} from "./shared.ts";

/** Allies a bot keeps at most, so that it always has someone left to fight. */
const ALLIANCE_MAX = 1; // B-BOT-ALLIANCE-MAX

/** A bot only allies with a player smaller than itself (R-BOT-10). */
const ALLIANCE_SIZE_PERCENT = 100;

/**
 * Bots (R-BOT-01, R-BOT-03, R-BOT-04): the given players expand into unowned
 * land while some is in reach and attack weaker neighbours, keeping a reserve
 * at home. They decide from the game state and the game's Random only, and
 * act through game.apply with the orders humans send, so every client runs
 * the same decisions.
 *
 * With nothing worth taking by land, a bot sails to the closest free coast it
 * can reach, or else to the coast of a weaker player, up to B-BOAT-MAX
 * ships at sea (R-BOT-05).
 *
 * Whenever their gold pays for a city their land supports, they build one
 * as close as they can to where they started, away from the front, and
 * after their first city, one port on their coast closest to it (R-BOT-06).
 *
 * Bots never ask for an alliance. They accept one from a smaller player, not
 * a traitor, with no attack between them, while the two hold less than B-WIN-SHARE of the land
 * together, up to B-BOT-ALLIANCE-MAX allies, and renew it on the same terms;
 * they never betray (R-BOT-10).
 *
 * Bots do not pick a start: the spawn phase places them at random when it
 * ends (R-SPAWN-03).
 */
export function installBots(game: Game, ids: readonly number[], difficulty: BotDifficulty): void {
  const { territory, balance } = game;
  const params = BOT_DIFFICULTIES[difficulty];
  const interval = Math.max(1, params.intervalSeconds * balance.ticksPerSecond);
  const retryTicks = RETRY_DECISIONS * interval;
  const bots = [...new Set(ids)].sort((a, b) => a - b);
  for (const id of bots) {
    if (!game.player(id)) throw new RangeError(`unknown player ${String(id)}`);
  }
  const seaCooldowns: Cooldowns = new Map();
  const cityCooldowns: Cooldowns = new Map();
  const portCooldowns: Cooldowns = new Map();
  persistCooldowns(game, `bots ${difficulty} ${bots.join(",")}`, [
    seaCooldowns,
    cityCooldowns,
    portCooldowns,
  ]);

  game.onTick(() => {
    if (game.phase !== "play") return;
    for (const id of bots) {
      // Offset by id so that bots spread their decisions over the interval.
      if ((game.tick + id) % interval !== 0) continue;
      const bot = game.player(id) as Player;
      if (bot.alive) decide(bot);
    }
  });

  function decide(bot: Player): void {
    const tiles = territory.tileCount(bot.id);
    if (tiles === 0 || territory.borderCount(bot.id) === 0) return;
    answerAlliances(game, bot, ALLIANCE_SIZE_PERCENT, ALLIANCE_MAX);
    buildCity(game, bot, cityCooldowns, retryTicks);
    buildPort(game, bot, portCooldowns, retryTicks);
    const reserve = percentOf(populationCap(game, bot), params.reservePercent);
    const troops = Math.min(percentOf(bot.troops, params.attackRatioPercent), bot.troops - reserve);
    // Less than the price of one tile would come straight back.
    if (troops < balance.neutralCost) return;

    const { neutral, enemy, enemyDensity } = scanBorder(game, bot);
    const ownDensity = divFloor(bot.troops, tiles);
    const weak = enemy >= 0 && enemyDensity * 100 <= ownDensity * params.boldnessPercent;
    // Free land is cheaper than a fight: while some is in reach, only a much weaker neighbour is worth attacking.
    const muchWeaker = weak && enemyDensity * 200 <= ownDensity * params.boldnessPercent;
    const target = neutral >= 0 && !muchWeaker ? neutral : weak ? enemy : -1;
    // R-BOT-17: an attack on a player heads for their capital.
    const aim = target >= 0 && target === enemy ? capitalAim(game, target) : target;
    if (target >= 0) game.apply(bot.id, { type: "attack", target: aim, troops });
    else sail(game, bot, troops, params.boldnessPercent, seaCooldowns, retryTicks);
  }
}
