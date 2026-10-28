import { capitalAim } from "../capitals.ts";
import { populationCap } from "../economy.ts";
import { allianceOf, alliesOf, canRenew, isTraitor, sameTeam } from "../diplomacy.ts";
import type { Game, Player } from "../game.ts";
import { divFloor, mulDiv, percentOf } from "../integer-math.ts";
import { BOT_DIFFICULTIES, type BotDifficulty } from "./difficulty.ts";
import {
  RETRY_DECISIONS,
  buildCity,
  buildPort,
  sail,
  scanBorder,
  persistCooldowns,
  type Cooldowns,
} from "./shared.ts";

/** Allies a bot keeps at most, so that it always has someone left to fight. */
const ALLIANCE_MAX = 1; // B-BOT-ALLIANCE-MAX

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
  const { territory, terrain, balance } = game;
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
    answerAlliances(bot, tiles);
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

  /** R-BOT-10: alliances with smaller players the bot is not fighting, asked for by them. */
  function answerAlliances(bot: Player, tiles: number): void {
    // Attacks either way, and ships of theirs sailing for the bot's coast.
    const fighting = (other: number) =>
      game.attacks.some(
        (a) =>
          a.troops > 0 &&
          ((a.player === bot.id && a.target === other) ||
            (a.player === other && a.target === bot.id)),
      ) || game.boats.some((b) => b.player === other && territory.ownerOf(b.target) === bot.id);
    // Two allies who hold the winning share between them could only wait for the
    // time limit. In a team game, each side's land is its team's (R-MODE-02).
    const room = mulDiv(terrain.ownableCount, balance.winSharePercent, 100);
    const sideLand = (id: number) => {
      let land = territory.tileCount(id);
      for (const player of game.players()) {
        if (player.alive && sameTeam(game, id, player.id)) land += territory.tileCount(player.id);
      }
      return land;
    };
    const ours = game.teams > 0 ? sideLand(bot.id) : tiles;
    const worth = (other: number) => {
      const theirs = game.teams > 0 ? sideLand(other) : territory.tileCount(other);
      const traitor = isTraitor(game, game.player(other) as Player);
      return theirs < ours && ours + theirs < room && !fighting(other) && !traitor;
    };
    // Teammates count among the bot's allies.
    let teammates = 0;
    for (const player of game.players()) {
      if (player.alive && sameTeam(game, bot.id, player.id)) teammates++;
    }
    for (const ally of alliesOf(game, bot.id)) {
      const alliance = allianceOf(game, bot.id, ally);
      if (!alliance || !canRenew(game, alliance) || !worth(ally)) continue;
      // Its vote stands until the other side's comes.
      if (bot.id === alliance.a ? alliance.renewA : alliance.renewB) continue;
      game.apply(bot.id, { type: "ally", target: ally });
    }
    // Oldest request first, the same on every client.
    for (const request of [...game.allianceRequests]) {
      if (request.to !== bot.id || alliesOf(game, bot.id).length + teammates >= ALLIANCE_MAX) {
        continue;
      }
      if (worth(request.from)) game.apply(bot.id, { type: "ally", target: request.from });
    }
  }
}
